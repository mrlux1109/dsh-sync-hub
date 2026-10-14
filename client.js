/**
 * dsh-sync-hub v2.0 —— 浏览器半身：侧栏入口 + 六页同步中枢面板。
 *
 * 与旧版（v0.11.0 bat 演化版）的本质区别：
 *   旧版 = 设置页里的 8 Tab 应用（settings.section，inject 为空，手写组件/字典/fetch）；
 *   本版 = 标准 DSH 客户端插件：
 *     · manifest 声明 dsh.client.inject 拿官方模块（locale/slots/primitives/layout）；
 *     · 侧栏入口走官方 `sidebar.panellist` 插槽（与插件管理器、任务管理器同级）；
 *     · 内容区走官方 `main` keyed 插槽（key = 'sync-hub'，不抢内置 'conversation'）；
 *     · 组件全部用官方 primitives；文案走 ctx.locale 扁平键。
 *
 * 契约铁律（memory 4.17⑦ 实锤，违反即整包黑屏）：
 *   1. factory **必须 return module.exports**，返回 module 本体 = 同 bundle 连坐黑屏；
 *   2. 组件辅助函数收多个子元素用 rest 参数 `(t, key, ...kids)`；
 *   3. 不抢内置插槽 key；注册前 slots.entries 探一次，撞名 fail-fast；
 *   4. 文案只用扁平键（ctx.locale.bind 不解析 'a.b' 嵌套键）。
 *
 * @module client.js
 */

