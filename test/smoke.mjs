/**
 * test/smoke.mjs —— 不依赖宿主，直接跑宿主侧 API。
 *
 * 用一个临时 DSH_HOME 造两个技能（一个启用、一个停用），
 * 验证：清单读取、开关移动、详情读取、错误分支。
 *
 *   node test/smoke.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-smoke-"));
const home = path.join(tmp, ".dsh");
const agents = path.join(tmp, ".agents");
const skillsRoot = path.join(home, "skills");

function writeSkill(root, name, desc, extra = "") {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    ["---", "name: " + name, "description: " + desc, extra, "---", "", "# " + name, "", "正文第一段。"].join("\n"),
    "utf8"
  );
}

writeSkill(skillsRoot, "alpha-skill", "第一个技能");
writeSkill(skillsRoot, "beta-skill", "第二个技能");
writeSkill(path.join(skillsRoot, ".disabled"), "parked-skill", "被停用的技能");

process.env.DSH_HOME = home;
process.env.AGENTS_HOME = agents;

const { dispatch } = await import("../lib/api.js");

/** 假 ctx：profileContext 指到临时目录，其余服务一律没有。 */
const ctx = {
  get(name) {
    if (name === "profileContext") {
      return { name: "smoke", dir: path.join(home, "profiles", "smoke"), home, cwd: tmp, startedBundles: [] };
    }
    return null;
  },
};

fs.mkdirSync(path.join(home, "profiles", "smoke"), { recursive: true });

const read = async (method, p, q) => {
  const r = await dispatch(method, p, q || {}, ctx);
  return { status: r.status, body: JSON.parse(r.body) };
};

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("  ok   " + name);
  } catch (e) {
    failures++;
    console.log("  FAIL " + name + " — " + (e && e.message));
  }
}

console.log("== state ==");
const st = await read("GET", "/capability/api/state");
check("status 200", () => assert.equal(st.status, 200));
check("ok", () => assert.equal(st.body.ok, true));
check("三个技能都在", () => assert.equal(st.body.skills.length, 3));
check("启用 2 停用 1", () => {
  assert.equal(st.body.counts.skillsOn, 2);
  assert.equal(st.body.skills.filter((s) => !s.enabled).length, 1);
});
check("有调用指令", () => assert.equal(st.body.skills[0].invoke, "/alpha-skill"));
check("没有 pluginManager 也不报错", () => assert.equal(st.body.capabilities.pluginManager, false));

console.log("== 关掉一个技能 ==");
const target = st.body.skills.find((s) => s.name === "alpha-skill");
const off = await read("POST", "/capability/api/toggle", { kind: "skill", id: target.id, enabled: false });
check("toggle 成功", () => assert.equal(off.body.ok, true));
check("文件已挪进 .disabled", () =>
  assert.ok(fs.existsSync(path.join(skillsRoot, ".disabled", "alpha-skill", "SKILL.md")))
);
check("原位置已空", () => assert.ok(!fs.existsSync(path.join(skillsRoot, "alpha-skill"))));

const st2 = await read("GET", "/capability/api/state");
check("停用数变成 2", () => assert.equal(st2.body.skills.filter((s) => !s.enabled).length, 2));

console.log("== 再打开 ==");
const parked = st2.body.skills.find((s) => s.name === "alpha-skill");
const on = await read("POST", "/capability/api/toggle", { kind: "skill", id: parked.id, enabled: true });
check("toggle 回来成功", () => assert.equal(on.body.ok, true));
check("文件已回原位", () => assert.ok(fs.existsSync(path.join(skillsRoot, "alpha-skill", "SKILL.md"))));

console.log("== 详情 ==");
const st3 = await read("GET", "/capability/api/state");
const detail = await read("GET", "/capability/api/skill", { id: st3.body.skills[0].id });
check("详情有正文", () => assert.ok(detail.body.content.includes("正文第一段")));

console.log("== 错误分支 ==");
const bad = await read("GET", "/capability/api/skill", { id: "nope" });
check("未知技能 400", () => assert.equal(bad.status, 400));
const badKind = await read("POST", "/capability/api/toggle", { kind: "zzz", id: "x" });
check("未知类型 400", () => assert.equal(badKind.status, 400));
const noPm = await read("POST", "/capability/api/toggle", { kind: "plugin", id: "x", enabled: true });
check("没有插件管理器时给出明确错误", () => assert.equal(noPm.body.code, "no-plugin-manager"));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? "\n" + failures + " 个失败" : "\n全部通过");
process.exit(failures ? 1 : 0);
