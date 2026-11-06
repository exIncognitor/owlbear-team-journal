import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@owlbear-rodeo/sdk", () => ({ default: {} }));
import { TeamStore, type Driver, type Identity } from "./store";
import {
  COINS,
  RECORD_PREFIX,
  type Entry,
  type Metadata,
  type Coin,
  type Item,
  WELCOME_ACHIEVEMENT,
} from "./model";
import { readLocal, writeLocal, localKey } from "./local-records";

const potion = {
  kind: "item",
  title: "药水",
  category: "道具",
  quantity: 2,
  holder: "",
  description: "",
} as const;
const zero = () =>
  Object.fromEntries(COINS.map((c) => [c, 0])) as Record<Coin, number>;
function harness(
  role: Identity["role"] = "GM",
  roomId = "one",
  playerId = "dm",
  data: Metadata = {},
) {
  const driver: Driver = {
    ready: async () => {},
    identity: async () => ({ role, roomId, playerId }),
    read: async () => data,
    write: async (update) => {
      data = { ...data, ...update };
    },
    listen: () => () => {},
  };
  const store = new TeamStore(driver, false, () => ({
    read: () => [],
    write() {},
    listen: () => () => {},
  }));
  return { store, driver, data: () => data };
}
async function connect(store: TeamStore) {
  const stop = store.subscribe(() => {});
  await vi.waitFor(() => expect(store.state.ready).toBe(true));
  return stop;
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
it("bounds quick quantity changes and rejects a stale increment", async () => {
  const { store } = harness("PLAYER");
  const stop = await connect(store);
  await store.save(potion);
  const stale = store.state.entries[0];
  await store.adjustQuantity(stale, -1);
  expect((store.state.entries[0] as Item).quantity).toBe(1);
  await expect(store.adjustQuantity(stale, 1)).rejects.toThrow("队友修改");
  await store.adjustQuantity(store.state.entries[0], -1);
  expect(() => store.adjustQuantity(store.state.entries[0], -1)).toThrow(
    "数量",
  );
  stop();
});
it("records room transactions only locally and rejects overdrafts and stale balances", async () => {
  const { store, data } = harness("PLAYER");
  const stop = await connect(store);
  const stale = store.state.money;
  await store.transact({ ...zero(), gp: 20 }, stale, "报酬");
  expect(store.state.money.gp.value).toBe(20);
  expect(store.state.ledger[0]).toMatchObject({
    reason: "报酬",
    changes: { gp: 20 },
  });
  expect(JSON.stringify(data())).not.toContain("报酬");
  await expect(
    store.transact({ ...zero(), gp: 5 }, stale, "过期"),
  ).rejects.toThrow("队友修改");
  await expect(
    store.transact({ ...zero(), gp: -21 }, store.state.money, "超额"),
  ).rejects.toThrow("整数");
  await store.transact({ ...zero(), gp: -5 }, store.state.money, "补给", false);
  expect(store.state.money.gp.value).toBe(15);
  expect(store.state.ledger).toHaveLength(1);
  stop();
});
it("recovers locally deleted records without consuming room space or overwriting a replacement", async () => {
  const { store, driver, data } = harness("PLAYER");
  const stop = await connect(store);
  await store.save(potion);
  const saved = store.state.entries[0];
  await store.remove(saved);
  expect(data()[RECORD_PREFIX + saved.id]).toBeNull();
  const deleted = store.state.trash[0];
  await store.restore(deleted);
  expect(store.state.entries[0].title).toBe(saved.title);
  expect(store.state.trash).toHaveLength(0);
  await expect(store.restore(deleted)).rejects.toThrow();
  await store.remove(store.state.entries[0]);
  const latest = store.state.trash[0];
  await driver.write({
    [RECORD_PREFIX + saved.id]: {
      ...saved,
      title: "队友的新版",
      rev: "replacement",
    },
  });
  await expect(store.restore(latest)).rejects.toThrow();
  await store.refresh();
  expect(store.state.entries[0].title).toBe("队友的新版");
  stop();
});
it("does not delete shared data if saving its recovery copy fails", async () => {
  const { store } = harness();
  const stop = await connect(store);
  await store.save(potion);
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw Error("quota");
  });
  await expect(store.remove(store.state.entries[0])).rejects.toThrow(
    "本机保存失败",
  );
  expect(store.state.entries).toHaveLength(1);
  stop();
});
it("isolates local drafts and trash by room, account and role", async () => {
  const a = harness(),
    b = harness("GM", "two"),
    c = harness("PLAYER", "one", "dm"),
    d = harness("GM", "one", "other");
  const stops = await Promise.all([a, b, c, d].map((h) => connect(h.store)));
  writeLocal(a.store.localScope, "draft", { title: "DM 草稿" });
  await a.store.save(WELCOME_ACHIEVEMENT);
  await a.store.remove(a.store.state.achievements[0]);
  for (const h of [b, c, d]) {
    expect(readLocal(h.store.localScope, "draft", null)).toBeNull();
    expect(h.store.state.trash).toHaveLength(0);
    expect(localKey(h.store.localScope, "draft")).not.toBe(
      localKey(a.store.localScope, "draft"),
    );
  }
  await expect(c.store.restore(a.store.state.trash[0])).rejects.toThrow();
  stops.forEach((stop) => stop());
});
it("persists pinning and explicit order and keeps achievements DM-only", async () => {
  const { store } = harness();
  const stop = await connect(store);
  await store.save({ ...potion, title: "普通", order: 0 });
  await store.save({ ...potion, title: "置顶后", pinned: true, order: 10 });
  await store.save({ ...potion, title: "置顶前", pinned: true, order: 1 });
  await store.refresh();
  expect(store.state.entries.map((e) => e.title)).toEqual([
    "置顶前",
    "置顶后",
    "普通",
  ]);
  const player = harness("PLAYER");
  const stopPlayer = await connect(player.store);
  await expect(
    player.store.save({ ...WELCOME_ACHIEVEMENT, pinned: true, order: 1 }),
  ).rejects.toThrow("只有 DM");
  stop();
  stopPlayer();
});
