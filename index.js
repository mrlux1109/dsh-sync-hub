/**
 * dsh-sync-hub v2.0 —— 宿主半身（Node 侧）。
 *
 * 与旧版（v0.11.0）的区别：
 *   · 执行层全部重写为 Node + 直调 git（lib/exec.js），**不 spawn powershell**；
 *   · 业务按域拆到 lib/hub/*，每个模块顶部带守卫清单（D11/D16）；
 *   · HTTP 面收缩为 8 条以内，全部经 lib/trust.js 信任围栏；
 *   · 模型工具（sync_hub_*）沿用裸对象注册的标准写法，schema 用标准 JSON Schema。
 *
 * 契约（memory 4.17，宿主实证）：
 *   · export const inject = ['tools']  —— 缺半身只降级不炸启动；
 *   · export function apply(ctx, config)；
 *   · 工具用 ctx.tools.register(裸对象)，**不要** import '@deepseek-ai/dsh-tools'
 *     （第三方插件目录解析不到它，报 ERR_MODULE_NOT_FOUND）；
 *   · webServer 必须用 ctx.inject(['webServer'], …) 拿，一次性 ctx.get() 会拿到 undefined。
 *
 * @module index.js
 */

import { resolveHubPath, readHubVersion } from './lib/hub-paths.js'
import { hubStatus, hubInventory, hubLog } from './lib/hub/status.js'

/** 宿主半身依赖。 */
export const inject = ['tools']

/** 插件名，用于日志前缀与服务命名。 */
const NAME = 'dsh-sync-hub'

/**
 * 取一个安全日志器：宿主 logger 可选，绝不因缺 logger 而崩。
 * @param {object} ctx cordis 上下文。
 * @returns {{info:Function, warn:Function, error:Function}}
 */
function loggerOf(ctx) {
  const l = ctx.logger
  return {
    info: (...a) => { try { l?.info?.(`[${NAME}]`, ...a) } catch { /* 日志失败不影响主流程 */ } },
    warn: (...a) => { try { l?.warn?.(`[${NAME}]`, ...a) } catch { /* 同上 */ } },
    error: (...a) => { try { l?.error?.(`[${NAME}]`, ...a) } catch { /* 同上 */ } },
  }
}

/** 本插件的可变运行期状态（路径解析结果 + 最近一次查询缓存）。 */
const state = {
  hub: null,
  hubSource: 'none',
  version: null,
}

/**
 * 解析（或重解析）中枢路径。幂等；路径变化时会更新 state。
 * @param {object} config 插件配置。
 * @returns {string|null} 中枢路径。
 */
function ensureHub(config) {
  const resolved = resolveHubPath(config)
  state.hub = resolved.path
  state.hubSource = resolved.source
  state.version = resolved.path ? readHubVersion(resolved.path) : null
  return state.hub
}

/**
 * 构造一次中枢概览（总览页 /overview 的数据源）。
 *
 * @param {object} config 插件配置。
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<object>}
 */
async function buildOverview(config, options = {}) {
  const hub = ensureHub(config)
  if (!hub) {
    return {
      ok: false,
      error: '未找到中枢仓库（期望目录含 VERSION 与 tools/status.ps1）。请先在中枢里 clone，或用 config.hubPath 指定。',
      hubSource: state.hubSource,
    }
  }
  const [status, inventory, log] = await Promise.all([
    hubStatus(hub, { signal: options.signal }).catch((e) => ({ ok: false, error: String(e?.message ?? e) })),
    Promise.resolve(hubInventory(hub)),
    hubLog(hub, { limit: 10, signal: options.signal }).catch((e) => ({ ok: false, commits: [], error: String(e?.message ?? e) })),
  ])
  return {
    ok: true,
    hub,
    hubSource: state.hubSource,
    version: state.version,
    status,
    inventory,
    recent: log.ok ? log.commits : [],
  }
}

/**
 * 宿主入口。
 *
 * M1 阶段只做：路径解析 + 概览数据装配（供 M2 面板接线）。
 * 模型工具与 HTTP 路由在 M3/M4 按文档里程碑补齐。
 *
 * @param {object} ctx cordis 上下文。
 * @param {object} [config] 插件配置（cordis.patch.yml 的 config 段）。
 */
export function apply(ctx, config = {}) {
  const log = loggerOf(ctx)
  const hub = ensureHub(config)

  if (hub) {
    log.info(`中枢已识别（${state.hubSource}）：${hub}，VERSION ${state.version ?? '未知'}`)
  } else {
    log.warn('未找到中枢仓库；同步面板会显示引导，其余功能降级')
  }

  // 把概览构造器以服务形态提供出去：浏览器半身将来经 HTTP 打这里，
  // 其他插件也可 ctx.get('syncHub') 复用（与 whale-pet 的 ctx.provide 同款写法）。
  const service = {
    name: NAME,
    hubPath: () => state.hub,
    hubVersion: () => state.version,
    overview: (options) => buildOverview(config, options),
  }
  try { ctx.provide(NAME, service) } catch { /* 已提供过则忽略，保证幂等 */ }

  // 生命周期：卸载时无需清理（本阶段无长驻资源），保留 effect 占位以便后续扩展。
  ctx.effect(() => () => { /* M3 起在此释放 watcher / HTTP 路由 */ }, 'sync-hub: lifecycle')
}

export default { apply, inject, name: NAME }
