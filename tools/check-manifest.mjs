#!/usr/bin/env node
/**
 * tools/check-manifest.mjs —— 清单自检：宿主认不认这个包，全看这几行。
 *
 *   node tools/check-manifest.mjs
 *
 * 少任何一个字段的表现：
 *   dsh.bundle.patch 缺  -> 装上但什么都不发生
 *   dsh.client 缺       -> 服务端跑了，界面上没有入口
 *   exports["./client"] -> 浏览器侧拿不到 bundle
 *   exports["./locale/*.json"] 缺 -> 宿主读不到 locale/zh.json 的 meta.title，
 *                                   组合包页会显示成包名
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const problems = [];
const need = (cond, msg) => {
  if (!cond) problems.push(msg);
};

need(typeof pkg.name === "string" && pkg.name.length > 0, "缺少 name");
need(/^\d+\.\d+\.\d+/.test(String(pkg.version || "")), "version 不是语义化版本");
need(pkg.type === "module", "type 必须是 module（宿主按 ESM 加载宿主半侧）");

need(pkg.dsh && pkg.dsh.bundle && typeof pkg.dsh.bundle.patch === "string", "缺少 dsh.bundle.patch");
need(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === "web", "dsh.client.platform 必须是 web");
need(pkg.exports && pkg.exports["."], "缺少 exports[\".\"]");
need(pkg.exports && pkg.exports["./client"], "缺少 exports[\"./client\"]");
need(pkg.exports && pkg.exports["./locale/*.json"], "缺少 exports[\"./locale/*.json\"]（少了它宿主读不到中文元信息）");

if (pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch) {
  const patch = path.join(ROOT, pkg.dsh.bundle.patch.replace(/^\.\//, ""));
  need(fs.existsSync(patch), "dsh.bundle.patch 指向的文件不存在：" + pkg.dsh.bundle.patch);
  if (fs.existsSync(patch)) {
    const text = fs.readFileSync(patch, "utf8");
    need(/insert:/.test(text), pkg.dsh.bundle.patch + " 里没有 insert 段");
  }
}

for (const entry of [".", "./client"]) {
  const target = pkg.exports && pkg.exports[entry];
  if (typeof target !== "string") continue;
  const file = path.join(ROOT, target.replace(/^\.\//, ""));
  need(fs.existsSync(file), `exports["${entry}"] 指向的文件不存在：${target}`);
}

for (const rel of ["locale/zh.json", "locale/en.json"]) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    problems.push("缺少 " + rel);
    continue;
  }
  try {
    const dict = JSON.parse(fs.readFileSync(file, "utf8"));
    need(dict.meta && dict.meta.title, rel + " 缺少 meta.title");
    need(dict.meta && dict.meta.description, rel + " 缺少 meta.description");
  } catch (e) {
    problems.push(rel + " 不是合法 JSON：" + e.message);
  }
}

if (problems.length) {
  console.error("清单有问题：");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("包清单 OK：" + pkg.name + "@" + pkg.version);
