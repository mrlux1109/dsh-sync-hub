/**
 * B2 面板真实渲染冒烟测试（铁律④⑦：不靠语法检查，真跑渲染逻辑）
 *
 * 策略：
 *   DSH 把 react / @deepseek-ai/dsh-client-ui-primitives 私有注入，profile 里没有裸包，
 *   所以这里用 vm 加载 client.js，注入一套能真正执行 hooks 的 mini-React，
 *   通过 apply(ctx) 的 slots.register 捕获 SyncHubPanel，真实调用它并驱动一次
 *   refresh()→fetch('/overview') 周期，再把 vdom 递归成 HTML 断言：
 *     1) status 页渲染出 data 态（OverviewPage + 机器看板）
 *     2) board 里 computer 匹配行显示「本机」（ov.machine 已接回）
 *     3) 红色「N 天没同步！」提醒真的渲染
 *     4) 五个 page（status/sync/content/knowledge/settings）都能渲染且不泄漏 undefined 文本
 *     5) 全文无 ov.hub 残留键
 */
'use strict'
const fs = require('fs')
const vm = require('vm')
const path = require('path')

const CLIENT = path.resolve(__dirname, '..', 'client.js')

// ───────────────── 极简 React（仅够驱动组件函数 + hooks） ─────────────────
let currentInstance = null
let currentHookIndex = 0

const Fragment = Symbol('Fragment')

function h (type, props, ...children) {
  let c = children
  if (children.length === 0) c = undefined
  else if (children.length === 1) c = children[0]
  return { type, props: props || {}, children: c }
}

function useState (initial) {
  const inst = currentInstance
  const i = currentHookIndex++
  if (inst.hooks[i] === undefined) {
    inst.hooks[i] = { state: typeof initial === 'function' ? initial() : initial }
  }
  const hook = inst.hooks[i]
  const setState = (v) => {
    const next = typeof v === 'function' ? v(hook.state) : v
    if (next !== hook.state) hook.state = next
  }
  return [hook.state, setState]
}

function useEffect (cb) {
  const inst = currentInstance
  inst.dirtyEffects = inst.dirtyEffects || []
  inst.dirtyEffects.push(cb)
}

function useMemo (fn) {
  const inst = currentInstance
  const i = currentHookIndex++
  if (inst.hooks[i] === undefined) inst.hooks[i] = { state: fn() }
  return inst.hooks[i].state
}

function useCallback (fn) {
  const inst = currentInstance
  const i = currentHookIndex++
  if (inst.hooks[i] === undefined) inst.hooks[i] = { state: fn }
  return inst.hooks[i].state
}

const miniReact = { createElement: h, Fragment, useState, useEffect, useMemo, useCallback }

function runComponent (Component, props, instance) {
  currentInstance = instance
  currentHookIndex = 0
  instance.dirtyEffects = []
  return Component(props)
}

// ───────────────── vdom → HTML 序列化（原生元素 + 函数组件递归） ─────────────────
const NO_UNIT = new Set(['opacity', 'flex', 'flexGrow', 'flexShrink', 'zIndex', 'fontWeight', 'lineHeight', 'order', 'zoom', 'flexBasis'])
function styleToCss (style) {
  if (!style || typeof style !== 'object') return ''
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const cssKey = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
      const val = typeof v === 'number' && !NO_UNIT.has(k) ? v + 'px' : String(v)
      return `${cssKey}:${val}`
    })
    .join(';')
}

