import OBR from "@owlbear-rodeo/sdk";
import { BrowserArtVault, type PrivateArtVault } from "./private-art";
import {
  COINS,
  ACHIEVEMENT_PREFIX,
  DISPLAY_KEY,
  PREFIX,
  RECORD_PREFIX,
  checkCapacity,
  emptySnapshot,
  integer,
  moneyKey,
  pack,
  readSnapshot,
  safeImageUrl,
  validateEntry,
  verifyRevision,
  type Artwork,
  type Coin,
  type Draft,
  type Entry,
  type Metadata,
  type Snapshot,
} from "./model";
export interface Identity {
  role: "GM" | "PLAYER";
  roomId: string;
  playerId: string;
}
export interface Driver {
  ready(): Promise<void>;
  read(): Promise<Metadata>;
  write(update: Metadata): Promise<void>;
  listen(fn: (data: Metadata) => void): () => void;
  identity?(): Promise<Identity>;
  listenIdentity?(fn: (identity: Identity) => void): () => void;
}
export class TeamStore {
  state = emptySnapshot();
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private off?: () => void;
  private offIdentity?: () => void;
  private offVault?: () => void;
  private identity: Identity = { role: "PLAYER", roomId: "", playerId: "" };
  private vault?: PrivateArtVault;
  private lifecycle = 0;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private driver: Driver,
    readonly demo = false,
    private makeVault: (identity: Identity) => PrivateArtVault = (identity) =>
      new BrowserArtVault(identity.roomId, identity.playerId, demo),
  ) {}
  subscribe(fn: (snapshot: Snapshot) => void) {
    this.listeners.add(fn);
    fn(this.state);
    if (this.listeners.size === 1) void this.start(++this.lifecycle);
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) {
        ++this.lifecycle;
        ++this.generation;
        this.off?.();
        this.off = undefined;
        this.offIdentity?.();
        this.offVault?.();
        this.offIdentity = this.offVault = undefined;
      }
    };
  }
  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }
  private configureIdentity(identity: Identity) {
    this.offVault?.();
    this.identity = identity;
    this.vault = identity.role === "GM" ? this.makeVault(identity) : undefined;
    this.offVault = this.vault?.listen(() => {
      void this.refresh();
    });
    ++this.generation;
    // Clear open private records immediately on role/account changes.
    this.state = {
      ...this.state,
      role: identity.role,
      entries: this.state.entries.filter(
        (e) => e.kind !== "art" || e.visibility !== "gm",
      ),
    };
    this.emit();
  }
  private async snapshot(metadata: Metadata) {
    const state = await readSnapshot(metadata, this.demo);
    state.role = this.identity.role;
    // Public data wins if a previous hide attempt was not acknowledged.
    const ids = new Set(state.entries.map((e) => e.id));
    const privateArt = this.vault?.read().filter((e) => !ids.has(e.id)) ?? [];
    state.entries = [
      ...state.entries.filter((e) => e.kind !== "art" || e.visibility !== "gm"),
      ...privateArt,
    ].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return state;
  }
  private async receive(metadata: Metadata, lifecycle: number) {
    const generation = ++this.generation;
    try {
      const state = await this.snapshot(metadata);
      if (lifecycle === this.lifecycle && generation === this.generation) {
        this.state = state;
        this.emit();
      }
    } catch (e) {
      if (lifecycle === this.lifecycle && generation === this.generation) {
        this.state = {
          ...this.state,
          ready: false,
          error: String(e instanceof Error ? e.message : e),
        };
        this.emit();
      }
    }
  }
  private async start(lifecycle: number) {
    try {
      await this.driver.ready();
      if (lifecycle !== this.lifecycle) return;
      const identity = (await this.driver.identity?.()) ?? this.identity;
      if (lifecycle !== this.lifecycle) return;
      this.configureIdentity(identity);
      this.offIdentity = this.driver.listenIdentity?.((next) => {
        if (
          next.role === this.identity.role &&
          next.roomId === this.identity.roomId &&
          next.playerId === this.identity.playerId
        )
          return;
        this.configureIdentity(next);
        void this.refresh();
      });
      this.off = this.driver.listen((data) => {
        void this.receive(data, lifecycle);
      });
      const generation = this.generation;
      const initial = await this.driver.read();
      if (lifecycle === this.lifecycle && generation === this.generation)
        await this.receive(initial, lifecycle);
    } catch (e) {
      if (lifecycle === this.lifecycle) {
        this.state = {
          ...this.state,
          ready: false,
          error: `连接失败：${e instanceof Error ? e.message : String(e)}`,
        };
        this.emit();
      }
    }
  }
  refresh() {
    return this.driver
      .read()
      .then((data) => this.receive(data, this.lifecycle));
  }
  private mutate(
    makeUpdate: (
      metadata: Metadata,
      current: Snapshot,
    ) => Promise<Metadata> | Metadata,
    afterWrite?: () => void,
  ) {
    const task = this.queue.then(async () => {
      if (!this.state.ready) throw Error("资料尚未连接，请稍后重试");
      const identity = await this.driver.identity?.();
      if (
        identity &&
        (identity.role !== this.identity.role ||
          identity.playerId !== this.identity.playerId ||
          identity.roomId !== this.identity.roomId)
      ) {
        this.configureIdentity(identity);
        await this.refresh();
        throw Error("当前身份已变化，请重新打开编辑器");
      }
      const metadata = await this.driver.read();
      const current = await this.snapshot(metadata);
      const update = await makeUpdate(metadata, current);
      try {
        if (Object.keys(update).length) {
          if (!this.demo) checkCapacity({ ...metadata, ...update });
          await this.driver.write(update);
        }
        afterWrite?.();
      } finally {
        await this.refresh();
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  save(draft: Draft, previous?: Entry) {
    const entry = validateEntry(
      {
        ...draft,
        id: previous?.id ?? crypto.randomUUID(),
        rev: crypto.randomUUID(),
        updatedAt: Date.now(),
      },
      this.demo,
    );
    return this.mutate(
      async (_metadata, current) => {
        const existing = [...current.entries, ...current.achievements].find(
          (e) => e.id === entry.id,
        );
        if (
          (entry.kind === "achievement" || existing?.kind === "achievement") &&
          current.role !== "GM"
        )
          throw Error("只有 DM 可以编辑成就");
        verifyRevision(existing, previous?.rev);
        if (entry.kind === "art" && entry.visibility === "gm") {
          if (current.role !== "GM" || !this.vault)
            throw Error("只有 DM 可以设置插画可见性");
          // Save a private copy before removing a formerly public reference.
          // If the room write fails, the public record remains visibly public.
          this.vault.write([
            ...this.vault.read().filter((e) => e.id !== entry.id),
            entry,
          ]);
          if (
            !previous ||
            (previous.kind === "art" && previous.visibility === "gm")
          )
            return {};
          const update: Metadata = { [RECORD_PREFIX + entry.id]: null };
          if (current.shownId === entry.id) update[DISPLAY_KEY] = { id: null };
          return update;
        }
        return {
          [(entry.kind === "achievement" ? ACHIEVEMENT_PREFIX : RECORD_PREFIX) +
          entry.id]: this.demo ? entry : await pack(entry),
        };
      },
      () => {
        if (entry.kind === "art" && entry.visibility !== "gm" && this.vault)
          this.vault.write(this.vault.read().filter((e) => e.id !== entry.id));
      },
    );
  }
  remove(previous: Entry) {
    return this.mutate(
      (_metadata, current) => {
        const existing = [...current.entries, ...current.achievements].find(
          (e) => e.id === previous.id,
        );
        if (existing?.kind === "achievement" && current.role !== "GM")
          throw Error("只有 DM 可以移除成就");
        verifyRevision(existing, previous.rev);
        if (previous.kind === "art" && previous.visibility === "gm") {
          if (current.role !== "GM" || !this.vault)
            throw Error("只有 DM 可以修改私密插画");
          this.vault.write(
            this.vault.read().filter((e) => e.id !== previous.id),
          );
          return {};
        }
        const update: Metadata = {
          [(existing?.kind === "achievement"
            ? ACHIEVEMENT_PREFIX
            : RECORD_PREFIX) + previous.id]: null,
        };
        if (current.shownId === previous.id) update[DISPLAY_KEY] = { id: null };
        return update;
      },
      () => {
        if (previous.kind === "art" && this.vault)
          this.vault.write(
            this.vault.read().filter((e) => e.id !== previous.id),
          );
      },
    );
  }
  money(values: Record<Coin, number>, base: Snapshot["money"]) {
    return this.mutate((_metadata, current) => {
      const update: Metadata = {};
      for (const coin of COINS) {
        const value = integer(values[coin], coin);
        if (value === base[coin].value) continue;
        if (current.money[coin].rev !== base[coin].rev)
          throw Error("金钱已被队友修改。请取消后重新打开金钱编辑器。");
        update[moneyKey(coin)] = { value, rev: crypto.randomUUID() };
      }
      return update;
    });
  }
  show(id: string | null) {
    return this.mutate((_metadata, current) => {
      if (id && !current.entries.some((e) => e.id === id && e.kind === "art"))
        throw Error("这张插画已被移除");
      if (
        id &&
        current.entries.some(
          (e) => e.id === id && e.kind === "art" && e.visibility === "gm",
        )
      )
        throw Error("请先将插画设为玩家可见，再展示给全队");
      return { [DISPLAY_KEY]: { id } };
    });
  }
  async backup() {
    const metadata = await this.driver.read();
    // Preserve complete owned values, including unreadable future/corrupt data.
    return JSON.stringify(
      {
        format: "twisted-moon-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        metadata: Object.fromEntries(
          Object.entries(metadata).filter(([key]) => key.startsWith(PREFIX)),
        ),
      },
      null,
      2,
    );
  }
  async pick(search = ""): Promise<Pick<Artwork, "title" | "url"> | null> {
    if (this.demo)
      throw Error("独立演示请从链接导入；Owlbear 图库在房间内可用");
    const images = await OBR.assets.downloadImages(false, search);
    if (!images.length) return null;
    return {
      title: images[0].name.slice(0, 80) || "未命名插画",
      url: safeImageUrl(images[0].image.url),
    };
  }
}
const DEMO_KEY = "twisted-moon.demo.v1";
export class DemoDriver implements Driver {
  private listeners = new Set<(data: Metadata) => void>();
  ready() {
    return Promise.resolve();
  }
  async identity(): Promise<Identity> {
    return { role: "GM", roomId: "demo", playerId: "demo" };
  }
  async read(): Promise<Metadata> {
    const raw = localStorage.getItem(DEMO_KEY);
    return raw ? (JSON.parse(raw) as Metadata) : demoSeed();
  }
  async write(update: Metadata) {
    const next = { ...(await this.read()), ...update };
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(next));
    } catch {
      throw Error("本地演示储存空间不足，请减少演示资料或使用较短的图片链接");
    }
    this.listeners.forEach((fn) => fn(next));
  }
  listen(fn: (data: Metadata) => void) {
    this.listeners.add(fn);
    const changed = (e: StorageEvent) => {
      if (e.key === DEMO_KEY) void this.read().then(fn);
    };
    window.addEventListener("storage", changed);
    return () => {
      this.listeners.delete(fn);
      window.removeEventListener("storage", changed);
    };
  }
}
function demoSeed(): Metadata {
  const entries: Entry[] = [
    {
      kind: "item",
      id: "demo-item",
      title: "治疗药水",
      category: "道具",
      quantity: 3,
      holder: "团队共有",
      description: "探险前记得核对补给。",
      rev: "seed",
      updatedAt: 2,
    },
    {
      kind: "item",
      id: "demo-gear",
      title: "备用长剑",
      category: "装备",
      quantity: 1,
      holder: "团队共有",
      description: "保存在团队行囊中。",
      rev: "seed",
      updatedAt: 1,
    },
    {
      kind: "intel",
      id: "demo-intel",
      title: "下一次旅程",
      category: "线索",
      content:
        "把你们发现的线索、人物关系和待办事项记在这里。\n这是一条演示资料，不含战役剧情。",
      resolved: false,
      rev: "seed",
      updatedAt: 3,
    },
  ];
  return {
    ...Object.fromEntries(entries.map((e) => [RECORD_PREFIX + e.id, e])),
    [moneyKey("gp")]: { value: 125, rev: "seed" },
    [moneyKey("sp")]: { value: 30, rev: "seed" },
  };
}
export function createStore() {
  if (!OBR.isAvailable) return new TeamStore(new DemoDriver(), true);
  return new TeamStore({
    ready: () => new Promise<void>((resolve) => OBR.onReady(resolve)),
    read: () => OBR.room.getMetadata(),
    write: (update) => OBR.room.setMetadata(update),
    listen: (fn) => OBR.room.onMetadataChange(fn),
    identity: async () => ({
      role: await OBR.player.getRole(),
      roomId: OBR.room.id,
      playerId: OBR.player.id,
    }),
    listenIdentity: (fn) =>
      OBR.player.onChange((player) =>
        fn({ role: player.role, roomId: OBR.room.id, playerId: player.id }),
      ),
  });
}
