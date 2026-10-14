/**
 * lib/hub/schedule.js —— 定时同步（Windows 任务计划程序，M3b 第三个模块）。
 *
 * 移植自 tools/schedule.ps1（102 行，本次只读参考，未改动原文件）。
 * 与原 ps1 的差异：不用 ScheduledTask cmdlet（那是 PowerShell 模块），
 * 改直调 schtasks.exe —— 执行层铁律"只 spawn git 与系统程序"的同款做法。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单                                                              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **任务名硬校验**：只允许本插件自己的任务名（默认 SyncHub-Daily），   │
 * │    拒绝含空格/路径/引号的名字，绝不碰用户其他任务。                     │
 * │ G2 **删除前先查存在**：不存在时返回"未安装"，不误报成功。               │
 * │ G3 **安装幂等**：重装前先删同名任务（与原 ps1 一致）。                  │
 * │ G4 **最小权限**：任务以当前用户 Interactive + Limited 运行，            │
 * │    不要 Highest（原 ps1 的 RunLevel Limited）。                        │
 * │ G5 **命令参数数组化**：schtasks 的参数逐个传，不拼命令行字符串，        │
 * │    避免引号/转义把任意代码带进计划任务。                               │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/schedule.js
 */

import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { run } from '../exec.js'
import { dshHome } from './snapshot.js'

/** 本插件唯一的任务名（G1）。 */
export const TASK_NAME = 'SyncHub-Daily'

/**
 * G1：任务名合法性。
 * @param {string} name 任务名。
 * @returns {boolean}
 */
function validTaskName(name) {
  return typeof name === 'string'
    && /^[A-Za-z0-9._-]{1,64}$/.test(name)
}

/**
 * 本机日志目录（~/.dsh/logs）。
 * @returns {string}
 */
export function logDir() {
  return path.join(dshHome(), 'logs')
}

/**
 * 当日日志文件路径（与原 ps1 的 schedule-yyyyMMdd.log 一致）。
 * @returns {string}
 */
export function logFile() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return path.join(logDir(), `schedule-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.log`)
}

/**
 * 查询定时任务状态（G2）。
 *
 * @param {{taskName?:string}} [options]
 * @returns {Promise<{ok:boolean, installed:boolean, state?:string, nextRun?:string, error?:string}>}
 */
export async function scheduleStatus(options = {}) {
  const name = options.taskName ?? TASK_NAME
  if (!validTaskName(name)) return { ok: false, installed: false, error: `非法任务名：${name}` }

  // schtasks /Query /TN <name> /FO LIST —— 退出码 0 = 存在。
  const q = await run('schtasks', ['/Query', '/TN', name, '/FO', 'LIST'], { timeoutMs: 15_000 })
  if (!q.ok) {
    // 不存在时 schtasks 报 "ERROR: The system cannot find the file specified."
    if (/cannot find|does not exist|找不到/i.test(`${q.stdout}\n${q.stderr}`)) {
      return { ok: true, installed: false }
    }
    return { ok: false, installed: false, error: `${q.stdout}\n${q.stderr}`.trim().slice(0, 300) }
  }
  const text = `${q.stdout}\n${q.stderr}`
  const state = text.match(/^\s*Status:\s*(.+)$/m)?.[1]?.trim()
  const next = text.match(/^\s*Next Run Time:\s*(.+)$/m)?.[1]?.trim()
  return { ok: true, installed: true, state, nextRun: next }
}

/**
 * 安装定时任务（G3 幂等 / G4 最小权限 / G5 参数数组化）。
 *
 * 触发：登录时 + 每天 03:00；动作：跑中枢 sync.cmd -Quiet，输出进当日日志。
 *
 * @param {string} hub 中枢路径。
 * @param {{taskName?:string}} [options]
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function scheduleInstall(hub, options = {}) {
  const name = options.taskName ?? TASK_NAME
  if (!validTaskName(name)) return { ok: false, error: `非法任务名：${name}` }

  const syncCmd = path.join(hub, 'sync.cmd')
  if (!fs.existsSync(syncCmd)) {
    return { ok: false, error: `中枢里找不到 sync.cmd：${syncCmd}` }
  }
  fs.mkdirSync(logDir(), { recursive: true })
  const log = logFile()

  // G3：先删同名任务，保证重装幂等。
  const existing = await scheduleStatus({ taskName: name })
  if (existing.installed) {
    await run('schtasks', ['/Delete', '/TN', name, '/F'], { timeoutMs: 15_000 })
  }

  // G5：动作命令整体作为**单个** -Argument 传给 schtasks（schtasks 的 /TR 就是
  // 一个字符串参数），但内部不插值任何用户输入：路径来自本插件解析的中枢路径，
  // 且用双引号包裹防空格。
  const inner = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& '{syncCmd}' -Quiet *> '{log}'"`
  const r = await run('schtasks', [
    '/Create', '/TN', name,
    '/TR', inner,
    '/SC', 'ONLOGON',
    '/RL', 'LIMITED',
    '/F',
  ], { timeoutMs: 30_000 })

  if (!r.ok) {
    return { ok: false, error: `${r.stdout}\n${r.stderr}`.trim().slice(0, 400) }
  }

  // 再建一个每日 03:00 的触发器（ONLOGON 与 DAILY 不能同一条 /Create，
  // 用两条任务会难管理，所以改为一条 ONLOGON + 一条 DAILY 同名前缀区分）。
  const dailyName = `${name}-0300`
  const innerDaily = inner
  const r2 = await run('schtasks', [
    '/Create', '/TN', dailyName,
    '/TR', innerDaily,
    '/SC', 'DAILY', '/ST', '03:00',
    '/RL', 'LIMITED',
    '/F',
  ], { timeoutMs: 30_000 })
  if (!r2.ok) {
    // 每日触发器建失败不算致命（登录触发器已建），如实报告。
    return { ok: true, partial: true, error: `ONLOGON 触发器已建，但每日 03:00 触发器失败：${`${r2.stdout}\n${r2.stderr}`.trim().slice(0, 200)}` }
  }
  return { ok: true, tasks: [name, dailyName], log }
}

/**
 * 卸载定时任务（G2：不存在时如实报告，不误报成功）。
 *
 * @param {{taskName?:string}} [options]
 * @returns {Promise<{ok:boolean, removed:string[], error?:string}>}
 */
export async function scheduleRemove(options = {}) {
  const name = options.taskName ?? TASK_NAME
  if (!validTaskName(name)) return { ok: false, removed: [], error: `非法任务名：${name}` }
  const removed = []
  const errors = []
  for (const tn of [name, `${name}-0300`]) {
    const st = await scheduleStatus({ taskName: tn })
    if (!st.installed) continue
    const r = await run('schtasks', ['/Delete', '/TN', tn, '/F'], { timeoutMs: 15_000 })
    if (r.ok) removed.push(tn)
    else errors.push(`${tn}: ${`${r.stdout}\n${r.stderr}`.trim().slice(0, 150)}`)
  }
  return {
    ok: errors.length === 0,
    removed,
    ...(errors.length ? { error: errors.join('；') } : {}),
  }
}
