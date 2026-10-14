/**
 * dsh-sync-hub v2.0 —— 宿主半身（Node 侧）。
 *
 * 与旧版（v0.11.0）的区别：
 *   · 执行层全部重写为 Node + 直调 git（lib/exec.js），**不 spawn powershell**；
 *   · 业务按域拆到 lib/hub/*，每个模块顶部带守卫清单（D11/D16）；
 *   · HTTP 面 8 条路由，全部经 lib/trust.js 信任围栏；
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
import { createApiHandler } from './lib/api.js'
import { rejectionFor } from './lib/trust.js'

/** 宿主半身依赖。 */
export const inject = ['tools']

/** 插件名，用于日志前缀与服务命名。 */
const NAME = 'dsh-sync-hub'

/** HTTP 前缀：比内核 /api 更长（最长前缀优先），故必须自带信任围栏。 */
const API_PREFIX = '/api/sync-hub'

/** 本插件的可变运行期状态。 */
const state = {
  hub: null,
  hubSource: 'none',
  version: null,
}

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

/**
 * 解析（或重解析）中枢路径。幂等；路径变化时更新 state。
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
 * 宿主入口。
 *
 * @param {object} ctx cordis 上下文。
 * @param {object} [config] 插件配置（cordis.patch.yml 的 config 段）。
 */
export function apply(ctx, config = {}) {
  const log = loggerOf(ctx)
  const hub = ensureHub(config)
  config.__hubSource = state.hubSource

  if (hub) {
    log.info(`中枢已识别（${state.hubSource}）：${hub}，VERSION ${state.version ?? '未知'}`)
  } else {
    log.warn('未找到中枢仓库；同步面板会显示引导，其余功能降级')
  }

  // ① 把 API 暴露成 Cordis 服务：其他插件可 ctx.get('syncHub') 复用，
  //    浏览器半身经 HTTP 打同一份处理器。
  const api = createApiHandler({ hubPath: () => state.hub, config })
  const service = {
    name: NAME,
    hubPath: () => state.hub,
    hubVersion: () => state.version,
    api,
  }
  try { ctx.provide(NAME, service) } catch { /* 已提供过则忽略，保证幂等 */ }

  // ② HTTP 挂载：必须用 ctx.inject 拿 webServer（插件加载早于它出现）。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scoped) => {
      const server = scoped.webServer
      if (!server || typeof server.register !== 'function') {
        log.warn('webServer 服务不可用，HTTP 面未挂载')
        return
      }
      scoped.effect(() => server.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => {
          // 信任围栏：本前缀比 /api 长，会跑到 connection 门禁之前。
          const connection = typeof scoped.get === 'function'
            ? () => { try { return scoped.get('connection') } catch { return undefined } }
            : undefined
          const status = rejectionFor(req, connection, (d) => {
            log.warn(`拒绝请求：${d.source}/${d.reason}`)
          })
          if (status !== undefined) {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: 'forbidden' }))
            return
          }
          // 前缀剥离：把 /api/sync-hub/xxx 还原成 /xxx 交给路由器。
          const url = new URL(req.url ?? '/', 'http://dsh.invalid')
          const routePath = url.pathname.startsWith(API_PREFIX)
            ? url.pathname.slice(API_PREFIX.length) || '/'
            : '/'
          api(req, res, routePath)
        },
      }), 'sync-hub: api')
      log.info(`HTTP 面已挂载：${API_PREFIX}/`)
    })
  }

  // ③ 生命周期占位：卸载时释放（后续 watcher / 定时器在此回收）。
  ctx.effect(() => () => { /* M6 起在此释放资源 */ }, 'sync-hub: lifecycle')
}

export default { apply, inject, name: NAME }
