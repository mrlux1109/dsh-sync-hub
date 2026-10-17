/**
 * tests/i18n-keys.cjs —— 中英文文案同键集校验（v2.2 新增，进 test 链）。
 *
 * 用法：node tests/i18n-keys.cjs
 * 退出码 0 = 通过；1 = 键集不一致（打印差异）。
 *
 * 背景：client.js 里 ZH 是真相源，EN 必须与 ZH 完全同键集。
 * 少一个键 → 界面显示原始 key（'kb.title'）；多一个键 → 死文案没人发现。
 */
const fs = require('node:fs')
const path = require('node:path')

const clientPath = path.join(__dirname, '..', 'client.js')
const src = fs.readFileSync(clientPath, 'utf8')

/** 抓 `const ZH = {` 与 `const EN = {` 两段的花括号对象字面量。 */
function extractTable(name) {
  const start = src.indexOf(`const ${name} = {`)
  if (start < 0) throw new Error(`找不到 ${name} 表`)
  let i = src.indexOf('{', start)
  const open = i
  let depth = 0
  for (; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = src.slice(open, i + 1)
  const keys = new Set()
  // 顶层单引号键：'xxx': 或 'xxx':"
  const re = /^\s{6}'([^']+)'\s*:/gm
  let m
  while ((m = re.exec(body)) !== null) keys.add(m[1])
  return keys
}

let zh
let en
try {
  zh = extractTable('ZH')
  en = extractTable('EN')
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
}

const onlyZh = [...zh].filter((k) => !en.has(k)).sort()
const onlyEn = [...en].filter((k) => !zh.has(k)).sort()

console.log(`ZH 键数：${zh.size}`)
console.log(`EN 键数：${en.size}`)

if (onlyZh.length === 0 && onlyEn.length === 0) {
  console.log(`✓ 键集完全一致（${zh.size} 个键）`)
  process.exit(0)
}

if (onlyZh.length) {
  console.log(`\n✗ 只在 ZH（EN 缺失，界面会显示原始 key）：${onlyZh.length} 个`)
  for (const k of onlyZh) console.log(`   - ${k}`)
}
if (onlyEn.length) {
  console.log(`\n✗ 只在 EN（ZH 缺失，死文案）：${onlyEn.length} 个`)
  for (const k of onlyEn) console.log(`   - ${k}`)
}
process.exit(1)
