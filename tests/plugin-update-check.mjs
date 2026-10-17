/**
 * tests/plugin-update-check.mjs —— 插件更新检查实测（v2.3.1）。
 * 真调 ls-remote + 真起 API，验证「检查更新」按钮整条链路。
 */
import { checkPluginUpdate, compareVersions, resolveInstalledPlugin } from '../lib/hub/plugin-update.js'
import { createApiHandler } from '../lib/api.js'
import http from 'node:http'

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}

console.log('── 版本比较')
check('v2.3.0 < v2.3.1', compareVersions('2.3.0', '2.3.1') < 0)
check('v2.0.8 < v2.3.0', compareVersions('2.0.8', '2.3.0') < 0)
check('v2.3.0 == v2.3.0', compareVersions('2.3.0', 'v2.3.0') === 0)
check('v2.10.0 > v2.9.0', compareVersions('2.10.0', '2.9.0') > 0)

console.log('')
console.log('── 本地版本发现（profile 遍历）')
const local = resolveInstalledPlugin()
check(`找到本机安装（${local.where}，版本 ${local.version}）`, local.found && /^\d+\.\d+\.\d+$/.test(local.version), JSON.stringify(local))

console.log('')
console.log('── 真调 GitHub ls-remote（异步不阻塞）')
const t0 = Date.now()
const r = await checkPluginUpdate()
const secs = ((Date.now() - t0) / 1000).toFixed(1)
check('检查成功', r.ok === true, JSON.stringify(r).slice(0, 300))
check(`最新 tag 像版本号（${r.latest}）`, /^v?\d+\.\d+\.\d+$/.test(String(r.latest ?? '')))
check(`v2.3.0 应能检出（tag 已推）`, r.latest === 'v2.3.0' || compareVersions(r.latest, 'v2.3.0') > 0, `latest=${r.latest}`)
check('耗时合理（<20s）', Number(secs) < 20, `${secs}s`)
console.log(`  实测：${local.version} → ${r.latest}（${secs}s，${local.where}）`)

console.log('')
console.log('── API 端到端 POST /content {action:plugin-update-check}')
const HUB = 'D:\\【AI智能】\\DSH\\sync-hub'
const handler = createApiHandler({ hubPath: () => HUB, config: {} })
const srv = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://x').pathname))
await new Promise((res2) => srv.listen(0, '127.0.0.1', res2))
const base = `http://127.0.0.1:${srv.address().port}`
const g = await (await fetch(`${base}/content`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'plugin-update-check' }),
})).json()
check('API 返回 ok', g.ok === true, JSON.stringify(g).slice(0, 200))
check('update 结构完整', !!g.update && typeof g.update.hasUpdate === 'boolean' && typeof g.update.latest === 'string')
check('update.where 有值', typeof g.update?.where === 'string' && g.update.where.length > 0)
srv.close()

console.log('')
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
