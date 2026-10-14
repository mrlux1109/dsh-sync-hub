/**
 * dsh-sync-hub — sync-hub console tools (Host half).
 *
 * Registers 15 model tools covering the NON-INTERACTIVE safe subset of the
 * sync-hub console (tools/*.ps1). Interactive flows (apply identity guard,
 * 一条龙, conflict resolution, session restore) stay human-only via the
 * 同步中枢.bat console - this plugin never wraps them.
 *
 * Registration contract (verified against the shipped kernel, app.asar):
 *   - `export const inject = ['tools']`  (cf. dsh-our-free-model: inject = ['llm'])
 *   - `export function apply(ctx, config)`
 *   - Tools are registered as PLAIN objects via `ctx.tools.register(def)`,
 *     exactly like the MCP bridge (createMcpToolDefinition) - NO import of
 *     '@deepseek-ai/dsh-tools' and NO defineTool sugar. `register()` only
 *     validates `output.schema` (assertSupportedJsonSchema) + `output.render`,
 *     so `parameters` and `output.schema` use STANDARD JSON Schema
 *     (`required` is an array, not the DSL per-property `required: true`).
 *   - `execute(args, exec)` returns the value object; `output.render(args,
 *     value)` projects it to [{ type: 'text', text }].
 *   - exec.signal is observed and cancels the child (cooperative cancellation).
 *
 * This dependency-free form removes the only unverified risk (whether a
 * third-party plugin can resolve '@deepseek-ai/dsh-tools'). Hub path is
 * auto-detected (home / shop candidates) or forced via config.hubPath /
 * env SYNC_HUB_PATH.
 *
 * @module index.js
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import zlib from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import * as skills from './lib/skills.js'
import * as plugins from './lib/plugins.js'

export const inject = ['tools']

const HUB_CANDIDATES = [
  'D:\\【AI智能】\\sync-hub',
  'D:\\AI\\sync-hub',
  path.join(os.homedir(), 'sync-hub'),
]

let cachedHub = null

function resolveHub(config) {
  if (cachedHub) return cachedHub
  const list = []
  if (config && typeof config.hubPath === 'string' && config.hubPath.trim()) list.push(config.hubPath.trim())
  if (process.env.SYNC_HUB_PATH) list.push(process.env.SYNC_HUB_PATH)
  list.push(...HUB_CANDIDATES)
  for (const c of list) {
    try {
      if (fs.existsSync(path.join(c, 'VERSION')) && fs.existsSync(path.join(c, 'tools', 'status.ps1'))) {
        cachedHub = c
        return c
      }
    } catch { /* keep looking */ }
  }
  return null
}

// Standard JSON Schema for the canonical { ok, code, text } result.
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    code: { type: 'number' },
    text: { type: 'string' },
  },
  required: ['ok', 'code', 'text'],
  additionalProperties: false,
}

const OUT = {
  schema: RESULT_SCHEMA,
  render(_args, value) {
    const text = value && typeof value.text === 'string'
      ? value.text
      : JSON.stringify(value)
    return [{ type: 'text', text }]
  },
}

// empty object-root parameter schema (no arguments)
const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false }

const PUSH_PARAMS = {
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      items: { type: 'string', enum: ['memory', 'skills', 'config', 'plugins', 'sessions', 'dshconfig'] },
      description: '六类上传范围: memory=记忆, skills=技能, config=配置, plugins=插件清单, sessions=会话备份, dshconfig=DSH运行配置采集。省略或空=全部。',
    },
    skills: {
      type: 'array',
      items: { type: 'string' },
      description: '只上传这些技能 (按技能名), 省略=全部技能。仅当 categories 含 skills 时有效。',
    },
    sessions: {
      type: 'array',
      items: { type: 'string' },
      description: '只上传这些会话工作区 (按工作区名), 省略=全部。仅当 categories 含 sessions 时有效。',
    },
    dshconfig: {
      type: 'boolean',
      description: 'true=同时采集本机 DSH 运行配置 (profile 的 package.json/cordis.patch.yml + gitconfig) 一起上传。',
    },
    message: {
      type: 'string',
      description: '提交说明 (英文或中文均可, 会进 git log)',
    },
  },
  additionalProperties: false,
}

const PULL_PARAMS = {
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      items: { type: 'string', enum: ['memory', 'skills', 'config', 'plugins', 'sessions', 'dshconfig'] },
      description: '六类拉取范围: memory=记忆, skills=技能, config=配置, plugins=插件清单, sessions=会话备份, dshconfig=DSH运行配置写回。省略或空=全部。',
    },
    skills: {
      type: 'array',
      items: { type: 'string' },
      description: '只拉取这些技能 (按技能名), 省略=全部技能。仅当 categories 含 skills 时有效。',
    },
    sessions: {
      type: 'array',
      items: { type: 'string' },
      description: '只恢复这些会话工作区 (按工作区名), 省略=全部。仅当 categories 含 sessions 时有效。',
    },
    dshconfigWriteBack: {
      type: 'boolean',
      description: 'true=把中枢里采集的 DSH 运行配置写回本机 (需同机身份三重校验通过)。',
    },
    machineId: {
      type: 'string',
      description: '会话恢复来源机器标记 (session-backup/<machineId>/)。省略时由后端自动取本机标记。',
    },
    force: {
      type: 'boolean',
      description: 'true=强制覆盖本地改动 (慎用)',
    },
  },
  additionalProperties: false,
}

function tail(s, max = 6000) {
  const str = String(s ?? '')
  if (str.length <= max) return str
  return '...(truncated)\n' + str.slice(-max)
}

const ALL_CATEGORIES = ['memory', 'skills', 'config', 'plugins', 'sessions', 'dshconfig']

/** 把前端传来的 categories（bool 对象或数组）规整成合法的 -What 取值数组。 */
function normalizeCategories(cats) {
  if (Array.isArray(cats)) {
    return cats.filter((c) => ALL_CATEGORIES.includes(String(c).toLowerCase()))
  }
  if (cats && typeof cats === 'object') {
    return ALL_CATEGORIES.filter((c) => cats[c])
  }
  return []
}

/** 把 skills/sessions 选择（数组或逗号串）规整成 push.ps1 -Skills 用的 CSV。 */
function toCsv(v) {
  if (Array.isArray(v)) {
    return v.map((s) => String(s).trim().toLowerCase()).filter(Boolean).join(',')
  }
  if (typeof v === 'string') {
    return v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).join(',')
  }
  return ''
}

/** 读取本机 sync-hub 机器标记（session 备份 -From 的 mid），不存在返回 ''。 */
function readMachineId() {
  try {
    const dsh = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    const p = path.join(dsh, '.sync-hub-machine')
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim()
  } catch { /* noop */ }
  return ''
}

function quote(s) {
  const str = String(s)
  // PowerShell parameter names must NOT be quoted: '-Install' quoted becomes a
  // positional string argument, so the named parameter silently stops binding
  // (symptom: "[WARN] unknown tool key: -Install"). Bare -Word stays verbatim.
  if (/^-[A-Za-z][A-Za-z0-9]*$/.test(str)) return str
  return "'" + str.replace(/'/g, "''") + "'"
}

/** Run a tools/*.ps1 script; resolves { code, out } with UTF-8 console output.
 *  opts.timeoutMs kills a hung child (code -3) so the card never blocks forever. */
function runPs(hub, file, args, exec, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 0
  return new Promise((resolve) => {
    const scriptPath = path.join(hub, 'tools', file)
    const argList = (args || []).map(quote).join(' ')
    const command =
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
      '& ' + quote(scriptPath) + (argList ? ' ' + argList : '') + '; exit $LASTEXITCODE'
    let child
    try {
      child = spawn('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { cwd: hub, windowsHide: true })
    } catch (e) {
      resolve({ code: -1, out: String(e) })
      return
    }
    let out = ''
    let aborted = false
    let timedOut = false
    let timer = null
    if (timeoutMs > 0) {
      timer = setTimeout(() => { timedOut = true; try { child.kill() } catch { /* gone */ } }, timeoutMs)
    }
    child.stdout.on('data', (d) => { out += d.toString('utf8') })
    child.stderr.on('data', (d) => { out += d.toString('utf8') })
    const onAbort = () => { aborted = true; try { child.kill() } catch { /* already gone */ } }
    const signal = exec && exec.signal
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    child.on('error', (e) => resolve({ code: -1, out: out + String(e) }))
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (signal) { try { signal.removeEventListener('abort', onAbort) } catch { /* noop */ } }
      resolve({ code: timedOut ? -3 : aborted ? -2 : (code === null ? -1 : code), out })
    })
  })
}

function runGit(hub, gitArgs, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', hub, ...gitArgs], {
      cwd: hub, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    })
    let out = ''
    let timedOut = false
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; try { child.kill() } catch { /* gone */ } }, timeoutMs) : null
    child.stdout.on('data', (d) => { out += d.toString('utf8') })
    child.stderr.on('data', (d) => { out += d.toString('utf8') })
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: -1, out: String(e) }) })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: timedOut ? -3 : (code === null ? -1 : code), out })
    })
  })
}

function result(ok, code, text) {
  return { ok: !!ok, code: Number(code), text: String(text ?? '') }
}

