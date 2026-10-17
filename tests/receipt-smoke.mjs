/**
 * tests/receipt-smoke.cjs —— 回执三段式实测（v2.2 S6）。
 *
 * 不是语法检查，是真的调用 lib/hub/* 模块，看回执长成什么样。
 * 用法：node tests/receipt-smoke.cjs
 */
import { registerTools } from '../lib/tools.js'
import { hubStatus, hubInventory } from '../lib/hub/status.js'
import { compareSkills } from '../lib/hub/skills.js'

const HUB = 'D:\\【AI智能】\\DSH\\sync-hub'

/** 起一个假 ctx，把注册到的工具收进 Map。 */
function collector() {
  const tools = new Map()
  const ctx = { tools: { register: (d) => tools.set(d.name, d) }, logger: { error: console.error } }
  return { tools, ctx }
}

const { tools, ctx } = collector()
const n = registerTools(ctx, { config: {}, getHub: () => HUB })
console.log(`注册工具数：${n}（期望 13）`)
console.log(`工具名：${[...tools.keys()].join(', ')}`)
console.log('')

async function show(name, args = {}) {
  const d = tools.get(name)
  if (!d) return console.log(`✗ 找不到工具 ${name}`)
  const r = await d.execute(args, {})
  const out = d.output.render({}, r)
  console.log(`── ${name} ${'─'.repeat(Math.max(0, 46 - name.length))}`)
  console.log(out[0].text)
  console.log('')
}

await show('sync_hub_status')
await show('sync_hub_skill_list')
await show('sync_hub_version')
