export const PREFIX = "io.twisted-moon.v1/";
export const RECORD_PREFIX = PREFIX + "entry/";
export const ACHIEVEMENT_PREFIX = PREFIX + "achievement/";
export const QUALITIES = ["普通", "优秀", "稀有", "史诗", "传说"] as const;
export const COINS = ["pp", "gp", "ep", "sp", "cp"] as const;
export type Coin = (typeof COINS)[number];
export const COIN_LABELS: Record<Coin, string> = {
  pp: "铂币",
  gp: "金币",
  ep: "琥珀金币",
  sp: "银币",
  cp: "铜币",
};
export type Metadata = Record<string, unknown>;
interface Base {
  id: string;
  title: string;
  rev: string;
  updatedAt: number;
}
export interface Item extends Base {
  kind: "item";
  category: "道具" | "装备";
  quantity: number;
  holder: string;
  description: string;
}
export interface Intel extends Base {
  kind: "intel";
  category: "线索" | "人物" | "地点" | "其他";
  content: string;
  resolved: boolean;
}
export interface Artwork extends Base {
  kind: "art";
  url: string;
  caption: string;
  visibility?: "players" | "gm";
}
export interface Achievement extends Base {
  kind: "achievement";
  recipient: string;
  description: string;
  quality: (typeof QUALITIES)[number];
  url: string;
}
export const WELCOME_ACHIEVEMENT: Achievement = {
  kind: "achievement",
  id: "welcome-druskenvald",
  rev: "builtin-v1",
  updatedAt: 0,
  title: "欢迎来到德鲁斯肯瓦尔德",
  recipient: "团队",
  description: "来到德鲁斯肯瓦尔德",
  quality: "普通",
  url: "https://owlbear-twisted-moon.pages.dev/achievements/welcome.svg",
};
export type Entry = Item | Intel | Artwork | Achievement;
export type Draft =
  | (Omit<Item, keyof Base> & { title: string })
  | (Omit<Intel, keyof Base> & { title: string })
  | (Omit<Artwork, keyof Base> & { title: string })
  | (Omit<Achievement, keyof Base> & { title: string });
