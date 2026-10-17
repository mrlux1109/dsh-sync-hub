/**
 * tests/files-api-e2e.mjs —— /files 路由端到端实测（v2.5 批2）。
 * 真起 HTTP 服务，覆盖：列/读/写/删=留底/凭据硬墙/未知根/路径逃逸。
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

// 临时中枢
const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'files-api-'))
fs.mkdirSync(path.join(hub, 'memory'), { recursive: true })
fs.writeFileSync(path.join(hub, 'memory', 'shared.md'), '# 记忆\nv1\n', 'utf8')

const handler = createApiHandler({ hubPath: () => hub, config: {} })
const srv = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://x').pathname))
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`

const get = async (q) => (await fetch(`${base}/files?${q}`)).json()
const post = async (body) => (await fetch(`${base}/files`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json()

console.log('── GET 列表/读')
const ls = await get('root=hub%2Fmemory&path=')
check('列目录 ok', ls.ok === true && Array.isArray(ls.entries) && ls.entries.length === 1, JSON.stringify(ls))
const rd = await get('root=hub%2Fmemory&path=shared.md&action=read')
check('读文件 ok', rd.ok === true && rd.text.includes('v1'), JSON.stringify(rd).slice(0, 100))

console.log('')
console.log('── 守卫（反向）')
check('未知根被拒', (await get('root=hub%2Fwiki&path=')).ok === false)
check('.. 逃逸被拒', (await get('root=hub%2Fmemory&path=..%2F..%2Fetc')).ok === false)
check('凭据名被拒', (await get('root=hub%2Fmemory&path=.credentials.yaml')).ok === false)
check('读目录内凭据被拒', (await post({ action: 'delete', root: 'hub/memory', path: '.credentials.yaml' })).ok === false)

console.log('')
console.log('── POST 写/删（留底可逆）')
const wr = await post({ action: 'save', root: 'hub/memory', path: 'shared.md', text: '# 记忆\nv2\n' })
check('写成功且留底', wr.ok === true && typeof wr.backup === 'string', JSON.stringify(wr))
check('内容落盘 v2', fs.readFileSync(path.join(hub, 'memory', 'shared.md'), 'utf8').includes('v2'))
check('留底是 v1', wr.backup && fs.readFileSync(wr.backup, 'utf8').includes('v1'))
const del = await post({ action: 'delete', root: 'hub/memory', path: 'shared.md' })
check('删除 ok + 带回执与作用域说明', del.ok === true && !!del.receipt && !!del.scopeNote, JSON.stringify(del))
check('原文件没了', !fs.existsSync(path.join(hub, 'memory', 'shared.md')))
check('留底完整还在', !!del.backup && fs.existsSync(del.backup))
check('作用域说明提到中枢', del.scopeNote.includes('中枢'))
check('未知动作被拒', (await post({ action: 'nope' })).ok === false)

console.log('')
console.log('── 清理')
srv.close()
fs.rmSync(hub, { recursive: true, force: true })
check('临时中枢已删', !fs.existsSync(hub))

console.log('')
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
