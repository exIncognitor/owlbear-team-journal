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
import {
  RECORD_PREFIX,
  WELCOME_ACHIEVEMENT,
  ACHIEVEMENT_PREFIX,
  type Metadata,
  type Draft,
  type Artwork,
} from "./model";
let mf: Miniflare, endpoint: string, profile: CloudProfile;
const stops: (() => void)[] = [];
beforeAll(async () => {
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
  const a = room("copy-room");
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
  expect(a.store.state.achievements[0].title).toBe(WELCOME_ACHIEVEMENT.title);
  await expect(a.store.copyStorage()).rejects.toThrow("原资料仍保留");
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
