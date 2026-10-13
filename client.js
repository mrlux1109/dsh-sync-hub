/**
 * dsh-sync-hub — browser half (settings card).
 *
 * Contributes ONE thing: a settings section (`settings.section` id `sync-hub`)
 * showing hub version / last commit / dirty count, with buttons for the four
 * safe operations (status, push, pull, open interactive console). Everything
 * goes over the plugin's own same-origin `/api/sync-hub/*` routes served by
 * the host half (index.js), so the card works on any kernel line this plugin
 * targets without a typed Remote binding.
 *
 * Contract verified against dsh-our-free-model's client.js (same ModuleLoader
 * bundle form, same slots/locale usage):
 *   - window.__ModuleLoader__.load({ id, factory: require => {...} })
 *   - inject = ['slots', 'locale']; React comes from the shell via require('react')
 *   - apply(ctx): ctx.locale.bind(NS) + ctx.locale.register(NS, dicts),
 *     then ctx.slots.inject('settings.section', () => ctx.slots.register({...},
 *     props => h(Page, {...})))
 *   - colors via CSS custom properties with fallbacks so theme switches survive.
 *
 * No build step, no dependency beyond react.
 *
 * @module client.js
 */
window.__ModuleLoader__.load({
  id: 'dsh-sync-hub',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, Fragment, useState, useEffect, useCallback } = React

    const NS = 'settings.syncHub'
    const inject = ['slots', 'locale']

    const DICT = {
      zh: {
        'nav': '同步中枢',
        'title': '同步中枢 · sync-hub',
        'subtitle': '两台电脑的 AI 记忆 / 技能 / 配置同步（Gitee 私有仓库）',
        'version': '版本',
        'commit': '最新提交',
        'skills': '技能',
        'dirty0': '工作区干净',
        'dirtyN': '{n} 个未提交改动',
        'notFound': '本机未找到 sync-hub（检查 config.hubPath）',
        'loading': '读取中…',
        'error': '后端不可达：{e}',
        'act.refresh': '刷新',
        'act.status': '查看差异',
        'act.push': '上传备份',
        'act.pull': '拉取并应用',
        'act.console': '打开控制台',
        'hint.pull': '拉取会应用到 DSH，重启后生效；冲突会停下并报告。',
        'hint.console': '换身份 / 一条龙 / 冲突处理等人操作在窗口里完成。',
        'busy': '执行中…（同步操作可能要十几秒）',
        'confirmPush': '先跑一次「查看差异」再上传？',
        'cred.title': 'Gitee 凭据（新机上传/拉取一次录入）',
        'cred.have': '已保存',
        'cred.none': '未保存 —— push/clone 会失败',
        'cred.user': 'Gitee 用户名',
        'cred.token': '私人令牌（只写不回显）',
        'cred.save': '保存并测试',
        'cred.where': '令牌存 Windows 凭据管理器（git credential），永不写入任何文件或仓库。',
        'hint.token': '拿令牌：gitee.com → 设置 → 私人令牌（勾 projects 权限）；新机器也可用菜单 [22] 接入向导。',
      },
      en: {
        'nav': 'Sync Hub',
        'title': 'Sync Hub · sync-hub',
        'subtitle': 'Cross-machine AI memory / skills / config (private Gitee repo)',
        'version': 'Version',
        'commit': 'Last commit',
        'skills': 'Skills',
        'dirty0': 'working tree clean',
        'dirtyN': '{n} uncommitted change(s)',
        'notFound': 'sync-hub not found on this machine (check config.hubPath)',
        'loading': 'Loading…',
        'error': 'Backend unreachable: {e}',
        'act.refresh': 'Refresh',
        'act.status': 'Status',
        'act.push': 'Push',
        'act.pull': 'Pull & apply',
        'act.console': 'Open console',
        'hint.pull': 'Pull applies to DSH (restart to take effect); conflicts stop and report.',
        'hint.console': 'Identity switch / first-run setup / conflict fixes stay manual in the window.',
        'busy': 'Running… (sync may take a few tens of seconds)',
        'confirmPush': 'Run Status before pushing?',
        'cred.title': 'Gitee credential (enter once on a new machine)',
        'cred.have': 'stored',
        'cred.none': 'no credential — push/clone will fail',
        'cred.user': 'Gitee username',
        'cred.token': 'private token (write-only)',
        'cred.save': 'Save & test',
        'cred.where': 'Stored in the Windows Credential Manager via git credential — never written to any file or repo.',
        'hint.token': 'Token: gitee.com → Settings → Private Token (projects scope). On a fresh machine, menu [22] runs the full wizard.',
      },
    }

    const API = (() => {
      try { return new URL('api/sync-hub', document.baseURI).pathname } catch { return '/api/sync-hub' }
    })()

    async function api(path, options) {
      const { timeout = 8000, ...fetchOptions } = options ?? {}
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const response = await fetch(`${API}${path}`, { ...fetchOptions, redirect: 'error', signal: ctrl.signal })
        const text = await response.text()
        let payload
        try { payload = text === '' ? {} : JSON.parse(text) } catch { payload = { error: text.slice(0, 200) } }
        if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
        return payload
      } finally {
        clearTimeout(timer)
      }
    }
    const post = (path, body, timeout) => api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
      ...timeout === undefined ? {} : { timeout },
    })

    const CARD = {
      label: { fontSize: '0.75rem', opacity: 0.65, minWidth: '4.5rem' },
      value: { fontSize: '0.85rem' },
      btn: {
        padding: '0.35rem 0.8rem', borderRadius: '0.5rem', fontSize: '0.8rem',
        border: '1px solid var(--color-border, rgba(128,128,128,0.35))',
        background: 'var(--color-surface, rgba(128,128,128,0.08))',
        color: 'var(--color-text, inherit)', cursor: 'pointer',
      },
      input: {
        padding: '0.35rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.78rem', width: '12rem',
        border: '1px solid var(--color-border, rgba(128,128,128,0.35))',
        background: 'var(--color-surface, rgba(128,128,128,0.06))',
        color: 'var(--color-text, inherit)',
      },
      pre: {
        marginTop: '0.5rem', padding: '0.6rem', borderRadius: '0.5rem', fontSize: '0.72rem',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '14rem', overflow: 'auto',
        background: 'var(--color-surface, rgba(128,128,128,0.08))',
        border: '1px solid var(--color-border, rgba(128,128,128,0.25))',
      },
    }

    function Row(t, label, value) {
      return h('div', { style: { display: 'flex', gap: '0.75rem', padding: '0.25rem 0' } },
        h('span', { style: CARD.label }, t(label)),
        h('span', { style: CARD.value }, value))
    }

    function SyncHubPage({ t }) {
      const [info, setInfo] = useState(undefined)
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState(false)
      const [output, setOutput] = useState(undefined)
      const [cred, setCred] = useState(undefined)
      const [cUser, setCUser] = useState('')
      const [cToken, setCToken] = useState('')

      const loadCred = useCallback(() => {
        api('/cred').then(setCred).catch(() => setCred({ ok: false }))
      }, [])
      const load = useCallback(() => {
        setErr('')
        api('/info')
          .then(payload => { setInfo(payload); if (!payload.ok) setErr('notFound') })
          .catch(e => setErr(String(e?.message ?? e)))
        loadCred()
      }, [loadCred])
      useEffect(() => { load() }, [load])

      const run = useCallback(async (kind) => {
        setBusy(true)
        setOutput(undefined)
        try {
          let payload
          if (kind === 'status') payload = await api('/status', { timeout: 90_000 })
          else if (kind === 'pull') payload = await post('/pull', undefined, 180_000)
          else if (kind === 'console') payload = await post('/console')
          else if (kind === 'saveCred') {
            payload = await post('/cred', { username: cUser, token: cToken }, 120_000)
            setCToken('')
            loadCred()
          }
          else payload = await post('/push', {}, 180_000)
          setOutput(payload?.text ?? JSON.stringify(payload))
          if (kind === 'pull' || kind === 'push') load()
        } catch (e) {
          setOutput(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }, [load, loadCred, cUser, cToken])

      const button = (key, kind) => h('button', {
        key, type: 'button', style: CARD.btn, disabled: busy,
        onClick: () => run(kind),
      }, t('act.' + key))

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.9rem', maxWidth: '46rem' } },
        h('section', {},
          h('h2', { style: { fontSize: '1.05rem', margin: '0 0 0.15rem' } }, t('title')),
          h('p', { style: { fontSize: '0.8rem', opacity: 0.7, margin: 0 } }, t('subtitle'))),

        h('section', { style: { display: 'flex', flexDirection: 'column', gap: '0.15rem' } },
          info === undefined && !err
            ? h('p', { style: { fontSize: '0.8rem', opacity: 0.6 } }, t('loading'))
            : info && info.ok
              ? h(Fragment, {},
                  Row(t, 'version', 'v' + info.version + '  ·  ' + info.machine),
                  Row(t, 'commit', [info.commit, info.commitDate, info.commitSubject].filter(Boolean).join(' | ')),
                  Row(t, 'skills', String(info.skills)),
                  Row(t, 'dirty', info.dirty === 0 ? t('dirty0') : info.dirty > 0 ? t('dirtyN').replace('{n}', String(info.dirty)) : ''))
              : h('p', { style: { fontSize: '0.8rem', color: 'var(--color-danger, #d33)' } },
                  err === 'notFound' ? t('notFound') : t('error').replace('{e}', err))),

        h('section', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
          h('button', { key: 'r', type: 'button', style: CARD.btn, disabled: busy, onClick: load }, t('act.refresh')),
          button('status', 'status'),
          button('push', 'push'),
          button('pull', 'pull'),
          button('console', 'console')),

        busy ? h('p', { style: { fontSize: '0.75rem', opacity: 0.65 } }, t('busy')) : null,
        output !== undefined ? h('pre', { style: CARD.pre }, output) : null,

        h('section', { style: { display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid var(--color-border, rgba(128,128,128,0.25))', paddingTop: '0.7rem' } },
          h('h3', { style: { fontSize: '0.85rem', margin: 0 } }, t('cred.title')),
          cred === undefined
            ? h('p', { style: { fontSize: '0.75rem', opacity: 0.6 } }, t('loading'))
            : h('p', { style: { fontSize: '0.78rem', margin: 0 } },
                cred.hasCredential
                  ? h(Fragment, {}, h('span', { style: { color: 'var(--color-success, #2a9)' } }, t('cred.have')), '  ' + (cred.username || '') + (cred.repoHost ? '  ·  ' + cred.repoHost : ''))
                  : h('span', { style: { color: 'var(--color-danger, #d33)' } }, t('cred.none'))),
          h('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } },
            h('input', { type: 'text', placeholder: t('cred.user'), value: cUser, disabled: busy, style: CARD.input, onChange: e => setCUser(e.target.value) }),
            h('input', { type: 'password', placeholder: t('cred.token'), value: cToken, disabled: busy, style: CARD.input, onChange: e => setCToken(e.target.value) }),
            h('button', { type: 'button', style: CARD.btn, disabled: busy || !cUser || !cToken, onClick: () => run('saveCred') }, t('cred.save'))),
          h('p', { style: { fontSize: '0.68rem', opacity: 0.5, margin: 0 } }, t('cred.where')),
          h('p', { style: { fontSize: '0.68rem', opacity: 0.5, margin: 0 } }, t('hint.token'))),

        h('p', { style: { fontSize: '0.7rem', opacity: 0.55 } }, t('hint.pull')),
        h('p', { style: { fontSize: '0.7rem', opacity: 0.55 } }, t('hint.console')))
    }

    function localeTag(ctx) {
      try {
        const snapshot = typeof ctx.locale?.getLocale === 'function' ? ctx.locale.getLocale() : ctx.locale?.getSnapshot?.()
        const value = snapshot?.active ?? ctx.locale?.locale
        return typeof value === 'string' && value.startsWith('en') ? 'en' : 'zh'
      } catch {
        return 'zh'
      }
    }

    function apply(ctx) {
      const t0 = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'dsh-sync-hub: dictionaries')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'sync-hub',
        order: 36,
        label: () => t0('nav'),
        locale: NS,
      }, props => h(SyncHubPage, { ...props, t: (key, args) => fill(t0(key), localeTag(ctx), args) })))
    }

    // dict values may embed {placeholders}; the slot render uses a tiny filler
    function fill(text, locale, args) {
      if (typeof text !== 'string' || !args) return text
      let out = text
      for (const [k, v] of Object.entries(args)) out = out.replace('{' + k + '}', String(v))
      return out
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'sync-hub'
    // MUST return module.exports (an object with apply), NOT module itself.
    // Returning module => host sees {exports:{...}} with no apply =>
    // "invalid plugin, expect function or object with an 'apply' method" and
    // the whole concatenated client bundle is skipped (collateral damage to
    // every other plugin in the same bundle). Verified 2026-10-13 crash log.
    return module.exports
  },
})
