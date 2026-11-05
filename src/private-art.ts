import { validateEntry, type Artwork } from "./model";
import {
  cloudRequest,
  type CloudProfile,
  type CloudSelection,
} from "./cloud-protocol";

export interface PrivateArtVault {
  readonly location?: "browser" | "cloud";
  readonly message?: string;
  read(): Artwork[] | Promise<Artwork[]>;
  write(entries: Artwork[], base?: Artwork[]): void | Promise<void>;
  listen(fn: () => void): () => void;
}

// No private URL, title, or caption is sent to room/player metadata.
// Scope local records to both the room and the current GM account.
export class BrowserArtVault implements PrivateArtVault {
  readonly location = "browser";
  private key: string;
  constructor(
    roomId: string,
    playerId: string,
    private demo = false,
  ) {
    this.key = `twisted-moon.private-art.v1:${encodeURIComponent(roomId)}:${encodeURIComponent(playerId)}`;
  }
  read() {
    const raw = localStorage.getItem(this.key);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values))
      throw Error("DM 私密插画格式错误，原数据已保留");
    const ids = new Set<string>();
    return values.map((value) => {
      const entry = validateEntry(value, this.demo);
      if (
        entry.kind !== "art" ||
        entry.visibility !== "gm" ||
        ids.has(entry.id)
      )
        throw Error("DM 私密插画格式错误，原数据已保留");
      ids.add(entry.id);
      return entry;
    });
  }
  write(entries: Artwork[]) {
    try {
      localStorage.setItem(this.key, JSON.stringify(entries));
    } catch {
      throw Error("DM 私密插画无法保存到当前浏览器；未删除房间原资料");
    }
  }
  listen(fn: () => void) {
    const changed = (event: StorageEvent) => {
      if (event.key === this.key || event.key === null) fn();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }
  migrated() {
    return localStorage.getItem(this.key + ":cloud-migrated") === "1";
  }
  markMigrated() {
    localStorage.setItem(this.key + ":cloud-migrated", "1");
  }
}

// This endpoint accepts only signed admin requests. Member credentials and
// public metadata never carry a private URL, title, caption or revision.
export class CloudArtVault implements PrivateArtVault {
  readonly location = "cloud";
  message = "";
  private revisions = new WeakMap<Artwork[], number>();
  private loading?: Promise<Artwork[]>;
  private path: string;
  constructor(
    private selection: CloudSelection,
    roomId: string,
    playerId: string,
    private authorize: () => Promise<CloudProfile | undefined>,
    private legacy?: BrowserArtVault,
  ) {
    this.path = `/admin/libraries/${selection.libraryId}/private-art?room=${encodeURIComponent(roomId)}&owner=${encodeURIComponent(playerId)}`;
  }
  private async profile() {
    const profile = await this.authorize();
    if (!profile)
      throw Error(
        "请在存储设置导入此云端的 DM 管理配置，才能读取或保存私密插画；云端原资料仍保留",
      );
    return profile;
  }
  read(): Promise<Artwork[]> {
    return (this.loading ??= this.readOnce().finally(() => {
      this.loading = undefined;
    }));
  }
  private async readOnce(): Promise<Artwork[]> {
    const profile = await this.authorize();
    if (!profile) {
      this.message =
        "此浏览器尚未导入 DM 管理配置，云端私密插画暂不可见；请在存储设置导入，原资料仍保留。";
      return [];
    }
    this.message = "";
    const result = await cloudRequest(
      this.selection.endpoint,
      this.path,
      "GET",
      undefined,
      profile,
    );
    let entries = (result.entries as unknown[]).map((value) => {
      const entry = validateEntry(value);
      if (entry.kind !== "art" || entry.visibility !== "gm")
        throw Error("云端私密插画格式错误，原资料已保留");
      return entry;
    });
    this.revisions.set(entries, result.revision);
    if (this.legacy && !this.legacy.migrated()) {
      const local = this.legacy.read(),
        ids = new Set(entries.map((e) => e.id));
      const additions = local.filter((e) => !ids.has(e.id));
      if (additions.length) {
        const base = entries;
        entries = [...entries, ...additions];
        await this.write(entries, base);
      }
      // Keep old local bytes for recovery, but never re-import deleted records.
      this.legacy.markMigrated();
    }
    return entries;
  }
  async write(entries: Artwork[], base?: Artwork[]) {
    const profile = await this.profile();
    const revision = base && this.revisions.get(base);
    if (revision === undefined) throw Error("请先读取云端私密插画后再保存");
    const result = await cloudRequest(
      this.selection.endpoint,
      this.path,
      "POST",
      {
        revision,
        entries,
      },
      profile,
    );
    this.revisions.set(entries, result.revision);
  }
  listen() {
    return () => {};
  } // The storage router refreshes visible clients every 30s.
}
