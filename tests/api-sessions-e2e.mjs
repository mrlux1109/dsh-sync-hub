/**
 * tests/api-sessions-e2e.mjs —— /sessions 端到端实测（v2.2 S3/S4）。
 *
 * 真起 HTTP 服务、真发请求，证明「GET 返回 missing / POST 能建目录」整条链路通。
 * 用法：node tests/api-sessions-e2e.mjs
 */
import { createApiHandler } from '../lib/api.js'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}

const HUB = 'D:\\【AI智能】\\DSH\\sync-hub'
const handler = createApiHandler({ hubPath: () => HUB, config: {} })
const srv = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://x').pathname))
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const port = srv.address().port
const base = `http://127.0.0.1:${port}`
console.log(`服务已起：${base}`)

const get = async (p) => (await fetch(base + p)).json()
const post = async (p, body) => (await fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json()

console.log('')
console.log('── GET /sessions（S3：缺失检测）')
const g = await get('/sessions')
check('ok=true', g.ok === true, JSON.stringify(g).slice(0, 200))
check('有 local 字段', !!g.local)
check('有 hub 机器清单', Array.isArray(g.hub?.machines))
check('有 missing 数组', Array.isArray(g.missing), `missing=${JSON.stringify(g.missing)}`)
check('有 missingChecked 计数', typeof g.missingChecked === 'number', `=${g.missingChecked}`)
console.log(`  实际：检查 ${g.missingChecked} 个工作区，缺失 ${g.missing?.length ?? '?'} 个`)
if (g.missing?.length) {
  for (const m of g.missing.slice(0, 3)) console.log(`    缺失 ${m.path}  来自 ${m.machines.join('、')}  ${m.files} 个会话`)
}

console.log('')
console.log('── POST /sessions create-missing-dirs（S4：建空目录）')
const tmpRoot = path.join(os.tmpdir(), `dsh-ws-e2e-${Date.now()}`)
const t1 = path.join(tmpRoot, 'A')
const t2 = path.join(tmpRoot, 'B')
const c = await post('/sessions', { action: 'create-missing-dirs', paths: [t1, t2] })
check('创建成功', c.ok === true, JSON.stringify(c).slice(0, 200))
check('返回 created 清单', Array.isArray(c.created) && c.created.length === 2, JSON.stringify(c.created))
check('目录确实存在', fs.existsSync(t1) && fs.existsSync(t2))
check('建出来是空的', fs.readdirSync(t1).length === 0)

console.log('')
console.log('── 危险路径必须被拒')
const d1 = await post('/sessions', { action: 'create-missing-dirs', paths: ['C:\\Windows\\System32\\evil'] })
check('系统目录被拒绝（failed 且未创建）', d1.ok === false || d1.failed?.length === 1, JSON.stringify(d1).slice(0, 150))
check('C:\\Windows\\System32\\evil 未被创建', !fs.existsSync('C:\\Windows\\System32\\evil'))
const d2 = await post('/sessions', { action: 'create-missing-dirs', paths: [] })
check('空列表被拒', d2.ok === false)

console.log('')
console.log('── 未知动作仍被拒（回归）')
const u = await post('/sessions', { action: 'no-such-action' })
check('未知动作返回错误', u.ok === false && String(u.error).includes('未知动作'))

console.log('')
console.log('── 清理')
fs.rmSync(tmpRoot, { recursive: true, force: true })
srv.close()
check('临时目录已删', !fs.existsSync(tmpRoot))

console.log('')
console.log(fail === 0 ? `✓ 端到端全部通过（${pass} 项）` : `✗ ${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)