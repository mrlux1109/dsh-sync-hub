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

import { hubStatus, hubInventory, hubLog, hubTimeline } from './hub/status.js'
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
import { listEditableFiles, readEditableFile, saveEditableFile } from './hub/memory.js'
import { computeHealth, machineBoard } from './hub/health.js'
import {
  sessionsInfo, backupSessions, restoreSessions, listSessionBackups,
} from './hub/sessions.js'
import { findMissingWorkspaces, createWorkspaceDirs, readSavedMachineId } from './hub/workspace.js'
import { readRoles, writeRole } from './hub/roles.js'
import { checkPluginUpdate as hubCheckPluginUpdate } from './hub/plugin-update.js'
import { applyPluginUpdate } from './hub/plugin-apply.js'
import { inspectTools, machineFacts, readToolManifest, installTools } from './hub/collect.js'
import {
  scheduleStatus, scheduleInstall, scheduleRemove, TASK_NAME, logFile,
} from './hub/schedule.js'
import {
  portableSetup, readPluginSpec, linkPluginIntoProfile, cloneOrPullPlugin, credentialPresent,
} from './hub/portable.js'
import {
  resolveHubPath, readHubVersion, saveHubPath, readSavedHubPath, readAutoPush, writeAutoPush,
} from './hub-paths.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { run } from './exec.js'

/**
 * 检查插件更新：转发到 lib/hub/plugin-update.js（单一事实源）。
 * @returns {Promise<{ok:boolean, update?:{current:string, latest:string, hasUpdate:boolean, where:string}, error?:string}>}
 */
