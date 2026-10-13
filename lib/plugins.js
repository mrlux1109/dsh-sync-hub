/**
 * lib/plugins.js — DSH plugin inventory, npm-market search, install/update.
 *
 * Reads the profile's package.json (dependencies + dsh.profile.bundles) and
 * reports link health for each entry, mirroring tools/plugins.ps1 -List but
 * structured for the card. Market search hits the public npm registry for the
 * "dsh-plugin" keyword; install runs `dsh plugin --profile <p> add <pkg>`.
 *
 * Installs are real and mutate the profile, so the card gates them behind an
 * explicit click and reports the exact command output.
 *
 * @module lib/plugins
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function profilesRoot() {
  return path.join(dshHome(), 'profiles')
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    let child
    try { child = spawn(cmd, args, { windowsHide: true, ...(opts || {}) }) } catch (e) { resolve({ code: -1, out: String(e) }); return }
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

/** Installed plugins per profile, with link health + bundled flag. */
export function listInstalled() {
  const root = profilesRoot()
  const profiles = []
  let profDirs = []
  try { profDirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()) } catch { return { profiles } }
  for (const pd of profDirs) {
    const pkgPath = path.join(root, pd.name, 'package.json')
    const j = readJson(pkgPath)
    if (!j) continue
    const deps = j.dependencies || {}
    const bundles = new Set(Array.isArray(j.dsh?.profile?.bundles) ? j.dsh.profile.bundles : [])
    const items = Object.keys(deps).sort().map((name) => {
      const spec = String(deps[name] ?? '')
      let linkOk = true
      let resolved = spec
      if (spec.startsWith('file:') || spec.startsWith('link:')) {
        const p = spec.replace(/^(file|link):/, '')
        resolved = p
        linkOk = fs.existsSync(p)
      } else if (spec.startsWith('git+') || /^https?:/.test(spec)) {
        linkOk = true // remote spec: nothing local to check
      } else {
        // registry semver: the package dir must exist in the profile's node_modules
        const nm = path.join(root, pd.name, 'node_modules', name)
        linkOk = fs.existsSync(nm)
        resolved = nm
      }
      let version = ''
      try { version = readJson(path.join(resolved, 'package.json'))?.version || '' } catch { /* unknown */ }
      return { name, spec, version, bundled: bundles.has(name), linkOk, resolved }
    })
    // bundles entries that have no dependency row (built-ins like @deepseek-ai/*)
    const orphanBundles = [...bundles].filter((b) => !deps[b]).sort()
    profiles.push({ profile: pd.name, path: pd.name, items, bundles: [...bundles], orphanBundles })
  }
  return { profiles }
}

/** Search the public npm registry for DSH plugins. */
export async function searchMarket({ query, size }) {
  const q = String(query ?? '').trim()
  const text = q ? `${q} keywords:dsh-plugin` : 'keywords:dsh-plugin'
  const n = Math.min(Math.max(Number(size) || 20, 1), 50)
  const url = 'https://registry.npmjs.org/-/v1/search?text=' + encodeURIComponent(text) + '&size=' + n
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return { ok: false, text: 'npm registry HTTP ' + res.status, items: [] }
    const j = await res.json()
    const items = (j.objects || []).map((o) => ({
      name: o.package?.name || '',
      version: o.package?.version || '',
      description: (o.package?.description || '').slice(0, 200),
      date: o.package?.date || '',
      publisher: o.package?.publisher?.username || '',
      links: o.package?.links || {},
      score: Math.round((o.score?.final || 0) * 100),
    }))
    return { ok: true, total: j.total || items.length, items }
  } catch (e) {
    return { ok: false, text: '搜索失败: ' + String(e.message ?? e), items: [] }
  }
}

/** Locate the dsh CLI shipped with the desktop app (same probe as apply.ps1). */
function findDshCli() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness'),
    'C:\\Program Files\\DeepSeek Harness',
    'D:\\Users\\Administrator\\AppData\\Local\\Programs\\DeepSeek Harness',
  ]
  for (const c of candidates) {
    const cli = path.join(c, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')
    if (fs.existsSync(cli)) return { root: c, cli }
  }
  return null
}

/**
 * Install a plugin into a profile via the shipped dsh CLI.
 */
export async function installPlugin({ name, profile }) {
  const pkg = String(name ?? '').trim()
  if (!/^(@[a-z0-9-_.]+\/)?[a-z0-9-_.]+$/i.test(pkg)) return { ok: false, text: '包名不合法: ' + pkg }
  const prof = String(profile ?? 'desktop').trim()
  const found = findDshCli()
  if (!found) return { ok: false, text: '找不到 dsh CLI（DeepSeek Harness 装在哪？）' }
  const r = await run(found.cli, ['plugin', '--profile', prof, 'add', pkg,
    '--registry=https://registry.npmjs.org/'], { timeoutMs: 600000 })
  const tail = String(r.out).split(/\r?\n/).filter(Boolean).slice(-12).join('\n')
  return { ok: r.code === 0, text: (r.code === 0 ? '安装完成，重启 DSH 生效: ' : '安装失败(exit ' + r.code + '): ') + pkg + '\n\n' + tail }
}

