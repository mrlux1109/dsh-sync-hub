/**
 * lib/hub/snapshot.js —— 本机备份快照（M3 第三个业务模块）。
 *
 * 移植自 tools/backup.ps1（117 行，本次只读参考，未改动原文件）。
 * 备份目录：~/.dsh/backups（与原 ps1 一致，历史备份可直接被本模块列出/恢复）。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单（从 backup.ps1 逐条提取，D16 验收逐条对照）                   │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **备份永不删**：删除只接受"单个明确文件名"，拒收路径分隔符与 '..'，  │
 * │    杜绝通配符 / 目录穿越误删整个 backups 目录。                        │
 * │    （原 ps1：-Delete 名字含 [\/\\] 或 .. 即 invalid backup name）      │
 * │ G2 **恢复前先备份当前态**：覆盖目标前，先把当前文件存成                │
 * │    <name>.bak-<stamp>-pre-restore，保证任何恢复都可再回退一步。        │
 * │ G3 **目标不可推断即拒绝**：备份文件名推不出它该回到哪（既不是          │
 * │    AGENTS.md.bak-* 也不是 package.json.bak-*）→ 明确报错，             │
 * │    绝不猜一个路径写进去。                                             │
 * │ G4 **删除只删叶子文件**：目标必须是普通文件；目录 / 不存在 → 拒绝。    │
 * │ G5 所有文件操作限定在 ~/.dsh/backups 内，绝不碰备份目录之外的路径。    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/snapshot.js
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * 取 DSH_HOME（与 ps1 的解析顺序一致：env → 默认 ~/.dsh）。
 * @returns {string}
 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/**
 * 备份目录。
 * @returns {string}
 */
export function backupDir() {
  return path.join(dshHome(), 'backups')
}

/**
 * 从备份文件名里提取快照序号（yyyyMMdd-HHmmss），用于倒序排列。
 * @param {string} name 文件名。
 * @returns {string} 取不到时返回 '00000000-000000'（排最前，与原 ps1 一致）。
 */
function snapshotNumber(name) {
  const m = name.match(/\.bak-(\d{8}-\d{6})/)
  return m ? m[1] : '00000000-000000'
}

/**
 * 列出所有备份（G1 的数据源；只读）。
 * @returns {{ok:true, dir:string, backups:Array<{name:string,bytes:number,mtime:string}>} | {ok:false, error:string}}
 */
export function listBackups() {
  const dir = backupDir()
  if (!fs.existsSync(dir)) return { ok: true, dir, backups: [] }
  try {
    const backups = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const full = path.join(dir, e.name)
        const st = fs.statSync(full)
        return {
          name: e.name,
          bytes: st.size,
          mtime: st.mtime.toISOString(),
          snapshot: snapshotNumber(e.name),
        }
      })
      .sort((a, b) => (a.snapshot < b.snapshot ? 1 : a.snapshot > b.snapshot ? -1 : 0))
    return { ok: true, dir, backups }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * 立即创建一份快照：AGENTS.md + 每个 profile 的 package.json。
 *
 * @returns {{ok:boolean, created:string[], error?:string}}
 */
export function createBackup() {
  const dir = backupDir()
  const dsh = dshHome()
  const stamp = nowStamp()
  const created = []
  try {
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
  } catch (error) {
    return { ok: false, created, error: String(error?.message ?? error) }
  }
  if (created.length === 0) {
    return { ok: false, created, error: '没有可备份的内容（找不到 AGENTS.md / profile package.json）' }
  }
  return { ok: true, created }
}

/**
 * 推断一个备份文件该恢复到哪个路径（G3：推不出就拒绝）。
 *
 * @param {string} name 备份文件名。
 * @returns {string|null} 目标绝对路径；不可推断返回 null。
 */
function inferTarget(name) {
  const dsh = dshHome()
  if (/^AGENTS\.md\.bak-/.test(name)) return path.join(dsh, 'AGENTS.md')
  const pm = name.match(/^package\.json\.bak-.*-([A-Za-z0-9._-]+)$/)
  if (pm) return path.join(dsh, 'profiles', pm[1], 'package.json')
  return null
}

/**
 * 恢复一个备份。
 *
 * @param {string} name 备份文件名（精确名，不含路径）。
 * @returns {{ok:boolean, restored?:string, target?:string, preRestore?:string, error?:string}}
 */
export function restoreBackup(name) {
  // G1：名字本身就是第一道闸（路径分隔符 / .. / 通配符一律拒）。
  if (!name || /[\/\\]/.test(name) || name.includes('..') || /[*?]/.test(name)) {
    return { ok: false, error: '非法备份名：只接受精确文件名（不含路径 / ".." / 通配符）' }
  }
  const dir = backupDir()
  const src = path.join(dir, name)
  // G4：必须是叶子文件。
  try {
    if (!fs.statSync(src).isFile()) {
      return { ok: false, error: `备份不存在或不是文件：${name}` }
    }
  } catch {
    return { ok: false, error: `备份不存在：${name}` }
  }
  // G3：目标不可推断即拒绝。
  const target = inferTarget(name)
  if (!target) {
    return { ok: false, error: '无法从文件名推断恢复目标，请人工处理' }
  }
  try {
    // G2：覆盖前先把当前态再备一份。
    let preRestore = null
    if (fs.existsSync(target)) {
      const base = path.basename(target)
      preRestore = path.join(dir, `${base}.bak-${nowStamp()}-pre-restore`)
      fs.copyFileSync(target, preRestore)
      preRestore = path.basename(preRestore)
    }
    fs.copyFileSync(src, target)
    return { ok: true, restored: name, target, preRestore }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * 删除单个备份（G1：硬闸在这里再过一遍）。
 *
 * @param {string} name 备份文件名。
 * @returns {{ok:boolean, deleted?:string, error?:string}}
 */
export function deleteBackup(name) {
  if (!name || /[\/\\]/.test(name) || name.includes('..') || /[*?]/.test(name)) {
    return { ok: false, error: '非法备份名：只接受精确文件名（不含路径 / ".." / 通配符）' }
  }
  const dir = backupDir()
  if (!fs.existsSync(dir)) return { ok: false, error: '备份目录不存在' }
  const target = path.join(dir, name)
  try {
    const st = fs.lstatSync(target)
    if (!st.isFile()) return { ok: false, error: `目标不是普通文件：${name}` }
    fs.unlinkSync(target)
    return { ok: true, deleted: name }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, error: `备份不存在：${name}` }
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * 当前时间戳（备份文件名用，与原 ps1 的 yyyyMMdd-HHmmss 一致）。
 * @returns {string}
 */
function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