/**
 * Trust fence for the settings API, mirroring the kernel's isTrustedApiRequest
 * shape (cf. dsh-our-free-model src/trust.js structuralReason):
 *   - Host must be loopback (DNS-rebinding defence);
 *   - Sec-Fetch-Site: cross-site is refused;
 *   - Origin/Referer must match the Host authority, EXCEPT the desktop relay:
 *     the dsh-app://app page forwards fetches to loopback HTTP with a
 *     dsh-app://app Referer and no Origin / no Sec-Fetch-* markers.
 * A raw LAN caller (or a malicious web page) matches none of these and gets 403.
 */
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function authorityOf(value, defaultScheme) {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url
  try {
    url = new URL(value.includes('://') ? value.trim() : `${defaultScheme ?? 'http'}://${value.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  return { scheme: url.protocol.replace(':', ''), hostname: url.hostname.toLowerCase(), port }
}

function isDesktopRelayReferer(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && url.port === ''
      && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function trustedRequest(req) {
  const host = authorityOf(req.headers['host'], 'http')
  if (host === null || !LOOPBACK_NAMES.has(host.hostname)) return false
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') return false
  for (const header of ['origin', 'referer']) {
    const raw = req.headers[header]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    if (header === 'referer' && isDesktopRelayReferer(raw)) {
      // the desktop relay strips browser markers but keeps this Referer;
      // if markers are present it is NOT the relay
      if (req.headers['origin'] !== undefined || req.headers['sec-fetch-site'] !== undefined) return false
      continue
    }
    const authority = authorityOf(raw.trim())
    if (authority === null) return false
    if (authority.scheme !== host.scheme || authority.hostname !== host.hostname || authority.port !== host.port) return false
  }
  return true
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 65536) { try { req.destroy() } catch { /* noop */ } } })
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })
}

/**
 * Parse a PowerShell console report into structured rows so the card can draw
 * real UI instead of dumping terminal text. Understands the [PASS]/[FAIL]/
 * [WARN]/[INFO] convention from _lib.ps1 plus "── section ──" headers.
 */
function parseReport(text) {
  const sections = []
  let current = { title: '', items: [] }
  const push = () => { if (current.title || current.items.length) sections.push(current) }
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim()) continue
    const head = /^\s*[─-]{2,}\s*(.+?)\s*[─-]{2,}\s*$/.exec(line)
    if (head) { push(); current = { title: head[1].trim(), items: [] }; continue }
    const tag = /^\s*\[(PASS|FAIL|WARN|INFO|OK)\]\s*(.*)$/.exec(line)
    if (tag) {
      current.items.push({ level: tag[1].toLowerCase(), text: tag[2].trim() })
      continue
    }
    // A plain indented line is its OWN item: the console prints one fact per
    // line ("机器标识 home" / "中枢路径 D:\..."), so merging them into the
    // previous item produced a single unreadable blob in the card.
    current.items.push({ level: 'note', text: line.trim() })
  }
  push()
  return sections
}

/** Worst level in a section, for a traffic-light dot. */
function worstLevel(items) {
  const rank = { fail: 3, warn: 2, info: 1, pass: 0, ok: 0, note: 0 }
  let worst = 'pass'
  for (const it of items) if ((rank[it.level] ?? 0) > (rank[worst] ?? 0)) worst = it.level
  return worst
}

/** Parse backup.ps1 -List output into clickable rows. */
function parseBackups(text) {
  const items = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*\[(\d+)\]\s+(\S+)\s+([\d.]+\s*\w+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/.exec(line)
    if (m) items.push({ index: Number(m[1]), name: m[2], size: m[3].replace(/\s+/g, ''), date: m[4] })
  }
  return items
}

/** Parse the toolchain JSON emitted by tools.ps1 -Json. */
function parseTools(out) {
  const raw = String(out ?? '')
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try { return JSON.parse(raw.slice(start, end + 1)) } catch { return [] }
}

/** Ask git for the stored credential for a host. Returns username ONLY; the
 *  password stays inside the child process and is never returned upward. */
function probeGiteeCredential(repoHost) {
  return new Promise((resolve) => {
    const child = spawn('git', ['credential', 'fill'], {
      cwd: os.tmpdir(), windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString('utf8') })
    child.on('error', () => resolve({ ok: false, user: '', err: 'git missing' }))
    child.on('close', (code) => {
      if (code !== 0) { resolve({ ok: false, user: '' }); return }
      const m = /username=(.+)/.exec(out)
      resolve({ ok: true, user: m ? m[1].trim() : '' })
    })
    child.stdin.write('protocol=https\nhost=' + repoHost + '\n\n')
    child.stdin.end()
  })
}

function saveGiteeCredential(repoHost, username, token) {
  return new Promise((resolve) => {
    const child = spawn('git', ['credential', 'approve'], {
      cwd: os.tmpdir(), windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    })
    child.on('error', (e) => resolve({ ok: false, err: String(e.message ?? e) }))
    child.on('close', (code) => resolve({ ok: code === 0 }))
    child.stdin.write('protocol=https\nhost=' + repoHost + '\nusername=' + username + '\npassword=' + token + '\n\n')
    child.stdin.end()
  })
}

function rejectGiteeCredential(repoHost, username) {
  return new Promise((resolve) => {
    const child = spawn('git', ['credential', 'reject'], {
      cwd: os.tmpdir(), windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    })
    child.on('error', () => resolve({ ok: false }))
    child.on('close', (code) => resolve({ ok: code === 0 }))
    child.stdin.write('protocol=https\nhost=' + repoHost + '\nusername=' + username + '\n\n')
    child.stdin.end()
  })
}

const GITEE_HOST = 'gitee.com'

/** The settings-card backend: { path: handler } under /api/sync-hub. */
async function apiHandler(req, res, config) {
  const send = (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const routePath = url.pathname.replace(/^\/api\/sync-hub/, '').replace(/\/+$/, '') || '/'
  const method = String(req.method ?? 'GET').toUpperCase()
  if (!trustedRequest(req)) return send(403, { error: 'untrusted origin' })
  const hub = resolveHub(config)
  if (!hub) return send(200, { ok: false, notFound: true, code: -1, text: 'sync-hub 未在本机找到。新机器请先运行 tools/install-plugin.ps1（克隆中枢 + 安装插件 + 布线 profile），完成后重启 DSH；已有中枢可在 config.hubPath 指定路径。' })
  try {
    // shared one-shot runner for the card's tool routes (kills a hung child)
    const run = async (file, args, ms) => {
      const r = await runPs(hub, file, args || [], null, { timeoutMs: ms || 120000 })
      return send(200, result(r.code === 0, r.code, tail(r.out, 20000) || '(no output)'))
    }
    if (method === 'GET' && routePath === '/info') {
      const ver = fs.readFileSync(path.join(hub, 'VERSION'), 'utf8').trim()
      const log = await runGit(hub, ['log', '-1', '--format=%h|%ci|%s'])
      const st = await runGit(hub, ['status', '--porcelain'])
      // 同 /overview：技能数按真实口径（含 SKILL.md 才算），空壳单列
      let skills = 0, skillsShell = 0
      try {
        const ents = fs.readdirSync(path.join(hub, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory())
        for (const d of ents) {
          if (fs.existsSync(path.join(hub, 'skills', d.name, 'SKILL.md'))) skills++
          else skillsShell++
        }
      } catch { /* noop */ }
      let machineId = ''
      try { machineId = fs.readFileSync(path.join(os.homedir(), '.dsh', '.sync-hub-machine'), 'utf8').trim() } catch { /* unset */ }
      const [commit, date, subject] = log.code === 0 ? String(log.out).trim().split('|') : ['', '', '']
      return send(200, {
        ok: true, version: ver, commit, commitDate: date, commitSubject: subject,
        dirty: st.code === 0 ? st.out.trim().split('\n').filter(Boolean).length : -1,
        skills, skillsShell, hubPath: hub, machine: os.hostname(), machineId,
      })
    }
    if (method === 'GET' && routePath === '/status') {
      const r = await runPs(hub, 'status.ps1', [], null, { timeoutMs: 90000 })
      const sections = parseReport(r.out)
      return send(200, {
        ok: r.code === 0, code: r.code, text: tail(r.out, 20000),
        sections, worst: sections.length ? worstLevel(sections.flatMap((s) => s.items)) : 'pass',
      })
    }
    // One round trip for the whole overview: the card used to fire three
    // requests on mount (info + cred + tools), and /tools alone takes ~2s.
    if (method === 'GET' && routePath === '/overview') {
      const [infoR, credR, toolsR, statusR] = await Promise.all([
        (async () => {
          const ver = fs.readFileSync(path.join(hub, 'VERSION'), 'utf8').trim()
          const log = await runGit(hub, ['log', '-1', '--format=%h|%ci|%s'], 20000)
          const st = await runGit(hub, ['status', '--porcelain'], 20000)
          // 上游落后多少、本地领先多少：前者=该 pull，后者=该 push（截图曾出现
          // "完全同步"绿条却带着 5 个未提交文件，因为老代码只看 HEAD vs origin）
          const ahead = await runGit(hub, ['rev-list', '--count', '@{u}..HEAD'], 20000)
          const behind = await runGit(hub, ['rev-list', '--count', 'HEAD..@{u}'], 20000)
          const aheadN = ahead.code === 0 ? parseInt(ahead.out.trim(), 10) || 0 : -1
          const behindN = behind.code === 0 ? parseInt(behind.out.trim(), 10) || 0 : -1
          // 技能统计：目录数 != 技能数。旧实现只数目录，把"删剩的空壳"和
          // skillhub 的 @org-xxx/@user_xxx 占位壳也算成技能，导致两边数字对不上。
          // 这里统一按真实口径分三类返回，卡片照原样展示，不做二次猜测。
          let skills = 0, skillsShell = 0
          try {
            const ents = fs.readdirSync(path.join(hub, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory())
            for (const d of ents) {
              if (fs.existsSync(path.join(hub, 'skills', d.name, 'SKILL.md'))) skills++
              else skillsShell++
            }
          } catch { /* noop */ }
          // 本机技能侧（供卡片做"本机 vs 中枢"对照），同样按真实口径
          let localSkills = 0, localPlaceholder = 0, localShell = 0
          try {
            const lroot = path.join(os.homedir(), '.dsh', 'skills')
            const ents = fs.readdirSync(lroot, { withFileTypes: true }).filter((d) => d.isDirectory())
            for (const d of ents) {
              const real = fs.existsSync(path.join(lroot, d.name, 'SKILL.md'))
              if (real) localSkills++
              else if (/^@(org|user)[-_]/i.test(d.name)) localPlaceholder++
              else localShell++
            }
          } catch { /* noop */ }
          // 机器标识（apply.ps1 写入）与本机真实主机名，两者可能不同，一起给出
          let machineId = ''
          try { machineId = fs.readFileSync(path.join(os.homedir(), '.dsh', '.sync-hub-machine'), 'utf8').trim() } catch { /* unset */ }
          // 当前 DSH profile（desktop / web …）
          let profile = ''
          try {
            const pdir = path.join(os.homedir(), '.dsh', 'profiles')
            const names = fs.readdirSync(pdir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
            if (names.includes('desktop')) profile = 'desktop'
            else if (names.length === 1) profile = names[0]
            else if (names.length) profile = names.join(', ')
          } catch { /* noop */ }
          const [commit, date, subject] = log.code === 0 ? String(log.out).trim().split('|') : ['', '', '']
          const dirtyLines = st.code === 0 ? st.out.trim().split('\n').filter(Boolean) : []
          return {
            ok: true, version: ver, commit, commitDate: date, commitSubject: subject,
            dirty: st.code === 0 ? dirtyLines.length : -1,
            dirtyFiles: dirtyLines.slice(0, 12).map((l) => l.trim()),
            ahead: aheadN, behind: behindN,
            skills, skillsShell, localSkills, localPlaceholder, localShell,
            hubPath: hub, machine: os.hostname(), machineId, profile,
            node: process.version, platform: process.platform + ' ' + (os.release() || ''),
          }
        })(),
        (async () => {
          const remoteRes = await runGit(hub, ['remote', 'get-url', 'origin'], 20000)
          let host = 'gitee.com'
          try { if (remoteRes.code === 0 && remoteRes.out.trim()) host = new URL(remoteRes.out.trim()).host } catch { /* default */ }
          const probe = await probeGiteeCredential(host)
          return { ok: true, repoHost: host, repoUrl: remoteRes.code === 0 ? remoteRes.out.trim() : '', hasCredential: probe.ok, username: probe.ok ? probe.user : '' }
        })(),
        (async () => {
          const r = await runPs(hub, 'tools.ps1', ['-Json'], null, { timeoutMs: 90000 })
          const list = parseTools(r.out)
          return { tools: list, present: list.filter((x) => x.Present).length, total: list.length, missingCore: list.filter((x) => !x.Present && x.Need === 'core').length }
        })(),
        (async () => {
          const r = await runPs(hub, 'status.ps1', [], null, { timeoutMs: 90000 })
          const sections = parseReport(r.out)
          return { sections, worst: sections.length ? worstLevel(sections.flatMap((s) => s.items)) : 'pass' }
        })(),
      ])
      return send(200, { ok: true, info: infoR, cred: credR, tools: toolsR, status: statusR })
    }
    // Recent DSH log files + tail. Read-only. ?file=<name> selects a
    // specific file (must be one of the enumerated names — path-traversal
    // safe because we only match against the directory listing).
    if (method === 'GET' && routePath === '/logs') {
      const dir = path.join(os.homedir(), 'AppData', 'Roaming', '@deepseek-ai', 'dsh-desktop', 'logs')
      let files = []
      try {
        files = fs.readdirSync(dir).map((n) => {
          const p = path.join(dir, n)
          const st = fs.statSync(p)
          return { name: n, mtime: st.mtimeMs, size: st.size }
        }).sort((a, b) => b.mtime - a.mtime).slice(0, 10)
      } catch { /* no logs */ }
      const reqName = String(url.searchParams.get('file') || '')
      const current = (reqName && files.some((f) => f.name === reqName)) ? reqName : (files.length ? files[0].name : '')
      let tailText = ''
      if (current) {
        try {
          const raw = fs.readFileSync(path.join(dir, current), 'utf8')
          tailText = raw.split(/\r?\n/).slice(-120).join('\n')
        } catch { /* unreadable */ }
      }
      return send(200, { ok: true, dir, files, current, tail: tailText })
    }
    // Sync-hub usage manual (hub root 使用手册.md, fallback README.md). Read-only.
    if (method === 'GET' && routePath === '/manual') {
      let text = '', name = ''
      for (const cn of ['使用手册.md', 'README.md']) {
        const p = path.join(hub, cn)
        if (fs.existsSync(p)) {
          try { text = fs.readFileSync(p, 'utf8'); name = cn; break } catch { /* noop */ }
        }
      }
      if (!text) return send(200, { ok: false, code: -1, text: '未找到 使用手册.md / README.md' })
      return send(200, { ok: true, name, text })
    }
    if (method === 'POST' && routePath === '/push') {
      const body = await readJsonBody(req)
      const pass = []
      // Six-category push (方案 A 增强): categories[] drives push.ps1 -What;
      // skills[]/sessions[] narrow per-item; dshconfig also flips the
      // -DshConfig collector switch (captures LIVE DSH run-config). Empty /
      // absent categories = whole hub (legacy 'all').
      const cats = normalizeCategories(body.categories)
      const skillsSel = toCsv(body.skills)
      const sessionsSel = toCsv(body.sessions)
      if (cats.length) pass.push('-What', cats.join(','))
      if (skillsSel) pass.push('-Skills', skillsSel)
      if (sessionsSel) pass.push('-Sessions', sessionsSel)
      if (body.dshconfig) pass.push('-DshConfig')
      const message = typeof body.message === 'string' ? body.message.trim() : ''
      if (message) pass.push('-Message', message)
      // Backing-up session history is a separate read-only step that must run
      // BEFORE the git push so the hub carries the newest conversations.
      if (cats.includes('sessions')) {
        await runPs(hub, 'backup-sessions.ps1', ['-Backup', '-IncludeInGit']
          .concat(sessionsSel ? ['-Sessions', sessionsSel] : []), null, { timeoutMs: 600000 })
      }
      // 预演（不提交不推送，只报告会推什么）+ 真实推送（带结构化回执）。
      // DryRun 走 push.ps1 -DryRun；真实推送解析 PUSHRCPT_* 行转成结构化结果。
      if (body.dryRun) {
        const pass2 = ['-DryRun'].concat(body.categories ? ['-What', normalizeCategories(body.categories).join(',')] : [])
        const d = await runPs(hub, 'push.ps1', pass2, null, { timeoutMs: 300000 })
        const files = []
        let scope = '', bytes = 0
        for (const line of String(d.out).split(/\r?\n/)) {
          const m = line.match(/^DRYRUN_FILE=(.+)$/)
          if (m) files.push(m[1].trim())
          else if (/^DRYRUN_SCOPE=/.test(line)) scope = line.split('=')[1] || ''
          else if (/^DRYRUN_BYTES=/.test(line)) bytes = Number(line.split('=')[1] || 0)
        }
        return send(200, {
          ok: d.code === 0, code: d.code, dryRun: true,
          files, fileCount: files.length, bytes, scope,
          text: files.length
            ? ('将推送 ' + files.length + ' 个文件（' + (bytes > 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B') + '）：\n' + files.join('\n'))
            : '所选范围内没有可推送的改动。',
        })
      }
      const pr = await runPs(hub, 'push.ps1', pass, null, { timeoutMs: 300000 })
      // 解析 push.ps1 的结构化回执，让卡片能显示"推了几个文件/哪个 commit"
      let receipt = null
      {
        const files = []
        let commit = '', subject = ''
        for (const line of String(pr.out).split(/\r?\n/)) {
          if (/^PUSHRCPT_FILE=/.test(line)) files.push(line.slice('PUSHRCPT_FILE='.length).trim())
          else if (/^PUSHRCPT_COMMIT=/.test(line)) commit = line.split('=').slice(1).join('=').trim()
          else if (/^PUSHRCPT_SUBJECT=/.test(line)) subject = line.split('=').slice(1).join('=').trim()
        }
        if (commit || files.length) receipt = { commit, subject, files, fileCount: files.length }
      }
      return send(200, { ...result(pr.code === 0, pr.code, tail(pr.out, 20000)), receipt })
    }
    if (method === 'POST' && routePath === '/pull') {
      const body = await readJsonBody(req)
      const pass = []
      if (body.skipSkills) pass.push('-SkipSkills')
      if (body.skipProfile) pass.push('-SkipProfile')
      if (body.force) pass.push('-Force')
      // Six-category pull: translate to pull.ps1 -What (memory/skills/config
      // also feed apply.ps1 -Skip*); sessions is git-only. dshconfig write-back
      // is gated behind an explicit confirmation flag (see apply.ps1).
      const cats = normalizeCategories(body.categories)
      const skillsSel = toCsv(body.skills)
      if (cats.length) pass.push('-What', cats.join(','))
      if (skillsSel) pass.push('-Skills', skillsSel)
      if (body.dshconfigWriteBack) pass.push('-DshConfigWriteBack')
      const r = await runPs(hub, 'pull.ps1', pass, null, { timeoutMs: 300000 })
      // On a merge conflict (exit 2) enumerate the conflicting files so the
      // card can render them as a structured list instead of raw log soup.
      let conflictFiles = []
      if (r.code === 2) {
        try {
          const u = await runGit(hub, ['diff', '--name-only', '--diff-filter=U'], 20000)
          if (u.code === 0) conflictFiles = u.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        } catch { /* noop */ }
      }
      // Restoring session history is a separate step that runs AFTER the git
      // pull brought the latest session-backup/<machine>/ down.
      if (cats.includes('sessions') && r.code === 0) {
        const from = typeof body.machineId === 'string' ? body.machineId.trim() : ''
        const restoreArgs = ['-Restore'].concat(from ? ['-From', from] : [])
          .concat(skillsSel ? [] : [])
          .concat(sessionsSel ? ['-Sessions', sessionsSel] : [])
        await runPs(hub, 'backup-sessions.ps1', restoreArgs, null, { timeoutMs: 600000 })
      }
      return send(200, { ...result(r.code === 0, r.code, tail(r.out, 20000)), conflictFiles })
    }
    // manual snapshot: the "back up now" the card was missing
    if (method === 'POST' && routePath === '/backup/create') {
      const r = await runPs(hub, 'backup.ps1', ['-Create'], null, { timeoutMs: 90000 })
      return send(200, result(r.code === 0, r.code, tail(r.out, 20000)))
    }
    // delete ONE backup file (guarded on the backend too: no separators / "..")
    if (method === 'POST' && routePath === '/backup/delete') {
      const body = await readJsonBody(req)
      const name = (body && body.name) || ''
      if (/[\\/]|\.\./.test(name)) return send(200, result(false, -1, 'invalid backup name'))
      const r = await runPs(hub, 'backup.ps1', ['-Delete', name], null, { timeoutMs: 60000 })
      return send(200, result(r.code === 0, r.code, tail(r.out, 20000)))
    }
    // timed sync via Windows Task Scheduler (code-only; cannot truly run on every host)
    if (routePath === '/schedule') {
      if (method === 'GET') {
        const r = await runPs(hub, 'schedule.ps1', ['-Status'], null, { timeoutMs: 30000 })
        const installed = /scheduled task present/i.test(r.out)
        const next = (r.out.match(/next\s*:\s*(.+)/i) || [])[1] || ''
        return send(200, { ok: true, installed, next: next.trim(), text: tail(r.out, 4000) })
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        const action = (body && body.action) || 'install'
        const r = await runPs(hub, 'schedule.ps1', ['-' + (action === 'remove' ? 'Remove' : 'Install')], null, { timeoutMs: 60000 })
        return send(200, result(r.code === 0, r.code, tail(r.out, 20000)))
      }
    }
    if (method === 'POST' && routePath === '/console') {
      const bat = path.join(hub, '同步中枢.bat')
      if (!fs.existsSync(bat)) return send(200, result(false, -1, 'launcher missing: ' + bat))
      const child = spawn('cmd.exe', ['/d', '/c', 'start', '""', '"' + bat + '"'], {
        cwd: hub, detached: true, stdio: 'ignore', windowsHide: false,
      })
      child.unref()
      return send(200, result(true, 0, 'console opened: ' + bat))
    }
    // ── Gitee credential (git-based auth; the token is write-only: stored into
    //    the Windows Credential Manager via `git credential approve` and NEVER
    //    returned to the client) ────────────────────────────────────────────────
    if (method === 'GET' && routePath === '/cred') {
      const remoteRes = await runGit(hub, ['remote', 'get-url', 'origin'])
      let host = 'gitee.com'
      try {
        if (remoteRes.code === 0 && remoteRes.out.trim()) host = new URL(remoteRes.out.trim()).host
      } catch { /* keep default host */ }
      const probe = await probeGiteeCredential(host)
      return send(200, {
        ok: true, repoHost: host,
        repoUrl: remoteRes.code === 0 ? remoteRes.out.trim() : '',
        hasCredential: probe.ok, username: probe.ok ? probe.user : '',
      })
    }
    if (method === 'POST' && routePath === '/cred') {
      const body = await readJsonBody(req)
      const username = String(body.username ?? '').trim()
      const token = String(body.token ?? '')
      if (!username || !token) return send(200, result(false, -1, 'username + token are both required'))
      const remoteRes = await runGit(hub, ['remote', 'get-url', 'origin'])
      let host = 'gitee.com'
      try {
        if (remoteRes.code === 0 && remoteRes.out.trim()) host = new URL(remoteRes.out.trim()).host
      } catch { /* keep default host */ }
      const saved = await saveGiteeCredential(host, username, token)
      // read back to confirm the manager actually accepted the secret
      const probe = await probeGiteeCredential(host)
      const remoteUrl = remoteRes.code === 0 && remoteRes.out.trim() ? remoteRes.out.trim() : ('https://' + host + '/')
      const reach = await runGit(hub, ['ls-remote', '--heads', remoteUrl])
      const lines = reach.code === 0 ? reach.out.trim().split('\n').filter(Boolean).length : 0
      return send(200, result(saved.ok && probe.ok, saved.ok ? 0 : -1,
        (saved.ok && probe.ok ? 'credential stored (user=' + probe.user + ')' : 'store failed: ' + (saved.err ?? '')) +
        (reach.code === 0 ? '  ·  ' + host + ' reachable' : '  ·  repo not reachable yet (see shared 4.12)')))
    }
    // ── the 6 menu features, now on the card (all non-interactive) ────────────
    if (method === 'POST' && routePath === '/doctor') {
      const body = await readJsonBody(req)
      return run('doctor.ps1', body.fix ? ['-Fix'] : [], 180000)
    }
    if (method === 'POST' && routePath === '/net') {
      return run('troubleshoot.ps1', ['-Net'], 120000)
    }
    if (method === 'GET' && routePath === '/backups') {
      const r = await runPs(hub, 'backup.ps1', ['-List'], null, { timeoutMs: 60000 })
      return send(200, {
        ok: r.code === 0, code: r.code, text: tail(r.out, 20000),
        items: parseBackups(r.out),
      })
    }
    // Skill diff detail: which skills are hub-only / local-only / different.
    if (method === 'GET' && routePath === '/skills') {
      const hubSkills = path.join(hub, 'skills')
      const localSkills = path.join(os.homedir(), '.dsh', 'skills')
      const list = (dir) => {
        try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { return [] }
      }
      const h1 = list(hubSkills)
      const l1 = list(localSkills)
      const onlyHub = h1.filter((n) => !l1.includes(n))
      const onlyLocal = l1.filter((n) => !h1.includes(n))
      const diff = []
      // Load each skill's frontmatter `description` so the sync card can render a
      // collapsible list with per-skill notes (see client renderMulti descOf).
      const describe = (dir, n) => {
        try {
          const raw = fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8')
          const m = raw.match(/description:\s*(.+?)\s*$/im)
          let s = m ? m[1].replace(/^['"]|['"]$/g, '').trim() : ''
          if (s.length > 120) s = s.slice(0, 120) + '…'
          return s
        } catch { return '' }
      }
      // Names like "@org-xxxx" / "@user_xxxx" are auto-generated placeholders,
      // not real skills: flag them so the user can tell noise from real work.
      const junk = (n) => /^@(org|user)[-_]/i.test(n)
      const onlyHubInfo = onlyHub.map((n) => ({ name: n, description: describe(hubSkills, n) }))
      const onlyLocalInfo = onlyLocal.map((n) => ({
        name: n, description: describe(localSkills, n),
        junk: junk(n), disabled: /\.disabled$/.test(n),
      }))
      for (const n of h1) {
        if (!l1.includes(n)) continue
        try {
          const a = fs.readFileSync(path.join(hubSkills, n, 'SKILL.md'), 'utf8')
          const b = fs.readFileSync(path.join(localSkills, n, 'SKILL.md'), 'utf8')
          if (a !== b) diff.push(n)
        } catch { /* treat unreadable as same */ }
      }
      // Names like "@org-xxxx" / "@user_xxxx" are auto-generated placeholders,
      // not real skills: flag them so the user can tell noise from real work.
      return send(200, {
        ok: true, hub: h1.length, local: l1.length, onlyHub: onlyHubInfo, onlyLocal: onlyLocalInfo, diff,
        onlyLocalReal: onlyLocal.filter((n) => !junk(n)),
        onlyLocalJunk: onlyLocal.filter(junk),
      })
    }
    if (method === 'POST' && routePath === '/restore') {
      const body = await readJsonBody(req)
      let name = String(body.name ?? '').trim()
      // "latest-agents" / "latest-profile:desktop" shortcuts so the user never
      // has to copy a 40-char file name out of the list.
      if (name === 'latest-agents') return run('backup.ps1', ['-Restore', 'AGENTS'], 60000)
      if (name.startsWith('latest-profile:')) {
        const prof = name.slice('latest-profile:'.length).trim()
        if (!/^[a-z0-9-]+$/i.test(prof)) return send(200, result(false, -1, 'invalid profile name'))
        return run('backup.ps1', ['-Restore', 'profile', '-Name', prof], 60000)
      }
      if (!name) return send(200, result(false, -1, 'name is required (pick a row or use latest-agents)'))
      if (/[\\/]|\.\./.test(name)) return send(200, result(false, -1, 'invalid backup name'))
      return run('backup.ps1', ['-Restore', name], 60000)
    }
    // One-key self check: the few things that actually break a machine,
    // answered as a checklist the card can render directly.
    if (method === 'GET' && routePath === '/selfcheck') {
      const checks = []
      const add = (key, level, detail) => checks.push({ key, level, detail })
      // git + remote
      const remote = await runGit(hub, ['remote', 'get-url', 'origin'], 15000)
      add('remote', remote.code === 0 && remote.out.trim() ? 'pass' : 'fail', remote.code === 0 ? remote.out.trim() : 'no origin remote')
      // credential
      let host = 'gitee.com'
      try { if (remote.out.trim()) host = new URL(remote.out.trim()).host } catch { /* default */ }
      const cred = await probeGiteeCredential(host)
      add('credential', cred.ok ? 'pass' : 'warn', cred.ok ? ('stored (user=' + cred.user + ')') : 'not stored — push/clone will fail')
      // reachability
      const reach = await runGit(hub, ['ls-remote', '--heads', remote.out.trim() || 'origin'], 30000)
      add('reachable', reach.code === 0 ? 'pass' : 'fail', reach.code === 0 ? (host + ' reachable') : 'cannot reach remote (see shared 4.12)')
      // working tree
      const st = await runGit(hub, ['status', '--porcelain'], 20000)
      const dirty = st.out.trim() ? st.out.trim().split('\n').length : 0
      add('tree', dirty === 0 ? 'pass' : 'warn', dirty === 0 ? 'clean' : (dirty + ' uncommitted change(s)'))
      // identity marker
      const marker = path.join(os.homedir(), '.dsh', '.sync-hub-machine')
      let machine = ''
      try { machine = fs.readFileSync(marker, 'utf8').trim() } catch { /* unset */ }
      add('identity', machine ? 'pass' : 'warn', machine ? ('machine = ' + machine) : 'machine id not set (run apply)')
      // plugin half
      add('plugin', 'pass', 'tools + settings card loaded')
      // toolchain core
      const tr = await runPs(hub, 'tools.ps1', ['-Json'], null, { timeoutMs: 90000 })
      const list = parseTools(tr.out)
      const missingCore = list.filter((x) => !x.Present && x.Need === 'core')
      add('toolchain', missingCore.length ? 'fail' : (list.filter((x) => !x.Present).length ? 'warn' : 'pass'),
        missingCore.length ? ('missing core: ' + missingCore.map((x) => x.Key).join(', '))
          : (list.filter((x) => !x.Present).length + ' optional missing'))
      return send(200, { ok: !checks.some((c) => c.level === 'fail'), checks })
    }
    if (method === 'POST' && routePath === '/skills') {
      const body = await readJsonBody(req)
      const dir = String(body.dir ?? '').trim()
      if (dir === 'tohub') return run('skills-market.ps1', ['-ToHub'], 120000)
      if (dir === 'fromhub') return run('skills-market.ps1', ['-FromHub'], 120000)
      // 从云端仓库删除一个技能（保留 git 历史，非硬清物理文件于其他机）。
      // 必须显式带 action:'hubdelete' + name，且做路径穿越校验。绝不静默删。
      if (String(body.action ?? '').trim() === 'hubdelete') {
        const name = String(body.name ?? '').trim()
        if (!name) return send(200, result(false, -1, 'name required'))
        // 拒绝任何路径穿越 / 上级引用 / 分隔符
        if (/[\\/]|\.\./.test(name) || !/^[^\\/]+$/.test(name)) {
          return send(200, result(false, -1, 'invalid skill name'))
        }
        const skillDir = path.join(hub, 'skills', name)
        if (!fs.existsSync(skillDir)) {
          return send(200, result(false, -1, 'skill not found in hub: ' + name))
        }
        // 1) 从 git 跟踪中移除（停止追踪 + 删除工作树，仅限本仓库内）
        const rm = await runGit(hub, ['rm', '-r', '--force', path.join('skills', name)], 60000)
        if (rm.code !== 0) return send(200, result(false, -1, 'git rm failed: ' + rm.out))
        // 2) 提交（不自动 push —— 与「云端文件」编辑保存同一心智：上传由用户显式点推送）
        const commit = await runGit(hub, ['commit', '-m', 'remove skill ' + name + ' from hub (delete)'], 60000)
        if (commit.code !== 0) {
          // 没有可提交内容时也算成功（理论上不会，因 rm 必有改动）
          const undo = await runGit(hub, ['reset', '--', path.join('skills', name)], 30000)
          return send(200, result(false, -1, 'git commit failed: ' + commit.out + (undo.code === 0 ? ' (rolled back)' : '')))
        }
        // 只提交不推送：结果里明确告知，避免"以为删了其实没删"
        return send(200, result(true, 0, '云端技能已删除并本地提交（未推送）。请点「上传备份/推送」，另一台机器下次拉取后才会同样删除。'))
      }
      // 把【单个】本地技能上传到云端仓库（hubdelete 的正向对照：一个删、一个补）。
      // 只复制该技能目录进 hub/skills/<name> 并 commit（不自动 push），绝不覆盖同名内容。
      if (String(body.action ?? '').trim() === 'pushsingle') {
        const name = String(body.name ?? '').trim()
        if (!name) return send(200, result(false, -1, 'name required'))
        if (/[\\/]|\.\./.test(name) || !/^[^\\/]+$/.test(name)) {
          return send(200, result(false, -1, 'invalid skill name'))
        }
        // 本地根取 DSH 的实际技能目录（含 .disabled 形式：名字带 .disabled 也算合法目录名）
        const localSkills = path.join(os.homedir(), '.dsh', 'skills', name)
        if (!fs.existsSync(localSkills) || !fs.statSync(localSkills).isDirectory()) {
          return send(200, result(false, -1, 'local skill not found: ' + name))
        }
        const hubDir = path.join(hub, 'skills', name)
        if (fs.existsSync(hubDir)) {
          return send(200, result(false, -1, '云端已存在同名技能 ' + name + '（不会覆盖）。若内容不同请先用「差异」比对，再决定改哪一边。'))
        }
        // 1) 复制到工作树。不用 fs.cpSync（Windows 上可能有原生层静默崩溃），手写逐文件递归。
        const copyDirSafe = (src, dst) => {
          fs.mkdirSync(dst, { recursive: true })
          for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
            const s = path.join(src, ent.name)
            const d = path.join(dst, ent.name)
            if (ent.isDirectory()) copyDirSafe(s, d)
            else if (ent.isFile()) fs.copyFileSync(s, d)
          }
        }
        try {
          if (fs.existsSync(hubDir)) throw new Error('target already exists')
          copyDirSafe(localSkills, hubDir)
        } catch (e) {
          try { fs.rmSync(hubDir, { recursive: true, force: true }) } catch { /* noop */ }
          return send(200, result(false, -1, '复制到中枢失败: ' + String(e && e.message || e)))
        }
        // 2) add + commit
        const add = await runGit(hub, ['add', '--', path.join('skills', name)], 60000)
        if (add.code !== 0) {
          try { fs.rmSync(hubDir, { recursive: true, force: true }) } catch { /* noop */ }
          return send(200, result(false, -1, 'git add failed: ' + add.out))
        }
        const commit = await runGit(hub, ['commit', '-m', 'add skill ' + name + ' from this machine'], 60000)
        if (commit.code !== 0) {
          const undo = await runGit(hub, ['reset', '--', path.join('skills', name)], 30000)
          try { fs.rmSync(hubDir, { recursive: true, force: true }) } catch { /* noop */ }
          return send(200, result(false, -1, 'git commit failed: ' + commit.out + (undo.code === 0 ? ' (rolled back)' : '')))
        }
        // 3) 只提交不推送（与 hubdelete / 云端文件编辑同一心智：推送由用户显式点）
        return send(200, result(true, 0, '已上传到云端仓库并本地提交（未推送）。请点「上传备份/推送」，另一台机器拉取后才会获得该技能。'))
      }
      return send(200, result(false, -1, 'dir must be tohub | fromhub'))
    }
    if (method === 'POST' && routePath === '/plugins') {
      const body = await readJsonBody(req)
      const act = String(body.action ?? 'List').trim()
      const map = { list: 'List', install: 'Install', update: 'Update', setlink: 'SetLink', restart: 'Restart' }
      const a = map[act.toLowerCase()]
      if (!a) return send(200, result(false, -1, 'action must be list | install | update | setlink | restart'))
      const extra = a === 'Install' ? ['-NoRestart'] : []
      return run('plugins.ps1', ['-Action', a].concat(extra), 300000)
    }
    // Read the hub's portable-plugin spec (config/plugin.txt) plus THIS machine's
    // clone/link state, so the card can tell "pull got the new tag, but this
    // machine still runs the old clone" apart from "already in sync".
    if (method === 'GET' && routePath === '/plugins/spec') {
      const cfg = {}
      const f = path.join(hub, 'config', 'plugin.txt')
      try {
        const raw = fs.readFileSync(f, 'utf8')
        for (const line of raw.split(/\r?\n/)) {
          const t = line.trim()
          if (!t || t.startsWith('#')) continue
          const i = t.indexOf('=')
          if (i < 1) continue
          cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim()
        }
      } catch { /* no plugin.txt */ }
      const name = cfg.name || ''
      const srcDir = name ? path.join(hub, 'plugins', name) : ''
      let cloned = false, localVersion = ''
      if (srcDir && fs.existsSync(path.join(srcDir, 'package.json'))) {
        cloned = true
        try { localVersion = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8')).version || '' } catch { /* unknown */ }
      }
      // Is the current profile actually referencing it (link:...) ?
      let linked = false
      let linkedSpec = ''
      try {
        const pj = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'package.json')
        const j = JSON.parse(fs.readFileSync(pj, 'utf8'))
        const spec = j.dependencies && name ? String(j.dependencies[name] ?? '') : ''
        if (spec) { linkedSpec = spec; linked = spec.startsWith('link:') || spec.startsWith('file:') ? fs.existsSync(spec.replace(/^(link|file):/, '')) : true }
      } catch { /* profile unreadable */ }
      return send(200, {
        ok: true,
        spec: { name, repo: cfg.repo || '', tag: cfg.tag || 'main' },
        cloned, localVersion, linked, linkedSpec, hubPath: srcDir,
      })
    }
    // ── 云端文件（hub viewer/editor）────────────────────────────────────
    // 白名单制：只暴露中枢里"值得人看、值得人改"的文本，别的（二进制会话备份、
    // 插件自身源码、技能素材/脚本）一律不可达，从根上杜绝误改与路径穿越。
    const HUB_FILE_GROUPS = [
      { group: 'memory', label: '记忆（双机唯一真相源）', paths: ['memory/shared.md'] },
      { group: 'machine', label: '机器档案', paths: [] }, // machines/*.md 由目录扫描补
      { group: 'config', label: '配置', paths: ['config/session-map.json', 'config/plugins.md', 'config/plugin.txt', 'config/tools.txt', 'config/sync-manifest.json'] },
    ]
    const normHubPath = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
    const isSafeHubPath = (p) => {
      if (!p || typeof p !== 'string') return false
      if (p.includes('..') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false
      return normHubPath(p) === p
    }
    // 技能：只允许 <name>/SKILL.md（frontmatter+正文），脚本/素材一律不暴露
    const hubSkillNames = () => {
      try {
        return fs.readdirSync(path.join(hub, 'skills'), { withFileTypes: true })
          .filter((d) => d.isDirectory()).map((d) => d.name).sort()
      } catch { return [] }
    }
    if (method === 'GET' && routePath === '/hub/files') {
      const files = []
      for (const g of HUB_FILE_GROUPS) {
        for (const rel of g.paths) {
          const abs = path.join(hub, rel)
          let size = 0, exists = false
          try { const st = fs.statSync(abs); exists = st.isFile(); size = st.size } catch { /* noop */ }
          files.push({ path: rel, group: g.group, size, exists })
        }
      }
      // machines/*.md：一机一文件，按名列出
      const mdir = path.join(hub, 'memory', 'machines')
      try {
        for (const e of fs.readdirSync(mdir, { withFileTypes: true })) {
          if (!e.isFile() || !/\.md$/i.test(e.name)) continue
          const rel = 'memory/machines/' + e.name
          files.push({ path: rel, group: 'machine', size: fs.statSync(path.join(mdir, e.name)).size, exists: true })
        }
      } catch { /* no machines dir */ }
      // skills/<name>/SKILL.md
      for (const n of hubSkillNames()) {
        const rel = 'skills/' + n + '/SKILL.md'
        let size = 0, exists = false
        try { const st = fs.statSync(path.join(hub, rel)); exists = st.isFile(); size = st.size } catch { /* noop */ }
        files.push({ path: rel, group: 'skill', skill: n, size, exists })
      }
      // 本地 git 已改动（未提交）路径集合 → 给每个文件打 dirty（前端"只显示有改动"用）
      const dirtySet = new Set()
      try {
        const st = await runGit(hub, ['status', '--porcelain'], 20000)
        if (st.code === 0) {
          for (const line of String(st.out).split('\n')) {
            const p = line.trim().slice(2).trim() // " M path" → path
            if (p) dirtySet.add(p.replace(/\\/g, '/'))
          }
        }
      } catch { /* 非 git 仓库时忽略 */ }
      for (const f of files) { f.dirty = dirtySet.has(f.path) ? 1 : 0 }
      return send(200, { ok: true, files, total: files.length, writable: files.filter((f) => f.exists).length, dirty: [...dirtySet] })
    }
    if (method === 'GET' && routePath === '/hub/file') {
      const rel = normHubPath(url.searchParams.get('path') || '')
      if (!isSafeHubPath(rel)) return send(200, { ok: false, code: -1, text: '非法路径' })
      // 白名单命中判断：配置组按全等；机器档案按前缀；技能按 <name>/SKILL.md
      const inWhitelist = HUB_FILE_GROUPS.some((g) => g.paths.includes(rel))
        || /^memory\/machines\/[^/]+\.md$/.test(rel)
        || (rel.startsWith('skills/') && rel.endsWith('/SKILL.md'))
      if (!inWhitelist) return send(200, { ok: false, code: -1, text: '该文件不在可查看/编辑范围' })
      const abs = path.join(hub, rel)
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(200, { ok: false, code: -1, text: '文件不存在：' + rel })
      let text = ''
      try { text = fs.readFileSync(abs, 'utf8') } catch (e) { return send(200, { ok: false, code: -1, text: '读取失败: ' + String(e && e.message || e) }) }
      const isJson = /\.json$/i.test(rel)
      return send(200, { ok: true, path: rel, text, size: text.length, isJson })
    }
    if (method === 'POST' && routePath === '/hub/file') {
      const body = await readJsonBody(req)
      const rel = normHubPath(body.path)
      const text = typeof body.text === 'string' ? body.text : null
      if (!isSafeHubPath(rel)) return send(200, result(false, -1, '非法路径'))
      if (text === null) return send(200, result(false, -1, 'text required'))
      const inWhitelist = HUB_FILE_GROUPS.some((g) => g.paths.includes(rel))
        || /^memory\/machines\/[^/]+\.md$/.test(rel)
        || (rel.startsWith('skills/') && rel.endsWith('/SKILL.md'))
      if (!inWhitelist) return send(200, result(false, -1, '该文件不可编辑'))
      const abs = path.join(hub, rel)
      if (fs.existsSync(abs) && !fs.statSync(abs).isFile()) return send(200, result(false, -1, '目标不是文件'))
      // JSON 先校验：改坏了不让存（session-map.json 是典型）
      if (/\.json$/i.test(rel)) {
        try { JSON.parse(text) } catch (e) {
          return send(200, result(false, -1, 'JSON 语法错误，已拒绝保存：' + String(e && e.message || e)))
        }
      }
      // 内容没变就别提交空 commit
      let old = ''
      try { old = fs.readFileSync(abs, 'utf8') } catch { /* new file */ }
      if (old === text) return send(200, { ok: true, code: 0, changed: false, text: '内容无变化，未提交。', path: rel })
      // 归档旧版本（铁律：覆盖前先归档，绝不静默删）
      let archived = ''
      if (old) {
        try {
          const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
          const safeName = rel.replace(/\//g, '--')
          const dst = path.join(hub, 'backups-archive', safeName + '--' + stamp + '.bak')
          if (!fs.existsSync(path.join(hub, 'backups-archive'))) fs.mkdirSync(path.join(hub, 'backups-archive'), { recursive: true })
          fs.writeFileSync(dst, old, 'utf8')
          archived = dst
        } catch { /* 归档失败不阻断编辑，但会在结果里说明 */ }
      }
      // 冲突保护：远端该文件若有别人的新提交，先拒绝，避免直接覆盖另一台的劳动成果
      try {
        const fetch = await runGit(hub, ['fetch', '--quiet'], 120000)
        if (fetch.code === 0) {
          const mine = await runGit(hub, ['log', '-1', '--format=%H', '--', rel], 30000)
          const theirs = await runGit(hub, ['log', '-1', '--format=%H', 'origin/main', '--', rel], 30000)
          const isNew = await runGit(hub, ['log', '-1', '--format=%H', 'HEAD', '--', rel], 30000)
          if (mine.code === 0 && theirs.code === 0 && mine.out.trim() && theirs.out.trim()
            && mine.out.trim() !== theirs.out.trim() && String(isNew.out).trim()) {
            return send(200, result(false, -1, '另一台机器已修改过该文件。请先在「从云端拉取」里 git pull 合并，再保存，避免覆盖对方的改动。'))
          }
        }
      } catch { /* fetch 失败不阻断（离线场景），保存照常 */ }
      fs.writeFileSync(abs, text, 'utf8')
      const add = await runGit(hub, ['add', '--', rel], 60000)
      if (add.code !== 0) return send(200, result(false, -1, 'git add failed: ' + add.out))
      const commit = await runGit(hub, ['commit', '-m', 'edit ' + rel], 60000)
      if (commit.code !== 0) return send(200, result(false, -1, 'git commit failed: ' + commit.out))
      return send(200, {
        ok: true, code: 0, changed: true, path: rel,
        text: '已保存到工作区并本地提交（未推送：请点「上传备份/推送」让另一台机器收到）。'
          + (archived ? ' 旧版本已归档：' + path.basename(archived) : ''),
      })
    }
    // ── 检查 / 应用中枢更新（卡片上的「检查更新」「立即更新」）────────────
    // 单一真相源 = tools/update.ps1，菜单 [24] 走同一个脚本，行为不会漂移。
    if (method === 'GET' && routePath === '/update/check') {
      const r = await runPs(hub, 'update.ps1', ['-Check', '-Json'], null, { timeoutMs: 120000 })
      let info = null
      try {
        const txt = String(r.out)
        const s = txt.indexOf('{')
        const e = txt.lastIndexOf('}')
        if (s >= 0 && e > s) info = JSON.parse(txt.slice(s, e + 1))
      } catch { /* fall through to the raw text below */ }
      if (!info) {
        return send(200, result(false, r.code === 0 ? 0 : r.code, tail(r.out, 4000) || '检查更新失败'))
      }
      return send(200, {
        ok: true, code: 0,
        localVersion: info.localVersion, remoteVersion: info.remoteVersion,
        behind: info.behind, ahead: info.ahead, dirty: info.dirty,
        remoteSubject: info.remoteSubject, remoteCommit: info.remoteCommit,
        text: info.text,
      })
    }
    if (method === 'POST' && routePath === '/update/apply') {
      const body = await readJsonBody(req).catch(() => ({}))
      const args = ['-Force', '-Json']
      if (body && body.force === false) args.splice(0, 1)
      const r = await runPs(hub, 'update.ps1', args, null, { timeoutMs: 600000 })
      let info = null
      try {
        const txt = String(r.out)
        const s = txt.indexOf('{')
        const e = txt.lastIndexOf('}')
        if (s >= 0 && e > s) info = JSON.parse(txt.slice(s, e + 1))
      } catch { /* fall through */ }
      if (!info) {
        return send(200, result(false, r.code === 0 ? 0 : r.code, tail(r.out, 4000) || '更新失败'))
      }
      const needRestart = !!info.restartNeeded
      return send(200, {
        ok: info.ok !== false, code: 0,
        action: info.action, text: info.text,
        localVersion: info.localVersion, remoteVersion: info.remoteVersion,
        behind: info.behind, pluginUpdated: info.pluginUpdated,
        restartNeeded: needRestart, notes: info.notes || [],
        raw: tail(r.out, 2000),
      })
    }
    // ── 推送前智能自检（pre-flight）────────────────────────────────────
    // 把「会推什么 + 远端是否该先拉 + 凭据是否在位 + 会话体积是否失控」合成一张
    // 红黄绿灯清单，用户点一下就知道「这次同步该不该推、推什么」。
    if (method === 'GET' && routePath === '/preflight') {
      const cats = normalizeCategories(url.searchParams.get('categories') || '')
      const checks = []
      const add = (level, key, detail) => checks.push({ level, key, detail })
      // 1) 预演：这次到底推什么
      const pass2 = ['-DryRun'].concat(cats.length ? ['-What', cats.join(',')] : [])
      const d = await runPs(hub, 'push.ps1', pass2, null, { timeoutMs: 300000 })
      const files = []
      let bytes = 0
      for (const line of String(d.out).split(/\r?\n/)) {
        const m = line.match(/^DRYRUN_FILE=(.+)$/)
        if (m) { files.push(m[1].trim()); continue }
        if (/^DRYRUN_BYTES=/.test(line)) bytes = Number(line.split('=')[1] || 0)
      }
      if (!files.length) {
        add('pass', 'scope', '所选范围内没有可推送的改动')
      } else {
        const kb = bytes > 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B'
        add('pass', 'scope', '将推送 ' + files.length + ' 个文件（' + kb + '）')
        if (bytes > 20 * 1024 * 1024) add('fail', 'size', '单次推送超过 20MB（' + kb + '）：Gitee 单文件上限 100MB，大块建议分批或缩小范围')
        else if (bytes > 5 * 1024 * 1024) add('warn', 'size', '本次推送 ' + kb + '，偏大，确认网络稳定')
        const sess = files.filter((f) => f.startsWith('session-backup/'))
        if (sess.length) add('info', 'sessions', '含 ' + sess.length + ' 个会话备份文件（历史对话，体积大但只读）')
      }
      // 2) 远端是否领先（必须先 pull 再推，否则 rebase 冲突）
      const behind = await runGit(hub, ['rev-list', '--count', 'HEAD..@{u}'], 20000)
      const behindN = behind.code === 0 ? parseInt(behind.out.trim(), 10) || 0 : -1
      if (behindN > 0) add('warn', 'behind', '远端领先 ' + behindN + ' 个提交：建议先「从云端拉取」，否则推送时要 rebase，可能撞冲突')
      // 3) 凭据
      const remoteRes = await runGit(hub, ['remote', 'get-url', 'origin'])
      let host = 'gitee.com'
      try { if (remoteRes.code === 0 && remoteRes.out.trim()) host = new URL(remoteRes.out.trim()).host } catch { /* default */ }
      const probe = await probeGiteeCredential(host)
      add(probe.ok ? 'pass' : 'fail', 'cred', probe.ok ? ('凭据在位（' + (probe.user || host) + '）') : '没有 Gitee 凭据：推送会失败，请先在概览里保存')
      // 4) 本地未提交的越界改动（parking 会被 stash，推完再 pop）
      const dirty = await runGit(hub, ['status', '--porcelain'])
      const dirtyLines = dirty.code === 0 ? dirty.out.trim().split('\n').filter(Boolean) : []
      const outside = dirtyLines.length
      if (outside > 0) add('info', 'dirty', '另有 ' + outside + ' 个改动不在本次范围内（推送时自动暂存保护，推完还原）')
      const worst = checks.some((c) => c.level === 'fail') ? 'fail' : (checks.some((c) => c.level === 'warn') ? 'warn' : 'pass')
      return send(200, { ok: true, worst, checks, files, fileCount: files.length, bytes, categories: cats })
    }
    // ── 会话历史浏览（只读）──────────────────────────────────────────
    // DSH 会话是「增量追写的多帧 zstd」：每帧独立，zstdDecompressSync 一次只能
    // 解一帧，必须逐帧解压才能拿到全部消息。全程只读，绝不写回。
    const decodeSessionFile = (abs) => {
      let raw
      try { raw = fs.readFileSync(abs) } catch { return '' }
      const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
      const chunks = []
      let pos = 0
      while (pos < raw.length) {
        const idx = raw.indexOf(MAGIC, pos)
        if (idx < 0) break
        try {
          chunks.push(zlib.zstdDecompressSync(raw.subarray(idx)))
          pos = idx + 4
          let next = raw.indexOf(MAGIC, pos)
          while (next > 0) {
            try { zlib.zstdDecompressSync(raw.subarray(next)); break } catch { next = raw.indexOf(MAGIC, next + 4) }
          }
          pos = next > 0 ? next : raw.length
        } catch { pos = idx + 4 }
      }
      return Buffer.concat(chunks).toString('utf8')
    }
    // 把一段 JSONL 事件流收敛成「可读的消息列表」（用户/助手/工具/标题）
    const summarizeSession = (text, limit) => {
      const msgs = []
      let title = ''
      // 噪音过滤：system-reminder / 运行时上下文 / 技能目录等不是真人说的话
      const isNoise = (s) => /^\s*<?\s*(system-reminder|Current runtime context|Time sampled|A skill is)/i.test(s)
      const push = (role, body, time) => {
        if (msgs.length >= limit) return
        const clean = String(body || '').replace(/\s+/g, ' ').trim()
        if (clean && !isNoise(clean)) msgs.push({ role, text: clean.slice(0, 300), time: time || 0 })
      }
      for (const line of text.split('\n')) {
        if (!line) continue
        let j = null
        try { j = JSON.parse(line) } catch { continue }
        const d = j.data || {}
        if (j.type === 'session/title' && !title && d.title) title = String(d.title).trim()
        else if (j.type === 'user/message' && Array.isArray(d.content)) {
          push('user', d.content.map((c) => c.text || '').join(' '), j.time)
        } else if (j.type === 'assistant/message' && d.message && Array.isArray(d.message.content)) {
          const t2 = d.message.content.filter((c) => c.type === 'text').map((c) => c.text || '').join(' ')
          const tools = d.message.content.filter((c) => c.type === 'tool-call').map((c) => c.name).join(',')
          push('assistant', t2 || (tools ? '（调用工具：' + tools + '）' : ''), j.time)
        }
      }
      return { title, msgs }
    }
    if (method === 'GET' && routePath === '/sessions/browse') {
      const machine = (url.searchParams.get('machine') || '').trim()
      const sid = (url.searchParams.get('id') || '').trim()
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 40, 1), 200)
      const base = path.join(hub, 'session-backup')
      // 机器列表
      const machines = []
      try {
        for (const e of fs.readdirSync(base, { withFileTypes: true })) {
          if (!e.isDirectory()) continue
          machines.push(e.name)
        }
      } catch { /* no session backups yet */ }
      // 指定会话 -> 解压并摘要（只读）
      if (sid) {
        if (/[\\/]|\.\./.test(sid) || !/^[\w.-]+$/.test(sid)) return send(200, { ok: false, code: -1, text: 'invalid session id' })
        const m = machine && machines.includes(machine) ? machine : machines[0]
        if (!m) return send(200, { ok: false, code: -1, text: 'no session backups found' })
        let found = ''
        try {
          for (const w of fs.readdirSync(path.join(base, m), { withFileTypes: true })) {
            if (!w.isDirectory()) continue
            const f = path.join(base, m, w.name, sid, 'session.v4.jsonl.zstd')
            if (fs.existsSync(f)) { found = f; break }
          }
        } catch { /* noop */ }
        if (!found) return send(200, { ok: false, code: -1, text: 'session not found: ' + sid })
        const text = decodeSessionFile(found)
        if (!text) return send(200, { ok: false, code: -1, text: 'cannot decode session file' })
        const { title, msgs } = summarizeSession(text, limit)
        return send(200, { ok: true, machine: m, id: sid, title, msgs, bytes: text.length })
      }
      // 否则列出某个机器的会话（按工作区分组）
      const m = machine && machines.includes(machine) ? machine : machines[0]
      const groups = []
      if (m) {
        try {
          for (const w of fs.readdirSync(path.join(base, m), { withFileTypes: true })) {
            if (!w.isDirectory()) continue
            const sessions = []
            for (const s of fs.readdirSync(path.join(base, m, w.name), { withFileTypes: true })) {
              if (!s.isDirectory()) continue
              const f = path.join(base, m, w.name, s.name, 'session.v4.jsonl.zstd')
              if (!fs.existsSync(f)) continue
              const st = fs.statSync(f)
              // 只解压元数据行拿标题：解压后取第一行 session + 首个 title，成本可控
              let title = ''
              try {
                const text = decodeSessionFile(f).slice(0, 200000)
                const hit = summarizeSession(text, 1)
                title = hit.title
                if (!title) {
                  const firstUser = hit.msgs.find((x) => x.role === 'user')
                  if (firstUser) title = firstUser.text.slice(0, 40)
                }
              } catch { /* skip */ }
              sessions.push({ id: s.name, title: title || s.name, bytes: st.size, mtime: st.mtimeMs })
            }
            groups.push({ workspace: w.name, sessions })
          }
        } catch { /* noop */ }
      }
      return send(200, { ok: true, machines, machine: m, groups })
    }
    // list local session workspaces (for the session multi-select dropdowns)
    if (method === 'GET' && routePath === '/sessions/list') {
      const dsh = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
      const dir = path.join(dsh, 'sessions')
      const items = []
      try {
        if (fs.existsSync(dir)) {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) {
              let count = 0
              try {
                count = fs.readdirSync(path.join(dir, e.name))
                  .filter((f) => f.endsWith('.jsonl') || f.endsWith('.json')).length
              } catch { /* noop */ }
              items.push({ name: e.name, files: count })
            }
          }
        }
      } catch { /* noop */ }
      return send(200, { ok: true, machineId: readMachineId(), items })
    }
    if (method === 'POST' && routePath === '/sessions') {
      const body = await readJsonBody(req)
      const act = String(body.action ?? '').trim().toLowerCase()
      if (act === 'backup') return run('backup-sessions.ps1', ['-Backup', '-IncludeInGit'], 300000)
      if (act === 'list') return run('backup-sessions.ps1', ['-List'], 60000)
      if (act === 'restore') {
        const from = String(body.from ?? '').trim()
        return from ? run('backup-sessions.ps1', ['-Restore', '-From', from], 300000)
                    : run('backup-sessions.ps1', ['-Restore'], 300000)
      }
      return send(200, result(false, -1, 'action must be backup | list | restore'))
    }
    // ── bootstrap: fresh machine, hub not cloned yet. The card supplies the
    //    repo URL (default = the owner's private Gitee repo), the credential is
    //    already in the Windows store from /cred. git clone -> apply -> plugin
    //    install, all non-interactive (apply never asks YES on a machine with no
    //    saved identity marker). ───────────────────────────────────────────────
    if (method === 'POST' && routePath === '/bootstrap') {
      const body = await readJsonBody(req)
      const repoUrl = String(body.repoUrl ?? '').trim() || 'https://gitee.com/mrlux/ai-sync-hub.git'
      const machine = String(body.machine ?? '').trim().toLowerCase()
      const dest = String(body.dest ?? '').trim()
      if (!/^[a-z][a-z0-9-]{0,15}$/.test(machine)) {
        return send(200, result(false, -1, 'machine id must be lowercase letters/digits/dash, e.g. home / shop'))
      }
      if (!dest || /[<>|"*?]/.test(dest)) {
        return send(200, result(false, -1, 'dest must be a plain folder path, e.g. D:\\AI\\sync-hub'))
      }
      let repoHost = 'gitee.com'
      try { repoHost = new URL(repoUrl).host } catch { return send(200, result(false, -1, 'invalid repoUrl')) }
      const cred = await probeGiteeCredential(repoHost)
      if (!cred.ok) return send(200, result(false, -1, 'no Gitee credential stored - save it in the credential box above first'))
      if (fs.existsSync(path.join(dest, '.git'))) {
        return send(200, result(false, -1, 'dest already a git repo: ' + dest + ' - pick another folder or use 拉取'))
      }
      const steps = []
      const cl = await runGit(process.cwd(), ['clone', repoUrl, dest], 600000)
      steps.push('clone: ' + (cl.code === 0 ? 'OK' : 'FAIL ' + tail(cl.out, 400)))
      if (cl.code !== 0) return send(200, result(false, cl.code, steps.join('\n')))
      const r2 = await runPs(dest, 'apply.ps1', ['-Machine', machine], null, { timeoutMs: 600000 })
      steps.push('apply: ' + (r2.code === 0 ? 'OK' : 'exit ' + r2.code + ' ' + tail(r2.out, 400)))
      const r3 = await runPs(dest, 'plugins.ps1', ['-Action', 'Install', '-NoRestart'], null, { timeoutMs: 600000 })
      steps.push('plugins: ' + (r3.code === 0 ? 'OK' : 'exit ' + r3.code + ' ' + tail(r3.out, 400)))
      const ok = r2.code === 0 && r3.code === 0
      return send(200, result(ok, ok ? 0 : -1, steps.join('\n') +
        '\n\n' + (ok ? '中枢已就位: ' + dest + '  ·  重启 DSH 后记忆/技能生效（本插件也会随中枢更新）' : '部分步骤失败，详见上方输出；可用「打开控制台」人工处理')))
    }
    if (method === 'GET' && routePath === '/tools') {
      const r = await runPs(hub, 'tools.ps1', ['-Json'], null, { timeoutMs: 90000 })
      // be tolerant: any stray progress line before the array must not break us
      let list = []
      const raw = String(r.out ?? '')
      const start = raw.indexOf('[')
      const end = raw.lastIndexOf(']')
      if (start >= 0 && end > start) {
        try { list = JSON.parse(raw.slice(start, end + 1)) } catch { list = [] }
      }
      const missingCore = list.filter((x) => !x.Present && x.Need === 'core').length
      return send(200, {
        ok: r.code === 0, code: r.code, tools: list,
        present: list.filter((x) => x.Present).length,
        total: list.length, missingCore,
      })
    }
    if (method === 'POST' && routePath === '/tools/install') {
      const body = await readJsonBody(req)
      const keys = Array.isArray(body.keys) ? body.keys.join(',') : String(body.keys ?? '').trim()
      const mode = String(body.mode ?? '').trim().toLowerCase()
      const pass = keys ? ['-Install', keys]
        : mode === 'allnice' ? ['-InstallAllNice']
        : ['-InstallAll']
      return run('tools.ps1', pass, 900000)
    }
    // ── skills: inventory / enable-disable / import / create / trash ─────────
    // Simpler than @michengai/dsh-skills-manager on purpose: sync-hub covers
    // list + enable/disable + URL import + create + trash. Only DSH's own dir
    // is writable; other agents' dirs are read-only.
    if (method === 'GET' && routePath === '/skills/list') {
      const items = skills.listSkills()
      return send(200, {
        ok: true, items,
        total: items.length,
        enabled: items.filter((s) => s.enabled).length,
        invalid: items.filter((s) => !s.valid).length,
        roots: skills.skillRoots().filter((r) => fs.existsSync(r.dir)).map((r) => ({ id: r.id, label: r.label, writable: r.writable })),
      })
    }
    if (method === 'POST' && routePath === '/skills/toggle') {
      const body = await readJsonBody(req)
      const r = skills.toggleSkill({ name: body.name, rootId: body.rootId, enable: !!body.enable })
      return send(200, { ok: r.ok, code: r.ok ? 0 : -1, text: r.text })
    }
    if (method === 'POST' && routePath === '/skills/read') {
      const body = await readJsonBody(req)
      const r = skills.readSkill({ name: body.name, rootId: body.rootId })
      return send(200, { ok: r.ok, code: r.ok ? 0 : -1, text: r.text })
    }
    if (method === 'POST' && routePath === '/skills/import') {
      const body = await readJsonBody(req)
      const r = await skills.importSkillFromUrl({ url: body.url, name: body.name })
      return send(200, { ok: r.ok, code: r.ok ? 0 : -1, text: r.text })
    }
    if (method === 'POST' && routePath === '/skills/create') {
      const body = await readJsonBody(req)
      const r = skills.createSkill({ name: body.name, description: body.description, body: body.body })
      return send(200, { ok: r.ok, code: r.ok ? 0 : -1, text: r.text })
    }
    if (method === 'POST' && routePath === '/skills/trash') {
      const body = await readJsonBody(req)
      const r = skills.trashSkill({ name: body.name })
      return send(200, { ok: r.ok, code: r.ok ? 0 : -1, text: r.text })
    }
    if (method === 'GET' && routePath === '/skills/trash') {
      const t = skills.listTrash()
      return send(200, { ok: true, dir: t.dir, items: t.items })
    }
    if (method === 'POST' && routePath === '/skills/restore') {
      const body = await readJsonBody(req)
      const r = skills.restoreTrash({ name: body.name })
      return send(200, { ok: r.ok, code: r.ok ? 0 : -1, text: r.text })
    }
    // ── plugins: installed inventory / npm market / install / uninstall ──────
    if (method === 'GET' && routePath === '/plugins/list') {
      return send(200, { ok: true, ...plugins.listInstalled() })
    }
    if (method === 'GET' && routePath === '/plugins/market') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const r = await plugins.searchMarket({ query: url.searchParams.get('q') || '', size: url.searchParams.get('size') })
      return send(200, r)
    }
    if (method === 'POST' && routePath === '/plugins/install') {
      const body = await readJsonBody(req)
      const r = await plugins.installPlugin({ name: body.name, profile: body.profile })
      return send(200, { ok: r.ok, code: r.ok ? 0 : -1, text: r.text })
    }
    if (method === 'POST' && routePath === '/plugins/uninstall') {
      const body = await readJsonBody(req)
      const r = await plugins.uninstallPlugin({ name: body.name, profile: body.profile })
      return send(200, { ok: r.ok, code: r.ok ? 0 : -1, text: r.text })
    }
    // outdated check (npm only; local/file/git specs are reported as 'local')
    if (method === 'GET' && routePath === '/plugins/outdated') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const r = await plugins.checkOutdated({ profile: url.searchParams.get('profile') || '' })
      return send(200, r)
    }
    if (method === 'POST' && routePath === '/plugins/update') {
      const body = await readJsonBody(req)
      const r = await plugins.updatePlugin({ name: body.name, profile: body.profile })
      return send(200, { ok: r.ok, code: r.ok ? 0 : -1, text: r.text })
    }
    // curated recommendations for the market row
    if (method === 'GET' && routePath === '/plugins/featured') {
      return send(200, { ok: true, items: plugins.FEATURED })
    }
    return send(404, { error: 'no such route' })
  } catch (e) {
    return send(500, { error: String((e && e.message) ?? e) })
  }
}

export function apply(ctx, config) {
  const logger = ctx.logger ?? console
  if (!ctx.tools || typeof ctx.tools.register !== 'function') {
    logger.error?.('[dsh-sync-hub] tools service missing - sync tools NOT registered')
    return
  }

  const noHub = () =>
    result(false, -1,
      'sync-hub not found on this machine. Tried config.hubPath, SYNC_HUB_PATH and ' +
      'known candidates. Fix: set config.hubPath in cordis.patch.yml (id: sync-hub).')

  const conflictText = (out) =>
    tail(out) +
    '\n\n[conflict] exit code 2 = pull conflict. STOP here: report the conflict files to the user. ' +
    'Do NOT auto-resolve; the human recipe is in 使用手册.md FAQ-5 (git add <file> && git rebase --continue).'

  const reg = (def) => {
    try {
      ctx.tools.register(def)
      return true
    } catch (e) {
      logger.error?.('[dsh-sync-hub] tool registration failed for ' + def.name + ': ' + String(e))
      return false
    }
  }

  let registered = 0

  if (reg({
    name: 'sync_hub_status',
    description:
      '查看跨机记忆同步中枢(sync-hub)状态, 只读无副作用 (跑 tools/status.ps1): ' +
      '本机 vs 中枢 vs Gitee 的差异, 列出待推送/待拉取内容。用户问"同步状态/差多少/有什么要传/更新了吗"时用它, ' +
      '也是 sync_hub_push 前必须先跑的确认步骤。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async (_args, exec) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = await runPs(hub, 'status.ps1', [], exec)
      return result(r.code === 0, r.code, tail(r.out) || '(no output)')
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_push',
    description:
      '把本机 sync-hub 改动推送到 Gitee (上传备份)。必须先跑 sync_hub_status 让用户看到差异并确认后再调用。' +
      'categories 控制六类上传范围: memory=记忆, skills=技能, config=配置, plugins=插件清单, sessions=会话备份, dshconfig=DSH运行配置采集; ' +
      '省略或空=全部。skills/sessions 可进一步按名筛选; dshconfig=true 会采集本机运行配置一并上传。message 是提交说明。' +
      '用户说"上传/推上去/备份记忆/同步给另一台"时用。',
    parameters: PUSH_PARAMS,
    output: OUT,
    execute: async (args, exec) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const pass = []
      const cats = normalizeCategories(args && args.categories)
      const skillsSel = toCsv(args && args.skills)
      const sessionsSel = toCsv(args && args.sessions)
      if (cats.length) pass.push('-What', cats.join(','))
      if (skillsSel) pass.push('-Skills', skillsSel)
      if (sessionsSel) pass.push('-Sessions', sessionsSel)
      if (args && args.dshconfig) pass.push('-DshConfig')
      if (args && typeof args.message === 'string' && args.message.trim()) pass.push('-Message', args.message.trim())
      if (cats.includes('sessions')) {
        await runPs(hub, 'backup-sessions.ps1', ['-Backup', '-IncludeInGit']
          .concat(sessionsSel ? ['-Sessions', sessionsSel] : []), exec, { timeoutMs: 600000 })
      }
      const r = await runPs(hub, 'push.ps1', pass, exec)
      return result(r.code === 0, r.code, tail(r.out) || '(no output)')
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_pull',
    description:
      '从 Gitee 拉取最新 sync-hub 并应用到本机 DSH (记忆/技能/配置; DSH 重启后生效)。' +
      'categories 控制六类拉取范围: memory=记忆, skills=技能, config=配置, plugins=插件清单, sessions=会话备份, dshconfig=DSH运行配置写回; ' +
      '省略或空=全部。dshconfigWriteBack=true 会尝试把中枢采集的运行配置写回本机 (需同机身份校验)。' +
      '用户说"拉取/更新记忆/同步下来/另一台改了东西"时用。' +
      '退出码 2 = 合并冲突: 立即停下把冲突文件报告给用户, 禁止自行解决冲突。',
    parameters: PULL_PARAMS,
    output: OUT,
    execute: async (args, exec) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const pass = []
      const cats = normalizeCategories(args && args.categories)
      const skillsSel = toCsv(args && args.skills)
      const sessionsSel = toCsv(args && args.sessions)
      if (cats.length) pass.push('-What', cats.join(','))
      if (skillsSel) pass.push('-Skills', skillsSel)
      if (args && args.dshconfigWriteBack) pass.push('-DshConfigWriteBack')
      if (args && args.force) pass.push('-Force')
      const r = await runPs(hub, 'pull.ps1', pass, exec)
      if (r.code === 2) return result(false, 2, conflictText(r.out))
      if (cats.includes('sessions')) {
        const from = args && typeof args.machineId === 'string' ? args.machineId.trim() : ''
        await runPs(hub, 'backup-sessions.ps1', ['-Restore'].concat(from ? ['-From', from] : [])
          .concat(sessionsSel ? ['-Sessions', sessionsSel] : []), exec, { timeoutMs: 600000 })
      }
      return result(r.code === 0, r.code, tail(r.out) || '(no output)')
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_version',
    description:
      '读取 sync-hub 版本信息, 只读无副作用: 版本号(VERSION 文件)、最新 git 提交、工作区是否干净、技能数量。' +
      '用户问"中枢什么版本/更新到哪了/最近改了什么"时用。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const ver = fs.readFileSync(path.join(hub, 'VERSION'), 'utf8').trim()
      const log = await runGit(hub, ['log', '-1', '--format=%h | %ci | %s'])
      const st = await runGit(hub, ['status', '--porcelain'])
      const dirty = st.code === 0
        ? (st.out.trim() ? st.out.trim().split('\n').length + ' uncommitted change(s)' : 'clean')
        : 'git unavailable: ' + tail(st.out, 400)
      let skills = 0
      try { skills = fs.readdirSync(path.join(hub, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).length } catch { /* noop */ }
      const lines = [
        'sync-hub version : v' + ver,
        'latest commit    : ' + (log.code === 0 ? log.out.trim() : '(none)'),
        'working tree     : ' + dirty,
        'skills           : ' + skills,
        'hub path         : ' + hub,
      ]
      return result(true, 0, lines.join('\n'))
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_open_console',
    description:
      '打开同步中枢交互式控制台窗口 (等价双击 同步中枢.bat, 中文彩色菜单)。' +
      '当操作需要人工交互时用它: apply 换机器身份(要手输 YES)、全自动一条龙、会话恢复、冲突处理、网页控制台等。' +
      'AI 不要尝试代跑这些交互流程, 打开窗口让用户自己点。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const bat = path.join(hub, '同步中枢.bat')
      if (!fs.existsSync(bat)) return result(false, -1, 'launcher missing: ' + bat)
      try {
        const child = spawn('cmd.exe', ['/d', '/c', 'start', '""', '"' + bat + '"'], {
          cwd: hub, detached: true, stdio: 'ignore', windowsHide: false,
        })
        child.unref()
        return result(true, 0, 'sync-hub console opened: ' + bat)
      } catch (e) {
        return result(false, -1, String(e))
      }
    },
  })) registered += 1

  // ── P1: expose the rest of the card's safe capability surface as AI tools
  //    (backup / skills / plugins) so the Agent can drive them too. State-
  //    changing ones are flagged "confirm first" in their description.
  const SKILL_TOGGLE_PARAMS = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '技能目录名 (kebab-case), 如 my-skill' },
      rootId: { type: 'string', description: '来源 id: dsh(默认) | agents | 其余只读来源不可改' },
      enable: { type: 'boolean', description: 'true=启用, false=停用' },
    },
    required: ['name', 'enable'],
    additionalProperties: false,
  }
  const SKILL_IMPORT_PARAMS = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'GitHub 仓库 / .zip / 原始 SKILL.md 的 http(s) 网址' },
      name: { type: 'string', description: '可选: 指定技能名 (kebab-case); 不填则从 frontmatter 推断' },
    },
    required: ['url'],
    additionalProperties: false,
  }
  const SKILL_CREATE_PARAMS = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '新技能名 (kebab-case), 如 my-skill' },
      description: { type: 'string', description: '技能描述 (DSH 靠它决定何时调用, 必填)' },
      body: { type: 'string', description: '可选: SKILL.md 正文' },
    },
    required: ['name', 'description'],
    additionalProperties: false,
  }
  const PLUGIN_PARAMS = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '插件包名, 如 @owner/dsh-foo 或 dsh-foo' },
      profile: { type: 'string', description: 'DSH profile 名, 默认 desktop' },
    },
    required: ['name'],
    additionalProperties: false,
  }

  if (reg({
    name: 'sync_hub_backup',
    description:
      '手动创建一份本机 DSH 备份 (跑 tools/backup.ps1 -Create): AGENTS.md / profile / 会话等。' +
      '只读拷贝, 无破坏性。用户说"备份一下/做个备份"时用。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async (_args, exec) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = await runPs(hub, 'backup.ps1', ['-Create'], exec, { timeoutMs: 90000 })
      return result(r.code === 0, r.code, tail(r.out) || '(no output)')
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_backup_list',
    description:
      '列出已有备份 (跑 tools/backup.ps1 -List), 只读。返回备份名/时间等, 供人工选择或后续恢复。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async (_args, exec) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = await runPs(hub, 'backup.ps1', ['-List'], exec, { timeoutMs: 60000 })
      return result(r.code === 0, r.code, tail(r.out) || '(no output)')
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_skill_list',
    description:
      '列出本机所有发现的技能 (跨 DSH / 共享 / 其他 Agent 来源), 只读。' +
      '返回每项的 name / rootLabel / enabled / valid / sizeKB / path。用户问"有哪些技能/某技能启用没"时用。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const items = skills.listSkills()
      if (!items.length) return result(true, 0, 'no skills found on this machine')
      const lines = items.map((s) =>
        (s.enabled ? '[on ] ' : '[off] ') + s.name + '  (' + s.rootLabel +
        (s.writable ? '' : ' 只读') + (s.valid ? '' : ' 无效') + ')  ' + s.sizeKB + 'KB  ' + s.path)
      return result(true, 0, lines.join('\n'))
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_skill_toggle',
    description:
      '启用/停用一个技能 (DSH: SKILL.md <-> SKILL.md.disabled 改名, 完全可逆, 不碰其他 Agent 的文件)。' +
      '会改变本机 DSH 行为, 调用前先与用户确认。只读来源 (非 dsh/agents) 会被拒绝。',
    parameters: SKILL_TOGGLE_PARAMS,
    output: OUT,
    execute: async (args) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = skills.toggleSkill({ name: args.name, rootId: args.rootId || 'dsh', enable: !!args.enable })
      return result(r.ok, r.ok ? 0 : -1, r.text)
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_skill_import',
    description:
      '从网址导入一个技能到本机 DSH (支持 GitHub 仓库 / .zip / 原始 SKILL.md)。落地到 ~/.dsh/skills。' +
      '会改变本机, 且可能触发外部网络下载, 调用前先与用户确认来源可信。',
    parameters: SKILL_IMPORT_PARAMS,
    output: OUT,
    execute: async (args) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = await skills.importSkillFromUrl({ url: args.url, name: args.name })
      return result(r.ok, r.ok ? 0 : -1, r.text)
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_skill_create',
    description:
      '在本机 DSH 创建一个新技能脚手架 (写 ~/.dsh/skills/<name>/SKILL.md)。会改变本机文件, 调用前先与用户确认。',
    parameters: SKILL_CREATE_PARAMS,
    output: OUT,
    execute: async (args) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = skills.createSkill({ name: args.name, description: args.description, body: args.body })
      return result(r.ok, r.ok ? 0 : -1, r.text)
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_plugin_list',
    description:
      '列出本机各 DSH profile 已装插件及其链接健康/版本 (读 profile package.json, 只读)。' +
      '用户问"装了哪些插件/某插件版本"时用。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const { profiles } = plugins.listInstalled()
      if (!profiles.length) return result(true, 0, 'no profiles found')
      const lines = []
      for (const p of profiles) {
        lines.push('profile: ' + p.profile)
        for (const it of p.items) {
          lines.push('  ' + it.name + '  v' + (it.version || '?') +
            (it.bundled ? ' [bundled]' : '') + (it.linkOk ? '' : ' [LINK BROKEN]') + '  ' + it.spec)
        }
      }
      return result(true, 0, lines.join('\n'))
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_plugin_install',
    description:
      '往本机 DSH profile 安装一个插件 (调 dsh plugin add, 需联网 npm)。会改变本机并拉取外部包, ' +
      '调用前先与用户确认包名与来源可信。装完需重启 DSH 生效。',
    parameters: PLUGIN_PARAMS,
    output: OUT,
    execute: async (args) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = await plugins.installPlugin({ name: args.name, profile: args.profile || 'desktop' })
      return result(r.ok, r.ok ? 0 : -1, r.text)
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_plugin_uninstall',
    description:
      '从本机 DSH profile 卸载一个插件 (调 dsh plugin remove)。会改变本机, 调用前先与用户确认。',
    parameters: PLUGIN_PARAMS,
    output: OUT,
    execute: async (args) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = await plugins.uninstallPlugin({ name: args.name, profile: args.profile || 'desktop' })
      return result(r.ok, r.ok ? 0 : -1, r.text)
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_plugin_update',
    description:
      '把本机 DSH profile 的一个插件更新到 npm 最新版 (调 dsh plugin add <pkg>@latest)。会改变本机, ' +
      '调用前先与用户确认。更新完需重启 DSH 生效。',
    parameters: PLUGIN_PARAMS,
    output: OUT,
    execute: async (args) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = await plugins.updatePlugin({ name: args.name, profile: args.profile || 'desktop' })
      return result(r.ok, r.ok ? 0 : -1, r.text)
    },
  })) registered += 1

  logger.info?.('[dsh-sync-hub] registered ' + registered + '/15 sync tools')

  // Settings-card backend. ctx.inject defers until webServer exists: plugins
  // load before the browser half publishes it (same pattern as our-free-model
  // index.js:1402), so a one-shot ctx.get('webServer') here would answer
  // undefined and the card would have no data source.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], scoped => {
      const server = scoped.webServer
      if (!server || typeof server.register !== 'function') return
      scoped.effect(() => server.register({
        kind: 'prefix', path: '/api/sync-hub', handler: (req, res) => apiHandler(req, res, config),
      }), 'dsh-sync-hub: settings API')
      logger.info?.('[dsh-sync-hub] settings API mounted at /api/sync-hub')
    })
  }
}
