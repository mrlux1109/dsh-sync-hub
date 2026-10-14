/**
 * lib/api.js —— HTTP 面：8 条路由 + 统一 JSON 出口。
 *
 * 设计（开发文档 §6.2，决策 D11 全部重写后的路由集）：
 *   旧版 40 条 → 新版 8 条。删掉的 8 条 plugins/* 由官方 dshmarket 覆盖（D6）。
 *   每条路由只做"取参数 → 调 lib/hub/* → 回 JSON"，不含业务判断。
 *
 * 安全：
 *   · 全部路由经 lib/trust.js 围栏（前缀比 /api 长，会跑到 connection 门禁之前）；
 *   · GET 只读；POST 才动磁盘/git，且逐个模块的守卫已在 hub 层生效；
 *   · 错误统一 {ok:false, error}，错误文本截断 500 字符，不回显请求内容。
 *
 * @module lib/api.js
 */

import { hubStatus, hubInventory, hubLog } from './hub/status.js'
import { push, pull, previewPush, conflictedFiles } from './hub/sync.js'
import {
  inspectConflict, writeResolution, finishRebase,
} from './hub/conflict.js'
import {
  listBackups, createBackup, restoreBackup, deleteBackup,
} from './hub/snapshot.js'
import {
  listMachines, readFingerprint, identityGuard, saveMachineId, mergeSkills, buildAgentsFile,
} from './hub/apply.js'
import { compareSkills } from './hub/skills.js'
import { computeHealth, machineBoard } from './hub/health.js'
import {
  sessionsInfo, backupSessions, restoreSessions, listSessionBackups,
} from './hub/sessions.js'
import { inspectTools, machineFacts, readToolManifest, installTools } from './hub/collect.js'
import {
  scheduleStatus, scheduleInstall, scheduleRemove, TASK_NAME, logFile,
} from './hub/schedule.js'
import {
  portableSetup, readPluginSpec, linkPluginIntoProfile, cloneOrPullPlugin, credentialPresent,
} from './hub/portable.js'
import { readHubVersion } from './hub-paths.js'

/** 响应体最大字符数（防失控输出）。 */
const MAX_BODY = 512

/**
 * 写一个 JSON 响应。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status HTTP 状态。
 * @param {object} body 业务体。
 */
function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * 读请求体并 JSON 解析。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [limit] 最大字节数，默认 64KB。
 * @returns {Promise<{ok:true, value:object} | {ok:false, error:string}>}
 */
function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        resolve({ ok: false, error: '请求体过大' })
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({ ok: true, value: {} })
      try {
        resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        resolve({ ok: false, error: '请求体不是合法 JSON' })
      }
    })
    req.on('error', () => resolve({ ok: false, error: '读取请求体失败' }))
  })
}

/**
 * 把一次业务调用包装成"永不抛出"的 JSON 响应。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {() => Promise<object>|object} fn 业务函数。
 * @returns {Promise<void>}
 */
async function safe(res, fn) {
  try {
    const body = await fn()
    json(res, 200, body)
  } catch (error) {
    json(res, 200, {
      ok: false,
      error: String(error?.message ?? error).slice(0, MAX_BODY),
    })
  }
}

/**
 * 构造本插件的 HTTP 处理器。
 *
 * @param {{hubPath:() => string|null, config:object}} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, routePath: string) => void}
 */
