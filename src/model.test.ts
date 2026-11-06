import { expect, it } from "vitest";
import {
  checkCapacity,
  pack,
  readSnapshot,
  RECORD_PREFIX,
  ACHIEVEMENT_PREFIX,
  WELCOME_ACHIEVEMENT,
  COINS,
  COIN_LABELS,
  PREFIX,
  moneyKey,
  safeImageUrl,
  unpack,
  validateEntry,
  validateFile,
  type Intel,
} from "./model";
const note: Intel = {
  id: "n1",
  rev: "v1",
  updatedAt: 1,
  title: "旅途线索",
  kind: "intel",
  category: "线索",
  content: "我们记录下看见的事。".repeat(400),
  resolved: false,
};
it("reads four denominations and names platinum coins without exposing legacy EP", async () => {
  const state = await readSnapshot({
    [moneyKey("pp")]: { value: 3, rev: "platinum" },
    [PREFIX + "money/ep"]: { value: 7, rev: "legacy" },
  });
  expect(COINS).toEqual(["pp", "gp", "sp", "cp"]);
  expect(COINS.map((coin) => COIN_LABELS[coin])).toEqual([
    "铂金币",
    "金币",
    "银币",
    "铜币",
  ]);
  expect(Object.keys(state.money)).toEqual(["pp", "gp", "sp", "cp"]);
  expect(state.money.pp.value).toBe(3);
});
it("only shows explicitly saved room achievements and keeps the welcome sample opt-in", async () => {
  expect((await readSnapshot({})).achievements).toEqual([]);
  expect((await readSnapshot({}, true, true)).achievements).toEqual([
    WELCOME_ACHIEVEMENT,
  ]);
  const key = ACHIEVEMENT_PREFIX + WELCOME_ACHIEVEMENT.id;
  const saved = {
    ...WELCOME_ACHIEVEMENT,
    description: "已经保存的欢迎成就",
    rev: "saved",
  };
  expect((await readSnapshot({ [key]: saved })).achievements).toEqual([saved]);
  expect(
    (await readSnapshot({ [key]: null }, true, true)).achievements,
  ).toEqual([]);
});
it("roundtrips compressed Chinese records under the shared budget", async () => {
  const packed = await pack(note);
  expect(JSON.stringify(packed).length).toBeLessThan(
    JSON.stringify(note).length / 2,
  );
  expect(await unpack(packed)).toEqual(note);
  expect(
    (await readSnapshot({ [RECORD_PREFIX + note.id]: packed })).entries[0],
  ).toEqual(note);
});
it("validates URLs and only allows demo raster data in local mode", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://example.com/a.png",
    "https://user:pass@example.com/a.png",
    "data:image/svg+xml,<svg/>",
  ]) {
    expect(() => safeImageUrl(url)).toThrow();
  }
  expect(() => safeImageUrl("data:image/png;base64,AAAA")).toThrow();
  expect(safeImageUrl("data:image/png;base64,AAAA", true)).toContain(
    "data:image/png",
  );
  expect(safeImageUrl("https://images.example.org/a.png")).toContain(
    "https://",
  );
});
it("rejects unsafe numbers and strips fields outside the schema", () => {
  const item = {
    id: "i1",
    title: "药水",
    kind: "item",
    category: "道具",
    quantity: 2,
    holder: "",
    description: "",
    rev: "v1",
    updatedAt: 1,
    secret: "discard",
  };
  expect(validateEntry(item)).not.toHaveProperty("secret");
  for (const quantity of [-1, 1.5, NaN, Infinity, 1000000])
    expect(() => validateEntry({ ...item, quantity })).toThrow();
  expect(() => validateEntry({ ...item, title: " " })).toThrow();
  expect(() =>
    validateEntry({ ...item, description: "长".repeat(1201) }),
  ).toThrow();
});
it("fails closed on unsupported/corrupt records and identifier mismatches", async () => {
  await expect(
    readSnapshot({ [RECORD_PREFIX + "wrong"]: note }),
  ).rejects.toThrow();
  await expect(
    unpack({ encoding: "future", data: "whatever" }),
  ).rejects.toThrow();
  await expect(unpack({ encoding: "gzip-v1", data: "bad" })).rejects.toThrow();
});
it("bounds decompression before accepting data", async () => {
  const raw = await pack({ ...note, content: "x".repeat(50000) });
  await expect(unpack(raw)).rejects.toThrow("超过安全读取长度");
});
it("checks the entire room budget, including other extensions", () => {
  expect(() => checkCapacity({ other: "x".repeat(15000) })).not.toThrow();
  expect(() => checkCapacity({ other: "中".repeat(5200) })).toThrow("空间不足");
});
it("validates image size and type before asset interaction", () => {
  expect(() =>
    validateFile(new File(["x"], "a.svg", { type: "image/svg+xml" })),
  ).toThrow();
  expect(() =>
    validateFile(new File([], "a.png", { type: "image/png" })),
  ).toThrow();
  expect(() =>
    validateFile(new File(["png"], "a.png", { type: "image/png" })),
  ).not.toThrow();
});
