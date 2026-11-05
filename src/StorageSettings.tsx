import { useEffect, useRef, useState } from "react";
import type { TeamStore } from "./store";
import type { CloudProfile, Library } from "./cloud-protocol";
export function StorageSettings({
  store,
  busy,
  onRun,
  onClose,
}: {
  store: TeamStore;
  busy: boolean;
  onRun: (fn: () => Promise<void>) => Promise<void>;
  onClose: () => void;
}) {
  const router = store.storage!;
  const [profiles, setProfiles] = useState<CloudProfile[]>([]),
    [profileId, setProfileId] = useState("room"),
    [libraries, setLibraries] = useState<Library[]>([]),
    [libraryId, setLibraryId] = useState(""),
    [newName, setNewName] = useState(""),
    [confirmCopy, setConfirmCopy] = useState(false),
    [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const profile = profiles.find((p) => p.id === profileId),
    library = libraries.find((l) => l.id === libraryId);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await router.profiles();
        if (!active) return;
        setProfiles(saved);
        const current = router.selection;
        if (current.mode === "cloud") {
          const match = saved.find(
            (profile) => profile.endpoint === current.endpoint,
          );
          if (match) {
            const list = await router.libraries(match);
            if (active) {
              setProfileId(match.id);
              setLibraries(list);
              setLibraryId(current.libraryId);
            }
          } else if (active)
            setMessage(
              "此浏览器尚未导入当前云端的管理配置。可导入配置，或切回枭雄共享模式。",
            );
        }
      } catch (error) {
        if (active)
          setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);
  async function choose(id: string) {
    setConfirmCopy(false);
    setProfileId(id);
    setLibraries([]);
    setLibraryId("");
    const p = profiles.find((p) => p.id === id);
    if (p) {
      const list = await router.libraries(p);
      setLibraries(list);
      setLibraryId(list[0]?.id ?? "");
    }
  }
  return (
    <div className="storage-settings">
      <div className="dialog-heading">
        <p className="eyebrow">STORAGE · DM ONLY</p>
        <h2>存储设置</h2>
      </div>
      <p className="storage-current">
        当前：{router.info().label}。本设置仅影响当前房间，房内玩家会同步跟随。
      </p>
      <fieldset disabled={busy || loading}>
        <label>
          存储来源
          <select
            aria-label="存储来源"
            value={profileId}
            onChange={(e) => void onRun(() => choose(e.target.value))}
          >
            <option value="room">枭雄房间共享（16 kB）</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          type="button"
          onClick={() => input.current?.click()}
        >
          导入云端连接配置
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          aria-label="云端连接配置文件"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void onRun(async () => {
                if (file.size > 16384) throw Error("连接配置文件过大");
                const saved = await router.saveProfile(
                  JSON.parse(await file.text()),
                );
                const next = await router.profiles();
                setProfiles(next);
                setProfileId(saved.id);
                const list = await router.libraries(saved);
                setLibraries(list);
                setLibraryId(list[0]?.id ?? "");
                await store.refresh();
                setMessage(
                  "连接已验证并保存，仅供此账号在当前浏览器使用。请保留原配置文件。",
                );
              });
          }}
        />
        {profile && (
          <>
            <p className="gallery-note">
              接口：{profile.endpoint}
              。连接可保存多份；每个云端连接下可以创建多个模组资料库。
            </p>
            <label>
              模组资料库
              <select
                aria-label="模组资料库"
                value={libraryId}
                onChange={(e) => {
                  setLibraryId(e.target.value);
                  setConfirmCopy(false);
                }}
              >
                <option value="">请选择资料库</option>
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="storage-create">
              <input
                aria-label="新资料库名称"
                placeholder="新资料库名称，例如：歪曲之月"
                maxLength={80}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button
                className="secondary"
                type="button"
                disabled={!newName.trim()}
                onClick={() =>
                  void onRun(async () => {
                    const created = await router.createLibrary(
                      profile,
                      newName,
                    );
                    setLibraries(await router.libraries(profile));
                    setLibraryId(created.id);
                    setNewName("");
                    setMessage("已创建空资料库，现有资料未搬迁。");
                  })
                }
              >
                新建资料库
              </button>
            </div>
          </>
        )}
        <p className="gallery-note">
          切换只改变当前读取和保存的位置，原资料保留。复制只处理公开资料，且仅写入空目标。
          隐藏插画在云端模式私密保存，在枭雄房间模式保存在 DM
          当前浏览器；两种来源分别保留，切换不会搬迁私密资料。枭雄共享模式继续受整个房间的
          16 kB 限制。
        </p>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {confirmCopy && (
          <div className="delete-confirm">
            <p>
              将「{router.info().label}」的公开资料复制到「
              {profile ? library?.name : "枭雄房间共享"}
              」？源资料保留，目标已有资料时不会覆盖。
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void onRun(async () => {
                  await store.copyStorage(profile, library);
                  setConfirmCopy(false);
                  setMessage("复制完成，当前使用的资料库保持不变。");
                })
              }
            >
              确认复制
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => setConfirmCopy(false)}
            >
              取消复制
            </button>
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            返回手记
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!!profile && !library}
            onClick={() => setConfirmCopy(true)}
          >
            复制当前资料到所选目标
          </button>
          <button
            type="button"
            className="primary"
            disabled={!!profile && !library}
            onClick={() =>
              void onRun(async () => {
                await store.selectStorage(profile, library);
                onClose();
              })
            }
          >
            切换并保留原资料
          </button>
        </div>
      </fieldset>
    </div>
  );
}
