import { beforeEach, expect, it, vi } from "vitest";
const assets = vi.hoisted(() => ({
  upload: vi.fn(async () => {}),
  pick: vi.fn(async () => [] as any[]),
}));
vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    isAvailable: true,
    assets: { uploadImages: assets.upload, downloadImages: assets.pick },
  },
  buildImageUpload: (file: File) => ({ build: () => ({ file }) }),
}));
import { TeamStore, type Driver } from "./store";
import {
  COINS,
  DISPLAY_KEY,
  RECORD_PREFIX,
  moneyKey,
  type Draft,
  type Entry,
  type Metadata,
} from "./model";
function hub(initial: Metadata = {}) {
  let metadata = initial;
  const listeners = new Set<(data: Metadata) => void>();
  const write = vi.fn(async (update: Metadata) => {
    metadata = { ...metadata, ...update };
    listeners.forEach((fn) => fn(metadata));
  });
  const driver: Driver = {
    ready: async () => {},
    read: async () => metadata,
    write,
    listen: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return {
    driver,
    write,
    get: () => metadata,
    push: (data: Metadata) => {
      metadata = data;
      listeners.forEach((fn) => fn(data));
    },
  };
}
const item: Draft = {
  kind: "item",
  title: "药水",
  category: "道具",
  quantity: 2,
  holder: "团队",
  description: "共享补给",
};
async function connect(store: TeamStore) {
  const stop = store.subscribe(() => {});
  await vi.waitFor(() => expect(store.state.ready).toBe(true));
  return stop;
}
beforeEach(() => {
  vi.clearAllMocks();
  assets.upload.mockResolvedValue();
  assets.pick.mockResolvedValue([]);
});
it("lets two clients edit shared data without touching unrelated metadata or requiring a scene", async () => {
  const room = hub({ "another.plugin": { keep: true } }),
    player = new TeamStore(room.driver),
    dm = new TeamStore(room.driver);
  const stop1 = await connect(player),
    stop2 = await connect(dm);
  await player.save(item);
  await vi.waitFor(() => expect(dm.state.entries).toHaveLength(1));
  await dm.save(
    { ...item, title: "共享药水", quantity: 5 },
    dm.state.entries[0],
  );
  await vi.waitFor(() =>
    expect(player.state.entries[0].title).toBe("共享药水"),
  );
  expect(room.get()["another.plugin"]).toEqual({ keep: true });
  stop1();
  stop2();
});
it("preserves different records when two clients add concurrently", async () => {
  const room = hub(),
    a = new TeamStore(room.driver),
    b = new TeamStore(room.driver);
  const s1 = await connect(a),
    s2 = await connect(b);
  await Promise.all([
    a.save({ ...item, title: "A" }),
    b.save({ ...item, title: "B" }),
  ]);
  await vi.waitFor(() => expect(a.state.entries).toHaveLength(2));
  expect(a.state.entries.map((e) => e.title).sort()).toEqual(["A", "B"]);
  s1();
  s2();
});
it("rejects a stale editor after another client edits or removes its record", async () => {
  const room = hub(),
    store = new TeamStore(room.driver);
  const stop = await connect(store);
  await store.save(item);
  const stale = store.state.entries[0];
  await store.save({ ...item, title: "新版" }, stale);
  await expect(
    store.save({ ...item, title: "旧版覆盖" }, stale),
  ).rejects.toThrow("队友修改");
  await expect(store.remove(stale)).rejects.toThrow("队友修改");
  expect(store.state.entries[0].title).toBe("新版");
  stop();
});
it("changes only edited denominations and detects a conflicting money edit", async () => {
  const room = hub(),
    store = new TeamStore(room.driver);
  const stop = await connect(store);
  const base = structuredClone(store.state.money);
  const values = Object.fromEntries(COINS.map((c) => [c, 0])) as any;
  await store.money({ ...values, gp: 20 }, base);
  await expect(store.money({ ...values, gp: 30 }, base)).rejects.toThrow(
    "金钱已被队友",
  );
  await store.money({ ...values, sp: 50 }, base);
  expect(store.state.money.gp.value).toBe(20);
  expect(store.state.money.sp.value).toBe(50);
  expect(room.get()[moneyKey("gp")]).toMatchObject({ value: 20 });
  stop();
});
it("clears shared presentation when its artwork is removed and preserves the asset URL in backup before removal", async () => {
  const room = hub(),
    store = new TeamStore(room.driver);
  const stop = await connect(store);
  await store.save({
    kind: "art",
    title: "风景",
    url: "https://images.example.org/a.png",
    caption: "",
  });
  const art = store.state.entries[0];
  await store.show(art.id);
  expect(store.state.shownId).toBe(art.id);
  expect(await store.backup()).toContain("https://images.example.org/a.png");
  await store.remove(art);
  expect(store.state.shownId).toBeNull();
  expect(room.get()[DISPLAY_KEY]).toEqual({ id: null });
  expect(room.get()[RECORD_PREFIX + art.id]).toBeNull();
  stop();
});
it("blocks quota overflow before any SDK write", async () => {
  const room = hub({ other: "x".repeat(15480) }),
    store = new TeamStore(room.driver);
  const stop = await connect(store);
  await expect(store.save(item)).rejects.toThrow("空间不足");
  expect(room.write).not.toHaveBeenCalled();
  stop();
});
it("does not report a failed write as saved", async () => {
  const room = hub(),
    store = new TeamStore(room.driver);
  const stop = await connect(store);
  room.write.mockRejectedValueOnce(Error("Permission denied"));
  await expect(store.save(item)).rejects.toThrow("Permission denied");
  expect(store.state.entries).toHaveLength(0);
  stop();
});
it("preserves unreadable metadata for export and disables editing", async () => {
  const room = hub({
      [RECORD_PREFIX + "bad"]: { version: 99, valuable: "原资料" },
    }),
    store = new TeamStore(room.driver);
  const stop = store.subscribe(() => {});
  await vi.waitFor(() => expect(store.state.error).not.toBe(""));
  expect(store.state.ready).toBe(false);
  expect(await store.backup()).toContain("原资料");
  await expect(store.save(item)).rejects.toThrow("尚未连接");
  stop();
});
it("keeps a subscription update newer than a delayed initial read", async () => {
  const room = hub();
  let release!: (v: Metadata) => void;
  const original = room.driver.read;
  room.driver.read = vi
    .fn()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    )
    .mockImplementation(original);
  const store = new TeamStore(room.driver);
  const stop = store.subscribe(() => {});
  await vi.waitFor(() => expect(room.driver.read).toHaveBeenCalled());
  room.push({ [moneyKey("gp")]: { value: 80, rev: "new" } });
  await vi.waitFor(() => expect(store.state.money.gp.value).toBe(80));
  release({});
  await Promise.resolve();
  expect(store.state.money.gp.value).toBe(80);
  stop();
});
it("does not retain a subscription after unmounting before readiness", async () => {
  const room = hub();
  let ready!: () => void;
  room.driver.ready = () =>
    new Promise<void>((r) => {
      ready = r;
    });
  const listen = vi.spyOn(room.driver, "listen");
  const store = new TeamStore(room.driver);
  const stop = store.subscribe(() => {});
  stop();
  ready();
  await Promise.resolve();
  expect(listen).not.toHaveBeenCalled();
});
it("uploads through the official assets API and selects an actual persistent URL", async () => {
  assets.pick.mockResolvedValueOnce([
    {
      name: "月下风景",
      image: { url: "https://images.example.org/uploaded.webp" },
    },
  ]);
  const room = hub(),
    store = new TeamStore(room.driver);
  const file = new File(["image"], "moon.png", { type: "image/png" });
  expect(await store.upload(file)).toEqual({
    title: "月下风景",
    url: "https://images.example.org/uploaded.webp",
  });
  expect(assets.upload).toHaveBeenCalledOnce();
  expect(assets.pick).toHaveBeenCalledWith(false, "moon", "PROP");
  expect(room.write).not.toHaveBeenCalled();
});
it("does not create a fake gallery entry when asset selection is cancelled", async () => {
  const room = hub(),
    store = new TeamStore(room.driver);
  expect(await store.pick()).toBeNull();
  expect(room.write).not.toHaveBeenCalled();
});
it("prevents binary/data URLs from entering real room storage", async () => {
  const room = hub(),
    store = new TeamStore(room.driver);
  const stop = await connect(store);
  expect(() =>
    store.save({
      kind: "art",
      title: "bad",
      url: "data:image/png;base64,AAAA",
      caption: "",
    }),
  ).toThrow();
  expect(room.write).not.toHaveBeenCalled();
  stop();
});
