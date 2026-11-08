/**
 * lib/state.js —— 把宿主此刻的能力摊平成一份可渲染的清单。
 *
 * 三个来源各走各的路，任何一个取不到都不影响另外两个：
 *   插件   pluginManager（Loader 行）  +  profile 的组合包
 *   技能   <home>/skills、<agents>/skills 目录扫描
 *   连接器 Loader 里的 dsh-mcp-client 行
 */
import { readJson, agentsHome as resolveAgentsHome } from "./paths.js";
import { scanSkills } from "./skills.js";

/* ───────────── 技能 ─────────────
 * 两个视角合起来才是全貌：
 *   ctx.skills 的目录 = 模型此刻真能看到的（含内置、项目、自定义根），但看不到被停用的；
 *   文件系统扫描     = 磁盘上实际有什么，能看到停在 .disabled/ 里的。
 * 按 name 合并：目录里有的算启用，只出现在扫描里的算停用。
 */

function sourceLabel(source) {
  const map = {
    "user-dsh": "用户技能",
    "user-agents": "Agents 技能",
    "project-dsh": "项目技能",
    "project-agents": "项目技能",
    custom: "自定义目录",
    bundled: "内置技能",
    runtime: "插件内置",
  };
  return map[source] || "";
}

function rootOfPath(filePath, home, agentsHome) {
  const norm = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  const roots = [
    { dir: home + "/skills", label: "用户技能" },
    { dir: agentsHome + "/skills", label: "Agents 技能" },
  ];
  for (const r of roots) {
    const prefix = String(r.dir).replace(/\\/g, "/").toLowerCase() + "/";
    if (norm.startsWith(prefix)) return { root: r.dir, rootLabel: r.label };
  }
  return null;
}

function deriveSlug(filePath) {
  const norm = String(filePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const name = norm.split("/").pop() || "";
  if (/^SKILL\.md$/i.test(name)) {
    const parts = norm.split("/");
    return parts[parts.length - 2] || "";
  }
  return name.replace(/\.md$/i, "");
}

/** 合并后的技能清单。 */
export async function collectSkills(ctx, { home, agentsHome, cwd }) {
  const scanned = scanSkills({ home, agentsHome });
  const byName = new Map();
  for (const s of scanned) if (!byName.has(s.name)) byName.set(s.name, s);

  const svcSkills = svc(ctx, "skills");
  let catalog = [];
  if (svcSkills) {
    try {
      if (typeof svcSkills.snapshot === "function") {
        const snap = await svcSkills.snapshot({ cwd });
        catalog = (snap && snap.skills) || [];
      } else if (typeof svcSkills.list === "function") {
        catalog = (await svcSkills.list({ cwd })) || [];
      }
    } catch {
      catalog = [];
    }
  }

  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(catalog) ? catalog : []) {
    if (!c || !c.name) continue;
    seen.add(c.name);
    const parkedOrLive = byName.get(c.name);
    const located = rootOfPath(c.path, home, agentsHome);
    const invocation = c.invocation || {};
    out.push({
      kind: "skill",
      id: parkedOrLive ? parkedOrLive.id : "catalog::" + c.name,
      name: c.name,
      slug: parkedOrLive ? parkedOrLive.slug : deriveSlug(c.path),
      title: c.name,
      description: c.description || "",
      whenToUse: c.whenToUse || "",
      root: located ? located.root : "",
      rootLabel: located ? located.rootLabel : sourceLabel(c.source) || "内置",
      path: c.path || (parkedOrLive ? parkedOrLive.path : ""),
      entryFile: c.path || "",
      enabled: true,
      togglable: !!(located && (parkedOrLive || deriveSlug(c.path))),
      userInvocable: invocation.userInvocable !== false,
      modelInvocable: invocation.modelInvocable !== false,
      provider: c.provider || "",
      source: c.source || "",
      invoke: "/" + c.name,
      updatedAt: parkedOrLive ? parkedOrLive.updatedAt : 0,
    });
  }

  // 只在磁盘上、不在目录里的 = 没进目录的（没有 skills 服务时就是全部，含被停用的）
  for (const s of scanned) {
    if (seen.has(s.name)) continue;
    out.push({
      ...s,
      kind: "skill",
      title: s.name,
      togglable: true,
      provider: "filesystem",
      source: s.enabled ? "filesystem" : "parked",
    });
    seen.add(s.name);
  }

  out.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), "zh-Hans-CN");
  });
  return out;
}

/** 软取服务：宿主版本不一致时也不要抛。 */
export function svc(ctx, name) {
  try {
    const v = typeof ctx?.get === "function" ? ctx.get(name) : null;
    if (v) return v;
  } catch {
    /* 继续兜底 */
  }
  try {
    return ctx?.[name] || null;
  } catch {
    return null;
  }
}

const MODULE_TITLES = {
  "@deepseek-ai/dsh-mcp-client": "MCP 连接器",
  "@deepseek-ai/dsh-tool-web": "网页工具",
  "@deepseek-ai/dsh-tool-fs": "文件工具",
  "@deepseek-ai/dsh-skill-filesystem": "本地技能",
  "@deepseek-ai/dsh-tool-skill": "技能调用",
};

