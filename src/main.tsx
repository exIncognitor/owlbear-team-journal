import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { errorMessage } from "./errors";
import { createStore } from "./store";
import { StorageSettings } from "./StorageSettings";
import { readLocal, writeLocal, clearLocal } from "./local-records";
import {
  COINS,
  COIN_LABELS,
  QUALITIES,
  WELCOME_ACHIEVEMENT,
  emptySnapshot,
  type Artwork,
  type Coin,
  type OrderedDraft as Draft,
  type Entry,
  type Intel,
  type Item,
  type Snapshot,
} from "./model";
import "./style.css";

const store = createStore();
type Tab = "item" | "intel" | "art" | "achievement";
type Editor = { draft: Draft; previous?: Entry };
type MoneyDraft = {
  kind: "balance" | "transaction";
  base: Snapshot["money"];
  values: Record<Coin, number>;
  direction: number;
  reason: string;
  record: boolean;
};
function Book({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 8C12 5 7 5 3 6v21c4-1 9-1 13 2 4-3 9-3 13-2V6c-4-1-9-1-13 2Zm0 0v21M7 11c2-.3 4 0 6 1M7 16c2-.3 4 0 6 1m6-5c2-1 4-1.3 6-1m-6 6c2-1 4-1.3 6-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Symbol({ kind }: { kind: Tab | "search" | "edit" }) {
  const paths = {
    item: (
      <>
        <path d="M4 9h16v11H4zM4 9l3-5h10l3 5M3 13h18M10 11v5h4v-5" />
      </>
    ),
    intel: (
      <>
        <path d="M5 4h14v17l-7-4-7 4zM9 8h6M9 11h6" />
      </>
    ),
    art: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m3 16 5-5 4 4 3-3 6 6" />
        <circle cx="16" cy="9" r="1" />
      </>
    ),
    achievement: (
      <>
        <circle cx="12" cy="9" r="6" />
        <path d="m8 14-2 7 6-3 6 3-2-7M12 5l1.2 2.5 2.8.4-2 2 .5 2.7-2.5-1.3-2.5 1.3.5-2.8-2-1.9 2.8-.4z" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    edit: (
      <>
        <path d="m15 4 5 5-11 11H4v-5zM12 7l5 5" />
      </>
    ),
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}
function fresh(kind: Tab, role: Snapshot["role"] = "PLAYER"): Draft {
  if (kind === "item")
    return {
      kind,
      title: "",
      category: "道具",
      quantity: 1,
      holder: "",
      description: "",
    };
  if (kind === "intel")
    return { kind, title: "", category: "线索", content: "", resolved: false };
  if (kind === "achievement")
    return {
      kind,
      title: "",
      recipient: "团队",
      description: "",
      quality: "普通",
      url: "",
    };
  return {
    kind,
    title: "",
    url: "",
    caption: "",
    visibility: role === "GM" ? "gm" : "players",
  };
}
function Picture({
  art,
  className = "",
  retry = true,
}: {
  art: Pick<Artwork, "url" | "title">;
  className?: string;
  retry?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [art.url]);
  return failed ? (
    <div className={`image-fallback ${className}`}>
      <Symbol kind="art" />
      <span>图片暂时无法加载</span>
      {retry && (
        <button type="button" onClick={() => setFailed(false)}>
          重试
        </button>
      )}
    </div>
  ) : (
    <img
      className={className}
      src={
        art.url === WELCOME_ACHIEVEMENT.url
          ? "/achievements/welcome.svg"
          : art.url
      }
      alt={art.title}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
function Modal({
  children,
  onClose,
  label,
  large = false,
  locked = false,
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
  large?: boolean;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={large ? "large-dialog" : ""}
      aria-label={label}
      onCancel={(e) => {
        if (locked) e.preventDefault();
      }}
      onClose={onClose}
    >
      {children}
    </dialog>
  );
}
function App() {
  const [state, setState] = useState<Snapshot>(emptySnapshot),
    [tab, setTab] = useState<Tab>("item"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("全部"),
    [editor, setEditor] = useState<Editor | null>(null),
    [moneyEditor, setMoneyEditor] = useState<Snapshot["money"] | null>(null),
    [view, setView] = useState<Artwork | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<"trash" | "ledger" | null>(
    null,
  );
  const [savedDraft, setSavedDraft] = useState<Editor | null>(null);
  const [draftWarning, setDraftWarning] = useState("");
  const [transactionOpen, setTransactionOpen] = useState<
    Snapshot["money"] | null
  >(null);
  const [savedMoneyDraft, setSavedMoneyDraft] = useState<MoneyDraft | null>(
    null,
  );
  const [financialDraft, setFinancialDraft] = useState<MoneyDraft | null>(null);
  const lock = useRef(false);
  useEffect(() => store.subscribe(setState), []);
  useEffect(() => {
    setView((previous) =>
      previous
        ? (state.entries.find(
            (entry): entry is Artwork =>
              entry.kind === "art" && entry.id === previous.id,
          ) ?? null)
        : null,
    );
    setEditor((previous) =>
      previous?.previous &&
      ![...state.entries, ...state.achievements].some(
        (entry) => entry.id === previous.previous!.id,
      )
        ? null
        : previous,
    );
  }, [state.entries, state.achievements]);
  useEffect(() => {
    setEditor((previous) =>
      previous?.draft.kind === "art" || previous?.draft.kind === "achievement"
        ? null
        : previous,
    );
    setView(null);
    setSavedDraft(null);
    setHistoryOpen(null);
    setTransactionOpen(null);
  }, [state.role]);
  useEffect(() => {
    setEditor(null);
    setMoneyEditor(null);
    setView(null);
    setHistoryOpen(null);
    setTransactionOpen(null);
    setSavedDraft(null);
    setDraftWarning("");
    setSavedMoneyDraft(null);
    setFinancialDraft(null);
    if (state.role !== "GM") setStorageOpen(false);
    if (!state.ready || !state.localScope) return;
    try {
      const saved = readLocal<Editor | null>(state.localScope, "draft", null);
      if (
        saved &&
        (!["item", "intel", "art", "achievement"].includes(saved.draft?.kind) ||
          typeof saved.draft?.title !== "string")
      )
        throw Error("本机草稿格式错误");
      setSavedDraft(saved);
      setSavedMoneyDraft(
        readLocal<MoneyDraft | null>(state.localScope, "money-draft", null),
      );
    } catch {
      setDraftWarning("无法读取本机草稿，请检查浏览器存储权限。");
    }
  }, [state.localScope, state.ready, state.role]);
  function rememberDraft(draft: Draft) {
    if (!editor || !state.localScope) return;
    const saved = { ...editor, draft };
    try {
      writeLocal(state.localScope, "draft", saved);
      setSavedDraft(saved);
      setDraftWarning("");
    } catch {
      setDraftWarning("草稿未能保存到本机；关闭或刷新页面可能丢失未提交内容。");
    }
  }
  function forgetDraft() {
    if (state.localScope) {
      try {
        clearLocal(state.localScope, "draft");
        setSavedDraft(null);
      } catch {
        setDraftWarning("资料已处理，但旧草稿未能清除。");
      }
    }
  }
  function rememberMoneyDraft(draft: MoneyDraft) {
    if (!state.localScope) return;
    try {
      writeLocal(state.localScope, "money-draft", draft);
      setSavedMoneyDraft(draft);
    } catch {
      setDraftWarning("金钱草稿未能保存到本机，刷新可能丢失未提交内容。");
    }
  }
  function forgetMoneyDraft() {
    if (!state.localScope) return;
    try {
      clearLocal(state.localScope, "money-draft");
      setSavedMoneyDraft(null);
    } catch {
      setDraftWarning("余额已处理，但旧金钱草稿未能清除，请勿重复提交收支。");
    }
  }
  useEffect(() => {
    if (!store.demo)
      OBR.onReady(() => {
        void OBR.action.setWidth(760).catch((e) => setError(String(e)));
        void OBR.action.setHeight(700).catch((e) => setError(String(e)));
        void OBR.action.setTitle("团队手记").catch((e) => setError(String(e)));
        void OBR.action
          .setIcon("/icon.svg?v=0.4.0")
          .catch((e) => setError(String(e)));
      });
  }, []);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function changeTab(next: Tab) {
    setTab(next);
    setSearch("");
    setFilter("全部");
    setError("");
    setNotice("");
  }
  const entries: Entry[] =
    tab === "achievement"
      ? state.achievements
      : state.entries.filter((e) => e.kind === tab);
  const query = search.trim().toLocaleLowerCase();
  const visible = entries.filter((e) => {
    const content =
      e.kind === "item"
        ? `${e.title} ${e.holder} ${e.description}`
        : e.kind === "intel"
          ? `${e.title} ${e.content}`
          : e.kind === "achievement"
            ? `${e.title} ${e.recipient} ${e.description} ${e.quality}`
            : `${e.title} ${e.caption}`;
    return (
      content.toLocaleLowerCase().includes(query) &&
      (filter === "全部" ||
        (e.kind === "intel" && filter === "已整理"
          ? e.resolved
          : (e.kind === "item" || e.kind === "intel") && e.category === filter))
    );
  });
  const shown = state.entries.find(
    (e): e is Artwork => e.kind === "art" && e.id === state.shownId,
  );
  return (
    <main className="app-shell">
      {store.demo && (
        <div className="demo-bar">
          <span className="live-dot" />
          本地演示<span>安装到 Owlbear 后与房间队友共享</span>
        </div>
      )}
      <header className="app-header">
        <Book size={20} />
        <span className="brand-name">团队手记</span>
        {state.role === "GM" && store.storage && (
          <button
            className="quiet storage-open"
            title="仅 DM 可管理存储来源与模组资料库"
            aria-label="存储设置"
            disabled={busy}
            onClick={() => {
              setError("");
              setStorageOpen(true);
            }}
          >
            ⚙
          </button>
        )}
        <span
          className={`room-usage${state.bytes >= 14000 ? " usage-warning" : ""}`}
          aria-label="共享数据占用"
          title={
            state.ready && !state.error
              ? state.storage?.mode === "cloud"
                ? `当前云端共享资料 ${state.bytes.toLocaleString()} B；房间共享数据 ${state.storage.roomBytes.toLocaleString()} / 16,000 B。DM 云端私密插画单独保存，不计入此处。`
                : `${state.bytes.toLocaleString()} B；按整个房间 metadata 的 JSON UTF-8 字节测算，包含其他插件。16 kB = 16,000 B。${store.demo ? "当前为本地演示数据。" : ""}`
              : "等待成功读取房间共享数据"
          }
        >
          {state.storage?.mode === "cloud"
            ? `云端 · ${state.storage.label}`
            : store.demo
              ? "演示数据"
              : "房间共享"}{" "}
          {state.ready && !state.error
            ? state.storage?.mode === "cloud"
              ? `${(state.bytes / 1000).toFixed(2)} kB`
              : `${(state.bytes / 1000).toFixed(2)} / 16 kB`
            : "— / 16 kB"}
        </span>
      </header>
      <nav className="tabs" aria-label="资料分区">
        {(
          [
            ["item", "团队仓库"],
            ["intel", "情报"],
            ["art", "插画"],
            ["achievement", "成就"],
          ] as const
        ).map(([kind, label]) => (
          <button
            key={kind}
            aria-current={tab === kind ? "page" : undefined}
            disabled={busy}
            onClick={() => changeTab(kind)}
          >
            <Symbol kind={kind} />
            {label}
            <span>
              {kind === "achievement"
                ? state.achievements.length
                : state.entries.filter((e) => e.kind === kind).length}
            </span>
          </button>
        ))}
        <div className="shared-label">
          <span className="live-dot" />
          {store.demo ? "演示资料" : "全队共享"}
        </div>
      </nav>
      <section
        className="content"
        aria-label={
          tab === "item"
            ? "团队仓库"
            : tab === "intel"
              ? "情报"
              : tab === "achievement"
                ? "成就"
                : "插画"
        }
      >
        {(error || state.error) && (
          <div className="alert" role="alert">
            {error || state.error}
            <button
              className="quiet"
              disabled={busy}
              onClick={() => run(() => store.refresh())}
            >
              重新读取
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {state.localWarning && (
          <p className="alert" role="alert">
            {state.localWarning}
          </p>
        )}
        {draftWarning && (
          <p className="alert" role="alert">
            {draftWarning}
          </p>
        )}
        {savedMoneyDraft && !moneyEditor && !transactionOpen && state.ready && (
          <div className="draft-banner">
            <span>有未保存的金钱草稿（仅本机）</span>
            <button
              className="quiet"
              onClick={() => {
                setFinancialDraft(savedMoneyDraft);
                setError("");
                if (savedMoneyDraft.kind === "balance")
                  setMoneyEditor(savedMoneyDraft.base);
                else setTransactionOpen(savedMoneyDraft.base);
              }}
            >
              继续金钱草稿
            </button>
            <button className="quiet" onClick={forgetMoneyDraft}>
              丢弃金钱草稿
            </button>
          </div>
        )}
        {savedDraft &&
          !editor &&
          state.ready &&
          (state.role === "GM" ||
            (savedDraft.draft.kind !== "achievement" &&
              !(
                savedDraft.draft.kind === "art" &&
                savedDraft.draft.visibility === "gm"
              ))) && (
            <div className="draft-banner">
              <span>
                有未保存草稿：{savedDraft.draft.title || "未命名资料"}（仅本机）
              </span>
              <button
                className="quiet"
                onClick={() => {
                  setEditor(savedDraft);
                  setError("");
                }}
              >
                继续编辑草稿
              </button>
              <button className="quiet" onClick={forgetDraft}>
                丢弃草稿
              </button>
            </div>
          )}
        {!state.ready && !state.error && (
          <p className="empty">正在连接团队资料…</p>
        )}
        {tab === "item" && (
          <section className="treasury" aria-label="团队金钱">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PARTY TREASURY</p>
                <h2>团队金钱</h2>
              </div>
              <div className="actions">
                <button
                  className="quiet"
                  disabled={busy || !state.ready}
                  onClick={() => {
                    setFinancialDraft(null);
                    setTransactionOpen(structuredClone(state.money));
                  }}
                >
                  记一笔收支
                </button>
                <button
                  className="quiet"
                  disabled={busy || !state.ready}
                  onClick={() => setHistoryOpen("ledger")}
                >
                  收支流水
                </button>
                <button
                  className="quiet"
                  disabled={busy || !state.ready}
                  onClick={() => {
                    setFinancialDraft(null);
                    setMoneyEditor(structuredClone(state.money));
                  }}
                >
                  <Symbol kind="edit" />
                  调整金钱
                </button>
              </div>
            </div>
            <div className="coin-grid">
              {COINS.map((c) => (
                <div className={`coin ${c}`} key={c}>
                  <span className="coin-label">
                    <i />
                    {COIN_LABELS[c]} <small>{c.toUpperCase()}</small>
                  </span>
                  <strong aria-label={COIN_LABELS[c] + "余额"}>
                    {state.money[c].value.toLocaleString()}
                  </strong>
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === "art" && (
          <section className="stage" aria-label="当前展示">
            <div className="stage-top">
              <span className="eyebrow">
                {shown ? "CURRENTLY ON DISPLAY" : "SHARED GALLERY"}
              </span>
              <span>
                {shown ? "全队面板同步展示" : "把旅途中的画面留在这里"}
              </span>
            </div>
            {shown ? (
              <>
                <button
                  className="stage-image"
                  aria-label={`查看大图：${shown.title}`}
                  onClick={() => setView(shown)}
                >
                  <Picture art={shown} retry={false} />
                </button>
                <div className="stage-caption">
                  <div>
                    <h2>{shown.title}</h2>
                    <p>{shown.caption || "暂无说明"}</p>
                  </div>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => run(() => store.show(null))}
                  >
                    结束展示
                  </button>
                </div>
              </>
            ) : (
              <div className="stage-empty">
                <Book size={42} />
                <h2>尚未展示插画</h2>
                <p>从图库选择或从链接导入后，点击「展示给全队」。</p>
              </div>
            )}
          </section>
        )}
        <div className="section-heading list-heading">
          <div>
            <p className="eyebrow">
              {tab === "item"
                ? "SHARED INVENTORY"
                : tab === "intel"
                  ? "FIELD NOTES"
                  : tab === "achievement"
                    ? "PARTY ACHIEVEMENTS"
                    : "ILLUSTRATIONS"}
            </p>
            <h2>
              {tab === "item"
                ? "道具与装备"
                : tab === "intel"
                  ? "我们的发现"
                  : tab === "achievement"
                    ? "我们的成就"
                    : "插画收藏"}
              <span className="count">{entries.length}</span>
            </h2>
          </div>
          {tab === "art" ? (
            <div className="actions">
              <button
                className="secondary"
                disabled={busy || !state.ready || store.demo}
                title={
                  store.demo
                    ? "Owlbear 图库在房间内可用"
                    : "从自己的 Owlbear 图库选择图片"
                }
                onClick={() =>
                  run(async () => {
                    const image = await store.pick();
                    if (image)
                      setEditor({
                        draft: {
                          ...fresh("art", state.role),
                          ...image,
                        } as Draft,
                      });
                  })
                }
              >
                从图库选择
              </button>
              <button
                className="primary"
                disabled={busy || !state.ready}
                onClick={() => setEditor({ draft: fresh("art", state.role) })}
              >
                从链接导入
              </button>
            </div>
          ) : tab !== "achievement" || state.role === "GM" ? (
            <button
              className="primary"
              disabled={busy || !state.ready}
              onClick={() => setEditor({ draft: fresh(tab) })}
            >
              ＋{" "}
              {tab === "item"
                ? "添加物品"
                : tab === "achievement"
                  ? "添加成就"
                  : "记录情报"}
            </button>
          ) : null}
        </div>
        {tab === "art" && state.role === "GM" && (
          <p className="gallery-note">
            {state.privateArtMessage ||
              (state.privateArtStorage === "cloud"
                ? "仅 DM 可见的插画已使用云端私密存储，按模组、房间和 DM 账号隔离；清除网站数据不会删除云端记录，但需重新导入管理配置才能读取。改为玩家可见后才会同步给全队。"
                : "枭雄房间模式下，仅 DM 可见的插画只保存在此账号、此房间的当前浏览器中；清除网站数据会丢失记录。改为玩家可见后才会同步给全队。")}
          </p>
        )}
        <div className="filters">
          <label className="search">
            <Symbol kind="search" />
            <input
              aria-label="搜索资料"
              placeholder={
                tab === "item"
                  ? "搜索物品、保管人…"
                  : tab === "intel"
                    ? "搜索标题或情报内容…"
                    : tab === "achievement"
                      ? "搜索成就、达成人…"
                      : "搜索插画…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {(tab === "item" || tab === "intel") && (
            <select
              aria-label="筛选分类"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {(tab === "item"
                ? ["全部", "道具", "装备"]
                : ["全部", "线索", "人物", "地点", "其他", "已整理"]
              ).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          )}
        </div>
        <div
          className={
            tab === "achievement"
              ? "achievement-list"
              : tab === "art"
                ? "gallery"
                : tab === "intel"
                  ? "intel-grid"
                  : "inventory"
          }
        >
          {visible.map((entry) =>
            entry.kind === "item" ? (
              <article key={entry.id} className="item-row">
                <div className="item-icon">
                  <Symbol kind="item" />
                </div>
                <div className="item-info">
                  <div className="item-title">
                    <h3>
                      {entry.pinned && <span title="已置顶">★ </span>}
                      {entry.title}
                    </h3>
                    <span className="tag">{entry.category}</span>
                  </div>
                  {entry.description && <p>{entry.description}</p>}
                  <span className="holder">
                    {entry.holder ? `保管：${entry.holder}` : "团队共有"}
                  </span>
                </div>
                <div className="quantity">
                  <strong>{entry.quantity}</strong>
                  <span>数量</span>
                  <div className="quantity-actions">
                    <button
                      className="quiet"
                      aria-label={`减少数量：${entry.title}`}
                      disabled={busy || !state.ready || entry.quantity === 0}
                      onClick={() => run(() => store.adjustQuantity(entry, -1))}
                    >
                      −
                    </button>
                    <button
                      className="quiet"
                      aria-label={`增加数量：${entry.title}`}
                      disabled={
                        busy || !state.ready || entry.quantity >= 999999
                      }
                      onClick={() => run(() => store.adjustQuantity(entry, 1))}
                    >
                      ＋
                    </button>
                  </div>
                </div>
                <button
                  className="icon-button"
                  aria-label={`编辑${entry.title}`}
                  title="编辑物品"
                  disabled={busy || !state.ready}
                  onClick={() =>
                    setEditor({ draft: { ...entry }, previous: entry })
                  }
                >
                  <Symbol kind="edit" />
                </button>
              </article>
            ) : entry.kind === "intel" ? (
              <article
                key={entry.id}
                className={"intel-card " + (entry.resolved ? "resolved" : "")}
              >
                <div className="card-heading">
                  <span className="tag">{entry.category}</span>
                  <button
                    className="icon-button"
                    aria-label={`编辑${entry.title}`}
                    title="编辑情报"
                    disabled={busy || !state.ready}
                    onClick={() =>
                      setEditor({ draft: { ...entry }, previous: entry })
                    }
                  >
                    <Symbol kind="edit" />
                  </button>
                </div>
                <h3>
                  {entry.pinned && <span title="已置顶">★ </span>}
                  {entry.title}
                </h3>
                <p className="intel-body">{entry.content}</p>
                <button
                  className="resolve-button"
                  disabled={busy || !state.ready}
                  aria-label={`${entry.resolved ? "重新跟进" : "标记已整理"}：${entry.title}`}
                  onClick={() =>
                    run(() =>
                      store.save(
                        { ...entry, resolved: !entry.resolved },
                        entry,
                      ),
                    )
                  }
                >
                  <span>{entry.resolved ? "✓" : "○"}</span>
                  {entry.resolved ? "已整理" : "跟进中"}
                </button>
              </article>
            ) : entry.kind === "achievement" ? (
              <article
                key={entry.id}
                className={`achievement-card quality-${QUALITIES.indexOf(entry.quality)}`}
              >
                <div className="achievement-icon">
                  <Picture art={entry} />
                </div>
                <div className="achievement-copy">
                  <div className="achievement-title">
                    <h3>
                      {entry.pinned && <span title="已置顶">★ </span>}
                      {entry.title}
                    </h3>
                    <span className="quality-badge">{entry.quality}</span>
                  </div>
                  <p>{entry.description}</p>
                  <span className="achievement-recipient">
                    {entry.recipient}
                  </span>
                </div>
                {state.role === "GM" && (
                  <button
                    className="icon-button achievement-edit"
                    aria-label={`编辑${entry.title}`}
                    title="编辑成就"
                    disabled={busy || !state.ready}
                    onClick={() =>
                      setEditor({ draft: { ...entry }, previous: entry })
                    }
                  >
                    <Symbol kind="edit" />
                  </button>
                )}
              </article>
            ) : (
              <article
                key={entry.id}
                className={
                  "art-card " + (state.shownId === entry.id ? "on-display" : "")
                }
              >
                <button
                  className="thumbnail"
                  aria-label={`查看大图：${entry.title}`}
                  onClick={() => setView(entry)}
                >
                  <Picture art={entry} retry={false} />
                  {state.shownId === entry.id && (
                    <span className="display-badge">正在展示</span>
                  )}
                </button>
                <div className="art-card-content">
                  <span
                    className={`visibility-label ${entry.visibility === "gm" ? "private" : ""}`}
                  >
                    {entry.visibility === "gm"
                      ? `仅 DM 可见 · ${state.privateArtStorage === "cloud" ? "云端" : "本机"}`
                      : "玩家可见"}
                  </span>
                  <h3>
                    {entry.pinned && <span title="已置顶">★ </span>}
                    {entry.title}
                  </h3>
                  {entry.caption && <p>{entry.caption}</p>}
                  <div className="art-actions">
                    <button
                      className="quiet"
                      disabled={
                        busy || !state.ready || entry.visibility === "gm"
                      }
                      title={
                        entry.visibility === "gm"
                          ? "先设为玩家可见，再展示给全队"
                          : undefined
                      }
                      onClick={() => run(() => store.show(entry.id))}
                    >
                      {state.shownId === entry.id ? "正在展示" : "展示给全队"}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`编辑${entry.title}`}
                      title="编辑插画"
                      disabled={busy || !state.ready}
                      onClick={() =>
                        setEditor({ draft: { ...entry }, previous: entry })
                      }
                    >
                      <Symbol kind="edit" />
                    </button>
                  </div>
                  {state.role === "GM" && (
                    <button
                      className="visibility-toggle quiet"
                      disabled={busy || !state.ready}
                      aria-label={`${entry.visibility === "gm" ? "设为玩家可见" : "设为仅 DM 可见"}：${entry.title}`}
                      onClick={() =>
                        run(() =>
                          store.save(
                            {
                              ...entry,
                              visibility:
                                entry.visibility === "gm" ? "players" : "gm",
                            },
                            entry,
                          ),
                        )
                      }
                    >
                      {entry.visibility === "gm"
                        ? "设为玩家可见"
                        : "设为仅 DM 可见"}
                    </button>
                  )}
                </div>
              </article>
            ),
          )}
        </div>
        {state.ready && !visible.length && (
          <div className="empty-state">
            <Symbol kind={tab} />
            <h3>
              {query || filter !== "全部"
                ? "没有找到相关资料"
                : tab === "item"
                  ? "团队仓库还是空的"
                  : tab === "intel"
                    ? "等待第一条发现"
                    : tab === "achievement"
                      ? "下一段旅程，新的成就"
                      : "收藏第一张旅途插画"}
            </h3>
            <p>
              {query || filter !== "全部"
                ? "试试其他关键词或分类。"
                : tab === "achievement"
                  ? "由 DM 记录成就，所有人都能看到。"
                  : "玩家和 DM 都可以添加和编辑。"}
            </p>
          </div>
        )}
      </section>
      <footer className="app-footer">
        <button
          className="quiet"
          disabled={busy || !state.ready}
          onClick={() => setHistoryOpen("trash")}
        >
          最近删除（{state.trash.length}）
        </button>
        <span>
          <span className={"live-dot " + (!state.ready ? "offline" : "")} />
          {state.ready
            ? state.storage?.mode === "cloud"
              ? "已连接云端资料"
              : store.demo
                ? "资料保存在当前浏览器"
                : "已连接房间资料"
            : "等待连接"}
        </span>
        <span>
          {tab === "achievement"
            ? "仅 DM 可编辑 · 全队可见"
            : "玩家 · DM 均可编辑"}
        </span>
      </footer>
      {editor && (
        <Modal
          locked={busy}
          label={editor.previous ? "编辑资料" : "添加资料"}
          onClose={() => {
            if (!busy) {
              setEditor(null);
              setError("");
            }
          }}
        >
          <EntryEditor
            onDraftChange={rememberDraft}
            isGM={state.role === "GM"}
            editor={editor}
            busy={busy}
            error={error}
            onCancel={() => {
              setEditor(null);
              setError("");
            }}
            onSave={(draft) =>
              run(async () => {
                await store.save(draft, editor.previous);
                forgetDraft();
                setEditor(null);
                setNotice("资料已保存");
              })
            }
            onDelete={() =>
              run(async () => {
                await store.remove(editor.previous!);
                forgetDraft();
                setEditor(null);
                setNotice("条目已移除");
              })
            }
          />
        </Modal>
      )}
      {storageOpen && state.role === "GM" && (
        <Modal
          locked={busy}
          label="存储设置"
          onClose={() => {
            if (!busy) setStorageOpen(false);
          }}
        >
          <>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <StorageSettings
              store={store}
              busy={busy}
              onRun={run}
              onClose={() => setStorageOpen(false)}
            />
          </>
        </Modal>
      )}
      {moneyEditor && (
        <Modal
          locked={busy}
          label="调整团队金钱"
          onClose={() => {
            if (!busy) {
              setMoneyEditor(null);
              setError("");
            }
          }}
        >
          <MoneyEditor
            initialValues={financialDraft?.values}
            onDraftChange={(values) =>
              rememberMoneyDraft({
                kind: "balance",
                base: moneyEditor,
                values,
                direction: 1,
                reason: "余额调整",
                record: true,
              })
            }
            base={moneyEditor}
            busy={busy}
            error={error}
            onCancel={() => {
              setMoneyEditor(null);
              setError("");
            }}
            onSave={(values) =>
              run(async () => {
                await store.money(values, moneyEditor);
                forgetMoneyDraft();
                setMoneyEditor(null);
                setNotice("团队金钱已更新");
              })
            }
          />
        </Modal>
      )}
      {transactionOpen && (
        <Modal
          label="记录收支"
          locked={busy}
          onClose={() => {
            if (!busy) setTransactionOpen(null);
          }}
        >
          <TransactionEditor
            busy={busy}
            error={error}
            cloud={state.storage?.mode === "cloud"}
            initial={financialDraft}
            onDraftChange={(draft) =>
              rememberMoneyDraft({
                ...draft,
                kind: "transaction",
                base: transactionOpen,
              })
            }
            onCancel={() => setTransactionOpen(null)}
            onSave={(values, reason, record) =>
              run(async () => {
                await store.transact(values, transactionOpen, reason, record);
                forgetMoneyDraft();
                setTransactionOpen(null);
                setNotice("收支已记录");
              })
            }
          />
        </Modal>
      )}
      {historyOpen && (
        <Modal
          label={historyOpen === "trash" ? "最近删除" : "收支流水"}
          locked={busy}
          onClose={() => {
            if (!busy) setHistoryOpen(null);
          }}
        >
          <h2>{historyOpen === "trash" ? "最近删除" : "收支流水"}</h2>
          <p className="gallery-note">
            {historyOpen === "trash"
              ? state.storage?.mode === "cloud"
                ? "云端共享回收记录；私密插画仍仅 DM 可见。恢复不会覆盖已有条目。"
                : "共享条目的回收副本仅保存在删除者当前浏览器，最近 50 条；私密插画留在 DM 本机私密存储。清除网站数据会丢失本机副本。"
              : state.storage?.mode === "cloud"
                ? "全队可见的云端流水，保留最近 100 笔。"
                : "仅本账号、此房间、当前浏览器的流水，保留最近 100 笔；不占房间共享空间。"}
          </p>
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
          <div className="history-list">
            {historyOpen === "trash"
              ? state.trash.map((entry) => (
                  <article className="history-row" key={entry.id}>
                    <div>
                      <strong>{entry.title}</strong>
                      <small>
                        {new Date(entry.deletedAt!).toLocaleString()}
                        {entry.kind === "art" && entry.visibility === "gm"
                          ? " · 仅 DM 可见"
                          : ""}
                      </small>
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await store.restore(entry);
                          setNotice("条目已恢复");
                        })
                      }
                    >
                      恢复
                    </button>
                  </article>
                ))
              : state.ledger.map((record) => (
                  <article className="history-row" key={record.id}>
                    <div>
                      <strong>{record.reason}</strong>
                      <small>{new Date(record.at).toLocaleString()}</small>
                    </div>
                    <span>
                      {COINS.filter((c) => record.changes[c])
                        .map(
                          (c) =>
                            `${COIN_LABELS[c]} ${(record.changes[c] ?? 0) > 0 ? "+" : ""}${record.changes[c]}`,
                        )
                        .join(" · ")}
                    </span>
                  </article>
                ))}
            {(historyOpen === "trash"
              ? !state.trash.length
              : !state.ledger.length) && <p className="empty">暂无记录</p>}
          </div>
          <div className="form-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setHistoryOpen(null)}
            >
              关闭
            </button>
          </div>
        </Modal>
      )}
      {view && (
        <Modal
          label={`插画：${view.title}`}
          large
          onClose={() => setView(null)}
        >
          <div className="viewer-heading">
            <div>
              <p className="eyebrow">ILLUSTRATION</p>
              <h2>{view.title}</h2>
            </div>
            <button className="secondary" onClick={() => setView(null)}>
              返回插画
            </button>
          </div>
          <Picture art={view} className="full-image" />
          {view.caption && <p className="viewer-caption">{view.caption}</p>}
        </Modal>
      )}
    </main>
  );
}
function EntryEditor({
  onDraftChange,
  isGM,
  editor,
  busy,
  error,
  onCancel,
  onSave,
  onDelete,
}: {
  onDraftChange: (draft: Draft) => void;
  isGM: boolean;
  editor: Editor;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSave: (draft: Draft) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(editor.draft),
    [confirm, setConfirm] = useState(false);
  const update = (key: string, value: string | number | boolean) => {
    const next = { ...draft, [key]: value } as Draft;
    setDraft(next);
    onDraftChange(next);
  };
  const label =
    draft.kind === "item"
      ? "物品"
      : draft.kind === "intel"
        ? "情报"
        : draft.kind === "achievement"
          ? "成就"
          : "插画";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(draft);
      }}
    >
      <div className="dialog-heading">
        <p className="eyebrow">TEAM JOURNAL</p>
        <h2>
          {editor.previous ? "编辑" : "添加"}
          {label}
        </h2>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <div className="form-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={!!draft.pinned}
              onChange={(e) => update("pinned", e.target.checked)}
            />
            置顶
          </label>
          <label>
            排序（越小越靠前）
            <input
              aria-label="排序"
              type="number"
              min="0"
              max="999999"
              step="1"
              required
              value={Number.isNaN(draft.order) ? "" : (draft.order ?? 0)}
              onChange={(e) =>
                update(
                  "order",
                  e.target.value === "" ? NaN : Number(e.target.value),
                )
              }
            />
          </label>
        </div>
        <p className="gallery-note">
          置顶条目优先；同组按排序值升序，相同值按最近更新。未保存修改会留在本机草稿中。
        </p>
        <label>
          {draft.kind === "item"
            ? "名称"
            : draft.kind === "achievement"
              ? "成就名"
              : "标题"}
          <input
            autoFocus
            required
            maxLength={80}
            value={draft.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder={
              draft.kind === "item" ? "例如：治疗药水" : "给这条资料起个名字"
            }
          />
        </label>
        {draft.kind === "item" && (
          <>
            <div className="form-row">
              <label>
                分类
                <select
                  aria-label="分类"
                  value={draft.category}
                  onChange={(e) => update("category", e.target.value)}
                >
                  <option>道具</option>
                  <option>装备</option>
                </select>
              </label>
              <label>
                数量
                <input
                  type="number"
                  required
                  min="0"
                  max="999999"
                  step="1"
                  value={Number.isFinite(draft.quantity) ? draft.quantity : ""}
                  onChange={(e) =>
                    update(
                      "quantity",
                      e.target.value === "" ? NaN : Number(e.target.value),
                    )
                  }
                />
              </label>
            </div>
            <label>
              保管人
              <input
                maxLength={60}
                placeholder="留空表示团队共有"
                value={draft.holder}
                onChange={(e) => update("holder", e.target.value)}
              />
            </label>
            <label>
              物品说明
              <textarea
                aria-label="物品说明"
                rows={4}
                maxLength={1200}
                value={draft.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="用途、属性、获得地点或分配备注…"
              />
            </label>
          </>
        )}
        {draft.kind === "intel" && (
          <>
            <div className="form-row">
              <label>
                分类
                <select
                  aria-label="分类"
                  value={draft.category}
                  onChange={(e) => update("category", e.target.value)}
                >
                  {["线索", "人物", "地点", "其他"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.resolved}
                  onChange={(e) => update("resolved", e.target.checked)}
                />
                已整理
              </label>
            </div>
            <label>
              情报正文
              <textarea
                aria-label="情报正文"
                required
                rows={8}
                maxLength={5000}
                value={draft.content}
                onChange={(e) => update("content", e.target.value)}
                placeholder="记录你们知道的事、尚未解开的疑问，以及下一步的打算。"
              />
            </label>
          </>
        )}
        {draft.kind === "art" && (
          <>
            {isGM && (
              <label>
                插画可见性
                <select
                  aria-label="插画可见性"
                  value={draft.visibility ?? "players"}
                  onChange={(e) => update("visibility", e.target.value)}
                >
                  <option value="gm">仅 DM 可见</option>
                  <option value="players">玩家可见</option>
                </select>
              </label>
            )}
            <label>
              图片地址
              <input
                required
                type={draft.url.startsWith("data:") ? "text" : "url"}
                readOnly={draft.url.startsWith("data:")}
                value={
                  draft.url.startsWith("data:")
                    ? "本地演示图片（已读取）"
                    : draft.url
                }
                onChange={(e) => update("url", e.target.value)}
                placeholder="https://…"
              />
            </label>
            {draft.url && (
              <img
                className="editor-preview"
                src={draft.url}
                alt="插画预览"
                referrerPolicy="no-referrer"
              />
            )}
            <label>
              插画说明
              <textarea
                aria-label="插画说明"
                rows={3}
                maxLength={1000}
                value={draft.caption}
                onChange={(e) => update("caption", e.target.value)}
                placeholder="为图片补充标题之外的故事或注释…"
              />
            </label>
          </>
        )}
        {draft.kind === "achievement" && (
          <>
            <div className="form-row">
              <label>
                达成人
                <input
                  required
                  maxLength={120}
                  value={draft.recipient}
                  onChange={(e) => update("recipient", e.target.value)}
                />
              </label>
              <label>
                品质
                <select
                  aria-label="品质"
                  value={draft.quality}
                  onChange={(e) => update("quality", e.target.value)}
                >
                  {QUALITIES.map((quality) => (
                    <option key={quality}>{quality}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              描述
              <textarea
                aria-label="描述"
                required
                rows={3}
                maxLength={1000}
                value={draft.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </label>
            <label>
              配图链接
              <input
                aria-label="配图链接"
                required
                type="url"
                value={draft.url}
                onChange={(e) => update("url", e.target.value)}
                placeholder="https://…"
              />
            </label>
            {draft.url && (
              <div className="achievement-preview">
                <Picture art={draft} />
              </div>
            )}
          </>
        )}
        {confirm && (
          <div className="delete-confirm">
            <p>
              确认移除「{editor.previous?.title}」？
              {draft.kind === "art"
                ? "原图库图片会保留。"
                : "移除后可在「最近删除」恢复。"}
            </p>
            <button
              type="button"
              className="danger-button"
              onClick={() => void onDelete()}
            >
              确认移除
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => setConfirm(false)}
            >
              保留条目
            </button>
          </div>
        )}
        <div className="form-actions">
          {editor.previous && (
            <button
              className="quiet danger"
              type="button"
              onClick={() => setConfirm(true)}
            >
              移除条目
            </button>
          )}
          <div />
          <button className="secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary" type="submit">
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function TransactionEditor({
  busy,
  error,
  cloud,
  initial,
  onDraftChange,
  onCancel,
  onSave,
}: {
  initial: MoneyDraft | null;
  onDraftChange: (draft: Omit<MoneyDraft, "kind" | "base">) => void;
  busy: boolean;
  error: string;
  cloud: boolean;
  onCancel: () => void;
  onSave: (
    values: Record<Coin, number>,
    reason: string,
    record: boolean,
  ) => Promise<void>;
}) {
  const [direction, setDirection] = useState(initial?.direction ?? 1);
  const [values, setValues] = useState(
    initial?.values ??
      (Object.fromEntries(COINS.map((c) => [c, 0])) as Record<Coin, number>),
  );
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [record, setRecord] = useState(initial?.record ?? true);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) onDraftChange({ direction, values, reason, record });
    started.current = true;
  }, [direction, values, reason, record]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!COINS.some((c) => values[c] > 0)) return;
        void onSave(
          Object.fromEntries(
            COINS.map((c) => [c, direction * values[c]]),
          ) as Record<Coin, number>,
          reason,
          record,
        );
      }}
    >
      <h2>记录收支</h2>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <label>
          收支类型
          <select
            value={direction}
            onChange={(e) => setDirection(Number(e.target.value))}
          >
            <option value="1">收入</option>
            <option value="-1">支出</option>
          </select>
        </label>
        <div className="money-fields">
          {COINS.map((c) => (
            <label key={c}>
              {COIN_LABELS[c]}
              <input
                type="number"
                required
                min="0"
                max="999999999"
                step="1"
                value={Number.isFinite(values[c]) ? values[c] : ""}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [c]: e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
        <label>
          收支原因
          <input
            required
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：购买补给、任务报酬"
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={record}
            onChange={(e) => setRecord(e.target.checked)}
          />
          {cloud ? "保存到全队可见的云端流水" : "保存到本机流水"}
        </label>
        <p className="gallery-note">
          各币种独立记账，不自动兑换。支出不能超过余额；多人同时修改时会提示重新核对。
        </p>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!COINS.some((c) => values[c] > 0)}
          >
            确认收支
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function MoneyEditor({
  initialValues,
  onDraftChange,
  base,
  busy,
  error,
  onCancel,
  onSave,
}: {
  initialValues?: Record<Coin, number>;
  onDraftChange: (values: Record<Coin, number>) => void;
  base: Snapshot["money"];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSave: (values: Record<Coin, number>) => Promise<void>;
}) {
  const [values, setValues] = useState(
    () =>
      initialValues ??
      (Object.fromEntries(COINS.map((c) => [c, base[c].value])) as Record<
        Coin,
        number
      >),
  );
  const started = useRef(false);
  useEffect(() => {
    if (started.current) onDraftChange(values);
    started.current = true;
  }, [values]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(values);
      }}
    >
      <div className="dialog-heading">
        <p className="eyebrow">PARTY TREASURY</p>
        <h2>调整团队金钱</h2>
        <p>分别记录各类钱币的实际余额。</p>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <div className="money-fields">
          {COINS.map((c) => (
            <label key={c}>
              {COIN_LABELS[c]} · {c.toUpperCase()}
              <input
                type="number"
                min="0"
                max="999999999"
                step="1"
                required
                value={Number.isFinite(values[c]) ? values[c] : ""}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [c]: e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="form-actions">
          <div />
          <button className="secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary" type="submit">
            保存金钱
          </button>
        </div>
      </fieldset>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
