#!/usr/bin/env node
/**
 * 把 dsh-capability-center 装进一个 DSH profile。
 *
 * 做的事只有三件，都可以手工还原：
 *   1. profile/node_modules/<name>  ->  插件目录（Windows 用 junction，不需要管理员权限）
 *   2. profile/package.json 的 dependencies 加一条 file: 依赖
 *   3. profile 的 dsh.profile.bundles 加一行包名
 *
 * 用法:
 *   node tools/install.mjs [profile] [--dry]
 *   node tools/install.mjs desktop
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const PKG = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
const NAME = PKG.name;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const profileName = args.find((a) => !a.startsWith("--")) || "desktop";

const home = (process.env.DSH_HOME || "").trim() || path.join(os.homedir(), ".dsh");
const profileDir = path.join(home, "profiles", profileName);

if (!fs.existsSync(profileDir)) {
  console.error("找不到 profile：" + profileDir);
  process.exit(1);
}

const pkgPath = path.join(profileDir, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.dependencies = pkg.dependencies || {};
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || [];

const rel = path.relative(profileDir, PKG_ROOT).replace(/\\/g, "/");
const spec = "file:" + rel;

const alreadyDep = pkg.dependencies[NAME] === spec;
const alreadyBundle = pkg.dsh.profile.bundles.includes(NAME);

console.log("插件目录 : " + PKG_ROOT);
console.log("目标 profile : " + profileDir + " (" + profileName + ")");
console.log("依赖声明 : " + NAME + " = " + spec + (alreadyDep ? "  [已有]" : ""));
console.log("组合包声明 : " + NAME + (alreadyBundle ? "  [已有]" : ""));

if (dry) {
  console.log("\n--dry：什么都没写");
  process.exit(0);
}

// 1) 备份
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = pkgPath + ".bak-capcenter-" + stamp;
fs.copyFileSync(pkgPath, backup);
console.log("已备份 package.json -> " + path.basename(backup));

// 2) 链接
const linkDir = path.join(profileDir, "node_modules");
fs.mkdirSync(linkDir, { recursive: true });
const linkPath = path.join(linkDir, NAME);
try {
  const st = fs.lstatSync(linkPath);
  if (st) fs.rmSync(linkPath, { recursive: true, force: true });
} catch {
  /* 不存在就新建 */
}
try {
  fs.symlinkSync(PKG_ROOT, linkPath, "junction");
  console.log("已链接 " + linkPath + " -> " + PKG_ROOT);
} catch (e) {
  // 没有链接权限就整目录复制一份（改完插件要重新跑本脚本）
  console.log("symlink 失败（" + e.code + "），改为复制目录");
  fs.cpSync(PKG_ROOT, linkPath, {
    recursive: true,
    filter: (src) => !src.includes(path.join(PKG_ROOT, "node_modules")),
  });
}

// 3) package.json
pkg.dependencies[NAME] = spec;
if (!alreadyBundle) pkg.dsh.profile.bundles.push(NAME);
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log("已写入 package.json");

console.log("\n完成。重启客户端（或重开 profile）后，侧栏会出现「能力中心」。");