/** 从模块名挤出一个能看的标题：@scope/dsh-tool-web -> 网页工具 之类。 */
export function prettyName(moduleName) {
  if (!moduleName) return "未命名插件";
  if (MODULE_TITLES[moduleName]) return MODULE_TITLES[moduleName];
  const base = String(moduleName).split("/").pop() || moduleName;
  return base
    .replace(/^dsh-/, "")
    .replace(/^cordis-plugin-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function localized(meta, key) {
  if (!meta || typeof meta !== "object") return "";
  const v = meta[key];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    return v["zh-CN"] || v.zh || v.en || Object.values(v).find((x) => typeof x === "string") || "";
  }
  return "";
}

/** Loader 行 → 插件列表。 */
export async function collectPlugins(ctx) {
  const pm = svc(ctx, "pluginManager");
  const rows = [];
  if (pm && typeof pm.listPlugins === "function") {
    let list = [];
    try {
      list = await pm.listPlugins();
    } catch {
      list = [];
    }
    for (const row of Array.isArray(list) ? list : []) {
      const metaTitle = localized(row.meta, "title");
      // 宿主在没有展示元信息时会把包名当标题回填，这种就用可读名
      const looksLikeModule = !metaTitle || metaTitle === row.moduleName || metaTitle.startsWith("@");
      rows.push({
        kind: "plugin",
        id: row.entryId,
        name: row.moduleName,
        title: looksLikeModule ? prettyName(row.moduleName) : metaTitle,
        description: localized(row.meta, "description") || "",
        enabled: row.enabled !== false,
        readOnlyReason: row.readOnlyReason || "",
        phase: row.fiberPhase || null,
        group: "插件",
      });
    }
  }
  rows.sort((a, b) => (a.enabled === b.enabled ? a.title.localeCompare(b.title, "zh-Hans-CN") : a.enabled ? -1 : 1));
  return rows;
}

/** profile 里的组合包（技能/插件包）。 */
export async function collectBundles(ctx) {
  const pm = svc(ctx, "pluginManager");
  if (!pm || typeof pm.listBundles !== "function") return [];
  let list = [];
  try {
    list = await pm.listBundles();
  } catch {
    return [];
  }
  return (Array.isArray(list) ? list : []).map((b) => {
    const metaTitle = localized(b.meta, "title");
    const looksLikeModule = !metaTitle || metaTitle.startsWith("@") || metaTitle === b.name;
    return {
      kind: "bundle",
      id: b.name,
      name: b.name,
      title: looksLikeModule ? prettyName(String(b.name).replace(/^@[^/]+\//, "")) : metaTitle,
      description: localized(b.meta, "description") || b.description || "",
      enabled: b.enabled !== false,
      installed: b.installed !== false,
      version: b.version || "",
      official: !!b.official,
      removable: !!b.removable,
      readOnlyReason: b.readOnlyReason || "",
    };
  });
}

/** Loader 里的 MCP 行 → 连接器。用插件行（若有）补齐可开关状态。 */
export function collectConnectors(ctx, pluginRows = []) {
  const loader = svc(ctx, "loader");
  const out = [];
  if (!loader || typeof loader.entries !== "function") return out;
  let entries = [];
  try {
    entries = [...loader.entries()];
  } catch {
    return out;
  }
  for (const entry of entries) {
    const opt = entry?.options || {};
    const moduleName = String(opt.name || "");
    if (!moduleName.includes("mcp-client")) continue;
    const cfg = opt.config || {};
    const transport = cfg.transport || (cfg.url ? "streamable-http" : "stdio");
    const row = pluginRows.find((p) => p.id === opt.id) || pluginRows.find((p) => p.name === moduleName) || null;
    out.push({
      kind: "connector",
      id: row ? row.id : opt.id || moduleName,
      name: cfg.serverName || opt.id || "MCP",
      title: (cfg.serverName || opt.id || "MCP").toUpperCase(),
      description: transport + (cfg.url ? " · " + cfg.url : cfg.command ? " · " + shortPath(cfg.command) : ""),
      transport,
      target: cfg.url || cfg.command || "",
      enabled: row ? row.enabled : opt.disabled !== true,
      readOnlyReason: row ? row.readOnlyReason : "",
      rowId: opt.id || "",
      moduleName,
    });
  }
  return out;
}

function shortPath(p) {
  const s = String(p);
  return s.length > 46 ? "…" + s.slice(-44) : s;
}

/** 一次取全。任一来源失败都只是空列表，不抛。 */
export async function buildState(ctx, profile) {
  const home = profile.home;
  const agentsHome = resolveAgentsHome();
  const cwd = profile.cwd || process.cwd();
  const skills = await collectSkills(ctx, { home, agentsHome, cwd });
  const plugins = await collectPlugins(ctx);
  const bundles = await collectBundles(ctx);
  const connectors = collectConnectors(ctx, plugins);
  return {
    ok: true,
    at: Date.now(),
    profile: { name: profile.name, dir: profile.dir, home },
    capabilities: {
      pluginManager: !!svc(ctx, "pluginManager"),
      skills: !!svc(ctx, "skills"),
      loader: !!svc(ctx, "loader"),
      pnpm: !!svc(ctx, "pluginManager"),
    },
    counts: {
      skills: skills.length,
      skillsOn: skills.filter((s) => s.enabled).length,
      plugins: plugins.length,
      pluginsOn: plugins.filter((p) => p.enabled).length,
      bundles: bundles.length,
      bundlesOn: bundles.filter((b) => b.enabled).length,
      connectors: connectors.length,
      connectorsOn: connectors.filter((c) => c.enabled).length,
    },
    skills,
    plugins,
    bundles,
    connectors,
  };
}

/** 只读：profile 的 package.json 摘要，用于详情页展示来源。 */
export function profileManifest(dir) {
  if (!dir) return null;
  const pkg = readJson(dir + "/package.json", null);
  if (!pkg) return null;
  return {
    name: pkg.name || "",
    dependencies: pkg.dependencies || {},
    bundles: pkg?.dsh?.profile?.bundles || [],
  };
}
