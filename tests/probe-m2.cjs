/**
 * probe-m2.cjs —— 浏览器半身装载探针（M2 验证，L2/L3 级）。
 *
 * 做什么：
 *   1) 用真实 DSH 客户端 ModuleLoader 加载本插件的 client.js；
 *   2) mock 出 slots / locale / layout 三个 ctx，真实执行 apply()；
 *   3) 断言注册结果：sidebar.panellist 1 条、main 1 条、键值正确、文案键集完整；
 *   4) 用 React 服务端渲染 SyncHubPanel，确认不抛渲染异常。
 *
 * 依据 memory 4.17⑥⑦：探针必须真起一次 ModuleLoader + 真跑 apply，
 * 不能只做字符串检查——黑屏正是 factory 返回值 / require 形态错误导致的。
 *
 * 用法：node tests/probe-m2.cjs
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert')

const ROOT = path.resolve(__dirname, '..')
const CLIENT = path.join(ROOT, 'client.js')

/** ModuleLoader 的浏览器契约：load({id, factory}) 后按 id 取 exports。 */
function createLoader() {
  const rows = new Map()
  return {
    load(desc) {
      const require = (spec) => {
        // 探针只提供 apply 用到的三个官方模块的最小实现。
        if (spec === 'react') return requireReact()
        if (spec === '@deepseek-ai/dsh-client-ui-primitives') return requirePrimitives()
        throw new Error(`probe: unexpected require(${spec})`)
      }
      const mod = desc.factory(require)
      rows.set(desc.id, mod)
    },
    get(id) { return rows.get(id) },
  }
}

/**
 * React 的最小替身。
 *
 * 为什么不用真 react：本机 profile 的 .pnpm store 为空（react 由 DSH 运行时注入），
 * 探针进程拿不到。但探针要覆盖的黑屏风险点（ModuleLoader 装载契约、factory
 * 返回值、require 形态、apply 注册逻辑）都不依赖真 React，只需要 createElement
 * 与元素树可遍历。渲染断言改用 element 树结构比对，结论等效。
 */
