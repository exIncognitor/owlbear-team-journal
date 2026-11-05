import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { createStore } from "./store";
import {
  COINS,
  COIN_LABELS,
  emptySnapshot,
  type Artwork,
  type Coin,
  type Draft,
  type Entry,
  type Intel,
  type Item,
  type Snapshot,
} from "./model";
import "./style.css";

const store = createStore();
type Tab = "item" | "intel" | "art";
type Editor = { draft: Draft; previous?: Entry };
function Moon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M26.9 20.2A12 12 0 0 1 11.8 5.1a12 12 0 1 0 15.1 15.1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m23.5 4.5.8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8Z"
        fill="currentColor"
      />
    </svg>
  );
}
function Symbol({ kind }: { kind: Tab | "search" | "edit" | "download" }) {
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
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
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
function fresh(kind: Tab): Draft {
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
  return { kind, title: "", url: "", caption: "" };
}
function Picture({
  art,
  className = "",
}: {
  art: Artwork;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [art.url]);
  return failed ? (
    <div className={`image-fallback ${className}`}>
      <Symbol kind="art" />
      <span>图片暂时无法加载</span>
      <button type="button" onClick={() => setFailed(false)}>
        重试
      </button>
    </div>
  ) : (
    <img
      className={className}
      src={art.url}
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
  const lock = useRef(false),
    fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => store.subscribe(setState), []);
  useEffect(() => {
    if (!store.demo)
      OBR.onReady(() => {
        void OBR.action.setWidth(760).catch((e) => setError(String(e)));
        void OBR.action.setHeight(700).catch((e) => setError(String(e)));
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
      setError(e instanceof Error ? e.message : String(e));
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
  const entries = state.entries.filter((e) => e.kind === tab);
  const query = search.trim().toLocaleLowerCase();
  const visible = entries.filter((e) => {
    const content =
      e.kind === "item"
        ? `${e.title} ${e.holder} ${e.description}`
        : e.kind === "intel"
          ? `${e.title} ${e.content}`
          : `${e.title} ${e.caption}`;
    return (
      content.toLocaleLowerCase().includes(query) &&
      (filter === "全部" ||
        (e.kind === "intel" && filter === "已整理"
          ? e.resolved
          : e.kind !== "art" && e.category === filter))
    );
  });
  const shown = state.entries.find(
    (e): e is Artwork => e.kind === "art" && e.id === state.shownId,
  );
  async function upload(file: File) {
    await run(async () => {
      setNotice(
        store.demo
          ? "正在读取图片…"
          : "请在 Owlbear 完成上传，再从图库选择刚上传的图片。",
      );
      const result = await store.upload(file);
      setNotice("");
      if (result) setEditor({ draft: { kind: "art", ...result, caption: "" } });
    });
  }
  async function backup() {
    await run(async () => {
      const url = URL.createObjectURL(
        new Blob([await store.backup()], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `歪曲之月-团队备份-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        "已导出团队资料。图库图片保留为引用，原文件仍在 Owlbear 图库中。",
      );
    });
  }
  return (
    <main className="app-shell">
      {store.demo && (
        <div className="demo-bar">
          <span className="live-dot" />
          本地演示<span>安装到 Owlbear 后与房间队友共享</span>
        </div>
      )}
      <header className="app-header">
        <div className="brand-mark">
          <Moon size={34} />
        </div>
        <div className="brand">
          <p>THE TWISTED MOON</p>
          <h1>
            歪曲之月<span>团队手记</span>
          </h1>
        </div>
        <button
          className="quiet backup"
          title="导出团队资料备份"
          aria-label="导出备份"
          disabled={busy}
          onClick={backup}
        >
          <Symbol kind="download" />
          <span>导出备份</span>
        </button>
      </header>
      <nav className="tabs" aria-label="资料分区">
        {(
          [
            ["item", "团队仓库"],
            ["intel", "情报"],
            ["art", "插画"],
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
            <span>{state.entries.filter((e) => e.kind === kind).length}</span>
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
          tab === "item" ? "团队仓库" : tab === "intel" ? "情报" : "插画"
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
              <button
                className="quiet"
                disabled={busy || !state.ready}
                onClick={() => setMoneyEditor(structuredClone(state.money))}
              >
                <Symbol kind="edit" />
                调整金钱
              </button>
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
                  <Picture art={shown} />
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
                <Moon size={42} />
                <h2>尚未展示插画</h2>
                <p>上传或选择图片后，点击「展示给全队」。</p>
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
                  : "ILLUSTRATIONS"}
            </p>
            <h2>
              {tab === "item"
                ? "道具与装备"
                : tab === "intel"
                  ? "我们的发现"
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
                        draft: { kind: "art", ...image, caption: "" },
                      });
                  })
                }
              >
                从图库选择
              </button>
              <button
                className="primary"
                disabled={busy || !state.ready}
                onClick={() => fileRef.current?.click()}
              >
                ＋ 上传插画
              </button>
            </div>
          ) : (
            <button
              className="primary"
              disabled={busy || !state.ready}
              onClick={() => setEditor({ draft: fresh(tab) })}
            >
              ＋ {tab === "item" ? "添加物品" : "记录情报"}
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          hidden
          aria-label="上传插画文件"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
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
                    : "搜索插画…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {tab !== "art" && (
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
          {tab === "art" && (
            <button
              className="quiet"
              disabled={busy || !state.ready}
              onClick={() => setEditor({ draft: fresh("art") })}
            >
              添加图片链接
            </button>
          )}
        </div>
        <div
          className={
            tab === "art"
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
                    <h3>{entry.title}</h3>
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
                <h3>{entry.title}</h3>
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
                  <Picture art={entry} />
                  {state.shownId === entry.id && (
                    <span className="display-badge">正在展示</span>
                  )}
                </button>
                <div className="art-card-content">
                  <h3>{entry.title}</h3>
                  {entry.caption && <p>{entry.caption}</p>}
                  <div className="art-actions">
                    <button
                      className="quiet"
                      disabled={busy || !state.ready}
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
                    : "收藏第一张旅途插画"}
            </h3>
            <p>
              {query || filter !== "全部"
                ? "试试其他关键词或分类。"
                : "玩家和 DM 都可以添加和编辑。"}
            </p>
          </div>
        )}
      </section>
      <footer className="app-footer">
        <span>
          <span className={"live-dot " + (!state.ready ? "offline" : "")} />
          {state.ready
            ? store.demo
              ? "资料保存在当前浏览器"
              : "已连接房间资料"
            : "等待连接"}
        </span>
        <span>玩家 · DM 均可编辑</span>
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
                setEditor(null);
                setNotice("资料已保存");
              })
            }
            onDelete={() =>
              run(async () => {
                await store.remove(editor.previous!);
                setEditor(null);
                setNotice("条目已移除");
              })
            }
          />
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
                setMoneyEditor(null);
                setNotice("团队金钱已更新");
              })
            }
          />
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
  editor,
  busy,
  error,
  onCancel,
  onSave,
  onDelete,
}: {
  editor: Editor;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSave: (draft: Draft) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(editor.draft),
    [confirm, setConfirm] = useState(false);
  const update = (key: string, value: string | number | boolean) =>
    setDraft((previous) => ({ ...previous, [key]: value }) as Draft);
  const label =
    draft.kind === "item" ? "物品" : draft.kind === "intel" ? "情报" : "插画";
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
        <label>
          {draft.kind === "item" ? "名称" : "标题"}
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
                  value={Number.isNaN(draft.quantity) ? "" : draft.quantity}
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
                rows={3}
                maxLength={1000}
                value={draft.caption}
                onChange={(e) => update("caption", e.target.value)}
                placeholder="为图片补充标题之外的故事或注释…"
              />
            </label>
          </>
        )}
        {confirm && (
          <div className="delete-confirm">
            <p>
              确认移除「{editor.previous?.title}」？
              {draft.kind === "art"
                ? "原图库图片会保留。"
                : "需要保留时，可先取消并导出备份。"}
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
function MoneyEditor({
  base,
  busy,
  error,
  onCancel,
  onSave,
}: {
  base: Snapshot["money"];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSave: (values: Record<Coin, number>) => Promise<void>;
}) {
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(COINS.map((c) => [c, base[c].value])) as Record<
        Coin,
        number
      >,
  );
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
                value={Number.isNaN(values[c]) ? "" : values[c]}
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
