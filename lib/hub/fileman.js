/**
 * lib/hub/fileman.js —— 内容页文件管理（v2.5 批2：查看 → 可管）。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 设计前提（老大 2026-10-17 拍板的语义，写进 UI 常驻说明）              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ 这里管的是【中枢仓库】与【本机加载目录】两个地方，删除动作必须分清：  │
 * │   删中枢 ≠ 卸本机。拉取（apply）永远只增不删，两台已装副本不受影响。  │
 * │   删本机（~/.dsh/skills）只影响这台机器的加载，中枢与对方都不知道。   │
 * │ 因此所有删除一律【先移进 backups/ 留底，绝不 rm】——完全可逆。        │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 守卫（这是全插件唯一能"删东西"的 API，标准从严）：
 *   F1 根白名单：只认下表 6 个根，其他一律拒。路径参数只允许相对片段。
 *   F2 路径消毒：拒绝 .. / 绝对路径 / 盘符 / UNC；归一后必须仍在根内。
 *   F3 凭据硬墙：FORBIDDEN 名单（.credentials.yaml 等）在任何层出现即拒。
 *   F4 删除=移动：移进 <hub>/backups/fileman-<时间戳>/，返回留底路径可反悔。
 *   F5 读有限：单文件 >512KB 拒读（防把巨型会话文件塞进面板）。
 *   F6 写限文本：只允许 .md/.txt/.json/.yml 等文本扩展名，拒写二进制。
 *
 * @module lib/hub/fileman
 */

import fs from 'node:fs'
import path from 'node:path'
import { dshHome } from './snapshot.js'
import { FORBIDDEN } from './sessions.js'

/**
 * 根白名单：rootKey → (hub) => 绝对目录 + 一句话说明（给 UI/回执用）。
 * hub/ 前缀的根随上传传播；local/ 前缀只影响本机。
 */
export const FILE_ROOTS = {
  'hub/memory': { label: '中枢记忆', dir: (hub) => path.join(hub, 'memory') },
  'hub/skills': { label: '中枢技能', dir: (hub) => path.join(hub, 'skills') },
  'hub/config': { label: '中枢配置', dir: (hub) => path.join(hub, 'config') },
  'hub/plugins': { label: '中枢插件源码', dir: (hub) => path.join(hub, 'plugins') },
  'hub/session-backup': { label: '中枢会话归档', dir: (hub) => path.join(hub, 'session-backup') },
  'local/skills': { label: '本机技能（DSH 加载处）', dir: () => path.join(dshHome(), 'skills') },
}

/** F6：允许读写的文本扩展名。 */
const TEXT_EXT = /\.(md|txt|json|yml|yaml|csv|ini|ps1|js|cjs|mjs|bat|cmd)$/i

/** F5：单文件读取上限（字节）。 */
const MAX_READ = 512 * 1024

/**
 * F1+F2+F3：把 (rootKey, relPath) 解析成安全的绝对路径。
 * @returns {{ok:true, abs:string, rootKey:string} | {ok:false, error:string}}
 */
export function resolveSafe(hub, rootKey, relPath) {
  const root = FILE_ROOTS[String(rootKey ?? '')]
  if (!root) return { ok: false, error: `不在白名单的根：${rootKey}（合法：${Object.keys(FILE_ROOTS).join(' / ')}）` }
  const base = path.resolve(root.dir(hub))
  const rel = String(relPath ?? '')
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.startsWith('\\\\')) {
    return { ok: false, error: `路径必须是根内相对路径，收到绝对路径：${rel}` }
  }
  const parts = rel.split(/[/\\]+/).filter(Boolean)
  for (const p of parts) {
    if (p === '..') return { ok: false, error: `路径含 ..，拒绝：${rel}` }
    if (FORBIDDEN.includes(p)) return { ok: false, error: `凭据类文件绝对禁操作：${p}` }
  }
  const abs = path.resolve(base, ...parts)
  // 归一后必须仍在根内（防符号链接外的花样逃逸；symlink 不跟）。
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    return { ok: false, error: `路径逃逸出根目录，拒绝：${rel}` }
  }
  return { ok: true, abs, rootKey: String(rootKey) }
}

/**
 * 列目录（一层，目录优先排序）。
 * @returns {{ok:boolean, entries?:Array<{name:string, dir:boolean, bytes:number, mtime:string}>, error?:string}}
 */
