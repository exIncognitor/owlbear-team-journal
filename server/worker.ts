import publicKey from "./admin-public.json";
import { businessKey, digest } from "../src/cloud-protocol";
import {
  validateEntry,
  unpack,
  object,
  integer,
  text,
  DISPLAY_KEY,
  RECORD_PREFIX,
  ACHIEVEMENT_PREFIX,
  type Metadata,
} from "../src/model";
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>;
  exec(sql: string): Promise<unknown>;
}
interface Env {
  DB?: Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
const schema = `CREATE TABLE IF NOT EXISTS journal_libraries(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,nonce TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS journal_records(library_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(library_id,key));
CREATE TABLE IF NOT EXISTS journal_bindings(room_id TEXT NOT NULL,library_id TEXT NOT NULL,token_hash TEXT NOT NULL,epoch TEXT NOT NULL,PRIMARY KEY(room_id,library_id));
CREATE TABLE IF NOT EXISTS journal_private_art(library_id TEXT NOT NULL,room_id TEXT NOT NULL,owner_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(library_id,room_id,owner_id));
CREATE TABLE IF NOT EXISTS journal_nonces(id TEXT PRIMARY KEY,expires INTEGER NOT NULL);`;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Journal-Time, X-Journal-Nonce, X-Journal-Signature",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "X-Content-Type-Options": "nosniff",
    },
  });
