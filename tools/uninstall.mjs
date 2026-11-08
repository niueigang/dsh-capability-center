#!/usr/bin/env node
/**
 * 从 profile 里卸掉 dsh-capability-center。
 *
 * 只撤销 install.mjs 写过的三样：依赖声明、组合包声明、node_modules 链接。
 * 插件目录本身不动（想彻底删掉就连目录一起删）。
 *
 * 用法:
 *   node tools/uninstall.mjs [profile]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(path.resolve(HERE, ".."), "package.json"), "utf8"));
const NAME = PKG.name;

const profileName = process.argv.slice(2).find((a) => !a.startsWith("--")) || "desktop";
const home = (process.env.DSH_HOME || "").trim() || path.join(os.homedir(), ".dsh");
const profileDir = path.join(home, "profiles", profileName);
const pkgPath = path.join(profileDir, "package.json");

if (!fs.existsSync(pkgPath)) {
  console.error("找不到 profile：" + pkgPath);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.copyFileSync(pkgPath, pkgPath + ".bak-uninstall-" + stamp);

let touched = false;
if (pkg.dependencies && pkg.dependencies[NAME] !== undefined) {
  delete pkg.dependencies[NAME];
  touched = true;
  console.log("已移除依赖声明 " + NAME);
}
const bundles = pkg?.dsh?.profile?.bundles;
if (Array.isArray(bundles)) {
  const before = bundles.length;
  pkg.dsh.profile.bundles = bundles.filter((n) => n !== NAME);
  if (pkg.dsh.profile.bundles.length !== before) {
    touched = true;
    console.log("已移除组合包声明 " + NAME);
  }
}
if (touched) fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const link = path.join(profileDir, "node_modules", NAME);
try {
  const st = fs.lstatSync(link);
  if (st.isSymbolicLink()) fs.unlinkSync(link);
  else fs.rmSync(link, { recursive: true, force: true });
  console.log("已移除链接 " + link);
} catch {
  console.log("链接不存在，跳过");
}

console.log("\n完成。重启客户端后能力中心消失。");
