/**
 * tests/roles-check.mjs —— S5 本机角色实测 + S2 守卫明示实测。
 */
import { readRoles, writeRole, recommendRole, ROLES } from '../lib/hub/roles.js'
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

console.log('── roles 模块（真建临时中枢）')
const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-hub-'))
fs.mkdirSync(path.join(hub, 'config'), { recursive: true })

// 初始：空表
const r0 = readRoles(hub)
check('空表可读且 ok', r0.ok && Object.keys(r0.roles).length === 0)

// 非法角色被拒（R1）
const bad1 = writeRole(hub, 'home', 'dictator')
check('非法角色被拒', !bad1.ok && String(bad1.error).includes('角色不合法'))
// 非法机器 id 被拒（R2）
const bad2 = writeRole(hub, '../evil', 'host')
check('非法机器 id 被拒', !bad2.ok && String(bad2.error).includes('id 不合法'))

// 正常写入 + 幂等读回
check('写入 home=host', writeRole(hub, 'home', 'host').ok)
check('写入 shop=follower', writeRole(hub, 'shop', 'follower').ok)
const r1 = readRoles(hub)
check('读回两台角色', r1.roles.home === 'host' && r1.roles.shop === 'follower', JSON.stringify(r1))
check('updatedAt 有值', typeof r1.updatedAt === 'string' && r1.updatedAt.length > 10)

// 覆盖写保留其他机器条目
check('改 shop=both', writeRole(hub, 'shop', 'both').ok)
const r2 = readRoles(hub)
check('home 未被动', r2.roles.home === 'host')
check('shop 已改 both', r2.roles.shop === 'both')

// 推荐
check('已设角色沿用', recommendRole(r2.roles, 'home').role === 'host')
check('未设角色默认主机', recommendRole({}, 'newbie').role === 'host')
check('ROLES 常量三种', ROLES.join(',') === 'host,follower,both')

console.log('')
console.log('── API 端到端（GET /env 带 roles，POST set-role）')
const HUB = 'D:\\【AI智能】\\DSH\\sync-hub'
const handler = createApiHandler({ hubPath: () => HUB, config: {} })
const srv = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://x').pathname))
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`

const g = await (await fetch(`${base}/env`)).json()
check('GET /env ok', g.ok === true)
check('带 machineId 字段', typeof g.machineId === 'string', `=${g.machineId}`)
check('带 roles 字段', g.roles?.ok === true && typeof g.roles.roles === 'object', JSON.stringify(g.roles))

const post = async (body) => (await fetch(`${base}/env`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json()
const badRole = await post({ action: 'set-role', role: 'king' })
check('非法角色被 API 拒', badRole.ok === false, JSON.stringify(badRole).slice(0, 120))
srv.close()

console.log('')
console.log('── S2：会话备份守卫明示（读源断言）')
const sessionsSrc = fs.readFileSync('lib/hub/sessions.js', 'utf8')
check('成功返回带 forbidden 空数组', sessionsSrc.includes('forbidden: [], guard: \'pass\''))
const clientSrc = fs.readFileSync('client.js', 'utf8')
check('回执含「守卫已通过」明示', clientSrc.includes('G1 密钥守卫已通过'))

console.log('')
console.log('── 清理')
fs.rmSync(hub, { recursive: true, force: true })
check('临时中枢已删', !fs.existsSync(hub))

console.log('')
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
