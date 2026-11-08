/**
 * lib/index.js —— 宿主侧 cordis 服务。
 *
 * 契约与宿主插件规范一致：
 *   export const name / inject / apply / default
 *
 * 两条铁律，和这个 bench 上其它第三方插件一样：
 *   1. inject 里一个都不写。写进去的服务只要某个版本没有，cordis 就停在 pending，
 *      宿主表现为卡死 —— 这是「装了插件客户端起不来」的头号成因。服务全部软取。
 *   2. 每一段各自 try/catch。失败只记在 runtime 里，由面板显示，不抛给宿主。
 */
import { API_PREFIX, dispatch } from "./api.js";

const ROUTE_PATH = API_PREFIX;

export const name = "capability-center";
export const inject = [];

/** 运行时状态，供 /capability/api/state 的诊断字段使用。进程内单例。 */
export const runtime = {
  routes: { attached: false, path: ROUTE_PATH, error: "" },
  version: "0.1.0",
};

const DEFAULTS = {
  enabled: true,
  panelOrder: 5,
  verbose: false,
};

function log(cfg, ...args) {
  if (cfg && cfg.verbose) console.log("[capability-center]", ...args);
}

function readBody(req, done) {
  let payload = "";
  req.on("data", (chunk) => {
    payload += chunk;
    if (payload.length > 1 << 20) req.destroy();
  });
  req.on("end", () => done(payload));
  req.on("error", () => done(""));
}

function attachRoutes(ctx, cfg) {
  const out = { attached: false, path: ROUTE_PATH, error: "" };
  if (!ctx || typeof ctx.inject !== "function") {
    out.error = "ctx.inject 不可用";
    return out;
  }
  try {
    ctx.inject(["webServer"], (webCtx) => {
      const server = typeof webCtx.get === "function" ? webCtx.get("webServer") : null;
      if (!server || typeof server.register !== "function") {
        out.error = "webServer 未提供 register";
        return;
      }

      const handler = (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const method = String(req.method || "GET").toUpperCase();
        const query = {};
        for (const [k, v] of url.searchParams.entries()) query[k] = v;

        const respond = async (payload = "") => {
          let result;
          try {
            let params = { ...query };
            if (payload) {
              const ct = String(req.headers["content-type"] || "");
              if (ct.includes("application/json")) {
                try {
                  Object.assign(params, JSON.parse(payload));
                } catch {
                  /* body 坏了就只用 query */
                }
              } else {
                for (const [k, v] of new URLSearchParams(payload).entries()) params[k] = v;
              }
            }
            result = await dispatch(method, url.pathname, params, ctx);
          } catch (e) {
            result = {
              status: 500,
              contentType: "application/json; charset=utf-8",
              body: JSON.stringify({ ok: false, code: "INTERNAL", message: String(e && e.message) }),
            };
          }
          try {
            res.writeHead(result.status, {
              "Content-Type": result.contentType,
              "Content-Length": Buffer.byteLength(result.body),
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            res.end(result.body);
          } catch {
            /* 客户端已断开 */
          }
        };

        if (method === "POST") {
          readBody(req, respond);
        } else {
          void respond();
        }
      };

      try {
        const dispose = server.register({ kind: "prefix", path: ROUTE_PATH, handler });
        out.attached = true;
        if (typeof webCtx.effect === "function" && typeof dispose === "function") {
          try {
            webCtx.effect(() => dispose, "capability-center: api routes");
          } catch {
            /* effect 不可用就靠宿主卸载时整体回收 */
          }
        }
      } catch (e) {
        out.error = "注册路由失败：" + String(e && e.message);
      }
    });
    out.attached = true;
  } catch (e) {
    out.error = String(e && e.message);
  }
  return out;
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  if (!cfg.enabled) {
    log(cfg, "配置 enabled=false，跳过装配");
    return;
  }
  try {
    runtime.routes = attachRoutes(ctx, cfg);
    log(cfg, "routes:", runtime.routes);
  } catch (e) {
    runtime.routes = { attached: false, path: ROUTE_PATH, error: String(e && e.message) };
  }
}

const plugin = { name, inject, apply };
export default plugin;
