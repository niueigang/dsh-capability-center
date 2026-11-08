/**
 * lib/paths.js —— 宿主位置解析。纯函数，不碰 cordis。
 *
 * DSH 的目录约定（与 @deepseek-ai/dsh-home-paths 一致，但不 import 宿主内部包，
 * 免得宿主换版本时解析失败）：
 *   $DSH_HOME（缺省 ~/.dsh）
 *   $AGENTS_HOME（缺省 ~/.agents）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function dshHome(env = process.env) {
  const h = (env.DSH_HOME || env.DSH_HOME_DIR || "").trim();
  if (h) return path.resolve(h);
  return path.join(os.homedir(), ".dsh");
}

export function agentsHome(env = process.env) {
  const h = (env.AGENTS_HOME || env.AGENTS_HOME_DIR || "").trim();
  if (h) return path.resolve(h);
  return path.join(os.homedir(), ".agents");
}

/** profile 目录列表，用于在拿不到 profileContext 时兜底。 */
export function listProfiles(home) {
  const dir = path.join(home, "profiles");
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 读文本，限制大小，避免把巨型文件读进内存。 */
export function readTextCapped(file, cap = 256 * 1024) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > cap) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * profile 目录定位：优先 profileContext，其次按 package.json 里的 profile 名找，
 * 最后取最近修改的那个 profile。
 */
export function resolveProfile(ctx, env = process.env) {
  const home = dshHome(env);
  let pc = null;
  try {
    pc = typeof ctx?.get === "function" ? ctx.get("profileContext") : null;
  } catch {
    pc = null;
  }
  const name = pc?.name || "";
  const dir = pc?.dir || (name ? path.join(home, "profiles", name) : "");
  if (dir && exists(dir)) {
    return {
      home,
      name: name || path.basename(dir),
      dir,
      startedBundles: pc?.startedBundles || [],
      cwd: pc?.cwd || process.cwd(),
    };
  }
  const candidates = listProfiles(home)
    .map((p) => ({ p, at: (() => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } })() }))
    .sort((a, b) => b.at - a.at);
  if (candidates.length) {
    const dir2 = candidates[0].p;
    return { home, name: path.basename(dir2), dir: dir2, startedBundles: [], cwd: process.cwd() };
  }
  return { home, name: name || "unknown", dir: "", startedBundles: [], cwd: process.cwd() };
}
