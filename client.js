/**
 * dsh-sync-hub — browser half (settings card, tabbed, structured UI).
 *
 * Design rules (memory/shared.md 4.20 + user feedback 2026-10-13):
 *   - Group into TABS; never one long 20-button page.
 *   - Feedback lands NEXT TO the button that caused it; never park output at
 *     the bottom of a long page.
 *   - Draw STRUCTURED data (rows, dots, chips, clickable list) instead of
 *     dumping PowerShell console text — terminal syntax ([PASS], ── ──) is
 *     noise in a GUI.
 *   - One /overview request on mount instead of three slow parallel ones.
 *   - Every action kind MUST have a switch branch (a missing one silently
 *     does nothing).
 *
 * Tabs: 概览 / 同步 / 备份 / 环境 / 技能插件 / 工具链 / 设置
 *
 * Contract: factory MUST return module.exports (NOT module).
 *
 * @module client.js
 */
window.__ModuleLoader__.load({
  id: 'dsh-sync-hub',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, Fragment, useState, useEffect, useCallback, useMemo } = React

    const NS = 'settings.syncHub'
    const inject = ['slots', 'locale']

    const DICT = {
      zh: {
        nav: '同步中枢',
        title: '同步中枢',
        subtitle: '两台电脑的 AI 记忆 / 技能 / 配置同步',
        loading: '读取中…',
        refresh: '刷新',
        busy: '执行中…',
        output: '详情',
        clear: '收起',
        retry: '重试',
        error: '连接失败：{e}',
        state: { pass: '正常', warn: '注意', fail: '异常', info: '信息' },
        tab: { overview: '概览', sync: '同步', backup: '备份', skills: '技能', plugins: '插件', tools: '工具链', settings: '设置' },

        'ov.version': '版本',
        'ov.commit': '最新提交',
        'ov.skills': '技能',
        'ov.tree': '工作区',
        'ov.clean': '干净',
        'ov.dirty': '{n} 个改动待提交',
        'ov.health': '健康检查',
        'ov.runcheck': '运行自检',
        'ov.synced': '与远端一致',
        'ov.ahead': '本地领先 {n}',
        'ov.behind': '远端领先 {n}',

        'act.status': '查看差异',
        'act.push': '上传备份',
        'act.pull': '拉取并应用',
        'act.console': '打开控制台',
        'act.doctor': '体检',
        'act.doctorFix': '体检并修复',
        'act.net': '网络诊断',
        'act.backups': '备份列表',
        'act.restore': '恢复',
        'act.restoreLatest': '恢复最新记忆',
        'act.sessionsBackup': '备份会话',
        'act.sessionsList': '会话列表',
        'act.skillsToHub': '收集新技能',
        'act.skillsFromHub': '安装中枢技能',
        'act.pluginsList': '插件状态',
        'act.pluginsInstall': '安装/修复插件',
        'act.toolsRefresh': '重新检测',
        'act.toolsInstall': '补齐必需',
        'act.toolsInstallNice': '补齐全部',
        'act.logs': '查看日志',
        'act.bootstrap': '一键接入',
        'act.saveCred': '保存并测试',

        'sec.daily': '日常同步',
        'sec.health': '环境维护',
        'sec.backup': '记忆备份',
        'sec.sessions': '会话备份',
        'sec.skills': '技能',
        'sec.plugins': '插件',
        'sec.tools': 'AI 工具链',
        'sec.cred': 'Gitee 凭据',
        'sec.logs': '运行日志',
        'sec.bootstrap': '新机器接入',

        'hint.daily': '干活前拉取、干完活上传。冲突会停下并报告，不会自动改。',
        'sync.whatTitle': '这个页面 = 云端（两台电脑交换）',
        'sync.what': '把本机的记忆/技能/配置通过 Gitee 与另一台电脑交换。上传 = 本机改动送到云端；拉取 = 把云端的改动拿到本机并生效。',
        'sync.upTitle': '① 上传到云端',
        'sync.upHint': '选上传范围后点上传。日常用「全部」即可。',
        'sync.downTitle': '② 从云端拉取',
        'sync.downHint': '把另一台电脑的改动拿下来，并应用到本机 DSH。',
        'sync.stateTitle': '当前状态',
        'sync.scope': '范围：',
        'scope.all': '全部（记忆+技能+配置）',
        'scope.memory': '只记忆',
        'scope.skills': '只技能',
        'scope.config': '只配置',
        'scope.nosession': '记忆+技能+配置（不含会话）',
        'scope.sessions': '只会话备份',
        'opt.skipSkills': '跳过技能（只更新记忆/配置）',
        'opt.skipProfile': '跳过 profile（不改插件链接）',
        'opt.force': '强制（覆盖本地改动，慎用）',
        'bk.whatTitle': '这个页面 = 本机（历史撤销点）',
        'bk.what': '每次改动 AGENTS.md / 插件配置前自动存一份快照，出问题可回滚。这些快照只在本机，不上传云端。',
        'bk.nowTitle': '立即备份一次',
        'bk.nowHint': '手动创建一份当前状态的快照（记忆 + 插件配置）。',
        'bk.listTitle': '历史快照与恢复',
        'act.backupNow': '立即备份',
        'hint.console': '换机器身份、一条龙、冲突处理这类需要人工确认的，在控制台窗口里做。',
        'hint.backup': '备份永不删除。恢复前会自动把当前文件再备份一次。',
        'hint.sessions': '会话备份含对话记录，凭据类文件永不包含。',
        'hint.skills': '本机新装的技能可收集到中枢，另一台拉取即可用。',
        'hint.tools': '核心工具缺失会影响同步；其余按需。DSH 自带 ripgrep 与 LibreOffice，无需另装。',
        'hint.restart': '涉及记忆/插件的改动，重启 DSH 后生效。',
        'hint.cred': '令牌存进 Windows 凭据管理器，不写任何文件，也不会回显。',
        'hint.token': '令牌获取：gitee.com → 设置 → 私人令牌（勾 projects）。',
        'hint.bootstrap': '本机还没有中枢仓库时用：填机器名和目标目录，一键克隆+应用+装插件。',

        'tools.summary': '{p}/{n} 已安装',
        'tools.missingCore': '缺少必需工具',
        'tools.allGood': '全部就位',
        'tools.need': { core: '必需', dev: '开发', nice: '可选' },

        'cred.ok': '已保存',
        'cred.none': '未保存',
        'cred.noneHint': 'push / clone 会失败，请先保存',
        'cred.user': 'Gitee 用户名',
        'cred.token': '私人令牌（只写不回显）',

        'boot.machine': '机器短名（如 home / shop）',
        'boot.dest': '克隆到（如 D:\\AI\\sync-hub）',
        'boot.repo': '仓库地址（留空用默认）',
        'boot.needCred': '请先保存 Gitee 凭据',

        'skills.summary': '中枢 {hub} · 本机 {local}',
        'skills.onlyLocal': '仅本机有（可收集到中枢）',
        'skills.onlyHub': '仅中枢有（可安装到本机）',
        'skills.diff': '两边不同（需人工比对）',
        'skills.junk': '自动生成的占位技能（可忽略或清理）',
        'skills.none': '两边一致',

        // ── 技能页 ──────────────────────────────────────────────────────────
        'sk.title': '本机技能',
        'sk.what': '管理本机所有 Agent 技能：查看、启用/停用、导入、新建、删除。只有 DSH 与 Shared Agent 目录可写，其他 Agent 目录只读展示。',
        'sk.count': '共 {total} 个，启用 {enabled} 个',
        'sk.invalid': '{n} 个不合法（DSH 会静默跳过）',
        'sk.ro': '（只读）',
        'sk.filter': '按名称/描述筛选',
        'sk.listTitle': '技能列表',
        'sk.enable': '启用',
        'sk.disable': '停用',
        'sk.view': '查看',
        'sk.trash': '删除',
        'sk.restore': '恢复',
        'sk.addTitle': '导入线上技能 / 新建技能',
        'sk.addHint': '导入支持：GitHub 仓库地址、GitHub 子目录、.zip 压缩包、原始 SKILL.md 链接。已存在的同名技能不会被覆盖。',
        'sk.urlPh': '粘贴网址（GitHub 仓库 / zip / SKILL.md）',
        'sk.namePh': '技能名（可留空自动识别）',
        'sk.newNamePh': '新技能名（kebab-case）',
        'sk.newDescPh': 'description（必填，决定何时被调用）',
        'sk.hubTitle': '与中枢同步',
        'sk.trashTitle': '回收站',
        'sk.trashEmpty': '回收站是空的',
        'act.skRefresh': '刷新列表',
        'act.skImport': '导入',
        'act.skCreate': '新建',
        'act.skDiff': '对比中枢',
        'act.skTrashList': '查看回收站',

        // ── 插件页 ──────────────────────────────────────────────────────────
        'pl.title': '已安装插件',
        'pl.what': '查看各 profile 已装的插件、链接健康状态，可卸载；市场页可从 npm 搜索并安装新插件。',
        'pl.profile': 'profile {name}（{n} 个）',
        'pl.bundled': '已挂载',
        'pl.broken': '链接损坏',
        'pl.uninstall': '卸载',
        'pl.builtin': '内置（无依赖行）',
        'pl.marketTitle': '插件市场（npm）',
        'pl.marketHint': '搜索 npm 上的 DSH 插件（关键词 dsh-plugin）。安装前请完全退出 DSH，否则 pnpm 被锁。',
        'pl.searchPh': '搜索插件（留空看热门）',
        'pl.found': '找到 {n} 个',
        'pl.noResult': '没有结果',
        'pl.install': '安装',
        'act.plList': '刷新已装',
        'act.plSearch': '搜索市场',

        'check.pass': '通过',
        'check.warn': '注意',
        'check.fail': '失败',
        'logs.newest': '最新日志：{name}',
        'empty.output': '（无输出）',
      },
      en: {
        nav: 'Sync Hub',
        title: 'Sync Hub',
        subtitle: 'Cross-machine AI memory / skills / config',
        loading: 'Loading…',
        refresh: 'Refresh',
        busy: 'Running…',
        output: 'Details',
        clear: 'Hide',
        retry: 'Retry',
        error: 'Connection failed: {e}',
        state: { pass: 'OK', warn: 'Warning', fail: 'Failed', info: 'Info' },
        tab: { overview: 'Overview', sync: 'Sync', backup: 'Backup', skills: 'Skills', plugins: 'Plugins', tools: 'Toolchain', settings: 'Settings' },

        'ov.version': 'Version',
        'ov.commit': 'Last commit',
        'ov.skills': 'Skills',
        'ov.tree': 'Working tree',
        'ov.clean': 'clean',
        'ov.dirty': '{n} pending change(s)',
        'ov.health': 'Health',
        'ov.runcheck': 'Run self-check',
        'ov.synced': 'in sync with remote',
        'ov.ahead': '{n} ahead',
        'ov.behind': '{n} behind',

        'act.status': 'Status',
        'act.push': 'Push',
        'act.pull': 'Pull & apply',
        'act.console': 'Open console',
        'act.doctor': 'Doctor',
        'act.doctorFix': 'Doctor + fix',
        'act.net': 'Network check',
        'act.backups': 'Backups',
        'act.restore': 'Restore',
        'act.restoreLatest': 'Restore newest memory',
        'act.sessionsBackup': 'Backup sessions',
        'act.sessionsList': 'Session list',
        'act.skillsToHub': 'Collect new skills',
        'act.skillsFromHub': 'Install hub skills',
        'act.pluginsList': 'Plugin status',
        'act.pluginsInstall': 'Install/repair plugins',
        'act.toolsRefresh': 'Re-detect',
        'act.toolsInstall': 'Install required',
        'act.toolsInstallNice': 'Install all',
        'act.logs': 'View logs',
        'act.bootstrap': 'Bootstrap',
        'act.saveCred': 'Save & test',

        'sec.daily': 'Daily sync',
        'sec.health': 'Environment',
        'sec.backup': 'Memory backups',
        'sec.sessions': 'Session backups',
        'sec.skills': 'Skills',
        'sec.plugins': 'Plugins',
        'sec.tools': 'AI toolchain',
        'sec.cred': 'Gitee credential',
        'sec.logs': 'Runtime logs',
        'sec.bootstrap': 'New machine',

        'hint.daily': 'Pull before work, push after. Conflicts stop and report; nothing is auto-resolved.',
        'sync.whatTitle': 'This tab = CLOUD (swap between two PCs)',
        'sync.what': 'Exchanges memory/skills/config with the other computer through Gitee. Upload sends this machine\'s changes to the cloud; Pull brings the cloud\'s changes here and applies them.',
        'sync.upTitle': '1) Upload to cloud',
        'sync.upHint': 'Pick a scope, then upload. "All" is fine for daily use.',
        'sync.downTitle': '2) Pull from cloud',
        'sync.downHint': 'Fetch the other computer\'s changes and apply them to this DSH.',
        'sync.stateTitle': 'Current state',
        'sync.scope': 'Scope:',
        'scope.all': 'All (memory + skills + config)',
        'scope.memory': 'Memory only',
        'scope.skills': 'Skills only',
        'scope.config': 'Config only',
        'scope.nosession': 'Memory + skills + config (no sessions)',
        'scope.sessions': 'Session backups only',
        'opt.skipSkills': 'Skip skills (memory/config only)',
        'opt.skipProfile': 'Skip profile (keep plugin links)',
        'opt.force': 'Force (overwrite local changes — careful)',
        'bk.whatTitle': 'This tab = LOCAL (undo points)',
        'bk.what': 'A snapshot is taken automatically before AGENTS.md / plugin config changes, so you can roll back. These live on this machine only — they are not uploaded.',
        'bk.nowTitle': 'Back up now',
        'bk.nowHint': 'Take a manual snapshot of the current state (memory + plugin config).',
        'bk.listTitle': 'Snapshots & restore',
        'act.backupNow': 'Back up now',
        'hint.console': 'Identity switch, one-stop setup and conflict fixes stay in the console window.',
        'hint.backup': 'Backups are never deleted. Restore backs up the current file first.',
        'hint.sessions': 'Session backups contain chat history; credentials are never included.',
        'hint.skills': 'Collect locally added skills to the hub so the other machine can install them.',
        'hint.tools': 'Missing core tools affect sync. DSH bundles ripgrep and LibreOffice already.',
        'hint.restart': 'Memory/plugin changes take effect after a DSH restart.',
        'hint.cred': 'The token goes to the Windows Credential Manager — never a file, never echoed.',
        'hint.token': 'Token: gitee.com → Settings → Private Token (projects scope).',
        'hint.bootstrap': 'Use when this machine has no hub clone: name + folder, then clone + apply + install.',

        'tools.summary': '{p}/{n} installed',
        'tools.missingCore': 'required tools missing',
        'tools.allGood': 'all present',
        'tools.need': { core: 'required', dev: 'dev', nice: 'optional' },

        'cred.ok': 'stored',
        'cred.none': 'not stored',
        'cred.noneHint': 'push / clone will fail — save it first',
        'cred.user': 'Gitee username',
        'cred.token': 'private token (write-only)',

        'boot.machine': 'machine id (e.g. home / shop)',
        'boot.dest': 'clone into (e.g. D:\\AI\\sync-hub)',
        'boot.repo': 'repo URL (blank = default)',
        'boot.needCred': 'Save the Gitee credential first',

        'skills.summary': 'hub {hub} · local {local}',
        'skills.onlyLocal': 'local only (collectable)',
        'skills.onlyHub': 'hub only (installable)',
        'skills.diff': 'differ (needs review)',
        'skills.junk': 'auto-generated placeholders (ignorable)',
        'skills.none': 'both sides match',

        // ── skills tab ──────────────────────────────────────────────────────
        'sk.title': 'Local skills',
        'sk.what': 'Manage every Agent skill on this machine: view, enable/disable, import, create, delete. Only the DSH and Shared Agent dirs are writable; other agents are read-only.',
        'sk.count': '{total} total, {enabled} enabled',
        'sk.invalid': '{n} invalid (DSH silently skips them)',
        'sk.ro': ' (read-only)',
        'sk.filter': 'Filter by name/description',
        'sk.listTitle': 'Skill list',
        'sk.enable': 'Enable',
        'sk.disable': 'Disable',
        'sk.view': 'View',
        'sk.trash': 'Delete',
        'sk.restore': 'Restore',
        'sk.addTitle': 'Import from URL / create new',
        'sk.addHint': 'Import supports: GitHub repo, GitHub subdirectory, .zip archive, raw SKILL.md URL. An existing name is never overwritten.',
        'sk.urlPh': 'paste a URL (GitHub repo / zip / SKILL.md)',
        'sk.namePh': 'skill name (blank = auto-detect)',
        'sk.newNamePh': 'new skill name (kebab-case)',
        'sk.newDescPh': 'description (required — decides when it is used)',
        'sk.hubTitle': 'Sync with hub',
        'sk.trashTitle': 'Trash',
        'sk.trashEmpty': 'trash is empty',
        'act.skRefresh': 'Refresh list',
        'act.skImport': 'Import',
        'act.skCreate': 'Create',
        'act.skDiff': 'Diff with hub',
        'act.skTrashList': 'View trash',

        // ── plugins tab ─────────────────────────────────────────────────────
        'pl.title': 'Installed plugins',
        'pl.what': 'Installed plugins per profile with link health; uninstall here. The market searches npm and installs new ones.',
        'pl.profile': 'profile {name} ({n})',
        'pl.bundled': 'bundled',
        'pl.broken': 'link broken',
        'pl.uninstall': 'Uninstall',
        'pl.builtin': 'built-in (no dependency row)',
        'pl.marketTitle': 'Plugin market (npm)',
        'pl.marketHint': 'Search DSH plugins on npm (keyword dsh-plugin). Quit DSH fully before installing or pnpm stays locked.',
        'pl.searchPh': 'search plugins (blank = popular)',
        'pl.found': '{n} found',
        'pl.noResult': 'no results',
        'pl.install': 'Install',
        'act.plList': 'Refresh installed',
        'act.plSearch': 'Search market',

        'check.pass': 'pass',
        'check.warn': 'warn',
        'check.fail': 'fail',
        'logs.newest': 'newest log: {name}',
        'empty.output': '(no output)',
      },
    }

    const API = (() => {
      try { return new URL('api/sync-hub', document.baseURI).pathname } catch { return '/api/sync-hub' }
    })()

    async function api(path, options) {
      const { timeout = 20000, ...rest } = options ?? {}
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const res = await fetch(`${API}${path}`, { ...rest, redirect: 'error', signal: ctrl.signal })
        const text = await res.text()
        let payload
        try { payload = text === '' ? {} : JSON.parse(text) } catch { payload = { error: text.slice(0, 200) } }
        if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`)
        return payload
      } finally { clearTimeout(timer) }
    }
    const post = (path, body, timeout) => api(path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(timeout === undefined ? {} : { timeout }),
    })

    const LEVEL = {
      pass: { dot: '#2ea043', bg: 'rgba(46,160,67,0.10)', label: 'pass' },
      ok: { dot: '#2ea043', bg: 'rgba(46,160,67,0.10)', label: 'pass' },
      warn: { dot: '#d29922', bg: 'rgba(210,153,34,0.12)', label: 'warn' },
      fail: { dot: '#d1242f', bg: 'rgba(209,36,47,0.12)', label: 'fail' },
      info: { dot: '#6e7781', bg: 'rgba(110,119,129,0.10)', label: 'info' },
      note: { dot: '#6e7781', bg: 'transparent', label: '' },
    }

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '0.85rem', maxWidth: '52rem' },
      h2: { fontSize: '1.1rem', margin: 0, fontWeight: 600 },
      sub: { fontSize: '0.78rem', opacity: 0.6, margin: 0 },
      tabs: { display: 'flex', gap: '0.2rem', flexWrap: 'wrap', borderBottom: '1px solid var(--color-border, rgba(128,128,128,0.22))' },
      tab: { padding: '0.4rem 0.75rem', fontSize: '0.8rem', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', opacity: 0.6, borderBottom: '2px solid transparent', marginBottom: '-1px' },
      tabOn: { opacity: 1, fontWeight: 600, borderBottom: '2px solid var(--color-accent, #2a6)' },
      card: { border: '1px solid var(--color-border, rgba(128,128,128,0.22))', borderRadius: '0.6rem', padding: '0.75rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' },
      cardTitle: { fontSize: '0.82rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' },
      row: { display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' },
      btn: { padding: '0.32rem 0.75rem', borderRadius: '0.45rem', fontSize: '0.78rem', border: '1px solid var(--color-border, rgba(128,128,128,0.3))', background: 'var(--color-surface, rgba(128,128,128,0.07))', color: 'inherit', cursor: 'pointer' },
      primary: { background: 'var(--color-accent, #2a6)', color: '#fff', borderColor: 'transparent' },
      input: { padding: '0.32rem 0.55rem', borderRadius: '0.45rem', fontSize: '0.76rem', width: '12rem', border: '1px solid var(--color-border, rgba(128,128,128,0.3))', background: 'var(--color-surface, rgba(128,128,128,0.05))', color: 'inherit' },
      hint: { fontSize: '0.7rem', opacity: 0.55, margin: 0, lineHeight: 1.5 },
      kv: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.3rem 0.75rem', fontSize: '0.78rem', alignItems: 'baseline' },
      kvKey: { opacity: 0.6, whiteSpace: 'nowrap' },
      chip: { fontSize: '0.68rem', padding: '0.12rem 0.45rem', borderRadius: '0.65rem', border: '1px solid var(--color-border, rgba(128,128,128,0.28))', whiteSpace: 'nowrap' },
      listRow: { display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.76rem', padding: '0.3rem 0.45rem', borderRadius: '0.4rem', background: 'var(--color-surface, rgba(128,128,128,0.05))' },
      pre: { margin: 0, padding: '0.55rem', borderRadius: '0.45rem', fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '16rem', overflow: 'auto', background: 'var(--color-surface, rgba(128,128,128,0.07))', border: '1px solid var(--color-border, rgba(128,128,128,0.2))', fontFamily: 'ui-monospace, Consolas, monospace' },
    }

    const TABS = ['overview', 'sync', 'backup', 'skills', 'plugins', 'tools', 'settings']

    function Dot({ level }) {
      const L = LEVEL[level] || LEVEL.info
      return h('span', { style: { display: 'inline-block', width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: L.dot, flex: '0 0 auto' } })
    }
    // rest parameter: callers pass children as separate arguments
    // (Card({title}, childA, childB)). A single `children` prop would break
    // as soon as a card has more than one child.
    function Card({ title, level, ...rest }) {
      const kids = rest.children || []
      return h('div', { style: S.card },
        title ? h('h3', { style: S.cardTitle }, level ? h(Dot, { level }) : null, title) : null,
        ...(Array.isArray(kids) ? kids : [kids]))
    }
    function KV({ k, v }) {
      return h(Fragment, {}, h('span', { style: S.kvKey }, k), h('span', {}, v))
    }

    function SyncHubPage({ t }) {
      const [tab, setTab] = useState('overview')
      const [ov, setOv] = useState(undefined)
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState('')
      const [out, setOut] = useState({})
      const [checks, setChecks] = useState(undefined)
      const [backups, setBackups] = useState(undefined)
      const [skills, setSkills] = useState(undefined)
      const [logs, setLogs] = useState(undefined)
      const [cUser, setCUser] = useState('')
      const [cToken, setCToken] = useState('')
      const [bMachine, setBMachine] = useState('')
      const [bDest, setBDest] = useState('')
      const [bRepo, setBRepo] = useState('')
      // sync options (方案 A): upload scope + pull switches
      const [pushScope, setPushScope] = useState('all')
      const [pullSkipSkills, setPullSkipSkills] = useState(false)
      const [pullSkipProfile, setPullSkipProfile] = useState(false)
      const [pullForce, setPullForce] = useState(false)
      // skills page
      const [skList, setSkList] = useState(undefined)
      const [skFilter, setSkFilter] = useState('')
      const [skUrl, setSkUrl] = useState('')
      const [skName, setSkName] = useState('')
      const [skNewName, setSkNewName] = useState('')
      const [skNewDesc, setSkNewDesc] = useState('')
      const [trashList, setTrashList] = useState(undefined)
      // plugins page
      const [plList, setPlList] = useState(undefined)
      const [plMarket, setPlMarket] = useState(undefined)
      const [plQuery, setPlQuery] = useState('')

      const put = useCallback((k, v) => setOut(p => ({ ...p, [k]: v })), [])

      const loadOverview = useCallback(() => {
        setErr('')
        return api('/overview', { timeout: 120000 })
          .then(setOv)
          .catch(e => setErr(String(e?.message ?? e)))
      }, [])

      useEffect(() => { loadOverview() }, [loadOverview])

      // Every kind MUST have a branch here (missing branch = dead button).
      // `arg` carries per-row payloads (skill name/rootId, plugin name/profile).
      const run = useCallback(async (kind, key, arg) => {
        setBusy(kind)
        put(key, '')
        const a = arg || {}
        try {
          let r
          switch (kind) {
            case 'refresh': await loadOverview(); r = { text: '' }; break
            case 'selfcheck': r = await api('/selfcheck', { timeout: 180000 }); setChecks(r.checks || []); break
            case 'status': r = await api('/status', { timeout: 120000 }); break
            case 'push': r = await post('/push', { scope: pushScope }, 300000); await loadOverview(); break
            case 'pull': r = await post('/pull', { skipSkills: pullSkipSkills, skipProfile: pullSkipProfile, force: pullForce }, 300000); await loadOverview(); break
            case 'backupNow': r = await post('/backup/create', {}, 90000); break
            case 'console': r = await post('/console'); break
            case 'doctor': r = await post('/doctor', {}, 240000); break
            case 'doctorFix': r = await post('/doctor', { fix: true }, 240000); break
            case 'net': r = await post('/net', {}, 180000); break
            case 'backups': r = await api('/backups', { timeout: 90000 }); setBackups(r.items || []); break
            case 'restore': r = await post('/restore', { name: a.name || (key === 'restoreLatest' ? 'latest-agents' : (window.__shRestore || '')) }, 90000); break
            case 'sessionsBackup': r = await post('/sessions', { action: 'backup' }, 600000); break
            case 'sessionsList': r = await post('/sessions', { action: 'list' }, 90000); break
            case 'skillsInfo': r = await api('/skills', { timeout: 60000 }); setSkills(r); break
            case 'skillsToHub': r = await post('/skills', { dir: 'tohub' }, 240000); break
            case 'skillsFromHub': r = await post('/skills', { dir: 'fromhub' }, 240000); break
            // ── skills page ──────────────────────────────────────────────────
            case 'skRefresh': {
              const list = await api('/skills/list', { timeout: 60000 })
              setSkList(list)
              r = { text: list.ok ? '' : String(list.error || '') }
              break
            }
            case 'skEnable': r = await post('/skills/toggle', { name: a.name, rootId: a.rootId, enable: true }, 30000); await run('skRefresh', key); break
            case 'skDisable': r = await post('/skills/toggle', { name: a.name, rootId: a.rootId, enable: false }, 30000); await run('skRefresh', key); break
            case 'skRead': r = await post('/skills/read', { name: a.name, rootId: a.rootId }, 30000); break
            case 'skImport': {
              if (!skUrl.trim()) { r = { text: '请先填网址' }; break }
              r = await post('/skills/import', { url: skUrl.trim(), name: skName.trim() }, 300000)
              if (r.ok) { setSkUrl(''); setSkName('') }
              await run('skRefresh', key)
              break
            }
            case 'skCreate': {
              if (!skNewName.trim() || !skNewDesc.trim()) { r = { text: '技能名和 description 都要填' }; break }
              r = await post('/skills/create', { name: skNewName.trim(), description: skNewDesc.trim() }, 30000)
              if (r.ok) { setSkNewName(''); setSkNewDesc('') }
              await run('skRefresh', key)
              break
            }
            case 'skTrash': r = await post('/skills/trash', { name: a.name }, 30000); await run('skRefresh', key); break
            case 'skTrashList': {
              const t = await api('/skills/trash', { timeout: 30000 })
              setTrashList(t)
              r = { text: '' }
              break
            }
            case 'skRestore': r = await post('/skills/restore', { name: a.name }, 30000); await run('skTrashList', 'skTrashList'); await run('skRefresh', key); break
            // ── plugins page ─────────────────────────────────────────────────
            case 'plRefresh': {
              const list = await api('/plugins/list', { timeout: 60000 })
              setPlList(list)
              r = { text: '' }
              break
            }
            case 'plSearch': {
              const m = await api('/plugins/market?q=' + encodeURIComponent(plQuery.trim()) + '&size=20', { timeout: 60000 })
              setPlMarket(m)
              r = { text: m.ok ? '' : String(m.text || '') }
              break
            }
            case 'plInstall': r = await post('/plugins/install', { name: a.name, profile: a.profile || 'desktop' }, 900000); break
            case 'plUninstall': r = await post('/plugins/uninstall', { name: a.name, profile: a.profile || 'desktop' }, 300000); await run('plRefresh', key); break
            case 'pluginsInstall': r = await post('/plugins', { action: 'install' }, 600000); break
            case 'toolsRefresh': await loadOverview(); r = { text: '' }; break
            case 'toolsInstall': r = await post('/tools/install', { mode: 'all' }, 900000); await loadOverview(); break
            case 'toolsInstallNice': r = await post('/tools/install', { mode: 'allnice' }, 1800000); await loadOverview(); break
            case 'logs': r = await api('/logs', { timeout: 30000 }); setLogs(r); break
            case 'saveCred': r = await post('/cred', { username: cUser, token: cToken }, 180000); setCToken(''); await loadOverview(); break
            case 'bootstrap': r = await post('/bootstrap', { machine: bMachine, dest: bDest, ...(bRepo.trim() ? { repoUrl: bRepo.trim() } : {}) }, 1500000); break
            default: r = { text: 'unknown action: ' + kind }
          }
          if (r && r.text) put(key, r.text)
        } catch (e) {
          put(key, '✗ ' + String(e?.message ?? e))
        } finally { setBusy('') }
      }, [loadOverview, put, cUser, cToken, bMachine, bDest, bRepo, pushScope, pullSkipSkills, pullSkipProfile, pullForce, skUrl, skName, skNewName, skNewDesc, plQuery])

      const Btn = ({ label, kind, key: outKey, primary, small, arg }) => {
        const isBusy = busy === kind
        return h('button', {
          type: 'button',
          style: { ...S.btn, ...(primary ? S.primary : {}), ...(small ? { fontSize: '0.72rem', padding: '0.22rem 0.55rem' } : {}), ...(isBusy ? { opacity: 0.65 } : {}) },
          disabled: !!busy,
          onClick: () => run(kind, outKey || kind, arg),
        }, isBusy ? (label + ' …') : label)
      }

      // result of an action, shown inside the card that owns it
      const Result = ({ k }) => {
        const text = out[k]
        if (!text) return null
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.3rem' } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('span', { style: { fontSize: '0.7rem', opacity: 0.6 } }, t('output')),
            h('button', { type: 'button', style: { ...S.btn, ...{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' } }, onClick: () => put(k, '') }, t('clear'))),
          h('pre', { style: S.pre }, text))
      }

      const header = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.6rem' } },
        h('div', {},
          h('h2', { style: S.h2 }, t('title')),
          h('p', { style: S.sub }, t('subtitle'))),
        h('div', { style: S.tabs }, ...TABS.map(k => h('button', {
          key: k, type: 'button', style: { ...S.tab, ...(tab === k ? S.tabOn : {}) }, onClick: () => setTab(k),
        }, t('tab.' + k)))))

      const shell = (...body) => h('div', { style: S.wrap }, header, ...body)

      // ── no hub yet ─────────────────────────────────────────────────────────
      if (ov && ov.info === undefined && !err) {
        return shell(h('p', { style: S.hint }, t('loading')))
      }
      const noHub = ov && ov.ok === false
      if (noHub) {
        return shell(
          h(Card, { title: t('sec.cred'), level: 'warn' },
            h('div', { style: S.row },
              h('input', { type: 'text', placeholder: t('cred.user'), value: cUser, style: S.input, onChange: e => setCUser(e.target.value) }),
              h('input', { type: 'password', placeholder: t('cred.token'), value: cToken, style: S.input, onChange: e => setCToken(e.target.value) }),
              h(Btn, { label: t('act.saveCred'), kind: 'saveCred' })),
            h('p', { style: S.hint }, t('hint.cred')),
            h('p', { style: S.hint }, t('hint.token')),
            h(Result, { k: 'saveCred' })),
          h(Card, { title: t('sec.bootstrap') },
            h('div', { style: S.row },
              h('input', { type: 'text', placeholder: t('boot.machine'), value: bMachine, style: S.input, onChange: e => setBMachine(e.target.value) }),
              h('input', { type: 'text', placeholder: t('boot.dest'), value: bDest, style: { ...S.input, width: '15rem' }, onChange: e => setBDest(e.target.value) })),
            h('div', { style: S.row },
              h('input', { type: 'text', placeholder: t('boot.repo'), value: bRepo, style: { ...S.input, width: '20rem' }, onChange: e => setBRepo(e.target.value) }),
              h(Btn, { label: t('act.bootstrap'), kind: 'bootstrap', primary: true })),
            h('p', { style: S.hint }, t('hint.bootstrap')),
            h(Result, { k: 'bootstrap' })))
      }

      const info = (ov && ov.info) || {}
      const cred = (ov && ov.cred) || {}
      const tools = (ov && ov.tools) || { tools: [], present: 0, total: 0, missingCore: 0 }
      const st = (ov && ov.status) || { sections: [], worst: 'pass' }

      const overviewTab = [
        h(Card, { key: 'kv' },
          h('div', { style: S.kv },
            h(KV, { k: t('ov.version'), v: 'v' + (info.version || '?') + '   ·   ' + (info.machine || '') }),
            h(KV, { k: t('ov.commit'), v: [info.commit, info.commitDate, info.commitSubject].filter(Boolean).join('  ') }),
            h(KV, { k: t('ov.skills'), v: String(info.skills ?? '?') }),
            h(KV, { k: t('ov.tree'), v: info.dirty === 0 ? t('ov.clean') : t('ov.dirty', { n: info.dirty }) }),
            h(KV, { k: t('sec.cred'), v: cred.hasCredential ? (t('cred.ok') + '  ·  ' + (cred.username || '') + '  ·  ' + (cred.repoHost || '')) : t('cred.none') }),
            h(KV, { k: t('sec.tools'), v: t('tools.summary', { p: tools.present, n: tools.total }) + (tools.missingCore ? '   ·   ' + t('tools.missingCore') : '') })),
          h('div', { style: S.row },
            h(Btn, { label: t('refresh'), kind: 'refresh', key: 'ovRefresh' }),
            h(Btn, { label: t('ov.runcheck'), kind: 'selfcheck', key: 'selfcheck' }))),
        checks ? h(Card, { key: 'chk', title: t('ov.health'), level: checks.some(c => c.level === 'fail') ? 'fail' : (checks.some(c => c.level === 'warn') ? 'warn' : 'pass') },
          ...checks.map(c => h('div', { key: c.key, style: S.listRow },
            h(Dot, { level: c.level }),
            h('span', { style: { minWidth: '5.5rem', opacity: 0.75 } }, c.key),
            h('span', { style: { flex: 1 } }, c.detail)))) : null,
        h(Result, { key: 'r', k: 'selfcheck' }),
      ]

      // ── 同步 = 云端（两台电脑通过 Gitee 交换改动） ──────────────────────────
      const syncTab = [
        h(Card, { key: 'what', title: t('sync.whatTitle') },
          h('p', { style: { ...S.hint, fontSize: '0.74rem' } }, t('sync.what')),
          h('p', { style: S.hint }, t('hint.console'))),
        h(Card, { key: 'up', title: t('sync.upTitle'), level: st.worst },
          h('p', { style: S.hint }, t('sync.upHint')),
          h('div', { style: S.row },
            h('span', { style: { fontSize: '0.74rem', opacity: 0.7 } }, t('sync.scope')),
            h('select', {
              style: { ...S.input, width: 'auto' },
              value: pushScope, disabled: !!busy,
              onChange: e => setPushScope(e.target.value),
            },
              h('option', { value: 'all' }, t('scope.all')),
              h('option', { value: 'memory' }, t('scope.memory')),
              h('option', { value: 'skills' }, t('scope.skills')),
              h('option', { value: 'config' }, t('scope.config')),
              h('option', { value: 'memory,skills,config' }, t('scope.nosession')),
              h('option', { value: 'sessions' }, t('scope.sessions')))),
          h('div', { style: S.row },
            h(Btn, { label: t('act.push'), kind: 'push', key: 'syncPush', primary: true }),
            h(Btn, { label: t('act.status'), kind: 'status', key: 'syncStatus' })),
          h(Result, { k: 'syncPush' }), h(Result, { k: 'syncStatus' })),
        h(Card, { key: 'down', title: t('sync.downTitle') },
          h('p', { style: S.hint }, t('sync.downHint')),
          h('div', { style: S.row },
            h('label', { style: { ...S.hint, display: 'flex', gap: '0.3rem', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: pullSkipSkills, disabled: !!busy, onChange: e => setPullSkipSkills(e.target.checked) }),
              t('opt.skipSkills')),
            h('label', { style: { ...S.hint, display: 'flex', gap: '0.3rem', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: pullSkipProfile, disabled: !!busy, onChange: e => setPullSkipProfile(e.target.checked) }),
              t('opt.skipProfile')),
            h('label', { style: { ...S.hint, display: 'flex', gap: '0.3rem', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: pullForce, disabled: !!busy, onChange: e => setPullForce(e.target.checked) }),
              t('opt.force'))),
          h('div', { style: S.row },
            h(Btn, { label: t('act.pull'), kind: 'pull', key: 'syncPull', primary: true }),
            h(Btn, { label: t('act.console'), kind: 'console', key: 'syncConsole' })),
          h('p', { style: S.hint }, t('hint.pull')),
          h(Result, { k: 'syncPull' })),
        st.sections && st.sections.length ? h(Card, { key: 'st', title: t('sync.stateTitle'), level: st.worst },
          ...st.sections.map((sec, i) => h('div', { key: i, style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } },
            h('div', { style: { fontSize: '0.72rem', opacity: 0.55, marginTop: i ? '0.3rem' : 0 } }, sec.title),
            ...sec.items.map((it, j) => h('div', { key: j, style: { ...S.listRow, alignItems: 'flex-start', background: LEVEL[it.level]?.bg || 'transparent' } },
              h(Dot, { level: it.level }),
              h('span', { style: { whiteSpace: 'pre-wrap' } }, it.text)))))) : null,
      ]

      // ── 备份 = 本机（历史快照，防手滑） ────────────────────────────────────
      const backupTab = [
        h(Card, { key: 'what', title: t('bk.whatTitle') },
          h('p', { style: { ...S.hint, fontSize: '0.74rem' } }, t('bk.what'))),
        h(Card, { key: 'now', title: t('bk.nowTitle') },
          h('p', { style: S.hint }, t('bk.nowHint')),
          h('div', { style: S.row },
            h(Btn, { label: t('act.backupNow'), kind: 'backupNow', key: 'bkNow', primary: true })),
          h(Result, { k: 'bkNow' })),
        h(Card, { key: 'b', title: t('bk.listTitle') },
          h('div', { style: S.row },
            h(Btn, { label: t('act.backups'), kind: 'backups', key: 'bkList' }),
            h(Btn, { label: t('act.restoreLatest'), kind: 'restore', key: 'restoreLatest' })),
          h('p', { style: S.hint }, t('hint.backup')),
          backups === undefined ? null : (backups.length === 0
            ? h('p', { style: S.hint }, t('empty.output'))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.25rem' } },
                ...backups.map(b => h('div', { key: b.name, style: S.listRow },
                  h('span', { style: { opacity: 0.5, minWidth: '1.6rem' } }, '#' + b.index),
                  h('span', { style: { flex: 1, wordBreak: 'break-all' } }, b.name),
                  h('span', { style: { opacity: 0.6, whiteSpace: 'nowrap' } }, b.size + '  ' + b.date),
                  h('button', {
                    type: 'button', style: { ...S.btn, fontSize: '0.68rem', padding: '0.15rem 0.5rem' },
                    disabled: !!busy,
                    onClick: () => { window.__shRestore = b.name; run('restore', 'restoreLatest') },
                  }, t('act.restore')))))),
          h(Result, { k: 'bkList' }), h(Result, { k: 'restoreLatest' })),
        h(Card, { key: 's', title: t('sec.sessions') },
          h('div', { style: S.row },
            h(Btn, { label: t('act.sessionsBackup'), kind: 'sessionsBackup', key: 'sessB' }),
            h(Btn, { label: t('act.sessionsList'), kind: 'sessionsList', key: 'sessL' })),
          h('p', { style: S.hint }, t('hint.sessions')),
          h(Result, { k: 'sessB' }), h(Result, { k: 'sessL' })),
      ]

      // (environment checks were merged into the toolchain tab: both are
      //  "this machine" concerns, and a separate tab for 3 buttons was noise)

      // ── 技能页：本机技能管理（启停/导入/新建）+ 中枢同步 ──────────────────
      const skillsTab = [
        h(Card, { key: 'stat', title: t('sk.title') },
          h('p', { style: S.hint }, t('sk.what')),
          skList ? h('p', { style: { fontSize: '0.78rem', margin: 0 } },
            t('sk.count', { total: skList.total, enabled: skList.enabled }) +
            (skList.invalid ? '   ·   ' + t('sk.invalid', { n: skList.invalid }) : '') +
            (skList.roots ? '   ·   ' + skList.roots.map(r => r.label + (r.writable ? '' : t('sk.ro'))).join(' / ') : ''))
            : h('p', { style: S.hint }, t('loading')),
          h('div', { style: S.row },
            h(Btn, { label: t('act.skRefresh'), kind: 'skRefresh', key: 'skRefresh', primary: true }),
            h('input', { type: 'text', placeholder: t('sk.filter'), value: skFilter, style: { ...S.input, width: '11rem' }, onChange: e => setSkFilter(e.target.value) }))),

        // full inventory: one row per skill, toggle + read + trash
        skList && skList.items ? h(Card, { key: 'list', title: t('sk.listTitle') },
          ...skList.items
            .filter(s => !skFilter || s.name.toLowerCase().includes(skFilter.toLowerCase()) || (s.description || '').toLowerCase().includes(skFilter.toLowerCase()))
            .slice(0, 200)
            .map(s => h('div', { key: s.rootId + '/' + s.name, style: S.listRow },
              h(Dot, { level: s.enabled ? 'pass' : 'info' }),
              h('span', { style: { flex: '1 1 12rem', wordBreak: 'break-all', fontWeight: s.enabled ? 500 : 400, opacity: s.enabled ? 1 : 0.55 } }, s.name),
              h('span', { style: { ...S.chip, opacity: 0.7, fontSize: '0.62rem' } }, s.rootLabel),
              h('span', { style: { fontSize: '0.66rem', opacity: 0.5, minWidth: '3.2rem', textAlign: 'right' } }, s.sizeKB + 'KB'),
              h('span', { style: { flex: '2 1 14rem', fontSize: '0.68rem', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.description || ''),
              s.writable ? h('button', {
                type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                onClick: () => run(s.enabled ? 'skDisable' : 'skEnable', 'skOp', { name: s.name, rootId: s.rootId }),
              }, s.enabled ? t('sk.disable') : t('sk.enable')) : null,
              h('button', {
                type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                onClick: () => run('skRead', 'skOp', { name: s.name, rootId: s.rootId }),
              }, t('sk.view')),
              s.writable && s.rootId === 'dsh' ? h('button', {
                type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                onClick: () => run('skTrash', 'skOp', { name: s.name }),
              }, t('sk.trash')) : null))
          ) : null,
        h(Result, { k: 'skOp' }),

        // import from URL / create new
        h(Card, { key: 'add', title: t('sk.addTitle') },
          h('p', { style: S.hint }, t('sk.addHint')),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('sk.urlPh'), value: skUrl, disabled: !!busy, style: { ...S.input, width: '24rem' }, onChange: e => setSkUrl(e.target.value) }),
            h('input', { type: 'text', placeholder: t('sk.namePh'), value: skName, disabled: !!busy, style: { ...S.input, width: '9rem' }, onChange: e => setSkName(e.target.value) }),
            h(Btn, { label: t('act.skImport'), kind: 'skImport', key: 'skImport', primary: true })),
          h(Result, { k: 'skImport' }),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('sk.newNamePh'), value: skNewName, disabled: !!busy, style: { ...S.input, width: '10rem' }, onChange: e => setSkNewName(e.target.value) }),
            h('input', { type: 'text', placeholder: t('sk.newDescPh'), value: skNewDesc, disabled: !!busy, style: { ...S.input, width: '20rem' }, onChange: e => setSkNewDesc(e.target.value) }),
            h(Btn, { label: t('act.skCreate'), kind: 'skCreate', key: 'skCreate' })),
          h(Result, { k: 'skCreate' })),

        // hub sync (cloud side of skills)
        h(Card, { key: 'hub', title: t('sk.hubTitle') },
          h('p', { style: S.hint }, t('hint.skills')),
          h('div', { style: S.row },
            h(Btn, { label: t('act.skillsToHub'), kind: 'skillsToHub', key: 'skTo', primary: true }),
            h(Btn, { label: t('act.skillsFromHub'), kind: 'skillsFromHub', key: 'skFrom' }),
            h(Btn, { label: t('act.skDiff'), kind: 'skillsInfo', key: 'skInfo' })),
          skills ? h(Fragment, {},
            h('p', { style: { ...S.hint, opacity: 0.75 } }, t('skills.summary', { hub: skills.hub, local: skills.local })),
            (skills.onlyLocalReal || []).length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } },
              h('div', { style: { fontSize: '0.72rem', opacity: 0.6 } }, t('skills.onlyLocal')),
              h('div', { style: { ...S.row, gap: '0.3rem' } }, ...skills.onlyLocalReal.map(n => h('span', { key: n, style: S.chip }, n)))) : null,
            (skills.onlyLocalJunk || []).length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } },
              h('div', { style: { fontSize: '0.72rem', opacity: 0.45 } }, t('skills.junk')),
              h('div', { style: { ...S.row, gap: '0.3rem' } }, ...skills.onlyLocalJunk.map(n => h('span', { key: n, style: { ...S.chip, opacity: 0.5 } }, n)))) : null,
            (skills.onlyHub || []).length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } },
              h('div', { style: { fontSize: '0.72rem', opacity: 0.6 } }, t('skills.onlyHub')),
              h('div', { style: { ...S.row, gap: '0.3rem' } }, ...skills.onlyHub.map(n => h('span', { key: n, style: S.chip }, n)))) : null,
            (skills.diff || []).length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } },
              h('div', { style: { fontSize: '0.72rem', color: '#d29922' } }, t('skills.diff')),
              h('div', { style: { ...S.row, gap: '0.3rem' } }, ...skills.diff.map(n => h('span', { key: n, style: S.chip }, n)))) : null,
            (!(skills.onlyLocalReal || []).length && !(skills.onlyHub || []).length && !(skills.diff || []).length)
              ? h('p', { style: S.hint }, t('skills.none')) : null) : null,
          h(Result, { k: 'skTo' }), h(Result, { k: 'skFrom' })),

        // trash
        h(Card, { key: 'trash', title: t('sk.trashTitle') },
          h('div', { style: S.row }, h(Btn, { label: t('act.skTrashList'), kind: 'skTrashList', key: 'skTrashList' })),
          trashList ? (trashList.items.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.25rem' } },
                ...trashList.items.map(x => h('div', { key: x.name, style: S.listRow },
                  h('span', { style: { flex: 1, wordBreak: 'break-all' } }, x.name),
                  h('button', {
                    type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                    onClick: () => run('skRestore', 'skOp', { name: x.name }),
                  }, t('sk.restore')))))
            : h('p', { style: S.hint }, t('sk.trashEmpty'))) : null,
          h(Result, { k: 'skTrashList' })),
      ]

      // ── 插件页：已装清单 + npm 市场 + 安装/卸载 ───────────────────────────
      const pluginsTab = [
        h(Card, { key: 'inst', title: t('pl.title') },
          h('p', { style: S.hint }, t('pl.what')),
          h('div', { style: S.row },
            h(Btn, { label: t('act.plList'), kind: 'plRefresh', key: 'plRefresh', primary: true }),
            h(Btn, { label: t('act.pluginsInstall'), kind: 'pluginsInstall', key: 'plInst' })),
          h('p', { style: S.hint }, t('hint.restart')),
          plList && plList.profiles ? h(Fragment, {},
            ...plList.profiles.map(p => h('div', { key: p.profile, style: { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.3rem' } },
              h('div', { style: { fontSize: '0.74rem', fontWeight: 600, opacity: 0.85 } }, t('pl.profile', { name: p.profile, n: p.items.length })),
              ...p.items.map(it => h('div', { key: p.profile + it.name, style: S.listRow },
                h(Dot, { level: it.linkOk ? 'pass' : 'fail' }),
                h('span', { style: { flex: '1 1 14rem', wordBreak: 'break-all' } }, it.name),
                h('span', { style: { fontSize: '0.7rem', opacity: 0.7, minWidth: '4rem' } }, it.version || '-'),
                it.bundled ? h('span', { style: { ...S.chip, fontSize: '0.6rem' } }, t('pl.bundled')) : null,
                it.linkOk ? null : h('span', { style: { fontSize: '0.66rem', color: '#d1242f' } }, t('pl.broken')),
                h('button', {
                  type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                  onClick: () => run('plUninstall', 'plOp', { name: it.name, profile: p.profile }),
                }, t('pl.uninstall')))),
              p.orphanBundles.length ? h('div', { style: { fontSize: '0.66rem', opacity: 0.5 } },
                t('pl.builtin') + ': ' + p.orphanBundles.join(', ')) : null))) : h('p', { style: S.hint }, t('loading')),
          h(Result, { k: 'plRefresh' }), h(Result, { k: 'plOp' }), h(Result, { k: 'plInst' })),

        h(Card, { key: 'mkt', title: t('pl.marketTitle') },
          h('p', { style: S.hint }, t('pl.marketHint')),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('pl.searchPh'), value: plQuery, disabled: !!busy, style: { ...S.input, width: '16rem' }, onChange: e => setPlQuery(e.target.value) }),
            h(Btn, { label: t('act.plSearch'), kind: 'plSearch', key: 'plSearch', primary: true })),
          plMarket && plMarket.items ? (plMarket.items.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.25rem' } },
                h('p', { style: { ...S.hint, opacity: 0.6 } }, t('pl.found', { n: plMarket.total })),
                ...plMarket.items.map(it => h('div', { key: it.name, style: S.listRow },
                  h('span', { style: { flex: '1 1 14rem', wordBreak: 'break-all' } }, it.name),
                  h('span', { style: { fontSize: '0.7rem', opacity: 0.7, minWidth: '4rem' } }, it.version),
                  h('span', { style: { flex: '2 1 14rem', fontSize: '0.68rem', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.description),
                  h('button', {
                    type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                    onClick: () => run('plInstall', 'plInstallOut', { name: it.name, profile: 'desktop' }),
                  }, t('pl.install')))))
            : h('p', { style: S.hint }, t('pl.noResult'))) : null,
          h(Result, { k: 'plSearch' }), h(Result, { k: 'plInstallOut' })),
      ]

      const toolsTab = [
        h(Card, { key: 't', title: t('sec.tools'), level: tools.missingCore ? 'fail' : (tools.present < tools.total ? 'warn' : 'pass') },
          h('p', { style: { fontSize: '0.78rem', margin: 0 } },
            t('tools.summary', { p: tools.present, n: tools.total }) + '   ·   ' + (tools.missingCore ? t('tools.missingCore') : t('tools.allGood'))),
          h('div', { style: { ...S.row, gap: '0.3rem' } },
            ...(tools.tools || []).map(x => h('span', {
              key: x.Key,
              style: { ...S.chip, opacity: x.Present ? 1 : 0.45, borderColor: x.Present ? 'rgba(46,160,67,0.5)' : 'rgba(209,36,47,0.4)' },
              title: x.Note || '',
            }, (x.Present ? '✓ ' : '✗ ') + x.Key + (x.Need !== 'nice' ? ' · ' + t('tools.need.' + x.Need) : '')))),
          h('div', { style: S.row },
            h(Btn, { label: t('act.toolsRefresh'), kind: 'toolsRefresh', key: 'tlRefresh' }),
            h(Btn, { label: t('act.toolsInstall'), kind: 'toolsInstall', key: 'tlInst', primary: true }),
            h(Btn, { label: t('act.toolsInstallNice'), kind: 'toolsInstallNice', key: 'tlInstNice' })),
          h('p', { style: S.hint }, t('hint.tools')),
          h(Result, { k: 'tlInst' }), h(Result, { k: 'tlInstNice' })),
        // environment checks live here now: they are all "this machine" concerns
        h(Card, { key: 'e', title: t('sec.health') },
          h('div', { style: S.row },
            h(Btn, { label: t('act.doctor'), kind: 'doctor', key: 'doc' }),
            h(Btn, { label: t('act.doctorFix'), kind: 'doctorFix', key: 'docFix', primary: true }),
            h(Btn, { label: t('act.net'), kind: 'net', key: 'net' })),
          h(Result, { k: 'doc' }), h(Result, { k: 'docFix' }), h(Result, { k: 'net' })),
        h(Card, { key: 'l', title: t('sec.logs') },
          h('div', { style: S.row }, h(Btn, { label: t('act.logs'), kind: 'logs', key: 'logs' })),
          logs ? h(Fragment, {},
            h('p', { style: S.hint }, t('logs.newest', { name: logs.newest || '-' })),
            h('pre', { style: S.pre }, logs.tail || '')) : null,
          h(Result, { k: 'logs' })),
      ]

      const settingsTab = [
        h(Card, { key: 'c', title: t('sec.cred'), level: cred.hasCredential ? 'pass' : 'warn' },
          h('p', { style: { fontSize: '0.78rem', margin: 0 } },
            cred.hasCredential ? (t('cred.ok') + '  ·  ' + (cred.username || '') + '  ·  ' + (cred.repoHost || '')) : (t('cred.none') + '  ·  ' + t('cred.noneHint'))),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: 'Gitee 用户名', value: cUser, style: S.input, onChange: e => setCUser(e.target.value) }),
            h('input', { type: 'password', placeholder: t('cred.token'), value: cToken, style: S.input, onChange: e => setCToken(e.target.value) }),
            h(Btn, { label: t('act.saveCred'), kind: 'saveCred', key: 'credSave' })),
          h('p', { style: S.hint }, t('hint.cred')),
          h('p', { style: S.hint }, t('hint.token')),
          h(Result, { k: 'credSave' })),
        h(Card, { key: 'b', title: t('sec.bootstrap') },
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('boot.machine'), value: bMachine, style: S.input, onChange: e => setBMachine(e.target.value) }),
            h('input', { type: 'text', placeholder: t('boot.dest'), value: bDest, style: { ...S.input, width: '15rem' }, onChange: e => setBDest(e.target.value) })),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('boot.repo'), value: bRepo, style: { ...S.input, width: '20rem' }, onChange: e => setBRepo(e.target.value) }),
            h(Btn, { label: t('act.bootstrap'), kind: 'bootstrap', key: 'bootGo', primary: true })),
          !cred.hasCredential ? h('p', { style: { ...S.hint, color: '#d29922' } }, t('boot.needCred')) : null,
          h('p', { style: S.hint }, t('hint.bootstrap')),
          h(Result, { k: 'bootGo' })),
      ]

      const body = tab === 'overview' ? overviewTab
        : tab === 'sync' ? syncTab
        : tab === 'backup' ? backupTab
        : tab === 'skills' ? skillsTab
        : tab === 'plugins' ? pluginsTab
        : tab === 'tools' ? toolsTab
        : settingsTab

      if (err) {
        return shell(h(Card, { title: t('error', { e: err }), level: 'fail' },
          h('div', { style: S.row }, h(Btn, { label: t('retry'), kind: 'refresh', key: 'retry' }))))
      }

      return shell(...body)
    }

    function localeTag(ctx) {
      try {
        const snap = typeof ctx.locale?.getLocale === 'function' ? ctx.locale.getLocale() : ctx.locale?.getSnapshot?.()
        const v = snap?.active ?? ctx.locale?.locale
        return typeof v === 'string' && v.startsWith('en') ? 'en' : 'zh'
      } catch { return 'zh' }
    }

    function apply(ctx) {
      const t0 = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'dsh-sync-hub: dictionaries')
      // Resolve dotted keys ('tab.sync', 'tools.need.core') against OUR dict
      // directly: ctx.locale.bind only resolves flat keys, so a nested lookup
      // would render the raw key ("tab.sync") into the UI.
      const tr = (key, args) => {
        const tag = localeTag(ctx)
        const table = DICT[tag] || DICT.zh
        let value
        if (typeof key === 'string' && key.includes('.')) {
          value = key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), table)
        }
        if (value === undefined) value = table[key]
        if (value === undefined) {
          // fall back to the host binding (covers anything we did not inline)
          try { value = t0(key) } catch { value = key }
        }
        return fill(typeof value === 'string' ? value : key, args)
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'sync-hub', order: 36,
        label: () => tr('nav'), locale: NS,
      }, props => h(SyncHubPage, { ...props, t: tr })))
    }

    function fill(text, args) {
      if (typeof text !== 'string' || !args) return text
      let s = text
      for (const [k, v] of Object.entries(args)) s = s.split('{' + k + '}').join(String(v))
      return s
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'sync-hub'
    // MUST be module.exports (object with apply), never `module` itself.
    return module.exports
  },
})
