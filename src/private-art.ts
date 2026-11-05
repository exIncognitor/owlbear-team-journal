import { validateEntry, type Artwork } from "./model";

export interface PrivateArtVault {
  read(): Artwork[];
  write(entries: Artwork[]): void;
  listen(fn: () => void): () => void;
}

// No private URL, title, or caption is sent to room/player metadata.
// Scope local records to both the room and the current GM account.
export class BrowserArtVault implements PrivateArtVault {
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
}