async function checkPluginUpdate() {
  const r = await hubCheckPluginUpdate()
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, update: { current: r.current, latest: r.latest, hasUpdate: r.hasUpdate, where: r.where } }
}

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
  /** 中枢路径的运行时写回（index.js 提供，save-path/clone 成功后同步状态）。 */
  const setHub = deps.setHub ?? (() => {})

  return function handler(req, res, routePath) {
    // 没找到中枢时，除 /env 外一律说明情况（不让 UI 拿到假的成功）。
    const hub = hubPath()

    // ── 首次运行引导（onboarding）：没有中枢时，面板据此显示向导而不是一片"—" ──
    if (routePath === '/onboarding') {
      if (req.method === 'GET') {
        return void safe(res, async () => ({
          ok: true,
          needsOnboarding: config.__needsOnboarding === true,
          hubPath: hub,
          hubSource: config.__hubSource,
          dshHome: machineFacts().dshHome,
          git: await (async () => {
            const r = await run('git', ['--version'], { timeoutMs: 8000 })
            return r.ok ? r.stdout.trim() : null
          })(),
          credential: await credentialPresent().catch(() => ({ haveCredential: false })),
          savedPath: readSavedHubPath(),
        }))
      }
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        const action = String(body.value?.action ?? '')

        if (action === 'save-path') {
          const r = saveHubPath(String(body.value?.path ?? ''))
          let resolvedInfo = null
          if (r.ok) {
            // 立即重解析，让本次响应就能告诉前端新状态
            const resolved = resolveHubPath(config)
            setHub(resolved)
            resolvedInfo = { hub: resolved.path, needsOnboarding: resolved.needsOnboarding }
          }
          return json(res, 200, { ...r, resolved: resolvedInfo })
        }

        if (action === 'clone') {
          // 首次引导的"克隆中枢"：目标目录默认 ~/sync-hub，可自定义。
          // 守卫：目标已存在且非空 → 拒绝（绝不覆盖用户目录）。
          // repo 来源：调用方可指定（向导场景=用户自己的私有仓），但强制 https://
          // scheme 白名单——拒绝 file:// 与 scp 形态，杜绝本地路径与意外协议。
          const target = String(body.value?.target ?? path.join(os.homedir(), 'sync-hub'))
          const repo = String(body.value?.repo ?? 'https://gitee.com/mrlux/ai-sync-hub.git')
          if (!/^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(repo)) {
            return json(res, 400, { ok: false, error: '仓库地址必须是以 https:// 开头的合法 URL' })
          }
          if (!path.isAbsolute(target)) {
            return json(res, 400, { ok: false, error: '目标目录必须是绝对路径' })
          }
          if (fs.existsSync(path.join(target, '.git'))) {
            return json(res, 200, { ok: false, error: '目标目录已经是 git 仓库，请直接选它（用"保存路径"）' })
          }
          if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
            return json(res, 200, { ok: false, error: '目标目录非空，拒绝克隆进去（换一个空目录）' })
          }
          const r = await run('git', ['clone', repo, target], { timeoutMs: 600_000 })
          if (!r.ok) {
            const text = `${r.stdout}\n${r.stderr}`.trim()
            const hint = /Authentication failed|could not read Username|terminal prompts disabled/i.test(text)
              ? '克隆失败多为凭据问题：请在普通终端手动 git clone 一次，让凭据管理器弹出 Gitee 登录窗口，然后回来用"保存路径"。'
              : /sslBackend|schannel/i.test(text)
                ? 'TLS 后端故障：执行 git config --global http.sslBackend openssl 后重试。'
                : ''
            return json(res, 200, { ok: false, error: text.slice(0, 400) || '克隆失败', hint })
          }
          const sr = saveHubPath(target)
          const resolved = resolveHubPath(config)
          setHub(resolved)
          return json(res, 200, { ok: true, target, saved: sr.ok, resolved: { hub: resolved.path, needsOnboarding: resolved.needsOnboarding } })
        }

        json(res, 400, { ok: false, error: `未知动作：${action}` })
      })()
    }

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

    // ── 记忆·配置页（白名单文件浏览/读取/保存，G1–G6 守卫在 memory.js）──
    if (routePath === '/memory') {
      if (!hub) return json(res, 200, { ok: false, stage: 'no-hub', error: '未找到中枢仓库' })
      if (req.method === 'GET' && !routePath.startsWith('/memory/')) {
        return void safe(res, () => listEditableFiles(hub))
      }
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        const action = String(body.value?.action ?? '')
        if (action === 'read') {
          return void safe(res, () => readEditableFile(hub, String(body.value?.path ?? '')))
        }
        if (action === 'save') {
          // N7：autoPush 由客户端偏好开关决定（此处透传，默认 false）
          const autoPush = body.value?.autoPush === true || readAutoPush()
          return void safe(res, () => saveEditableFile(hub, {
            path: String(body.value?.path ?? ''),
            content: String(body.value?.content ?? ''),
            baseSha: body.value?.baseSha ?? null,
            message: body.value?.message,
            autoPush,
          }))
        }
        json(res, 400, { ok: false, error: `未知动作：${action}` })
      })()
    }

    // ── N7 自动推送开关（读写偏好文件）──
    // ── N2 同步时间线（按机器筛选的数据在客户端过滤）──
    if (req.method === 'GET' && routePath === '/timeline') {
      return void safe(res, () => {
        if (!hub) return { ok: false, error: '未找到中枢仓库' }
        return hubTimeline(hub, { limit: 120 })
      })
    }

    if (routePath === '/autopush') {
      if (req.method === 'GET') {
        return void safe(res, () => ({ ok: true, enabled: readAutoPush() }))
      }
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        const r = writeAutoPush(body.value?.enabled === true)
        json(res, 200, r)
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
        if (action === 'plugin-update-check') return void safe(res, () => checkPluginUpdate())
        // v2.4.1：一键更新落地（拉 tag → 备份 → 整套拷入 → 回读校验，失败自动回滚）
        if (action === 'plugin-update-apply') {
          return void safe(res, async () => {
            const tag = String(body.value?.tag ?? '').trim()
            if (!tag) return { ok: false, error: '要更新的版本号（tag）没给，先点「检查更新」。' }
            const r = await applyPluginUpdate({ tag })
            if (!r.ok) return { ok: false, error: r.error, rolledBack: r.rolledBack }
            return { ok: true, version: r.version, backup: r.backup, from: r.from }
          })
        }
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
        return void safe(res, () => {
          const hubList = hub ? listSessionBackups(hub) : { machines: [] }
          // v2.2 S3：顺手算出"对方有、本机没有"的工作区（未分组根因）
          const missingWs = hub
            ? findMissingWorkspaces(hub, hubList, readSavedMachineId())
            : { ok: true, missing: [], checked: 0, exists: 0 }
          return {
            ok: true,
            local: sessionsInfo(),
            hub: hubList,
            missing: missingWs.missing,
            missingChecked: missingWs.checked,
          }
        })
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
        // v2.2 S4：批量创建缺失的工作区空目录（只建空目录，不写文件）
        if (action === 'create-missing-dirs') {
          return void safe(res, () => {
            const paths = Array.isArray(body.value?.paths) ? body.value.paths : []
            if (paths.length === 0) return { ok: false, error: '没有要创建的路径' }
            if (paths.length > 50) return { ok: false, error: '一次最多创建 50 个目录' }
            const r = createWorkspaceDirs(paths)
            return {
              ok: r.created.length > 0 || r.existed.length > 0,
              created: r.created,
              existed: r.existed,
              failed: r.failed,
              ...(r.failed.length ? { warning: `${r.failed.length} 个目录创建失败，详见 failed` } : {}),
            }
          })
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
          // v2.2 S5：本机角色（存中枢 config/machine-roles.json，两机可见）
          machineId: readSavedMachineId(),
          roles: hub ? readRoles(hub) : { ok: true, roles: {}, updatedAt: null },
        }))
      }
      return void (async () => {
        const body = await readJson(req)
        if (!body.ok) return json(res, 400, { ok: false, error: body.error })
        const action = String(body.value?.action ?? '')
        if (action === 'set-role') {
          // v2.2 S5：切换本机角色（host/follower/both）
          if (!hub) return json(res, 200, { ok: false, error: '未找到中枢仓库' })
          return void safe(res, () => {
            const mid = String(body.value?.machineId ?? '').trim() || readSavedMachineId()
            if (!mid) return { ok: false, error: '本机还没有机器档案（先在维护页创建身份），无法设置角色。' }
            const r = writeRole(hub, mid, String(body.value?.role ?? ''))
            if (!r.ok) return r
            return {
              ok: true,
              role: r.role,
              receipt: `已把本机（${mid}）角色设为 ${r.role}。`,
              note: '角色存中枢 config/machine-roles.json，上传备份后另一台机器可见。',
            }
          })
        }
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
        if (action === 'open-manual') {
          // P2 审计回补：打开中枢使用手册。只 start 一个 md/txt 文件关联程序，
          // 路径来自 hub 拼接（不接受调用方传任意路径）。
          return void safe(res, async () => {
            const base = hub ?? String(body.value?.hub ?? '')
            if (!base) return { ok: false, error: '未找到中枢仓库' }
            const candidates = ['使用手册.md', 'docs/使用手册.md', 'README.md']
            const found = candidates.map((c) => path.join(base, ...c.split('/'))).find((p) => fs.existsSync(p))
            if (!found) return { ok: false, error: '中枢里没有找到使用手册（试过 使用手册.md / docs/ / README.md）' }
            const r = await run('cmd', ['/c', 'start', '', found], { timeoutMs: 15_000 })
            return r.ok ? { ok: true, opened: found } : { ok: false, error: `打开失败：${r.stderr.trim().slice(0, 200)}` }
          })
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