class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0,
    body = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > 1500000) {
      await reader.cancel();
      throw new ApiError("单次请求过大，请分批复制", 413);
    }
    body += decoder.decode(next.value, { stream: true });
  }
  return body + decoder.decode();
}
function name(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 80)
    throw new ApiError("名称须为 1–80 字");
  return value.trim();
}
async function verifyAdmin(request: Request, body: string, db: Database) {
  const time = request.headers.get("X-Journal-Time") ?? "",
    nonce = request.headers.get("X-Journal-Nonce") ?? "",
    signature = request.headers.get("X-Journal-Signature") ?? "";
  if (
    !/^\d{13}$/.test(time) ||
    Math.abs(Date.now() - Number(time)) > 120000 ||
    !/^[a-zA-Z0-9-]{36}$/.test(nonce)
  )
    throw new ApiError("需要有效的 DM 云端管理配置", 403);
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const url = new URL(request.url),
      message = [
        request.method,
        url.pathname + url.search,
        time,
        nonce,
        await digest(body),
      ].join("\n");
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
      new TextEncoder().encode(message),
    );
    if (!valid) throw Error();
  } catch {
    throw new ApiError("云端管理签名无效", 403);
  }
  await db.exec(schema);
  try {
    await db
      .prepare("INSERT INTO journal_nonces(id,expires) VALUES(?,?)")
      .bind(nonce, Date.now() + 120000)
      .run();
  } catch {
    throw new ApiError("管理请求已使用，请重试", 409);
  }
  await db
    .prepare("DELETE FROM journal_nonces WHERE expires < ?")
    .bind(Date.now())
    .run();
}
async function library(db: Database, id: string) {
  const row = await db
    .prepare("SELECT id,name,revision FROM journal_libraries WHERE id=?")
    .bind(id)
    .first<{ id: string; name: string; revision: number }>();
  if (!row) throw new ApiError("资料库不存在", 404);
  return row;
}
async function metadata(db: Database, id: string) {
  const { results } = await db
    .prepare("SELECT key,value FROM journal_records WHERE library_id=?")
    .bind(id)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(
    results.map((row) => [row.key, JSON.parse(row.value)]),
  ) as Metadata;
}
async function validateUpdate(update: Metadata) {
  for (const [key, value] of Object.entries(update)) {
    if (value === null) continue;
    if (key.startsWith(RECORD_PREFIX) || key.startsWith(ACHIEVEMENT_PREFIX)) {
      const entry = validateEntry(await unpack(value));
      const prefix =
        entry.kind === "achievement" ? ACHIEVEMENT_PREFIX : RECORD_PREFIX;
      if (key !== prefix + entry.id)
        throw new ApiError("资料类型或编号与存储位置不符");
      if (entry.kind === "art" && entry.visibility === "gm")
        throw new ApiError("DM 私密插画不能写入共享资料，请使用私密接口");
    } else if (key === DISPLAY_KEY) {
      const display = object(value);
      if (
        display.id !== null &&
        (typeof display.id !== "string" ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(display.id))
      )
        throw new ApiError("展示资料编号无效");
    } else {
      const coin = object(value);
      integer(coin.value, "金钱");
      text(coin.rev, "版本", 80, true);
    }
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return json({});
    try {
      const db = env.DB;
      if (!db)
        throw new ApiError(
          "此云端尚未绑定 D1 数据库；房间共享模式仍可使用",
          503,
        );
      if (url.pathname === "/api/health" && request.method === "GET")
        return json({ service: "team-journal", version: 1, bound: true });
      const admin = url.pathname.startsWith("/api/admin/");
      if (
        !admin &&
        !/^Bearer [a-f0-9]{64}$/.test(
          request.headers.get("Authorization") ?? "",
        )
      )
        throw new ApiError("需要房间云端访问授权", 403);
      const body = request.method === "GET" ? "" : await boundedBody(request);
      if (admin) await verifyAdmin(request, body, db);
      const input = body ? JSON.parse(body) : {};
      if (url.pathname === "/api/admin/libraries") {
        if (request.method === "GET")
          return json({
            libraries: (
              await db
                .prepare(
                  "SELECT id,name,revision FROM journal_libraries ORDER BY name,id",
                )
                .all()
            ).results,
          });
        if (request.method === "POST") {
          const id = crypto.randomUUID(),
            title = name(input.name);
          await db
            .prepare("INSERT INTO journal_libraries(id,name) VALUES(?,?)")
            .bind(id, title)
            .run();
          return json({ id, name: title, revision: 0 });
        }
      }
      const activation = url.pathname.match(
        /^\/api\/admin\/libraries\/([a-zA-Z0-9-]+)\/activate$/,
      );
      if (activation && request.method === "POST") {
        const row = await library(db, activation[1]);
        if (
          typeof input.roomId !== "string" ||
          !input.roomId ||
          input.roomId.length > 160
        )
          throw new ApiError("房间编号无效");
        const token = Array.from(
            crypto.getRandomValues(new Uint8Array(32)),
            (b) => b.toString(16).padStart(2, "0"),
          ).join(""),
          epoch = crypto.randomUUID();
        await db
          .prepare(
            "INSERT INTO journal_bindings(room_id,library_id,token_hash,epoch) VALUES(?,?,?,?) ON CONFLICT(room_id,library_id) DO UPDATE SET token_hash=excluded.token_hash,epoch=excluded.epoch",
          )
          .bind(input.roomId, row.id, await digest(token), epoch)
          .run();
        return json({
          roomId: input.roomId,
          libraryId: row.id,
          libraryName: row.name,
          token,
          epoch,
        });
      }
      const privateArt = url.pathname.match(
        /^\/api\/admin\/libraries\/([a-zA-Z0-9-]+)\/private-art$/,
      );
      if (privateArt) {
        const id = privateArt[1];
        await library(db, id);
        const roomId = url.searchParams.get("room") ?? "",
          ownerId = url.searchParams.get("owner") ?? "";
        if (!roomId || roomId.length > 160 || !ownerId || ownerId.length > 160)
          throw new ApiError("私密资料的房间或账号编号无效");
        if (request.method === "GET") {
          const row = await db
            .prepare(
              "SELECT revision,data FROM journal_private_art WHERE library_id=? AND room_id=? AND owner_id=?",
            )
            .bind(id, roomId, ownerId)
            .first<{ revision: number; data: string }>();
          return json({
            revision: row?.revision ?? 0,
            entries: row ? JSON.parse(row.data) : [],
          });
        }
        if (request.method === "POST") {
          if (
            !Array.isArray(input.entries) ||
            input.entries.length > 500 ||
            !Number.isSafeInteger(input.revision) ||
            input.revision < 0
          )
            throw new ApiError("私密插画更新无效，单个资料库最多 500 张");
          const ids = new Set<string>();
          const entries = input.entries.map((value: unknown) => {
            const entry = validateEntry(value);
            if (
              entry.kind !== "art" ||
              entry.visibility !== "gm" ||
              ids.has(entry.id)
            )
              throw new ApiError("私密接口只接受不重复的 DM 隐藏插画");
            ids.add(entry.id);
            return entry;
          });
          const result = await db.batch([
            db
              .prepare(
                "INSERT OR IGNORE INTO journal_private_art(library_id,room_id,owner_id) VALUES(?,?,?)",
              )
              .bind(id, roomId, ownerId),
            db
              .prepare(
                "UPDATE journal_private_art SET revision=revision+1,data=? WHERE library_id=? AND room_id=? AND owner_id=? AND revision=?",
              )
              .bind(
                JSON.stringify(entries),
                id,
                roomId,
                ownerId,
                input.revision,
              ),
          ]);
          if (result[1].meta.changes !== 1)
            throw new ApiError(
              "私密插画已在其他窗口修改，请重新读取后重试",
              409,
            );
          return json({ revision: input.revision + 1 });
        }
      }
      const state = url.pathname.match(
        /^\/api\/(admin\/)?libraries\/([a-zA-Z0-9-]+)\/state$/,
      );
      if (state) {
        const id = state[2],
          row = await library(db, id);
        if (!admin) {
          const roomId = url.searchParams.get("room") ?? "",
            token =
              request.headers.get("Authorization")?.replace(/^Bearer /, "") ??
              "";
          const binding = await db
            .prepare(
              "SELECT library_id,token_hash FROM journal_bindings WHERE room_id=? AND library_id=?",
            )
            .bind(roomId, id)
            .first<{ library_id: string; token_hash: string }>();
          if (
            !binding ||
            binding.library_id !== id ||
            !token ||
            binding.token_hash !== (await digest(token))
          )
            throw new ApiError("房间云端授权已变化，请重新读取设置", 403);
        }
        if (request.method === "GET") {
          if (url.searchParams.get("since") === String(row.revision))
            return json({ revision: row.revision, metadata: null });
          return json({
            revision: row.revision,
            metadata: await metadata(db, id),
          });
        }
        if (request.method === "POST") {
          const update = input.update as Metadata;
          if (
            !update ||
            typeof update !== "object" ||
            Array.isArray(update) ||
            Object.keys(update).length > 200 ||
            !Number.isSafeInteger(input.revision)
          )
            throw new ApiError("更新内容无效或超过 200 条");
          for (const key of Object.keys(update))
            if (
              !businessKey(key) ||
              (!admin && key.startsWith(ACHIEVEMENT_PREFIX))
            )
              throw new ApiError("没有权限修改此资料", 403);
          await validateUpdate(update);
          const nonce = crypto.randomUUID();
          const statements = [
            db
              .prepare(
                "UPDATE journal_libraries SET revision=revision+1,nonce=? WHERE id=? AND revision=?",
              )
              .bind(nonce, id, input.revision),
            ...Object.entries(update).map(([key, value]) =>
              db
                .prepare(
                  "INSERT INTO journal_records(library_id,key,value) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM journal_libraries WHERE id=? AND nonce=?) ON CONFLICT(library_id,key) DO UPDATE SET value=excluded.value",
                )
                .bind(id, key, JSON.stringify(value), id, nonce),
            ),
          ];
          const result = await db.batch(statements);
          if (result[0].meta.changes !== 1)
            throw new ApiError("资料已被队友修改，请重新读取后重试", 409);
          return json({ revision: input.revision + 1 });
        }
      }
      throw new ApiError("接口不存在", 404);
    } catch (error) {
      return json(
        {
          error:
            error instanceof ApiError || error instanceof SyntaxError
              ? error.message
              : "云端暂时不可用，请重试",
        },
        error instanceof ApiError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 500,
      );
    }
  },
};
