/**
 * lib/skills.js —— 技能扫描与开关。
 *
 * DSH 的技能来源（@deepseek-ai/dsh-skill-filesystem）是一组根目录下：
 *   <root>/<name>/SKILL.md     目录 bundle
 *   <root>/<name>.md           平铺文件
 * 刻意不支持嵌套 `**\/SKILL.md`，所以关掉一个技能最稳的办法就是把它挪进
 * `<root>/.disabled/` —— 既离开扫描面，内容又原样留着，随时能开回来。
 */
import fs from "node:fs";
import path from "node:path";
import { exists, isDir, isFile, readTextCapped } from "./paths.js";

const DISABLED_DIR = ".disabled";
const SKIP_ENTRIES = new Set([DISABLED_DIR, ".system", "node_modules"]);

/** 极简 YAML frontmatter 解析：只取顶层标量与布尔，够描述技能元信息。 */
export function parseFrontmatter(text) {
  const out = { data: {}, body: text, ok: false };
  if (typeof text !== "string" || !text.startsWith("---")) return out;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return out;
  const head = text.slice(3, end);
  const body = text.slice(text.indexOf("\n", end + 1) + 1);
  const data = {};
  for (const raw of head.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    data[m[1]] = value;
  }
  return { data, body, ok: true };
}

export function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const s = String(value).trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(s)) return true;
  if (["false", "no", "off", "0"].includes(s)) return false;
  return fallback;
}

/** 一个技能根：读目录，产出启用/停用两类条目。 */
function scanRoot(root, label, out) {
  if (!isDir(root)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_ENTRIES.has(ent.name) || ent.name.startsWith(".")) continue;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      const skillFile = path.join(full, "SKILL.md");
      if (isFile(skillFile)) out.push(makeItem(root, label, ent.name, full, skillFile, true));
    } else if (ent.isFile() && /\.md$/i.test(ent.name)) {
      out.push(makeItem(root, label, ent.name.replace(/\.md$/i, ""), full, full, true));
    }
  }
  // 停用区
  const disabledRoot = path.join(root, DISABLED_DIR);
  if (!isDir(disabledRoot)) return;
  let parked = [];
  try {
    parked = fs.readdirSync(disabledRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of parked) {
    const full = path.join(disabledRoot, ent.name);
    if (ent.isDirectory()) {
      const skillFile = path.join(full, "SKILL.md");
      if (isFile(skillFile)) out.push(makeItem(root, label, ent.name, full, skillFile, false));
    } else if (ent.isFile() && /\.md$/i.test(ent.name)) {
      out.push(makeItem(root, label, ent.name.replace(/\.md$/i, ""), full, full, false));
    }
  }
}

function makeItem(root, label, slug, full, entryFile, enabled) {
  const text = readTextCapped(entryFile, 200 * 1024);
  const fm = parseFrontmatter(text);
  const name = String(fm.data.name || slug).trim();
  const description = String(fm.data.description || "").trim() || firstParagraph(fm.body) || "（没有描述）";
  const whenToUse = String(fm.data.whenToUse || "").trim();
  return {
    kind: "skill",
    id: root + "::" + slug,
    name,
    slug,
    description,
    whenToUse,
    root,
    rootLabel: label,
    path: full,
    entryFile,
    enabled,
    userInvocable: toBool(fm.data["user-invocable"], true),
    modelInvocable: !toBool(fm.data["disable-model-invocation"], false),
    updatedAt: safeMtime(entryFile),
    invoke: "/" + name,
  };
}

function firstParagraph(body) {
  const s = String(body || "")
    .replace(/^#.*$/gm, "")
    .trim();
  const line = s.split(/\n\s*\n/).map((x) => x.replace(/\s+/g, " ").trim()).find(Boolean);
  return line ? line.slice(0, 160) : "";
}

function safeMtime(file) {
  try {
    return Math.round(fs.statSync(file).mtimeMs);
  } catch {
    return 0;
  }
}

/** 扫描全部技能根。 */
export function scanSkills({ home, agentsHome }) {
  const roots = [
    { dir: path.join(home, "skills"), label: "用户技能" },
    { dir: path.join(agentsHome, "skills"), label: "Agents 技能" },
  ];
  const out = [];
  for (const r of roots) scanRoot(r.dir, r.label, out);
  out.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
  return out;
}

/**
 * 开/关一个技能：在 <root>/ 与 <root>/.disabled/ 之间搬移，保留原内容。
 * @returns {{ok:boolean, item?:object, error?:string}}
 */
export function setSkillEnabled(skill, enabled) {
  if (!skill || !skill.root || !skill.slug) return { ok: false, error: "缺少技能路径信息" };
  const dirLive = path.join(skill.root, skill.slug);
  const fileLive = path.join(skill.root, skill.slug + ".md");
  const dirParked = path.join(skill.root, DISABLED_DIR, skill.slug);
  const fileParked = path.join(skill.root, DISABLED_DIR, skill.slug + ".md");

  // 目录 / 平铺两种形态、启用 / 停用两个位置，取当前真实存在的那个
  const from = [dirLive, fileLive, dirParked, fileParked].find((p) => exists(p));
  if (!from) return { ok: false, error: "找不到技能文件（可能已被移动）" };
  const target = enabled
    ? from.startsWith(path.join(skill.root, DISABLED_DIR))
      ? path.join(skill.root, path.relative(path.join(skill.root, DISABLED_DIR), from))
      : from
    : path.join(skill.root, DISABLED_DIR, path.basename(from));

  if (path.resolve(from) === path.resolve(target)) {
    return { ok: true, item: { ...skill, enabled, path: from } };
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(from, target);
  } catch (e) {
    return { ok: false, error: "移动失败：" + String(e && e.message) };
  }
  const entryFile = isDir(target) ? path.join(target, "SKILL.md") : target;
  const next = makeItem(skill.root, skill.rootLabel, skill.slug, target, entryFile, enabled);
  return { ok: true, item: next };
}

/** 读技能正文（详情抽屉用）。 */
export function readSkillBody(skill) {
  const file = skill?.entryFile || "";
  if (!file) return "";
  return readTextCapped(file, 256 * 1024);
}
