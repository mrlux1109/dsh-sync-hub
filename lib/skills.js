/**
 * lib/skills.js — skill inventory / enable-disable / import / create / trash.
 *
 * Scope note: this is deliberately SIMPLER than @michengai/dsh-skills-manager
 * (which covers 19 agent dirs, GitHub repo subscriptions, diff previews and a
 * recycle bin with restore). Here we cover what sync-hub actually needs:
 *   - list skills across the agent dirs that exist on THIS machine
 *   - enable / disable (DSH discovers a skill only when SKILL.md is present,
 *     so disabling = rename SKILL.md <-> SKILL.md.disabled; fully reversible,
 *     never touches another agent's files)
 *   - import from a URL (GitHub repo / .zip / raw SKILL.md)
 *   - create a new skill from a template
 *   - delete = move to a trash dir (never hard-delete)
 *
 * Only DSH's own skills dir is writable; other agents' dirs are read-only.
 *
 * @module lib/skills
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const DISABLED = '.disabled'
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Agent skill roots. writable = sync-hub may create/rename/delete here. */
export function skillRoots() {
  const home = os.homedir()
  return [
    { id: 'dsh', label: 'DSH', dir: path.join(home, '.dsh', 'skills'), writable: true },
    { id: 'agents', label: 'Shared Agent', dir: path.join(home, '.agents', 'skills'), writable: true },
    { id: 'trae-cn', label: 'Trae CN', dir: path.join(home, '.trae-cn', 'skills'), writable: false },
    { id: 'workbuddy', label: 'WorkBuddy', dir: path.join(home, '.workbuddy', 'skills'), writable: false },
    { id: 'qoder', label: 'Qoder', dir: path.join(home, '.qoder', 'skills'), writable: false },
    { id: 'lingma', label: 'Qoder CN', dir: path.join(home, '.lingma', 'skills'), writable: false },
    { id: 'claude', label: 'Claude Code', dir: path.join(home, '.claude', 'skills'), writable: false },
    { id: 'codex', label: 'Codex', dir: path.join(home, '.codex', 'skills'), writable: false },
    { id: 'cursor', label: 'Cursor', dir: path.join(home, '.cursor', 'skills'), writable: false },
    { id: 'copilot', label: 'Copilot', dir: path.join(home, '.copilot', 'skills'), writable: false },
    { id: 'trae', label: 'Trae', dir: path.join(home, '.trae', 'skills'), writable: false },
    { id: 'cc-switch', label: 'CC Switch', dir: path.join(home, '.cc-switch', 'skills'), writable: false },
  ]
}

export function dshSkillsDir() {
  return path.join(os.homedir(), '.dsh', 'skills')
}

function trashDir() {
  return path.join(os.homedir(), '.dsh', 'skills-trash')
}

/** Minimal frontmatter reader: name / description / whenToUse from SKILL.md. */
function readFrontmatter(file) {
  const out = { name: '', description: '', whenToUse: '' }
  try {
    const text = fs.readFileSync(file, 'utf8')
    const end = text.indexOf('\n---', 3)
    const head = end > 0 ? text.slice(0, end) : text.slice(0, 2000)
    const grab = (key) => {
      const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(head)
      return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
    }
    out.name = grab('name')
    out.description = grab('description')
    out.whenToUse = grab('whenToUse')
  } catch { /* unreadable */ }
  return out
}

function dirSize(dir) {
  let total = 0
  const walk = (p) => {
    let entries = []
    try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) walk(full)
      else { try { total += fs.statSync(full).size } catch { /* skip */ } }
    }
  }
  walk(dir)
  return total
}

/**
 * Manual recursive copy. NOT fs.cpSync: on Windows/Node 22 that call aborts the
 * process natively on an empty directory (exit 127, no stderr, uncatchable) —
 * see memory/shared.md 4.6. This version skips empty dirs safely.
 */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) copyTree(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
    // symlinks and other special entries are skipped on purpose
  }
}

