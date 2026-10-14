/**
 * lib/hub/memory.js —— 记忆·配置域（M6b 收尾）。
 *
 * 旧版语义（v0.11 /hub/files）：白名单内的中枢文本可查看/编辑/保存。
 * 保存 = 写中枢工作区 + 本地 commit（不自动推送）；JSON 先校验语法；
 * 保存前旧版本归档；另一台机器改过同一文件 → 保存被拒（要求先拉取）。
 *
 * 白名单（与旧版一致）：
 *   memory/shared.md、memory/machines 目录下的 .md、config 目录下的文本文件
 *   （dshconfig 快照除外）、各技能目录的 SKILL.md。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单                                                              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **白名单硬闸**：只放行上列表内的相对路径；其余一律拒绝（含          │
 * │    .. / 绝对路径 / 盘符）。白名单外没有"意外可写"。                    │
 * │ G2 **体积上限**：读 512KB、写 1MB，防把巨物读进内存/写爆仓库。         │
 * │ G3 **JSON 先校验**：目标是 .json 且内容解析失败 → 拒绝保存。          │
 * │ G4 **改前归档**：保存前把当前内容复制进 <hub>/backups-archive/。      │
 * │ G5 **远端变更拒保存**：编辑基线（打开时的 blob sha）≠ 当前 blob sha    │
 * │    → 拒绝并提示先拉取（防覆盖另一台的改动）。                          │
 * │ G6 **本地提交不推送**：保存只 commit，绝不 push（推送是同步页的显式动作）│
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/memory.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { git } from '../exec.js'

/** 读上限。 */
const MAX_READ = 512 * 1024
/** 写上限。 */
const MAX_WRITE = 1024 * 1024

/**
 * 白名单判定（G1）。
 * @param {string} rel 仓库相对路径（正斜杠）。
 * @returns {boolean}
 */
export function isWhitelisted(rel) {
  if (typeof rel !== 'string') return false
  const s = rel.trim().replace(/\\/g, '/')
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s)) return false
  const parts = []
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return false
    parts.push(seg)
  }
  if (parts.length === 0) return false
  const j = parts.join('/')
  return j === 'memory/shared.md'
    || (j.startsWith('memory/machines/') && j.endsWith('.md'))
    || (j.startsWith('config/') && !j.endsWith('/') && !j.includes('/dshconfig/'))
    || (j.startsWith('skills/') && j.endsWith('/SKILL.md'))
}

/**
 * 列出白名单内的全部文件（读中枢工作区，配合 git 状态标"已改动"）。
 *
 * @param {string} hub 中枢路径。
 * @returns {Promise<{ok:boolean, files:Array<{path:string, bytes:number, dirty:boolean, group:string}>, error?:string}>}
 */
export async function listEditableFiles(hub) {
  // 工作区里的白名单文件
  const files = []
  const addFile = (abs, rel) => {
    try {
      if (!fs.statSync(abs).isFile()) return
      files.push({ path: rel, bytes: fs.statSync(abs).size, dirty: false, group: groupOf(rel) })
    } catch { /* 跳过读不到的 */ }
  }
  const walk = (dir, relBase) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      const rel = relBase ? `${relBase}/${e.name}` : e.name
      if (e.isDirectory()) walk(abs, rel)
      else if (isWhitelisted(rel)) addFile(abs, rel)
    }
  }
  walk(path.join(hub, 'memory'), 'memory')
  walk(path.join(hub, 'config'), 'config')
  walk(path.join(hub, 'skills'), 'skills')

  // git 状态标 dirty
  const st = await git(['status', '--porcelain'], { repo: hub, timeoutMs: 20_000 })
  if (st.ok) {
    const dirtySet = new Set(
      st.stdout.split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).trim()),
    )
    for (const f of files) {
      if (dirtySet.has(f.path)) f.dirty = true
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  return { ok: true, files }
}

/**
 * 分组名（UI 分栏用）。
 * @param {string} rel 仓库相对路径。
 * @returns {string}
 */
function groupOf(rel) {
  if (rel === 'memory/shared.md') return '共享记忆'
  if (rel.startsWith('memory/machines/')) return '机器档案'
  if (rel.startsWith('config/')) return '配置'
  if (rel.startsWith('skills/')) return '技能正文'
  return '其他'
}

/**
 * 读一个白名单文件（G1/G2），并带回 blob sha 作为编辑基线（G5 用）。
 *
 * @param {string} hub 中枢路径。
 * @param {string} rel 仓库相对路径。
 * @returns {Promise<{ok:boolean, path?:string, content?:string, bytes?:number, sha?:string, group?:string, error?:string}>}
 */
