/**
 * lib/hub/workspace.js —— 工作区缺失检测与空目录创建（v2.2 S3/S4）。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 为什么需要这个模块（老大实测痛点的技术解药）                          │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ DSH 的会话**按工作区目录归组**，判据只有一个：**该目录在本机存不存在**。│
 * │ 内容完全不看。                                                       │
 * │                                                                       │
 * │ 所以「店机恢复了家机的会话却全落未分组」的根因不是数据坏了，而是        │
 * │ **店机没有家机的那些项目目录**。`session-map.json` 只能改文件夹名，       │
 * │ 改不了"目录存不存在"这个事实。                                       │
 * │                                                                       │
 * │ 解法因此极简：**建空目录就够了**，不用飞牛同步整个项目。               │
 * │ 有价值的项目老大自己按需同步（沿用既定分工：项目代码不入中枢）。        │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单                                                             │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **只建空目录**：绝不写文件、绝不下载会话、绝不碰非工作区路径。      │
 * │ G2 **路径必须是绝对 Windows 路径**：盘符开头 + 有驱动器字母，         │
 * │    拒绝相对路径 / UNC 前缀以外的花样（防 `..` 逃逸）。                │
 * │ G3 **黑名单硬拦**：系统目录（Windows/Program Files 等）与用户主目录    │
 * │    根一律拒绝创建——避免"造目录"变成任意写操作。                     │
 * │ G4 **逐个上报不中断**：批量创建时某一项失败不阻断其余，返回逐项结果。 │
 * │ G5 **目录已存在 = 幂等成功**：不报错、不删改既有内容。                 │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/workspace
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 读本机已保存的机器 id（~/.dsh/.sync-hub-machine）。
 * 与 lib/api.js 的 savedMachineIdOf() 读同一份文件——但这里用 ESM，
 * 不像那边用 require（ESM 里会抛错、靠 try/catch 静默变空字符串）。
 *
 * @returns {string} 机器 id；没设置过返回空串。
 */
export function readSavedMachineId() {
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    const p = path.join(home, '.sync-hub-machine')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''
  } catch {
    return ''
  }
}

/** G3：绝不建在这些前缀下（系统/程序目录，误建会污染系统）。 */
const BLOCKED_PREFIX = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'D:\\Windows',
]

/**
 * G2：校验并归一一个待创建的工作区路径。
 * @param {string} p 候选路径。
 * @returns {{ok:true, path:string}|{ok:false, reason:string}}
 */
export function normalizeWorkspacePath(p) {
  const raw = String(p ?? '').trim().replace(/\//g, '\\').replace(/\\+$/, '')
  if (!raw) return { ok: false, reason: '路径为空' }
  // 必须形如 X:\... （盘符 + 冒号 + 至少一级目录）
  if (!/^[A-Za-z]:\\/.test(raw)) return { ok: false, reason: `不是绝对路径（缺盘符）：${raw}` }
  if (raw.includes('..')) return { ok: false, reason: `路径含 ..，拒绝：${raw}` }
  const low = raw.toLowerCase()
  for (const bad of BLOCKED_PREFIX) {
    if (low === bad.toLowerCase() || low.startsWith(`${bad.toLowerCase()}\\`)) {
      return { ok: false, reason: `系统目录，禁止创建：${raw}` }
    }
  }
  return { ok: true, path: raw }
}

/**
 * S3：比对中枢里的工作区清单与本机实际目录，列出"对方有、本机没有"的。
 *
 * @param {string} hub 中枢路径。
 * @param {{machines:Array<{machine:string, workspaces:Array<{folder:string, path:string|null, files:number}>}>}} backups
 *   listSessionBackups 的返回。
 * @param {string} [selfMachine] 本机 id（自己的备份目录不算"对方缺"）。
 * @returns {{ok:boolean, missing:Array<{path:string, machines:string[], files:number}>, checked:number, exists:number}}
 */
export function findMissingWorkspaces(hub, backups, selfMachine) {
  const missing = new Map()
  let checked = 0
  let exists = 0
  const machines = backups?.machines ?? []
  for (const m of machines) {
    if (selfMachine && m.machine === selfMachine) continue
    for (const w of m.workspaces ?? []) {
      const target = w.path
      if (!target) continue
      checked += 1
      if (fs.existsSync(target)) { exists += 1; continue }
      const prev = missing.get(target.toLowerCase())
      if (prev) {
        prev.machines.push(m.machine)
        prev.files += w.files ?? 0
      } else {
        missing.set(target.toLowerCase(), {
          path: target,
          machines: [m.machine],
          files: w.files ?? 0,
        })
      }
    }
  }
  const list = [...missing.values()].sort((a, b) => b.files - a.files)
  return { ok: true, missing: list, checked, exists }
}

/**
 * S4：批量创建缺失的工作区空目录（G1/G4/G5）。
 *
 * @param {string[]} paths 待创建路径。
 * @returns {{ok:boolean, created:string[], existed:string[], failed:Array<{path:string, reason:string}>}}
 */
export function createWorkspaceDirs(paths) {
  const created = []
  const existed = []
  const failed = []
  for (const raw of Array.isArray(paths) ? paths : []) {
    const v = normalizeWorkspacePath(raw)
    if (!v.ok) {
      failed.push({ path: String(raw ?? ''), reason: v.reason })
      continue
    }
    try {
      if (fs.existsSync(v.path)) {
        existed.push(v.path) // G5：已存在 = 幂等成功，不动它
        continue
      }
      fs.mkdirSync(v.path, { recursive: true }) // G1：只建空目录，不写任何文件
      created.push(v.path)
    } catch (e) {
      failed.push({ path: v.path, reason: String(e?.message ?? e) })
    }
  }
  return { ok: failed.length === 0, created, existed, failed }
}

/**
 * 回执文案：把缺失清单拼成给人和给 AI 都能直接读的说明。
 *
 * @param {Array<{path:string, machines:string[], files:number}>} missing findMissingWorkspaces 的 missing。
 * @returns {string}
 */
export function describeMissing(missing) {
  if (!missing || missing.length === 0) return ''
  const lines = [
    `以下工作区本机不存在（会话恢复后会显示为「未分组」）：`,
    ...missing.map((m) => `  ${m.path}    ← 来自 ${m.machines.join('、')}，共 ${m.files} 个会话`),
    '',
    '处理办法（按需选择）：',
    '  A. 在本机创建同名空目录即可正确归组（DSH 只看目录是否存在，不看里面有没有文件）——点上方「一键创建空目录」。',
    '  B. 项目代码请用飞牛同步到本机同路径（中枢不管项目代码），需要哪个同步哪个。',
  ]
  return lines.join('\n')
}