export interface Money {
  value: number;
  rev: string;
}
export interface Snapshot {
  privateArtStorage?: "browser" | "cloud";
  privateArtMessage?: string;
  storage?: import("./storage-router").StorageInfo;
  role: "GM" | "PLAYER";
  entries: Entry[];
  achievements: Achievement[];
  money: Record<Coin, Money>;
  shownId: string | null;
  ready: boolean;
  error: string;
  bytes: number;
}
export const moneyKey = (coin: Coin) => PREFIX + "money/" + coin;
export const DISPLAY_KEY = PREFIX + "display";
export function emptySnapshot(): Snapshot {
  return {
    role: "PLAYER",
    entries: [],
    achievements: [],
    money: Object.fromEntries(
      COINS.map((c) => [c, { value: 0, rev: "" }]),
    ) as Record<Coin, Money>,
    shownId: null,
    ready: false,
    error: "",
    bytes: 0,
  };
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("资料格式不正确");
  return value as Record<string, unknown>;
}
export function text(
  value: unknown,
  label: string,
  max: number,
  required = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw Error(`${label}${required ? "不能为空，且" : ""}最多 ${max} 字`);
  return value.trim();
}
export function integer(
  value: unknown,
  label: string,
  max = 999999999,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw Error(`${label}须为 0–${max} 的整数`);
  return value;
}
export function safeImageUrl(value: unknown, demo = false): string {
  const url = text(value, "图片地址", demo ? 1000000 : 2048, true);
  if (demo && /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(url))
    return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw Error("请输入有效的 HTTPS 图片地址");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw Error("图片须使用不含账号密码的 HTTPS 地址");
  return parsed.href;
}
export function validateEntry(value: unknown, demo = false): Entry {
  const d = object(value);
  if (typeof d.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(d.id))
    throw Error("资料编号无效");
  const base = {
    id: d.id,
    title: text(d.title, "标题", 80, true),
    rev: text(d.rev, "版本", 80, true),
    updatedAt: integer(d.updatedAt, "更新时间", Number.MAX_SAFE_INTEGER),
  };
  if (d.kind === "item") {
    if (d.category !== "道具" && d.category !== "装备")
      throw Error("请选择道具或装备");
    return {
      ...base,
      kind: "item",
      category: d.category,
      quantity: integer(d.quantity, "数量", 999999),
      holder: text(d.holder, "保管人", 60),
      description: text(d.description, "物品说明", 1200),
    };
  }
  if (d.kind === "intel") {
    if (
      !["线索", "人物", "地点", "其他"].includes(String(d.category)) ||
      typeof d.resolved !== "boolean"
    )
      throw Error("情报分类或进度无效");
    return {
      ...base,
      kind: "intel",
      category: d.category as Intel["category"],
      content: text(d.content, "情报正文", 5000, true),
      resolved: d.resolved,
    };
  }
  if (d.kind === "art") {
    if (
      d.visibility != null &&
      d.visibility !== "players" &&
      d.visibility !== "gm"
    )
      throw Error("插画可见性无效");
    return {
      ...base,
      kind: "art",
      url: safeImageUrl(d.url, demo),
      caption: text(d.caption, "插画说明", 1000),
      visibility: d.visibility === "gm" ? "gm" : "players",
    };
  }
  if (d.kind === "achievement") {
    if (!QUALITIES.includes(d.quality as Achievement["quality"]))
      throw Error("请选择成就品质");
    return {
      ...base,
      kind: "achievement",
      recipient: text(d.recipient, "达成人", 120, true),
      description: text(d.description, "描述", 1000, true),
      quality: d.quality as Achievement["quality"],
      url: safeImageUrl(d.url),
    };
  }
  throw Error("未知资料类型，未修改原数据");
}
export function metadataBytes(metadata: Metadata) {
  return new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
}
export function checkCapacity(metadata: Metadata) {
  if (metadataBytes(metadata) > 15500)
    throw Error(
      "房间共享资料空间不足。请缩短长说明或移除不用的条目；图片请使用图库引用。",
    );
}
// Compress each entry separately: room metadata has a shared 16 kB budget.
// Separate keys preserve unrelated entries and other extensions during edits.
export async function pack(entry: Entry): Promise<unknown> {
  const source = JSON.stringify(entry);
  if (typeof CompressionStream === "undefined" || source.length < 200)
    return entry;
  const data = new Uint8Array(
    await new Response(
      new Blob([source]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  const packed = { encoding: "gzip-v1", data: btoa(binary) };
  return metadataBytes(packed) < new TextEncoder().encode(source).byteLength
    ? packed
    : entry;
}
export async function unpack(raw: unknown): Promise<unknown> {
  const d = object(raw);
  if (!d.encoding) return d;
  if (
    d.encoding !== "gzip-v1" ||
    typeof d.data !== "string" ||
    d.data.length > 14000
  )
    throw Error("无法读取压缩资料，原数据已保留");
  const bytes = Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0));
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  let total = 0;
  const chunks: ArrayBuffer[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > 40000) throw Error("压缩资料超过安全读取长度");
      chunks.push(new Uint8Array(next.value).buffer);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(await new Blob(chunks).text());
}
export async function readSnapshot(
  metadata: Metadata,
  demo = false,
  includeWelcome = true,
): Promise<Snapshot> {
  const state = emptySnapshot();
  state.entries = (
    await Promise.all(
      Object.entries(metadata)
        .filter(
          ([key, value]) => key.startsWith(RECORD_PREFIX) && value != null,
        )
        .map(async ([key, value]) => {
          const entry = validateEntry(await unpack(value), demo);
          if (key !== RECORD_PREFIX + entry.id)
            throw Error("资料编号与存储位置不符，原数据已保留");
          return entry;
        }),
    )
  ).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  state.achievements = await Promise.all(
    Object.entries(metadata)
      .filter(
        ([key, value]) => key.startsWith(ACHIEVEMENT_PREFIX) && value != null,
      )
      .map(async ([key, value]) => {
        const entry = validateEntry(await unpack(value));
        if (
          entry.kind !== "achievement" ||
          key !== ACHIEVEMENT_PREFIX + entry.id
        )
          throw Error("成就格式或编号不正确，原数据已保留");
        return entry;
      }),
  );
  // Built-in welcome card needs no room write; an explicit tombstone removes it.
  if (
    includeWelcome &&
    !Object.hasOwn(metadata, ACHIEVEMENT_PREFIX + WELCOME_ACHIEVEMENT.id)
  )
    state.achievements.push({ ...WELCOME_ACHIEVEMENT });
  state.achievements.sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
  for (const coin of COINS) {
    const raw = metadata[moneyKey(coin)];
    if (raw != null) {
      const m = object(raw);
      state.money[coin] = {
        value: integer(m.value, COIN_LABELS[coin]),
        rev: text(m.rev, "版本", 80, true),
      };
    }
  }
  const display = metadata[DISPLAY_KEY];
  if (display != null) {
    const d = object(display);
    if (
      d.id != null &&
      (typeof d.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(d.id))
    )
      throw Error("展示资料格式不正确");
    state.shownId = typeof d.id === "string" ? d.id : null;
  }
  state.ready = true;
  state.bytes = metadataBytes(metadata);
  return state;
}
export function verifyRevision(
  current: { rev: string } | undefined,
  expected: string | undefined,
) {
  if (current?.rev !== expected)
    throw Error("这条资料已被队友修改或移除。请取消后重新打开，再核对并保存。");
}
export function validateFile(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("请选择 PNG、JPEG 或 WebP 图片");
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw Error("图片须小于 20 MB 且不能为空");
}