/** Uninstall a plugin from a profile (dsh plugin remove). */
export async function uninstallPlugin({ name, profile }) {
  const pkg = String(name ?? '').trim()
  if (!/^(@[a-z0-9-_.]+\/)?[a-z0-9-_.]+$/i.test(pkg)) return { ok: false, text: '包名不合法: ' + pkg }
  const prof = String(profile ?? 'desktop').trim()
  const found = findDshCli()
  if (!found) return { ok: false, text: '找不到 dsh CLI' }
  const r = await run(found.cli, ['plugin', '--profile', prof, 'remove', pkg], { timeoutMs: 300000 })
  const tail = String(r.out).split(/\r?\n/).filter(Boolean).slice(-10).join('\n')
  return { ok: r.code === 0, text: (r.code === 0 ? '已卸载: ' : '卸载失败(exit ' + r.code + '): ') + pkg + '\n\n' + tail }
}

/** Latest published version of a package on npm, or '' when unknown. */
async function latestVersion(name) {
  try {
    const res = await fetch('https://registry.npmjs.org/' + encodeURIComponent(name) + '/latest',
      { headers: { accept: 'application/json' } })
    if (!res.ok) return ''
    const j = await res.json()
    return String(j.version || '')
  } catch { return '' }
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

/**
 * Compare installed plugins against npm. Only registry-spec packages are
 * checked: `file:` / `link:` / `git+` entries are local or owner-pinned and are
 * reported as source 'local' rather than nagged about.
 */
export async function checkOutdated({ profile }) {
  const prof = String(profile ?? '').trim()
  const all = listInstalled()
  const targets = []
  for (const p of all.profiles) {
    if (prof && p.profile !== prof) continue
    for (const it of p.items) {
      const local = it.spec.startsWith('file:') || it.spec.startsWith('link:')
        || it.spec.startsWith('git+') || /^https?:/.test(it.spec)
      targets.push({ profile: p.profile, name: it.name, current: it.version, local })
    }
  }
  const results = await Promise.all(targets.map(async (t) => {
    if (t.local) return { ...t, latest: '', outdated: false, source: 'local' }
    const latest = await latestVersion(t.name)
    return { ...t, latest, outdated: !!(latest && t.current && cmpVersion(latest, t.current) > 0), source: 'npm' }
  }))
  return { ok: true, items: results, outdated: results.filter((r) => r.outdated).length }
}

/** Update one plugin to latest (dsh plugin add <pkg>@latest). */
export async function updatePlugin({ name, profile }) {
  const pkg = String(name ?? '').trim()
  if (!/^(@[a-z0-9-_.]+\/)?[a-z0-9-_.]+$/i.test(pkg)) return { ok: false, text: '包名不合法: ' + pkg }
  const prof = String(profile ?? 'desktop').trim()
  const found = findDshCli()
  if (!found) return { ok: false, text: '找不到 dsh CLI' }
  const r = await run(found.cli, ['plugin', '--profile', prof, 'add', pkg + '@latest',
    '--registry=https://registry.npmjs.org/'], { timeoutMs: 600000 })
  const tail = String(r.out).split(/\r?\n/).filter(Boolean).slice(-12).join('\n')
  return { ok: r.code === 0, text: (r.code === 0 ? '已更新到最新，重启 DSH 生效: ' : '更新失败(exit ' + r.code + '): ') + pkg + '\n\n' + tail }
}

/**
 * Curated picks for the market's recommendation row. Deliberately small and
 * opinionated: each entry does something the others do not. Owner-editable.
 */
export const FEATURED = [
  { name: '@michengai/dsh-skills-manager', why: '19 种 Agent 目录统一管理技能，GitHub 仓库订阅与更新回退' },
  { name: 'dsh-plugin-whale-pet', why: '桌面宠物：会话提醒、工具审批与提问都在宠物上处理' },
  { name: '@nanmicoder/dsh-agent-teams', why: '多 Agent 团队协作：组队、分工、依赖编排' },
  { name: 'dsh-workbuddy-xdpool', why: 'WorkBuddy 多账号合并成自动故障转移的模型池' },
  { name: 'dsh-rewind-plugin', why: '会话回退：改坏了能退回之前的状态' },
  { name: '@tsqurt/dsh-plugin-studio', why: '插件开发工作台：脚手架、调试、打包' },
  { name: '@cocofhu/skillhub', why: 'SkillHub 技能市场接入，搜索与安装社区技能' },
  { name: 'dshmarket', why: '插件市场：浏览、安装、管理第三方插件' },
]

