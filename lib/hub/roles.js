/**
 * lib/hub/roles.js —— 本机角色（v2.2 S5：🏠主机 / 💻副机 / 🔄双向）。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 为什么角色要存在中枢里（而不是本机）                                  │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ 角色只有在两台机器都看得到时才有意义：店机要知道"家机是主机"，才会      │
 * │ 以拉取为主；家机要知道"店机是副机"，才不会担心自己被覆盖。             │
 * │ 所以存 `config/machine-roles.json`，随 git 同步——与既定架构一致       │
 * │ （一切跨机数据走中枢仓库，不另开通道）。                              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 角色语义（写进 UI 的说明，这里保持一致）：
 *   host     🏠 主机 —— 以这台为准：日常只「上传备份」归档；「下载恢复」慎用，
 *                       防止旧内容盖掉新内容（防中枢污染）。
 *   follower 💻 副机 —— 以主机为准：日常「下载恢复」拿最新；本机改动想上传前
 *                       先「预览变化」。
 *   both     🔄 双向 —— 两边对等随用随传；撞车靠冲突解决器人工裁决。
 *
 * 默认 host（方案 S5：默认主机，只归档不恢复，最安全）。
 *
 * @module lib/hub/roles
 */

import fs from 'node:fs'
import path from 'node:path'

/** 合法角色集合。 */
export const ROLES = ['host', 'follower', 'both']

/** 角色默认值（方案 S5：默认主机）。 */
export const DEFAULT_ROLE = 'host'

/** 角色存储路径：config/machine-roles.json（随中枢 git 同步）。 */
function rolesFile(hub) {
  return path.join(hub, 'config', 'machine-roles.json')
}

/**
 * 读角色表。文件不存在 / 损坏 → 返回空表（各机走默认 host），不报错。
 *
 * @param {string} hub 中枢路径。
 * @returns {{ok:boolean, roles:Record<string,string>, updatedAt:string|null}}
 */
export function readRoles(hub) {
  const file = rolesFile(hub)
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const roles = {}
    for (const [k, v] of Object.entries(raw?.roles ?? {})) {
      if (ROLES.includes(v)) roles[String(k)] = v
    }
    return { ok: true, roles, updatedAt: raw?.updatedAt ?? null }
  } catch {
    return { ok: true, roles: {}, updatedAt: null }
  }
}

/**
 * 写一个机器的角色（整体读改写，保留其他机器的条目）。
 *
 * 守卫：
 *   R1 role 必须合法（host/follower/both）
 *   R2 machineId 非空且长度合理（防脏数据进中枢 git）
 *   R3 写入前确保 config/ 目录存在
 *
 * @param {string} hub 中枢路径。
 * @param {string} machineId 机器 id（如 home / shop）。
 * @param {string} role 目标角色。
 * @returns {{ok:boolean, role?:string, roles?:Record<string,string>, error?:string}}
 */
export function writeRole(hub, machineId, role) {
  const id = String(machineId ?? '').trim()
  if (!id || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return { ok: false, error: `机器 id 不合法：${id}` }
  }
  if (!ROLES.includes(role)) {
    return { ok: false, error: `角色不合法：${role}（合法值 ${ROLES.join('/')}）` }
  }
  const prev = readRoles(hub)
  const roles = { ...prev.roles, [id]: role }
  const payload = { roles, updatedAt: new Date().toISOString() }
  try {
    fs.mkdirSync(path.dirname(rolesFile(hub)), { recursive: true })
    fs.writeFileSync(rolesFile(hub), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return { ok: true, role, roles }
  } catch (e) {
    return { ok: false, error: `写入角色失败：${String(e?.message ?? e)}` }
  }
}

/**
 * 推荐角色（方案 S5：按机器档案推荐；默认主机）。
 * 第一版规则从简：中枢里只有本机一份档案 → 推荐主机；否则也推荐主机
 * （方案原文"默认主机"），但把"对方机器存在"作为提示展示给用户。
 *
 * @param {Record<string,string>} roles 现有角色表。
 * @param {string} machineId 本机 id。
 * @returns {{role:string, reason:string}}
 */
export function recommendRole(roles, machineId) {
  const known = Object.keys(roles ?? {})
  const others = known.filter((k) => k !== machineId)
  if (!roles?.[machineId]) {
    if (others.length === 0) {
      return { role: DEFAULT_ROLE, reason: '中枢里还没有其他机器的档案，主机最合适（只归档不恢复，最安全）。' }
    }
    return { role: DEFAULT_ROLE, reason: `中枢已有其他机器（${others.join('、')}）的角色记录；未指定时默认主机。` }
  }
  return { role: roles[machineId], reason: '沿用已保存的角色。' }
}
