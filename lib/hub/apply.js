/**
 * lib/hub/apply.js —— 把中枢应用到本机（M3 第四个业务模块，风险最高）。
 *
 * 移植自 tools/apply.ps1（727 行，本次只读参考，未改动原文件）。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单（apply.ps1 的身份三重校验 + 写入纪律，D16 逐条对照）           │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **指纹校验**：目标机器档案 memory/machines/<id>.md 里记录的          │
 * │    "Windows 计算机名"必须等于本机 $COMPUTERNAME，不符 → 拒绝执行        │
 * │    （-Force 只放行一次）。原 ps1：throw fingerprint mismatch。           │
 * │ G2 **换身份必须手输 YES**：已保存的机器 id 与新 id 不同 → 本模块        │
 * │    **不提供任何程序化确认通道**，返回 needConfirm:'YES' 让上层弹交互；   │
 * │    上层必须拿到字面量 "YES" 才继续（对应 Read-Host）。                   │
 * │    HTTP 路由里同样只透传，绝不代为确认。                               │
 * │ G3 **审计日志**：每次判定（FIRST SET / SWITCH / REFUSED / FORCED）都    │
 * │    追加到 DSH_HOME/logs/identity-changes.log，格式                      │
 * │    '时间 | 机器名 | 动作 | 详情'。                                      │
 * │ G4 **技能只增不删不覆盖**：合并中枢技能时，本地已有同名但内容不同的      │
 * │    技能**原样保留并报告差异**，绝不覆盖、绝不删除。                      │
 * │ G5 **写前必备**：改 AGENTS.md / profile package.json 前，先把当前内容   │
 * │    存进 DSH_HOME/backups（走 snapshot.createBackup 同款命名）。          │
 * │ G6 **绝不猜路径**：机器档案不存在 → 拒绝，不静默选一个 id。              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/apply.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { dshHome } from './snapshot.js'
import { copyTree } from '../exec.js'

/**
 * 从机器档案里读"Windows 计算机名"指纹。
 *
 * 档案格式（memory/shared.md 第 6 节）：
 *   - Windows 计算机名：`DESKTOP-XXXXXXX`
 *
 * @param {string} hub 中枢路径。
 * @param {string} id 机器 id（如 home / shop）。
 * @returns {string|null} 取不到返回 null。
 */
export function readFingerprint(hub, id) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null
  const file = path.join(hub, 'memory', 'machines', `${id}.md`)
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return null }
  const m = text.match(/Windows\s*计算机名[:：]\s*`?([A-Za-z0-9._-]+)`?/i)
  return m ? m[1] : null
}

/**
 * 列出中枢里可用的机器档案 id（G6 的数据源）。
 * @param {string} hub 中枢路径。
 * @returns {string[]}
 */
export function listMachines(hub) {
  const dir = path.join(hub, 'memory', 'machines')
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name.slice(0, -3))
      .sort()
  } catch {
    return []
  }
}

/**
 * 读本机已保存的机器 id 标记。
 * @returns {string} 没有标记返回 ''。
 */
