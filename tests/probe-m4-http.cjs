/**
 * probe-m4-http.cjs —— M4 HTTP 面端到端探针。
 *
 * 做什么（全部真跑，不 mock 业务）：
 *   1) 真跑 index.js 的 apply()，捕获它对 webServer 的 register 描述；
 *   2) 起一个真 http.Server，按最长前缀分发到注册的 handler；
 *   3) 逐条打 8 个路由的 GET/POST，断言状态与结构；
 *   4) 打围栏负例（cross-site / 外网 Host / Origin 不匹配），断言 403；
 *   5) 打未知路由，断言 404。
 *
 * 用法：node tests/probe-m4-http.cjs
 */

'use strict'

const http = require('node:http')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')

async function main() {
  const trust = await import(`file:///${path.join(ROOT, 'lib', 'trust.js').replace(/\\/g, '/')}`)
  // 1) 真跑 apply，捕获 register 描述
  const { apply } = await import(`file:///${path.join(ROOT, 'index.js').replace(/\\/g, '/')}`)
  let registered = null
  const logs = []
  const ctx = {
    logger: { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: () => {} },
    provide: () => {},
    inject: (names, cb) => {
      cb({
        webServer: { register: (desc) => { registered = desc } },
        get: () => undefined,
        // 真实 cordis 的 effect：立即执行 fn，把返回值当 disposer。
        effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
      })
    },
    // 顶层 effect 同理：立即执行（否则 register 永远不会被调用）。
    effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
  }
  apply(ctx, {})
  assert.ok(registered, 'apply 必须 register HTTP 前缀')
  assert.equal(registered.kind, 'prefix')
  assert.equal(registered.path, '/api/sync-hub')
  console.log('[1] apply：HTTP 前缀注册成功 →', registered.path)

  // 无论中途断言是否失败，都必须关闭服务器，否则进程挂住不退出。
  let server = null

  // 2) 起真服务器，按前缀分发（模拟 webServer 的最长前缀语义）
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    if (!url.pathname.startsWith(registered.path)) {
      res.writeHead(404); res.end('{"ok":false}'); return
    }
    // 复刻 index.js 里的围栏 + 前缀剥离逻辑（与插件内实现同源）。
    const status = trust.rejectionFor(req, undefined, () => {})
    if (status !== undefined) {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'forbidden' }))
      return
    }
    const routePath = url.pathname.slice(registered.path.length) || '/'
    registered.handler(req, res, routePath)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}/api/sync-hub`
  console.log(`[2] 真服务器已起：${base}`)

  /**
   * 打一个请求，返回 {status, body}。
   * 带 15s 硬超时：任何单点挂死都不该拖垮整个探针（曾因 Host 头被污染
   * 导致 Node 客户端连不上测试服务器而挂住 60s+）。
   */
  const call = (method, route, body, headers = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`请求超时：${method} ${route}`)), 15_000)
    const req = http.request(`${base}${route}`, { method, headers }, (res) => {
      let text = ''
      res.on('data', (c) => { text += c })
      res.on('end', () => {
        clearTimeout(timer)
        let parsed = null
        try { parsed = JSON.parse(text) } catch { /* 非 JSON */ }
        resolve({ status: res.statusCode, body: parsed, text })
      })
    })
    req.on('error', (e) => { clearTimeout(timer); reject(e) })
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })

  async function runProbe() {
  // 3) 八条路由逐条打
  console.log('[3] 路由连通性')
  const overview = await call('GET', '/overview')
  assert.equal(overview.status, 200)
  assert.equal(overview.body.ok, true, '/overview 必须 ok:true')
  assert.ok(overview.body.status, '必须带 git 状态')
  assert.ok(overview.body.machine, '必须带机器概况')
  assert.equal(overview.body.hub.includes('sync-hub'), true, '必须报出中枢路径')
  console.log('    ✅ GET /overview →', JSON.stringify({
    hub: overview.body.hub,
    branch: overview.body.status.branch,
    dirty: overview.body.status.dirtyCount,
    skills: overview.body.inventory.skills,
    machines: overview.body.inventory.machines,
    tools: overview.body.tools.present + '/' + overview.body.tools.total,
  }))

  const env = await call('GET', '/env')
  assert.equal(env.body.ok, true)
  assert.ok(env.body.tools.summary, '/env 必须带工具体检汇总')
  assert.ok('installed' in env.body.schedule, '/env 必须带定时任务状态')
  console.log('    ✅ GET /env → 工具', env.body.tools.summary.present + '/' + env.body.tools.summary.total,
    '，定时任务', env.body.schedule.installed ? '已装' : '未装',
    '，凭据', env.body.credential.haveCredential ? '已存' : '未存')

  const backups = await call('GET', '/content')
  assert.equal(backups.body.ok, true)
  assert.ok(Array.isArray(backups.body.backups.backups), '/content 必须回备份列表')
  console.log('    ✅ GET /content → 历史备份', backups.body.backups.backups.length, '个')

  const machines = await call('GET', '/identity')
  assert.equal(machines.body.ok, true)
  assert.ok(Array.isArray(machines.body.machines))
  console.log('    ✅ GET /identity → 机器档案', machines.body.machines.join(', '))

  const sessions = await call('GET', '/sessions')
  assert.equal(sessions.body.ok, true)
  console.log('    ✅ GET /sessions → 本机会话', sessions.body.local.files, '文件；中枢备份机器',
    sessions.body.hub.machines.map((m) => `${m.machine}(${m.files})`).join(' '))

  const skills = await call('GET', '/skills')
  assert.equal(skills.body.ok, true)
  // M6 起 /skills 返回技能对比（compareSkills），不再是机器列表。
  assert.ok(skills.body.summary, '/skills 必须带 summary')
  assert.ok(Array.isArray(skills.body.diff), '/skills 必须带 diff 数组')
  console.log('    ✅ GET /skills → 技能对比：一致', skills.body.summary.identical,
    '，仅本机', skills.body.summary.onlyLocal,
    '，两边不同', skills.body.summary.differ,
    '，非法', skills.body.summary.invalidLocal.length)

  const portable = await call('GET', '/portable')
  assert.equal(portable.body.ok, true)
  console.log('    ✅ GET /portable → 清单', portable.body.spec.name, portable.body.spec.tag)

  // POST 类：预演（零副作用）+ 冲突查询 + 备份（真动作，可接受）
  const preview = await call('POST', '/sync', { action: 'preview', scopes: ['memory'] })
  assert.equal(preview.body.ok, true)
  console.log('    ✅ POST /sync preview → 将推', preview.body.files.length, '个文件 /', preview.body.totalBytes, '字节')

  const conflicts = await call('POST', '/sync', { action: 'conflicts' })
  assert.equal(conflicts.body.ok, true)
  console.log('    ✅ POST /sync conflicts → 冲突文件', conflicts.body.conflicts.length, '个')

  const backupNow = await call('POST', '/content', { action: 'backup' })
  assert.equal(backupNow.body.ok, true)
  console.log('    ✅ POST /content backup → 新建', backupNow.body.created.length, '份快照')

  // 4) 围栏负例
  console.log('[4] 信任围栏')
  const cases = [
    ['cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['外网 Origin', { origin: 'http://evil.com' }],
  ]
  for (const [name, headers] of cases) {
    const r = await call('GET', '/overview', undefined, headers)
    assert.equal(r.status, 403, `${name} 必须 403`)
    console.log(`    ✅ ${name} → 403`)
  }
  // DNS rebinding（Host 头指外网）不能经 Node 客户端发：http.request 会拿这个
  // Host 去建连，直接连不上 127.0.0.1 的测试服务器并挂起。该场景已由
  // guard-tests.mjs 的围栏单测在请求对象层覆盖（host-not-loopback → 403）。
  console.log('    ⏭️  DNS rebinding：由守卫单测在请求对象层覆盖（host-not-loopback）')

  // 5) 未知路由
  const unknown = await call('GET', '/nope')
  assert.equal(unknown.status, 404)
  console.log('[5] 未知路由 → 404 ✅')

  // 6) 未知动作
  const badAction = await call('POST', '/sync', { action: 'bogus' })
  assert.equal(badAction.status, 400)
  console.log('[6] 未知动作 → 400 ✅')

  // 7) 冲突路由的路径守卫（不打真冲突——那需要造一个冲突态仓库，
  //    已由 guard-conflict.mjs 在模块层用真场景覆盖）。这里验证 HTTP 层
  //    对非法路径与空文件的拒绝，保证围栏内的输入校验没被绕过。
  const evilInspect = await call('POST', '/sync', { action: 'conflict-inspect', file: '../../etc/passwd' })
  assert.equal(evilInspect.body.ok, false, 'HTTP 层必须拒 .. 穿越')
  console.log('[7] 冲突路由路径守卫 →', evilInspect.body.error ?? 'rejected', '✅')

  const evilResolve = await call('POST', '/sync', { action: 'conflict-resolve', file: '/abs/x.md', content: 'x' })
  assert.equal(evilResolve.body.ok, false, 'HTTP 层必须拒绝对路径写入')
  console.log('[7] 冲突写入路径守卫 →', evilResolve.body.error ?? 'rejected', '✅')

  console.log('\nM4 HTTP 探针全部通过 ✅')
  }

  // 无论中途断言是否失败，都必须关闭服务器，否则进程挂住不退出。
  try {
    await runProbe()
  } finally {
    if (server) server.close()
  }
}

main().catch((error) => {
  console.error('探针失败：', error)
  process.exitCode = 1
})
