import type { Driver, Identity } from "./store";
import {
  checkCapacity,
  metadataBytes,
  WELCOME_ACHIEVEMENT,
  ACHIEVEMENT_PREFIX,
  type Metadata,
} from "./model";
import {
  SELECTION_KEY,
  SIGNAL_KEY,
  STAMP_KEY,
  decodeSelection,
  ownedData,
  cloudRequest,
  importProfile,
  digest,
  type Selection,
  type CloudSelection,
  type CloudProfile,
  type Library,
} from "./cloud-protocol";
export const ROUTE_PENDING = "__team_journal_pending";
export const ROUTE_ERROR = "__team_journal_error";
export interface StorageInfo {
  mode: "room" | "cloud";
  label: string;
  scope: string;
  bytes: number;
  roomBytes: number;
}
export class StorageRouter implements Driver {
  readonly managesCapacity = true;
  private roomId = "";
  private current: Selection = { mode: "room", roomId: "" };
  private epoch = 0;
  private roomData: Metadata = {};
  private roomEvents = 0;
  private cache: { metadata: Metadata; revision: number } | null = null;
  private off?: () => void;
  private offProfiles?: () => void;
  private listeners = new Set<(data: Metadata) => void>();
  constructor(
    private room: Driver,
    private profileStorage: Storage = localStorage,
  ) {}
  identity = () => this.room.identity!();
  listenIdentity = (fn: (identity: Identity) => void) =>
    this.room.listenIdentity?.(fn) ?? (() => {});
  get selection() {
    return this.current;
  }
  get routeVersion() {
    return this.epoch;
  }
  get scope() {
    return this.current.mode === "room"
      ? "room"
      : `${this.current.endpoint}|${this.current.libraryId}`;
  }
  info(): StorageInfo {
    return {
      mode: this.current.mode,
      label:
        this.current.mode === "room"
          ? "枭雄房间共享"
          : this.current.libraryName,
      scope: this.scope,
      bytes:
        this.current.mode === "room"
          ? metadataBytes(this.roomData)
          : metadataBytes(this.cache?.metadata ?? {}),
      roomBytes: metadataBytes(this.roomData),
    };
  }
  async ready() {
    await this.room.ready();
    this.roomId = (await this.identity()).roomId;
    this.apply(await this.room.read());
  }
  private apply(data: Metadata) {
    const selection = decodeSelection(data[SELECTION_KEY], this.roomId);
    const changed = JSON.stringify(selection) !== JSON.stringify(this.current);
    this.roomData = data;
    if (changed) {
      this.current = selection;
      this.epoch++;
      this.cache = null;
    }
    return changed;
  }
  private stamped(data: Metadata, revision = 0) {
    return {
      ...data,
      [STAMP_KEY]: { scope: this.scope, epoch: this.epoch, revision },
    };
  }
  private async refreshRoom() {
    const events = this.roomEvents;
    const data = await this.room.read();
    if (events === this.roomEvents) this.apply(data);
    return this.roomData;
  }
  async read(): Promise<Metadata> {
    await this.refreshRoom();
    const selection = this.current,
      epoch = this.epoch;
    if (selection.mode === "room") return this.stamped(this.roomData);
    const result = await cloudRequest(
      selection.endpoint,
      `/libraries/${selection.libraryId}/state?room=${encodeURIComponent(this.roomId)}${this.cache ? `&since=${this.cache.revision}` : ""}`,
      "GET",
      undefined,
      selection.token,
    );
    if (epoch !== this.epoch) throw Error("资料库已切换，请重新读取");
    if (result.metadata !== null)
      this.cache = { metadata: result.metadata, revision: result.revision };
    if (!this.cache) throw Error("云端资料尚未读取");
    return this.stamped(this.cache.metadata, this.cache.revision);
  }
  listen(fn: (data: Metadata) => void) {
    this.listeners.add(fn);
    if (this.listeners.size === 1) {
      this.off = this.room.listen((data) => {
        ++this.roomEvents;
        try {
          const signalChanged =
            JSON.stringify(data[SIGNAL_KEY]) !==
            JSON.stringify(this.roomData[SIGNAL_KEY]);
          const changed = this.apply(data);
          if (changed) {
            this.emit({ [ROUTE_PENDING]: true });
            void this.poll();
          } else if (this.current.mode === "room")
            this.emit(this.stamped(data));
          else if (signalChanged) void this.poll();
          else if (this.cache)
            this.emit(this.stamped(this.cache.metadata, this.cache.revision));
        } catch (error) {
          this.emit({
            [ROUTE_ERROR]: String(
              error instanceof Error ? error.message : error,
            ),
          });
        }
      });
      const timer = setInterval(() => {
        if (
          this.current.mode === "cloud" &&
          (typeof document === "undefined" ||
            document.visibilityState !== "hidden")
        )
          void this.poll();
      }, 30000);
      this.offProfiles = () => clearInterval(timer);
    }
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) {
        this.off?.();
        this.offProfiles?.();
        this.off = this.offProfiles = undefined;
      }
    };
  }
  private emit(data: Metadata) {
    for (const fn of this.listeners) fn(data);
  }
  private polling = false;
  private pollAgain = false;
  private async poll() {
    if (this.polling) {
      this.pollAgain = true;
      return;
    }
    this.polling = true;
    const epoch = this.epoch;
    try {
      this.emit(await this.read());
    } catch (error) {
      if (epoch === this.epoch)
        this.emit({
          [ROUTE_ERROR]: String(error instanceof Error ? error.message : error),
        });
    } finally {
      this.polling = false;
      if (this.pollAgain) {
        this.pollAgain = false;
        void this.poll();
      }
    }
  }
  private async profileKey() {
    return `twisted-moon.connections.v1:${(await this.identity()).playerId}`;
  }
  async profiles(): Promise<CloudProfile[]> {
    const raw = this.profileStorage.getItem(await this.profileKey());
    return raw ? JSON.parse(raw) : [];
  }
  async saveProfile(value: unknown) {
    await this.assertGM();
    const profile = await importProfile(value);
    profile.id = "cloud-" + (await digest(profile.endpoint)).slice(0, 24);
    await this.libraries(profile);
    const profiles = await this.profiles();
    this.profileStorage.setItem(
      await this.profileKey(),
      JSON.stringify([...profiles.filter((p) => p.id !== profile.id), profile]),
    );
    return profile;
  }
  async libraries(profile: CloudProfile): Promise<Library[]> {
    await this.assertGM();
    return (
      await cloudRequest(
        profile.endpoint,
        "/admin/libraries",
        "GET",
        undefined,
        profile,
      )
    ).libraries;
  }
  async createLibrary(profile: CloudProfile, name: string): Promise<Library> {
    await this.assertGM();
    return cloudRequest(
      profile.endpoint,
      "/admin/libraries",
      "POST",
      { name },
      profile,
    );
  }
  private async assertGM() {
    if ((await this.identity()).role !== "GM")
      throw Error("只有 DM 可以管理存储设置");
  }
  private checkSelectionCapacity(selection: Selection) {
    if (metadataBytes({ ...this.roomData, [SELECTION_KEY]: selection }) > 15900)
      throw Error(
        "房间空间不足以保存云端连接信息。请先复制到云端并核对，再减少部分房间资料；原资料未删除。",
      );
  }
  private async auth(selection: Selection) {
    const identity = await this.identity();
    return selection.mode === "cloud" && identity.role === "GM"
      ? (await this.profiles()).find(
          (profile) => profile.endpoint === selection.endpoint,
        )
      : undefined;
  }
  async privateArtProfile(selection: CloudSelection, owner: Identity) {
    const identity = await this.identity();
    if (
      identity.role !== "GM" ||
      identity.playerId !== owner.playerId ||
      identity.roomId !== owner.roomId
    )
      throw Error("当前 DM 身份已变化，请重新读取私密插画");
    return (await this.profiles()).find(
      (profile) => profile.endpoint === selection.endpoint,
    );
  }
  async write(update: Metadata, expected?: Metadata) {
    await this.refreshRoom();
    const stamp = expected?.[STAMP_KEY] as
      { scope?: string; epoch?: number; revision?: number } | undefined;
    if (!stamp || stamp.scope !== this.scope || stamp.epoch !== this.epoch)
      throw Error("资料库已切换，请关闭旧编辑器后重试");
    const selection = this.current;
    if (selection.mode === "room") {
      checkCapacity({ ...this.roomData, ...update });
      await this.room.write(update);
      return;
    }
    const profile = await this.auth(selection);
    await cloudRequest(
      selection.endpoint,
      `/${profile ? "admin/" : ""}libraries/${selection.libraryId}/state${profile ? "" : `?room=${encodeURIComponent(this.roomId)}`}`,
      "POST",
      { revision: stamp.revision, update },
      profile ?? selection.token,
    );
    // A tiny notification keeps clients in this room in sync; a 30s poll is the fallback.
    try {
      const signal = {
        [SIGNAL_KEY]: { scope: this.scope, nonce: crypto.randomUUID() },
      };
      const latest = await this.room.read();
      checkCapacity({ ...latest, ...signal });
      await this.room.write(signal);
    } catch {}
  }
  async select(profile?: CloudProfile, library?: Library) {
    await this.assertGM();
    await this.refreshRoom();
    let selection: Selection = { mode: "room", roomId: this.roomId };
    if (profile && library) {
      if (
        this.current.mode === "cloud" &&
        this.current.endpoint === profile.endpoint &&
        this.current.libraryId === library.id
      )
        return;
      await cloudRequest(
        profile.endpoint,
        `/admin/libraries/${library.id}/state`,
        "GET",
        undefined,
        profile,
      );
      const planned = {
        mode: "cloud",
        roomId: this.roomId,
        endpoint: profile.endpoint,
        libraryId: library.id,
        libraryName: library.name,
        token: "0".repeat(64),
        epoch: crypto.randomUUID(),
      };
      this.checkSelectionCapacity(planned as CloudSelection);
      selection = {
        mode: "cloud",
        endpoint: profile.endpoint,
        ...(await cloudRequest(
          profile.endpoint,
          `/admin/libraries/${library.id}/activate`,
          "POST",
          { roomId: this.roomId },
          profile,
        )),
      };
    }
    this.checkSelectionCapacity(selection);
    await this.room.write({ [SELECTION_KEY]: selection });
    this.apply(await this.room.read());
  }
  async copyTo(profile?: CloudProfile, library?: Library) {
    await this.assertGM();
    const sourceVersion = this.epoch;
    const source = ownedData(await this.read());
    if (sourceVersion !== this.epoch)
      throw Error("当前资料库已变化，请重新确认复制来源");
    const welcomeKey = ACHIEVEMENT_PREFIX + WELCOME_ACHIEVEMENT.id;
    if (!Object.hasOwn(source, welcomeKey))
      source[welcomeKey] =
        this.current.mode === "room" ? WELCOME_ACHIEVEMENT : null;
    if (profile && library) {
      if (
        this.current.mode === "cloud" &&
        this.current.endpoint === profile.endpoint &&
        this.current.libraryId === library.id
      )
        throw Error("源和目标是同一个资料库");
      const result = await cloudRequest(
        profile.endpoint,
        `/admin/libraries/${library.id}/state`,
        "GET",
        undefined,
        profile,
      );
      if (Object.keys(result.metadata).length)
        throw Error(
          "目标资料库已有资料，未覆盖。可直接切换查看，或新建空资料库。",
        );
      let revision = result.revision;
      const entries = Object.entries(source);
      for (let start = 0; start < entries.length; start += 200) {
        const result = await cloudRequest(
          profile.endpoint,
          `/admin/libraries/${library.id}/state`,
          "POST",
          {
            revision,
            update: Object.fromEntries(entries.slice(start, start + 200)),
          },
          profile,
        );
        revision = result.revision;
      }
    } else {
      if (this.current.mode === "room") throw Error("当前已经是枭雄房间共享");
      const target = await this.room.read();
      if (Object.keys(ownedData(target)).length)
        throw Error(
          "房间原资料仍保留，未覆盖。请直接切换查看，或使用其他空房间。",
        );
      checkCapacity({ ...target, ...source });
      await this.room.write(source);
    }
  }
}
