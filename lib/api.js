/**
 * lib/api.js —— 面板背后的 HTTP 接口。
 *
 * 只暴露一个前缀 /capability/api，不碰宿主其它路由：
 *   GET  /state              当前全量清单
 *   POST /toggle             {kind, id, enabled} 开/关一个技能、插件、组合包或连接器
 *   GET  /skill?id=…         某个技能的正文（详情抽屉用）
 *   GET  /ping               健康检查
 */
import { setSkillEnabled, readSkillBody } from "./skills.js";
import { buildState, collectPlugins, collectConnectors, collectSkills, profileManifest, svc } from "./state.js";
import { resolveProfile, agentsHome as resolveAgentsHome } from "./paths.js";

export const API_PREFIX = "/capability/api";

function json(status, body) {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  };
}

function fail(code, message, extra) {
  return json(400, { ok: false, code, message, ...(extra || {}) });
}

/** 按 id 重新扫描并定位技能（避免信任前端传来的路径）。 */
async function findSkill(ctx, profile, id) {
  const list = await collectSkills(ctx, {
    home: profile.home,
    agentsHome: resolveAgentsHome(),
    cwd: profile.cwd || process.cwd(),
  });
  return list.find((s) => s.id === id) || null;
}

async function toggle(ctx, profile, payload) {
  const kind = String(payload.kind || "");
  const enabled = payload.enabled !== false;

  if (kind === "skill") {
    const skill = await findSkill(ctx, profile, String(payload.id || ""));
    if (!skill) return fail("skill-not-found", "找不到该技能（可能已被移动或删除）");
    const res = setSkillEnabled(skill, enabled);
    if (!res.ok) return fail("skill-move-failed", res.error || "开关失败");
    return json(200, { ok: true, kind, id: payload.id, enabled, item: res.item });
  }

  const pm = svc(ctx, "pluginManager");
  if (!pm) return fail("no-plugin-manager", "当前 profile 没有插件管理器，无法修改插件状态");

  if (kind === "plugin" || kind === "connector") {
    const target = String(payload.id || payload.rowId || "");
    if (!target) return fail("bad-id", "缺少条目 id");
    try {
      const out = await pm.setPluginEnabled(target, enabled);
      return json(200, { ok: true, kind, id: target, enabled, result: out ?? null });
    } catch (e) {
      return fail("plugin-toggle-failed", String(e && e.message), { retryable: true });
    }
  }

  if (kind === "bundle") {
    const name = String(payload.id || "");
    if (!name) return fail("bad-id", "缺少组合包名");
    try {
      const out = await pm.setBundleEnabled(name, enabled);
      return json(200, { ok: true, kind, id: name, enabled, result: out ?? null });
    } catch (e) {
      return fail("bundle-toggle-failed", String(e && e.message), { retryable: true });
    }
  }

  return fail("bad-kind", "未知的条目标识：" + kind);
}

/** 统一入口。返回 {status, contentType, body}。 */
export async function dispatch(method, pathname, query, ctx) {
  const profile = resolveProfile(ctx);
  const path = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) || "/" : pathname;

  if (method === "GET" && (path === "/ping" || path === "/")) {
    return json(200, { ok: true, plugin: "dsh-capability-center", profile: profile.name, at: Date.now() });
  }

  if (method === "GET" && path === "/state") {
    try {
      const state = await buildState(ctx, profile);
      state.manifest = profileManifest(profile.dir);
      return json(200, state);
    } catch (e) {
      return json(500, { ok: false, code: "state-failed", message: String(e && e.message) });
    }
  }

  if (method === "POST" && path === "/toggle") {
    try {
      return await toggle(ctx, profile, query || {});
    } catch (e) {
      return json(500, { ok: false, code: "toggle-failed", message: String(e && e.message) });
    }
  }

  if (method === "GET" && path === "/skill") {
    const skill = await findSkill(ctx, profile, String(query?.id || ""));
    if (!skill) return fail("skill-not-found", "找不到该技能");
    let content = readSkillBody(skill);
    let skillPath = skill.path || "";
    if (!content) {
      // 内置/远程技能没有磁盘路径，退回注册表的加载接口拿正文
      const skills = svc(ctx, "skills");
      if (skills && typeof skills.get === "function") {
        try {
          const def = await skills.get(skill.name, { cwd: profile.cwd || process.cwd() });
          if (def) {
            content = String(def.content || "");
            skillPath = skillPath || String(def.path || "");
          }
        } catch {
          /* 读不到就保持空 */
        }
      }
    }
    return json(200, {
      ok: true,
      skill: { ...skill, path: skillPath },
      content,
    });
  }

  if (method === "GET" && path === "/refresh") {
    try {
      const plugins = await collectPlugins(ctx);
      const connectors = collectConnectors(ctx, plugins);
      return json(200, { ok: true, plugins, connectors });
    } catch (e) {
      return json(500, { ok: false, code: "refresh-failed", message: String(e && e.message) });
    }
  }

  return json(404, { ok: false, code: "not-found", message: "未知接口 " + method + " " + pathname });
}
