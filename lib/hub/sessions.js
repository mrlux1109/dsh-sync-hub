/**
 * lib/hub/sessions.js —— 会话备份 / 恢复 / 浏览（M3b 第一个模块）。
 *
 * 移植自 tools/backup-sessions.ps1（259 行，本次只读参考，未改动原文件）。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单（凭据排除是红线，D16 逐条对照，负例单测必须覆盖）              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **违禁文件双向拦截**：备份前扫源树、恢复前扫备份树，只要出现         │
 * │    .credentials.yaml 或 .anonymous-user-id **立即中止**（不复制、      │
 * │    不恢复、不部分完成）。这是全插件最高优先级守卫。                    │
 * │ G2 **恢复永不覆盖**：目标已存在的会话文件一律跳过（本机历史优先），      │
 * │    计数报告 skipped，绝不 Test-Path 后强行覆盖。                       │
 * │ G3 **只读源**：备份是 copy，绝不移动/删除 ~/.dsh/sessions 下任何文件。  │
 * │ G4 **路径映射只改文件夹名**：把来源机器的 workspace 编码目录名折叠成      │
 * │    本机布局（config/session-map.json），文件内容零改动。                │
 * │ G5 **回读校验**：备份后重数目标目录文件数，少于复制数即报失败。          │
 * │ G6 **git 策略默认排除**：session-backup/ 默认进 .gitignore（隐私优先），  │
 * │    只有显式 opt-in 才移除。                                           │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/sessions.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { dshHome } from './snapshot.js'
import { savedMachineId } from './apply.js'

/** 硬编码拒绝名单（G1）：绝不拷贝、绝不恢复。 */
export const FORBIDDEN = ['.credentials.yaml', '.anonymous-user-id']

/** 本机会话目录。 */
export function sessionsDir() {
  return path.join(dshHome(), 'sessions')
}

/** 中枢里本机的会话备份目录。 */
export function sessionBackupDir(hub) {
  return path.join(hub, 'session-backup', savedMachineId() || 'unknown')
}

/**
 * G1：递归扫描目录树，找违禁文件。
 *
 * @param {string} root 要扫描的目录。
 * @returns {string[]} 命中文件的相对路径；空数组表示干净。
 */
export function scanForbidden(root) {
  const hits = []
  const walk = (dir, rel) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        // 目录名本身是违禁名也要拦（防整目录搬运）。
        if (FORBIDDEN.includes(e.name)) { hits.push(`${r}/`); continue }
        walk(path.join(dir, e.name), r)
      } else if (FORBIDDEN.includes(e.name)) {
        hits.push(r)
      }
    }
  }
  walk(root, '')
  return hits
}

/**
 * 会话目录概况（列表页用）。
 * @returns {{ok:boolean, files:number, bytes:number, dir:string}}
 */
export function sessionsInfo() {
  const dir = sessionsDir()
  if (!fs.existsSync(dir)) return { ok: true, files: 0, bytes: 0, dir }
  let files = 0
  let bytes = 0
  const walk = (d) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { files += 1; try { bytes += fs.statSync(p).size } catch { /* 跳过 */ } }
    }
  }
  walk(dir)
  return { ok: true, files, bytes, dir }
}

/**
 * 备份会话到中枢（G1/G3/G5）。
 *
 * @param {string} hub 中枢路径。
 * @param {{days?:number, workspaces?:string[], signal?:AbortSignal}} [options]
 *   days > 0 时只备份最近 N 天修改过的；workspaces 非空时只备份这些工作区（编码目录名，小写比较）。
 * @returns {{ok:boolean, copied?:number, skipped?:number, forbidden?:string[], error?:string}}
 */
