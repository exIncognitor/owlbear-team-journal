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
}));
import { TeamStore, type Driver, type Identity } from "./store";
import type { PrivateArtVault } from "./private-art";
import {
  COINS,
  ACHIEVEMENT_PREFIX,
  WELCOME_ACHIEVEMENT,
  DISPLAY_KEY,
  RECORD_PREFIX,
  moneyKey,
  type Draft,
  type Entry,
  type Metadata,
  type Artwork,
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
it("opens the official gallery directly without uploading a local file", async () => {
  assets.pick.mockResolvedValueOnce([
    {
      name: "月下风景",
      image: { url: "https://images.example.org/uploaded.webp" },
    },
  ]);
  const room = hub(),
    store = new TeamStore(room.driver);
  expect(await store.pick()).toEqual({
    title: "月下风景",
    url: "https://images.example.org/uploaded.webp",
  });
  expect(assets.upload).not.toHaveBeenCalled();
  expect(assets.pick).toHaveBeenCalledWith(false, undefined, "CHARACTER");
  expect(room.write).not.toHaveBeenCalled();
});
it("reports all room metadata as UTF-8 bytes and updates when another plugin writes", async () => {
  const room = hub({ "another.plugin": { note: "中文内容🌙" } });
  const store = new TeamStore(room.driver);
  const stop = await connect(store);
  const size = () =>
    new TextEncoder().encode(JSON.stringify(room.get())).byteLength;
  expect(store.state.bytes).toBe(size());
  expect(store.state.bytes).toBeGreaterThan(JSON.stringify(room.get()).length);
  await store.save(item);
  expect(store.state.bytes).toBe(size());
  room.push({
    ...room.get(),
    "another.plugin": { note: "更长的共享资料".repeat(30) },
  });
  await vi.waitFor(() => expect(store.state.bytes).toBe(size()));
  stop();
});
it("does not create a fake gallery entry when asset selection is cancelled", async () => {
  const room = hub(),
    store = new TeamStore(room.driver);
  expect(await store.pick()).toBeNull();
  expect(room.write).not.toHaveBeenCalled();
});
it("omits blank gallery searches and preserves nonempty searches", async () => {
  const store = new TeamStore(hub().driver);
  await store.pick("   ");
  expect(assets.pick).toHaveBeenLastCalledWith(false, undefined, "CHARACTER");
  await store.pick("  芙蕾雅  ");
  expect(assets.pick).toHaveBeenLastCalledWith(false, "芙蕾雅", "CHARACTER");
});
it("reports plain-object picker failures and permits a later retry without writing room data", async () => {
  const room = hub(),
    store = new TeamStore(room.driver);
  assets.pick.mockRejectedValueOnce({
    error: {
      name: "ValidationError",
      message: '"defaultSearch" is not allowed to be empty',
    },
  });
  await expect(store.pick()).rejects.toThrow(
    '无法打开 Owlbear 图库："defaultSearch" is not allowed to be empty',
  );
  expect(room.write).not.toHaveBeenCalled();
  assets.pick.mockResolvedValueOnce([
    {
      name: "重试图片",
      image: { url: "https://images.example.org/retry.png" },
    },
  ]);
  expect(await store.pick()).toEqual({
    title: "重试图片",
    url: "https://images.example.org/retry.png",
  });
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

function privateRoom(initial: Metadata = {}) {
  const room = hub(initial);
  let role: Identity["role"] = "GM";
  let changed: ((identity: Identity) => void) | undefined;
  const identity = async (): Promise<Identity> => ({
    role,
    roomId: "test-room",
    playerId: "dm",
  });
  const driver: Driver = {
    ...room.driver,
    identity,
    listenIdentity: (fn) => {
      changed = fn;
      return () => {
        changed = undefined;
      };
    },
  };
  let records: Artwork[] = [];
  const vault: PrivateArtVault = {
    read: () => structuredClone(records),
    write: (entries) => {
      records = structuredClone(entries);
    },
    listen: () => () => {},
  };
  const gm = new TeamStore(driver, false, () => vault);
  return {
    room,
    gm,
    vault,
    demote: () => {
      role = "PLAYER";
      void identity().then((value) => changed?.(value));
    },
  };
}
const privateArt: Draft = {
  kind: "art",
  title: "尚未揭晓的地点",
  url: "https://images.example.org/secret.png",
  caption: "DM 专用说明",
  visibility: "gm",
};

it("keeps private artwork entirely out of shared metadata and rejects player/private presentation writes", async () => {
  const { room, gm, vault } = privateRoom();
  const player = new TeamStore(room.driver);
  const stop1 = await connect(gm),
    stop2 = await connect(player);
  await gm.save(privateArt);
  expect(vault.read()).toHaveLength(1);
  expect(gm.state.entries).toHaveLength(1);
  expect(player.state.entries).toHaveLength(0);
  expect(room.write).not.toHaveBeenCalled();
  expect(JSON.stringify(room.get())).not.toContain("secret.png");
  await expect(gm.show(gm.state.entries[0].id)).rejects.toThrow(
    "先将插画设为玩家可见",
  );
  await expect(player.save(privateArt)).rejects.toThrow("只有 DM");
  stop1();
  stop2();
});
it("publishes private artwork and hides it again, clearing the shared presentation", async () => {
  const { room, gm, vault } = privateRoom();
  const player = new TeamStore(room.driver);
  const stop1 = await connect(gm),
    stop2 = await connect(player);
  await gm.save(privateArt);
  let art = gm.state.entries[0] as Artwork;
  await gm.save({ ...art, visibility: "players" }, art);
  art = gm.state.entries[0] as Artwork;
  await vi.waitFor(() => expect(player.state.entries).toHaveLength(1));
  expect(vault.read()).toHaveLength(0);
  await gm.show(art.id);
  await gm.save({ ...art, visibility: "gm" }, art);
  await vi.waitFor(() => expect(player.state.entries).toHaveLength(0));
  expect(player.state.shownId).toBeNull();
  expect(vault.read()).toHaveLength(1);
  expect(JSON.stringify(room.get())).not.toContain("secret.png");
  stop1();
  stop2();
});
it("retains a private copy when a hide fails and keeps the still-shared record marked public", async () => {
  const { room, gm, vault } = privateRoom();
  const stop = await connect(gm);
  await gm.save({ ...privateArt, visibility: "players" });
  const art = gm.state.entries[0] as Artwork;
  room.write.mockRejectedValueOnce(Error("offline"));
  await expect(gm.save({ ...art, visibility: "gm" }, art)).rejects.toThrow(
    "offline",
  );
  expect((gm.state.entries[0] as Artwork).visibility).toBe("players");
  expect(vault.read()).toHaveLength(1);
  expect(JSON.stringify(room.get())).toContain("secret.png");
  // Re-read after an unacknowledged write really reached the room: private copy survives.
  room.push({ [RECORD_PREFIX + art.id]: null });
  await vi.waitFor(() =>
    expect((gm.state.entries[0] as Artwork).visibility).toBe("gm"),
  );
  stop();
});
it("never removes a shared image if local storage fails, or a private image when publication exceeds quota", async () => {
  const { room, gm, vault } = privateRoom();
  const stop = await connect(gm);
  await gm.save({ ...privateArt, visibility: "players" });
  const art = gm.state.entries[0] as Artwork;
  const write = vi.spyOn(vault, "write").mockImplementationOnce(() => {
    throw Error("local full");
  });
  room.write.mockClear();
  await expect(gm.save({ ...art, visibility: "gm" }, art)).rejects.toThrow(
    "local full",
  );
  expect(room.write).not.toHaveBeenCalled();
  write.mockRestore();
  await gm.save({ ...art, visibility: "gm" }, art);
  room.push({ ...room.get(), other: "x".repeat(15480) });
  await vi.waitFor(() => expect(gm.state.bytes).toBeGreaterThan(15480));
  const hidden = gm.state.entries[0] as Artwork;
  await expect(
    gm.save({ ...hidden, visibility: "players" }, hidden),
  ).rejects.toThrow("空间不足");
  expect(vault.read()).toHaveLength(1);
  expect((gm.state.entries[0] as Artwork).visibility).toBe("gm");
  stop();
});
it("drops private records on demotion and rejects an old GM editor without deleting local data", async () => {
  const { gm, vault, demote } = privateRoom();
  const stop = await connect(gm);
  await gm.save(privateArt);
  const stale = gm.state.entries[0] as Artwork;
  demote();
  await vi.waitFor(() => expect(gm.state.role).toBe("PLAYER"));
  expect(gm.state.entries).toHaveLength(0);
  await expect(
    gm.save({ ...stale, visibility: "players" }, stale),
  ).rejects.toThrow("队友修改或移除");
  expect(vault.read()).toHaveLength(1);
  stop();
});

it("shares saved achievements within their room and only permits the GM to edit or remove them", async () => {
  const { room, gm } = privateRoom();
  const player = new TeamStore(room.driver);
  const stop1 = await connect(gm),
    stop2 = await connect(player);
  expect(player.state.achievements).toEqual([]);
  expect(room.write).not.toHaveBeenCalled();
  await gm.save(WELCOME_ACHIEVEMENT);
  await vi.waitFor(() => expect(player.state.achievements).toHaveLength(1));
  const saved = gm.state.achievements[0];
  await expect(
    player.save({ ...WELCOME_ACHIEVEMENT, description: "篡改" }, saved),
  ).rejects.toThrow("只有 DM");
  await expect(player.remove(saved)).rejects.toThrow("只有 DM");
  // Changing the client-supplied kind cannot bypass the achievement guard.
  await expect(player.save(item, saved)).rejects.toThrow("只有 DM");
  await gm.save(
    {
      ...WELCOME_ACHIEVEMENT,
      description: "团队抵达了新的旅程",
      quality: "稀有",
    },
    saved,
  );
  await vi.waitFor(() =>
    expect(player.state.achievements[0].quality).toBe("稀有"),
  );
  expect(player.state.achievements[0].description).toBe("团队抵达了新的旅程");
  await gm.remove(gm.state.achievements[0]);
  await vi.waitFor(() => expect(player.state.achievements).toHaveLength(0));
  expect(room.get()[ACHIEVEMENT_PREFIX + saved.id]).toBeNull();
  await player.refresh();
  expect(player.state.achievements).toHaveLength(0);
  stop1();
  stop2();
});
it("keeps a new real room empty and preserves saved achievements when reopening the original room", async () => {
  const a = privateRoom();
  const stopA = await connect(a.gm);
  await a.gm.save(WELCOME_ACHIEVEMENT);
  const saved = a.gm.state.achievements[0];
  const b = privateRoom();
  const stopB = await connect(b.gm);
  expect(b.gm.state.achievements).toEqual([]);
  expect(b.room.write).not.toHaveBeenCalled();
  const reopened = new TeamStore(a.room.driver);
  const stopReopened = await connect(reopened);
  expect(reopened.state.achievements).toEqual([saved]);
  stopA();
  stopB();
  stopReopened();
});