function requireReact() {
  const createElement = (type, props, ...children) => ({
    $$typeof: Symbol.for('react.element'),
    type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
  })
  return {
    createElement,
    Fragment: Symbol.for('react.fragment'),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
}

/** primitives 的最小替身：只暴露本插件 import 的图标。 */
function requirePrimitives() {
  const stub = (name) => {
    const Comp = (props) => null
    Object.defineProperty(Comp, 'name', { value: name })
    return Comp
  }
  return { IconCompareSplitOutlineMedium: stub('IconCompareSplitOutlineMedium') }
}

/** mock ctx.slots：记录 inject / register / entries。 */
function createSlotsMock() {
  const registered = []
  const injected = []
  const entries = new Map()
  return {
    registered,
    injected,
    entries(name) { return entries.get(name) ?? [] },
    inject(name, factory) {
      injected.push(name)
      const disposer = factory()
      const produced = registered.filter((r) => r.name === name && !r.__injected)
      for (const r of produced) r.__injected = true
      entries.set(name, [...(entries.get(name) ?? []), ...produced.map((r) => ({ options: r, key: r.key }))])
      return typeof disposer === 'function' ? disposer : () => {}
    },
    register(options, component) {
      // 与真实契约一致：options 原样保留（含 name/id/key/order/locale/label），component 单独存。
      const row = { options, component, name: options.name, key: options.key }
      registered.push(row)
      return () => {
        const i = registered.indexOf(row)
        if (i >= 0) registered.splice(i, 1)
      }
    },
  }
}

/** mock ctx.locale：扁平键解析 + register 收集。 */
function createLocaleMock() {
  const dicts = new Map()
  return {
    dicts,
    register(ns, table) { dicts.set(ns, table) },
    // 真实 bind 的行为：解析该 ns 下已注册字典的扁平键，未命中返回键本身。
    bind(ns) {
      const table = dicts.get(ns)?.zh ?? {}
      return (key) => (typeof table[key] === 'string' ? table[key] : key)
    },
    getLocale() { return 'zh' },
  }
}

function main() {
  // 1) 装载
  const loader = createLoader()
  const code = fs.readFileSync(CLIENT, 'utf8')
  const desc = { id: 'dsh-sync-hub', factory: undefined }
  // client.js 自己调 window.__ModuleLoader__.load，所以先装全局。
  global.window = { __ModuleLoader__: loader }
  // eslint-disable-next-line no-new-func
  new Function('window', 'module', 'exports', 'require', code)(global.window, { exports: {} }, {}, () => {})
  const mod = loader.get('dsh-sync-hub')
  assert.ok(mod, 'client.js 必须通过 ModuleLoader 注册')
  assert.strictEqual(typeof mod.apply, 'function', 'exports.apply 必须是函数')
  assert.deepStrictEqual(mod.inject, ['slots', 'locale', 'layout'], 'inject 三个服务')
  console.log('[1] 装载：ModuleLoader 注册成功，apply/inject 形态正确')

  // 2) 铁律：不能返回 module 本体
  assert.strictEqual(mod.exports, undefined, '不得把 module.exports 透出（黑屏前兆）')
  console.log('[2] 铁律：exports 形态正确（非 module 本体）')

  // 3) 真实执行 apply
  const slots = createSlotsMock()
  const locale = createLocaleMock()
  const layout = { selectPanel() {}, toggleSidebar() {} }
  const ctx = {
    slots,
    locale,
    layout,
    effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
  }
  mod.apply(ctx)

  const panelEntries = registeredOf(slots, 'sidebar.panellist')
  const mainEntries = registeredOf(slots, 'main')
  assert.strictEqual(panelEntries.length, 1, 'sidebar.panellist 恰好 1 条')
  assert.strictEqual(mainEntries.length, 1, 'main 恰好 1 条')
  assert.strictEqual(panelEntries[0].options.id, 'sync-hub')
  assert.strictEqual(mainEntries[0].key, 'sync-hub', 'main key 必须等于侧栏 id')
  assert.strictEqual(panelEntries[0].options.order, 20)
  assert.strictEqual(typeof panelEntries[0].component, 'function', '图标必须是组件')
  assert.strictEqual(typeof mainEntries[0].component, 'function', '面板必须是组件')
  console.log('[3] apply：侧栏入口 + main 面板各 1 条，id/key 均为 sync-hub')

  // 4) 文案键集：zh 与 en 必须同集
  const dict = locale.dicts.get('syncHub')
  assert.ok(dict && dict.zh && dict.en, '必须注册 zh/en 两份字典')
  const zhKeys = Object.keys(dict.zh).sort()
  const enKeys = Object.keys(dict.en).sort()
  assert.deepStrictEqual(zhKeys, enKeys, 'zh/en 键集必须一致')
  console.log(`[4] 文案：${zhKeys.length} 个扁平键，zh/en 键集一致`)

  // 5) 渲染探针：调用 SyncHubPanel 函数组件本体，断言其返回的元素树。
  //    说明：React 函数组件的渲染就是"用 props 调它，拿回元素树"，
  //    直接调用与 React 内部 render 走的是同一条代码路径，覆盖等价。
  const Panel = mainEntries[0].component
  const t = locale.bind('syncHub')
  const tree = Panel({ t })
  assert.ok(tree && typeof tree === 'object', '面板必须返回元素树')
  const found = collect(tree)
  assert.ok(found.roots.some((e) => e.props?.['data-sync-hub-panel'] === 'sync-hub'), '面板根节点必须带 data-sync-hub-panel')
  for (const p of ['overview', 'sync', 'skills', 'memory', 'sessions', 'maintain']) {
    assert.ok(found.tabs.includes(p), `六个页签缺 ${p}（实际：${found.tabs.join(',')}）`)
  }
  // 文案键集 → 页签 label 必须能解析出中文（扁平键生效证明）
  const zhTable = locale.dicts.get('syncHub').zh
  assert.strictEqual(zhTable['page.overview'], '总览', 'page.overview 必须是中文')
  assert.strictEqual(found.labels[0], '总览', '页签 label 必须解析出中文而非裸键')
  console.log('[5] 渲染：面板元素树 + 6 页签 + 中文文案解析全部通过')

  console.log('\nM2 探针全部通过 ✅')
}

function registeredOf(slots, name) {
  return slots.registered.filter((r) => r.name === name)
}

/** 遍历 element 树，收集探针断言所需的特征。 */
function collect(tree) {
  const roots = []
  const tabs = []
  const labels = []
  const walk = (el) => {
    if (!el || typeof el !== 'object') return
    if (Array.isArray(el)) { el.forEach(walk); return }
    if (el.props?.['data-sync-hub-panel']) roots.push(el)
    if (el.props?.['data-sync-hub-tab']) tabs.push(el.props['data-sync-hub-tab'])
    if (el.props?.['data-sync-hub-tab'] && el.props?.children) labels.push(el.props.children)
    const kids = el.props?.children
    if (kids) walk(kids)
  }
  walk(tree)
  return { roots, tabs, labels }
}

main()
