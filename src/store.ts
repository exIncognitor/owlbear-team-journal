import OBR from "@owlbear-rodeo/sdk";
import { errorMessage } from "./errors";
import { readLocal, writeLocal } from "./local-records";
import {
  BrowserArtVault,
  CloudArtVault,
  type PrivateArtVault,
} from "./private-art";
import { StorageRouter, ROUTE_PENDING, ROUTE_ERROR } from "./storage-router";
import { STAMP_KEY, type CloudProfile, type Library } from "./cloud-protocol";
import {
  COINS,
  compareEntries,
  LEDGER_PREFIX,
  text,
  type Transaction,
  validateTransaction,
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
  type OrderedDraft as Draft,
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
  write(update: Metadata, expected?: Metadata): Promise<void>;
  managesCapacity?: boolean;
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
  private vaultScope = "";
  get localScope() {
    return JSON.stringify([
      this.identity.roomId,
      this.identity.playerId,
      this.identity.role,
      this.storage?.scope ?? "room",
    ]);
  }
  get storage() {
    return this.driver instanceof StorageRouter ? this.driver : undefined;
  }
  private lifecycle = 0;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private driver: Driver,
    readonly demo = false,
    private makeVault?: (identity: Identity) => PrivateArtVault,
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
  private configureIdentity(identity: Identity, invalidate = true) {
    this.offVault?.();
    this.identity = identity;
    this.vaultScope = this.storage?.scope ?? "room";
    this.vault = undefined;
    if (identity.role === "GM") {
      const scoped = {
        ...identity,
        roomId:
          identity.roomId +
          (this.vaultScope === "room" ? "" : `|${this.vaultScope}`),
      };
      const local = new BrowserArtVault(
        scoped.roomId,
        scoped.playerId,
        this.demo,
      );
      const router = this.storage,
        selection = router?.selection;
      this.vault = this.makeVault
        ? this.makeVault(scoped)
        : selection?.mode === "cloud"
          ? new CloudArtVault(
              selection,
              identity.roomId,
              identity.playerId,
              () => router!.privateArtProfile(selection, identity),
              local,
            )
          : local;
    }
    this.offVault = this.vault?.listen(() => {
      void this.refresh();
    });
    if (invalidate) ++this.generation;
    // Clear open private records immediately on role/account changes.
    this.state = {
      ...this.state,
      role: identity.role,
      trash: [],
      ledger: [],
      localScope: this.localScope,
      entries: this.state.entries.filter(
        (e) => e.kind !== "art" || e.visibility !== "gm",
      ),
    };
    if (invalidate) this.emit();
  }
  private async snapshot(metadata: Metadata) {
    if (metadata[ROUTE_ERROR]) throw Error(String(metadata[ROUTE_ERROR]));
    if (this.vaultScope !== (this.storage?.scope ?? "room"))
      this.configureIdentity(this.identity, false);
    const state = await readSnapshot(
      metadata,
      this.demo,
      this.demo && this.storage?.info().mode !== "cloud",
    );
    if (this.storage) {
      state.storage = this.storage.info();
      state.bytes = state.storage.bytes;
    }
    state.role = this.identity.role;
    // Public data wins if a previous hide attempt was not acknowledged.
    const ids = new Set([...state.entries, ...state.trash].map((e) => e.id));
    const vault = this.vault;
    const privateArt = ((await vault?.read()) ?? []).filter(
      (e) => !ids.has(e.id),
    );
    state.privateArtStorage = vault?.location ?? "browser";
    state.privateArtMessage = vault?.message ?? "";
    state.entries = [
      ...state.entries.filter((e) => e.kind !== "art" || e.visibility !== "gm"),
      ...privateArt.filter((e) => e.deletedAt == null),
    ].sort(compareEntries);
    state.localScope = this.localScope;
    let localTrash: Entry[] = [];
    if (this.storage?.info().mode !== "cloud") {
      try {
        localTrash = readLocal<Entry[]>(this.localScope, "trash", []).map((e) =>
          validateEntry(e, this.demo),
        );
        state.ledger = [
          ...state.ledger,
          ...readLocal<Transaction[]>(this.localScope, "ledger", []).map(
            validateTransaction,
          ),
        ].sort((a, b) => b.at - a.at);
      } catch {
        state.localWarning =
          "本机辅助记录暂不可读；共享资料仍可使用，原本机数据已保留。";
      }
    }
    state.trash = [
      ...state.trash.filter((e) => e.kind !== "art" || e.visibility !== "gm"),
      ...privateArt.filter((e) => e.deletedAt != null),
      ...localTrash.filter(
        (e) =>
          !ids.has(e.id) &&
          !privateArt.some((privateEntry) => privateEntry.id === e.id),
      ),
    ]
      .filter(
        (e) =>
          state.role === "GM" ||
          (e.kind !== "achievement" &&
            !(e.kind === "art" && e.visibility === "gm")),
      )
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
    return state;
  }
  private async receive(metadata: Metadata, lifecycle: number) {
    const generation = ++this.generation;
    if (metadata[ROUTE_PENDING]) {
      this.state = {
        ...emptySnapshot(),
        role: this.identity.role,
        storage: this.storage?.info(),
      };
      this.emit();
      return;
    }
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
    afterWrite?: () => void | Promise<void>,
  ) {
    const route = this.storage?.routeVersion;
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
      if (route !== this.storage?.routeVersion)
        throw Error("资料库已切换，请重新打开编辑器");
      const current = await this.snapshot(metadata);
      if (route !== this.storage?.routeVersion)
        throw Error("资料库已切换，请重新打开编辑器");
      if (
        identity &&
        (identity.role !== this.identity.role ||
          identity.playerId !== this.identity.playerId ||
          identity.roomId !== this.identity.roomId)
      )
        throw Error("当前身份已变化，请重新打开编辑器");
      const update = await makeUpdate(metadata, current);
      try {
        if (Object.keys(update).length) {
          if (!this.demo && !this.driver.managesCapacity)
            checkCapacity({ ...metadata, ...update });
          await this.driver.write(update, metadata);
        }
        await afterWrite?.();
      } finally {
        await this.refresh();
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  private storageTask(fn: () => Promise<void>) {
    const task = this.queue.then(async () => {
      if ((await this.driver.identity?.())?.role !== "GM")
        throw Error("只有 DM 可以管理存储设置");
      await fn();
      await this.refresh();
    });
    this.queue = task.catch(() => {});
    return task;
  }
  selectStorage(profile?: CloudProfile, library?: Library) {
    return this.storageTask(() => this.storage!.select(profile, library));
  }
  copyStorage(profile?: CloudProfile, library?: Library) {
    return this.storageTask(() => this.storage!.copyTo(profile, library));
  }
  save(draft: Draft, previous?: Entry) {
    let operationVault: PrivateArtVault | undefined;
    const entry = validateEntry(
      {
        pinned: previous?.pinned,
        order: previous?.order,
        ...draft,
        deletedAt: undefined,
        id: previous?.id ?? crypto.randomUUID(),
        rev: crypto.randomUUID(),
        updatedAt: Date.now(),
      },
      this.demo,
    );
    return this.mutate(
      async (_metadata, current) => {
        operationVault = this.vault;
        const existing = [...current.entries, ...current.achievements].find(
          (e) => e.id === entry.id,
        );
        if (
          (entry.kind === "achievement" || existing?.kind === "achievement") &&
          current.role !== "GM"
        )
          throw Error("只有 DM 可以编辑成就");
        if (existing && existing.kind !== entry.kind)
          throw Error("资料类型不可变更");
        verifyRevision(existing, previous?.rev);
        if (entry.kind === "art" && entry.visibility === "gm") {
          if (current.role !== "GM" || !operationVault)
            throw Error("只有 DM 可以设置插画可见性");
          // Save a private copy before removing a formerly public reference.
          // If the room write fails, the public record remains visibly public.
          const privateEntries = await operationVault.read();
          if (operationVault !== this.vault)
            throw Error("资料库或身份已切换，请重新打开编辑器");
          if (previous?.kind === "art" && previous.visibility === "gm")
            verifyRevision(
              privateEntries.find((e) => e.id === entry.id),
              previous.rev,
            );
          await operationVault.write(
            [...privateEntries.filter((e) => e.id !== entry.id), entry],
            privateEntries,
          );
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
      async () => {
        if (entry.kind === "art" && entry.visibility !== "gm" && operationVault)
          await this.clearPrivate(operationVault, entry.id, previous);
      },
    );
  }
  remove(previous: Entry) {
    let operationVault: PrivateArtVault | undefined;
    return this.mutate(
      async (_metadata, current) => {
        operationVault = this.vault;
        const existing = [...current.entries, ...current.achievements].find(
          (e) => e.id === previous.id,
        );
        if (existing?.kind === "achievement" && current.role !== "GM")
          throw Error("只有 DM 可以移除成就");
        verifyRevision(existing, previous.rev);
        if (previous.kind === "art" && previous.visibility === "gm") {
          if (current.role !== "GM" || !this.vault)
            throw Error("只有 DM 可以修改私密插画");
          const entries = await this.vault.read();
          verifyRevision(
            entries.find((e) => e.id === previous.id),
            previous.rev,
          );
          await this.vault.write(
            entries.map((e) =>
              e.id === previous.id
                ? { ...e, deletedAt: Date.now(), rev: crypto.randomUUID() }
                : e,
            ),
            entries,
          );
          return {};
        }
        const deleted = {
          ...existing!,
          deletedAt: Date.now(),
          rev: crypto.randomUUID(),
        };
        const cloud = this.storage?.info().mode === "cloud";
        if (!cloud) {
          const records = readLocal<Entry[]>(this.localScope, "trash", []);
          writeLocal(
            this.localScope,
            "trash",
            [deleted, ...records.filter((e) => e.id !== deleted.id)].slice(
              0,
              50,
            ),
          );
        }
        const update: Metadata = {
          [(existing?.kind === "achievement"
            ? ACHIEVEMENT_PREFIX
            : RECORD_PREFIX) + previous.id]: cloud ? await pack(deleted) : null,
        };
        if (current.shownId === previous.id) update[DISPLAY_KEY] = { id: null };
        return update;
      },
      async () => {
        if (
          previous.kind === "art" &&
          previous.visibility !== "gm" &&
          operationVault
        )
          await this.clearPrivate(operationVault, previous.id);
      },
    );
  }
  private async clearPrivate(
    vault: PrivateArtVault,
    id: string,
    previous?: Entry,
  ) {
    const entries = await vault.read();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    if (previous?.kind === "art" && previous.visibility === "gm")
      verifyRevision(entry, previous.rev);
    await vault.write(
      entries.filter((e) => e.id !== id),
      entries,
    );
  }
  adjustQuantity(previous: Entry, delta: number) {
    if (previous.kind !== "item" || ![1, -1].includes(delta))
      return Promise.reject(Error("数量操作无效"));
    return this.save(
      { ...previous, quantity: previous.quantity + delta },
      previous,
    );
  }
  restore(previous: Entry) {
    return this.mutate(async (metadata, current) => {
      const deleted = current.trash.find((e) => e.id === previous.id);
      verifyRevision(deleted, previous.rev);
      if (!deleted) throw Error("回收记录已不存在");
      if (deleted.kind === "achievement" && current.role !== "GM")
        throw Error("只有 DM 可以恢复成就");
      const key =
        (deleted.kind === "achievement" ? ACHIEVEMENT_PREFIX : RECORD_PREFIX) +
        deleted.id;
      const restored = validateEntry(
        {
          ...deleted,
          deletedAt: undefined,
          updatedAt: Date.now(),
          rev: crypto.randomUUID(),
        },
        this.demo,
      );
      if (restored.kind === "art" && restored.visibility === "gm") {
        if (current.role !== "GM" || !this.vault)
          throw Error("只有 DM 可以恢复私密插画");
        const entries = await this.vault.read();
        verifyRevision(
          entries.find((e) => e.id === restored.id),
          previous.rev,
        );
        await this.vault.write(
          entries.map((e) => (e.id === restored.id ? restored : e)),
          entries,
        );
        return {};
      }
      if (
        [...current.entries, ...current.achievements].some(
          (e) => e.id === restored.id,
        )
      )
        throw Error("同编号资料已存在，未覆盖现有记录");
      return { [key]: this.demo ? restored : await pack(restored) };
    });
  }
  money(
    values: Record<Coin, number>,
    base: Snapshot["money"],
    reason = "余额调整",
    record = true,
  ) {
    return this.changeMoney(values, base, false, reason, record);
  }
  transact(
    values: Record<Coin, number>,
    base: Snapshot["money"],
    reason: string,
    record = true,
  ) {
    return this.changeMoney(values, base, true, reason, record);
  }
  private changeMoney(
    values: Record<Coin, number>,
    base: Snapshot["money"],
    relative: boolean,
    reason: string,
    record: boolean,
  ) {
    let localTransaction: Transaction | undefined;
    const scope = this.localScope;
    return this.mutate(
      (_metadata, current) => {
        const update: Metadata = {};
        const changes: Transaction["changes"] = {};
        for (const coin of COINS) {
          if (!Number.isSafeInteger(values[coin])) throw Error("金额须为整数");
          const value = integer(
            relative ? base[coin].value + values[coin] : values[coin],
            coin,
          );
          if (value === base[coin].value) continue;
          if (current.money[coin].rev !== base[coin].rev)
            throw Error("金钱已被队友修改。请取消后重新打开金钱编辑器。");
          update[moneyKey(coin)] = { value, rev: crypto.randomUUID() };
          changes[coin] = value - current.money[coin].value;
        }
        if (record && Object.keys(changes).length) {
          const transaction: Transaction = {
            id: crypto.randomUUID(),
            at: Date.now(),
            reason: text(reason, "收支原因", 200, true),
            changes,
          };
          if (this.storage?.info().mode === "cloud") {
            update[LEDGER_PREFIX + transaction.id] = transaction;
            for (const old of current.ledger.slice(99))
              update[LEDGER_PREFIX + old.id] = null;
          } else localTransaction = transaction;
        }
        return update;
      },
      () => {
        if (localTransaction) {
          try {
            writeLocal(
              scope,
              "ledger",
              [
                localTransaction,
                ...readLocal<Transaction[]>(scope, "ledger", []),
              ].slice(0, 100),
            );
          } catch {
            throw Error(
              "余额已更新，但本机流水保存失败。请勿重复提交收支，先核对余额。",
            );
          }
        }
      },
    );
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
    // Owlbear rejects an empty defaultSearch before opening the picker.
    const images = await OBR.assets
      .downloadImages(false, search.trim() || undefined, "CHARACTER")
      .catch((error: unknown) => {
        throw Error(`无法打开 Owlbear 图库：${errorMessage(error)}`);
      });
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
  if (!OBR.isAvailable)
    return new TeamStore(new StorageRouter(new DemoDriver()), true);
  return new TeamStore(
    new StorageRouter({
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
    }),
  );
}
