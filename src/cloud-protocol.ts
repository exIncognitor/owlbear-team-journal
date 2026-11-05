import {
  PREFIX,
  RECORD_PREFIX,
  ACHIEVEMENT_PREFIX,
  DISPLAY_KEY,
  COINS,
  moneyKey,
  type Metadata,
} from "./model";
export interface CloudProfile {
  id: string;
  name: string;
  endpoint: string;
  privateKey: JsonWebKey;
}
export interface Library {
  id: string;
  name: string;
  revision: number;
}
export interface CloudSelection {
  mode: "cloud";
  roomId: string;
  endpoint: string;
  libraryId: string;
  libraryName: string;
  token: string;
  epoch: string;
}
export type Selection = { mode: "room"; roomId: string } | CloudSelection;
export const SELECTION_KEY = PREFIX + "storage-v1";
export const SIGNAL_KEY = PREFIX + "sync-v1";
export const STAMP_KEY = "__team_journal_read_stamp";
export function businessKey(key: string) {
  return (
    key === DISPLAY_KEY ||
    COINS.some((c) => key === moneyKey(c)) ||
    [RECORD_PREFIX, ACHIEVEMENT_PREFIX].some(
      (prefix) =>
        key.startsWith(prefix) &&
        /^[a-zA-Z0-9-]{1,80}$/.test(key.slice(prefix.length)),
    )
  );
}
export const ownedData = (data: Metadata): Metadata =>
  Object.fromEntries(Object.entries(data).filter(([key]) => businessKey(key)));
export function endpointUrl(value: string) {
  const url = new URL(value);
  const local =
    import.meta.env?.DEV && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (!local && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("云端接口须为不含账号、密码和查询参数的 HTTPS 地址");
  return url.href.replace(/\/$/, "");
}
export function decodeSelection(raw: unknown, roomId: string): Selection {
  if (raw == null) return { mode: "room", roomId };
  const d = raw as Partial<Omit<CloudSelection, "mode">> & { mode?: string };
  if (d.roomId !== roomId)
    throw Error("存储配置不属于当前房间，请 DM 重新选择");
  if (d.mode === "room") return { mode: "room", roomId };
  if (
    d.mode !== "cloud" ||
    typeof d.endpoint !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(d.libraryId ?? "") ||
    typeof d.libraryName !== "string" ||
    d.libraryName.length > 80 ||
    !/^[a-f0-9]{64}$/.test(d.token ?? "") ||
    typeof d.epoch !== "string"
  )
    throw Error("云端存储配置无效，原资料已保留");
  return {
    mode: "cloud",
    roomId,
    endpoint: endpointUrl(d.endpoint),
    libraryId: d.libraryId!,
    libraryName: d.libraryName,
    token: d.token!,
    epoch: d.epoch,
  };
}
export const base64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes));
export async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function adminHeaders(
  key: JsonWebKey,
  method: string,
  url: URL,
  body: string,
) {
  const timestamp = String(Date.now()),
    nonce = crypto.randomUUID();
  const message = [
    method,
    url.pathname + url.search,
    timestamp,
    nonce,
    await digest(body),
  ].join("\n");
  const imported = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    imported,
    new TextEncoder().encode(message),
  );
  return {
    "X-Journal-Time": timestamp,
    "X-Journal-Nonce": nonce,
    "X-Journal-Signature": base64(new Uint8Array(signature)),
  };
}
export async function cloudRequest(
  endpoint: string,
  path: string,
  method = "GET",
  value?: unknown,
  auth?: CloudProfile | string,
) {
  const url = new URL(endpointUrl(endpoint) + path),
    body = value === undefined ? "" : JSON.stringify(value);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (typeof auth === "string") headers.Authorization = `Bearer ${auth}`;
  else if (auth)
    Object.assign(
      headers,
      await adminHeaders(auth.privateKey, method, url, body),
    );
  const response = await fetch(url, {
    method,
    headers,
    body: body || undefined,
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const result = await response
    .json()
    .catch(() => ({ error: "云端没有返回有效 JSON" }));
  if (!response.ok)
    throw Error(result.error || `云端请求失败（${response.status}）`);
  return result;
}
export async function importProfile(value: unknown): Promise<CloudProfile> {
  const p = value as Partial<CloudProfile>;
  if (
    !p ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 80 ||
    typeof p.endpoint !== "string" ||
    !p.privateKey?.d ||
    p.privateKey.kty !== "EC" ||
    p.privateKey.crv !== "P-256"
  )
    throw Error("请选择有效的云端管理连接配置 JSON");
  await crypto.subtle.importKey(
    "jwk",
    p.privateKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return {
    id: p.id && /^[a-zA-Z0-9-]{1,80}$/.test(p.id) ? p.id : crypto.randomUUID(),
    name: p.name.trim(),
    endpoint: endpointUrl(p.endpoint),
    privateKey: p.privateKey,
  };
}
