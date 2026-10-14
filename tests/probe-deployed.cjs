/**
 * probe-deployed.cjs —— 验证 profile 里实际部署的插件（真实文件、真实环境）。
 *
 * 背景：用户报告面板多页无数据（"—"）。本探针用真 HTTP 服务器 +
 * 部署版 index.js，逐字段断言 /overview 响应，找出哪一层丢的数据。
 *
 * 用法：node tests/probe-deployed.cjs
 */
'use strict'
const http = require('node:http')
const assert = require('node:assert')
const path = require('node:path')

const PKG_DIR = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\node_modules\\dsh-sync-hub'

async function main() {
  const mod = await import(`file:///${path.join(PKG_DIR, 'index.js').replace(/\\/g, '/')}`)
  const trust = await import(`file:///${path.join(PKG_DIR, 'lib', 'trust.js').replace(/\\/g, '/')}`)

  let registered = null
  const logs = []
  const ctx = {
    logger: { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) },
    provide: () => {},
    inject: (names, cb) => cb({
      webServer: { register: (d) => { registered = d } },
      get: () => undefined,
      effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
    }),
    effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
  }
  mod.apply(ctx, {})
  assert.ok(registered, 'HTTP 面必须注册')
  console.log('[1] 部署版 HTTP 面注册成功 →', registered.path)
  logs.forEach((l) => console.log('    log:', l))

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const status = trust.rejectionFor(req, undefined, () => {})
    if (status !== undefined) { res.writeHead(status); res.end('{"ok":false}'); return }
    registered.handler(req, res, url.pathname.slice(registered.path.length) || '/')
  })
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}/api/sync-hub`

    const get = (route) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout ' + route)), 30_000)
      http.get(`${base}${route}`, (res) => {
        let text = ''
        res.on('data', (c) => { text += c })
        res.on('end', () => { clearTimeout(timer); resolve(JSON.parse(text)) })
      }).on('error', (e) => { clearTimeout(timer); reject(e) })
    })

    console.log('[2] GET /overview（部署版，真 HTTP）')
    const ov = await get('/overview')
    const fields = {
      'ok': ov.ok,
      'hub': ov.hub,
      'version': ov.version,
      'status.branch': ov.status?.branch,
      'status.dirtyCount': ov.status?.dirtyCount,
      'inventory.skills': ov.inventory?.skills,
      'machine.computer': ov.machine?.computer,
      'machine.dshHome': ov.machine?.dshHome,
      'health.score': ov.health?.score,
      'board.length': ov.board?.length,
      'credential': ov.credential?.haveCredential ? ov.credential.user : false,
      'tools': ov.tools ? `${ov.tools.present}/${ov.tools.total}` : undefined,
      'recent.length': ov.recent?.length,
    }
    console.log(JSON.stringify(fields, null, 1))
    console.log('error 字段:', ov.error ?? '(无)')

    if (!ov.ok) {
      console.log('\n!! ok=false —— 顶层失败，看 error')
    } else {
      const missing = Object.entries(fields).filter(([k, v]) => v === undefined)
      console.log(missing.length === 0
        ? '\n✅ 部署版全部字段正常 —— 数据层没问题，问题在浏览器半身渲染'
        : `\n❌ 缺失字段：${missing.map(([k]) => k).join(', ')}`)
    }
  } finally {
    if (server) server.close()
  }
}

main().catch((e) => { console.error('探针失败：', e); process.exitCode = 1 })
