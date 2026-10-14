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
    const { createElement: h, Fragment, useState, useEffect, useCallback, useMemo, useRef } = React

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
        tab: { overview: '概览', sync: '同步', files: '云端文件', backup: '备份', skills: '技能', plugins: '插件', tools: '工具链', settings: '设置' },

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
        'act.delete': '删除',
        'act.deleteConfirm': '确认删除',
        'act.cancel': '取消',
        'act.restoreLatest': '恢复最新记忆',
        'ov.guide': '本页是中枢总览：先看「是否干净 / 凭据 / 工具链」，确认无误再去「同步」页上传或拉取。所有改动在重启 DSH 后完整生效。',
        'act.sessionsBackup': '备份会话',
        'act.sessionsList': '会话列表',
        'act.skillsToHub': '收集新技能',
        'act.skillsFromHub': '安装中枢技能',
        'act.toolsRefresh': '重新检测',
        'act.toolsInstall': '补齐必需',
        'act.toolsInstallNice': '补齐全部',
        'act.logs': '查看日志',
        'act.bootstrap': '一键接入',
        'act.saveCred': '保存并测试',

        'sec.health': '环境维护',
        'sec.backup': '记忆备份',
        'sec.schedule': '定时同步',
        'sec.sessions': '会话备份',
        'sec.skills': '技能',
        'sec.plugins': '插件',
        'sec.tools': 'AI 工具链',
        'sec.cred': 'Gitee 凭据',
        'sec.logs': '运行日志',
        'sec.bootstrap': '新机器接入',
        'hint.pull': '拉取会应用到 DSH，重启后生效；冲突会停下并报告。',
        'hint.pullEta': '拉取通常需 1–3 分钟（首次或差异大时更久），按钮转圈即正在工作，请勿关闭页面。',
        'sync.whatTitle': '这个页面 = 云端（两台电脑交换）',
        'sync.what': '把本机的记忆/技能/配置通过 Gitee 与另一台电脑交换。上传 = 本机改动送到云端；拉取 = 把云端的改动拿到本机并生效。',
        'sync.upTitle': '① 上传到云端',
        'sync.upHint': '选上传范围后点上传。日常用「全部」即可。',
        'sync.downTitle': '② 从云端拉取',
        'sync.downHint': '把另一台电脑的改动拿下来，并应用到本机 DSH。',
        'sync.stateTitle': '当前状态',
        'cat.memory': '记忆',
        'cat.skills': '技能',
        'cat.config': '配置',
        'cat.plugins': '插件清单',
        'cat.sessions': '会话备份',
        'cat.dshconfig': 'DSH 运行配置',
        'cat.pluginsrc': '插件源码',
        'cat.all': '全选',
        'cat.none': '全不选',
        'sync.noneScope': '（未选任何范围 —— 不会推送）',
        'sync.pickCat': '选择分类',
        'sync.pickSkills': '选择技能（默认全部）',
        'sync.pickSessions': '选择会话工作区（默认全部）',
        'sync.selAll': '全选',
        'sync.selClear': '清空',
        'sync.pickCount': '已选 {n} / {total}',
        'sync.dshHintPush': '上传时会采集本机 DSH 运行配置（profile 的 package.json / cordis.patch.yml + gitconfig）一并备份',
        'sync.dshHintPull': '拉取时会把中枢采集的运行配置写回本机（需同机身份三重校验通过）',
        'sync.advanced': '高级选项',
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
        'hint.bootstrapEta': '接入流程通常约 25 分钟（克隆+应用+安装插件），期间按钮会持续转圈，请勿关闭页面。',

        'tools.summary': '{p}/{n} 已安装',
        'tools.missingCore': '缺少必需工具',
        'tools.allGood': '全部就位',
        'tools.need': { core: '必需', dev: '开发', nice: '可选' },

        'schedule.what': '在 Windows 任务计划程序里建一个无人值守任务：每天 03:00 + 开机触发，自动跑「状态→拉取→推送」。日志写入 ~/.dsh/logs/schedule-日期.log。',
        'schedule.on': '已开启',
        'schedule.off': '未开启',
        'schedule.next': '下次运行：{t}',
        'schedule.done': '已刷新定时任务状态',
        'act.scheduleInstall': '开启定时同步',
        'act.scheduleRemove': '关闭定时同步',
        'act.scheduleStatus': '查看状态',

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
        'sk.needBoth': '技能名和 description 都要填',
        'sk.needUrl': '请先填网址',
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
        'sk.hubDelete': '从云端移除',
        'sk.hubEdit': '编辑正文',
        'sk.hubDeleteConfirm': '确认从云端（Gitee 中枢）删除技能「{name}」？此操作会提交并推送，另一台机器下次拉取后将同样删除。',
        'sk.hubDeleteWarn': '说明：仅删除云端仓库中的该技能目录，git 历史仍保留可回溯；本机其他目录的副本不受影响，不会硬清。',
        'sk.hubDeleteConfirmBtn': '确认从云端删除',
        'sk.hubUpload': '上传到云端',
        'sk.hubUploadConfirm': '确认把本机技能「{name}」上传到云端（Gitee 中枢）？此操作会提交并推送，另一台机器下次拉取后将获得该技能。',
        'sk.hubUploadWarn': '说明：仅上传该技能目录；若云端已存在同名技能会被拒绝（不覆盖）。git 历史完整保留。',
        'sk.hubUploadConfirmBtn': '确认上传到云端',
        'sk.hubSkip': '占位/停用项，不上传',
        'hub.title': '云端文件（记忆 · 配置 · 技能正文）',
        'hub.hint': '左侧列表是中枢里可查看/可编辑的文本（白名单）。点一个文件在右侧打开编辑。保存 = 写入中枢工作区并本地提交，不会自动推送；另一台机器要等你点「上传备份/推送」后才会收到。',
        'hub.grpMemory': '共享记忆',
        'hub.grpMachine': '机器档案',
        'hub.grpConfig': '配置',
        'hub.grpSkill': '技能正文（SKILL.md）',
        'hub.ph': '在此编辑文件内容…',
        'hub.pick': '从左侧选一个文件开始。',
        'hub.noFiles': '（还没有列表，点上方「刷新列表」）',
        'hub.unsaved': '有未保存的修改。',
        'hub.changed': '共 {n} 行 · 已保存：{dirty}',
        'hub.dirtyYes': '是',
        'hub.dirtyNo': '否',
        'hub.searchPh': '搜索文件名 / 技能名…',
        'hub.onlyDirty': '只显示有改动（{n}）',
        'hub.dirtyTag': '已改动',
        'hub.closeTab': '关闭此标签',
        'hub.summary': '已载入 {total} 个文件 · 本地改动 {dirty} 个',
        'hub.hintShort': '点左侧文件在右侧打开 · 可同时开多个标签',
        'hub.safety': '安全说明：仅白名单内文件可编辑；JSON 会先校验语法；保存前旧版本自动归档到 backups-archive/；若另一台机器改过同一文件，保存会被拒绝并要求先拉取。',
        'hub.loaded': '已载入 {n} 个文件',
        'hub.opened': '已打开：{path}',
        'hub.reloaded': '已重新载入磁盘内容（放弃未保存修改）',
        'hub.needPick': '请先在左侧选一个文件',
        'hub.noChange': '内容无变化，未保存',
        'hub.saveConfirm': '确认保存对「{path}」的修改？\n将写入中枢工作区并本地提交（不自动推送），旧版本会归档。',
        'hub.saveCancelled': '已取消保存',
        'act.hubRefresh': '刷新列表',
        'act.hubSave': '保存',
        'act.hubReload': '放弃并重载',
        'sync.presetTitle': '同步预设',
        'sync.presetHint': '日常一键同步用哪几类。改完只存本机（localStorage），不会同步给另一台。',
        'sync.presetSaved': '预设已保存。',
        'sync.presetMemory': '📝 只推记忆',
        'sync.presetLight': '🎯 记忆+配置+插件源码',
        'sync.presetSkills': '🧩 只推技能',
        'sync.presetFull': '📦 全量（含会话备份）',
        'ov.stateDirty': '{n} 个改动未提交',
        'ov.stateAhead': '{n} 个提交待推送',
        'ov.stateBehind': '远端领先 {n} 个提交（建议先拉取）',
        'ov.stateDirtyWhy': '未提交的文件：',
        'ov.stateHint': '这些改动还没进 git，所以另一台机器收不到。点「一键同步」即可提交并推送。',
        'ov.stateIdle': '工作区干净，与远端一致。',
        'act.syncNow': '一键同步',
        'act.syncPreview': '预演将推送什么',
        'act.pullNow': '从云端拉取',
        'pf.title': '同步前自检',
        'pf.scope': '推送范围',
        'pf.size': '体积',
        'pf.sessions': '会话备份',
        'pf.behind': '远端状态',
        'pf.cred': 'Gitee 凭据',
        'pf.dirty': '范围外改动',
        'pf.done': '自检完成。',
        'pf.summary': '本次将推送 {n} 个文件，共 {size}。',
        'act.preflight': '同步前自检',
        'sess.title': '历史对话浏览（只读）',
        'sess.hint': '换机前想知道「另一台电脑聊过什么」，在这里看。按机器 → 工作区 → 会话逐层展开；点「查看」读对话摘要。全程只读，绝不改回去。',
        'sess.open': '查看',
        'sess.empty': '（这台机器没有会话备份，或还没拉取。先在「从云端拉取」里勾上会话备份）',
        'sess.viewing': '会话：{title}',
        'act.sessBrowse': '列出历史对话',
        'sync.nowNothing': '所选范围内没有可推送的改动。',
        'sync.nowConfirm': '确认同步以下 {n} 个文件（{size}）？\n范围：{cats}\n将提交并推送到 Gitee，另一台机器拉取后生效。',
        'sync.nowCancelled': '已取消同步。',
        'sync.nowRetry': '预演失败，请重试或去「同步」tab 手动推送。',
        'cancel': '取消',
        'act.skRefresh': '刷新列表',
        'act.skImport': '导入',
        'act.skCreate': '新建',
        'act.skDiff': '对比中枢',
        'act.skTrashList': '查看回收站',

        // ── 插件页 ──────────────────────────────────────────────────────────
        'pl.title': '已安装插件',
        'pl.portTitle': '换机补齐（自研插件）',
        'pl.portHint': '插件同步只带「清单」：pull 之后本机不会自动重新 clone。「换机补齐」按中枢 config/plugin.txt 现场拉源码 + 写 link + 重装依赖。npm 插件的安装走下方市场/已装列表，不受这里影响。',
        'pl.portSpec': '中枢指定：{name}  tag = {tag}',
        'pl.portCloned': '源码已 clone',
        'pl.portLinked': 'profile 已链接',
        'pl.portNeedFix': '状态不一致：pull 拿到的清单和本机实际状态对不上，点「换机补齐」补齐。',
        'pl.portOk': '本机与中枢一致，无需补齐。',
        'pl.portUnchecked': '点上面的「检查状态」读取中枢 config/plugin.txt 与本机克隆/链接状态。',
        'pl.what': '查看各 profile 已装的插件、链接健康状态，可卸载；市场页可从 npm 搜索并安装新插件。',
        'pl.guide': '安装 / 更新 / 卸载插件后，必须重启 DSH 才能完整加载；本页操作结果里会标黄提示。',
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
        'pl.hasUpdate': '{n} 个插件有新版本',
        'pl.allLatest': '全部已是最新',
        'pl.newVer': '→ {v}',
        'pl.update': '更新',
        'pl.featTitle': '推荐插件',
        'pl.featHint': '精选常用插件，点「安装」即可（已装的会标记）。',
        'pl.installed': '已安装',
        'act.plCheck': '检查更新',
        'act.plSpec': '检查状态',
        'act.plPortable': '换机补齐',
        'act.plUpdateAll': '全部更新',
        'act.plList': '刷新已装',
        'act.plSearch': '搜索市场',
        'pl.profileSel': '目标 profile：',

        'done.refresh': '已刷新',

        'check.pass': '通过',
        'check.warn': '注意',
        'check.fail': '失败',
        'logs.newest': '最新日志：{name}',
        'logs.pick': '选择日志',
        'logs.dir': '目录：{dir}',
        'logs.files': '共 {n} 个日志文件',
        'sync.conflictTitle': '拉取冲突（需手动处理）',
        'sync.conflictHint': '检测到合并冲突，以下文件被 git 标记。sync-hub 不会自动解决。请逐个编辑保留正确内容，再按《使用手册.md》FAQ-5 执行（git add <文件> && git rebase --continue），或点右侧按钮打开控制台处理。',
        'sync.openManual': '查看使用手册',
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
        tab: { overview: 'Overview', sync: 'Sync', files: 'Cloud files', backup: 'Backup', skills: 'Skills', plugins: 'Plugins', tools: 'Toolchain', settings: 'Settings' },

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
        'act.delete': 'Delete',
        'act.deleteConfirm': 'Confirm delete',
        'act.cancel': 'Cancel',
        'act.restoreLatest': 'Restore newest memory',
        'ov.guide': '本页是中枢总览：先看「是否干净 / 凭据 / 工具链」，确认无误再去「同步」页上传或拉取。所有改动在重启 DSH 后完整生效。',
        'act.sessionsBackup': 'Backup sessions',
        'act.sessionsList': 'Session list',
        'act.skillsToHub': 'Collect new skills',
        'act.skillsFromHub': 'Install hub skills',
        'act.toolsRefresh': 'Re-detect',
        'act.toolsInstall': 'Install required',
        'act.toolsInstallNice': 'Install all',
        'act.logs': 'View logs',
        'act.bootstrap': 'Bootstrap',
        'act.saveCred': 'Save & test',

        'sec.health': 'Environment',
        'sec.backup': 'Memory backups',
        'sec.sessions': 'Session backups',
        'sec.skills': 'Skills',
        'sec.plugins': 'Plugins',
        'sec.tools': 'AI toolchain',
        'sec.cred': 'Gitee credential',
        'sec.logs': 'Runtime logs',
        'sec.bootstrap': 'New machine',
        'sec.schedule': 'Timed sync',

        'hint.pull': 'Pull applies to DSH (restart to take effect); conflicts stop and report.',
        'hint.pullEta': 'Pull usually takes 1–3 min (longer on first run or big diffs). The spinning button means it is working — keep this page open.',
        'sync.whatTitle': 'This tab = CLOUD (swap between two PCs)',
        'sync.what': 'Exchanges memory/skills/config with the other computer through Gitee. Upload sends this machine\'s changes to the cloud; Pull brings the cloud\'s changes here and applies them.',
        'sync.upTitle': '1) Upload to cloud',
        'sync.upHint': 'Pick a scope, then upload. "All" is fine for daily use.',
        'sync.downTitle': '2) Pull from cloud',
        'sync.downHint': 'Fetch the other computer\'s changes and apply them to this DSH.',
        'sync.stateTitle': 'Current state',
        'cat.memory': 'Memory',
        'cat.skills': 'Skills',
        'cat.config': 'Config',
        'cat.plugins': 'Plugin manifest',
        'cat.sessions': 'Session backups',
        'cat.dshconfig': 'DSH runtime config',
        'cat.pluginsrc': 'Plugin source',
        'cat.all': 'Select all',
        'cat.none': 'Select none',
        'sync.noneScope': '(no scope selected — nothing will be pushed)',
        'sync.pickCat': 'Pick categories',
        'sync.pickSkills': 'Pick skills (all by default)',
        'sync.pickSessions': 'Pick session workspaces (all by default)',
        'sync.selAll': 'All',
        'sync.selClear': 'Clear',
        'sync.dshHintPush': 'Upload will also capture this machine\'s DSH runtime config (profile package.json / cordis.patch.yml + gitconfig) into the backup',
        'sync.dshHintPull': 'Pull will write the hub-captured runtime config back to this machine (requires same-machine triple verification)',
        'sync.advanced': 'Advanced options',
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
        'hint.bootstrapEta': 'Bootstrap usually takes ~25 min (clone + apply + install plugins); the button keeps spinning — keep this page open.',

        'tools.summary': '{p}/{n} installed',
        'tools.missingCore': 'required tools missing',
        'tools.allGood': 'all present',
        'tools.need': { core: 'required', dev: 'dev', nice: 'optional' },

        'schedule.what': 'Create a Windows Task Scheduler job: daily 03:00 + at logon, running status->pull->push unattended. Logs go to ~/.dsh/logs/schedule-<date>.log.',
        'schedule.on': 'Enabled',
        'schedule.off': 'Not enabled',
        'schedule.next': 'Next run: {t}',
        'schedule.done': 'Schedule status refreshed',
        'act.scheduleInstall': 'Enable timed sync',
        'act.scheduleRemove': 'Disable timed sync',
        'act.scheduleStatus': 'Status',

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
        'sk.needBoth': 'name and description are both required',
        'sk.needUrl': 'paste a URL first',
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
        'sk.hubDelete': 'Remove from hub',
        'sk.hubEdit': 'Edit text',
        'sk.hubDeleteConfirm': 'Remove skill "{name}" from the cloud (Gitee hub)? This commits and pushes; the other machine will delete it on next pull.',
        'sk.hubDeleteWarn': 'Note: only the skill folder in the hub repo is removed; git history is kept for recovery; local copies on this machine are untouched and not hard-deleted.',
        'sk.hubDeleteConfirmBtn': 'Confirm cloud delete',
        'sk.hubUpload': 'Upload to hub',
        'sk.hubUploadConfirm': 'Upload local skill "{name}" to the cloud (Gitee hub)? This commits and pushes; the other machine gets it on next pull.',
        'sk.hubUploadWarn': 'Note: only that skill folder is uploaded; an existing hub skill with the same name is refused (no overwrite). Git history is fully kept.',
        'sk.hubUploadConfirmBtn': 'Confirm upload to hub',
        'sk.hubSkip': 'placeholder/disabled, skipped',
        'hub.title': 'Cloud files (memory · config · skill text)',
        'hub.hint': 'The left list is the whitelist of hub text files you can view/edit. Click one to open it on the right. Save writes into the hub working tree and commits locally — it never pushes; the other machine only sees it after you run the upload/push button.',
        'hub.grpMemory': 'Shared memory',
        'hub.grpMachine': 'Machine files',
        'hub.grpConfig': 'Config',
        'hub.grpSkill': 'Skill text (SKILL.md)',
        'hub.ph': 'Edit the file content here…',
        'hub.pick': 'Pick a file on the left to start.',
        'hub.noFiles': '(no list yet — click Refresh list)',
        'hub.unsaved': 'You have unsaved changes.',
        'hub.changed': '{n} lines · saved: {dirty}',
        'hub.dirtyYes': 'yes',
        'hub.dirtyNo': 'no',
        'hub.searchPh': 'Search file / skill name…',
        'hub.onlyDirty': 'Only dirty ({n})',
        'hub.dirtyTag': 'modified',
        'hub.closeTab': 'Close this tab',
        'hub.summary': 'Loaded {total} files · {dirty} modified locally',
        'hub.hintShort': 'Click a file on the left to open it · multiple tabs supported',
        'hub.safety': 'Safety: only whitelisted files are editable; JSON is syntax-checked before save; the previous version is archived to backups-archive/; if the other machine changed the same file, the save is refused and you must pull first.',
        'hub.loaded': 'Loaded {n} files',
        'hub.opened': 'Opened: {path}',
        'hub.reloaded': 'Reloaded from disk (unsaved edits discarded)',
        'hub.needPick': 'Pick a file on the left first',
        'hub.noChange': 'No changes to save',
        'hub.saveConfirm': 'Save your edits to "{path}"?\nThis writes into the hub working tree and commits locally (no auto-push); the previous version is archived.',
        'hub.saveCancelled': 'Save cancelled',
        'act.hubRefresh': 'Refresh list',
        'act.hubSave': 'Save',
        'act.hubReload': 'Discard & reload',
        'sync.presetTitle': 'Sync presets',
        'sync.presetHint': 'Which categories one-tap sync uses. Saved on this machine only (localStorage), not synced.',
        'sync.presetSaved': 'Preset saved.',
        'sync.presetMemory': '📝 Memory only',
        'sync.presetLight': '🎯 Memory + config + plugin source',
        'sync.presetSkills': '🧩 Skills only',
        'sync.presetFull': '📦 Full (incl. session backups)',
        'ov.stateDirty': '{n} uncommitted change(s)',
        'ov.stateAhead': '{n} commit(s) to push',
        'ov.stateBehind': 'remote is ahead by {n} (pull first)',
        'ov.stateDirtyWhy': 'Uncommitted files: ',
        'ov.stateHint': 'These edits are not in git yet, so the other machine cannot see them. Click One-tap sync to commit and push.',
        'ov.stateIdle': 'Working tree clean and in sync with the remote.',
        'act.syncNow': 'One-tap sync',
        'act.syncPreview': 'Preview push',
        'act.pullNow': 'Pull from cloud',
        'pf.title': 'Pre-sync check',
        'pf.scope': 'Push scope',
        'pf.size': 'Size',
        'pf.sessions': 'Session backups',
        'pf.behind': 'Remote state',
        'pf.cred': 'Gitee credential',
        'pf.dirty': 'Out-of-scope edits',
        'pf.done': 'Self-check done.',
        'pf.summary': 'Will push {n} file(s), {size} total.',
        'act.preflight': 'Pre-sync check',
        'sess.title': 'Browse past conversations (read-only)',
        'sess.hint': 'Before switching machines, see what the other PC talked about. Expand machine -> workspace -> session; click Open to read the digest. Strictly read-only.',
        'sess.open': 'Open',
        'sess.empty': '(no session backups for this machine yet, or not pulled. Enable session backups in Pull from cloud first)',
        'sess.viewing': 'Session: {title}',
        'act.sessBrowse': 'List past conversations',
        'sync.nowNothing': 'Nothing to push in the selected scopes.',
        'sync.nowConfirm': 'Sync these {n} file(s) ({size})?\nScope: {cats}\nIt commits and pushes to Gitee; the other machine gets it on next pull.',
        'sync.nowCancelled': 'Sync cancelled.',
        'sync.nowRetry': 'Preview failed - retry or use the Sync tab manually.',
        'cancel': 'Cancel',
        'act.skRefresh': 'Refresh list',
        'act.skImport': 'Import',
        'act.skCreate': 'Create',
        'act.skDiff': 'Diff with hub',
        'act.skTrashList': 'View trash',

        // ── plugins tab ─────────────────────────────────────────────────────
        'pl.title': 'Installed plugins',
        'pl.portTitle': 'Bring this machine in line (bundled plugin)',
        'pl.portHint': 'Plugin sync carries the MANIFEST only: after a pull this machine does not re-clone. "Bring in line" clones from the hub config/plugin.txt + writes the link + reinstalls deps. npm plugins install via the market / installed list below.',
        'pl.portSpec': 'Hub spec: {name}  tag = {tag}',
        'pl.portCloned': 'source cloned',
        'pl.portLinked': 'profile linked',
        'pl.portNeedFix': 'Out of sync: the pulled manifest and this machine differ. Click "Bring in line".',
        'pl.portOk': 'This machine already matches the hub.',
        'pl.portUnchecked': 'Click "Check state" to read the hub config/plugin.txt plus this machine\'s clone/link state.',
        'pl.what': 'Installed plugins per profile with link health; uninstall here. The market searches npm and installs new ones.',
        'pl.guide': 'Install/update/uninstall takes effect only after a DSH restart; results here flag it in amber.',
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
        'pl.hasUpdate': '{n} plugin(s) have updates',
        'pl.allLatest': 'all up to date',
        'pl.newVer': '→ {v}',
        'pl.update': 'Update',
        'pl.featTitle': 'Recommended',
        'pl.featHint': 'Hand-picked plugins; click Install (already-installed ones are marked).',
        'pl.installed': 'installed',
        'act.plCheck': 'Check updates',
        'act.plSpec': 'Check state',
        'act.plPortable': 'Bring in line',
        'act.plUpdateAll': 'Update all',
        'act.plList': 'Refresh installed',
        'act.plSearch': 'Search market',
        'pl.profileSel': 'Target profile:',

        'done.refresh': 'refreshed',

        'check.pass': 'pass',
        'check.warn': 'warn',
        'check.fail': 'fail',
        'logs.newest': 'newest log: {name}',
        'logs.pick': 'choose log',
        'logs.dir': 'directory: {dir}',
        'logs.files': '{n} log files',
        'sync.conflictTitle': 'pull conflict (needs manual fix)',
        'sync.conflictHint': 'A merge conflict was detected; the files below are marked by git. sync-hub will NOT auto-resolve. Edit each file to keep the correct content, then follow 使用手册.md FAQ-5 (`git add <file> && git rebase --continue`), or open the console to handle it.',
        'sync.openManual': 'view usage manual',
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
      select: { padding: '0.32rem 0.55rem', borderRadius: '0.45rem', fontSize: '0.76rem', border: '1px solid var(--color-border, rgba(128,128,128,0.3))', background: 'var(--color-surface, rgba(128,128,128,0.05))', color: 'inherit' },
      hint: { fontSize: '0.7rem', opacity: 0.55, margin: 0, lineHeight: 1.5 },
      kv: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.3rem 0.75rem', fontSize: '0.78rem', alignItems: 'baseline' },
      kvKey: { opacity: 0.6, whiteSpace: 'nowrap' },
      chip: { fontSize: '0.68rem', padding: '0.12rem 0.45rem', borderRadius: '0.65rem', border: '1px solid var(--color-border, rgba(128,128,128,0.28))', whiteSpace: 'nowrap' },
      listRow: { display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.76rem', padding: '0.3rem 0.45rem', borderRadius: '0.4rem', background: 'var(--color-surface, rgba(128,128,128,0.05))' },
      pre: { margin: 0, padding: '0.55rem', borderRadius: '0.45rem', fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '16rem', overflow: 'auto', background: 'var(--color-surface, rgba(128,128,128,0.07))', border: '1px solid var(--color-border, rgba(128,128,128,0.2))', fontFamily: 'ui-monospace, Consolas, monospace' },
      miniBtn: { padding: '0.18rem 0.55rem', borderRadius: '0.4rem', fontSize: '0.7rem', border: '1px solid var(--color-border, rgba(128,128,128,0.3))', background: 'var(--color-surface, rgba(128,128,128,0.07))', color: 'inherit', cursor: 'pointer' },
    }

    const TABS = ['overview', 'sync', 'files', 'backup', 'skills', 'plugins', 'tools', 'settings']

    // ── 同步预设（自定义的核心）──────────────────────────────────────────
    // 内置四组默认；可改默认组合并存 localStorage（多机器各自持有，不入 git）。
    const SYNC_PRESETS = [
      { id: 'memory', cats: ['memory'] },
      { id: 'light', cats: ['memory', 'config', 'pluginsrc'] },
      { id: 'skills', cats: ['skills'] },
      { id: 'full', cats: ['memory', 'skills', 'config', 'pluginsrc', 'dshconfig', 'sessions'] },
    ]
    const PRESET_KEY = 'dsh-sync-hub.presets.v1'
    const loadPresets = () => {
      try {
        const raw = window.localStorage.getItem(PRESET_KEY)
        if (!raw) return null
        const j = JSON.parse(raw)
        if (j && typeof j === 'object' && j.default) return j
      } catch { /* ignore */ }
      return null
    }

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
      const [logsPick, setLogsPick] = useState('')
      const [manual, setManual] = useState(undefined)
      const [syncConflict, setSyncConflict] = useState([])
      const [cUser, setCUser] = useState('')
      const [cToken, setCToken] = useState('')
      const [bMachine, setBMachine] = useState('')
      const [bDest, setBDest] = useState('')
      const [bRepo, setBRepo] = useState('')
      // backup row pending delete confirmation (second-confirm guard)
      const [shDelName, setShDelName] = useState('')
      // timed sync schedule status from /schedule
      const [sched, setSched] = useState(undefined)
      // sync options: six categories + skill/session multi-select + dshconfig toggles
      // pluginsrc = 插件自身源码（plugins/ 下），与 plugins（仅 config/plugin.txt 清单）不同。
      // 少了它，"改了插件但上传无效"——这正是老大遇到过的坑。
      const ALL_CATS = ['memory', 'skills', 'config', 'plugins', 'pluginsrc', 'sessions', 'dshconfig']
      // 每类实际推什么路径：勾选前说得清，避免误把"插件"当成同步插件源码
      const CAT_HINT = {
        memory: 'memory/ 全部记忆（shared.md + 各机器档案）',
        skills: 'skills/ + skill-categories.json + recommended-skills.md',
        config: 'config/ 全部配置（含 session-map.json、plugins.md、plugin.txt）',
        plugins: '仅 config/plugin.txt（插件安装清单，不含源码）',
        pluginsrc: 'plugins/（同步中枢插件自身的 index.js / client.js）',
        sessions: 'session-backup/ 两台机器的历史对话备份',
        dshconfig: 'config/dshconfig/ 本机 DSH 运行配置快照',
      }
      const [pushCats, setPushCats] = useState([...ALL_CATS])
      const [pullCats, setPullCats] = useState([...ALL_CATS])
      // 默认同步预设：一键同步用；可改可存（localStorage，各机器独立）
      const [presetId, setPresetId] = useState(() => {
        const saved = loadPresets()
        return (saved && saved.default) || 'light'
      })
      // 当前生效的预设类目（供一键同步/预演/拉取共用）
      const syncPresetCats = () => {
        const saved = loadPresets()
        if (saved && Array.isArray(saved.overrides) && saved.overrides[presetId]) return saved.overrides[presetId]
        const p = SYNC_PRESETS.find((x) => x.id === presetId)
        return p ? [...p.cats] : [...ALL_CATS]
      }
      const [pushSkills, setPushSkills] = useState([])       // selected skill names (empty = all)
      const [pullSkills, setPullSkills] = useState([])
      const [pushSessions, setPushSessions] = useState([])   // selected workspace names (empty = all)
      const [pullSessions, setPullSessions] = useState([])
      const [pushDshConfig, setPushDshConfig] = useState(false)
      const [pullDshConfigWB, setPullDshConfigWB] = useState(false)
      const [pullSkipProfile, setPullSkipProfile] = useState(false)
      const [pullForce, setPullForce] = useState(false)
      // multi-select option sources
      const [skillList, setSkillList] = useState(undefined)  // from /skills/list
      const [sessionList, setSessionList] = useState(undefined) // from /sessions/list
      const [sessBrowse, setSessBrowse] = useState(undefined)   // 会话浏览结果（按机器分组）
      const [sessOpen, setSessOpen] = useState(undefined)       // 单条会话已展开内容
      const [sessMachine, setSessMachine] = useState('')        // 当前选中的机器筛选
      const [machineId, setMachineId] = useState('')
      // skills page
      const [skList, setSkList] = useState(undefined)
      const [skFilter, setSkFilter] = useState('')
      const [skUrl, setSkUrl] = useState('')
      const [skName, setSkName] = useState('')
      const [skNewName, setSkNewName] = useState('')
      const [skNewDesc, setSkNewDesc] = useState('')
      const [trashList, setTrashList] = useState(undefined)
      const [hubDeleteName, setHubDeleteName] = useState('')  // 待二次确认的"从云端移除"技能名
      const [hubUploadName, setHubUploadName] = useState('')  // 待二次确认的"上传到云端"技能名
      // plugins page
      const [plList, setPlList] = useState(undefined)
      const [plMarket, setPlMarket] = useState(undefined)
      const [plQuery, setPlQuery] = useState('')
      const [outdated, setOutdated] = useState(undefined)
      const [plSpec, setPlSpec] = useState(undefined)
      // hub files tab (cloud viewer/editor): 多 Tab 编辑 + 搜索 + 分组筛选
      const [hubFilesList, setHubFilesList] = useState(undefined)
      // 多 Tab：每个元素 { path, text, baseline }；active = 当前编辑的 path
      const [hubTabs, setHubTabs] = useState([])
      const [hubActive, setHubActive] = useState('')
      const [hubQuery, setHubQuery] = useState('')
      const [hubOnlyDirty, setHubOnlyDirty] = useState(false)
      // searchRef 用于聚焦搜索框（可选）
      const hubSearchRef = useRef(null)
      const hubTextOf = (p) => { const t = hubTabs.find((x) => x.path === p); return t ? t.text : '' }
      const hubBaselineOf = (p) => { const t = hubTabs.find((x) => x.path === p); return t ? t.baseline : '' }
      const hubDirtyTab = (p) => hubTextOf(p) !== hubBaselineOf(p)
      const openHubFile = (path, text) => {
        setHubTabs((prev) => {
          if (prev.some((x) => x.path === path)) return prev
          return [...prev, { path, text: text || '', baseline: text || '' }]
        })
        setHubActive(path)
      }
      const setHubTabText = (path, text) => setHubTabs((prev) => prev.map((x) => x.path === path ? { ...x, text } : x))
      const closeHubTab = (path) => setHubTabs((prev) => {
        const next = prev.filter((x) => x.path !== path)
        if (hubActive === path) setHubActive(next.length ? next[next.length - 1].path : '')
        return next
      })
      const [preflight, setPreflight] = useState(undefined)
      const [featured, setFeatured] = useState(undefined)
      // selected target profile for install/update/uninstall (defaults from first listed profile)
      const [plProfile, setPlProfile] = useState('desktop')
      const [plLoaded, setPlLoaded] = useState(false)
      const plAutoRef = useRef(false)
      const hubAutoRef = useRef(false)

      const put = useCallback((k, v) => setOut(p => ({ ...p, [k]: v })), [])

      const loadOverview = useCallback(() => {
        setErr('')
        return api('/overview', { timeout: 120000 })
          .then(setOv)
          .catch(e => setErr(String(e?.message ?? e)))
      }, [])

      useEffect(() => { loadOverview() }, [loadOverview])

      // load the multi-select sources (skills / sessions / machine id) once
      useEffect(() => {
        Promise.all([
          api('/skills/list', { timeout: 60000 }).then(setSkillList).catch(() => {}),
          api('/sessions/list', { timeout: 60000 }).then(d => { setSessionList(d && d.items ? d.items : []); if (d && d.machineId) setMachineId(d.machineId) }).catch(() => {}),
        ])
      }, [])

      // auto-populate the plugins tab on first open (fixes empty "recommended" on entry)
      useEffect(() => {
        if (tab !== 'plugins' || plAutoRef.current) return
        plAutoRef.current = true
        setPlLoaded(true)
        run('plRefresh', 'plRefresh')
        run('plCheck', 'plCheck')
      }, [tab])

      // auto-load the hub file list on first open of the 云端文件 tab
      useEffect(() => {
        if (tab !== 'files' || hubAutoRef.current) return
        hubAutoRef.current = true
        run('hubRefresh', 'hubList')
      }, [tab])

      // keep the profile selector valid once the installed list arrives
      useEffect(() => {
        if (plList && plList.profiles && plList.profiles.length) {
          const names = plList.profiles.map(p => p.profile)
          if (!names.includes(plProfile)) setPlProfile(names[0])
        }
      }, [plList, plProfile])

      // Every kind MUST have a branch here (missing branch = dead button).
      // `arg` carries per-row payloads (skill name/rootId, plugin name/profile).
      const run = useCallback(async (kind, key, arg) => {
        setBusy(kind)
        put(key, '')
        const a = arg || {}
        try {
          let r
          switch (kind) {
            case 'refresh': await loadOverview(); r = { text: t('done.refresh') }; break
            case 'selfcheck': r = await api('/selfcheck', { timeout: 180000 }); setChecks(r.checks || []); break
            case 'status': r = await api('/status', { timeout: 120000 }); break
            case 'push': r = await post('/push', {
                categories: pushCats,
                skills: pushSkills,
                sessions: pushSessions,
                dshconfig: pushDshConfig,
                message: a.message || '',
              }, 300000); await loadOverview(); break
            // 一键同步（overview 用）：按默认预设预演，确认后真推。
            case 'syncPreview': {
                const cats = syncPresetCats()
                r = await post('/push', { categories: cats, dryRun: true }, 300000)
                break
            }
            case 'syncNow': {
                const cats = syncPresetCats()
                const dry = await post('/push', { categories: cats, dryRun: true }, 300000)
                if (dry && dry.fileCount === 0) { r = { text: t('sync.nowNothing') }; break }
                const msg = dry && dry.ok
                    ? t('sync.nowConfirm', { n: dry.fileCount, size: dry.bytes > 1024 ? (dry.bytes / 1024).toFixed(1) + ' KB' : dry.bytes + ' B', cats: cats.join(' / ') })
                    : t('sync.nowRetry')
                const go = typeof window === 'undefined' ? true : window.confirm(msg)
                if (!go) { r = { text: t('sync.nowCancelled') }; break }
                r = await post('/push', { categories: cats }, 600000)
                await loadOverview()
                break
            }
            case 'preflight': {
                const cats = syncPresetCats()
                r = await api('/preflight?categories=' + encodeURIComponent(cats.join(',')), { timeout: 300000 })
                setPreflight(r)
                r = { text: (r && r.ok) ? t('pf.done') : 'self-check failed' }
                break
            }
            case 'pullNow':
                r = await post('/pull', { categories: syncPresetCats() }, 600000)
                setSyncConflict(r && Array.isArray(r.conflictFiles) ? r.conflictFiles : []); await loadOverview(); break
            case 'pull': r = await post('/pull', {
                categories: pullCats,
                skills: pullSkills,
                sessions: pullSessions,
                dshconfigWriteBack: pullDshConfigWB,
                machineId: machineId || undefined,
                skipProfile: pullSkipProfile,
                force: pullForce,
              }, 300000); setSyncConflict(r && Array.isArray(r.conflictFiles) ? r.conflictFiles : []); await loadOverview(); break
            case 'backupNow': r = await post('/backup/create', {}, 90000); break
            case 'console': r = await post('/console'); break
            case 'doctor': r = await post('/doctor', {}, 240000); break
            case 'doctorFix': r = await post('/doctor', { fix: true }, 240000); break
            case 'net': r = await post('/net', {}, 180000); break
            case 'backups': r = await api('/backups', { timeout: 90000 }); setBackups(r.items || []); break
            case 'deleteBackup': r = await post('/backup/delete', { name: a.name }, 60000); await run('backups', 'bkList'); break
            case 'scheduleStatus': { const s = await api('/schedule', { timeout: 30000 }); setSched(s); r = { text: s.ok ? t('schedule.done') : '' }; break }
            case 'scheduleToggle': {
              const installing = !(sched && sched.installed)
              r = await post('/schedule', { action: installing ? 'install' : 'remove' }, 60000)
              await run('scheduleStatus', 'sch')
              break
            }
            case 'restore': r = await post('/restore', { name: a.name || (key === 'restoreLatest' ? 'latest-agents' : (window.__shRestore || '')) }, 90000); break
            case 'sessionsBackup': r = await post('/sessions', { action: 'backup' }, 600000); break
            case 'sessBrowse': {
                const q = sessMachine ? '?machine=' + encodeURIComponent(sessMachine) : ''
                r = await api('/sessions/browse' + q, { timeout: 300000 }); setSessBrowse(r); break
            }
            case 'sessOpen': {
                if (!a.id) { r = { text: 'pick a session first' }; break }
                const m2 = (sessBrowse && sessBrowse.machine) || ''
                const q2 = '?machine=' + encodeURIComponent(m2) + '&id=' + encodeURIComponent(a.id)
                r = await api('/sessions/browse' + q2, { timeout: 300000 }); setSessOpen(r); break
            }
            case 'sessionsList': r = await post('/sessions', { action: 'list' }, 90000); break
            case 'skillsInfo': r = await api('/skills', { timeout: 60000 }); setSkills(r); break
            case 'skillsToHub': r = await post('/skills', { dir: 'tohub' }, 240000); break
            case 'skillsFromHub': r = await post('/skills', { dir: 'fromhub' }, 240000); break
            case 'skHubDelete': r = await post('/skills', { action: 'hubdelete', name: a.name }, 240000); await run('skillsInfo', 'skInfo'); break
            case 'skHubUpload': r = await post('/skills', { action: 'pushsingle', name: a.name }, 240000); await run('skillsInfo', 'skInfo'); break
            // ── skills page ──────────────────────────────────────────────────
            case 'skRefresh': {
              const list = await api('/skills/list', { timeout: 60000 })
              setSkList(list)
              r = { text: list.ok ? t('done.refresh') : String(list.error || '') }
              put('skListRefresh', r.text)
              return
              break
            }
            case 'skEnable': r = await post('/skills/toggle', { name: a.name, rootId: a.rootId, enable: true }, 30000); await run('skRefresh', 'skListRefresh'); break
            case 'skDisable': r = await post('/skills/toggle', { name: a.name, rootId: a.rootId, enable: false }, 30000); await run('skRefresh', 'skListRefresh'); break
            case 'skRead': r = await post('/skills/read', { name: a.name, rootId: a.rootId }, 30000); break
            case 'skImport': {
              if (!skUrl.trim()) { r = { text: t('sk.needUrl') }; break }
              r = await post('/skills/import', { url: skUrl.trim(), name: skName.trim() }, 300000)
              if (r.ok) { setSkUrl(''); setSkName('') }
              await run('skRefresh', 'skListRefresh')
              break
            }
            case 'skCreate': {
              if (!skNewName.trim() || !skNewDesc.trim()) { r = { text: t('sk.needBoth') }; break }
              r = await post('/skills/create', { name: skNewName.trim(), description: skNewDesc.trim() }, 30000)
              if (r.ok) { setSkNewName(''); setSkNewDesc('') }
              await run('skRefresh', 'skListRefresh')
              break
            }
            case 'skTrash': r = await post('/skills/trash', { name: a.name }, 30000); await run('skRefresh', 'skListRefresh'); break
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
              const f = await api('/plugins/featured', { timeout: 30000 }).catch(() => undefined)
              if (f) setFeatured(f)
              r = { text: t('done.refresh') }
              break
            }
            case 'plCheck': {
              const o = await api('/plugins/outdated', { timeout: 180000 })
              setOutdated(o)
              const n = o.outdated || 0
              r = { text: n ? t('pl.hasUpdate', { n }) : t('pl.allLatest') }
              break
            }
            case 'plSpec': {
              const s = await api('/plugins/spec', { timeout: 30000 })
              setPlSpec(s)
              r = { text: s.ok ? t('done.refresh') : 'spec read failed' }
              break
            }
            case 'plPortable': {
              // 换机补齐：拉源码 + 写 link + 重装依赖（不重启），然后刷两份状态
              r = await post('/plugins', { action: 'install' }, 900000)
              if (r.ok) { await run('plSpec', key); await run('plRefresh', 'plRefresh') }
              break
            }
            // ── 云端文件（查看/编辑）────────────────────────────────────
            case 'hubRefresh': {
              const l = await api('/hub/files', { timeout: 60000 })
              // 后端返回 { ok, files:[...], total }；state 直接存 files 数组，
              // 否则 L1720 的 Array.isArray(hubFilesList) 对对象恒为 false，左侧列表永远空白
              setHubFilesList(l && Array.isArray(l.files) ? l.files : (Array.isArray(l) ? l : []))
              r = { text: l && l.ok ? t('hub.loaded', { n: l.total || 0 }) : String(l.error || 'failed') }
              break
            }
            case 'hubRead': {
              if (!a.path) { r = { text: t('hub.needPick') }; break }
              const f = await api('/hub/file' + (a.path ? '?path=' + encodeURIComponent(a.path) : ''), { timeout: 60000 })
              if (!f.ok) { r = { text: f.text || 'open failed' }; break }
              openHubFile(f.path || a.path, f.text || '')
              setHubActive(f.path || a.path)
              r = { text: t('hub.opened', { path: f.path }) }
              break
            }
            case 'hubReload': {
              if (!hubActive) { r = { text: t('hub.needPick') }; break }
              const f = await api('/hub/file?path=' + encodeURIComponent(hubActive), { timeout: 60000 })
              if (f.ok) { setHubTabText(hubActive, f.text || ''); setHubTabs((prev) => prev.map((x) => x.path === hubActive ? { ...x, baseline: f.text || '' } : x)) }
              r = { text: f.ok ? t('hub.reloaded') : (f.text || 'reload failed') }
              break
            }
            case 'hubSave': {
              if (!hubActive) { r = { text: t('hub.needPick') }; break }
              const txt = hubTextOf(hubActive)
              const base = hubBaselineOf(hubActive)
              if (txt === base) { r = { text: t('hub.noChange') }; break }
              // 覆盖类操作：先本地确认（铁律：改动文件前先确认，覆盖前先归档由后端做）
              const okSave = typeof window === 'undefined' ? true
                : window.confirm(t('hub.saveConfirm', { path: hubActive }))
              if (!okSave) { r = { text: t('hub.saveCancelled') }; break }
              r = await post('/hub/file', { path: hubActive, text: txt }, 120000)
              if (r && r.ok && r.changed) { setHubTabs((prev) => prev.map((x) => x.path === hubActive ? { ...x, baseline: txt } : x)) }
              break
            }
            case 'plUpdate': {
              r = await post('/plugins/update', { name: a.name, profile: a.profile || plProfile }, 900000)
              if (r.ok) { await run('plRefresh', key); await run('plCheck', 'plCheck') }
              break
            }
            case 'plUpdateAll': {
              const o = outdated || await api('/plugins/outdated', { timeout: 180000 })
              setOutdated(o)
              const todo = (o.items || []).filter(x => x.outdated)
              if (!todo.length) { r = { text: t('pl.allLatest') }; break }
              const lines = []
              for (const item of todo) {
                const res = await post('/plugins/update', { name: item.name, profile: item.profile }, 900000)
                lines.push((res.ok ? '✓ ' : '✗ ') + item.name + (res.ok ? '' : '  ' + String(res.text).split('\n')[0]))
                if (!res.ok) break   // stop on first failure (usually DSH running)
              }
              await run('plRefresh', 'plRefresh')
              r = { text: lines.join('\n') }
              break
            }
            case 'plSearch': {
              const m = await api('/plugins/market?q=' + encodeURIComponent(plQuery.trim()) + '&size=20', { timeout: 60000 })
              setPlMarket(m)
              r = { text: m.ok ? '' : String(m.text || '') }
              break
            }
            case 'plInstall': r = await post('/plugins/install', { name: a.name, profile: a.profile || plProfile }, 900000); break
            case 'plUninstall': r = await post('/plugins/uninstall', { name: a.name, profile: a.profile || plProfile }, 300000); await run('plRefresh', key); break
            case 'toolsRefresh': await loadOverview(); r = { text: t('done.refresh') }; break
            case 'toolsInstall': r = await post('/tools/install', { mode: 'all' }, 900000); await loadOverview(); break
            case 'toolsInstallNice': r = await post('/tools/install', { mode: 'allnice' }, 1800000); await loadOverview(); break
            case 'logs': r = await api('/logs', { timeout: 30000 }); setLogs(r); setLogsPick(r.current || ''); break
            case 'logsPick': { const name = a.name || logsPick; setLogsPick(name); r = await api('/logs?file=' + encodeURIComponent(name), { timeout: 30000 }); setLogs(r); break }
            case 'manual': r = await api('/manual', { timeout: 30000 }); setManual(r); break
            case 'clearManual': setManual(undefined); break
            case 'saveCred': r = await post('/cred', { username: cUser, token: cToken }, 180000); setCToken(''); await loadOverview(); break
            case 'bootstrap': r = await post('/bootstrap', { machine: bMachine, dest: bDest, ...(bRepo.trim() ? { repoUrl: bRepo.trim() } : {}) }, 1500000); break
            default: r = { text: 'unknown action: ' + kind }
          }
          if (r && r.text) put(key, r.text)
        } catch (e) {
          put(key, '✗ ' + String(e?.message ?? e))
        } finally { setBusy('') }
      }, [loadOverview, put, cUser, cToken, bMachine, bDest, bRepo, pushCats, pullCats, pushSkills, pullSkills, pushSessions, pullSessions, pushDshConfig, pullDshConfigWB, machineId, pullSkipProfile, pullForce, skUrl, skName, skNewName, skNewDesc, plQuery, outdated, plProfile, logsPick, t])

      const Btn = ({ label, kind, out, primary, small, arg }) => {
        const isBusy = busy === kind
        return h('button', {
          type: 'button',
          style: { ...S.btn, ...(primary ? S.primary : {}), ...(small ? { fontSize: '0.72rem', padding: '0.22rem 0.55rem' } : {}), ...(isBusy ? { opacity: 0.65 } : {}) },
          disabled: !!busy,
          onClick: () => run(kind, out || kind, arg),
        }, isBusy ? (label + ' …') : label)
      }

      // result of an action, shown inside the card that owns it
      const Result = ({ k, restart }) => {
        const text = out[k]
        if (!text) return null
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.3rem' } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('span', { style: { fontSize: '0.7rem', opacity: 0.6 } }, t('output')),
            h('button', { type: 'button', style: { ...S.btn, ...{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' } }, onClick: () => put(k, '') }, t('clear'))),
          h('pre', { style: S.pre }, text),
          restart ? h('div', { style: { ...S.hint, color: '#ffd479', background: 'rgba(255,212,121,0.08)', padding: '0.4rem 0.6rem', borderRadius: '0.4rem' } }, '✅ ' + t('hint.restart')) : null)
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
            h('p', { style: S.hint }, t('hint.bootstrapEta')),
            h(Result, { k: 'bootstrap' })))
      }

      const info = (ov && ov.info) || {}
      const cred = (ov && ov.cred) || {}
      const tools = (ov && ov.tools) || { tools: [], present: 0, total: 0, missingCore: 0 }
      const st = (ov && ov.status) || { sections: [], worst: 'pass' }

      const overviewTab = [
        // 真实状态条：老代码只比 HEAD vs origin，没看工作区，
        // 曾出现"完全同步"绿条却带着 5 个未提交文件。这里把三态分开说清。
        ((info.dirty && info.dirty > 0) || (info.ahead && info.ahead > 0) || (info.behind && info.behind > 0))
          ? h(Card, { key: 'syncstate', level: 'warn' },
            h('p', { style: { ...S.hint, margin: 0, fontWeight: 600 } },
              [
                info.dirty > 0 ? t('ov.stateDirty', { n: info.dirty }) : null,
                info.ahead > 0 ? t('ov.stateAhead', { n: info.ahead }) : null,
                info.behind > 0 ? t('ov.stateBehind', { n: info.behind }) : null,
              ].filter(Boolean).join('   ·   ')),
            info.dirty > 0 ? h('p', { style: { ...S.hint, opacity: 0.75, margin: 0 } },
              t('ov.stateDirtyWhy') + '  ' + (info.dirtyFiles || []).join('  ·  ')) : null,
            h('p', { style: { ...S.hint, opacity: 0.75, margin: 0 } }, t('ov.stateHint')),
            h('div', { style: S.row },
              h(Btn, { label: t('act.syncNow'), kind: 'syncNow', out: 'syncNow', primary: true }),
              h(Btn, { label: t('act.syncPreview'), kind: 'syncPreview', out: 'syncPreview' }),
              h(Btn, { label: t('act.pullNow'), kind: 'pullNow', out: 'pullNow' }),
              h(Btn, { label: t('act.preflight'), kind: 'preflight', out: 'preflight' })),
            h(Result, { k: 'syncNow', restart: true }), h(Result, { k: 'syncPreview' }), h(Result, { k: 'pullNow', restart: true }))
          : h(Card, { key: 'syncstate', level: 'pass' },
            h('p', { style: { ...S.hint, ...S.ok, margin: 0 } }, t('ov.stateIdle')),
            h('div', { style: S.row },
              h(Btn, { label: t('act.syncPreview'), kind: 'syncPreview', out: 'syncPreview' }))),
        preflight && preflight.checks ? h(Card, { key: 'pf', title: t('pf.title'), level: preflight.worst === 'fail' ? 'fail' : (preflight.worst === 'warn' ? 'warn' : 'pass') },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } },
            ...preflight.checks.map((c, ci) => h('div', { key: ci, style: { ...S.listRow, alignItems: 'flex-start' } },
              h(Dot, { level: c.level === 'fail' ? 'fail' : (c.level === 'warn' ? 'warn' : (c.level === 'info' ? 'info' : 'pass')) }),
              h('span', { style: { flex: 1, whiteSpace: 'pre-wrap' } }, t('pf.' + c.key) + '：' + c.detail)))),
          preflight.fileCount ? h('p', { style: { ...S.hint, opacity: 0.7 } }, t('pf.summary', { n: preflight.fileCount, size: preflight.bytes > 1048576 ? (preflight.bytes / 1048576).toFixed(1) + ' MB' : (preflight.bytes / 1024).toFixed(1) + ' KB' })) : null) : null,
        h(Card, { key: 'kv' },
          h('p', { style: S.hint }, t('ov.guide')),
          h('div', { style: S.kv },
            h(KV, { k: t('ov.version'), v: 'v' + (info.version || '?') + '   ·   ' + (info.machine || '') }),
            h(KV, { k: t('ov.commit'), v: [info.commit, info.commitDate, info.commitSubject].filter(Boolean).join('  ') }),
            h(KV, { k: t('ov.skills'), v: String(info.skills ?? '?') }),
            h(KV, { k: t('ov.tree'), v: info.dirty === 0 ? t('ov.clean') : t('ov.dirty', { n: info.dirty }) }),
            h(KV, { k: t('sec.cred'), v: cred.hasCredential ? (t('cred.ok') + '  ·  ' + (cred.username || '') + '  ·  ' + (cred.repoHost || '')) : t('cred.none') }),
            h(KV, { k: t('sec.tools'), v: t('tools.summary', { p: tools.present, n: tools.total }) + (tools.missingCore ? '   ·   ' + t('tools.missingCore') : '') })),
          h('div', { style: S.row },
            h(Btn, { label: t('refresh'), kind: 'refresh', out: 'ovRefresh' }),
            h(Btn, { label: t('ov.runcheck'), kind: 'selfcheck', out: 'selfcheck' }))),
        checks ? h(Card, { key: 'chk', title: t('ov.health'), level: checks.some(c => c.level === 'fail') ? 'fail' : (checks.some(c => c.level === 'warn') ? 'warn' : 'pass') },
          ...checks.map(c => h('div', { key: c.key, style: S.listRow },
            h(Dot, { level: c.level }),
            h('span', { style: { minWidth: '5.5rem', opacity: 0.75 } }, c.key),
            h('span', { style: { flex: 1 } }, c.detail)))) : null,
        h(Result, { key: 'r', k: 'selfcheck' }), h(Result, { key: 'r2', k: 'ovRefresh' }),
      ]

      // ── 同步 = 云端（两台电脑通过 Gitee 交换改动） ──────────────────────────
      // 辅助：六类勾选网格（含全选/全不选）
      const renderCatGrid = (cats, setCats) => {
        const toggle = (c) => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.2rem' } },
          h('div', { style: S.row },
            h('span', { style: { ...S.hint, fontWeight: 600 } }, t('sync.pickCat')),
            h('button', { type: 'button', style: { ...S.miniBtn }, disabled: !!busy, onClick: () => setCats([...ALL_CATS]) }, t('cat.all')),
            h('button', { type: 'button', style: { ...S.miniBtn }, disabled: !!busy, onClick: () => setCats([]) }, t('cat.none'))),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem 0.9rem' } },
            ALL_CATS.map((c) => h('label', {
              key: c,
              title: CAT_HINT[c] || '',
              style: { ...S.hint, display: 'flex', gap: '0.3rem', alignItems: 'center', opacity: cats.includes(c) ? 1 : 0.45, cursor: 'pointer' },
            },
              h('input', { type: 'checkbox', checked: cats.includes(c), disabled: !!busy, onChange: () => toggle(c) }),
              t('cat.' + c))))),
          h('p', { style: { ...S.hint, fontSize: '0.68rem', opacity: 0.55 } },
            ALL_CATS.filter((c) => cats.includes(c)).map((c) => CAT_HINT[c]).filter(Boolean).join('  |  ') || t('sync.noneScope'))
      }
      // 辅助：技能/会话多选（默认全选=空数组；勾选个别=命名列表）
      // 用原生 <details> 实现可收起/展开的列表：点标题收起/展开，每行显示名称 + 说明。
      // opts.descOf：可选，返回每项的说明文字；缺省取 it.description（会话无说明则留空）。
      const renderMulti = (label, items, selected, setSelected, opts) => {
        if (!items || !items.length) return null
        const names = items.map((it) => it.name)
        const descOf = (opts && typeof opts.descOf === 'function') ? opts.descOf
          : ((it) => (it && it.description ? it.description : ''))
        const allOn = selected.length === 0
        const toggle = (n) => {
          if (selected.length === 0) { setSelected(names.filter((x) => x !== n)); return }
          setSelected(selected.includes(n) ? selected.filter((x) => x !== n) : [...selected, n])
        }
        const setAll = () => setSelected([])
        const clearAll = () => setSelected([...names])
        const onCount = allOn ? names.length : selected.filter((n) => names.includes(n)).length
        return h('details', {
          key: 'multi-' + label, open: false,
          style: {
            marginTop: '0.3rem',
            // 主题自适应：跟 S.btn / S.listRow 用同一组变量，浅色主题不会变成黑块
            border: '1px solid var(--color-border, rgba(128,128,128,0.22))',
            borderRadius: '6px',
            padding: '0.15rem 0.5rem',
            background: 'var(--color-surface, rgba(128,128,128,0.05))',
            color: 'inherit',
          },
        },
          h('summary', { style: { ...S.hint, color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' } },
            h('span', { style: { fontWeight: 600, color: 'inherit' } }, label),
            h('span', { style: { opacity: 0.6, fontSize: '0.7rem' } }, t('sync.pickCount', { n: onCount, total: names.length })),
            h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', style: { ...S.miniBtn, fontSize: '0.64rem', padding: '0.08rem 0.4rem' }, disabled: !!busy, onClick: (e) => { e.stopPropagation(); setAll() } }, t('sync.selAll')),
            h('button', { type: 'button', style: { ...S.miniBtn, fontSize: '0.64rem', padding: '0.08rem 0.4rem' }, disabled: !!busy, onClick: (e) => { e.stopPropagation(); clearAll() } }, t('sync.selClear'))),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.05rem', maxHeight: '11rem', overflowY: 'auto', marginTop: '0.2rem', color: 'inherit' } },
            items.map((it) => {
              const on = allOn || selected.includes(it.name)
              const desc = descOf(it)
              return h('label', {
                key: it.name,
                style: { ...S.hint, color: 'inherit', display: 'flex', gap: '0.45rem', alignItems: 'flex-start', opacity: on ? 1 : 0.5, cursor: 'pointer', padding: '0.18rem 0', borderBottom: '1px solid rgba(127,127,127,0.15)' },
              },
                h('input', { type: 'checkbox', checked: on, disabled: !!busy, onChange: () => toggle(it.name), style: { marginTop: '0.12rem' } }),
                h('span', { style: { display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0, color: 'inherit' } },
                  h('span', { style: { wordBreak: 'break-all', color: 'inherit' } }, it.name),
                  desc ? h('span', { style: { fontSize: '0.68rem', opacity: 0.6, fontWeight: 400, lineHeight: 1.35, color: 'inherit' } }, desc) : null))
            })))
      }

      const syncTab = [
        h(Card, { key: 'preset', title: t('sync.presetTitle') },
          h('p', { style: S.hint }, t('sync.presetHint')),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.3rem' } },
            ...SYNC_PRESETS.map((p) => h('button', {
              key: p.id, type: 'button', disabled: !!busy,
              style: {
                ...S.btn, fontSize: '0.72rem',
                background: presetId === p.id ? 'var(--color-accent, #2a6)' : 'var(--color-surface, rgba(128,128,128,0.07))',
                color: presetId === p.id ? '#fff' : 'inherit',
              },
              onClick: () => {
                setPresetId(p.id)
                const saved = loadPresets() || { overrides: {} }
                saved.default = p.id
                try { window.localStorage.setItem(PRESET_KEY, JSON.stringify(saved)) } catch { /* noop */ }
                setPushCats([...p.cats])
                setPullCats([...p.cats])
                put('presetSave', t('sync.presetSaved'))
              },
            }, t('sync.preset' + p.id[0].toUpperCase() + p.id.slice(1)) + '  ·  ' + p.cats.join('+')))),
          h(Result, { k: 'presetSave' })),
        h(Card, { key: 'what', title: t('sync.whatTitle') },
          h('p', { style: { ...S.hint, fontSize: '0.74rem' } }, t('sync.what')),
          h('p', { style: S.hint }, t('hint.console'))),
        h(Card, { key: 'up', title: t('sync.upTitle'), level: st.worst },
          h('p', { style: S.hint }, t('sync.upHint')),
          renderCatGrid(pushCats, setPushCats),
          pushCats.includes('skills') ? renderMulti(t('sync.pickSkills'), skillList && skillList.items ? skillList.items : [], pushSkills, setPushSkills) : null,
          pushCats.includes('sessions') ? renderMulti(t('sync.pickSessions'), sessionList && sessionList.length ? sessionList : [], pushSessions, setPushSessions, { descOf: () => '' }) : null,
          h('label', { key: 'dsh', style: { ...S.hint, display: 'flex', gap: '0.3rem', alignItems: 'center', marginTop: '0.5rem' } },
            h('input', { type: 'checkbox', checked: pushDshConfig, disabled: !!busy, onChange: (e) => setPushDshConfig(e.target.checked) }),
            t('cat.dshconfig')),
          h('p', { style: { ...S.hint, fontSize: '0.72rem', opacity: 0.6 } }, t('sync.dshHintPush')),
          h('div', { style: S.row },
            h(Btn, { label: t('act.push'), kind: 'push', out: 'syncPush', primary: true }),
            h(Btn, { label: t('act.status'), kind: 'status', out: 'syncStatus' })),
          h(Result, { k: 'syncPush', restart: true }), h(Result, { k: 'syncStatus' })),
        h(Card, { key: 'down', title: t('sync.downTitle') },
          h('p', { style: S.hint }, t('sync.downHint')),
          renderCatGrid(pullCats, setPullCats),
          pullCats.includes('skills') ? renderMulti(t('sync.pickSkills'), skillList && skillList.items ? skillList.items : [], pullSkills, setPullSkills) : null,
          pullCats.includes('sessions') ? renderMulti(t('sync.pickSessions'), sessionList && sessionList.length ? sessionList : [], pullSessions, setPullSessions, { descOf: () => '' }) : null,
          h('label', { key: 'dshb', style: { ...S.hint, display: 'flex', gap: '0.3rem', alignItems: 'center', marginTop: '0.5rem' } },
            h('input', { type: 'checkbox', checked: pullDshConfigWB, disabled: !!busy, onChange: (e) => setPullDshConfigWB(e.target.checked) }),
            t('cat.dshconfig')),
          h('p', { style: { ...S.hint, fontSize: '0.72rem', opacity: 0.6 } }, t('sync.dshHintPull')),
          h('details', { style: { marginTop: '0.4rem' } },
            h('summary', { style: { ...S.hint, cursor: 'pointer' } }, t('sync.advanced')),
            h('div', { style: S.row, },
              h('label', { style: { ...S.hint, display: 'flex', gap: '0.3rem', alignItems: 'center' } },
                h('input', { type: 'checkbox', checked: pullSkipProfile, disabled: !!busy, onChange: e => setPullSkipProfile(e.target.checked) }),
                t('opt.skipProfile')),
              h('label', { style: { ...S.hint, display: 'flex', gap: '0.3rem', alignItems: 'center' } },
                h('input', { type: 'checkbox', checked: pullForce, disabled: !!busy, onChange: e => setPullForce(e.target.checked) }),
                t('opt.force')))),
          h('div', { style: S.row },
            h(Btn, { label: t('act.pull'), kind: 'pull', out: 'syncPull', primary: true }),
            h(Btn, { label: t('act.console'), kind: 'console', out: 'syncConsole' })),
          h('p', { style: S.hint }, t('hint.pull')),
          h('p', { style: S.hint }, t('hint.pullEta')),
          h(Result, { k: 'syncPull', restart: true }), h(Result, { k: 'syncConsole' })),
        syncConflict.length ? h(Card, { key: 'conflict', title: t('sync.conflictTitle'), level: 'fail' },
          h('p', { style: S.hint }, t('sync.conflictHint')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.25rem' } },
            ...syncConflict.map((f, i) => h('div', { key: i, style: { ...S.listRow, background: 'rgba(248,81,73,0.12)' } },
              h('span', { style: { opacity: 0.6, minWidth: '1.6rem' } }, '#' + (i + 1)),
              h('span', { style: { flex: 1, wordBreak: 'break-all', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' } }, f)))),
          h('div', { style: S.row },
            h(Btn, { label: t('sync.openManual'), kind: 'manual', out: 'manual', primary: true }),
            h(Btn, { label: t('act.console'), kind: 'console', out: 'syncConsole2' }))) : null,
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
            h(Btn, { label: t('act.backupNow'), kind: 'backupNow', out: 'bkNow', primary: true })),
          h(Result, { k: 'bkNow' })),
        h(Card, { key: 'b', title: t('bk.listTitle') },
          h('div', { style: S.row },
            h(Btn, { label: t('act.backups'), kind: 'backups', out: 'bkList' }),
            h(Btn, { label: t('act.restoreLatest'), kind: 'restore', out: 'restoreLatest' })),
          h('p', { style: S.hint }, t('hint.backup')),
          backups === undefined ? null : (backups.length === 0
            ? h('p', { style: S.hint }, t('empty.output'))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.25rem' } },
                ...backups.map(b => h('div', { key: b.name, style: S.listRow },
                  h('span', { style: { opacity: 0.5, minWidth: '1.6rem' } }, '#' + b.index),
                  h('span', { style: { flex: 1, wordBreak: 'break-all' } }, b.name),
                  h('span', { style: { opacity: 0.6, whiteSpace: 'nowrap' } }, b.size + '  ' + b.date),
                  shDelName === b.name
                    ? h(Fragment, { key: 'cfm-' + b.name },
                        h('button', {
                          type: 'button',
                          style: { ...S.btn, fontSize: '0.68rem', padding: '0.15rem 0.5rem', background: 'rgba(209,36,47,0.18)', color: '#f85149', borderColor: 'rgba(209,36,47,0.5)' },
                          disabled: !!busy,
                          onClick: () => { setShDelName(''); run('deleteBackup', 'bkList', { name: b.name }) },
                        }, t('act.deleteConfirm')),
                        h('button', {
                          type: 'button',
                          style: { ...S.btn, fontSize: '0.68rem', padding: '0.15rem 0.5rem' },
                          disabled: !!busy,
                          onClick: () => setShDelName(''),
                        }, t('act.cancel')))
                    : h('button', {
                        type: 'button', style: { ...S.btn, fontSize: '0.68rem', padding: '0.15rem 0.5rem' },
                        disabled: !!busy,
                        onClick: () => { window.__shRestore = b.name; run('restore', 'restoreLatest') },
                      }, t('act.restore')),
                  shDelName === b.name ? null : h('button', {
                    type: 'button',
                    style: { ...S.btn, fontSize: '0.68rem', padding: '0.15rem 0.5rem', opacity: 0.7 },
                    disabled: !!busy,
                    onClick: () => setShDelName(b.name),
                  }, t('act.delete')))))),
          h(Result, { k: 'bkList' }), h(Result, { k: 'restoreLatest' })),
        h(Card, { key: 's', title: t('sec.sessions') },
          h('div', { style: S.row },
            h(Btn, { label: t('act.sessionsBackup'), kind: 'sessionsBackup', out: 'sessB' }),
            h(Btn, { label: t('act.sessionsList'), kind: 'sessionsList', out: 'sessL' })),
          h('p', { style: S.hint }, t('hint.sessions')),
          h(Result, { k: 'sessB' }), h(Result, { k: 'sessL' })),
        h(Card, { key: 'sessbrowse', title: t('sess.title') },
          h('p', { style: S.hint }, t('sess.hint')),
          h('div', { style: S.row },
            sessBrowse && sessBrowse.machines ? h('select', {
              value: sessMachine || sessBrowse.machine || '', style: S.select, disabled: !!busy,
              onChange: (e) => setSessMachine(e.target.value),
            }, ...sessBrowse.machines.map(mm => h('option', { key: mm, value: mm }, mm))) : null,
            h(Btn, { label: t('act.sessBrowse'), kind: 'sessBrowse', out: 'sessBrowse', primary: true })),
          sessBrowse && sessBrowse.groups ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.3rem' } },
            ...sessBrowse.groups.map((g, gi) => h('details', {
              key: gi, open: false,
              style: { border: '1px solid var(--color-border, rgba(128,128,128,0.22))', borderRadius: '6px', padding: '0.15rem 0.5rem', background: 'var(--color-surface, rgba(128,128,128,0.05))', color: 'inherit' },
            },
              h('summary', { style: { ...S.hint, color: 'inherit', cursor: 'pointer' } },
                h('span', { style: { fontWeight: 600, color: 'inherit' } }, g.workspace + '  (' + g.sessions.length + ')')),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.15rem', margin: '0.2rem 0', color: 'inherit' } },
                ...g.sessions.map(s => h('div', { key: s.id, style: { ...S.listRow, alignItems: 'flex-start' } },
                  h('span', { style: { flex: 1, minWidth: 0, wordBreak: 'break-all', color: 'inherit' } },
                    h('span', { style: { fontWeight: 500 } }, s.title),
                    h('span', { style: { fontSize: '0.66rem', opacity: 0.55, marginLeft: '0.4rem' } }, Math.round(s.bytes / 1024) + ' KB')),
                  h('button', {
                    type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                    onClick: () => run('sessOpen', 'sessOpen', { id: s.id }),
                  }, t('sess.open')))))))
          ) : (sessBrowse ? h('p', { style: S.hint }, t('sess.empty')) : null),
          sessOpen && sessOpen.msgs ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.5rem' } },
            h('p', { style: { ...S.hint, fontWeight: 600 } }, t('sess.viewing', { title: sessOpen.title || sessOpen.id })),
            h('div', { style: { maxHeight: '24rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem', color: 'inherit' } },
              ...sessOpen.msgs.map((mm, mi) => h('div', {
                key: mi,
                style: {
                  ...S.listRow, alignItems: 'flex-start',
                  background: mm.role === 'user' ? 'rgba(46,160,67,0.10)' : 'var(--color-surface, rgba(128,128,128,0.05))',
                },
              },
                h('span', { style: { minWidth: '3.4rem', fontSize: '0.66rem', opacity: 0.6 } }, mm.role === 'user' ? '老大' : 'AI'),
                h('span', { style: { flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'inherit' } }, mm.text))))) : null,
          h(Result, { k: 'sessBrowse' }), h(Result, { k: 'sessOpen' })),
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
            h(Btn, { label: t('act.skRefresh'), kind: 'skRefresh', out: 'skRefresh', primary: true }),
            h('input', { type: 'text', placeholder: t('sk.filter'), value: skFilter, style: { ...S.input, width: '11rem' }, onChange: e => setSkFilter(e.target.value) })),
          h(Result, { k: 'skRefresh' }), h(Result, { k: 'skListRefresh' })),

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
        h(Result, { k: 'skOp', restart: true }),

        // import from URL / create new
        h(Card, { key: 'add', title: t('sk.addTitle') },
          h('p', { style: S.hint }, t('sk.addHint')),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('sk.urlPh'), value: skUrl, disabled: !!busy, style: { ...S.input, width: '24rem' }, onChange: e => setSkUrl(e.target.value) }),
            h('input', { type: 'text', placeholder: t('sk.namePh'), value: skName, disabled: !!busy, style: { ...S.input, width: '9rem' }, onChange: e => setSkName(e.target.value) }),
            h(Btn, { label: t('act.skImport'), kind: 'skImport', out: 'skImport', primary: true })),
          h(Result, { k: 'skImport' }),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('sk.newNamePh'), value: skNewName, disabled: !!busy, style: { ...S.input, width: '10rem' }, onChange: e => setSkNewName(e.target.value) }),
            h('input', { type: 'text', placeholder: t('sk.newDescPh'), value: skNewDesc, disabled: !!busy, style: { ...S.input, width: '20rem' }, onChange: e => setSkNewDesc(e.target.value) }),
            h(Btn, { label: t('act.skCreate'), kind: 'skCreate', out: 'skCreate' })),
          h(Result, { k: 'skCreate' })),

        // hub sync (cloud side of skills)
        h(Card, { key: 'hub', title: t('sk.hubTitle') },
          h('p', { style: S.hint }, t('hint.skills')),
          h('div', { style: S.row },
            h(Btn, { label: t('act.skillsToHub'), kind: 'skillsToHub', out: 'skTo', primary: true }),
            h(Btn, { label: t('act.skillsFromHub'), kind: 'skillsFromHub', out: 'skFrom' }),
            h(Btn, { label: t('act.skDiff'), kind: 'skillsInfo', out: 'skInfo' })),
          skills ? h(Fragment, {},
            h('p', { style: { ...S.hint, opacity: 0.75 } }, t('skills.summary', { hub: skills.hub ?? '?', local: skills.local ?? '?' })),
            (skills.onlyLocal || []).length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } },
              h('div', { style: { fontSize: '0.72rem', opacity: 0.6 } }, t('skills.onlyLocal')),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } }, ...skills.onlyLocal.map(n => h('div', { key: n.name, style: { ...S.listRow, border: '1px solid rgba(127,127,127,0.25)', borderRadius: '5px', opacity: (n.junk || n.disabled) ? 0.45 : 1 } },
                h('span', { style: { display: 'flex', flexDirection: 'column', gap: '0.1rem', flex: 1, minWidth: 0 } },
                  h('span', { style: { wordBreak: 'break-all' } }, n.name),
                  n.description ? h('span', { style: { fontSize: '0.68rem', opacity: 0.6, fontWeight: 400, lineHeight: 1.35 } }, n.description) : null),
                (n.junk || n.disabled) ? h('span', { style: { ...S.hint, fontSize: '0.66rem' } }, t('sk.hubSkip')) : h('button', {
                  type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                  onClick: () => setHubUploadName(n.name),
                }, t('sk.hubUpload')))))) : null,
            (skills.onlyHub || []).length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } },
              h('div', { style: { fontSize: '0.72rem', opacity: 0.6 } }, t('skills.onlyHub')),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } }, ...skills.onlyHub.map(n => h('div', { key: n.name, style: { ...S.listRow, border: '1px solid rgba(127,127,127,0.25)', borderRadius: '5px' } },
                h('span', { style: { flex: 1, wordBreak: 'break-all' } }, n.name),
                h('button', {
                  type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' },
                  disabled: !!busy,
                  onClick: () => { setTab('files'); run('hubRead', 'hubFile', { path: 'skills/' + n.name + '/SKILL.md' }) },
                }, t('sk.hubEdit')),
                h('button', {
                  type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                  onClick: () => setHubDeleteName(n.name),
                }, t('sk.hubDelete')))))) : null,
            hubUploadName ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.4rem', padding: '0.5rem', border: '1px solid #3fb950', borderRadius: '6px', background: 'rgba(63,185,80,0.08)' } },
              h('p', { style: { ...S.hint, margin: 0 } }, t('sk.hubUploadConfirm', { name: hubUploadName })),
              h('p', { style: { ...S.hint, margin: 0, fontSize: '0.7rem', opacity: 0.7 } }, t('sk.hubUploadWarn')),
              h('div', { style: S.row },
                h('button', { type: 'button', style: { ...S.btn, fontSize: '0.7rem' }, disabled: !!busy, onClick: () => setHubUploadName('') }, t('cancel')),
                h('button', { type: 'button', style: { ...S.primary, fontSize: '0.7rem' }, disabled: !!busy, onClick: () => { setHubUploadName(''); run('skHubUpload', 'skOp', { name: hubUploadName }) } }, t('sk.hubUploadConfirmBtn')))) : null,
            hubDeleteName ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.4rem', padding: '0.5rem', border: '1px solid #d29922', borderRadius: '6px', background: 'rgba(210,153,34,0.08)' } },
              h('p', { style: { ...S.hint, margin: 0 } }, t('sk.hubDeleteConfirm', { name: hubDeleteName })),
              h('p', { style: { ...S.hint, margin: 0, fontSize: '0.7rem', opacity: 0.7 } }, t('sk.hubDeleteWarn')),
              h('div', { style: S.row },
                h('button', { type: 'button', style: { ...S.btn, fontSize: '0.7rem' }, disabled: !!busy, onClick: () => setHubDeleteName('') }, t('cancel')),
                h('button', { type: 'button', style: { ...S.primary, fontSize: '0.7rem' }, disabled: !!busy, onClick: () => { setHubDeleteName(''); run('skHubDelete', 'skOp', { name: hubDeleteName }) } }, t('sk.hubDeleteConfirmBtn')))) : null,
            (skills.diff || []).length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } },
              h('div', { style: { fontSize: '0.72rem', color: '#d29922' } }, t('skills.diff')),
              h('div', { style: { ...S.row, gap: '0.3rem' } }, ...skills.diff.map(n => h(Fragment, { key: n },
                h('span', { style: S.chip }, n),
                h('button', {
                  type: 'button', style: { ...S.miniBtn, fontSize: '0.62rem', padding: '0.05rem 0.35rem' }, disabled: !!busy,
                  onClick: () => { setTab('files'); run('hubRead', 'hubFile', { path: 'skills/' + n + '/SKILL.md' }) },
                }, t('sk.hubEdit')))))) : null,
            (!(skills.onlyLocal || []).length && !(skills.onlyHub || []).length && !(skills.diff || []).length)
              ? h('p', { style: S.hint }, t('skills.none')) : null) : null,
          h(Result, { k: 'skTo', restart: true }), h(Result, { k: 'skFrom', restart: true }), h(Result, { k: 'skInfo' })),

        // trash
        h(Card, { key: 'trash', title: t('sk.trashTitle') },
          h('div', { style: S.row }, h(Btn, { label: t('act.skTrashList'), kind: 'skTrashList', out: 'skTrashList' })),
          trashList ? ((trashList.items || []).length
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
      // ── 插件页 ────────────────────────────────────────────────────────────
      // 已装清单（含更新检查/更新）+ 推荐 + npm 市场
      const outdatedMap = {}
      for (const it of (outdated && outdated.items) || []) outdatedMap[it.profile + '/' + it.name] = it

      const pluginsTab = [
        h(Card, { key: 'port', title: t('pl.portTitle') },
          h('p', { style: S.hint }, t('pl.portHint')),
          h('div', { style: S.row },
            h(Btn, { label: t('act.plSpec'), kind: 'plSpec', out: 'plSpecOut' }),
            h(Btn, { label: t('act.plPortable'), kind: 'plPortable', out: 'plPort', primary: true })),
          plSpec && plSpec.ok ? h(Fragment, {},
            h('p', { style: { ...S.hint, opacity: 0.85 } }, t('pl.portSpec', {
              name: plSpec.spec.name || '-', tag: plSpec.spec.tag || '-',
            })),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.3rem' } },
              h('span', { style: { ...S.chip, borderColor: plSpec.cloned ? 'rgba(46,160,67,0.5)' : 'rgba(209,36,47,0.4)' } },
                t('pl.portCloned') + (plSpec.cloned ? ' ✓' + (plSpec.localVersion ? ' v' + plSpec.localVersion : '') : ' ✗')),
              h('span', { style: { ...S.chip, borderColor: plSpec.linked ? 'rgba(46,160,67,0.5)' : 'rgba(209,36,47,0.4)' } },
                t('pl.portLinked') + (plSpec.linked ? ' ✓' : ' ✗'))),
            (!plSpec.cloned || !plSpec.linked)
              ? h('p', { style: { ...S.hint, color: '#d29922', margin: 0 } }, t('pl.portNeedFix'))
              : h('p', { style: { ...S.hint, ...S.ok, margin: 0 } }, t('pl.portOk')))
          : h('p', { style: { ...S.hint, opacity: 0.55 } }, t('pl.portUnchecked')),
          h(Result, { k: 'plPort', restart: true }), h(Result, { k: 'plSpecOut' })),

        h(Card, { key: 'inst', title: t('pl.title') },
          h('p', { style: S.hint }, t('pl.what')),
          h('p', { style: S.hint }, t('pl.guide')),
          h('div', { style: S.row },
            h('label', { style: { fontSize: '0.74rem', opacity: 0.7 } }, t('pl.profileSel')),
            plList && plList.profiles && plList.profiles.length
              ? h('select', { value: plProfile, disabled: !!busy, style: S.select, onChange: e => setPlProfile(e.target.value) },
                  ...plList.profiles.map(p => h('option', { key: p.profile, value: p.profile }, p.profile + ' (' + p.items.length + ')')))
              : h('select', { value: 'desktop', disabled: true, style: S.select }, h('option', { value: 'desktop' }, 'desktop'))),
          h('div', { style: S.row },
            h(Btn, { label: t('act.plList'), kind: 'plRefresh', out: 'plRefresh', primary: true }),
            h(Btn, { label: t('act.plCheck'), kind: 'plCheck', out: 'plCheck' }),
            h(Btn, { label: t('act.plUpdateAll'), kind: 'plUpdateAll', out: 'plUpdateOut' })),
          outdated ? h('p', { style: { fontSize: '0.76rem', margin: 0, ...(outdated.outdated ? { color: '#d29922' } : S.ok) } },
            outdated.outdated ? t('pl.hasUpdate', { n: outdated.outdated }) : t('pl.allLatest')) : null,
          h('p', { style: S.hint }, t('hint.restart')),
          plList && plList.profiles ? h(Fragment, {},
            ...plList.profiles.map(p => h('div', { key: p.profile, style: { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.3rem' } },
              h('div', { style: { fontSize: '0.74rem', fontWeight: 600, opacity: 0.85 } }, t('pl.profile', { name: p.profile, n: p.items.length })),
              ...p.items.map(it => {
                const o = outdatedMap[p.profile + '/' + it.name]
                return h('div', { key: p.profile + it.name, style: S.listRow },
                  h(Dot, { level: it.linkOk ? (o && o.outdated ? 'warn' : 'pass') : 'fail' }),
                  h('span', { style: { flex: '1 1 14rem', wordBreak: 'break-all' } }, it.name),
                  h('span', { style: { fontSize: '0.7rem', opacity: 0.7, minWidth: '4rem' } }, it.version || '-'),
                  o && o.outdated ? h('span', { style: { ...S.chip, fontSize: '0.6rem', color: '#d29922', borderColor: 'rgba(210,153,34,0.5)' } },
                    t('pl.newVer', { v: o.latest })) : null,
                  it.bundled ? h('span', { style: { ...S.chip, fontSize: '0.6rem' } }, t('pl.bundled')) : null,
                  it.linkOk ? null : h('span', { style: { fontSize: '0.66rem', color: '#d1242f' } }, t('pl.broken')),
                  h('button', {
                    type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                    onClick: () => run('plUpdate', 'plUpdateOut', { name: it.name, profile: p.profile }),
                  }, t('pl.update') + (o && o.outdated ? ' (' + t('pl.newVer', { v: o.latest }) + ')' : '')),
                  h('button', {
                    type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                    onClick: () => run('plUninstall', 'plOp', { name: it.name, profile: p.profile }),
                  }, t('pl.uninstall')))
              }),
              p.orphanBundles.length ? h('div', { style: { fontSize: '0.66rem', opacity: 0.5 } },
                t('pl.builtin') + ': ' + p.orphanBundles.join(', ')) : null))) : h('p', { style: S.hint }, t('loading')),
          h(Result, { k: 'plRefresh' }), h(Result, { k: 'plCheck' }), h(Result, { k: 'plUpdateOut', restart: true }),
          h(Result, { k: 'plOp', restart: true }), h(Result, { k: 'plInst', restart: true })),

        // curated recommendations
        h(Card, { key: 'feat', title: t('pl.featTitle') },
          h('p', { style: S.hint }, t('pl.featHint')),
          ...(featured && featured.items ? featured.items : []).map(f => {
            const installed = (plList && plList.profiles || []).some(p => p.items.some(it => it.name === f.name))
            return h('div', { key: f.name, style: S.listRow },
              h(Dot, { level: installed ? 'pass' : 'info' }),
              h('span', { style: { flex: '1 1 13rem', wordBreak: 'break-all', fontWeight: 500 } }, f.name),
              h('span', { style: { flex: '2 1 15rem', fontSize: '0.68rem', opacity: 0.62 } }, f.why),
              installed
                ? h('span', { style: { ...S.chip, fontSize: '0.6rem', ...S.ok } }, t('pl.installed'))
                : h('button', {
                    type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                    onClick: () => run('plInstall', 'plInstallOut', { name: f.name, profile: plProfile }),
                  }, t('pl.install')))
          })),
        h(Result, { k: 'plInstallOut', restart: true }),

        h(Card, { key: 'mkt', title: t('pl.marketTitle') },
          h('p', { style: S.hint }, t('pl.marketHint')),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('pl.searchPh'), value: plQuery, disabled: !!busy, style: { ...S.input, width: '16rem' }, onChange: e => setPlQuery(e.target.value) }),
            h(Btn, { label: t('act.plSearch'), kind: 'plSearch', out: 'plSearch', primary: true })),
          plMarket && plMarket.items ? (plMarket.items.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.25rem' } },
                h('p', { style: { ...S.hint, opacity: 0.6 } }, t('pl.found', { n: plMarket.total })),
                ...plMarket.items.map(it => h('div', { key: it.name, style: S.listRow },
                  h('span', { style: { flex: '1 1 14rem', wordBreak: 'break-all' } }, it.name),
                  h('span', { style: { fontSize: '0.7rem', opacity: 0.7, minWidth: '4rem' } }, it.version),
                  h('span', { style: { flex: '2 1 14rem', fontSize: '0.68rem', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.description),
                  h('button', {
                    type: 'button', style: { ...S.btn, fontSize: '0.66rem', padding: '0.12rem 0.45rem' }, disabled: !!busy,
                    onClick: () => run('plInstall', 'plInstallOut', { name: it.name, profile: plProfile }),
                  }, t('pl.install')))))
            : h('p', { style: S.hint }, t('pl.noResult'))) : null,
          h(Result, { k: 'plSearch' })),
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
            h(Btn, { label: t('act.toolsRefresh'), kind: 'toolsRefresh', out: 'tlRefresh' }),
            h(Btn, { label: t('act.toolsInstall'), kind: 'toolsInstall', out: 'tlInst', primary: true }),
            h(Btn, { label: t('act.toolsInstallNice'), kind: 'toolsInstallNice', out: 'tlInstNice' })),
          h('p', { style: S.hint }, t('hint.tools')),
          h(Result, { k: 'tlRefresh' }), h(Result, { k: 'tlInst' }), h(Result, { k: 'tlInstNice' })),
        // environment checks live here now: they are all "this machine" concerns
        h(Card, { key: 'e', title: t('sec.health') },
          h('div', { style: S.row },
            h(Btn, { label: t('act.doctor'), kind: 'doctor', out: 'doc' }),
            h(Btn, { label: t('act.doctorFix'), kind: 'doctorFix', out: 'docFix', primary: true }),
            h(Btn, { label: t('act.net'), kind: 'net', out: 'net' })),
          h(Result, { k: 'doc' }), h(Result, { k: 'docFix' }), h(Result, { k: 'net' })),
        h(Card, { key: 'l', title: t('sec.logs') },
          h('div', { style: S.row }, h(Btn, { label: t('act.logs'), kind: 'logs', out: 'logs' })),
          logs ? h(Fragment, {},
            h('p', { style: S.hint }, t('logs.dir', { dir: logs.dir || '-' }) + '  ·  ' + t('logs.files', { n: Array.isArray(logs.files) ? logs.files.length : 0 })),
            (Array.isArray(logs.files) && logs.files.length > 1) ? h('div', { style: S.row },
              h('label', { style: { ...S.hint, display: 'flex', gap: '0.3rem', alignItems: 'center' } }, t('logs.pick'),
              h('select', {
                value: logsPick, style: S.input, disabled: !!busy,
                onChange: (e) => run('logsPick', 'logs', { name: e.target.value }),
              }, ...logs.files.map((f) => h('option', { key: f.name, value: f.name },
                f.name + '  (' + (f.mtime ? new Date(f.mtime).toLocaleString() : '') + (f.size ? ', ' + f.size + 'B' : '') + ')'))))) : null,
            h('p', { style: S.hint }, t('logs.newest', { name: logs.current || '-' })),
            h('pre', { style: S.pre }, logs.tail || '')) : null,
          h(Result, { k: 'logs' })),
      ]

      // ── 云端文件：查看 / 编辑中枢里的记忆·配置·技能正文 ────────────────
      // 方案 C：左文件树（搜索/筛选/分组折叠 + 元数据）+ 右多 Tab 编辑器 + 顶部摘要条
      const hubGroups = [
        { id: 'memory', label: t('hub.grpMemory') },
        { id: 'machine', label: t('hub.grpMachine') },
        { id: 'config', label: t('hub.grpConfig') },
        { id: 'skill', label: t('hub.grpSkill') },
      ]
      const hubFiles = Array.isArray(hubFilesList) ? hubFilesList : []
      const hubGroupOf = (f) => f.group || 'config'
      const hubBasename = (p) => String(p || '').split('/').pop() || p
      // 搜索 + 只显示脏 过滤
      const hubFiltered = hubFiles.filter((f) => {
        if (hubOnlyDirty && !f.dirty) return false
        if (!hubQuery.trim()) return true
        const q = hubQuery.trim().toLowerCase()
        return String(f.path).toLowerCase().includes(q) || (f.skill && f.skill.toLowerCase().includes(q))
      })
      const hubDirtyCount = hubFiles.filter((f) => f.dirty).length
      // 左侧文件树（按分组）
      const hubTree = h('div', { style: { flex: '0 1 16rem', minWidth: '11rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' } },
        h('div', { style: S.row },
          h(Btn, { label: t('act.hubRefresh'), kind: 'hubRefresh', out: 'hubList', primary: true })),
        h('input', {
          ref: hubSearchRef, type: 'text', placeholder: t('hub.searchPh'),
          value: hubQuery, onChange: (e) => setHubQuery(e.target.value),
          style: { ...S.input, width: '100%' },
        }),
        h('label', { style: { ...S.hint, display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer', userSelect: 'none' } },
          h('input', { type: 'checkbox', checked: !!hubOnlyDirty, onChange: (e) => setHubOnlyDirty(e.target.checked) }),
          t('hub.onlyDirty', { n: hubDirtyCount })),
        hubFiltered.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.35rem', overflow: 'auto', maxHeight: '34rem' } },
          ...hubGroups.map((g) => {
            const items = hubFiltered.filter((f) => hubGroupOf(f) === g.id)
            if (!items.length) return null
            return h('details', {
              key: 'g-' + g.id, open: true,
              style: { border: '1px solid var(--color-border, rgba(128,128,128,0.22))', borderRadius: '6px', padding: '0.15rem 0.5rem', background: 'var(--color-surface, rgba(128,128,128,0.05))', color: 'inherit' },
            },
              h('summary', { style: { ...S.hint, color: 'inherit', cursor: 'pointer', padding: '0.2rem 0' } },
                h('span', { style: { fontWeight: 600, color: 'inherit' } }, g.label + ' (' + items.length + ')')),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.06rem', margin: '0.12rem 0 0.3rem', color: 'inherit' } },
                ...items.map((f) => {
                  const name = hubBasename(f.path)
                  const size = f.size != null && f.size > 0 ? (f.size > 1024 ? (f.size / 1024).toFixed(1) + ' KB' : f.size + ' B') : ''
                  const skillTag = f.group === 'skill' && f.skill ? h('span', { style: { ...S.chip, opacity: 0.8 } }, f.skill) : null
                  const dirtyTag = f.dirty ? h('span', { style: { ...S.chip, color: '#d29922', borderColor: 'rgba(210,153,34,0.5)' } }, t('hub.dirtyTag')) : null
                  const active = hubActive === f.path
                  return h('button', {
                    key: f.path, type: 'button',
                    disabled: !f.exists || !!busy,
                    title: f.path,
                    style: {
                      ...S.miniBtn, fontSize: '0.68rem', textAlign: 'left',
                      display: 'flex', flexDirection: 'column', gap: '0.05rem', alignItems: 'stretch',
                      opacity: f.exists ? 1 : 0.4,
                      background: active ? 'var(--color-accent, #2a6)' : 'var(--color-surface, rgba(128,128,128,0.07))',
                      color: active ? '#fff' : 'inherit',
                    },
                    onClick: () => run('hubRead', 'hubFile', { path: f.path }),
                  },
                    h('div', { style: { display: 'flex', gap: '0.3rem', alignItems: 'center', justifyContent: 'space-between' } },
                      h('span', { style: { fontWeight: active ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
                      h('span', { style: { ...S.hint, opacity: active ? 0.85 : 0.55, fontSize: '0.62rem', whiteSpace: 'nowrap' } }, size)),
                    h('div', { style: { display: 'flex', gap: '0.25rem', flexWrap: 'wrap', opacity: active ? 0.9 : 0.6 } }, skillTag, dirtyTag))
                })
              )
            )
          })) : h('p', { style: S.hint }, t('hub.noFiles')),
      )
      // 右侧：多 Tab 编辑器
      const hubEditor = hubTabs.length ? h('div', { style: { flex: '1 1 24rem', minWidth: '15rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' } },
        // Tab 条
        h('div', { style: { display: 'flex', gap: '0.2rem', flexWrap: 'wrap', borderBottom: '1px solid var(--color-border, rgba(128,128,128,0.22))', paddingBottom: '0.3rem' } },
          ...hubTabs.map((x) => h('div', {
            key: x.path, type: 'button',
            style: {
              display: 'flex', gap: '0.3rem', alignItems: 'center',
              padding: '0.22rem 0.5rem', borderRadius: '0.4rem 0.4rem 0 0', cursor: 'pointer',
              fontSize: '0.72rem',
              background: hubActive === x.path ? 'var(--color-surface, rgba(128,128,128,0.12))' : 'transparent',
              color: 'inherit', border: '1px solid ' + (hubActive === x.path ? 'var(--color-border, rgba(128,128,128,0.3))' : 'transparent'),
              borderBottom: hubActive === x.path ? '1px solid var(--color-surface, rgba(128,128,128,0.12))' : 'none',
            },
            onClick: () => setHubActive(x.path),
          },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '12rem' } }, hubBasename(x.path)),
            hubDirtyTab(x.path) ? h('span', { style: { color: '#d29922', fontWeight: 700 }, title: t('hub.unsaved') }, '•') : null,
            h('button', {
              type: 'button', title: t('hub.closeTab'),
              style: { ...S.btn, padding: '0 0.3rem', fontSize: '0.7rem', lineHeight: 1, border: 'none', background: 'transparent', color: 'inherit', opacity: 0.6 },
              onClick: (e) => { e.stopPropagation(); closeHubTab(x.path) },
            }, '×'))),
        ),
        // 当前 Tab 内容
        (() => {
          const cur = hubTabs.find((x) => x.path === hubActive)
          if (!cur) return null
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.4rem' } },
            h('div', { style: { ...S.hint, wordBreak: 'break-all', fontFamily: 'ui-monospace, Consolas, monospace' } }, cur.path),
            h('textarea', {
              value: cur.text, disabled: !!busy,
              spellCheck: false,
              onChange: (e) => setHubTabText(cur.path, e.target.value),
              placeholder: t('hub.ph'),
              style: {
                ...S.input, width: '100%', minHeight: '22rem', resize: 'vertical',
                fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.72rem', lineHeight: 1.55,
                color: 'inherit',
              },
            }),
            h('div', { style: S.row },
              h(Btn, { label: t('act.hubSave'), kind: 'hubSave', out: 'hubSave', primary: true }),
              h(Btn, { label: t('act.hubReload'), kind: 'hubReload', out: 'hubFile' }),
              h('span', { style: { ...S.hint, opacity: 0.7 } }, t('hub.changed', {
                n: String(cur.text || '').split('\n').length,
                dirty: hubDirtyTab(cur.path) ? t('hub.dirtyYes') : t('hub.dirtyNo'),
              }))),
            hubDirtyTab(cur.path) ? h('p', { style: { ...S.hint, color: '#d29922', margin: 0 } }, t('hub.unsaved')) : null)
        })(),
      ) : h('div', { style: { flex: '1 1 24rem', minWidth: '15rem', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, h('p', { style: S.hint }, t('hub.pick')))
      const filesTab = [
        h(Card, { key: 'tree', title: t('hub.title') },
          // 顶部摘要条
          h('div', { style: { ...S.row, justifyContent: 'space-between', ...S.hint } },
            h('span', {}, t('hub.summary', { total: hubFiles.length, dirty: hubDirtyCount })),
            h('span', { style: { opacity: 0.7 } }, t('hub.hintShort'))),
          h('div', { style: { display: 'flex', gap: '0.9rem', alignItems: 'flex-start', flexWrap: 'wrap' } },
            hubTree, hubEditor),
          h('p', { style: { ...S.hint, opacity: 0.6 } }, t('hub.safety'))),
        h(Result, { k: 'hubList' }), h(Result, { k: 'hubFile' }), h(Result, { k: 'hubSave' }),
      ]

      const settingsTab = [        h(Card, { key: 'c', title: t('sec.cred'), level: cred.hasCredential ? 'pass' : 'warn' },
          h('p', { style: { fontSize: '0.78rem', margin: 0 } },
            cred.hasCredential ? (t('cred.ok') + '  ·  ' + (cred.username || '') + '  ·  ' + (cred.repoHost || '')) : (t('cred.none') + '  ·  ' + t('cred.noneHint'))),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: 'Gitee 用户名', value: cUser, style: S.input, onChange: e => setCUser(e.target.value) }),
            h('input', { type: 'password', placeholder: t('cred.token'), value: cToken, style: S.input, onChange: e => setCToken(e.target.value) }),
            h(Btn, { label: t('act.saveCred'), kind: 'saveCred', out: 'credSave' })),
          h('p', { style: S.hint }, t('hint.cred')),
          h('p', { style: S.hint }, t('hint.token')),
          h(Result, { k: 'credSave' })),
        h(Card, { key: 'b', title: t('sec.bootstrap') },
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('boot.machine'), value: bMachine, style: S.input, onChange: e => setBMachine(e.target.value) }),
            h('input', { type: 'text', placeholder: t('boot.dest'), value: bDest, style: { ...S.input, width: '15rem' }, onChange: e => setBDest(e.target.value) })),
          h('div', { style: S.row },
            h('input', { type: 'text', placeholder: t('boot.repo'), value: bRepo, style: { ...S.input, width: '20rem' }, onChange: e => setBRepo(e.target.value) }),
            h(Btn, { label: t('act.bootstrap'), kind: 'bootstrap', out: 'bootGo', primary: true })),
          !cred.hasCredential ? h('p', { style: { ...S.hint, color: '#d29922' } }, t('boot.needCred')) : null,
          h('p', { style: S.hint }, t('hint.bootstrap')),
          h(Result, { k: 'bootGo' })),
        h(Card, { key: 'sch', title: t('sec.schedule'), level: sched && sched.installed ? 'pass' : 'info' },
          h('p', { style: S.hint }, t('schedule.what')),
          sched ? h('p', { style: { fontSize: '0.78rem', margin: '0 0 0.4rem' } },
            (sched.installed ? t('schedule.on') : t('schedule.off')) +
            (sched.next ? '   ·   ' + t('schedule.next', { t: sched.next }) : '')) : null,
          h('div', { style: S.row },
            h(Btn, { label: sched && sched.installed ? t('act.scheduleRemove') : t('act.scheduleInstall'), kind: 'scheduleToggle', out: 'sch', primary: !sched || !sched.installed }),
            h(Btn, { label: t('act.scheduleStatus'), kind: 'scheduleStatus', out: 'sch' })),
          h(Result, { k: 'sch' })),
      ]

      const body = tab === 'overview' ? overviewTab
        : tab === 'sync' ? syncTab
        : tab === 'files' ? filesTab
        : tab === 'backup' ? backupTab
        : tab === 'skills' ? skillsTab
        : tab === 'plugins' ? pluginsTab
        : tab === 'tools' ? toolsTab
        : settingsTab

      if (err) {
        return shell(h(Card, { title: t('error', { e: err }), level: 'fail' },
          h('div', { style: S.row }, h(Btn, { label: t('retry'), kind: 'refresh', out: 'retry' })),
          h(Result, { k: 'retry' })))
      }

      const extra = manual ? [h(Card, { key: 'manual', title: (manual.name || t('sync.openManual')), level: 'pass' },
        h('div', { style: S.row },
          h(Btn, { label: t('clear'), kind: 'clearManual', out: 'manualClose' })),
        h('pre', { style: { ...S.pre, maxHeight: '60vh' } }, manual.text || t('empty.output')))] : []

      return shell(...body, ...extra)
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
