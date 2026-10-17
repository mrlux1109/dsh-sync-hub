/**
 * tests/audit.cjs —— 静态自审：死代码 / 悬空 pageId / 未用文案键。
 * 用法：node tests/audit.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
const count = (re) => (src.match(re) || []).length

let problems = 0
const bad = (msg) => { problems += 1; console.log(`  ✗ ${msg}`) }
const ok = (msg) => console.log(`  ✓ ${msg}`)

console.log('── 1) 组件使用情况（定义但没被 h() 调用 = 死代码）')
// 导出入口（module.exports 用）不算死代码
const EXPORTS = new Set(['SyncHubPanel', 'PanelIcon'])
const defs = [...src.matchAll(/^\s{4}function ([A-Z]\w+)/gm)].map((m) => m[1])
const dead = defs.filter((n) => !EXPORTS.has(n) && count(new RegExp(`h\\(${n}\\b`, 'g')) === 0)
if (dead.length) bad(`死代码组件：${dead.join(', ')}（定义未使用）`)
else ok(`${defs.length - EXPORTS.size} 个内部组件全部有引用（导出入口 ${[...EXPORTS].join('/')} 已排除）`)

console.log('')
console.log('── 2) 页签 id 与渲染分派是否对齐')
const PAGES = [...src.matchAll(/\{ id: '(\w+)', labelKey/g)].map((m) => m[1])
const dispatched = [...src.matchAll(/pageId === '(\w+)'/g)].map((m) => m[1])
const orphan = dispatched.filter((p) => !PAGES.includes(p))
const unreachable = PAGES.filter((p) => !dispatched.includes(p))
if (orphan.length) bad(`分派了但 PAGES 里没有：${orphan.join(', ')}`)
if (unreachable.length) bad(`PAGES 里有但永不渲染（点了空白）：${unreachable.join(', ')}`)
if (!orphan.length && !unreachable.length) ok(`页签 ${PAGES.join('/')} 与分派完全对齐`)

console.log('')
console.log('── 3) 文案键：定义了但从未使用（死文案）')
const zhStart = src.indexOf('const ZH = {')
const enStart = src.indexOf('const EN = {')
const zhKeys = [...src.slice(zhStart, enStart).matchAll(/^\s{6}'([^']+)'\s*:/gm)].map((m) => m[1])
// 真引用有三种：① t('key') 字面 ② t(cond ? 'key' : 'other') 三元 ③ labelKey 动态取用
// 注意：不能用"全文出现次数 > 1"当引用——那会让只定义未使用的键自己骗过自己。
const isUsed = (k) => {
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`t\\([^)]*'${esc}'`, 'g').test(src)) return true
  // labelKey 机制：PAGES 里 labelKey: 'page.xxx' → 渲染时 t(page.labelKey)
  return new RegExp(`labelKey: '${esc}'`, 'g').test(src)
}
const unused = zhKeys.filter((k) => !isUsed(k))
if (unused.length) console.log(`  ⚠ 未被 t() 引用的键 ${unused.length} 个：${unused.join(', ')}`)
else ok(`${zhKeys.length} 个文案键全部有引用（含 labelKey 动态取用）`)

console.log('')
console.log(problems === 0 ? '✓ 静态自审通过' : `✗ 发现 ${problems} 个问题`)
process.exit(problems === 0 ? 0 : 1)
