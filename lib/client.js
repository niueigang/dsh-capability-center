/**
 * lib/client.js —— 能力中心页面（浏览器半侧）。
 *
 * 加载方式与宿主插件规范一致：window.__ModuleLoader__.load({id, factory})，
 * factory 只注册、不执行；真正干活在 apply(ctx) 里。
 *
 * 页面挂在两个 slot 上，跟宿主自己的「插件」页完全同一套机制：
 *   sidebar.panellist   侧栏入口（图标 + 文案）
 *   main (key=…)        点开后的整页内容
 *
 * 设计口风：豆包「市场 › 管理」——分组卡片、圆形图标、右侧开关、点行开详情、
 * 详情里一键把 `/技能名` 插进对话输入框。
 */
window.__ModuleLoader__.load({
  id: "dsh-capability-center",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo, useCallback } = React;

    const PANEL_ID = "capability-center";
    const API = "/capability/api";
    const NS = "capabilityCenter";

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /* ═════════════════ 取数 ═════════════════ */

    async function getState() {
      const res = await fetch(API + "/state", { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => ({ ok: false, message: "返回不是 JSON" }));
      if (!res.ok || !body.ok) throw new Error(body.message || "读取失败（HTTP " + res.status + "）");
      return body;
    }

    async function postToggle(kind, id, enabled) {
      const res = await fetch(API + "/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, enabled }),
      });
      const body = await res.json().catch(() => ({ ok: false, message: "返回不是 JSON" }));
      if (!res.ok || !body.ok) throw new Error(body.message || "操作失败");
      return body;
    }

    async function getSkillDetail(id) {
      const res = await fetch(API + "/skill?id=" + encodeURIComponent(id), { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => ({ ok: false, message: "返回不是 JSON" }));
      if (!res.ok || !body.ok) throw new Error(body.message || "读取失败");
      return body;
    }

    /* ═════════════════ 把 /技能名 插进对话 ═════════════════ */
    /**
     * 宿主输入框是 Lexical（contenteditable）。直接改 DOM 没用，
     * 必须走它自己的 beforeinput 管线：先 focus + 把光标落到末尾，
     * 等它把 DOM 选区同步进模型（约 150～250ms），再 execCommand 插入。
     * 拿到"文字真的变了"才算成功；全失败就退到剪贴板，不让用户白点。
     */
    async function insertIntoConversation(ctx, text) {
      try {
        if (ctx && ctx.layout && typeof ctx.layout.selectPanel === "function") ctx.layout.selectPanel(null);
      } catch {
        /* 面板切不过去也不要紧，下面还会找输入框 */
      }

      let ed = null;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        ed = document.querySelector("[data-composer-input]");
        if (ed) break;
        await sleep(120);
      }
      if (!ed) return { ok: false, reason: "no-composer" };

      try {
        ed.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(ed);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {
        /* 选区设不上就按默认光标位置插 */
      }

      await sleep(240);
      const before = ed.innerText || "";
      try {
        document.execCommand("insertText", false, text);
      } catch {
        /* 接着试下一种 */
      }
      await sleep(160);
      if ((ed.innerText || "") !== before) return { ok: true };

      try {
        ed.dispatchEvent(
          new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true })
        );
        await sleep(140);
      } catch {
        /* 继续兜底 */
      }
      if ((ed.innerText || "") !== before) return { ok: true };

      try {
        await navigator.clipboard.writeText(text);
        return { ok: false, copied: true };
      } catch {
        return { ok: false, copied: false };
      }
    }

    /* ═════════════════ 样式 ═════════════════ */

    const CSS = `
.cc-root{
  --cc-bg:var(--dsw-alias-bg-layer-1,#fff);
  --cc-bg-soft:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 92%,#eef2f8);
  --cc-fg:var(--dsw-alias-label-primary,#16181d);
  --cc-fg-2:var(--dsw-alias-label-secondary,#5c6370);
  --cc-fg-3:var(--dsw-alias-label-tertiary,#8b93a1);
  --cc-line:var(--dsw-alias-border-l2,#e8ebf0);
  --cc-line-soft:var(--dsw-alias-border-l1,#f0f2f6);
  --cc-accent:#0a84ff;
  --cc-accent-soft:rgba(10,132,255,.1);
  --cc-ok:#17b26a;
  --cc-bad:#e5484d;
  --cc-hover:rgba(15,23,42,.04);
  --cc-shadow:0 1px 2px rgba(16,24,40,.05),0 8px 24px rgba(16,24,40,.06);
  position:relative;display:flex;flex-direction:column;height:100%;min-height:0;
  background:var(--cc-bg);color:var(--cc-fg);
  font:14px/1.55 "Segoe UI","Microsoft YaHei",-apple-system,system-ui,sans-serif;
}
body[data-ds-dark-theme] .cc-root{
  --cc-bg:#151719;
  --cc-bg-soft:#1b1e21;
  --cc-fg:#f2f4f7;
  --cc-fg-2:#a9b0bd;
  --cc-fg-3:#7d8593;
  --cc-line:#2a2e34;
  --cc-line-soft:#23272c;
  --cc-hover:rgba(255,255,255,.05);
  --cc-shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.34);
}

.cc-head{
  position:sticky;top:0;z-index:6;display:flex;align-items:flex-start;gap:16px;
  padding:max(18px,var(--dsh-frame-top-clearance,0px)) 32px 14px;
  background:color-mix(in srgb,var(--cc-bg) 88%,transparent);
  -webkit-backdrop-filter:blur(14px) saturate(1.1);backdrop-filter:blur(14px) saturate(1.1);
  border-bottom:1px solid var(--cc-line-soft);
}
.cc-crumb{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--cc-fg-3);margin-bottom:4px}
.cc-crumb b{font-weight:600;color:var(--cc-fg)}
.cc-crumb span{opacity:.5}
.cc-title{font-size:20px;font-weight:700;letter-spacing:.2px;margin:0}
.cc-sub{font-size:12.5px;color:var(--cc-fg-3);margin-top:3px}
.cc-head-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}

.cc-search{
  display:flex;align-items:center;gap:7px;height:34px;padding:0 11px;
  border:1px solid var(--cc-line);border-radius:9px;background:var(--cc-bg);
  color:var(--cc-fg-3);transition:border-color .15s,box-shadow .15s;
}
.cc-search:focus-within{border-color:var(--cc-accent);box-shadow:0 0 0 3px var(--cc-accent-soft)}
.cc-search input{
  border:0;outline:0;background:transparent;color:var(--cc-fg);font:inherit;font-size:13px;width:180px;
}
.cc-iconbtn{
  width:34px;height:34px;border:1px solid var(--cc-line);border-radius:9px;background:var(--cc-bg);
  color:var(--cc-fg-2);cursor:pointer;display:grid;place-items:center;transition:background .15s,color .15s;
}
.cc-iconbtn:hover{background:var(--cc-hover);color:var(--cc-fg)}
.cc-iconbtn[data-busy="1"] svg{animation:cc-spin .9s linear infinite}
@keyframes cc-spin{to{transform:rotate(360deg)}}

.cc-tabs{display:flex;align-items:center;gap:8px;padding:12px 32px 0}
.cc-tab{
  display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 13px;
  border:1px solid transparent;border-radius:8px;background:transparent;color:var(--cc-fg-2);
  font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;transition:background .15s,color .15s;
}
.cc-tab:hover{background:var(--cc-hover);color:var(--cc-fg)}
.cc-tab[data-on="1"]{background:var(--cc-bg-soft);border-color:var(--cc-line);color:var(--cc-fg);font-weight:600}
.cc-tab i{font-style:normal;font-size:12px;color:var(--cc-fg-3);font-variant-numeric:tabular-nums}
.cc-tab[data-on="1"] i{color:var(--cc-accent)}

.cc-note{padding:8px 32px 0;font-size:12px;color:var(--cc-fg-3)}

.cc-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 32px 64px;scrollbar-gutter:stable}
.cc-section{margin-top:22px}
.cc-section-head{display:flex;align-items:baseline;gap:10px;margin:0 0 10px}
.cc-section-title{font-size:14.5px;font-weight:650;letter-spacing:.2px;margin:0}
.cc-section-hint{font-size:12px;color:var(--cc-fg-3)}
.cc-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:10px}

.cc-card{
  display:flex;align-items:flex-start;gap:12px;padding:13px 14px;
  border:1px solid var(--cc-line);border-radius:12px;background:var(--cc-bg);
  cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .12s;
}
.cc-card:hover{border-color:color-mix(in srgb,var(--cc-accent) 34%,var(--cc-line));box-shadow:var(--cc-shadow);transform:translateY(-1px)}
.cc-card[data-off="1"] .cc-avatar{filter:grayscale(.7);opacity:.62}
.cc-card[data-off="1"] .cc-name{color:var(--cc-fg-2)}

.cc-avatar{
  flex:none;width:38px;height:38px;border-radius:11px;display:grid;place-items:center;
  font-size:14px;font-weight:700;letter-spacing:.3px;color:#fff;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 1px 2px rgba(16,24,40,.12);
}
.cc-main{min-width:0;flex:1 1 auto}
.cc-name-row{display:flex;align-items:center;gap:7px;min-width:0}
.cc-name{font-size:14px;font-weight:600;color:var(--cc-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-badge{
  flex:none;font-size:10.5px;line-height:16px;padding:0 6px;border-radius:5px;
  background:var(--cc-accent-soft);color:var(--cc-accent);font-weight:600;
}
.cc-badge[data-tone="muted"]{background:var(--cc-hover);color:var(--cc-fg-3)}
.cc-desc{
  margin-top:3px;font-size:12.5px;line-height:1.5;color:var(--cc-fg-3);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.cc-side{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:6px;padding-top:2px}
.cc-invoke{
  font-size:11px;color:var(--cc-fg-3);font-family:ui-monospace,Menlo,Consolas,monospace;
  opacity:0;transition:opacity .15s;
}
.cc-card:hover .cc-invoke{opacity:1}

/* 开关 */
.cc-sw{position:relative;width:38px;height:22px;flex:none;border:0;padding:0;border-radius:999px;
  background:var(--cc-line);cursor:pointer;transition:background .18s}
.cc-sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
  background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.28);transition:transform .18s}
.cc-sw[data-on="1"]{background:var(--cc-accent)}
.cc-sw[data-on="1"]::after{transform:translateX(16px)}
.cc-sw[data-busy="1"]{opacity:.6;cursor:progress}
.cc-sw:disabled{cursor:not-allowed}

.cc-empty{padding:56px 0;text-align:center;color:var(--cc-fg-3);font-size:13px}
.cc-more{
  margin-top:10px;width:100%;height:36px;border:1px dashed var(--cc-line);border-radius:10px;
  background:transparent;color:var(--cc-fg-2);font:inherit;font-size:12.5px;cursor:pointer;
}
.cc-more:hover{background:var(--cc-hover);color:var(--cc-fg)}
.cc-skel{height:64px;border-radius:12px;background:linear-gradient(100deg,var(--cc-line-soft) 30%,var(--cc-hover) 50%,var(--cc-line-soft) 70%);
  background-size:220% 100%;animation:cc-shimmer 1.2s ease-in-out infinite}
@keyframes cc-shimmer{to{background-position:-120% 0}}

/* 详情抽屉 */
.cc-mask{position:absolute;inset:0;background:rgba(15,23,42,.24);z-index:20;animation:cc-fade .16s ease}
@keyframes cc-fade{from{opacity:0}to{opacity:1}}
.cc-drawer{
  position:absolute;top:0;right:0;bottom:0;width:min(440px,92%);z-index:21;display:flex;flex-direction:column;
  background:var(--cc-bg);border-left:1px solid var(--cc-line);box-shadow:-24px 0 60px rgba(16,24,40,.18);
  animation:cc-slide .2s cubic-bezier(.22,.8,.3,1);
}
@keyframes cc-slide{from{transform:translateX(28px);opacity:.4}to{transform:none;opacity:1}}
.cc-dw-head{display:flex;align-items:flex-start;gap:12px;padding:20px 20px 14px;border-bottom:1px solid var(--cc-line-soft)}
.cc-dw-title{font-size:16px;font-weight:700;margin:0}
.cc-dw-sub{font-size:12px;color:var(--cc-fg-3);margin-top:2px}
.cc-dw-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 20px}
.cc-dw-desc{font-size:13px;line-height:1.65;color:var(--cc-fg-2);white-space:pre-wrap}
.cc-meta{margin-top:16px;border:1px solid var(--cc-line-soft);border-radius:10px;overflow:hidden}
.cc-meta-row{display:flex;gap:12px;padding:8px 11px;font-size:12px;border-bottom:1px solid var(--cc-line-soft)}
.cc-meta-row:last-child{border-bottom:0}
.cc-meta-k{flex:none;width:72px;color:var(--cc-fg-3)}
.cc-meta-v{min-width:0;color:var(--cc-fg-2);word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px}
.cc-code{
  margin-top:14px;padding:11px 12px;border-radius:10px;background:var(--cc-bg-soft);
  border:1px solid var(--cc-line-soft);font-family:ui-monospace,Menlo,Consolas,monospace;
  font-size:11.5px;line-height:1.6;color:var(--cc-fg-2);white-space:pre-wrap;max-height:240px;overflow:auto;
}
.cc-dw-foot{display:flex;gap:9px;padding:14px 20px;border-top:1px solid var(--cc-line-soft)}
.cc-btn{
  height:36px;padding:0 16px;border-radius:9px;border:1px solid var(--cc-line);background:var(--cc-bg);
  color:var(--cc-fg);font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s,opacity .15s;
  display:inline-flex;align-items:center;gap:7px;
}
.cc-btn:hover{background:var(--cc-hover)}
.cc-btn[data-primary="1"]{background:var(--cc-accent);border-color:var(--cc-accent);color:#fff}
.cc-btn[data-primary="1"]:hover{filter:brightness(1.06)}
.cc-btn:disabled{opacity:.55;cursor:not-allowed}
.cc-btn[data-grow="1"]{flex:1 1 auto;justify-content:center}

/* toast */
.cc-toast{
  position:absolute;left:50%;bottom:28px;transform:translateX(-50%);z-index:40;
  max-width:min(560px,90%);padding:9px 15px;border-radius:10px;
  background:rgba(20,24,30,.92);color:#fff;font-size:12.5px;line-height:1.5;
  box-shadow:0 10px 30px rgba(0,0,0,.28);animation:cc-toast .18s ease;
}
.cc-toast[data-tone="err"]{background:rgba(190,44,48,.95)}
@keyframes cc-toast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}

/* 全局提示条：面板切走以后也要能看见 */
.cc-toast-global{
  position:fixed;left:50%;bottom:34px;transform:translate(-50%,8px);z-index:2147483600;
  max-width:min(620px,86vw);padding:10px 16px;border-radius:10px;
  background:rgba(20,24,30,.94);color:#fff;pointer-events:none;white-space:pre-wrap;
  font:13px/1.5 "Segoe UI","Microsoft YaHei",-apple-system,system-ui,sans-serif;
  box-shadow:0 12px 34px rgba(0,0,0,.3);transition:opacity .18s ease,transform .18s ease;
}
.cc-toast-global[data-tone="err"]{background:rgba(190,44,48,.96)}
.cc-toast-global[data-tone="warn"]{background:rgba(158,104,18,.96)}
`;

    function ensureStyle() {
      if (document.getElementById("cc-style")) return;
      const el = document.createElement("style");
      el.id = "cc-style";
      el.textContent = CSS;
      document.head.appendChild(el);
    }

    /* ═════════════════ 小工具 ═════════════════ */

    const PALETTE = [
      ["#ff6b5b", "#ff9d6c"],
      ["#4d8bff", "#7ab8ff"],
      ["#12b981", "#5ee0a8"],
      ["#a855f7", "#d08bff"],
      ["#f59e0b", "#ffca6b"],
      ["#0ea5e9", "#6fd2f7"],
      ["#ef6292", "#ff9fc0"],
      ["#6366f1", "#9aa0ff"],
    ];

    function hashOf(str) {
      let x = 0;
      for (let i = 0; i < String(str).length; i++) x = (x * 31 + String(str).charCodeAt(i)) | 0;
      return Math.abs(x);
    }

    function avatarStyle(seed) {
      const pair = PALETTE[hashOf(seed) % PALETTE.length];
      return { background: "linear-gradient(140deg," + pair[0] + "," + pair[1] + ")" };
    }

    function glyphOf(name) {
      const s = String(name || "?").trim();
      const ascii = /^[A-Za-z0-9@_\-./]+$/;
      if (ascii.test(s)) {
        const parts = s.replace(/^@/, "").split(/[-_/]/).filter(Boolean);
        return (parts[0] || s).slice(0, 2).toUpperCase();
      }
      return s.slice(0, 1);
    }

    function Icon({ children, size = 16, stroke = 1.6 }) {
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: stroke,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        children
      );
    }

    const SearchIcon = () =>
      h(Icon, null, h("circle", { cx: 11, cy: 11, r: 7 }), h("path", { d: "M20 20l-3.6-3.6" }));
    const RefreshIcon = () =>
      h(
        Icon,
        null,
        h("path", { d: "M21 12a9 9 0 1 1-2.64-6.36" }),
        h("path", { d: "M21 3v6h-6" })
      );
    const CloseIcon = () => h(Icon, null, h("path", { d: "M6 6l12 12M18 6L6 18" }));
    const BackIcon = () => h(Icon, null, h("path", { d: "M15 5l-7 7 7 7" }));

    /* ═════════════════ 组件 ═════════════════ */

    function Switch({ on, busy, disabled, onChange, label }) {
      return h("button", {
        className: "cc-sw",
        type: "button",
        role: "switch",
        "aria-checked": on ? "true" : "false",
        "aria-label": label || "开关",
        "data-on": on ? "1" : "0",
        "data-busy": busy ? "1" : "0",
        disabled: !!disabled || !!busy,
        onClick: (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!busy && !disabled) onChange(!on);
        },
      });
    }

    function Card({ item, busy, onOpen, onToggle }) {
      const invoke = item.__kind === "skill" ? item.invoke : "";
      const locked = !!item.readOnlyReason || item.togglable === false;
      return h(
        "div",
        {
          className: "cc-card",
          "data-off": item.enabled ? "0" : "1",
          role: "button",
          tabIndex: 0,
          onClick: () => onOpen(item),
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(item);
            }
          },
        },
        h("div", { className: "cc-avatar", style: avatarStyle(item.name || item.title) }, glyphOf(item.title || item.name)),
        h(
          "div",
          { className: "cc-main" },
          h(
            "div",
            { className: "cc-name-row" },
            h("div", { className: "cc-name" }, item.title || item.name),
            item.__kind === "skill" && !item.userInvocable
              ? h("span", { className: "cc-badge", "data-tone": "muted" }, "仅模型")
              : null,
            item.__kind === "skill" && item.modelInvocable === false
              ? h("span", { className: "cc-badge", "data-tone": "muted" }, "仅用户")
              : null,
            item.__kind === "bundle" && item.official ? h("span", { className: "cc-badge" }, "官方") : null
          ),
          h("div", { className: "cc-desc" }, item.description || "（没有描述）")
        ),
        h(
          "div",
          { className: "cc-side" },
          h(Switch, {
            on: item.enabled,
            busy,
            disabled: locked,
            label: (item.title || item.name) + " 开关",
            onChange: (next) => onToggle(item, next),
          }),
          invoke ? h("div", { className: "cc-invoke" }, invoke) : null
        )
      );
    }

    function Toast({ msg }) {
      if (!msg) return null;
      return h("div", { className: "cc-toast", "data-tone": msg.tone || "ok" }, msg.text);
    }

    function Drawer({ item, busy, onClose, onToggle, onCall, onCopy }) {
      const [detail, setDetail] = useState(null);
      const [loading, setLoading] = useState(false);

      useEffect(() => {
        let alive = true;
        setDetail(null);
        if (item && item.__kind === "skill") {
          setLoading(true);
          getSkillDetail(item.id)
            .then((r) => {
              if (alive) setDetail(r);
            })
            .catch(() => {})
            .finally(() => {
              if (alive) setLoading(false);
            });
        }
        return () => {
          alive = false;
        };
      }, [item && item.id]);

      if (!item) return null;
      const locked = !!item.readOnlyReason || item.togglable === false;
      const content = detail && detail.content ? detail.content : "";

      return h(
        React.Fragment,
        null,
        h("div", { className: "cc-mask", onClick: onClose }),
        h(
          "div",
          { className: "cc-drawer", role: "dialog", "aria-label": (item.title || item.name) + " 详情" },
          h(
            "div",
            { className: "cc-dw-head" },
            h("div", { className: "cc-avatar", style: avatarStyle(item.name || item.title) }, glyphOf(item.title || item.name)),
            h(
              "div",
              { style: { minWidth: 0, flex: "1 1 auto" } },
              h("h2", { className: "cc-dw-title" }, item.title || item.name),
              h(
                "div",
                { className: "cc-dw-sub" },
                item.__kind === "skill"
                  ? item.enabled
                    ? "已启用 · 输入 " + item.invoke + " 调用"
                    : "已停用 · 打开开关即可恢复"
                  : item.__kind === "bundle"
                    ? "组合包" + (item.version ? " · v" + item.version : "")
                    : item.__kind === "connector"
                      ? "连接器 · " + (item.transport || "mcp")
                      : "插件"
              )
            ),
            h("button", { className: "cc-iconbtn", onClick: onClose, "aria-label": "关闭" }, h(CloseIcon))
          ),
          h(
            "div",
            { className: "cc-dw-body" },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" } },
              h(
                "div",
                { style: { fontSize: 12, color: "var(--cc-fg-3)" } },
                item.enabled ? "当前状态：已启用" : "当前状态：已停用"
              ),
              h(Switch, {
                on: item.enabled,
                busy,
                disabled: locked,
                label: "详情开关",
                onChange: (next) => onToggle(item, next),
              }),
              locked
                ? h(
                    "div",
                    { style: { fontSize: 11.5, color: "var(--cc-fg-3)" } },
                    item.__kind === "skill" ? "内置技能由插件提供，不能在面板里开关" : "宿主保护这个插件，不能在这里开关"
                  )
                : null
            ),
            h("div", { className: "cc-dw-desc" }, item.description || "（没有描述）"),
            h(
              "div",
              { className: "cc-meta" },
              item.__kind === "skill"
                ? h(
                    React.Fragment,
                    null,
                    metaRow("调用指令", item.invoke),
                    metaRow("所在根目录", item.rootLabel || ""),
                    metaRow("路径", item.path || ""),
                    metaRow("模型可见", item.modelInvocable ? "是" : "否（disable-model-invocation）"),
                    metaRow("用户可调", item.userInvocable ? "是" : "否")
                  )
                : item.__kind === "bundle"
                  ? h(
                      React.Fragment,
                      null,
                      metaRow("包名", item.name),
                      metaRow("版本", item.version || "—"),
                      metaRow("来源", item.official ? "官方" : "第三方")
                    )
                  : item.__kind === "connector"
                    ? h(
                        React.Fragment,
                        null,
                        metaRow("传输", item.transport || ""),
                        metaRow("地址", item.target || "")
                      )
                    : h(
                        React.Fragment,
                        null,
                        metaRow("模块", item.name),
                        item.readOnlyReason ? metaRow("只读原因", item.readOnlyReason) : null
                      )
            ),
            item.__kind === "skill"
              ? h(
                  "div",
                  null,
                  h("div", { className: "cc-section-title", style: { marginTop: 18, fontSize: 13 } }, "技能说明"),
                  loading
                    ? h("div", { className: "cc-skel", style: { marginTop: 8 } })
                    : h("div", { className: "cc-code" }, content ? content.slice(0, 4000) : "（读不到正文）")
                )
              : null
          ),
          h(
            "div",
            { className: "cc-dw-foot" },
            item.__kind === "skill"
              ? h(
                  React.Fragment,
                  null,
                  h(
                    "button",
                    { className: "cc-btn", "data-primary": "1", "data-grow": "1", onClick: () => onCall(item) },
                    "插入到对话 · " + item.invoke
                  ),
                  h("button", { className: "cc-btn", onClick: () => onCopy(item.invoke) }, "复制")
                )
              : h(
                  "button",
                  { className: "cc-btn", "data-grow": "1", onClick: onClose },
                  "完成"
                )
          )
        )
      );
    }

    function metaRow(k, v) {
      return h(
        "div",
        { className: "cc-meta-row", key: k },
        h("div", { className: "cc-meta-k" }, k),
        h("div", { className: "cc-meta-v" }, String(v == null || v === "" ? "—" : v))
      );
    }

    /* ═════════════════ 页面 ═════════════════ */

    const TABS = [
      { id: "skills", label: "技能", countKey: "skills", onKey: "skillsOn" },
      { id: "plugins", label: "插件", countKey: "plugins", onKey: "pluginsOn" },
      { id: "bundles", label: "组合包", countKey: "bundles", onKey: "bundlesOn" },
      { id: "connectors", label: "连接器", countKey: "connectors", onKey: "connectorsOn" },
    ];

    /** 长列表一次渲染多少张卡（插件动辄一两百行，全铺出来既慢也没必要）。 */
    const STEP = 48;

    function CapabilityPage(props) {
      const ctxRef = useRef(props && props.ctxRef ? props.ctxRef.current : props && props.capabilityContext);
      const [tab, setTab] = useState("skills");
      const [query, setQuery] = useState("");
      const [state, setState] = useState(null);
      const [error, setError] = useState("");
      const [busyId, setBusyId] = useState("");
      const [toast, setToast] = useState(null);
      const [open, setOpen] = useState(null);
      const [loading, setLoading] = useState(true);
      const [shown, setShown] = useState({});
      const aliveRef = useRef(true);
      const toastTimer = useRef(0);

      const flash = useCallback((text, tone) => {
        setToast({ text, tone: tone || "ok" });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3200);
      }, []);

      const load = useCallback(async () => {
        setLoading(true);
        try {
          const next = await getState();
          if (aliveRef.current) {
            setState(next);
            setError("");
          }
        } catch (e) {
          if (aliveRef.current) setError(String(e && e.message ? e.message : e));
        } finally {
          if (aliveRef.current) setLoading(false);
        }
      }, []);

      useEffect(() => {
        aliveRef.current = true;
        load();
        return () => {
          aliveRef.current = false;
          clearTimeout(toastTimer.current);
        };
      }, []);

      // 换分类或改搜索词时，长列表的展开进度归零
      useEffect(() => {
        setShown({});
      }, [tab, query]);

      const items = useMemo(() => {
        if (!state) return [];
        if (tab === "skills") return state.skills.map((s) => ({ ...s, __kind: "skill" }));
        if (tab === "plugins") return state.plugins.map((p) => ({ ...p, __kind: "plugin" }));
        if (tab === "bundles") return state.bundles.map((b) => ({ ...b, __kind: "bundle" }));
        return state.connectors.map((c) => ({ ...c, __kind: "connector" }));
      }, [state, tab]);

      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter((it) =>
          (String(it.title || "") + " " + String(it.name || "") + " " + String(it.description || ""))
            .toLowerCase()
            .includes(q)
        );
      }, [items, query]);

      const grouped = useMemo(() => {
        const on = filtered.filter((x) => x.enabled);
        const off = filtered.filter((x) => !x.enabled);
        return [
          { title: "已启用", hint: "关掉后立刻从会话里消失，不用重启", items: on },
          { title: "已停用", hint: "打开即恢复", items: off },
        ].filter((g) => g.items.length);
      }, [filtered]);

      /** 本地先翻转（乐观更新），失败或被覆盖再翻回来。 */
      const applyLocal = useCallback((item, value) => {
        setState((prev) => {
          if (!prev) return prev;
          const patch = (arr) => arr.map((x) => (x.id === item.id ? { ...x, enabled: value } : x));
          return {
            ...prev,
            skills: patch(prev.skills),
            plugins: patch(prev.plugins),
            bundles: patch(prev.bundles),
            connectors: patch(prev.connectors),
          };
        });
        setOpen((prev) => (prev && prev.id === item.id ? { ...prev, enabled: value } : prev));
      }, []);

      const onToggle = useCallback(
        async (item, next) => {
          setBusyId(item.id);
          applyLocal(item, next);
          const label = item.title || item.name;
          try {
            const body = await postToggle(item.__kind, item.id, next);
            const app = body && body.result && body.result.application;
            if (app === "overridden") {
              // 写进 profile 了，但更高层（例如用户级 patch）说了算，实际状态没变
              applyLocal(item, item.enabled);
              flash(label + " 的改动被更高层配置覆盖，实际没变（已写入 profile，但没生效）", "warn");
              return;
            }
            flash(label + (next ? " 已启用" : " 已停用"));
            setTimeout(() => {
              if (aliveRef.current) load();
            }, 400);
          } catch (e) {
            applyLocal(item, item.enabled);
            flash("没改成：" + String(e && e.message ? e.message : e), "err");
          } finally {
            if (aliveRef.current) setBusyId("");
          }
        },
        [applyLocal, flash, load]
      );

      const onCall = useCallback(async (item) => {
        const text = item.invoke;
        setBusyId(item.id);
        const res = await insertIntoConversation(ctxRef.current, text + " ");
        setBusyId("");
        setOpen(null);
        if (res.ok) flashGlobal("已插入 " + text + "，在输入框回车即可调用");
        else if (res.copied) flashGlobal("输入框没接住，已把 " + text + " 复制到剪贴板，粘贴即可", "warn");
        else if (res.reason === "no-composer") flashGlobal("没找到对话输入框，先开一个会话再点调用", "err");
        else flashGlobal("插入失败，请手动输入 " + text, "err");
      }, []);

      const onCopy = useCallback(
        async (text) => {
          try {
            await navigator.clipboard.writeText(text);
            flash("已复制 " + text);
          } catch {
            flash("复制失败，请手动输入 " + text, "err");
          }
        },
        [flash]
      );

      const counts = state && state.counts ? state.counts : {};

      return h(
        "div",
        { className: "cc-root" },
        h(
          "div",
          { className: "cc-head" },
          h(
            "div",
            { style: { minWidth: 0 } },
            h(
              "div",
              { className: "cc-crumb" },
              h("span", null, "能力"),
              h("span", null, "›"),
              h("b", null, "管理")
            ),
            h("h1", { className: "cc-title" }, "能力中心"),
            h(
              "div",
              { className: "cc-sub" },
              state && state.profile
                ? "当前配置：" + state.profile.name + " · 技能 " + (counts.skillsOn || 0) + "/" + (counts.skills || 0) +
                  " · 插件 " + (counts.pluginsOn || 0) + "/" + (counts.plugins || 0)
                : "统一管理技能、插件与连接器，点一下就能调用"
            )
          ),
          h(
            "div",
            { className: "cc-head-actions" },
            h(
              "label",
              { className: "cc-search" },
              h(SearchIcon),
              h("input", {
                value: query,
                placeholder: "搜索名称或描述",
                onChange: (e) => setQuery(e.target.value),
                "aria-label": "搜索",
              })
            ),
            h(
              "button",
              {
                className: "cc-iconbtn",
                title: "重新读取",
                "data-busy": loading ? "1" : "0",
                onClick: load,
              },
              h(RefreshIcon)
            )
          )
        ),
        h(
          "div",
          { className: "cc-tabs" },
          TABS.map((t) =>
            h(
              "button",
              {
                key: t.id,
                className: "cc-tab",
                type: "button",
                "data-on": tab === t.id ? "1" : "0",
                onClick: () => setTab(t.id),
              },
              t.label,
              h("i", null, String(counts[t.countKey] || 0))
            )
          )
        ),
        h(
          "div",
          { className: "cc-note" },
          tab === "skills"
            ? "技能 = 一段可复用的任务说明。点卡片看详情，点「插入到对话」把 /名字 放进输入框。"
            : tab === "plugins"
              ? "插件 = 跑在宿主里的能力模块。开关会写进当前 profile，宿主自动热重组。"
              : tab === "bundles"
                ? "组合包 = 一次装进来的插件集合。开关会改变 profile 的层叠，部分包需要重启。"
                : "连接器 = 外接的 MCP 服务。开关即断/接，下一次工具调用开始生效。"
        ),
        h(
          "div",
          { className: "cc-body" },
          loading && !state
            ? h(
                "div",
                { className: "cc-list", style: { marginTop: 24 } },
                [0, 1, 2, 3].map((i) => h("div", { key: i, className: "cc-skel" }))
              )
            : error
              ? h("div", { className: "cc-empty" }, "读取失败：" + error)
              : grouped.length === 0
                ? h("div", { className: "cc-empty" }, query ? "没有匹配「" + query + "」的条目" : "这一类还没有内容")
                : grouped.map((g) => {
                    const limit = shown[g.title] === undefined ? STEP : shown[g.title];
                    const visible = g.items.slice(0, limit);
                    const rest = g.items.length - visible.length;
                    return h(
                      "section",
                      { className: "cc-section", key: g.title },
                      h(
                        "div",
                        { className: "cc-section-head" },
                        h("h3", { className: "cc-section-title" }, g.title),
                        h("span", { className: "cc-section-hint" }, g.items.length + " 项 · " + g.hint)
                      ),
                      h(
                        "div",
                        { className: "cc-list" },
                        visible.map((item) =>
                          h(Card, {
                            key: item.__kind + ":" + item.id,
                            item,
                            busy: busyId === item.id,
                            onOpen: (it) => setOpen(it),
                            onToggle,
                          })
                        )
                      ),
                      rest > 0
                        ? h(
                            "button",
                            {
                              className: "cc-more",
                              type: "button",
                              onClick: () => setShown((prev) => ({ ...prev, [g.title]: limit + STEP })),
                            },
                            "显示更多（还有 " + rest + " 项）"
                          )
                        : null
                    );
                  })
        ),
        open
          ? h(Drawer, {
              item: open,
              busy: busyId === open.id,
              onClose: () => setOpen(null),
              onToggle,
              onCall,
              onCopy,
            })
          : null,
        h(Toast, { msg: toast })
      );
    }

    /** 侧栏图标：与宿主同一套线性风格。 */
    /**
     * 全局提示条：挂在 body 上，不随面板卸载消失。
     * 「插入到对话」会先切走面板，页内 toast 跟着没了，那种场景必须用这个。
     */
    let globalToastTimer = 0;
    function flashGlobal(text, tone) {
      let node = document.getElementById("cc-toast-global");
      if (!node) {
        node = document.createElement("div");
        node.id = "cc-toast-global";
        document.body.appendChild(node);
      }
      node.className = "cc-toast-global";
      node.setAttribute("data-tone", tone || "ok");
      node.textContent = text;
      node.style.opacity = "0";
      node.style.transform = "translate(-50%, 8px)";
      requestAnimationFrame(() => {
        node.style.opacity = "1";
        node.style.transform = "translate(-50%, 0)";
      });
      clearTimeout(globalToastTimer);
      globalToastTimer = setTimeout(() => {
        node.style.opacity = "0";
        node.style.transform = "translate(-50%, 8px)";
        setTimeout(() => {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, 220);
      }, 3200);
    }

    /** 侧栏图标：与宿主同一套线性风格。 */
    function SidebarIcon() {
      return h(
        Icon,
        { size: 18 },
        h("rect", { x: 3, y: 3, width: 7.5, height: 7.5, rx: 2 }),
        h("rect", { x: 13.5, y: 3, width: 7.5, height: 7.5, rx: 2 }),
        h("rect", { x: 3, y: 13.5, width: 7.5, height: 7.5, rx: 2 }),
        h("path", { d: "M13.5 17.25h7.5M17.25 13.5v7.5" })
      );
    }

    /* ═════════════════ 对外 ═════════════════ */

    function apply(ctx) {
      ensureStyle();

      // 组件里要用 ctx（切面板、找输入框），用注入属性带过去
      const capabilityContext = ctx;

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ capabilityContext }),
          },
          CapabilityPage
        )
      );

      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 5,
            locale: NS,
            label: () => "能力中心",
          },
          SidebarIcon
        )
      );

      if (typeof ctx.effect === "function") {
        ctx.effect(
          () => () => {
            const style = document.getElementById("cc-style");
            if (style) style.remove();
          },
          "capability-center: style"
        );
      }
    }

    const inject = ["slots", "layout"];
    return { apply, inject, name: "dsh-capability-center", __components: { CapabilityPage } };
  },
});