export function backupSessions(hub, options = {}) {
  const src = sessionsDir()
  if (!fs.existsSync(src)) {
    return { ok: false, error: `本机会话目录不存在：${src}` }
  }
  // G1 前置：源树有违禁文件 → 中止，一个都不复制。
  const srcHits = scanForbidden(src)
  if (srcHits.length > 0) {
    return {
      ok: false,
      stage: 'forbidden-source',
      forbidden: srcHits,
      error: `会话目录内发现违禁文件（${srcHits.join(', ')}），已中止备份。这些文件绝不外传。`,
    }
  }

  const dst = sessionBackupDir(hub)
  const cut = options.days && options.days > 0 ? Date.now() - options.days * 86400_000 : null
  const filter = options.workspaces?.length
    ? new Set(options.workspaces.map((s) => s.toLowerCase()))
    : null

  let copied = 0
  let skipped = 0
  const walk = (dir, rel) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const from = path.join(dir, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        // 工作区过滤只看顶层目录名。
        if (filter && rel === '' && !filter.has(e.name.toLowerCase())) {
          skipped += countFiles(from)
          continue
        }
        walk(from, r)
      } else {
        if (cut) {
          try { if (fs.statSync(from).mtimeMs < cut) { skipped += 1; continue } } catch { /* 读不到时间就备份 */ }
        }
        const to = path.join(dst, r.split('/').join(path.sep))
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.copyFileSync(from, to)
        copied += 1
      }
    }
  }
  try {
    walk(src, '')
  } catch (error) {
    return { ok: false, stage: 'copy', copied, error: String(error?.message ?? error) }
  }

  // G5：回读校验。
  const verify = countFiles(dst)
  if (verify < copied) {
    return { ok: false, stage: 'verify', copied, verified: verify, error: '回读校验失败：目标文件数少于复制数' }
  }
  return { ok: true, copied, skipped, verified: verify }
}

/**
 * 从中枢恢复会话到本机（G1/G2/G4）。
 *
 * @param {string} hub 中枢路径。
 * @param {{from?:string, noMap?:boolean, workspaces?:string[]}} [options]
 * @returns {{ok:boolean, restored?:number, same?:number, mapped?:number, forbidden?:string[], error?:string}}
 */
export function restoreSessions(hub, options = {}) {
  const backupRoot = path.join(hub, 'session-backup')
  let dirs = []
  if (options.from) {
    dirs = [path.join(backupRoot, options.from)]
  } else {
    try {
      dirs = fs.readdirSync(backupRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(backupRoot, e.name))
    } catch {
      return { ok: false, error: `中枢没有会话备份目录：${backupRoot}` }
    }
  }
  dirs = dirs.filter((d) => fs.existsSync(d))
  if (dirs.length === 0) {
    return { ok: false, error: options.from ? `没有机器 ${options.from} 的会话备份` : '中枢没有任何机器的会话备份' }
  }

  // G1 前置：备份树有违禁文件 → 中止，一个都不恢复。
  for (const d of dirs) {
    const hits = scanForbidden(d)
    if (hits.length > 0) {
      return {
        ok: false,
        stage: 'forbidden-backup',
        forbidden: hits,
        error: `备份内含违禁文件（${hits.join(', ')}），已中止恢复。`,
      }
    }
  }

  const map = options.noMap ? null : loadSessionMap(hub)
  const dst = sessionsDir()
  const filter = options.workspaces?.length
    ? new Set(options.workspaces.map((s) => s.toLowerCase()))
    : null

  let restored = 0
  let same = 0
  let mapped = 0
  for (const dir of dirs) {
    const srcMachine = path.basename(dir)
    const files = []
    const walk = (d, rel) => {
      let entries
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const from = path.join(d, e.name)
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) walk(from, r)
        else files.push({ from, rel: r })
      }
    }
    walk(dir, '')
    for (const { from, rel } of files) {
      const parts = rel.split('/')
      if (filter && parts.length >= 1 && !filter.has(parts[0].toLowerCase())) continue
      // G4：只改顶层目录名（workspace 编码），文件内容不动。
      const mappedWs = mapWorkspaceFolder(srcMachine, parts[0], map)
      if (mappedWs !== parts[0]) mapped += 1
      const newRel = parts.length >= 2 ? [mappedWs, ...parts.slice(1)].join('/') : mappedWs
      const target = path.join(dst, newRel.split('/').join(path.sep))
      // G2：永不覆盖。
      if (fs.existsSync(target)) { same += 1; continue }
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(from, target)
      restored += 1
    }
  }
  return { ok: true, restored, same, mapped }
}

/**
 * 读取 config/session-map.json（G4 的映射表）。
 * @param {string} hub 中枢路径。
 * @returns {Record<string, Array<{from:string,to:string}>>|null}
 */