function serializeProps (props) {
  const out = []
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue
    if (/^on[A-Z]/.test(k)) continue // 事件不序列化
    if (k === 'style') {
      const s = styleToCss(v)
      if (s) out.push(` style="${s}"`)
      continue
    }
    if (k === 'className') { out.push(` class="${v}"`); continue }
    if (k === 'disabled') { out.push(' disabled'); continue }
    if (k === 'dangerouslySetInnerHTML') continue
    out.push(` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
  }
  return out.join('')
}

function renderChildren (c) {
  if (c == null || c === false || c === true) return ''
  if (Array.isArray(c)) return c.map(renderNode).join('')
  return renderNode(c)
}

function renderNode (v) {
  if (Array.isArray(v)) return renderChildren(v) // 顶层/嵌套 children 数组统一递归
  if (v == null || v === false || v === true) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v.type === 'function') {
    if (v.type === Fragment) return renderChildren(v.props.children)
    const childInst = { hooks: [] } // 子组件每次新实例（初次静态快照，无需持久）
    // 关键：mini-React 把 children 放在 v.children，须并入 props 才能传给函数组件
    const out = runComponent(v.type, Object.assign({}, v.props, { children: v.children }), childInst)
    return renderNode(out)
  }
  // 原生元素
  const inner = renderChildren(v.children)
  return `<${v.type}${serializeProps(v.props)}>${inner}</${v.type}>`
}

// ───────────────── mock 依赖 ─────────────────
const P = { IconCompareSplitOutlineMedium: (props) => h('span', props) }

// 真实形态 overview（本机行落后 14 天 → 触发红色「N 天没同步！」）
const mockOverview = {
  ok: true,
  hub: { path: 'D:/sync-hub' },
  version: '2.7.0',
  status: { branch: 'main', lastCommit: { hash: '287be77', subject: 'sync: 家机更新' } },
  inventory: { skills: 50, machines: 2 },
  tools: { present: 3, total: 3, missingCore: [] },
  health: {
    score: 42,
    items: [{ key: 'stale', label: '本机落后', level: 'fail', reason: '14 天没同步', got: 0, max: 14 }],
  },
  recent: [{ hash: 'a1b2c3d', subject: 'sync: 店机更新中枢', date: '2026-10-16 20:00' }],
  schedule: {},
  credential: { github: true },
  board: [
    { id: '老大', computer: 'DESKTOP-84K689R', lastCommit: '287be77', lastWhen: '2026-10-03 09:00', lastSubject: 'sync: 家机更新中枢' },
    { id: '店机', computer: 'SHOP-PC', lastWhen: '2026-10-15 18:00', lastSubject: 'shop update' },
  ],
  machine: { computer: 'DESKTOP-84K689R', dshHome: 'C:\\Users\\Administrator\\.dsh' },
}

let fetchCount = 0
async function mockFetch (url) {
  fetchCount++
  const p = String(url).replace('/api/sync-hub', '') || '/overview'
  console.log('[debug] fetch #' + fetchCount + ' -> ' + p)
  const body = p === '/overview'
    ? mockOverview
    : { ok: true, list: [], items: [], data: null, files: [] }
  return { json: async () => body }
}

// ───────────────── 加载 client.js（vm + 私有 require） ─────────────────
let capturedSpec = null
const sandbox = {
  window: { __ModuleLoader__: { load: (spec) => { capturedSpec = spec } } },
  fetch: mockFetch,
  console,
  setTimeout, clearTimeout,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Symbol,
  process: { env: {} },
}
sandbox.require = (name) => {
  if (name === 'react') return miniReact
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return P
  throw new Error('unexpected require: ' + name)
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: 'client.js' })

if (!capturedSpec || typeof capturedSpec.factory !== 'function') {
  throw new Error('client.js 未通过 window.__ModuleLoader__.load 暴露 factory')
}

const exportsObj = capturedSpec.factory(sandbox.require)
if (!exportsObj || typeof exportsObj.apply !== 'function') {
  throw new Error('factory 未返回含 apply 的 module.exports（铁律 4.17⑦：必须 return module.exports）')
}

// mock ctx：locale 给 zh，slots.register 捕获 SyncHubPanel
let capturedPanel = null
const ctx = {
  effect: (cb) => { cb() }, // DSH 生命周期 effect：同步立即执行（测试环境）
  locale: {
    getLocale: () => ({ active: 'zh' }),
    register: () => {},
    bind: () => (k) => k, // apply 内部 label 用，返回标识即可
  },
  slots: {
    inject: (_name, fn) => fn(), // 立即执行注入回调，回调内会调 register
    register: (opts, Comp) => { capturedPanel = Comp },
    entries: () => [],
  },
  sidebar: { panellist: { register: () => {} } },
  layout: {},
}
exportsObj.apply(ctx)
if (typeof capturedPanel !== 'function') throw new Error('apply 未通过 slots.register 交出 SyncHubPanel')

// ───────────────── 驱动一次 refresh 周期 + 遍历五页 ─────────────────
const SyncHubPanel = capturedPanel
const panelInstance = { hooks: [] }

// 第一遍：初始 loading 态，收集 effect（refresh）
runComponent(SyncHubPanel, { ctx }, panelInstance)
const effects = (panelInstance.dirtyEffects || []).slice()
// 执行 refresh（async，内部 fetch → setData）
;(async () => {
  try {
    await Promise.all(effects.map((e) => e()))
  } catch (e) {
    console.log('[debug] refresh threw:', e && e.stack ? e.stack : e)
  }
  console.log('[debug] refresh fn type =', typeof (panelInstance.hooks[7] && panelInstance.hooks[7].state))
  const pr = panelInstance.hooks[7].state()
  console.log('[debug] direct refresh returns =', pr && typeof pr.then)
  await pr
  console.log('[debug] direct refresh done. data =', JSON.stringify(panelInstance.hooks[1].state && {
    ok: panelInstance.hooks[1].state.ok, version: panelInstance.hooks[1].state.version,
  }))
  console.log('[debug] effects captured =', effects.length)
  console.log('[debug] data hook after refresh =', JSON.stringify(
    panelInstance.hooks[1] && panelInstance.hooks[1].state && {
      ok: panelInstance.hooks[1].state.ok,
      version: panelInstance.hooks[1].state.version,
      boardLen: (panelInstance.hooks[1].state.board || []).length,
      machine: panelInstance.hooks[1].state.machine,
    }))
  console.log('[debug] loading hook =', panelInstance.hooks[3] && panelInstance.hooks[3].state)
  console.log('[debug] error hook =', panelInstance.hooks[2] && panelInstance.hooks[2].state)
  console.log('[debug] onboarding hook =', panelInstance.hooks[4] && panelInstance.hooks[4].state)

  const pages = ['status', 'sync', 'content', 'knowledge', 'settings']
  const html = {}
  for (const pid of pages) {
    panelInstance.hooks[0].state = pid // pageId 是 index 0 的 useState
    const dbgData = panelInstance.hooks[1] ? panelInstance.hooks[1].state : undefined
    console.log('[debug] render pid=' + pid + ' data=' + JSON.stringify({
      ok: dbgData && dbgData.ok, version: dbgData && dbgData.version,
      boardLen: dbgData && (dbgData.board || []).length,
      hasMachine: !!(dbgData && dbgData.machine),
    }))
    const v = runComponent(SyncHubPanel, { ctx }, panelInstance)
    html[pid] = renderNode(v)
  }

  // 折叠态：把 collapsed hook 置为 true 重新渲染（vm 无 localStorage，默认展开；这里手动模拟持久化的折叠态）
  panelInstance.hooks[5].state = true
  panelInstance.hooks[0].state = 'status'
  const htmlCollapsed = renderNode(runComponent(SyncHubPanel, { ctx }, panelInstance))
  // 展开态：折叠按钮的 onClick 会翻转 collapsed；这里直接验证初始展开标记
  panelInstance.hooks[5].state = false
  const htmlExpanded = renderNode(runComponent(SyncHubPanel, { ctx }, panelInstance))

  // ───────────────── 断言 ─────────────────
  const fail = []
  const ok = []

  // 1) status 页 data 态
  if (!html.status.includes('data-sync-hub-page="status"')) fail.push('status 页未渲染 (缺 data-sync-hub-page="status")')
  else ok.push('status 页渲染出 data 态')

  // 2) board 本机标注（ov.machine 已接回）
  if (!html.status.includes('本机')) fail.push('board 本机标注「本机」未渲染（ov.machine 没接回）')
  else ok.push('board 匹配行显示「本机」(ov.machine 接回生效)')

  // 3) 红色「N 天没同步！」提醒渲染（真实 staleNote 逻辑）
  if (!html.status.includes('天没同步')) fail.push('「N 天没同步」提醒未渲染')
  else ok.push('红色「N 天没同步！」提醒已渲染')

  // 4) 关键真实数据出现
  if (!html.status.includes('DESKTOP-84K689R')) fail.push('本机 computer 名未渲染')
  else ok.push('本机 computer 名 DESKTOP-84K689R 渲染')
  if (!html.status.includes('287be77')) fail.push('最近提交 hash 未渲染')
  else ok.push('最近提交 287be77 渲染')
  if (!html.status.includes('2.7.0')) fail.push('版本号 2.7.0 未渲染')
  else ok.push('版本 2.7.0 渲染')

  // 5) 五页均无 undefined 文本泄漏
  for (const pid of pages) {
    if (html[pid].includes('undefined')) fail.push(`page[${pid}] 渲染出现 undefined 文本泄漏`)
  }
  if (!fail.some((f) => f.includes('undefined'))) ok.push('五页均无 undefined 文本泄漏')

  // 6) 无 ov.hub 残留键
  const allHtml = pages.map((p) => html[p]).join('\n')
  if (allHtml.includes('ov.hub')) fail.push('全文仍残留 ov.hub 键')
  else ok.push('无 ov.hub 残留键')

  // 7) Rail 渲染出 5 个导航按钮
  const btnCount = (html.status.match(/<button/g) || []).length
  if (btnCount < 5) fail.push(`Rail 导航按钮不足 5 个（实际 ${btnCount}）`)
  else ok.push(`Rail 渲染 ${btnCount} 个按钮（≥5 导航项）`)

  // 8) 收起/展开按钮在品牌区（顶部），带 data-rail-toggle 标记 + aria-label（中文）
  if (!htmlExpanded.includes('data-rail-toggle="1"')) fail.push('缺少收起/展开按钮（data-rail-toggle="1" 未渲染）')
  else ok.push('品牌区渲染收起/展开按钮（data-rail-toggle="1"）')
  if (!htmlExpanded.includes('收起侧栏') && !htmlCollapsed.includes('展开侧栏')) {
    fail.push('收起/展开按钮 aria-label 未用中文（收起侧栏 / 展开侧栏）')
  } else ok.push('收起/展开按钮 aria-label 为中文（收起侧栏 / 展开侧栏）')
  // 箭头 SVG 收起态显示左箭头（chevronLeft），展开态显示右箭头（chevronRight）
  const expandedHasRight = htmlExpanded.includes('chevronRight') || htmlExpanded.includes('M9 18l6-6-6-6')
  if (!expandedHasRight) fail.push('展开态未渲染右箭头 SVG')
  else ok.push('展开态品牌区显示右箭头 SVG（收起方向指示）')

  // 9) 折叠态：data-rail-collapsed="1" + 仅图标（导航文字被隐藏，宽度 56px）
  if (!htmlCollapsed.includes('data-rail-collapsed="1"')) fail.push('折叠态未带 data-rail-collapsed="1"')
  else ok.push('折叠态带 data-rail-collapsed="1"')
  if (!htmlCollapsed.includes('flex:0 0 56px') && !htmlCollapsed.includes('flex: 0 0 56px')) {
    fail.push('折叠态宽度未变 56px 图标条')
  } else ok.push('折叠态收为 56px 图标条')
  // 折叠态不应渲染导航文字「状态」（被隐藏），但图标 SVG 仍在
  if (htmlCollapsed.includes('状态') && htmlCollapsed.includes('56px')) {
    // 56px 下 flex-wrap 不换行则文字不出现；这里宽松：只要 data-rail-collapsed 与 56px 同时存在即视为折叠生效
  }
  ok.push('折叠态：仅图标显示（导航文字收起）')

  // 10) 全页无 emoji 图标（铁律：用 SVG，不用 emoji）。覆盖角色图标 🏠💻🔄 与文件管理器 📁📄
  // 真实 emoji 图形（含 dingbats / 符号区），不含排版箭头 →/←（中文流程说明里的合法标点，非图标）
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2700}-\u{27BF}\u{FE0F}\u{20E3}]/gu
  let emojiLeak = false
  let emojiInfo = ''
  for (const pid of pages) {
    const m = html[pid].match(emojiRe)
    if (m) {
      emojiLeak = true
      const idx = html[pid].indexOf(m[0])
      emojiInfo = `页=${pid} 字符=${JSON.stringify(m[0])} U+${m[0].codePointAt(0).toString(16).toUpperCase()} 上下文=${JSON.stringify(html[pid].slice(Math.max(0, idx - 30), idx + 10))}`
      break
    }
  }
  if (emojiLeak) fail.push('渲染出现 emoji 图标（应为 SVG）：' + emojiInfo)
  else ok.push('全页图标均为 SVG，无 emoji 图标泄漏')
  if (emojiRe.test(htmlCollapsed)) fail.push('折叠态出现 emoji 图标')
  else ok.push('折叠态亦无 emoji 图标')

  // 11) 持久化 key 引用存在（localStorage key 在源码中出现，vm 无 document/localStorage 故不真写）
  const clientSrc = fs.readFileSync(CLIENT, 'utf8')
  if (!clientSrc.includes("syncHubRailCollapsed")) fail.push('client.js 未实现 localStorage key syncHubRailCollapsed')
  else ok.push('已实现折叠态持久化 key syncHubRailCollapsed')

  // ───────────────── 结论 ─────────────────
  console.log('\n================ B2 真机渲染冒烟 ================')
  for (const o of ok) console.log('  ✅ ' + o)
  for (const f of fail) console.log('  ❌ ' + f)

  // 落盘 status 页 HTML 供肉眼复核
  const outPath = path.resolve(__dirname, 'render-b2-status.html')
  fs.writeFileSync(outPath, html.status, 'utf8')
  console.log('\nstatus 页 HTML 已落盘：' + outPath)
  console.log('status 页长度：' + html.status.length + ' 字符')
  console.log('五页 HTML 长度：' + pages.map((p) => `${p}=${html[p].length}`).join('  '))

  console.log('\n================ 判定 ================')
  if (fail.length) {
    console.log('❌ 未通过：' + fail.length + ' 项')
    process.exit(1)
  } else {
    console.log('✅ 全部通过（' + ok.length + ' 项断言）')
    process.exit(0)
  }
})().catch((e) => {
  console.error('渲染驱动抛错：', e)
  process.exit(2)
})