/** Every skill found in every existing root, with enable state. */
export function listSkills() {
  const items = []
  for (const root of skillRoots()) {
    let entries = []
    try { entries = fs.readdirSync(root.dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name === '.git' || e.name.startsWith('.')) continue
      const dir = path.join(root.dir, e.name)
      const live = path.join(dir, 'SKILL.md')
      const off = path.join(dir, 'SKILL.md' + DISABLED)
      const hasLive = fs.existsSync(live)
      const hasOff = fs.existsSync(off)
      if (!hasLive && !hasOff) continue
      const fm = readFrontmatter(hasLive ? live : off)
      items.push({
        name: e.name,
        rootId: root.id,
        rootLabel: root.label,
        writable: root.writable,
        enabled: hasLive,
        valid: KEBAB.test(fm.name || e.name) && !!fm.description,
        description: fm.description || '',
        whenToUse: fm.whenToUse || '',
        sizeKB: Math.round(dirSize(dir) / 1024),
        path: dir,
      })
    }
  }
  return items
}

/** Enable/disable by renaming SKILL.md. Refuses read-only roots. */
export function toggleSkill({ name, rootId, enable }) {
  const root = skillRoots().find((r) => r.id === rootId)
  if (!root) return { ok: false, text: 'unknown root: ' + rootId }
  if (!root.writable) return { ok: false, text: root.label + ' 是只读来源，不能改（只读取展示）' }
  if (!name || /[\\/]|\.\./.test(name)) return { ok: false, text: 'invalid skill name' }
  const dir = path.join(root.dir, name)
  if (!fs.existsSync(dir)) return { ok: false, text: 'skill not found: ' + name }
  const live = path.join(dir, 'SKILL.md')
  const off = path.join(dir, 'SKILL.md' + DISABLED)
  try {
    if (enable) {
      if (fs.existsSync(live)) return { ok: true, text: name + ' 已是启用状态' }
      if (!fs.existsSync(off)) return { ok: false, text: name + ' 没有 SKILL.md，无法启用' }
      fs.renameSync(off, live)
      return { ok: true, text: '已启用 ' + name }
    }
    if (fs.existsSync(off) && !fs.existsSync(live)) return { ok: true, text: name + ' 已是停用状态' }
    if (!fs.existsSync(live)) return { ok: false, text: name + ' 没有 SKILL.md，无法停用' }
    fs.renameSync(live, off)
    return { ok: true, text: '已停用 ' + name }
  } catch (e) {
    return { ok: false, text: '操作失败: ' + String(e.message ?? e) }
  }
}

/** Move a skill to the trash dir (never hard-delete). DSH root only. */
export function trashSkill({ name }) {
  if (!name || /[\\/]|\.\./.test(name)) return { ok: false, text: 'invalid skill name' }
  const src = path.join(dshSkillsDir(), name)
  if (!fs.existsSync(src)) return { ok: false, text: 'skill not found: ' + name }
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const dst = path.join(trashDir(), name + '-' + stamp)
  try {
    fs.mkdirSync(trashDir(), { recursive: true })
    fs.renameSync(src, dst)
    return { ok: true, text: '已移入回收站: ' + path.basename(dst) + '（可手动从 ' + trashDir() + ' 找回）' }
  } catch (e) {
    return { ok: false, text: '删除失败: ' + String(e.message ?? e) }
  }
}

export function listTrash() {
  const dir = trashDir()
  let items = []
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        let mtime = 0
        try { mtime = fs.statSync(path.join(dir, e.name)).mtimeMs } catch { /* skip */ }
        return { name: e.name, mtime }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch { /* no trash yet */ }
  return { dir, items }
}

export function restoreTrash({ name }) {
  if (!name || /[\\/]|\.\./.test(name)) return { ok: false, text: 'invalid name' }
  const src = path.join(trashDir(), name)
  if (!fs.existsSync(src)) return { ok: false, text: 'not in trash: ' + name }
  // trash entries are "<skill>-<stamp>"; strip the trailing stamp
  const target = name.replace(/-\d{14}$/, '')
  const dst = path.join(dshSkillsDir(), target)
  if (fs.existsSync(dst)) return { ok: false, text: '同名技能已存在: ' + target + '（先改名或先删除它）' }
  try {
    fs.renameSync(src, dst)
    return { ok: true, text: '已恢复: ' + target }
  } catch (e) {
    return { ok: false, text: '恢复失败: ' + String(e.message ?? e) }
  }
}

