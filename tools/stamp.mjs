#!/usr/bin/env node
/**
 * tools/stamp.mjs —— 把仓库里的 OWNER 占位符换成真正的 GitHub 账号/组织。
 *
 * 只在你第一次建仓时跑一次：
 *   node tools/stamp.mjs <owner> [repo]
 *
 * 会改：README.md / install.ps1 / install.cmd / LICENSE / package.json /
 *       .github/workflows/release.yml / SETUP.md
 * 跑完自己看一遍 git diff，没问题就 commit。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owner = (process.argv[2] || "").trim();
const repo = (process.argv[3] || "dsh-capability-center").trim();

if (!owner) {
  console.error("用法: node tools/stamp.mjs <github-owner> [repo-name]");
  console.error("例  : node tools/stamp.mjs leigang dsh-capability-center");
  process.exit(2);
}
if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
  console.error("owner 不像 GitHub 账号：" + owner);
  process.exit(2);
}

const files = [
  "README.md",
  "SETUP.md",
  "install.ps1",
  "install.cmd",
  "LICENSE",
  ".github/workflows/release.yml",
];

let touched = 0;
for (const rel of files) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, "utf8");
  const after = before
    .replace(/OWNER\/dsh-capability-center/g, owner + "/" + repo)
    .replace(/\bOWNER\b/g, owner);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log("updated " + rel);
    touched++;
  }
}

// package.json 的仓库字段
const pkgFile = path.join(ROOT, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
pkg.repository = { type: "git", url: "git+https://github.com/" + owner + "/" + repo + ".git" };
pkg.homepage = "https://github.com/" + owner + "/" + repo + "#readme";
pkg.bugs = { url: "https://github.com/" + owner + "/" + repo + "/issues" };
pkg.author = owner;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
console.log("updated package.json");

console.log("\n完成，共改 " + (touched + 1) + " 个文件。检查 git diff 后 commit 即可。");