export function listDir(hub, rootKey, relPath) {
  const r = resolveSafe(hub, rootKey, relPath)
  if (!r.ok) return r
  let items
  try { items = fs.readdirSync(r.abs, { withFileTypes: true }) } catch (e) {
    return { ok: false, error: `读不了目录：${String(e?.message ?? e)}` }
  }
  const entries = items
    .filter((e) => !FORBIDDEN.includes(e.name))
    .map((e) => {
      let st = { size: 0, mtimeMs: 0 }
      try { st = fs.statSync(path.join(r.abs, e.name)) } catch { /* 坏条目按 0 报 */ }
      return {
        name: e.name,
        dir: e.isDirectory(),
        bytes: e.isDirectory() ? 0 : st.size,
        mtime: new Date(st.mtimeMs).toISOString().slice(0, 16).replace('T', ' '),
      }
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  return { ok: true, entries }
}

/** 读文本文件（F5 限大小、F6 限扩展名）。 */
export function readText(hub, rootKey, relPath) {
  const r = resolveSafe(hub, rootKey, relPath)
  if (!r.ok) return r
  if (!TEXT_EXT.test(r.abs)) return { ok: false, error: `只允许读文本文件（${TEXT_EXT.source.replace('^\\', '')}…），拒读二进制：${path.basename(r.abs)}` }
  let st
  try { st = fs.statSync(r.abs) } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
  if (st.isDirectory()) return { ok: false, error: '这是目录，用列表动作看' }
  if (st.size > MAX_READ) return { ok: false, error: `文件 ${Math.round(st.size / 1024)}KB 超过读取上限 512KB` }
  try {
    return { ok: true, text: fs.readFileSync(r.abs, 'utf8'), bytes: st.size, mtime: new Date(st.mtimeMs).toISOString().slice(0, 16).replace('T', ' ') }
  } catch (e) {
    return { ok: false, error: `读失败：${String(e?.message ?? e)}` }
  }
}

/** 写文本文件（先留底再覆盖；只许白名单扩展名）。 */
export function saveText(hub, rootKey, relPath, text) {
  const r = resolveSafe(hub, rootKey, relPath)
  if (!r.ok) return r
  if (!TEXT_EXT.test(r.abs)) return { ok: false, error: '只允许写文本文件（md/txt/json/yml…）' }
  if (typeof text !== 'string') return { ok: false, error: 'text 必须是字符串' }
  if (Buffer.byteLength(text, 'utf8') > MAX_READ) return { ok: false, error: '内容超过 512KB，拒写' }
  try {
    let backup = null
    if (fs.existsSync(r.abs)) {
      const st = stashTo(hub, r.abs) // 旧版留底
      if (!st.ok) return { ok: false, error: `旧版留底失败，中止写入（一个字没改）：${st.error}` }
      backup = st.backup
    }
    fs.mkdirSync(path.dirname(r.abs), { recursive: true })
    fs.writeFileSync(r.abs, text, 'utf8')
    return { ok: true, bytes: Buffer.byteLength(text, 'utf8'), backup }
  } catch (e) {
    return { ok: false, error: `写失败：${String(e?.message ?? e)}` }
  }
}

/**
 * F4：删除 = 移进 <hub>/backups/fileman-<ts>/ 留底，绝不 rm。
 * @returns {{ok:boolean, backup?:string, error?:string}}
 */
export function deleteEntry(hub, rootKey, relPath) {
  const r = resolveSafe(hub, rootKey, relPath)
  if (!r.ok) return r
  if (!fs.existsSync(r.abs)) return { ok: false, error: `不存在，无需删：${relPath}` }
  return stashTo(hub, r.abs)
}

/** 把 abs 路径（文件或目录）移进 backups/fileman-<ts>/ 下（跨盘时退回 copy+rm）。 */
function stashTo(hub, abs) {
  const destOf = (ts) => {
    const rel = path.relative(path.resolve(hub), abs)
    // 跨盘（local/skills 与 hub 不同盘）时 relative 返回绝对路径 → 拍平只留 basename。
    const safeRel = rel === '' || path.isAbsolute(rel) ? path.basename(abs) : rel
    return path.join(hub, 'backups', `fileman-${ts}`, safeRel)
  }
  try {
    const dest = destOf(new Date().toISOString().replace(/[:.]/g, '').slice(0, 15))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(abs, dest)
    return { ok: true, backup: dest }
  } catch (e) {
    if (e && (e.code === 'EXDEV' || e.code === 'EPERM')) {
      try {
        const dest = destOf(new Date().toISOString().replace(/[:.]/g, '').slice(0, 15))
        copyTree(abs, dest)
        rmTree(abs)
        return { ok: true, backup: dest }
      } catch (e2) {
        return { ok: false, error: `留底移动失败（未删任何东西）：${String(e2?.message ?? e2)}` }
      }
    }
    return { ok: false, error: `留底移动失败（未删任何东西）：${String(e?.message ?? e)}` }
  }
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name)
    const t = path.join(to, e.name)
    if (e.isDirectory()) copyTree(s, t)
    else fs.copyFileSync(s, t)
  }
}

function rmTree(p) {
  fs.rmSync(p, { recursive: true, force: true })
}