export function createApiHandler(deps) {
  const { hubPath, config } = deps

  return function handler(req, res, routePath) {
    // 没找到中枢时，除 /env 外一律说明情况（不让 UI 拿到假的成功）。
    const hub = hubPath()

    if (req.method === 'GET' && routePath === '/overview') {
      return void safe(res, async () => {
        if (!hub) return { ok: false, stage: 'no-hub', error: '未找到中枢仓库', hubSource: config.__hubSource }
        const [status, inventory, log, tools, health, board] = await Promise.all([
          hubStatus(hub).catch((e) => ({ ok: false, error: String(e?.message ?? e) })),
          Promise.resolve(hubInventory(hub)),
          hubLog(hub, { limit: 10 }).catch((e) => ({ ok: false, commits: [] })),
          inspectTools(hub).catch((e) => ({ ok: false, summary: {}, error: String(e?.message ?? e) })),
          computeHealth(hub).catch(() => ({ ok: false, score: null, items: [] })),
          machineBoard(hub).catch(() => ({ ok: false, machines: [] })),
        ])
        const schedule = await scheduleStatus({ taskName: TASK_NAME }).catch(() => ({ installed: false }))
        const cred = await credentialPresent().catch(() => ({ haveCredential: false }))
        return {
          ok: true,
          hub,
          version: readHubVersion(hub),
          status,
          inventory,
          recent: log.ok ? log.commits : [],
          tools: tools.ok ? tools.summary : {},
          health,
          board: board.ok ? board.machines : [],
          schedule,
          credential: cred,
          machine: machineFacts(),
        }
      })
    }

    if (req.method === 'POST' && routePath === '/sync') {
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        const action = String(body.value?.action ?? '')
        if (!hub) return json(res, 200, { ok: false, stage: 'no-hub', error: '未找到中枢仓库' })
        if (action === 'preview') {
          return void safe(res, () => previewPush(hub, {
            scopes: body.value?.scopes,
            except: body.value?.except,
            skills: body.value?.skills,
            sessions: body.value?.sessions,
          }))
        }
        if (action === 'push') {
          return void safe(res, () => push(hub, {
            scopes: body.value?.scopes,
            except: body.value?.except,
            skills: body.value?.skills,
            sessions: body.value?.sessions,
            message: body.value?.message,
            allowSecrets: body.value?.allowSecrets === true,
          }))
        }
        if (action === 'pull') {
          return void safe(res, () => pull(hub, {}))
        }
        if (action === 'conflicts') {
          return void safe(res, () => conflictedFiles(hub).then((files) => ({ ok: true, conflicts: files })))
        }
        if (action === 'conflict-inspect') {
          return void safe(res, async () => {
            const file = String(body.value?.file ?? '')
            const info = await inspectConflict(hub, file)
            return info
          })
        }
        if (action === 'conflict-resolve') {
          return void safe(res, () => {
            const file = String(body.value?.file ?? '')
            const content = String(body.value?.content ?? '')
            return writeResolution(hub, file, content)
          })
        }
        if (action === 'conflict-finish') {
          return void safe(res, () => finishRebase(hub, body.value?.files ?? []))
        }
        json(res, 400, { ok: false, error: `未知动作：${action}` })
      })()
    }

    if (routePath === '/content') {
      if (req.method === 'GET') {
        return void safe(res, () => ({
          ok: true,
          backups: listBackups(hub ?? ''),
        }))
      }
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        const action = String(body.value?.action ?? '')
        if (action === 'backup') return void safe(res, () => createBackup())
        if (action === 'restore') return void safe(res, () => restoreBackup(String(body.value?.name ?? '')))
        if (action === 'delete') return void safe(res, () => deleteBackup(String(body.value?.name ?? '')))
        json(res, 400, { ok: false, error: `未知动作：${action}` })
      })()
    }

    if (routePath === '/skills') {
      if (req.method === 'GET') {
        return void safe(res, () => {
          if (!hub) return { ok: false, error: '未找到中枢仓库' }
          return { ok: true, ...compareSkills(hub) }
        })
      }
      json(res, 405, { ok: false, error: '/skills 只支持 GET' })
    }

    if (routePath === '/sessions') {
      if (req.method === 'GET') {
        return void safe(res, () => ({
          ok: true,
          local: sessionsInfo(),
          hub: hub ? listSessionBackups(hub) : { machines: [] },
        }))
      }
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        const action = String(body.value?.action ?? '')
        if (!hub) return json(res, 200, { ok: false, stage: 'no-hub', error: '未找到中枢仓库' })
        if (action === 'backup') {
          return void safe(res, () => backupSessions(hub, {
            days: body.value?.days,
            workspaces: body.value?.workspaces,
          }))
        }
        if (action === 'restore') {
          return void safe(res, () => restoreSessions(hub, {
            from: body.value?.from,
            noMap: body.value?.noMap === true,
            workspaces: body.value?.workspaces,
          }))
        }
        json(res, 400, { ok: false, error: `未知动作：${action}` })
      })()
    }

    if (routePath === '/env') {
      if (req.method === 'GET') {
        return void safe(res, async () => ({
          ok: true,
          tools: hub ? await inspectTools(hub) : { ok: false, tools: [], summary: {} },
          manifest: hub ? readToolManifest(hub) : { ok: false, tools: [] },
          schedule: await scheduleStatus({ taskName: TASK_NAME }),
          logFile: logFile(),
          machine: machineFacts(),
          credential: await credentialPresent(),
          hubSource: config.__hubSource,
          hubPath: hub,
        }))
      }
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        const action = String(body.value?.action ?? '')
        if (action === 'schedule-install') {
          if (!hub) return json(res, 200, { ok: false, error: '未找到中枢仓库' })
          return void safe(res, () => scheduleInstall(hub, {}))
        }
        if (action === 'schedule-remove') {
          return void safe(res, () => scheduleRemove({}))
        }
        if (action === 'install-tools') {
          if (!hub) return json(res, 200, { ok: false, error: '未找到中枢仓库' })
          return void safe(res, () => installTools(hub, body.value?.keys ?? [], {
            includeNice: body.value?.includeNice === true,
          }))
        }
        json(res, 400, { ok: false, error: `未知动作：${action}` })
      })()
    }

    if (routePath === '/portable') {
      if (req.method === 'GET') {
        return void safe(res, () => ({
          ok: true,
          spec: hub ? readPluginSpec(hub) : { ok: false },
          credential: null,
        }))
      }
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        const action = String(body.value?.action ?? '')
        if (!hub) return json(res, 200, { ok: false, error: '未找到中枢仓库' })
        if (action === 'check') {
          const [spec, cred, gitv] = await Promise.all([
            Promise.resolve(readPluginSpec(hub)),
            credentialPresent(),
            (await import('./exec.js')).run('git', ['--version'], { timeoutMs: 8000 }),
          ])
          return json(res, 200, {
            ok: true,
            spec,
            credential: cred,
            git: gitv.ok ? gitv.stdout.trim() : null,
          })
        }
        if (action === 'setup') {
          return void safe(res, () => portableSetup(hub, {
            profile: body.value?.profile,
            dryRun: body.value?.dryRun !== false,
          }))
        }
        if (action === 'link') {
          return void safe(res, () => linkPluginIntoProfile(hub, String(body.value?.profile ?? 'desktop'), { dryRun: false }))
        }
        if (action === 'clone') {
          return void safe(res, () => cloneOrPullPlugin(hub, { dryRun: false }))
        }
        json(res, 400, { ok: false, error: `未知动作：${action}` })
      })()
    }

    if (req.method === 'GET' && routePath === '/identity') {
      return void safe(res, () => ({
        ok: true,
        machines: hub ? listMachines(hub) : [],
        fingerprints: hub ? Object.fromEntries(listMachines(hub).map((id) => [id, readFingerprint(hub, id)])) : {},
        saved: savedMachineIdOf(),
      }))
    }

    if (req.method === 'POST' && routePath === '/identity') {
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        if (!hub) return json(res, 200, { ok: false, error: '未找到中枢仓库' })
        const id = String(body.value?.machine ?? '')
        const guard = identityGuard(hub, id, {
          dryRun: body.value?.dryRun === true,
          force: body.value?.force === true,
          confirm: body.value?.confirm,
        })
        if (!guard.ok) return json(res, 200, guard)
        if (body.value?.dryRun !== true && body.value?.apply === true) {
          const saved = saveMachineId(id)
          if (!saved.ok) return json(res, 200, { ok: false, error: saved.error })
          const agents = buildAgentsFile(hub, id)
          const skills = mergeSkills(hub, { skillWhitelist: body.value?.skills })
          return json(res, 200, { ok: true, guard, agents, skills })
        }
        json(res, 200, guard)
      })()
    }

    // 未知路由
    json(res, 404, { ok: false, error: `未知路由：${req.method} ${routePath}` })
  }
}

/** 本机已保存身份（供 /identity GET）。 */
function savedMachineIdOf() {
  try {
    const fs = require('node:fs')
    const path = require('node:path')
    const os = require('node:os')
    const p = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.sync-hub-machine')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''
  } catch {
    return ''
  }
}