function loadSessionMap(hub) {
  const file = path.join(hub, 'config', 'session-map.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 把来源机器的 workspace 编码目录名映射成本机布局。
 *
 * 编码规则（与原 ps1 的 Encode-WSPath 一致，实测对得上真实目录名）：
 *   去 ':'、'\' → '-'、非 ASCII 字符 → '~XXXX'（UTF-16 码位大写十六进制），
 *   整体包在 '--' 与 '--' 之间。
 *
 * @param {string} srcMachine 来源机器 id。
 * @param {string} encFolder 编码目录名。
 * @param {Record<string, Array<{from:string,to:string}>>|null} map 映射表。
 * @returns {string} 映射后的编码目录名；无映射原样返回。
 */
export function mapWorkspaceFolder(srcMachine, encFolder, map) {
  if (!map || !map[srcMachine] || !Array.isArray(map[srcMachine])) return encFolder
  const decoded = decodeWsPath(encFolder)
  const low = decoded.toLowerCase()
  for (const entry of map[srcMachine]) {
    const from = String(entry.from ?? '').replace(/\//g, '\\').trim().toLowerCase().replace(/\\+$/, '')
    const to = String(entry.to ?? '').replace(/\//g, '\\').trim().replace(/\\+$/, '')
    if (from.length > 0 && low.startsWith(from)) {
      return encodeWsPath(to + decoded.slice(from.length))
    }
  }
  return encFolder
}

/**
 * 编码工作区路径（与原 ps1 的 Encode-WSPath 等价）。
 * @param {string} p 绝对路径。
 * @returns {string} 编码目录名。
 */
export function encodeWsPath(p) {
  const s = String(p).trim().replace(/\//g, '\\').replace(/\\+$/, '')
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)
    if (code === 0x3A) continue // 丢 ':'
    if (code === 0x5C) { out += '-'; continue } // '\' → '-'
    if (code > 0x7F) out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    else out += ch
  }
  return `--${out}--`
}

/**
 * 解码编码目录名（与原 ps1 的 Decode-WSPath 等价）。
 * @param {string} e 编码目录名。
 * @returns {string} 绝对路径。
 */
export function decodeWsPath(e) {
  const inner = String(e).replace(/^-+/, '').replace(/-+$/, '')
  const out = []
  for (const part of inner.split('-')) {
    let s = ''
    let i = 0
    while (i < part.length) {
      if (part[i] === '~' && i + 4 < part.length) {
        const hex = part.slice(i + 1, i + 5)
        if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
          s += String.fromCharCode(parseInt(hex, 16))
          i += 5
          continue
        }
      }
      s += part[i]
      i += 1
    }
    out.push(s)
  }
  // 首段补回盘符冒号。
  if (out.length > 0 && out[0].length === 1) out[0] += ':'
  return out.join('\\')
}

/**
 * 列出中枢里所有机器的会话备份概况（会话浏览页的数据源）。
 *
 * @param {string} hub 中枢路径。
 * @returns {{ok:boolean, machines:Array<{machine:string, files:number, bytes:number, workspaces:Array<{folder:string, path:string|null, files:number}>}>}}
 */
export function listSessionBackups(hub) {
  const root = path.join(hub, 'session-backup')
  const machines = []
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return { ok: true, machines }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(root, e.name)
    const workspaces = []
    let files = 0
    let bytes = 0
    let subs
    try { subs = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const sub of subs) {
      if (!sub.isDirectory()) continue
      const wdir = path.join(dir, sub.name)
      let wfiles = 0
      let wbytes = 0
      const walk = (d) => {
        let es
        try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
        for (const f of es) {
          const p = path.join(d, f.name)
          if (f.isDirectory()) walk(p)
          else {
            wfiles += 1
            try { wbytes += fs.statSync(p).size } catch { /* 跳过 */ }
          }
        }
      }
      walk(wdir)
      workspaces.push({
        folder: sub.name,
        path: safeDecode(sub.name),
        files: wfiles,
        bytes: wbytes,
      })
      files += wfiles
      bytes += wbytes
    }
    machines.push({ machine: e.name, files, bytes, workspaces })
  }
  return { ok: true, machines }
}

/**
 * 安全解码（目录名不是编码形态时原样返回）。
 * @param {string} folder 目录名。
 * @returns {string|null}
 */
function safeDecode(folder) {
  try { return decodeWsPath(folder) } catch { return null }
}

/**
 * 统计目录内文件数（用于跳过计数与回读校验）。
 * @param {string} dir 目录。
 * @returns {number}
 */
function countFiles(dir) {
  let n = 0
  const walk = (d) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(d, e.name))
      else n += 1
    }
  }
  walk(dir)
  return n
}
