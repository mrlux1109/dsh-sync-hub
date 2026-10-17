/**
 * tests/plugin-apply-e2e.mjs —— 一键更新落地实测（v2.4.1）。
 * 真拉 GitHub tag、真装到临时 DSH_HOME，验证备份/校验/回滚全链路。
 */
import { applyPluginUpdate } from '../lib/hub/plugin-apply.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}
/** 安全读安装目录里的版本号（不存在返回 null，不让测试炸掉）。 */
const verAt = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version } catch { return null }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-e2e-'))
process.env.DSH_HOME = root
const prof = 'e2etest'
const dst = path.join(root, 'profiles', prof, 'node_modules', 'dsh-sync-hub')

console.log('── 参数守卫（不合法必须当场拒，绝不动安装目录）')
check('tag 不合法被拒', (await applyPluginUpdate({ tag: 'main', profile: prof })).ok === false)
check('profile 名带路径被拒', (await applyPluginUpdate({ tag: 'v2.4.0', profile: '../evil' })).ok === false)
check('空 tag 被拒', (await applyPluginUpdate({ tag: '', profile: prof })).ok === false)

console.log('')
console.log('── 真装 v2.4.0（首次：无旧版，备份应为 null）')
fs.mkdirSync(path.dirname(dst), { recursive: true })
const r1 = await applyPluginUpdate({ tag: 'v2.4.0', profile: prof })
check('更新成功', r1.ok === true, r1.error)
check('版本 = 2.4.0', r1.version === '2.4.0', JSON.stringify(r1))
check('package.json 落盘', fs.existsSync(path.join(dst, 'package.json')))
check('client.js 落盘', fs.existsSync(path.join(dst, 'client.js')))
check('lib/hub/plugin-update.js 落盘（整套拷全）', fs.existsSync(path.join(dst, 'lib', 'hub', 'plugin-update.js')))
check('lib/hub/workspace.js 落盘', fs.existsSync(path.join(dst, 'lib', 'hub', 'workspace.js')))
check('tests/ 不进安装（files 清单外）', !fs.existsSync(path.join(dst, 'tests')))
check('回读版本一致', verAt(dst) === '2.4.0', `实际=${verAt(dst)}`)

console.log('')
console.log('── 二次更新（v2.3.2 → 应产生 .bak 留底，P2 不删旧）')
const r2 = await applyPluginUpdate({ tag: 'v2.3.2', profile: prof })
check('降级也照装（用户说了算）', r2.ok === true, r2.error)
check('版本 = 2.3.2', r2.version === '2.3.2')
check('备份目录存在', !!r2.backup && fs.existsSync(r2.backup), r2.backup)
check('备份里还是 2.4.0（旧版完整留底）', !!r2.backup && verAt(r2.backup) === '2.4.0', `备份版本=${r2.backup ? verAt(r2.backup) : '无备份'}`)

console.log('')
console.log('── 不存在的 tag（应失败且不动现有安装）')
const before = verAt(dst)
const r3 = await applyPluginUpdate({ tag: 'v99.99.99', profile: prof })
check('假 tag 失败', r3.ok === false, JSON.stringify(r3).slice(0, 150))
check('现有安装没被动（版本仍是 2.3.2）', verAt(dst) === before && before === '2.3.2', `before=${before} after=${verAt(dst)}`)

console.log('')
console.log('── 清理')
fs.rmSync(root, { recursive: true, force: true })
check('临时目录已删', !fs.existsSync(root))

console.log('')
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