export function savedMachineId() {
  try {
    return fs.readFileSync(path.join(dshHome(), '.sync-hub-machine'), 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * G3 审计日志：追加一行到 DSH_HOME/logs/identity-changes.log。
 *
 * @param {string} action 动作（FIRST SET / SWITCH / REFUSED / REFUSED_SWITCH / FORCED）。
 * @param {string} detail 详情。
 * @returns {{ok:boolean, file:string, error?:string}}
 */
export function auditIdentity(action, detail) {
  const dir = path.join(dshHome(), 'logs')
  const file = path.join(dir, 'identity-changes.log')
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const line = `${stamp} | ${process.env.COMPUTERNAME ?? 'unknown'} | ${action} | ${detail}\n`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(file, line, 'utf8')
    return { ok: true, file }
  } catch (error) {
    return { ok: false, file, error: String(error?.message ?? error) }
  }
}

/**
 * 身份守卫三连：指纹 → 换身份 YES → 审计。
 *
 * **本函数不做任何交互**：需要人工确认时返回 needConfirm，由上层（控制台窗口 /
 * 设置页交互）拿到 "YES" 后带 confirm 重跑。这是 D20 的落地：高危确认不走 HTTP。
 *
 * @param {string} hub 中枢路径。
 * @param {string} machineId 目标机器 id。
 * @param {object} [options]
 * @param {boolean} [options.dryRun] 只判定不写。
 * @param {boolean} [options.force] 指纹不符时强制放行一次（记 FORCED）。
 * @param {string} [options.confirm] 上层回传的确认字面量；换身份必须 === 'YES'。
 * @returns {{ok:true, action:string} | {ok:false, needConfirm?:'YES', reason:string, action?:string}}
 */
export function identityGuard(hub, machineId, options = {}) {
  const { dryRun = false, force = false, confirm } = options

  // G6：档案必须存在。
  if (!readFingerprint(hub, machineId)) {
    if (!listMachines(hub).includes(machineId)) {
      return { ok: false, reason: `机器档案不存在：memory/machines/${machineId}.md（可用：${listMachines(hub).join(', ') || '无'}）` }
    }
    return { ok: false, reason: `档案里读不到 Windows 计算机名指纹：memory/machines/${machineId}.md` }
  }

  const prev = savedMachineId()

  // G1：指纹校验。不符时 -Force 只放行一次（记 FORCED），
  // ⚠️ 绝不提前 return：原 ps1 此处只 Write-Warn 后继续向下执行，
  //    G2 的换身份确认必须照样生效（否则 force 会变成无声换身份的缺口）。
  const fp = readFingerprint(hub, machineId)
  const actual = process.env.COMPUTERNAME ?? ''
  let forced = false
  if (fp && fp.toLowerCase() !== actual.toLowerCase()) {
    if (!force) {
      if (!dryRun) auditIdentity('REFUSED', `machine=${machineId} fp=${fp} actual=${actual}`)
      return {
        ok: false,
        action: 'REFUSED',
        reason: `指纹不符：档案 ${machineId} 记录的计算机名是 ${fp}，本机是 ${actual}。改了计算机名就更新档案那行；真是另一台机器就传属于本机的 id。`,
      }
    }
    forced = true
    auditIdentity('FORCED', `machine=${machineId} fp=${fp} actual=${actual}`)
  }

  // G2：换身份必须手输 YES（本模块不交互，只透传需求）。
  if (prev && prev !== machineId) {
    if (confirm !== 'YES') {
      if (!dryRun) auditIdentity('REFUSED_SWITCH', `${prev} -> ${machineId} answer=${confirm ?? '(none)'}`)
      return {
        ok: false,
        needConfirm: 'YES',
        action: 'REFUSED_SWITCH',
        reason: `身份切换：${prev} → ${machineId}（本机记忆将按 ${machineId} 重建）。请让使用者在界面上手输 YES 确认。`,
      }
    }
    auditIdentity('SWITCH', `${prev} -> ${machineId} answer=YES forced=${forced}`)
    return { ok: true, action: 'SWITCH', switched: true, forced }
  }

  if (!prev && !dryRun) auditIdentity('FIRST SET', `machine=${machineId}`)
  return { ok: true, action: prev ? 'REAPPLY' : 'FIRST SET', forced }
}

/**
 * 写机器 id 标记（身份守卫通过后才由调用方调）。
 * @param {string} machineId 机器 id。
 * @returns {{ok:boolean, error?:string}}
 */
export function saveMachineId(machineId) {
  try {
    fs.writeFileSync(path.join(dshHome(), '.sync-hub-machine'), machineId, 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * G5：写前备份（AGENTS.md + 各 profile package.json）。
 * @returns {{ok:boolean, created:string[], error?:string}}
 */
function backupBeforeWrite() {
  const dir = path.join(dshHome(), 'backups')
  const dsh = dshHome()
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const created = []
  fs.mkdirSync(dir, { recursive: true })
  const agents = path.join(dsh, 'AGENTS.md')
  if (fs.existsSync(agents)) {
    const dst = path.join(dir, `AGENTS.md.bak-${stamp}`)
    fs.copyFileSync(agents, dst)
    created.push(path.basename(dst))
  }
  const profiles = path.join(dsh, 'profiles')
  if (fs.existsSync(profiles)) {
    for (const p of fs.readdirSync(profiles, { withFileTypes: true })) {
      if (!p.isDirectory()) continue
      const pj = path.join(profiles, p.name, 'package.json')
      if (fs.existsSync(pj)) {
        const dst = path.join(dir, `package.json.bak-${stamp}-${p.name}`)
        fs.copyFileSync(pj, dst)
        created.push(path.basename(dst))
      }
    }
  }
  return { ok: true, created }
}

/**
 * 拼接 AGENTS.md = memory/shared.md + memory/machines/<id>.md（原 ps1 步骤 2）。
 *
 * @param {string} hub 中枢路径。
 * @param {string} machineId 机器 id。
 * @returns {{ok:boolean, bytes?:number, error?:string}}
 */
export function buildAgentsFile(hub, machineId) {
  const shared = path.join(hub, 'memory', 'shared.md')
  const machine = path.join(hub, 'memory', 'machines', `${machineId}.md`)
  let text = ''
  for (const f of [shared, machine]) {
    try { text += fs.readFileSync(f, 'utf8') } catch { /* 缺一段就跳过，与 ps1 的容错一致 */ }
  }
  if (text.trim() === '') return { ok: false, error: 'shared.md 与机器档案都读不到，拒绝写空 AGENTS.md' }
  try {
    backupBeforeWrite()
    fs.writeFileSync(path.join(dshHome(), 'AGENTS.md'), text, 'utf8')
    return { ok: true, bytes: Buffer.byteLength(text, 'utf8') }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * G4：把中枢技能合并进本机 —— **只增不删不覆盖**。
 *
 * @param {string} hub 中枢路径。
 * @param {{skillWhitelist?:string[], force?:boolean, dryRun?:boolean}} [options]
 * @returns {{ok:boolean, added:string[], differing:string[], skipped:string[], error?:string}}
 */
export function mergeSkills(hub, options = {}) {
  const { skillWhitelist, force = false, dryRun = false } = options
  const srcRoot = path.join(hub, 'skills')
  const dstRoot = path.join(dshHome(), 'skills')
  const result = { ok: true, added: [], differing: [], skipped: [] }
  let entries
  try { entries = fs.readdirSync(srcRoot, { withFileTypes: true }) } catch {
    return { ...result, ok: false, error: '中枢 skills 目录不存在' }
  }
  const allow = skillWhitelist?.length ? new Set(skillWhitelist) : null
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (allow && !allow.has(e.name)) { result.skipped.push(e.name); continue }
    const src = path.join(srcRoot, e.name)
    const dst = path.join(dstRoot, e.name)
    const srcSkill = path.join(src, 'SKILL.md')
    const dstSkill = path.join(dst, 'SKILL.md')
    if (!fs.existsSync(dstSkill) && !fs.existsSync(path.join(dst, 'SKILL.md.disabled'))) {
      // 不存在 → 新增（原 ps1 的 ADD MISSING ONLY）
      if (!dryRun) {
        try { copyTree(src, dst) } catch (error) { result.ok = false; result.error = String(error?.message ?? error); continue }
      }
      result.added.push(e.name)
    } else {
      // 已存在 → 比内容；不同就报告，绝不覆盖（G4）
      const same = sameSkillMd(srcSkill, dstSkill)
      if (!same) result.differing.push(e.name)
    }
  }
  return result
}

/**
 * 比较两份 SKILL.md 内容是否一致。
 * @param {string} a 路径 A。
 * @param {string} b 路径 B。
 * @returns {boolean} 任一不存在视为"不同"。
 */
function sameSkillMd(a, b) {
  try {
    return fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8')
  } catch {
    return false
  }
}