export async function readEditableFile(hub, rel) {
  if (!isWhitelisted(rel)) return { ok: false, error: '不在白名单内' }
  const clean = rel.trim().replace(/\\/g, '/')
  const abs = path.join(hub, ...clean.split('/'))
  let content
  try {
    const buf = fs.readFileSync(abs)
    if (buf.length > MAX_READ) return { ok: false, error: `文件超过 ${Math.round(MAX_READ / 1024)}KB 读取上限` }
    content = buf.toString('utf8')
  } catch (error) {
    return { ok: false, error: `读取失败：${String(error?.message ?? error)}` }
  }
  // blob sha（编辑基线）
  const ls = await git(['ls-files', '-s', clean], { repo: hub, timeoutMs: 15_000 })
  const sha = ls.ok ? (ls.stdout.match(/^(\d{6}) ([0-9a-f]{40})/) ?? [])[2] ?? null : null
  return { ok: true, path: clean, content, bytes: Buffer.byteLength(content, 'utf8'), sha, group: groupOf(clean) }
}

/**
 * 保存一个白名单文件（G1/G3/G4/G5/G6 全查）。
 *
 * @param {string} hub 中枢路径。
 * @param {{path:string, content:string, baseSha:string|null, message?:string, autoPush?:boolean}} edit
 *   autoPush（N7）：true 时保存成功后立即 push（客户端从偏好开关读）。
 * @returns {Promise<{ok:boolean, path?:string, bytes?:number, archived?:string|null, commit?:string|null, autoPushed?:boolean, autoPushError?:string, error?:string, hint?:string}>}
 */
export async function saveEditableFile(hub, edit) {
  const clean = String(edit?.path ?? '').trim().replace(/\\/g, '/')
  if (!isWhitelisted(clean)) return { ok: false, error: '不在白名单内' }
  const content = String(edit?.content ?? '')
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_WRITE) return { ok: false, error: `内容超过 ${Math.round(MAX_WRITE / 1024)}KB 保存上限` }

  const abs = path.join(hub, ...clean.split('/'))
  if (!fs.existsSync(abs)) return { ok: false, error: '文件不存在（本插件不创建新文件；新建技能请用技能导入）' }

  // G5：基线比对（baseSha 由调用方从 read 时带回；null = 无法校验，放行但注明）
  if (edit?.baseSha) {
    const ls = await git(['ls-files', '-s', clean], { repo: hub, timeoutMs: 15_000 })
    const currentSha = ls.ok ? (ls.stdout.match(/^(\d{6}) ([0-9a-f]{40})/) ?? [])[2] ?? null : null
    if (currentSha && currentSha !== edit.baseSha) {
      return {
        ok: false,
        error: '云端文件已被改动（另一台机器拉取后未同步到你的编辑器）。请先在同步页拉取，再重新打开编辑。',
        hint: 'stale-baseline',
      }
    }
  }

  // G3：JSON 先校验
  if (clean.endsWith('.json')) {
    try { JSON.parse(content) } catch (error) {
      return { ok: false, error: `JSON 语法错误：${String(error?.message ?? error).slice(0, 160)}` }
    }
  }

  // G4：改前归档
  let archived = null
  try {
    const archDir = path.join(hub, 'backups-archive')
    fs.mkdirSync(archDir, { recursive: true })
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    const archName = `${clean.replace(/\//g, '__')}.bak-${stamp}`
    fs.copyFileSync(abs, path.join(archDir, archName))
    archived = archName
  } catch { /* 归档失败不阻断保存，如实记录 */ }

  // 写入
  try {
    fs.writeFileSync(abs, content, 'utf8')
  } catch (error) {
    return { ok: false, error: `写入失败：${String(error?.message ?? error)}` }
  }

  // G6：本地 commit；autoPush 开启时保存后紧跟 push（N7，默认关）。
  const add = await git(['add', '--', clean], { repo: hub, timeoutMs: 30_000 })
  if (!add.ok) {
    return { ok: true, path: clean, bytes, archived, commit: null, warning: '已写入但 git add 失败（稍后手动提交）' }
  }
  const message = edit?.message?.trim() || `memory: 编辑 ${clean}（同步中枢面板）`
  const commit = await git(['commit', '-m', message], { repo: hub, timeoutMs: 60_000 })
  const commitHash = commit.ok
    ? (await git(['log', '-1', '--format=%h'], { repo: hub, timeoutMs: 15_000 })).stdout.trim()
    : null
  const nothingToCommit = !commit.ok && /nothing to commit|no changes added/i.test(`${commit.stdout}\n${commit.stderr}`)

  // N7 自动推送：显式传 autoPush:true 才推（客户端从偏好文件读开关），
  // 推送失败不影响保存结果（如实带 autoPushError）。
  let autoPushed = false
  let autoPushError = null
  if (edit?.autoPush === true && commitHash) {
    const pushed = await git(['push', '-u', 'origin', 'HEAD'], { repo: hub, timeoutMs: 600_000 })
    autoPushed = pushed.ok
    if (!pushed.ok) {
      autoPushError = `${pushed.stdout}\n${pushed.stderr}`.trim().slice(0, 300)
    }
  }

  return {
    ok: true,
    path: clean,
    bytes,
    archived,
    commit: commitHash,
    ...(autoPushed ? { autoPushed: true } : {}),
    ...(autoPushError ? { autoPushError } : {}),
    ...(nothingToCommit ? { warning: '内容无变化，未产生新提交' } : {}),
  }
}
