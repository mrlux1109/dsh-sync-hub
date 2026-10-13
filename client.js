/**
 * dsh-sync-hub — browser half (settings card).
 *
 * Contributes ONE thing: a settings section (`settings.section` id `sync-hub`)
 * that mirrors the whole 同步中枢 console in the browser: daily sync, backups
 * & sessions, environment, plugins & skills, remote, credentials, and a
 * bootstrap panel for fresh machines (hub not cloned yet).
 *
 * Everything goes over the plugin's own same-origin `/api/sync-hub/*` routes
 * served by the host half (index.js). Long operations (pull/push/doctor/
 * bootstrap) have generous client timeouts matching the host-side kills.
 *
 * Contract (verified 2026-10-13, see memory/shared.md 4.17):
 *   - ModuleLoader bundle; factory MUST return module.exports (NOT module)
 *   - inject = ['slots','locale']; React from the shell
 *   - colors via CSS custom properties with fallbacks (theme-proof)
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
        'loading': '读取中…',
        'error': '后端不可达：{e}',
        'busy': '执行中…（长操作可能要几十秒，勿重复点）',
        'sec.daily': '日常同步',
        'sec.backup': '备份与会话',
        'sec.env': '环境维护',
        'sec.plugin': '插件与技能',
        'sec.cred': 'Gitee 凭据（新机一次录入）',
        'sec.bootstrap': '新机器接入（本机还没有中枢仓库时）',
        'act.refresh': '刷新',
        'act.status': '查看差异',
        'act.push': '上传备份',
        'act.pull': '拉取并应用',
        'act.console': '打开控制台',
        'act.doctor': '体检',
        'act.doctorFix': '体检+修复',
        'act.net': '网络诊断',
        'act.backups': '历史备份',
        'act.sessionsBackup': '会话备份',
        'act.sessionsList': '会话列表',
        'act.skillsToHub': '技能→中枢',
        'act.skillsFromHub': '中枢→技能',
        'act.pluginsList': '插件状态',
        'act.pluginsInstall': '装/修插件',
        'act.bootstrap': '一键接入',
        'cred.have': '已保存',
        'cred.none': '未保存 —— push/clone 会失败',
        'cred.user': 'Gitee 用户名',
        'cred.token': '私人令牌（只写不回显）',
        'cred.save': '保存并测试',
        'cred.where': '令牌存 Windows 凭据管理器（git credential），永不写入任何文件或仓库。',
        'hint.token': '拿令牌：gitee.com → 设置 → 私人令牌（勾 projects 权限）。',
        'hint.pull': '拉取会应用到 DSH，重启后生效；冲突会停下并报告。',
        'hint.console': '换身份 / 一条龙 / 冲突处理仍在窗口里人工完成。',
        'hint.restart': '涉及记忆/插件的改动需重启 DSH 生效。',
        'boot.machine': '机器短名（小写，如 home / shop）',
        'boot.dest': '中枢克隆到（如 D:\\AI\\sync-hub）',
        'boot.repo': '仓库地址（回车=默认）',
        'boot.desc': '前提：已装 git 且上方凭据已保存。点「一键接入」= clone 中枢 + apply 记忆/技能 + 装插件，完成后重启 DSH。',
        'boot.needCred': '先在上方保存 Gitee 凭据，再接入。',
        'restore.title': '输入要恢复的备份文件名（先点「历史备份」看列表）：',
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
        'loading': 'Loading…',
        'error': 'Backend unreachable: {e}',
        'busy': 'Running… (may take tens of seconds, do not re-click)',
        'sec.daily': 'Daily sync',
        'sec.backup': 'Backups & sessions',
        'sec.env': 'Environment',
        'sec.plugin': 'Plugins & skills',
        'sec.cred': 'Gitee credential (enter once)',
        'sec.bootstrap': 'New machine (hub not cloned yet)',
        'act.refresh': 'Refresh',
        'act.status': 'Status',
        'act.push': 'Push',
        'act.pull': 'Pull & apply',
        'act.console': 'Open console',
        'act.doctor': 'Doctor',
        'act.doctorFix': 'Doctor + fix',
        'act.net': 'Net check',
        'act.backups': 'Backups',
        'act.sessionsBackup': 'Backup sessions',
        'act.sessionsList': 'Session list',
        'act.skillsToHub': 'Skills → hub',
        'act.skillsFromHub': 'Hub → skills',
        'act.pluginsList': 'Plugin status',
        'act.pluginsInstall': 'Install/repair',
        'act.bootstrap': 'Bootstrap',
        'cred.have': 'stored',
        'cred.none': 'no credential — push/clone will fail',
        'cred.user': 'Gitee username',
        'cred.token': 'private token (write-only)',
        'cred.save': 'Save & test',
        'cred.where': 'Stored in the Windows Credential Manager via git credential — never in any file or repo.',
        'hint.token': 'Token: gitee.com → Settings → Private Token (projects scope).',
        'hint.pull': 'Pull applies to DSH (restart to take effect); conflicts stop and report.',
        'hint.console': 'Identity switch / one-stop setup / conflict fixes stay manual in the window.',
        'hint.restart': 'Memory/plugin changes need a DSH restart.',
        'boot.machine': 'machine id (lowercase, e.g. home / shop)',
        'boot.dest': 'clone hub into (e.g. D:\\AI\\sync-hub)',
        'boot.repo': 'repo URL (blank = default)',
        'boot.desc': 'Needs git + the credential saved above. Bootstrap = clone hub + apply memory/skills + install plugin; then restart DSH.',
        'boot.needCred': 'Save the Gitee credential above first.',
        'restore.title': 'Backup file name to restore (see Backups list first):',
      },
    }

    const API = (() => {
      try { return new URL('api/sync-hub', document.baseURI).pathname } catch { return '/api/sync-hub' }
    })()

    async function api(path, options) {
      const { timeout = 10000, ...fetchOptions } = options ?? {}
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

    const S = {
      label: { fontSize: '0.75rem', opacity: 0.65, minWidth: '4.5rem' },
      value: { fontSize: '0.85rem' },
      btn: {
        padding: '0.35rem 0.8rem', borderRadius: '0.5rem', fontSize: '0.8rem',
        border: '1px solid var(--color-border, rgba(128,128,128,0.35))',
        background: 'var(--color-surface, rgba(128,128,128,0.08))',
        color: 'var(--color-text, inherit)', cursor: 'pointer',
      },
      input: {
        padding: '0.35rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.78rem', width: '13rem',
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
      secTitle: { fontSize: '0.85rem', margin: '0 0 0.4rem', opacity: 0.9 },
      sec: { borderTop: '1px solid var(--color-border, rgba(128,128,128,0.25))', paddingTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
      row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
      hint: { fontSize: '0.68rem', opacity: 0.55, margin: 0 },
    }

    function Row(t, label, value) {
      return h('div', { style: { display: 'flex', gap: '0.75rem', padding: '0.25rem 0' } },
        h('span', { style: S.label }, t(label)),
        h('span', { style: S.value }, value))
    }
    function Section(t, titleKey, kids) {
      return h('section', { style: S.sec },
        h('h3', { style: S.secTitle }, t(titleKey)), ...kids)
    }

    function SyncHubPage({ t }) {
      const [info, setInfo] = useState(undefined)
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState(false)
      const [output, setOutput] = useState(undefined)
      const [cred, setCred] = useState(undefined)
      const [cUser, setCUser] = useState('')
      const [cToken, setCToken] = useState('')
      const [bMachine, setBMachine] = useState('')
      const [bDest, setBDest] = useState('')
      const [bRepo, setBRepo] = useState('')
      const [restoreName, setRestoreName] = useState('')

      const loadCred = useCallback(() => {
        api('/cred').then(setCred).catch(() => setCred({ ok: false }))
      }, [])
      const load = useCallback(() => {
        setErr('')
        api('/info')
          .then(payload => { setInfo(payload); if (!payload.ok) setErr(payload.notFound ? '' : 'notFound') })
          .catch(e => setErr(String(e?.message ?? e)))
        loadCred()
      }, [loadCred])
      useEffect(() => { load() }, [load])

      const run = useCallback(async (kind, arg) => {
        setBusy(true)
        setOutput(undefined)
        try {
          let payload
          switch (kind) {
            case 'status': payload = await api('/status', { timeout: 120_000 }); break
            case 'pull': payload = await post('/pull', undefined, 300_000); break
            case 'push': payload = await post('/push', {}, 300_000); break
            case 'console': payload = await post('/console'); break
            case 'doctor': payload = await post('/doctor', {}, 240_000); break
            case 'doctorFix': payload = await post('/doctor', { fix: true }, 240_000); break
            case 'net': payload = await post('/net', {}, 180_000); break
            case 'backups': payload = await api('/backups', { timeout: 90_000 }); break
            case 'restore': payload = await post('/restore', { name: restoreName }, 90_000); setRestoreName(''); break
            case 'sessionsBackup': payload = await post('/sessions', { action: 'backup' }, 600_000); break
            case 'sessionsList': payload = await post('/sessions', { action: 'list' }, 90_000); break
            case 'skillsToHub': payload = await post('/skills', { dir: 'tohub' }, 240_000); break
            case 'skillsFromHub': payload = await post('/skills', { dir: 'fromhub' }, 240_000); break
            case 'pluginsList': payload = await post('/plugins', { action: 'list' }, 120_000); break
            case 'pluginsInstall': payload = await post('/plugins', { action: 'install' }, 600_000); break
            case 'saveCred':
              payload = await post('/cred', { username: cUser, token: cToken }, 180_000)
              setCToken(''); loadCred(); break
            case 'bootstrap':
              payload = await post('/bootstrap', {
                machine: bMachine, dest: bDest,
                ...bRepo.trim() ? { repoUrl: bRepo.trim() } : {},
              }, 1_500_000)
              break
            default: payload = { text: 'unknown action: ' + kind }
          }
          setOutput(payload?.text ?? JSON.stringify(payload))
          if (kind === 'pull' || kind === 'push' || kind === 'bootstrap' || kind === 'restore') load()
        } catch (e) {
          setOutput(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }, [load, loadCred, cUser, cToken, restoreName, bMachine, bDest, bRepo])

      const btn = (labelKey, kind, extraStyle) => h('button', {
        key: labelKey, type: 'button', style: { ...S.btn, ...extraStyle }, disabled: busy,
        onClick: () => run(kind),
      }, t(labelKey))
      const btnRow = (...kids) => h('div', { style: S.row }, ...kids)

      // ── fresh machine: bootstrap panel instead of the full card ────────────
      if (info && !info.ok) {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.9rem', maxWidth: '46rem' } },
          h('section', {},
            h('h2', { style: { fontSize: '1.05rem', margin: '0 0 0.15rem' } }, t('title')),
            h('p', { style: { fontSize: '0.8rem', opacity: 0.7, margin: 0 } }, t('subtitle'))),
          err ? h('p', { style: { fontSize: '0.8rem', color: 'var(--color-danger, #d33)' } }, t('error').replace('{e}', err)) : null,
          Section(t, 'sec.cred',
            h('p', { style: { fontSize: '0.78rem', margin: 0 } },
              cred === undefined ? t('loading')
                : cred.hasCredential
                  ? h(Fragment, {}, h('span', { style: { color: 'var(--color-success, #2a9)' } }, t('cred.have')), '  ' + (cred.username || ''))
                  : h('span', { style: { color: 'var(--color-danger, #d33)' } }, t('cred.none'))),
            btnRow(
              h('input', { type: 'text', placeholder: t('cred.user'), value: cUser, disabled: busy, style: S.input, onChange: e => setCUser(e.target.value) }),
              h('input', { type: 'password', placeholder: t('cred.token'), value: cToken, disabled: busy, style: S.input, onChange: e => setCToken(e.target.value) }),
              btn('cred.save', 'saveCred')),
            h('p', S.hint, t('cred.where')),
            h('p', S.hint, t('hint.token'))),
          Section(t, 'sec.bootstrap',
            h('p', { style: { fontSize: '0.75rem', margin: 0, opacity: 0.75 } }, t('boot.desc')),
            btnRow(
              h('input', { type: 'text', placeholder: t('boot.machine'), value: bMachine, disabled: busy, style: S.input, onChange: e => setBMachine(e.target.value) }),
              h('input', { type: 'text', placeholder: t('boot.dest'), value: bDest, disabled: busy, style: { ...S.input, width: '16rem' }, onChange: e => setBDest(e.target.value) })),
            btnRow(
              h('input', { type: 'text', placeholder: t('boot.repo'), value: bRepo, disabled: busy, style: { ...S.input, width: '22rem' }, onChange: e => setBRepo(e.target.value) }),
              btn('act.bootstrap', 'bootstrap', busy ? {} : { background: 'var(--color-accent, #2a6)', color: '#fff' })),
            !(cred && cred.hasCredential) && !busy ? h('p', { style: { fontSize: '0.72rem', color: 'var(--color-danger, #d33)', margin: 0 } }, t('boot.needCred')) : null),
          busy ? h('p', { style: { fontSize: '0.75rem', opacity: 0.65 } }, t('busy')) : null,
          output !== undefined ? h('pre', { style: S.pre }, output) : null)
      }

      // ── normal card ─────────────────────────────────────────────────────────
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.9rem', maxWidth: '46rem' } },
        h('section', {},
          h('h2', { style: { fontSize: '1.05rem', margin: '0 0 0.15rem' } }, t('title')),
          h('p', { style: { fontSize: '0.8rem', opacity: 0.7, margin: 0 } }, t('subtitle'))),

        h('section', { style: { display: 'flex', flexDirection: 'column', gap: '0.15rem' } },
          info === undefined && !err
            ? h('p', { style: { fontSize: '0.8rem', opacity: 0.6 } }, t('loading'))
            : err
              ? h('p', { style: { fontSize: '0.8rem', color: 'var(--color-danger, #d33)' } }, t('error').replace('{e}', err))
              : h(Fragment, {},
                  Row(t, 'version', 'v' + info.version + '  ·  ' + info.machine),
                  Row(t, 'commit', [info.commit, info.commitDate, info.commitSubject].filter(Boolean).join(' | ')),
                  Row(t, 'skills', String(info.skills)),
                  Row(t, 'dirty', info.dirty === 0 ? t('dirty0') : info.dirty > 0 ? t('dirtyN').replace('{n}', String(info.dirty)) : ''))),

        Section(t, 'sec.daily',
          btnRow(btn('act.refresh', 'refresh'), btn('act.status', 'status'),
            btn('act.push', 'push'), btn('act.pull', 'pull'), btn('act.console', 'console')),
          h('p', S.hint, t('hint.pull'))),

        Section(t, 'sec.backup',
          btnRow(btn('act.backups', 'backups'),
            h('input', { type: 'text', placeholder: t('restore.title'), value: restoreName, disabled: busy, style: { ...S.input, width: '16rem' }, onChange: e => setRestoreName(e.target.value) }),
            btn('act.restore' in {} ? 'act.restore' : 'act.backups', 'restore')),
          btnRow(btn('act.sessionsBackup', 'sessionsBackup'), btn('act.sessionsList', 'sessionsList'))),

        Section(t, 'sec.env',
          btnRow(btn('act.doctor', 'doctor'), btn('act.doctorFix', 'doctorFix'), btn('act.net', 'net'))),

        Section(t, 'sec.plugin',
          btnRow(btn('act.skillsToHub', 'skillsToHub'), btn('act.skillsFromHub', 'skillsFromHub')),
          btnRow(btn('act.pluginsList', 'pluginsList'), btn('act.pluginsInstall', 'pluginsInstall')),
          h('p', S.hint, t('hint.restart'))),

        Section(t, 'sec.cred',
          h('p', { style: { fontSize: '0.78rem', margin: 0 } },
            cred === undefined ? t('loading')
              : cred.hasCredential
                ? h(Fragment, {}, h('span', { style: { color: 'var(--color-success, #2a9)' } }, t('cred.have')), '  ' + (cred.username || '') + '  ·  ' + (cred.repoHost || ''))
                : h('span', { style: { color: 'var(--color-danger, #d33)' } }, t('cred.none'))),
          btnRow(
            h('input', { type: 'text', placeholder: t('cred.user'), value: cUser, disabled: busy, style: S.input, onChange: e => setCUser(e.target.value) }),
            h('input', { type: 'password', placeholder: t('cred.token'), value: cToken, disabled: busy, style: S.input, onChange: e => setCToken(e.target.value) }),
            btn('cred.save', 'saveCred')),
          h('p', S.hint, t('cred.where')),
          h('p', S.hint, t('hint.token'))),

        busy ? h('p', { style: { fontSize: '0.75rem', opacity: 0.65 } }, t('busy')) : null,
        output !== undefined ? h('pre', { style: S.pre }, output) : null,
        h('p', S.hint, t('hint.console')))
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
