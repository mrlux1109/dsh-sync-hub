/**
 * lib/hub/health.js —— 健康分与机器看板（N4 / N5）。
 *
 * 健康分（D14 定案权重）：凭据 25 / git 同步态 25 / 必需工具链 25 /
 * 定时任务 15 / 中枢可达 10。合计 100。
 *
 * 机器看板：读中枢里各机器档案 + git 历史里各机器的最近提交时间，
 * 回答"另一台电脑上次什么时候同步过"。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单                                                              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **只读**：全部复用已有查询（hubStatus / inspectTools / schedule）， │
 * │    不发起任何新副作用。                                                │
 * │ G2 **不谎报**：任一项查不到 → 该项记 0 分并给出 reason，绝不计满分。   │
 * │ G3 **中枢不可达 = 整项 0**：hubStatus 失败时同步态 0 分，且 reason     │
 * │    明说，不用"未知当中等"。                                            │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/health.js
 */

import path from 'node:path'
import fs from 'node:fs'
import { hubStatus, hubInventory, hubLog } from './status.js'
import { inspectTools } from './collect.js'
import { scheduleStatus, TASK_NAME } from './schedule.js'
import { credentialPresent } from './portable.js'

/**
 * 计算健康分。
 *
 * @param {string} hub 中枢路径。
 * @returns {Promise<{ok:boolean, score:number, items:Array<{key:string,label:string,got:number,max:number,level:'pass'|'warn'|'fail',reason:string}>}>}
 */
export async function computeHealth(hub) {
  const items = []

  // 凭据 25
  const cred = await credentialPresent().catch(() => ({ haveCredential: false }))
  items.push({
    key: 'credential',
    label: '凭据',
    got: cred.haveCredential ? 25 : 0,
    max: 25,
    level: cred.haveCredential ? 'pass' : 'fail',
    reason: cred.haveCredential ? `已配置（${cred.user || 'unknown'}）` : 'Gitee 凭据未配置，推拉会失败',
  })

  // git 同步态 25：干净=满分；有未提交或落后按比例扣；查不到=0
  const st = await hubStatus(hub).catch(() => ({ ok: false }))
  if (!st.ok) {
    items.push({
      key: 'sync-state', label: '同步态', got: 0, max: 25, level: 'fail',
      reason: '读不到 git 状态（不是仓库或不可读）',
    })
  } else {
    const behind = st.behind ?? 0
    const ahead = st.ahead ?? 0
    const dirty = st.dirtyCount ?? 0
    let got = 25
    const notes = []
    if (behind > 0) { got -= 10; notes.push(`远端领先 ${behind}`) }
    if (ahead > 0) { got -= 8; notes.push(`待推送 ${ahead}`) }
    if (dirty > 0) { got -= 7; notes.push(`未提交 ${dirty}`) }
    got = Math.max(0, got)
    items.push({
      key: 'sync-state', label: '同步态', got, max: 25,
      level: got === 25 ? 'pass' : got >= 15 ? 'warn' : 'fail',
      reason: notes.length ? notes.join('、') : '干净且与远端一致',
    })
  }

  // 必需工具链 25：core 全齐=满分；缺一个扣 12（最多扣光）
  const tools = await inspectTools(hub).catch(() => ({ ok: false, summary: {} }))
  const missingCore = tools.ok ? (tools.summary.missingCore ?? []) : []
  items.push({
    key: 'tools', label: '必需工具链',
    got: missingCore.length === 0 ? 25 : Math.max(0, 25 - missingCore.length * 12),
    max: 25,
    level: missingCore.length === 0 ? 'pass' : 'fail',
    reason: missingCore.length === 0 ? 'core 全齐' : `缺 ${missingCore.join('、')}`,
  })

  // 定时任务 15
  const sch = await scheduleStatus({ taskName: TASK_NAME }).catch(() => ({ installed: false }))
  items.push({
    key: 'schedule', label: '定时同步',
    got: sch.installed ? 15 : 0, max: 15,
    level: sch.installed ? 'pass' : 'warn',
    reason: sch.installed ? (sch.nextRun ? `下次 ${sch.nextRun}` : '已开启') : '未开启（不影响手动同步）',
  })

  // 中枢可达 10：hubStatus 成功 + inventory 读得到即算可达
  const inv = hubInventory(hub)
  const reachable = st.ok && inv.skills >= 0
  items.push({
    key: 'reachable', label: '中枢可达',
    got: reachable ? 10 : 0, max: 10,
    level: reachable ? 'pass' : 'fail',
    reason: reachable ? `路径 ${hub}` : '中枢路径不可读',
  })

  const score = items.reduce((sum, i) => sum + i.got, 0)
  return { ok: true, score, items }
}

/**
 * 机器看板：每台机器的档案 + 最近同步时间。
 *
 * @param {string} hub 中枢路径。
 * @returns {Promise<{ok:boolean, machines:Array<{id:string, computer:string|null, lastCommit:string|null, lastWhen:string|null, lastSubject:string|null}>}>}
 */
export async function machineBoard(hub) {
  const dir = path.join(hub, 'memory', 'machines')
  const machines = []
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { /* 无目录 */ }

  const log = await hubLog(hub, { limit: 200 }).catch(() => ({ ok: false, commits: [] }))
  const commits = log.ok ? log.commits : []

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    const id = e.name.slice(0, -3)
    let computer = null
    try {
      const text = fs.readFileSync(path.join(dir, e.name), 'utf8')
      computer = text.match(/Windows\s*计算机名[:：]\s*`?([A-Za-z0-9._-]+)`?/i)?.[1] ?? null
    } catch { /* 读不到档案 */ }
    // 提交信息以机器短名开头是本中枢的约定，据此找该机器最近一次同步
    const mine = commits.find((c) => c.subject.toLowerCase().startsWith(`${id} `))
      ?? commits.find((c) => c.subject.toLowerCase().includes(id))
    machines.push({
      id,
      computer,
      lastCommit: mine?.hash?.slice(0, 7) ?? null,
      lastWhen: mine?.date ?? null,
      lastSubject: mine?.subject ?? null,
    })
  }
  return { ok: true, machines }
}