/** Create a new skill scaffold under the DSH skills dir. */
export function createSkill({ name, description, body }) {
  const n = String(name ?? '').trim()
  if (!KEBAB.test(n)) return { ok: false, text: '技能名必须是小写 kebab-case（如 my-skill）' }
  const d = String(description ?? '').trim()
  if (!d) return { ok: false, text: 'description 必填（DSH 靠它决定何时调用）' }
  const dir = path.join(dshSkillsDir(), n)
  if (fs.existsSync(dir)) return { ok: false, text: '同名技能已存在: ' + n }
  const content = [
    '---',
    'name: ' + n,
    'description: ' + d,
    '---',
    '',
    '# ' + n,
    '',
    String(body ?? '').trim() || '（在这里写技能的使用说明）',
    '',
  ].join('\n')
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8')
    return { ok: true, text: '已创建技能: ' + n + '\n' + dir }
  } catch (e) {
    return { ok: false, text: '创建失败: ' + String(e.message ?? e) }
  }
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true, ...(opts || {}) })
    } catch (e) { resolve({ code: -1, out: String(e) }); return }
    let out = ''
    let timedOut = false
    const ms = (opts && opts.timeoutMs) || 0
    const timer = ms ? setTimeout(() => { timedOut = true; try { child.kill() } catch { /* gone */ } }, ms) : null
    child.stdout?.on('data', (d) => { out += d.toString('utf8') })
    child.stderr?.on('data', (d) => { out += d.toString('utf8') })
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: -1, out: out + String(e) }) })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: timedOut ? -3 : (code === null ? -1 : code), out })
    })
  })
}

/** Find every directory containing SKILL.md under a tree (bounded depth). */
function findSkillDirs(root, maxDepth = 6) {
  const found = []
  const walk = (p, depth) => {
    if (depth > maxDepth) return
    let entries = []
    try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch { return }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) found.push(p)
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name === '.git' || e.name === 'node_modules') continue
      walk(path.join(p, e.name), depth + 1)
    }
  }
  walk(root, 0)
  return found
}

/**
 * Import a skill from a URL. Supports, in order of detection:
 *   - GitHub repo/tree URL  -> git clone --depth 1, then find SKILL.md
 *   - any *.zip URL         -> download, extract with tar (bsdtar reads zip)
 *   - raw SKILL.md URL      -> single-file skill (name from frontmatter)
 * Always lands in the DSH skills dir; refuses to overwrite an existing name.
 */
