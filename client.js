/**
 * dsh-sync-hub — browser half (settings card, tabbed).
 *
 * Layout rules learned from user feedback (memory/shared.md 4.20):
 *   - Every action gives IMMEDIATE feedback next to the button it belongs to
 *     ("执行中…" on the clicked button) and prints its result INSIDE the
 *     current tab. Never park the only output panel at the bottom of a long
 *     page: users cannot see it, so a working button looks dead.
 *   - Functions are grouped into TABS; a single 20-button column reads as noise.
 *
 * Tabs: 概览 / 同步 / 备份 / 环境 / 插件与技能 / 工具链 / 设置
 * Data comes from the host half's same-origin /api/sync-hub/* routes.
 *
 * Contract (verified 2026-10-13, memory/shared.md 4.17):
 *   - ModuleLoader bundle; factory MUST return module.exports (NOT module)
 *   - inject = ['slots','locale']; React from the shell
 *   - every action kind MUST have a switch branch (a missing one falls through
 *     to default and the button silently does nothing)
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
        'loading': '读取中…',
        'error': '后端不可达：{e}',
        'busy': '执行中…',
        'done': '完成',
        'output': '输出',
        'clear': '清除输出',
        'version': '版本',
        'commit': '最新提交',
        'skills': '技能',
        'dirty0': '工作区干净',
        'dirtyN': '{n} 个未提交改动',

        'tab.overview': '概览',
        'tab.sync': '同步',
        'tab.backup': '备份',
        'tab.env': '环境',
        'tab.plugin': '插件技能',
        'tab.tools': '工具链',
        'tab.settings': '设置',

        'act.refresh': '刷新',
        'act.status': '查看差异',
        'act.push': '上传备份',
        'act.pull': '拉取并应用',
        'act.console': '打开控制台',
        'act.doctor': '体检',
        'act.doctorFix': '体检+修复',
        'act.net': '网络诊断',
        'act.backups': '历史备份',
        'act.restore': '恢复',
        'act.sessionsBackup': '会话备份',
        'act.sessionsList': '会话列表',
        'act.skillsToHub': '技能→中枢',
        'act.skillsFromHub': '中枢→技能',
        'act.pluginsList': '插件状态',
        'act.pluginsInstall': '装/修插件',
        'act.toolsRefresh': '工具体检',
        'act.toolsInstall': '补齐缺的',
        'act.toolsInstallNice': '补齐含可选',
        'act.bootstrap': '一键接入',

        'sec.daily': '日常同步',
        'sec.backup': '备份',
        'sec.sessions': '会话备份',
        'sec.env': '环境维护',
        'sec.plugin': '插件与技能',
        'sec.tools': 'AI 工具链',
        'sec.cred': 'Gitee 凭据',
        'sec.bootstrap': '新机器接入（本机还没有中枢仓库时）',

        'hint.pull': '拉取会应用到 DSH，重启后生效；冲突会停下并报告。',
        'hint.console': '换身份 / 一条龙 / 冲突处理仍在窗口里人工完成。',
        'hint.restart': '涉及记忆/插件的改动需重启 DSH 生效。',
        'hint.restore': '先点「历史备份」看列表，再把文件名填进输入框。',
        'hint.tools': '核心工具缺失会影响同步；可选工具按需装。',
        'hint.overview': '这是本机与中枢的当前状态，改动后可点「刷新」。',

        'tools.count': '已装 {p}/{n}',
        'tools.coreMissing': '核心工具缺失，同步会受影响',
        'tools.allPresent': '全部就位',

        'cred.have': '已保存',
        'cred.none': '未保存 —— push/clone 会失败',
        'cred.user': 'Gitee 用户名',
        'cred.token': '私人令牌（只写不回显）',
        'cred.save': '保存并测试',
        'cred.where': '令牌存 Windows 凭据管理器（git credential），永不写入任何文件或仓库。',
        'hint.token': '拿令牌：gitee.com → 设置 → 私人令牌（勾 projects 权限）。',

        'boot.machine': '机器短名（小写，如 home / shop）',
        'boot.dest': '中枢克隆到（如 D:\\AI\\sync-hub）',
        'boot.repo': '仓库地址（回车=默认）',
        'boot.desc': '前提：已装 git 且本页凭据已保存。点「一键接入」= clone 中枢 + apply 记忆/技能 + 装插件，完成后重启 DSH。',
        'boot.needCred': '先在上方保存 Gitee 凭据，再接入。',
        'restore.placeholder': '备份文件名',
      },
      en: {
        'nav': 'Sync Hub',
        'title': 'Sync Hub · sync-hub',
        'subtitle': 'Cross-machine AI memory / skills / config (private Gitee repo)',
        'loading': 'Loading…',
        'error': 'Backend unreachable: {e}',
        'busy': 'Running…',
        'done': 'done',
        'output': 'Output',
        'clear': 'Clear output',
        'version': 'Version',
        'commit': 'Last commit',
        'skills': 'Skills',
        'dirty0': 'working tree clean',
        'dirtyN': '{n} uncommitted change(s)',

        'tab.overview': 'Overview',
        'tab.sync': 'Sync',
        'tab.backup': 'Backup',
        'tab.env': 'Environment',
        'tab.plugin': 'Plugins',
        'tab.tools': 'Toolchain',
        'tab.settings': 'Settings',

        'act.refresh': 'Refresh',
        'act.status': 'Status',
        'act.push': 'Push',
        'act.pull': 'Pull & apply',
        'act.console': 'Open console',
        'act.doctor': 'Doctor',
        'act.doctorFix': 'Doctor + fix',
        'act.net': 'Net check',
        'act.backups': 'Backups',
        'act.restore': 'Restore',
        'act.sessionsBackup': 'Backup sessions',
        'act.sessionsList': 'Session list',
        'act.skillsToHub': 'Skills → hub',
        'act.skillsFromHub': 'Hub → skills',
        'act.pluginsList': 'Plugin status',
        'act.pluginsInstall': 'Install/repair',
        'act.toolsRefresh': 'Tool check',
        'act.toolsInstall': 'Install missing',
        'act.toolsInstallNice': 'Install + optional',
        'act.bootstrap': 'Bootstrap',

        'sec.daily': 'Daily sync',
        'sec.backup': 'Backups',
        'sec.sessions': 'Session backup',
        'sec.env': 'Environment',
        'sec.plugin': 'Plugins & skills',
        'sec.tools': 'AI toolchain',
        'sec.cred': 'Gitee credential',
        'sec.bootstrap': 'New machine (hub not cloned yet)',

        'hint.pull': 'Pull applies to DSH (restart to take effect); conflicts stop and report.',
        'hint.console': 'Identity switch / one-stop setup / conflict fixes stay manual in the window.',
        'hint.restart': 'Memory/plugin changes need a DSH restart.',
        'hint.restore': 'Run Backups first, then paste a file name here.',
        'hint.tools': 'Missing core tools affect sync; optional ones are up to you.',
        'hint.overview': 'Current state of this machine vs the hub; hit Refresh after changes.',

        'tools.count': '{p}/{n} installed',
        'tools.coreMissing': 'core tools missing — sync is affected',
        'tools.allPresent': 'all present',

        'cred.have': 'stored',
        'cred.none': 'no credential — push/clone will fail',
        'cred.user': 'Gitee username',
        'cred.token': 'private token (write-only)',
        'cred.save': 'Save & test',
        'cred.where': 'Stored in the Windows Credential Manager via git credential — never in any file or repo.',
        'hint.token': 'Token: gitee.com → Settings → Private Token (projects scope).',

        'boot.machine': 'machine id (lowercase, e.g. home / shop)',
        'boot.dest': 'clone hub into (e.g. D:\\AI\\sync-hub)',
        'boot.repo': 'repo URL (blank = default)',
        'boot.desc': 'Needs git + the credential saved on this page. Bootstrap = clone hub + apply memory/skills + install plugin; then restart DSH.',
        'boot.needCred': 'Save the Gitee credential above first.',
        'restore.placeholder': 'backup file name',
      },
    }

    const API = (() => {
      try { return new URL('api/sync-hub', document.baseURI).pathname } catch { return '/api/sync-hub' }
    })()

    async function api(path, options) {
      const { timeout = 15000, ...fetchOptions } = options ?? {}
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
      btnPrimary: { background: 'var(--color-accent, #2a6)', color: '#fff' },
      input: {
        padding: '0.35rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.78rem', width: '13rem',
        border: '1px solid var(--color-border, rgba(128,128,128,0.35))',
        background: 'var(--color-surface, rgba(128,128,128,0.06))',
        color: 'var(--color-text, inherit)',
      },
      pre: {
        margin: 0, padding: '0.6rem', borderRadius: '0.5rem', fontSize: '0.72rem',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '20rem', overflow: 'auto',
        background: 'var(--color-surface, rgba(128,128,128,0.08))',
        border: '1px solid var(--color-border, rgba(128,128,128,0.25))',
      },
      tabs: { display: 'flex', gap: '0.25rem', flexWrap: 'wrap', borderBottom: '1px solid var(--color-border, rgba(128,128,128,0.25))', paddingBottom: '0.5rem' },
      tab: {
        padding: '0.3rem 0.7rem', borderRadius: '0.5rem 0.5rem 0 0', fontSize: '0.8rem',
        border: '1px solid transparent', background: 'transparent',
        color: 'var(--color-text, inherit)', cursor: 'pointer', opacity: 0.65,
      },
      tabActive: {
        opacity: 1, fontWeight: 600,
        borderBottom: '2px solid var(--color-accent, #2a6)',
      },
      secTitle: { fontSize: '0.85rem', margin: '0 0 0.4rem', opacity: 0.9 },
      sec: { borderTop: '1px solid var(--color-border, rgba(128,128,128,0.25))', paddingTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' },
      secFirst: { paddingTop: 0, borderTop: 'none', display: 'flex', flexDirection: 'column', gap: '0.45rem' },
      row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
      hint: { fontSize: '0.68rem', opacity: 0.55, margin: 0 },
      chip: {
        fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '0.7rem',
        border: '1px solid var(--color-border, rgba(128,128,128,0.3))',
      },
      busyDot: { fontSize: '0.72rem', color: 'var(--color-accent, #2a6)' },
      ok: { color: 'var(--color-success, #2a9)' },
      bad: { color: 'var(--color-danger, #d33)' },
    }

    const TABS = ['overview', 'sync', 'backup', 'env', 'plugin', 'tools', 'settings']

    function Row(t, label, value) {
      return h('div', { style: { display: 'flex', gap: '0.75rem', padding: '0.2rem 0' } },
        h('span', { style: S.label }, t(label)),
        h('span', { style: S.value }, value))
    }

    function SyncHubPage({ t }) {
      const [tab, setTab] = useState('overview')
      const [info, setInfo] = useState(undefined)
      const [err, setErr] = useState('')
      const [busyKind, setBusyKind] = useState('')
      const [outputs, setOutputs] = useState({})
      const [cred, setCred] = useState(undefined)
      const [tools, setTools] = useState(undefined)
      const [cUser, setCUser] = useState('')
      const [cToken, setCToken] = useState('')
      const [bMachine, setBMachine] = useState('')
      const [bDest, setBDest] = useState('')
      const [bRepo, setBRepo] = useState('')
      const [restoreName, setRestoreName] = useState('')

      const setOut = useCallback((key, text) => {
        setOutputs(prev => ({ ...prev, [key]: text }))
      }, [])

      const loadInfo = useCallback(() => {
        setErr('')
        return api('/info')
          .then(payload => { setInfo(payload); if (!payload.ok) setErr(payload.notFound ? '' : 'notFound') })
          .catch(e => setErr(String(e?.message ?? e)))
      }, [])
      const loadCred = useCallback(() => {
        api('/cred').then(setCred).catch(() => setCred({ ok: false }))
      }, [])
      const loadTools = useCallback(() => {
        api('/tools', { timeout: 120_000 }).then(setTools).catch(() => setTools({ ok: false, tools: [] }))
      }, [])

      useEffect(() => { loadInfo(); loadCred(); loadTools() }, [loadInfo, loadCred, loadTools])

      // Every kind below MUST exist as a switch branch: a missing one falls
      // through to default and the button looks dead (memory/shared.md 4.20).
      const run = useCallback(async (kind, tabKey) => {
        setBusyKind(kind)
        setOut(tabKey, '')
        try {
          let payload
          switch (kind) {
            case 'refresh': await Promise.all([loadInfo(), loadCred(), loadTools()]); payload = { text: '' }; break
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
            case 'toolsRefresh': await loadTools(); payload = { text: '' }; break
            case 'toolsInstall': payload = await post('/tools/install', { mode: 'all' }, 900_000); await loadTools(); break
            case 'toolsInstallNice': payload = await post('/tools/install', { mode: 'allnice' }, 1_800_000); await loadTools(); break
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
          setOut(tabKey, payload?.text || '')
          if (kind === 'pull' || kind === 'push' || kind === 'bootstrap' || kind === 'restore') loadInfo()
        } catch (e) {
          setOut(tabKey, '✗ ' + String(e?.message ?? e))
        } finally {
          setBusyKind('')
        }
      }, [loadInfo, loadCred, loadTools, setOut, cUser, cToken, restoreName, bMachine, bDest, bRepo])

      // A button that shows its own progress and never leaves the user guessing.
      const btn = (labelKey, kind, tabKey, extraStyle) => {
        const isBusy = busyKind === kind
        return h('button', {
          key: labelKey + kind, type: 'button',
          style: { ...S.btn, ...extraStyle, ...(isBusy ? { opacity: 0.7 } : {}) },
          disabled: !!busyKind,
          onClick: () => run(kind, tabKey),
        }, isBusy ? (t(labelKey) + ' …') : t(labelKey))
      }
      const row = (...kids) => h('div', { style: S.row }, ...kids)

      // Output lives inside the tab that produced it, right under the buttons.
      const outBox = (tabKey) => {
        const text = outputs[tabKey]
        if (!text) return null
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.3rem' } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('span', { style: S.label }, t('output')),
            h('button', { type: 'button', style: S.btn, onClick: () => setOut(tabKey, '') }, t('clear'))),
          h('pre', { style: S.pre }, text))
      }
      const busyLine = (kind) => busyKind === kind ? h('span', { style: S.busyDot }, t('busy')) : null

      // ── header + tab bar (always visible) ──────────────────────────────────
      const header = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
        h('section', {},
          h('h2', { style: { fontSize: '1.05rem', margin: '0 0 0.15rem' } }, t('title')),
          h('p', { style: { fontSize: '0.8rem', opacity: 0.7, margin: 0 } }, t('subtitle'))),
        h('div', { style: S.tabs }, ...TABS.map(k => h('button', {
          key: k, type: 'button',
          style: { ...S.tab, ...(tab === k ? S.tabActive : {}) },
          onClick: () => setTab(k),
        }, t('tab.' + k)))))

      // ── no hub yet: only the bootstrap path is useful ──────────────────────
      if (info && !info.ok) {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.9rem', maxWidth: '48rem' } },
          header,
          err ? h('p', { style: { ...S.bad, fontSize: '0.8rem' } }, t('error').replace('{e}', err)) : null,
          h('div', { style: S.secFirst },
            h('h3', { style: S.secTitle }, t('sec.cred')),
            h('p', { style: { fontSize: '0.78rem', margin: 0 } },
              cred === undefined ? t('loading')
                : cred.hasCredential
                  ? h(Fragment, {}, h('span', { style: S.ok }, t('cred.have')), '  ' + (cred.username || ''))
                  : h('span', { style: S.bad }, t('cred.none'))),
            row(
              h('input', { type: 'text', placeholder: t('cred.user'), value: cUser, disabled: !!busyKind, style: S.input, onChange: e => setCUser(e.target.value) }),
              h('input', { type: 'password', placeholder: t('cred.token'), value: cToken, disabled: !!busyKind, style: S.input, onChange: e => setCToken(e.target.value) }),
              btn('cred.save', 'saveCred', 'settings')),
            busyLine('saveCred'),
            h('p', S.hint, t('cred.where')),
            h('p', S.hint, t('hint.token'))),
          h('div', { style: S.sec },
            h('h3', { style: S.secTitle }, t('sec.bootstrap')),
            h('p', { style: { fontSize: '0.75rem', margin: 0, opacity: 0.75 } }, t('boot.desc')),
            row(
              h('input', { type: 'text', placeholder: t('boot.machine'), value: bMachine, disabled: !!busyKind, style: S.input, onChange: e => setBMachine(e.target.value) }),
              h('input', { type: 'text', placeholder: t('boot.dest'), value: bDest, disabled: !!busyKind, style: { ...S.input, width: '16rem' }, onChange: e => setBDest(e.target.value) })),
            row(
              h('input', { type: 'text', placeholder: t('boot.repo'), value: bRepo, disabled: !!busyKind, style: { ...S.input, width: '22rem' }, onChange: e => setBRepo(e.target.value) }),
              btn('act.bootstrap', 'bootstrap', 'settings', S.btnPrimary)),
            busyLine('bootstrap'),
            !(cred && cred.hasCredential) && !busyKind ? h('p', { style: { ...S.bad, fontSize: '0.72rem', margin: 0 } }, t('boot.needCred')) : null),
          outBox('settings'))
      }

      // ── normal tabs ────────────────────────────────────────────────────────
      const overview = h('div', { style: S.secFirst },
        h('h3', { style: S.secTitle }, t('hint.overview')),
        info === undefined && !err
          ? h('p', { style: { fontSize: '0.8rem', opacity: 0.6 } }, t('loading'))
          : err
            ? h('p', { style: { ...S.bad, fontSize: '0.8rem' } }, t('error').replace('{e}', err))
            : h(Fragment, {},
                Row(t, 'version', 'v' + info.version + '  ·  ' + info.machine),
                Row(t, 'commit', [info.commit, info.commitDate, info.commitSubject].filter(Boolean).join(' | ')),
                Row(t, 'skills', String(info.skills)),
                Row(t, 'dirty', info.dirty === 0 ? t('dirty0') : info.dirty > 0 ? t('dirtyN').replace('{n}', String(info.dirty)) : '')),
        row(btn('act.refresh', 'refresh', 'overview')))

      const syncTab = h('div', { style: S.secFirst },
        h('h3', { style: S.secTitle }, t('sec.daily')),
        row(btn('act.status', 'status', 'sync'), btn('act.push', 'push', 'sync', S.btnPrimary), btn('act.pull', 'pull', 'sync', S.btnPrimary)),
        row(btn('act.console', 'console', 'sync')),
        busyLine('status'), busyLine('push'), busyLine('pull'),
        h('p', S.hint, t('hint.pull')),
        h('p', S.hint, t('hint.console')),
        outBox('sync'))

      const backupTab = h('div', { style: S.secFirst },
        h('h3', { style: S.secTitle }, t('sec.backup')),
        row(btn('act.backups', 'backups', 'backup'),
          h('input', { type: 'text', placeholder: t('restore.placeholder'), value: restoreName, disabled: !!busyKind, style: { ...S.input, width: '15rem' }, onChange: e => setRestoreName(e.target.value) }),
          btn('act.restore', 'restore', 'backup')),
        h('p', S.hint, t('hint.restore')),
        h('h3', { style: { ...S.secTitle, marginTop: '0.4rem' } }, t('sec.sessions')),
        row(btn('act.sessionsBackup', 'sessionsBackup', 'backup'), btn('act.sessionsList', 'sessionsList', 'backup')),
        busyLine('backups'), busyLine('restore'),
        outBox('backup'))

      const envTab = h('div', { style: S.secFirst },
        h('h3', { style: S.secTitle }, t('sec.env')),
        row(btn('act.doctor', 'doctor', 'env'), btn('act.doctorFix', 'doctorFix', 'env'), btn('act.net', 'net', 'env')),
        busyLine('doctor'), busyLine('doctorFix'), busyLine('net'),
        outBox('env'))

      const pluginTab = h('div', { style: S.secFirst },
        h('h3', { style: S.secTitle }, t('sec.plugin')),
        row(btn('act.skillsToHub', 'skillsToHub', 'plugin'), btn('act.skillsFromHub', 'skillsFromHub', 'plugin')),
        row(btn('act.pluginsList', 'pluginsList', 'plugin'), btn('act.pluginsInstall', 'pluginsInstall', 'plugin')),
        busyLine('skillsToHub'), busyLine('skillsFromHub'), busyLine('pluginsList'), busyLine('pluginsInstall'),
        h('p', S.hint, t('hint.restart')),
        outBox('plugin'))

      const toolCountText = tools === undefined ? t('loading')
        : t('tools.count').replace('{p}', String(tools.present)).replace('{n}', String(tools.total))
      const toolCountColor = !tools ? {} : (tools.missingCore > 0 ? S.bad : S.ok)
      const toolsTab = h('div', { style: S.secFirst },
        h('h3', { style: S.secTitle }, t('sec.tools')),
        h('p', { style: { fontSize: '0.8rem', margin: 0, ...toolCountColor } },
          toolCountText + (tools && tools.missingCore > 0 ? '  ·  ' + t('tools.coreMissing') : '')),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.35rem' } },
          ...((tools && tools.tools) ? tools.tools.map(x => h('span', {
            key: x.Key,
            style: { ...S.chip, opacity: x.Present ? 1 : 0.45, ...(x.Present ? S.ok : {}) },
          }, (x.Present ? '✓ ' : '✗ ') + x.Key)) : [])),
        row(btn('act.toolsRefresh', 'toolsRefresh', 'tools'), btn('act.toolsInstall', 'toolsInstall', 'tools'), btn('act.toolsInstallNice', 'toolsInstallNice', 'tools')),
        busyLine('toolsInstall'), busyLine('toolsInstallNice'),
        h('p', S.hint, t('hint.tools')),
        outBox('tools'))

      const settingsTab = h('div', { style: S.secFirst },
        h('h3', { style: S.secTitle }, t('sec.cred')),
        h('p', { style: { fontSize: '0.78rem', margin: 0 } },
          cred === undefined ? t('loading')
            : cred.hasCredential
              ? h(Fragment, {}, h('span', { style: S.ok }, t('cred.have')), '  ' + (cred.username || '') + (cred.repoHost ? '  ·  ' + cred.repoHost : ''))
              : h('span', { style: S.bad }, t('cred.none'))),
        row(
          h('input', { type: 'text', placeholder: t('cred.user'), value: cUser, disabled: !!busyKind, style: S.input, onChange: e => setCUser(e.target.value) }),
          h('input', { type: 'password', placeholder: t('cred.token'), value: cToken, disabled: !!busyKind, style: S.input, onChange: e => setCToken(e.target.value) }),
          btn('cred.save', 'saveCred', 'settings')),
        busyLine('saveCred'),
        h('p', S.hint, t('cred.where')),
        h('p', S.hint, t('hint.token')),
        h('h3', { style: { ...S.secTitle, marginTop: '0.6rem' } }, t('sec.bootstrap')),
        h('p', { style: { fontSize: '0.75rem', margin: 0, opacity: 0.75 } }, t('boot.desc')),
        row(
          h('input', { type: 'text', placeholder: t('boot.machine'), value: bMachine, disabled: !!busyKind, style: S.input, onChange: e => setBMachine(e.target.value) }),
          h('input', { type: 'text', placeholder: t('boot.dest'), value: bDest, disabled: !!busyKind, style: { ...S.input, width: '16rem' }, onChange: e => setBDest(e.target.value) })),
        row(
          h('input', { type: 'text', placeholder: t('boot.repo'), value: bRepo, disabled: !!busyKind, style: { ...S.input, width: '22rem' }, onChange: e => setBRepo(e.target.value) }),
          btn('act.bootstrap', 'bootstrap', 'settings', S.btnPrimary)),
        busyLine('bootstrap'),
        outBox('settings'))

      const body = tab === 'overview' ? overview
        : tab === 'sync' ? syncTab
        : tab === 'backup' ? backupTab
        : tab === 'env' ? envTab
        : tab === 'plugin' ? pluginTab
        : tab === 'tools' ? toolsTab
        : settingsTab

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.9rem', maxWidth: '48rem' } },
        header,
        h('div', { style: { paddingTop: '0.6rem' } }, body))
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
      }, props => h(SyncHubPage, { ...props, t: (key, args) => fill(t0(key), args) })))
    }

    function fill(text, args) {
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
