import OBR, { buildImageUpload } from "@owlbear-rodeo/sdk";
import {
  COINS,
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
  validateFile,
  verifyRevision,
  type Artwork,
  type Coin,
  type Draft,
  type Entry,
  type Metadata,
  type Snapshot,
} from "./model";
export interface Driver {
  ready(): Promise<void>;
  read(): Promise<Metadata>;
  write(update: Metadata): Promise<void>;
  listen(fn: (data: Metadata) => void): () => void;
}
export class TeamStore {
  state = emptySnapshot();
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private off?: () => void;
  private lifecycle = 0;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private driver: Driver,
    readonly demo = false,
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
      }
    };
  }
  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }
  private async receive(metadata: Metadata, lifecycle: number) {
    const generation = ++this.generation;
    try {
      const state = await readSnapshot(metadata, this.demo);
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
  ) {
    const task = this.queue.then(async () => {
      if (!this.state.ready) throw Error("资料尚未连接，请稍后重试");
      const metadata = await this.driver.read();
      const current = await readSnapshot(metadata, this.demo);
      const update = await makeUpdate(metadata, current);
      if (!Object.keys(update).length) return;
      if (!this.demo) checkCapacity({ ...metadata, ...update });
      await this.driver.write(update);
      await this.refresh();
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
    return this.mutate(async (_metadata, current) => {
      verifyRevision(
        current.entries.find((e) => e.id === entry.id),
        previous?.rev,
      );
      return {
        [RECORD_PREFIX + entry.id]: this.demo ? entry : await pack(entry),
      };
    });
  }
  remove(previous: Entry) {
    return this.mutate((_metadata, current) => {
      verifyRevision(
        current.entries.find((e) => e.id === previous.id),
        previous.rev,
      );
      const update: Metadata = { [RECORD_PREFIX + previous.id]: null };
      if (current.shownId === previous.id) update[DISPLAY_KEY] = { id: null };
      return update;
    });
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
      throw Error("独立演示请使用上传图片或图片链接；Owlbear 图库在房间内可用");
    const images = await OBR.assets.downloadImages(false, search, "PROP");
    if (!images.length) return null;
    return {
      title: images[0].name.slice(0, 80) || "未命名插画",
      url: safeImageUrl(images[0].image.url),
    };
  }
  async upload(file: File): Promise<Pick<Artwork, "title" | "url"> | null> {
    validateFile(file);
    if (this.demo) return demoImage(file);
    // SDK upload is intentionally void. Ask the native picker for the resulting
    // asset; never claim an upload is shared until a real URL has been selected.
    const copy = new File([await file.arrayBuffer()], file.name, {
      type: file.type,
    });
    try {
      await OBR.assets.uploadImages([buildImageUpload(copy).build()], "PROP");
    } catch (e) {
      throw Error(
        `图库上传未确认完成：${e instanceof Error ? e.message : String(e)}。请在 Owlbear 完成上传后，使用「从图库选择」。`,
      );
    }
    return this.pick(file.name.replace(/\.[^.]+$/, ""));
  }
}
const DEMO_KEY = "twisted-moon.demo.v1";
export class DemoDriver implements Driver {
  private listeners = new Set<(data: Metadata) => void>();
  ready() {
    return Promise.resolve();
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
      throw Error("本地演示储存空间不足，请先导出备份或使用较小的图片");
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
async function demoImage(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("无法读取图片");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return {
      title: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "未命名插画",
      url: safeImageUrl(canvas.toDataURL("image/webp", 0.82), true),
    };
  } finally {
    bitmap.close();
  }
}
export function createStore() {
  if (!OBR.isAvailable) return new TeamStore(new DemoDriver(), true);
  return new TeamStore({
    ready: () => new Promise<void>((resolve) => OBR.onReady(resolve)),
    read: () => OBR.room.getMetadata(),
    write: (update) => OBR.room.setMetadata(update),
    listen: (fn) => OBR.room.onMetadataChange(fn),
  });
}