export async function importSkillFromUrl({ url, name }) {
  const raw = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(raw)) return { ok: false, text: '请填 http(s) 开头的网址' }
  const tmp = path.join(os.tmpdir(), 'sync-hub-skill-' + Date.now())
  try {
    fs.mkdirSync(tmp, { recursive: true })

    // 1) GitHub repo or subdirectory
    const gh = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?\/?$/i.exec(raw)
    if (gh) {
      const [, owner, repo, branch, sub] = gh
      const clone = await run('git', ['clone', '--depth', '1', ...(branch ? ['--branch', branch] : []),
        `https://github.com/${owner}/${repo}.git`, path.join(tmp, 'repo')], { timeoutMs: 180000 })
      if (clone.code !== 0) return { ok: false, text: '克隆失败：\n' + String(clone.out).slice(-600) }
      const searchRoot = sub ? path.join(tmp, 'repo', sub) : path.join(tmp, 'repo')
      const dirs = findSkillDirs(searchRoot)
      if (!dirs.length) return { ok: false, text: '这个仓库里没找到 SKILL.md' }
      const chosen = dirs.find((d) => path.basename(d) === name) || dirs[0]
      const fm = readFrontmatter(path.join(chosen, 'SKILL.md'))
      const finalName = String(name ?? '').trim() || fm.name || path.basename(chosen)
      if (!KEBAB.test(finalName)) return { ok: false, text: '技能名不合法（需 kebab-case）：' + finalName + '\n可在「技能名」框里指定一个' }
      const dst = path.join(dshSkillsDir(), finalName)
      if (fs.existsSync(dst)) return { ok: false, text: '同名技能已存在: ' + finalName + '（先停用/删除或换个名字）' }
      fs.mkdirSync(dshSkillsDir(), { recursive: true })
      copyTree(chosen, dst)
      const extra = dirs.length > 1 ? `\n（该仓库含 ${dirs.length} 个技能，已导入第一个；需要其他请分别填子目录 URL）` : ''
      return { ok: true, text: '已导入 ' + finalName + '\n来源: ' + raw + extra }
    }

    // 2) zip archive
    if (/\.zip(\?|$)/i.test(raw)) {
      const zipPath = path.join(tmp, 'pkg.zip')
      const res = await fetch(raw)
      if (!res.ok) return { ok: false, text: '下载失败: HTTP ' + res.status }
      fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))
      const ex = path.join(tmp, 'x')
      fs.mkdirSync(ex, { recursive: true })
      const un = await run('tar', ['-xf', zipPath, '-C', ex], { timeoutMs: 120000 })
      if (un.code !== 0) return { ok: false, text: '解压失败（需要 tar）：\n' + String(un.out).slice(-400) }
      const dirs = findSkillDirs(ex)
      if (!dirs.length) return { ok: false, text: '压缩包里没找到 SKILL.md' }
      const chosen = dirs.find((d) => path.basename(d) === name) || dirs[0]
      const fm = readFrontmatter(path.join(chosen, 'SKILL.md'))
      const finalName = String(name ?? '').trim() || fm.name || path.basename(chosen)
      if (!KEBAB.test(finalName)) return { ok: false, text: '技能名不合法：' + finalName }
      const dst = path.join(dshSkillsDir(), finalName)
      if (fs.existsSync(dst)) return { ok: false, text: '同名技能已存在: ' + finalName }
      fs.mkdirSync(dshSkillsDir(), { recursive: true })
      copyTree(chosen, dst)
      return { ok: true, text: '已导入 ' + finalName + '\n来源: ' + raw }
    }

    // 3) raw SKILL.md
    const res = await fetch(raw)
    if (!res.ok) return { ok: false, text: '下载失败: HTTP ' + res.status }
    const text = await res.text()
    if (!/^---/.test(text.trim())) return { ok: false, text: '这个网址返回的不是 SKILL.md（缺少 --- frontmatter）\n支持：GitHub 仓库地址 / .zip 地址 / 原始 SKILL.md 地址' }
    const tmpFile = path.join(tmp, 'SKILL.md')
    fs.writeFileSync(tmpFile, text, 'utf8')
    const fm = readFrontmatter(tmpFile)
    const finalName = String(name ?? '').trim() || fm.name
    if (!finalName || !KEBAB.test(finalName)) return { ok: false, text: '无法确定技能名（SKILL.md 里没有合法 name），请在「技能名」框里填一个' }
    const dst = path.join(dshSkillsDir(), finalName)
    if (fs.existsSync(dst)) return { ok: false, text: '同名技能已存在: ' + finalName }
    fs.mkdirSync(dst, { recursive: true })
    fs.copyFileSync(tmpFile, path.join(dst, 'SKILL.md'))
    return { ok: true, text: '已导入 ' + finalName + '\n来源: ' + raw }
  } catch (e) {
    return { ok: false, text: '导入失败: ' + String(e.message ?? e) }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* leave temp */ }
  }
}

/** Read one skill's SKILL.md body for the detail view. */
export function readSkill({ name, rootId }) {
  const root = skillRoots().find((r) => r.id === (rootId || 'dsh'))
  if (!root) return { ok: false, text: 'unknown root' }
  if (!name || /[\\/]|\.\./.test(name)) return { ok: false, text: 'invalid name' }
  const dir = path.join(root.dir, name)
  for (const f of ['SKILL.md', 'SKILL.md' + DISABLED]) {
    const p = path.join(dir, f)
    if (fs.existsSync(p)) {
      try {
        const text = fs.readFileSync(p, 'utf8')
        return { ok: true, text: text.length > 40000 ? text.slice(0, 40000) + '\n...(truncated)' : text, path: p }
      } catch (e) { return { ok: false, text: String(e.message ?? e) } }
    }
  }
  return { ok: false, text: 'SKILL.md not found' }
}