window.__ModuleLoader__.load({
  id: 'dsh-sync-hub',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const { createElement: h, Fragment, useState, useEffect, useMemo, useCallback } = React
    const P = require('@deepseek-ai/dsh-client-ui-primitives')

    /** 本插件的文案命名空间。 */
    const NS = 'syncHub'
    /** 侧栏入口 id 与 main 面板 key —— 两者必须相同（插槽契约：list id 寻址对应面板）。 */
    const PANEL_ID = 'sync-hub'
    /** 六个一级页（开发文档 §4.2，决策 D5）。 */
    const PAGES = [
      { id: 'overview', labelKey: 'page.overview' },
      { id: 'sync', labelKey: 'page.sync' },
      { id: 'skills', labelKey: 'page.skills' },
      { id: 'memory', labelKey: 'page.memory' },
      { id: 'sessions', labelKey: 'page.sessions' },
      { id: 'maintain', labelKey: 'page.maintain' },
    ]
    /** 浏览器半身依赖的服务（对应 manifest dsh.client.inject 的四个包）。 */
    const inject = ['slots', 'locale', 'layout']

    /** 扁平键文案表：zh 为真相源，en 必须同键集。 */
    const ZH = {
      'panel': '同步中枢',
      'page.overview': '总览',
      'page.sync': '同步',
      'page.skills': '技能',
      'page.memory': '记忆·配置',
      'page.sessions': '会话',
      'page.maintain': '维护',
      'loading': '读取中…',
      'error': '加载失败：{e}',
      'retry': '重试',
      'stale': '插件刚更新过，需要重启 DSH 才能加载新面板。',
      'todo.placeholder': '（本页施工中）',
    }
    const EN = {
      'panel': 'Sync Hub',
      'page.overview': 'Overview',
      'page.sync': 'Sync',
      'page.skills': 'Skills',
      'page.memory': 'Memory · Config',
      'page.sessions': 'Sessions',
      'page.maintain': 'Maintain',
      'loading': 'Loading…',
      'error': 'Load failed: {e}',
      'retry': 'Retry',
      'stale': 'The plugin just updated. Restart DSH to load the new panel.',
      'todo.placeholder': '(under construction)',
    }

    /** 简易占位符填充：'x {a} y' + {a:1} → 'x 1 y'。 */
    function fill(text, args) {
      if (typeof text !== 'string' || !args) return text
      let s = text
      for (const [k, v] of Object.entries(args)) s = s.split('{' + k + '}').join(String(v))
      return s
    }

    /**
     * 侧栏入口图标。
     * 收 owner 提供的 { size, active }（SidebarPanelIconOwnerProps），
     * 图标用 primitives 官方语义图标（决策 D18），零维护、与官方视觉一致。
     */
    function PanelIcon({ size }) {
      return h(P.IconCompareSplitOutlineMedium, { size })
    }

    /** 一页占位：施工期给结构反馈，不假装功能已好。 */
    function PageStub({ t, label }) {
      return h('div', {
        style: {
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'flex-start',
        },
        'data-sync-hub-page': 'stub',
      },
        h('p', { style: { margin: 0, opacity: 0.6 } }, label),
        h('p', { style: { margin: 0, opacity: 0.4 } }, t('todo.placeholder')),
      )
    }

    /** 页头 + 页体。 */
    function Page({ t, pageId, children }) {
      const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0]
      return h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          height: '100%',
          overflow: 'auto',
        },
        'data-sync-hub-page': pageId,
      },
        h('div', {
          style: {
            padding: '16px 20px 8px',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
          },
        },
          h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, t(page.labelKey)),
        ),
        h('div', { style: { padding: '8px 20px 20px' } }, children),
      )
    }

    /**
     * 同步中枢主面板（main 插槽的 key = PANEL_ID 的正文）。
     *
     * 标准 props 由框架免费提供：useResource / useWorkspaces / usePanelInfo /
     * useSessions / t / renderSlot；另有本插件 inject 注入的字段。
     */
    function SyncHubPanel({ t }) {
      const [pageId, setPageId] = useState('overview')

      return h('div', {
        style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
        'data-sync-hub-panel': PANEL_ID,
      },
        // 页签条：固定尺寸，不随内容跳动（memory 4.20）。
        h('div', {
          role: 'tablist',
          'aria-label': t('panel'),
          style: {
            display: 'flex',
            gap: 4,
            padding: '8px 20px 0',
            borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))',
            flex: '0 0 auto',
          },
        }, PAGES.map((p) => h('button', {
          key: p.id,
          type: 'button',
          role: 'tab',
          'aria-selected': pageId === p.id,
          onClick: () => setPageId(p.id),
          style: {
            appearance: 'none',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: '8px 12px',
            fontSize: 13,
            lineHeight: '20px',
            color: pageId === p.id
              ? 'var(--dsw-alias-label-primary, inherit)'
              : 'var(--dsw-alias-label-tertiary, inherit)',
            borderBottom: pageId === p.id
              ? '2px solid var(--dsw-alias-border-brand, currentColor)'
              : '2px solid transparent',
          },
          'data-sync-hub-tab': p.id,
        }, t(p.labelKey)))),
        // 页体
        h('div', { style: { flex: '1 1 auto', minHeight: 0 } },
          h(Page, { t, pageId }, h(PageStub, { t, label: t((PAGES.find((p) => p.id === pageId) ?? PAGES[0]).labelKey) })),
        ),
      )
    }

    /**
     * 客户端插件入口。
     * @param {object} ctx - client root context。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)

      // ① 文案：扁平键，官方解析（不再手写嵌套 reduce 解析器）。
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'sync-hub: dictionaries')

      // ② 侧栏入口（与插件管理器 / 任务管理器同一插槽）。
      //    注册前探测撞名：同一 id 二次注册会 throw，宁可 fail-fast 也不黑屏。
      ctx.effect(() => {
        const taken = (ctx.slots.entries?.('sidebar.panellist') ?? [])
          .some((entry) => entry?.options?.id === PANEL_ID)
        if (taken) throw new Error(`sync-hub: sidebar.panellist id "${PANEL_ID}" already taken`)
        return ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          locale: NS,
          label: () => t('panel'),
        }, PanelIcon))
      }, 'sync-hub: sidebar entry')

      // ③ 右侧内容区（main keyed 插槽，key 与侧栏入口 id 相同）。
      ctx.effect(() => {
        const taken = (ctx.slots.entries?.('main') ?? [])
          .some((entry) => entry?.key === PANEL_ID)
        if (taken) throw new Error(`sync-hub: main key "${PANEL_ID}" already taken`)
        return ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, SyncHubPanel))
      }, 'sync-hub: main panel')
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'sync-hub'
    // ⚠️ 铁律：必须 return module.exports（带 apply 的对象），不能 return module。
    return module.exports
  },
})
