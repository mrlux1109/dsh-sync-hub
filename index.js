/**
 * dsh-sync-hub — sync-hub console tools (Host half).
 *
 * Registers 5 model tools covering the NON-INTERACTIVE safe subset of the
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
import os from 'node:os'
import path from 'node:path'

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
    scope: {
      type: 'string',
      description: '上传范围: all(默认) | memory | skills | config | sessions',
    },
    message: {
      type: 'string',
      description: '提交说明 (英文或中文均可, 会进 git log)',
    },
  },
  additionalProperties: false,
}

function tail(s, max = 6000) {
  const str = String(s ?? '')
  if (str.length <= max) return str
  return '...(truncated)\n' + str.slice(-max)
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
      let skills = 0
      try { skills = fs.readdirSync(path.join(hub, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).length } catch { /* noop */ }
      const [commit, date, subject] = log.code === 0 ? String(log.out).trim().split('|') : ['', '', '']
      return send(200, {
        ok: true, version: ver, commit, commitDate: date, commitSubject: subject,
        dirty: st.code === 0 ? st.out.trim().split('\n').filter(Boolean).length : -1,
        skills, hubPath: hub, machine: os.hostname(),
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
          let skills = 0
          try { skills = fs.readdirSync(path.join(hub, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).length } catch { /* noop */ }
          const [commit, date, subject] = log.code === 0 ? String(log.out).trim().split('|') : ['', '', '']
          const dirtyLines = st.code === 0 ? st.out.trim().split('\n').filter(Boolean) : []
          return {
            ok: true, version: ver, commit, commitDate: date, commitSubject: subject,
            dirty: st.code === 0 ? dirtyLines.length : -1,
            dirtyFiles: dirtyLines.slice(0, 12).map((l) => l.trim()),
            skills, hubPath: hub, machine: os.hostname(),
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
    // Recent DSH log lines (read-only): the "what just happened" view.
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
      let tailText = ''
      if (files.length) {
        try {
          const p = path.join(dir, files[0].name)
          const raw = fs.readFileSync(p, 'utf8')
          tailText = raw.split(/\r?\n/).slice(-120).join('\n')
        } catch { /* unreadable */ }
      }
      return send(200, { ok: true, dir, files, newest: files.length ? files[0].name : '', tail: tailText })
    }
    if (method === 'POST' && routePath === '/push') {
      const body = await readJsonBody(req)
      const scope = typeof body.scope === 'string' ? body.scope.trim() : ''
      const message = typeof body.message === 'string' ? body.message.trim() : ''
      const pass = []
      // 'all' (or empty) = whole hub; anything else maps to push.ps1 -What
      if (scope && scope !== 'all') {
        if (!/^(memory|skills|config|sessions)(,(memory|skills|config|sessions))*$/.test(scope)) {
          return send(200, result(false, -1, 'scope must be all | memory | skills | config | sessions'))
        }
        pass.push('-What', scope)
      }
      if (message) pass.push('-Message', message)
      const r = await runPs(hub, 'push.ps1', pass, null, { timeoutMs: 300000 })
      return send(200, result(r.code === 0, r.code, tail(r.out, 20000)))
    }
    if (method === 'POST' && routePath === '/pull') {
      const body = await readJsonBody(req)
      const pass = []
      if (body.skipSkills) pass.push('-SkipSkills')
      if (body.skipProfile) pass.push('-SkipProfile')
      if (body.force) pass.push('-Force')
      const r = await runPs(hub, 'pull.ps1', pass, null, { timeoutMs: 300000 })
      return send(200, result(r.code === 0, r.code, tail(r.out, 20000)))
    }
    // manual snapshot: the "back up now" the card was missing
    if (method === 'POST' && routePath === '/backup/create') {
      const r = await runPs(hub, 'backup.ps1', ['-Create'], null, { timeoutMs: 90000 })
      return send(200, result(r.code === 0, r.code, tail(r.out, 20000)))
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
      const junk = (n) => /^@(org|user)[-_]/i.test(n)
      return send(200, {
        ok: true, hub: h1.length, local: l1.length, onlyHub, onlyLocal, diff,
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
      'scope 控制上传范围: all=全部(默认), memory=记忆, skills=技能, config=配置, sessions=会话备份。' +
      'message 是提交说明。用户说"上传/推上去/备份记忆/同步给另一台"时用。',
    parameters: PUSH_PARAMS,
    output: OUT,
    execute: async (args, exec) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const pass = []
      const scope = args && typeof args.scope === 'string' ? args.scope.trim() : ''
      if (scope && scope !== 'all') pass.push('-What', scope)
      if (args && typeof args.message === 'string' && args.message.trim()) pass.push('-Message', args.message.trim())
      const r = await runPs(hub, 'push.ps1', pass, exec)
      return result(r.code === 0, r.code, tail(r.out) || '(no output)')
    },
  })) registered += 1

  if (reg({
    name: 'sync_hub_pull',
    description:
      '从 Gitee 拉取最新 sync-hub 并应用到本机 DSH (记忆/技能/配置; DSH 重启后生效)。' +
      '用户说"拉取/更新记忆/同步下来/另一台改了东西"时用。' +
      '退出码 2 = 合并冲突: 立即停下把冲突文件报告给用户, 禁止自行解决冲突。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async (_args, exec) => {
      const hub = resolveHub(config)
      if (!hub) return noHub()
      const r = await runPs(hub, 'pull.ps1', [], exec)
      if (r.code === 2) return result(false, 2, conflictText(r.out))
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

  logger.info?.('[dsh-sync-hub] registered ' + registered + '/5 sync tools')

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
