import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("@owlbear-rodeo/sdk", () => ({ default: {} }));
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import {
  adminHeaders,
  cloudRequest,
  SELECTION_KEY,
  type CloudProfile,
} from "./cloud-protocol";
import { StorageRouter } from "./storage-router";
import { TeamStore, type Driver } from "./store";
import { BrowserArtVault, CloudArtVault } from "./private-art";
import {
  RECORD_PREFIX,
  WELCOME_ACHIEVEMENT,
  ACHIEVEMENT_PREFIX,
  PREFIX,
  type Metadata,
  type Draft,
  type Artwork,
} from "./model";
let mf: Miniflare, endpoint: string, profile: CloudProfile;
const stops: (() => void)[] = [];
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    clear: () => values.clear(),
    removeItem: (key: string) => {
      values.delete(key);
    },
  } as Storage;
}
const browserStorage = memoryStorage();
beforeAll(async () => {
  vi.stubGlobal("localStorage", browserStorage);
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pub = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const bundle = await build({
    entryPoints: ["server/worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    plugins: [
      {
        name: "test-public-key",
        setup(api) {
          api.onLoad({ filter: /admin-public\.json$/ }, () => ({
            contents: JSON.stringify(pub),
            loader: "json",
          }));
        },
      },
    ],
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-11-05",
      d1Databases: ["DB"],
    }),
  );
  endpoint = (await mf.ready).origin + "/api";
  profile = {
    id: "test-cloud",
    name: "测试 D1",
    endpoint,
    privateKey: await crypto.subtle.exportKey("jwk", keys.privateKey),
  };
}, 30000);
afterAll(async () => {
  stops.forEach((stop) => stop());
  await mf?.dispose();
  vi.unstubAllGlobals();
});
function room(id: string, initial: Metadata = {}) {
  let data = initial;
  const listeners = new Set<(data: Metadata) => void>();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } as Storage;
  const driver: Driver = {
    ready: async () => {},
    identity: async () => ({ role: "GM", roomId: id, playerId: "dm" }),
    read: async () => data,
    write: async (update) => {
      data = { ...data, ...update };
      listeners.forEach((fn) => fn(data));
    },
    listen: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const router = new StorageRouter(driver, storage);
  const vaults = new Map<string, Artwork[]>();
  const store = new TeamStore(router, false, (identity) => ({
    read: () => structuredClone(vaults.get(identity.roomId) ?? []),
    write: (entries) => {
      vaults.set(identity.roomId, structuredClone(entries));
    },
    listen: () => () => {},
  }));
  return { router, store, driver, data: () => data };
}
async function connect(store: TeamStore) {
  stops.push(store.subscribe(() => {}));
  await expect.poll(() => store.state.ready).toBe(true);
}
const potion: Draft = {
  kind: "item",
  title: "药水",
  category: "道具",
  quantity: 1,
  holder: "",
  description: "",
};
it("rejects unsigned admin access and replays, and restricts member tokens to their room and public records", async () => {
  const blocked = await fetch(endpoint + "/admin/libraries");
  expect(blocked.status).toBe(403);
  expect(
    (await fetch(endpoint + "/libraries/unknown/state?room=unknown")).status,
  ).toBe(403);
  const url = new URL(endpoint + "/admin/libraries"),
    headers = await adminHeaders(profile.privateKey, "GET", url, "");
  expect((await fetch(url, { headers })).status).toBe(200);
  expect((await fetch(url, { headers })).status).toBe(409);
  const library = await cloudRequest(
    endpoint,
    "/admin/libraries",
    "POST",
    { name: "权限测试" },
    profile,
  );
  const binding = await cloudRequest(
    endpoint,
    `/admin/libraries/${library.id}/activate`,
    "POST",
    { roomId: "permission-room" },
    profile,
  );
  const dataUrl =
    endpoint + `/libraries/${library.id}/state?room=permission-room`;
  const forbidden = await fetch(dataUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${binding.token}`,
    },
    body: JSON.stringify({
      revision: 0,
      update: {
        [ACHIEVEMENT_PREFIX + WELCOME_ACHIEVEMENT.id]: WELCOME_ACHIEVEMENT,
      },
    }),
  });
  expect(forbidden.status).toBe(403);
  expect(
    (
      await fetch(dataUrl.replace("permission-room", "another-room"), {
        headers: { Authorization: `Bearer ${binding.token}` },
      })
    ).status,
  ).toBe(403);
});
it("switches only one room, retains both datasets and original room metadata, and never shares the admin key", async () => {
  const a = room("room-a", { other: { keep: true } }),
    b = room("room-b");
  await connect(a.store);
  await connect(b.store);
  await a.router.saveProfile(profile);
  await a.store.save({ ...potion, title: "原房间药水" });
  const local = JSON.stringify(a.data());
  const library = await a.router.createLibrary(profile, "长期团 A");
  await a.store.selectStorage(profile, library);
  expect(a.store.state.entries).toHaveLength(0);
  expect(a.store.state.achievements).toHaveLength(0);
  expect(b.store.state.storage?.mode).toBe("room");
  await a.store.save({ ...potion, title: "云端药水" });
  expect(JSON.stringify(a.data())).not.toContain("云端药水");
  expect(JSON.stringify(a.data())).not.toContain(profile.privateKey.d!);
  expect(a.data().other).toEqual({ keep: true });
  const stale = await a.router.read();
  await a.store.selectStorage();
  expect(a.store.state.entries[0].title).toBe("原房间药水");
  await expect(a.router.write({}, stale)).rejects.toThrow("资料库已切换");
  expect(a.data()[SELECTION_KEY]).toMatchObject({
    mode: "room",
    roomId: "room-a",
  });
  await a.store.selectStorage(profile, library);
  expect(a.store.state.entries[0].title).toBe("云端药水");
  expect(local).toContain("原房间药水");
});
it("copies to an empty cloud library, preserves its source, and refuses overwriting existing target data", async () => {
  const legacyKey = PREFIX + "money/ep";
  const legacyBalance = { value: 7, rev: "legacy" };
  const a = room("copy-room", { [legacyKey]: legacyBalance });
  await connect(a.store);
  await a.router.saveProfile(profile);
  await a.store.save(potion);
  const lib = await a.router.createLibrary(profile, "迁移目标");
  await a.store.copyStorage(profile, lib);
  expect(a.store.state.storage?.mode).toBe("room");
  expect(a.store.state.entries[0].title).toBe("药水");
  await expect(a.store.copyStorage(profile, lib)).rejects.toThrow("已有资料");
  await a.store.selectStorage(profile, lib);
  expect(a.store.state.entries[0].title).toBe("药水");
  expect(a.store.state.achievements).toEqual([]);
  expect((await a.router.read())[legacyKey]).toEqual(legacyBalance);
  expect(a.data()[legacyKey]).toEqual(legacyBalance);
  await expect(a.store.copyStorage()).rejects.toThrow("原资料仍保留");
  const target = room("copy-legacy-currency-target");
  await connect(target.store);
  await target.router.saveProfile(profile);
  await target.store.selectStorage(profile, lib);
  await target.store.copyStorage();
  expect(target.data()[legacyKey]).toEqual(legacyBalance);
});
it("copies actual saved achievements and deletion markers without inventing a welcome card", async () => {
  const a = room("copy-saved-achievements");
  await connect(a.store);
  await a.router.saveProfile(profile);
  await a.store.save(WELCOME_ACHIEVEMENT);
  const saved = a.store.state.achievements[0];
  await a.driver.write({ [ACHIEVEMENT_PREFIX + "welcome-druskenvald"]: null });
  const lib = await a.router.createLibrary(profile, "已保存成就复制目标");
  await a.store.copyStorage(profile, lib);
  await a.store.selectStorage(profile, lib);
  expect(a.store.state.achievements).toEqual([saved]);
  expect(
    (await a.router.read())[ACHIEVEMENT_PREFIX + "welcome-druskenvald"],
  ).toBeNull();
});
it("rejects stale cloud revisions atomically and never partially overwrites another writer", async () => {
  const lib = await cloudRequest(
    endpoint,
    "/admin/libraries",
    "POST",
    { name: "冲突测试" },
    profile,
  );
  const value = { ...potion, id: "one", rev: "r1", updatedAt: 1 };
  await cloudRequest(
    endpoint,
    `/admin/libraries/${lib.id}/state`,
    "POST",
    { revision: 0, update: { [RECORD_PREFIX + "one"]: value } },
    profile,
  );
  await expect(
    cloudRequest(
      endpoint,
      `/admin/libraries/${lib.id}/state`,
      "POST",
      {
        revision: 0,
        update: {
          [RECORD_PREFIX + "one"]: { ...value, title: "旧窗口覆盖" },
          [RECORD_PREFIX + "two"]: { ...value, id: "two" },
        },
      },
      profile,
    ),
  ).rejects.toThrow("队友修改");
  const state = await cloudRequest(
    endpoint,
    `/admin/libraries/${lib.id}/state`,
    "GET",
    undefined,
    profile,
  );
  expect(state.metadata[RECORD_PREFIX + "one"].title).toBe("药水");
  expect(state.metadata[RECORD_PREFIX + "two"]).toBeUndefined();
});
it("isolates DM local private artwork between room storage and different cloud libraries", async () => {
  const a = room("private-scope-room");
  await connect(a.store);
  await a.router.saveProfile(profile);
  await a.store.save({
    kind: "art",
    title: "房间私密图",
    url: "https://images.example.org/room.png",
    caption: "",
    visibility: "gm",
  });
  const libA = await a.router.createLibrary(profile, "私密隔离 A"),
    libB = await a.router.createLibrary(profile, "私密隔离 B");
  await a.store.selectStorage(profile, libA);
  expect(a.store.state.entries).toHaveLength(0);
  await a.store.save({
    kind: "art",
    title: "A 库私密图",
    url: "https://images.example.org/a.png",
    caption: "",
    visibility: "gm",
  });
  await a.store.selectStorage(profile, libB);
  expect(a.store.state.entries).toHaveLength(0);
  await a.store.selectStorage(profile, libA);
  expect(a.store.state.entries[0].title).toBe("A 库私密图");
  await a.store.selectStorage();
  expect(a.store.state.entries[0].title).toBe("房间私密图");
  expect(JSON.stringify(a.data())).not.toContain("私密图");
});
it("uses the reserved room margin for cloud configuration when ordinary records are already near their budget", async () => {
  const a = room("nearly-full-room", { other: "x".repeat(15400) });
  await connect(a.store);
  await a.router.saveProfile(profile);
  const lib = await a.router.createLibrary(profile, "扩容目标");
  await a.store.selectStorage(profile, lib);
  expect(a.store.state.storage?.mode).toBe("cloud");
  expect(a.store.state.storage!.roomBytes).toBeLessThanOrEqual(15900);
  await a.store.save(potion);
  expect(a.store.state.entries[0].title).toBe("药水");
});
it("allows cloud datasets above 16 kB and rejects copying them into an undersized room without changing either source", async () => {
  const a = room("large-room", { other: "x".repeat(12000) });
  await connect(a.store);
  await a.router.saveProfile(profile);
  const lib = await a.router.createLibrary(profile, "大型资料库");
  await a.store.selectStorage(profile, lib);
  for (let index = 0; index < 5; index++)
    await a.store.save({
      kind: "intel",
      title: `长篇情报 ${index}`,
      category: "线索",
      content: Array.from({ length: 140 }, () => crypto.randomUUID())
        .join("")
        .slice(0, 4900),
      resolved: false,
    });
  expect(a.store.state.bytes).toBeGreaterThan(16000);
  const before = JSON.stringify(a.data());
  await expect(a.store.copyStorage()).rejects.toThrow("空间不足");
  expect(JSON.stringify(a.data())).toBe(before);
  expect(a.store.state.entries).toHaveLength(5);
}, 15000);

const hiddenArt: Draft = {
  kind: "art",
  title: "云端秘密",
  url: "https://images.example.org/cloud-secret.png",
  caption: "未公开说明",
  visibility: "gm",
};
async function privateCloud(id: string) {
  const source = room(id),
    router = new StorageRouter(source.driver, browserStorage);
  const store = new TeamStore(router);
  await connect(store);
  await router.saveProfile(profile);
  const lib = await router.createLibrary(profile, id);
  return { ...source, router, store, lib };
}
it("stores private artwork in D1, isolates room/library/owner, and restores it after clearing browser storage and reimporting management", async () => {
  const a = await privateCloud("cloud-private-restore");
  await a.store.save({ ...hiddenArt, title: "房间本机图" });
  await a.store.selectStorage(profile, a.lib);
  await a.store.save(hiddenArt);
  expect(a.store.state.privateArtStorage).toBe("cloud");
  const art = a.store.state.entries[0] as Artwork;
  expect(JSON.stringify(a.data())).not.toContain("cloud-secret");
  const path = `/admin/libraries/${a.lib.id}/private-art?room=cloud-private-restore&owner=dm`;
  const raw = await cloudRequest(endpoint, path, "GET", undefined, profile);
  expect(raw.entries[0].id).toBe(art.id);
  for (const suffix of [
    "room=other&owner=dm",
    "room=cloud-private-restore&owner=other",
  ]) {
    expect(
      (
        await cloudRequest(
          endpoint,
          path.split("?")[0] + "?" + suffix,
          "GET",
          undefined,
          profile,
        )
      ).entries,
    ).toEqual([]);
  }
  const libB = await a.router.createLibrary(profile, "独立私密库");
  await a.store.selectStorage(profile, libB);
  expect(a.store.state.entries).toHaveLength(0);
  await a.store.selectStorage();
  expect(a.store.state.entries[0].title).toBe("房间本机图");
  await a.store.selectStorage(profile, a.lib);
  expect(a.store.state.entries[0].title).toBe("云端秘密");
  browserStorage.clear();
  const router = new StorageRouter(a.driver, browserStorage),
    restored = new TeamStore(router);
  await connect(restored);
  expect(restored.state.entries).toHaveLength(0);
  expect(restored.state.privateArtMessage).toContain("尚未导入");
  await expect(restored.save(hiddenArt)).rejects.toThrow("管理配置");
  await router.saveProfile(profile);
  await restored.refresh();
  expect(restored.state.entries[0]).toEqual(art);
  expect(restored.state.privateArtMessage).toBe("");
});
it("never exposes private art through member reads or shared writes, and rejects unsigned or member-token private requests", async () => {
  const a = await privateCloud("cloud-private-permission");
  await a.store.selectStorage(profile, a.lib);
  await a.store.save(hiddenArt);
  const selection = a.router.selection;
  if (selection.mode !== "cloud") throw Error("expected cloud");
  const path = `/admin/libraries/${a.lib.id}/private-art?room=cloud-private-permission&owner=dm`;
  expect((await fetch(endpoint + path)).status).toBe(403);
  expect(
    (
      await fetch(endpoint + path, {
        headers: { Authorization: `Bearer ${selection.token}`, "X-Role": "GM" },
      })
    ).status,
  ).toBe(403);
  const publicData = await cloudRequest(
    endpoint,
    `/libraries/${a.lib.id}/state?room=cloud-private-permission`,
    "GET",
    undefined,
    selection.token,
  );
  expect(JSON.stringify(publicData)).not.toContain("cloud-secret");
  expect(JSON.stringify(publicData)).not.toContain("未公开说明");
  const privateEntry = a.store.state.entries[0];
  await expect(
    cloudRequest(
      endpoint,
      `/admin/libraries/${a.lib.id}/state`,
      "POST",
      {
        revision: publicData.revision,
        update: { [RECORD_PREFIX + privateEntry.id]: privateEntry },
      },
      profile,
    ),
  ).rejects.toThrow("不能写入共享资料");
});
it("uses the revision of the exact private read and rejects stale writes even after another read on the same vault", async () => {
  const a = await privateCloud("cloud-private-conflicts");
  await a.store.selectStorage(profile, a.lib);
  if (a.router.selection.mode !== "cloud") throw Error("expected cloud");
  const vault = new CloudArtVault(
    a.router.selection,
    "cloud-private-conflicts",
    "dm",
    async () => profile,
  );
  const old = await vault.read();
  const entry = {
    ...hiddenArt,
    id: "private-one",
    rev: "r1",
    updatedAt: 1,
  } as Artwork;
  await vault.write([entry], old);
  await vault.read();
  await expect(vault.write([], old)).rejects.toThrow("其他窗口修改");
  expect((await vault.read())[0]).toEqual(entry);
});
it("migrates old cloud-scoped local artwork once without deleting the recovery copy or resurrecting cloud deletions", async () => {
  const a = await privateCloud("cloud-private-migrate");
  const local = new BrowserArtVault(
    `cloud-private-migrate|${endpoint}|${a.lib.id}`,
    "dm",
  );
  const entry = {
    ...hiddenArt,
    id: "legacy-art",
    rev: "old",
    updatedAt: 1,
  } as Artwork;
  local.write([entry]);
  await a.store.selectStorage(profile, a.lib);
  expect(a.store.state.entries[0]).toEqual(entry);
  expect(local.read()).toEqual([entry]);
  expect(local.migrated()).toBe(true);
  await a.store.remove(entry);
  await a.store.refresh();
  expect(a.store.state.entries).toHaveLength(0);
  expect(local.read()).toEqual([entry]);
});
it("rejects an old private editor if the room switches libraries while its private read is pending", async () => {
  const a = await privateCloud("cloud-private-delayed");
  await a.store.selectStorage(profile, a.lib);
  await a.store.save(hiddenArt);
  const original = a.store.state.entries[0] as Artwork;
  const other = await a.router.createLibrary(profile, "延迟期间的新来源");
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher = globalThis.fetch;
  let held = false;
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      if (
        !held &&
        String(input).includes(`/libraries/${a.lib.id}/private-art?`) &&
        init?.method === "GET"
      ) {
        held = true;
        entered();
        await gate;
      }
      return fetcher(input, init);
    });
  const pending = a.store.save(
    { ...original, title: "不应保存的旧编辑" },
    original,
  );
  const assertion = expect(pending).rejects.toThrow("资料库已切换");
  try {
    await waiting;
    await a.router.select(profile, other);
    release();
    await assertion;
  } finally {
    release();
    spy.mockRestore();
  }
  await a.store.selectStorage(profile, a.lib);
  expect(a.store.state.entries[0].title).toBe(original.title);
});
it("preserves public records on failed private saves, then publishes/hides/removes with private data excluded from member state", async () => {
  const a = await privateCloud("cloud-private-visibility");
  await a.store.selectStorage(profile, a.lib);
  await a.store.save({ ...hiddenArt, visibility: "players" });
  const publicArt = a.store.state.entries[0] as Artwork;
  const fetcher = globalThis.fetch;
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      if (String(input).includes("/private-art?") && init?.method === "POST")
        throw Error("private offline");
      return fetcher(input, init);
    });
  try {
    await expect(
      a.store.save({ ...publicArt, visibility: "gm" }, publicArt),
    ).rejects.toThrow("private offline");
  } finally {
    spy.mockRestore();
  }
  expect((a.store.state.entries[0] as Artwork).visibility).toBe("players");
  await a.store.save({ ...publicArt, visibility: "gm" }, publicArt);
  let hidden = a.store.state.entries[0] as Artwork;
  await a.store.save({ ...hidden, visibility: "players" }, hidden);
  expect((a.store.state.entries[0] as Artwork).visibility).toBe("players");
  const path = `/admin/libraries/${a.lib.id}/private-art?room=cloud-private-visibility&owner=dm`;
  expect(
    (await cloudRequest(endpoint, path, "GET", undefined, profile)).entries,
  ).toEqual([]);
  await a.store.save(
    { ...a.store.state.entries[0], visibility: "gm" } as Artwork,
    a.store.state.entries[0],
  );
  hidden = a.store.state.entries[0] as Artwork;
  await a.store.remove(hidden);
  expect(
    (await cloudRequest(endpoint, path, "GET", undefined, profile)).entries[0]
      .deletedAt,
  ).toBeGreaterThan(0);
  expect(a.store.state.entries).toHaveLength(0);
  expect(a.store.state.trash).toHaveLength(1);
  await a.store.restore(a.store.state.trash[0]);
  expect(a.store.state.entries[0]).toMatchObject({
    visibility: "gm",
    title: hidden.title,
  });
  expect(a.store.state.trash).toHaveLength(0);
});

it("keeps cloud ledger and public recovery with the selected library and enforces member achievement restrictions", async () => {
  const a = room("improvements-cloud");
  await connect(a.store);
  await a.router.saveProfile(profile);
  const lib = await a.router.createLibrary(profile, "功能回归 A");
  const libB = await a.router.createLibrary(profile, "功能回归 B");
  await a.store.selectStorage(profile, lib);
  const memberRouter = new StorageRouter(
    {
      ...a.driver,
      identity: async () => ({
        role: "PLAYER",
        roomId: "improvements-cloud",
        playerId: "member",
      }),
    },
    memoryStorage(),
  );
  const member = new TeamStore(memberRouter);
  await connect(member);
  const amounts = { pp: 0, gp: 30, sp: 0, cp: 0 };
  await member.transact(amounts, member.state.money, "云端玩家报酬");
  await a.store.refresh();
  expect(a.store.state.money.gp.value).toBe(30);
  expect(a.store.state.ledger[0].reason).toBe("云端玩家报酬");
  expect(JSON.stringify(a.data())).not.toContain("云端玩家报酬");
  await member.save({ ...potion, pinned: true, order: 3 });
  await member.remove(member.state.entries[0]);
  await a.store.refresh();
  expect(a.store.state.trash).toHaveLength(1);
  const deleted = a.store.state.trash[0];
  await a.store.restore(deleted);
  await member.refresh();
  expect(member.state.entries[0]).toMatchObject({ pinned: true, order: 3 });
  await expect(member.restore(deleted)).rejects.toThrow();
  await a.store.save(WELCOME_ACHIEVEMENT);
  await a.store.remove(a.store.state.achievements[0]);
  const deletedAchievement = a.store.state.trash[0];
  await member.refresh();
  expect(member.state.trash).toHaveLength(0);
  await expect(member.restore(deletedAchievement)).rejects.toThrow();
  // The server must reject forged member writes too, not just hide UI controls.
  const before = await memberRouter.read();
  await expect(
    memberRouter.write(
      {
        [ACHIEVEMENT_PREFIX + deletedAchievement.id]: {
          ...deletedAchievement,
          deletedAt: undefined,
        },
      },
      before,
    ),
  ).rejects.toThrow("权限");
  await a.store.selectStorage(profile, libB);
  expect(a.store.state.ledger).toHaveLength(0);
  expect(a.store.state.trash).toHaveLength(0);
  await a.store.selectStorage();
  expect(a.store.state.ledger).toHaveLength(0);
  await a.store.selectStorage(profile, lib);
  expect(a.store.state.ledger).toHaveLength(1);
  expect(a.store.state.trash).toHaveLength(1);
  await a.store.restore(a.store.state.trash[0]);
  expect(a.store.state.achievements).toHaveLength(1);
});

it("commits cloud balances and ledger atomically and keeps only 100 recent transactions", async () => {
  const a = room("ledger-atomic");
  await connect(a.store);
  await a.router.saveProfile(profile);
  const lib = await a.router.createLibrary(profile, "流水回归");
  await a.store.selectStorage(profile, lib);
  const prefix = PREFIX + "ledger/";
  const seed = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      prefix + `seed-${i}`,
      { id: `seed-${i}`, at: i, reason: "历史", changes: { gp: 1 } },
    ]),
  );
  await a.router.write(seed, await a.router.read());
  await a.store.refresh();
  const amounts = { pp: 0, gp: 10, sp: 0, cp: 0 };
  const stale = a.store.state.money;
  await a.store.transact(amounts, stale, "新报酬");
  expect(a.store.state.ledger).toHaveLength(100);
  expect(a.store.state.ledger[0].reason).toBe("新报酬");
  expect(a.store.state.ledger.some((t) => t.id === "seed-0")).toBe(false);
  await expect(a.store.transact(amounts, stale, "过期报酬")).rejects.toThrow(
    "队友修改",
  );
  expect(a.store.state.ledger.some((t) => t.reason === "过期报酬")).toBe(false);
  expect(a.store.state.money.gp.value).toBe(10);
});
