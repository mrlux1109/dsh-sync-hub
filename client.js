/**
 * dsh-sync-hub v2.0 —— 浏览器半身：侧栏入口 + 六页同步中枢面板。
 *
 * 与旧版（v0.11.0 bat 演化版）的本质区别：
 *   旧版 = 设置页里的 8 Tab 应用（settings.section，inject 为空，手写组件/字典/fetch）；
 *   本版 = 标准 DSH 客户端插件：
 *     · manifest 声明 dsh.client.inject 拿官方模块（locale/slots/primitives/layout）；
 *     · 侧栏入口走官方 `sidebar.panellist` 插槽（与插件管理器、任务管理器同级）；
 *     · 内容区走官方 `main` keyed 插槽（key = 'sync-hub'，不抢内置 'conversation'）；
 *     · 组件全部用官方 primitives；文案走 ctx.locale 扁平键；
 *     · 数据走宿主半身 `/api/sync-hub`（自带信任围栏），**不再手拼 PowerShell**。
 *
 * 契约铁律（memory 4.17⑦ 实锤，违反即整包黑屏）：
 *   1. factory **必须 return module.exports**，返回 module 本体 = 同 bundle 连坐黑屏；
 *   2. 组件辅助函数收多个子元素用 rest 参数 `(t, key, ...kids)`；
 *   3. 不抢内置插槽 key；注册前 slots.entries 探一次，撞名 fail-fast；
 *   4. 文案只用扁平键（ctx.locale.bind 不解析 'a.b' 嵌套键）；
 *   5. 动作反馈一律就地（memory 4.20），禁止把唯一输出面板放页面最底部。
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
    /** 浏览器半身依赖的服务（对应 manifest dsh.client.inject 的四个包）。 */
    const inject = ['slots', 'locale', 'layout']

    /** 四个一级页（v2.2 D3：6 平铺页 → 状态/内容/知识库/设置）。 */
    const PAGES = [
      { id: 'status', labelKey: 'page.status' },
      { id: 'sync', labelKey: 'page.sync' },
      { id: 'content', labelKey: 'page.content' },
      { id: 'knowledge', labelKey: 'page.knowledge' },
      { id: 'settings', labelKey: 'page.settings' },
    ]

    /** 扁平键文案表：zh 为真相源，en 必须同键集。 */
    const ZH = {
      'panel': '同步中枢',
      'page.status': '📊 状态',
      'page.sync': '🔄 同步',
      'page.content': '📁 内容',
      'page.knowledge': '📚 知识库',
      'page.settings': '⚙️ 设置',
      // 内容页二级 Tab（沿用旧页名，改名会丢已有中文语义）
      'page.memory': '🧠 记忆·配置',
      'page.skills': '🛠 技能',
      'page.plugins': '🔌 插件',
      'page.sessionsArchive': '💬 会话归档',
      // v2.5 批2：内容页语义常驻说明（歧义说清楚，不等来问）
      'content.scopeLine': '· 这里管的是【中枢仓库】与【本机加载目录】两个地方，根名已标清（中枢 xx = 会随上传传播；本机 xx = 只影响这台机器）。',
      'content.deleteLine': '· 删除不是真删：一律先移进中枢 backups/ 留底可反悔；「删中枢」≠「卸本机」，且拉取永远不删两台已装的内容。',
      // ── v2.5 批2：文件管理器（内容页可管） ──
      'fm.root.hub/memory': '🧠 中枢记忆',
      'fm.root.hub/skills': '🎯 中枢技能',
      'fm.root.hub/config': '⚙️ 中枢配置',
      'fm.root.hub/plugins': '📦 插件源码',
      'fm.root.hub/session-backup': '💬 会话归档',
      'fm.root.local/skills': '🖥 本机技能',
      'fm.open': '进入',
      'fm.edit': '编辑',
      'fm.save': '保存',
      'fm.cancel': '取消',
      'fm.up': '← 上一级',
      'fm.empty': '（空目录）',
      'fm.delete': '删除',
      'fm.confirmYes': '确认删除',
      'fm.confirmNo': '取消',
      'fm.saved': '已保存 {n}（旧版已留底）',
      'fm.oldKept': '旧版在：{p}',
      'fm.foot': '删除不是真删：一律先移进中枢 backups/ 留底，可反悔。拉取永远不删本机已装内容。',
      'fm.pluginsTitle': '插件区（清单 + 源码）',
      'fm.pluginsHint': 'plugin.txt = 该装哪些插件的清单（两台共用）；plugins/ = 插件源码目录。安装/卸载本体走官方 设置→插件。',
      'fm.sessionsTitle': '会话归档管理（中枢里的跨机归档）',
      'fm.sessionsHint': '按机器 → 工作区浏览；过期归档可删（只删中枢副本，本机正在用的会话不在这，不受影响）。',
      'fm.skillsTitle': '技能目录管理（中枢技能库 / 本机已装）',
      'fm.skillsHint': '中枢技能 = 上传备份后两台都拿得到；本机技能 = DSH 实际加载处。删本机只卸这台，删中枢两机下次拉取不再补。',
      'loading': '读取中…',
      'error': '加载失败：{e}',
      'retry': '重试',
      'refresh': '刷新',
      'todo.placeholder': '（本页施工中）',

      // 全局状态条
      'bar.identity': '身份',
      'bar.ahead': '待推送',
      'bar.behind': '待拉取',
      'bar.dirty': '未提交',
      'bar.credential': '凭据',
      'bar.schedule': '定时',
      'bar.on': '开',
      'bar.off': '关',
      'bar.ok': '正常',
      'bar.missing': '缺失',

      // 总览
      'ov.todo': '接下来做什么',
      'ov.todo.empty': '一切就绪，没有待办。',
      'ov.todo.commit': '有 {n} 个改动没提交，另一台电脑收不到',
      'ov.todo.behind': '远端领先 {n} 个提交，建议先拉取',
      'ov.todo.credential': 'Gitee 凭据没配，推拉都会失败',
      'ov.todo.core': '缺必需工具：{list}，同步会受影响',
      'ov.hub': '中枢',
      'ov.version': '版本',
      'ov.branch': '分支',
      'ov.lastCommit': '最近提交',
      'ov.skills': '技能',
      'ov.machines': '机器档案',
      'ov.tools': '工具链',
      'ov.machine': '本机',
      'ov.dshHome': 'DSH 目录',
      'ov.recent': '最近动态',
      'ov.noRecent': '（没有提交记录）',
      'ov.goSync': '去同步页处理',

      // 健康分（N4）与机器看板（N5）
      'ov.health': '健康分',
      'ov.board': '机器看板',
      'ov.noBoard': '（没有机器档案）',
      'ov.boardNever': '未见同步记录',

      // 首次运行引导（onboarding）
      'ob.title': '欢迎使用同步中枢',
      'ob.subtitle': '先把「中枢仓库」（两台电脑之间同步记忆/技能/配置的 git 仓库）指给插件。指好之后，这里会变成同步面板。',
      'ob.checking': '检测中…',
      'ob.credOk': '凭据已配置（{user}）',
      'ob.credMissing': 'Gitee 凭据未配置（克隆私有仓库前需要）',
      'ob.credHint': '凭据配置方法：在普通终端手动 git clone 一次你的私有中枢，凭据管理器会弹出 Gitee 登录窗口；令牌在 gitee.com → 设置 → 私人令牌（勾 projects）。令牌只进 Windows 凭据管理器，不经过本插件。',
      'ob.pathLabel': '中枢仓库的完整路径（已克隆过）或想克隆到的位置',
      'ob.pathPlaceholder': '例如 D:\\AI\\sync-hub',
      'ob.useExisting': '使用这个目录',
      'ob.clone': '克隆中枢到这个目录',
      'ob.needGit': '先安装 Git for Windows',
      'ob.saved': '路径已保存，面板已就绪。',
      'ob.savedButIncomplete': '路径已记住：{p}。该目录还不是完整中枢（缺 VERSION 或 tools/），功能会部分降级，等你补齐后自动恢复。',
      'ob.cloned': '克隆完成：{p}。面板已就绪。',
      'ob.explain': '判定标准：目录里有 VERSION 和 tools/ 两个条目即视为中枢。默认仓库地址是作者的 Gitee 模板，可在克隆时换成你自己的私有仓库地址（在输入框填目标目录，克隆动作会用默认地址；私有仓库请先用终端 git clone 一次建立凭据，再点「使用这个目录」）。',

      // 记忆·配置页（白名单编辑器）
      'mm.title': '记忆·配置（云端白名单编辑）',
      'mm.hint': '左侧是中枢里可编辑的白名单文件。保存 = 写中枢 + 本地提交（不自动推送）；JSON 先校验语法；旧版本自动归档；另一台改过同一文件会拒绝保存并提示先拉取。',
      'mm.search': '搜索文件名…',
      'mm.pick': '从左侧选一个文件开始编辑。',
      'mm.close': '关闭此标签',
      'mm.save': '保存',
      'mm.saved': '已保存 {p}',
      'mm.archived': '旧版本已归档：{n}',
      'mm.staleHint': '处理方法：到「同步」页拉取最新内容，再回到本页重新打开该文件编辑。',
      'mm.saveNote': '保存只提交到本地中枢仓库；要让另一台收到，请到「同步」页推送。',

      // 长动作运行器（v2.0.5）
      'job.running': '执行中…',
      'job.took': '用时 {t}',
      'job.dismiss': '收起',

      // N2 时间线 / N7 自动推送
      'tl.expand': '完整时间线',
      'tl.collapse': '收起时间线',
      'tl.allMachines': '全部机器',
      'tl.noRows': '（没有匹配的提交）',
      'tl.files': '文件',
      'ap.title': '自动推送',
      'ap.hint': '开启后：记忆·配置页保存成功会立即 push 到云端（同步页的推送不受影响，那里本来就会推送）。默认关，防止把半成品推给另一台。',
      'ap.on': '已开启：记忆页保存后自动推送',
      'ap.off': '已关闭：保存只提交本地，推送去「同步」页',
      'ap.turnOn': '开启',
      'ap.turnOff': '关闭',

      // v2.0.6 一键流先拉后推 + 审计回补
      'flow.roundtrip': '完整同步一轮（先拉后推）',
      'flow.roundtripTip': '先拉取另一台的改动并应用，再把本机改动推上去。换机后或久未同步时用。',
      'flow.confirmRoundtrip': '确认执行「完整同步一轮」？将先拉取并应用（撞车会停下来进入冲突解决器），成功后自动推送你选的 {n} 类范围。',

      // 同步
      'sync.scope': '上传范围',
      // ── v2.4 操作卡整合（三卡 → 一卡；范围全中文；增量语义上界面） ──
      'sync.opTitle': '同步操作',
      'sync.opHint': '日常只需点蓝色「开始一键同步」；下面小按钮是手动挡，不常用。',
      'sync.incr1': '· 上传备份 = 只传本机【新改动的部分】，不会覆盖对方没碰的文件；内容少的一方上传，多的那边原样保留。',
      'sync.incr2': '· 注意：手动删掉中枢里的文件也算"改动"，会跟着传上去。清理请两边商量着来，别手滑。',
      'scope.memory': '🧠 记忆',
      'scope.skills': '🎯 技能',
      'scope.config': '⚙️ 配置',
      'scope.sessions': '💬 会话归档',
      'scope.dshconfig': '🛰 DSH 运行配置',
      'scope.plugins': '🔌 插件清单',
      'scope.pluginsrc': '📦 插件源码',
      'scope.memory.tip': '专业术语 memory/ —— 共享记忆 shared.md + 各机器档案',
      'scope.skills.tip': '专业术语 skills/ —— 中枢技能库（apply 只补缺失，不覆盖同名）',
      'scope.config.tip': '专业术语 config/ —— DSH profile 模板与 git 全局配置',
      'scope.sessions.tip': '专业术语 session-backup/ —— 本机会话的单向归档（凭据类文件被硬守卫绝对排除）',
      'scope.dshconfig.tip': '专业术语 config/dshconfig/ —— DSH 运行配置',
      'scope.plugins.tip': '专业术语 config/plugin.txt —— 该装哪些插件的清单',
      'scope.pluginsrc.tip': '专业术语 plugins/ —— 插件源码（如 dsh-our-free-model）',
      'flow.startTip': '自动跑完：预览变化 → 你确认 → 提交 → 上传备份，一条龙',
      'sync.all': '全部',
      'sync.none': '全不选',
      // ── 飞牛叫法（D2）：主文案用飞牛叫法，专业术语小字备注 ──
      'sync.push': '📤 上传备份',
      'sync.pull': '📥 下载恢复',
      'sync.preview': '👁 预览变化',
      'sync.conflicts': '查看冲突',
      'sync.previewTitle': '预览结果',
      'sync.previewEmpty': '所选范围内没有可上传的改动。',
      'sync.files': '{n} 个文件 · {size}',
      'sync.confirmPush': '确认推送这 {n} 个文件？',
      'sync.hint.pull': '拉取会应用到本机；若撞车，冲突解决器会引导你逐文件处理。',

      // N6 一键同步流
      'flow.start': '开始一键同步',
      'flow.picked': '已选 {n} 类',
      'flow.confirm': '确认推送',
      'flow.done': '已推送 {n} 个文件（{commit}）',
      'flow.restartHint': '涉及记忆 / 插件的改动，重启 DSH 后完整生效。',
      'flow.again': '再来一次',
      'sync.msg.pushed': '已上传 {n} 个文件（{commit}）',
      // v2.3.2：拉取回执展示 apply 到本机的真实结果（对齐 BAT 版 pull→apply）
      'sync.pullCommit': '中枢已拉取（{commit}）',
      'sync.pullAgents': 'AGENTS.md 已重建（{bytes}）',
      'sync.pullAgentsFail': 'AGENTS.md 重建失败：{e}',
      'sync.pullSkills': '技能新增 {n} 个',
      'sync.pullNoId': '本机还没设机器身份，AGENTS.md 没重建',
      'sync.pullRestart': '重启 DSH 后完整生效；本机会话不会被覆盖。',
      // 专业备注（D2）：飞牛叫法看不懂时的小字解释
      'sync.term.push': '专业术语：push / 推送 —— 把本机内容提交并上传到云端中枢',
      'sync.term.pull': '专业术语：pull / 拉取 —— 从云端中枢取回内容到本机',
      'sync.term.preview': '专业术语：dry-run / 预演 —— 只看不传，确认将发生什么',
      'sync.msg.noConflict': '当前没有冲突。',

      // 维护
      'mt.backup': '本机备份快照',
      'mt.backupHint': '改动 AGENTS.md / 插件配置前的撤销点。只存本机，不上云。',
      'mt.backupNow': '立即备份',
      'mt.backups': '历史快照',
      'mt.backupsEmpty': '（还没有备份）',
      'mt.restore': '恢复',
      'mt.delete': '删除',
      'mt.msg.backed': '已创建 {n} 份快照',
      'mt.msg.restored': '已恢复 {name}',
      'mt.msg.preRestore': '原文件已另存为 {name}',
      'mt.msg.deleted': '已删除 {name}',
      'mt.msg.restoreFail': '恢复失败：{e}',
      'mt.tools': '工具链体检',
      'mt.toolsHint': '必需 / 开发 / 可选三档。缺失只报告，不自动装。',
      'mt.core': '必需',
      'mt.toolsAll': '全部就位',
      'mt.toolsMissing': '缺 {n} 个：{list}',
      'mt.schedule': '定时同步',
      'mt.scheduleHint': 'Windows 任务计划：登录时 + 每天 03:00 自动跑「状态 → 拉取 → 推送」。',
      'mt.scheduleOn': '已开启',
      'mt.scheduleOff': '未开启',
      'mt.scheduleInstall': '开启定时同步',
      'mt.scheduleRemove': '关闭定时同步',
      'mt.scheduleNext': '下次运行：{t}',
      'mt.msg.scheduleOn': '定时任务已创建',
      'mt.msg.scheduleOff': '定时任务已删除',
      'mt.credential': 'Gitee 凭据',
      'mt.credentialOk': '已在 Windows 凭据管理器中（{user}）',
      'mt.credentialMissing': '未配置。请在「打开控制台」里人工登录，令牌不经过本插件。',
      'mt.portable': '换机补齐',
      'mt.portableHint': '新机器 pull 之后：按中枢清单现场拉自研插件源码 + 写 link + 挂 bundles。',
      'mt.portableRun': '执行补齐（预演）',
      'mt.console': '打开控制台',
      'mt.manual': '打开使用手册',
      'mt.consoleHint': '换机器身份（要手输 YES）、全自动一条龙、冲突人工处理——这些必须人工确认的流程走 .bat 窗口。',
      'mt.log': '运行日志',
      'mt.logPath': '路径：{p}',
      'mt.pluginUpdate': '插件更新',
      'mt.pluginUpdateHint': '检查 dsh-sync-hub 插件是否有新版本。',
      'mt.pluginCheck': '检查更新',
      'mt.pluginChecking': '检查中…（正在连 GitHub）',
      'mt.pluginUpToDate': '已是最新（{v}），无需更新。',
      'mt.pluginVersion': '版本',
      'mt.pluginNotChecked': '未检查',
      'mt.pluginUpdateAvailable': '有新版本可用，建议更新。',
      // ── v2.4.1 一键更新落地 ──
      'mt.pluginApply': '立即更新',
      'mt.pluginApplyTip': '自动完成：拉取新版 → 备份现有安装 → 整套拷入 → 回读校验；任何一步失败自动回滚，不会留下半套。',
      'mt.pluginApplied': '已更新到 {v}（回读校验通过）。',
      'mt.pluginRestart': '重启 DSH 后新版本生效。',
      'mt.pluginBackup': '旧版已留底：{p}',

      // ── S3/S4：缺失工作区（"未分组"的真正解药） ──
      'se.missingTitle': '⚠ {n} 个工作区本机不存在（会话会显示为「未分组」）',
      'se.missingHint': 'DSH 按目录是否存在给会话归组，与里面有没有文件无关。所以建个空目录就能正确归组——不必用飞牛同步整个项目。',
      'se.missingMeta': '{m} · {n} 个会话',
      'se.missingMore': '…另有 {n} 个未显示',
      'se.missingHow': '两种办法：A 点右边「一键创建空目录」立刻归组；B 项目代码用飞牛同步到同路径（中枢不管项目代码），需要哪个同步哪个。',
      'se.mkdir': '📁 一键创建空目录',
      'se.mkdirCreated': '【结论】已创建 {n} 个空目录，会话将正确归组。',
      'se.mkdirExisted': '已存在 {n} 个（跳过）。',
      'se.mkdirFailed': '{n} 个创建失败（通常是权限不足），详见下方失败项。',
      'se.mkdirHint': '【细节】只建了空目录，没有下载任何会话。想看内容请用飞牛同步项目代码。',

      // ── 🏠 本机角色（v2.2 S5） ──
      'mt.role.title': '本机角色（这台机器以谁为准）',
      'mt.role.hint': '存进中枢、两台机器互相可见。改了角色记得「上传备份」同步给对方。默认主机。',
      'mt.role.host': '主机',
      'mt.role.hostDesc': '以这台为准：日常只「上传备份」归档；「下载恢复」慎用，防止旧内容盖新内容。',
      'mt.role.follower': '副机',
      'mt.role.followerDesc': '以主机为准：日常「下载恢复」拿最新；想上传前先「预览变化」。',
      'mt.role.both': '双向',
      'mt.role.bothDesc': '两边对等随用随传；撞车靠冲突解决器人工裁决。',
      'mt.role.current': '（当前）',

      // ── 💬 会话归档语义（v2.2 D1：单向归档，不是双向同步） ──
      'se.archiveTitle': '会话归档说明（单向，不是双向同步）',
      'se.archiveLine1': '· 每台机器各自备份：上传备份 = 把本机会话存一份到云端归档（不是"同步"，不会来回覆盖）。',
      'se.archiveLine2': '· 恢复只读：下载恢复 = 把另一台机的会话副本恢复到本机，本机已有的会话永远不会被覆盖（跳过已有）。',
      'se.archiveLine3': '· 项目文件不走这里：会话只归档对话记录，项目代码请用飞牛同步；且会话按工作区目录归组，目录不存在才会显示未分组。',

      // ── 📚 知识库页（v2.2 D5：IMA 为主） ──
      'kb.title': '知识库（IMA）',
      'kb.hint': '手机投喂 → 腾讯云端知识库 → 电脑随时问。dsh-ima-copilot 已在两台机器装好。',
      'kb.installed': 'IMA Copilot 插件已装（dsh-ima-copilot），我可以直接替你查知识库',
      'kb.divide': '分工：IMA 管「随手投喂 + 随时问答」；中枢管「结构化长期记忆」（记忆/技能/配置）。项目代码不入中枢，跨机走飞牛同步。',
      'kb.askPlaceholder': '想问知识库里的什么？例如「上次那份报价单怎么写的」',
      'kb.ask': '问一下',
      'kb.askViaModel': '在对话里直接问我即可，我会调用知识库检索后回答。',
      'kb.setup': '首次配置（一次性，约 5 分钟）',
      'kb.setupHint': '插件已装但缺 3 个凭据，配一次就能查。位置：DSH 设置 → 插件 → 可配置 → IMA Copilot',
      'kb.step1': '浏览器登录 ima.qq.com',
      'kb.step1Body': '打开腾讯 IMA 网页版并登录（和手机 App 同一个账号）。',
      'kb.step2': 'F12 抓两个值',
      'kb.step2Body': '开发者工具 → Network → 随便点一个请求 → 复制 IMA_X_IMA_COOKIE 与 IMA_X_IMA_BKN。',
      'kb.step3': '填知识库 id 并保存',
      'kb.step3Body': '点进你的知识库，URL 里那串 id 填入 IMA_KNOWLEDGE_BASE_IDS，保存后重启 DSH。',
      'kb.mobile': '手机投喂',
      'kb.mobileHint': '装 IMA App，随手就能存',
      'kb.mobile1': '· 拍照扫描纸质文件 / 合同',
      'kb.mobile2': '· 微信文章一键转存',
      'kb.mobile3': '· 上传 PDF、表格、课件',
      'kb.split': '中枢不重复建设',
      'kb.splitHint': '为什么不用 TiddlyWiki 当主库',
      'kb.splitBody': 'IMA 已有手机端与云端同步，体验更好；TiddlyWiki 无手机 App。中枢只保留 git 管的记忆/技能/配置，不再单独建 wiki 轨道，避免两套维护。',

      // 技能页
      'sk.summary': '同步概览',
      'sk.invalidWarn': '⚠ 以下技能目录名不合法（DSH 要求 kebab-case，会静默跳过它们，装了也不生效）',
      'sk.list': '技能对比（本机 ↔ 中枢）',
      'sk.filterAll': '全部',
      'sk.noRows': '（没有匹配的技能）',
      'sk.local': '本机',
      'sk.hub': '中枢',
      'sk.placeholder': '占位/空壳',
      'sk.scopeTitle': '能力边界',
      'sk.scopeBody': '本页只做"对比 + 分类"：哪些只在一边、哪些内容不同、哪些是空壳。导入线上技能、回收站、云端增删属写操作，按开发文档排在后续里程碑；需要时请用「打开控制台」或对话里的 sync_hub_* 工具。',

      // 会话页
      'se.local': '本机会话',
      'se.localHint': '对话记录只读拷贝进中枢；凭据类文件永不被包含（硬守卫，负例单测覆盖）。',
      'se.files': '文件',
      'se.backup': '📤 上传备份（存到中枢）',
      'se.hub': '跨机会话归档（只读浏览）',
      'se.hubHint': '按机器 → 工作区逐层展开，看另一台电脑聊过什么。全程只读，不会改回本机。',
      'se.noMachines': '（中枢里还没有任何机器的会话归档）',
      'se.restoreFrom': '📥 下载恢复到本机（{machine}）',
      'se.msg.backed': '【结论】已归档 {n} 个会话到中枢。\n【关键】新归档 {n} 个 · 跳过未变更 {skipped} 个\n【细节】G1 密钥守卫已通过：未发现凭据类文件，零外传。另一台机器不会自动拿到，需要它主动"下载恢复"。',
      'se.msg.restored': '【结论】已恢复 {n} 个会话（跳过本机已有的 {same} 个）。\n【关键】恢复 {n} 个 · 跳过已有 {same} 个 · 路径映射 {mapped} 个\n【细节】若会话显示未分组：确认该项目目录已用飞牛同步到本机（本机会话永远不会被覆盖）。',

      // 冲突解决器（N1）
      'cf.title': '拉取撞车 · 冲突解决器',
      'cf.warn': '⚠ 语义提醒：本栏「对端」是另一台电脑的版本，「本机」是你这台刚提交的版本。选错边会丢内容，请看清再选。',
      'cf.base': '共同祖先',
      'cf.remote': '对端（另一台）',
      'cf.local': '本机（这台）',
      'cf.emptyStage': '（此阶段无内容）',
      'cf.useThis': '用这段',
      'cf.editor': '解决后的内容（可手改；保存即写入工作区文件）',
      'cf.saveNext': '保存并处理下一个',
      'cf.saveLast': '保存这个文件',
      'cf.savedLast': '已保存。全部文件处理完才能收尾。',
      'cf.finish': '收尾（git add + rebase --continue）',
      'cf.finishHint': '只 add 你点名保存过的文件，绝不 add -A；仍有未解决冲突时会拒绝收尾。',
      'cf.finished': '已收尾，rebase 完成。',
    }
    const EN = {
      'panel': 'Sync Hub',
      'page.status': '📊 Status',
      'page.sync': '🔄 Sync',
      'page.content': '📁 Content',
      'page.knowledge': '📚 Knowledge',
      'page.settings': '⚙️ Settings',
      'page.memory': '🧠 Memory · Config',
      'page.skills': '🛠 Skills',
      'page.plugins': '🔌 Plugins',
      'page.sessionsArchive': '💬 Session archive',
      'content.scopeLine': '· This page manages the HUB repo and your LOCAL load folder. Root names say which: "Hub …" travels with upload backup; "Local …" only affects this machine.',
      'content.deleteLine': '· Delete is not real deletion: everything moves to hub backups/ first — undoable. "Delete from hub" ≠ "uninstall locally", and pulling never removes installed content on either machine.',
      'fm.root.hub/memory': '🧠 Hub memory',
      'fm.root.hub/skills': '🎯 Hub skills',
      'fm.root.hub/config': '⚙️ Hub config',
      'fm.root.hub/plugins': '📦 Plugin source',
      'fm.root.hub/session-backup': '💬 Session archive',
      'fm.root.local/skills': '🖥 Local skills',
      'fm.open': 'Open',
      'fm.edit': 'Edit',
      'fm.save': 'Save',
      'fm.cancel': 'Cancel',
      'fm.up': '← Up',
      'fm.empty': '(empty folder)',
      'fm.delete': 'Delete',
      'fm.confirmYes': 'Confirm',
      'fm.confirmNo': 'Cancel',
      'fm.saved': 'Saved {n} (old version kept)',
      'fm.oldKept': 'Old version at: {p}',
      'fm.foot': 'Delete is not real deletion: everything moves to hub backups/ first — undoable. Pulling never removes local installed content.',
      'fm.pluginsTitle': 'Plugins (list + source)',
      'fm.pluginsHint': 'plugin.txt = which plugins to install (shared); plugins/ = plugin source. Install/uninstall itself goes through Settings → Plugins.',
      'fm.sessionsTitle': 'Session archive manager (in the hub)',
      'fm.sessionsHint': 'Browse by machine → workspace; stale archives can be deleted (hub copy only — your live local sessions are untouched).',
      'fm.skillsTitle': 'Skill folders (hub library / local install)',
      'fm.skillsHint': 'Hub skills: both machines get them after upload backup. Local skills: what DSH actually loads here. Delete local = uninstall here only; delete hub = no longer added on next pull.',
      'loading': 'Loading…',
      'error': 'Load failed: {e}',
      'retry': 'Retry',
      'refresh': 'Refresh',
      'todo.placeholder': '(under construction)',
      'bar.identity': 'Identity',
      'bar.ahead': 'Ahead',
      'bar.behind': 'Behind',
      'bar.dirty': 'Uncommitted',
      'bar.credential': 'Credential',
      'bar.schedule': 'Schedule',
      'bar.on': 'on',
      'bar.off': 'off',
      'bar.ok': 'ok',
      'bar.missing': 'missing',
      'ov.todo': 'Next steps',
      'ov.todo.empty': 'All clear, nothing to do.',
      'ov.todo.commit': '{n} uncommitted change(s) — the other machine cannot see them yet',
      'ov.todo.behind': 'Remote is ahead by {n} commit(s) — pull first',
      'ov.todo.credential': 'Gitee credential missing — push/pull will fail',
      'ov.todo.core': 'Missing core tools: {list}',
      'ov.hub': 'Hub',
      'ov.version': 'Version',
      'ov.branch': 'Branch',
      'ov.lastCommit': 'Last commit',
      'ov.skills': 'Skills',
      'ov.machines': 'Machines',
      'ov.tools': 'Toolchain',
      'ov.machine': 'Machine',
      'ov.dshHome': 'DSH home',
      'ov.recent': 'Recent activity',
      'ov.noRecent': '(no commits)',
      'ov.goSync': 'Open Sync',

      // Health score (N4) & machine board (N5)
      'ov.health': 'Health',
      'ov.board': 'Machines',
      'ov.noBoard': '(no machine profiles)',
      'ov.boardNever': 'no sync seen',

      // Onboarding
      'ob.title': 'Welcome to Sync Hub',
      'ob.subtitle': 'Point the plugin at your "hub repository" — the git repo that syncs memory / skills / config between your machines. Once set, this becomes the sync panel.',
      'ob.checking': 'checking…',
      'ob.credOk': 'Credential configured ({user})',
      'ob.credMissing': 'Gitee credential missing (needed before cloning a private repo)',
      'ob.credHint': 'To set up credentials: git clone your private hub once in a normal terminal — the credential manager will pop the Gitee login. Token: gitee.com → Settings → Private tokens (check projects). Tokens only ever live in Windows Credential Manager, never in this plugin.',
      'ob.pathLabel': 'Full path of your hub repository (already cloned) or where to clone it',
      'ob.pathPlaceholder': 'e.g. D:\\AI\\sync-hub',
      'ob.useExisting': 'Use this directory',
      'ob.clone': 'Clone hub into this directory',
      'ob.needGit': 'Install Git for Windows first',
      'ob.saved': 'Path saved — panel is ready.',
      'ob.savedButIncomplete': 'Path remembered: {p}. That directory is not a complete hub yet (missing VERSION or tools/) — features degrade until you fill it in.',
      'ob.cloned': 'Cloned: {p}. Panel is ready.',
      'ob.explain': 'A directory counts as a hub when it contains VERSION and tools/. The default clone address is the author\'s Gitee template; for your own private repo, git clone once in a terminal to establish credentials, then click "Use this directory".',

      // Memory · Config page (whitelist editor)
      'mm.title': 'Memory · Config (whitelist editing)',
      'mm.hint': 'Left: whitelist files editable in the hub. Save = write hub + local commit (no auto push); JSON is syntax-checked first; the previous version is archived; saving is refused when the other machine changed the file (pull first).',
      'mm.search': 'Search files…',
      'mm.pick': 'Pick a file on the left to start editing.',
      'mm.close': 'Close tab',
      'mm.save': 'Save',
      'mm.saved': 'Saved {p}',
      'mm.archived': 'Previous version archived: {n}',
      'mm.staleHint': 'Fix: pull the latest on the Sync page, then reopen the file here.',
      'mm.saveNote': 'Saving commits to your local hub only; push from the Sync page for the other machine to receive it.',

      // Job runner (v2.0.5)
      'job.running': 'working…',
      'job.took': 'took {t}',
      'job.dismiss': 'dismiss',

      // N2 timeline / N7 auto-push
      'tl.expand': 'Full timeline',
      'tl.collapse': 'Collapse',
      'tl.allMachines': 'All machines',
      'tl.noRows': '(no matching commits)',
      'tl.files': 'files',
      'ap.title': 'Auto-push',
      'ap.hint': 'When on, a successful save on the Memory · Config page pushes to the cloud immediately (the Sync page push is unaffected). Off by default so half-finished work stays local.',
      'ap.on': 'On: saving on Memory · Config auto-pushes',
      'ap.off': 'Off: saves stay local; push from the Sync page',
      'ap.turnOn': 'Enable',
      'ap.turnOff': 'Disable',

      // v2.0.6 roundtrip flow
      'flow.roundtrip': 'Full round trip (pull then push)',
      'flow.roundtripTip': 'Pull and apply the other machine\'s changes first, then push yours. Use after switching machines or a long gap.',
      'flow.confirmRoundtrip': 'Run a full round trip? Pulls and applies first (stops at conflicts into the resolver), then pushes your {n} selected categories.',
      'sync.scope': 'Upload scope',
      'sync.opTitle': 'Sync actions',
      'sync.opHint': 'Daily use = the blue "Start one-shot sync" only. The small buttons below are manual mode.',
      'sync.incr1': '· Upload backup sends only what THIS machine changed — it never overwrites files the other side did not touch; the machine with less content uploading keeps the other\'s content intact.',
      'sync.incr2': '· Heads-up: manually deleting a file in the hub folder also counts as a change and will propagate. Coordinate cleanups; do not delete casually.',
      'scope.memory': '🧠 Memory',
      'scope.skills': '🎯 Skills',
      'scope.config': '⚙️ Config',
      'scope.sessions': '💬 Session archive',
      'scope.dshconfig': '🛰 DSH runtime config',
      'scope.plugins': '🔌 Plugin list',
      'scope.pluginsrc': '📦 Plugin source',
      'scope.memory.tip': 'memory/ — shared memory + per-machine profiles',
      'scope.skills.tip': 'skills/ — hub skill library (apply adds missing only, never overwrites)',
      'scope.config.tip': 'config/ — DSH profile templates and global git config',
      'scope.sessions.tip': 'session-backup/ — one-way archive of this machine\'s sessions (credentials hard-excluded)',
      'scope.dshconfig.tip': 'config/dshconfig/ — DSH runtime configuration',
      'scope.plugins.tip': 'config/plugin.txt — which plugins to install',
      'scope.pluginsrc.tip': 'plugins/ — plugin source code (e.g. dsh-our-free-model)',
      'flow.startTip': 'Runs it all: preview → you confirm → commit → upload backup',
      'sync.all': 'All',
      'sync.none': 'None',
      'sync.push': '📤 Upload backup',
      'sync.pull': '📥 Download & restore',
      'sync.preview': '👁 Preview changes',
      'sync.conflicts': 'Conflicts',
      'sync.previewTitle': 'Preview result',
      'sync.previewEmpty': 'Nothing to upload in the selected scope.',
      'sync.files': '{n} file(s) · {size}',
      'sync.confirmPush': 'Push these {n} files?',
      'sync.hint.pull': 'Pull applies locally; on conflict the resolver walks you through it.',

      // N6 one-shot sync flow
      'flow.start': 'Start one-shot sync',
      'flow.picked': '{n} categories selected',
      'flow.confirm': 'Confirm push',
      'flow.done': 'Pushed {n} file(s) ({commit})',
      'flow.restartHint': 'Memory / plugin changes take full effect after restarting DSH.',
      'flow.again': 'Run again',
      'sync.msg.pushed': 'Uploaded {n} file(s) ({commit})',
      'sync.pullCommit': 'Hub pulled ({commit})',
      'sync.pullAgents': 'AGENTS.md rebuilt ({bytes})',
      'sync.pullAgentsFail': 'AGENTS.md rebuild failed: {e}',
      'sync.pullSkills': '{n} skill(s) added',
      'sync.pullNoId': 'No machine identity set yet — AGENTS.md not rebuilt',
      'sync.pullRestart': 'Full effect after restarting DSH; existing local sessions are never overwritten.',
      'sync.term.push': 'Terminology: push — commit this machine\'s content and upload it to the cloud hub',
      'sync.term.pull': 'Terminology: pull — fetch content from the cloud hub back to this machine',
      'sync.term.preview': 'Terminology: dry-run — look without uploading, to confirm what will happen',
      'sync.msg.noConflict': 'No conflicts.',
      'mt.backup': 'Local snapshots',
      'mt.backupHint': 'Undo points before touching AGENTS.md / plugin config. Local only.',
      'mt.backupNow': 'Back up now',
      'mt.backups': 'Snapshots',
      'mt.backupsEmpty': '(no snapshots yet)',
      'mt.restore': 'Restore',
      'mt.delete': 'Delete',
      'mt.msg.backed': 'Created {n} snapshot(s)',
      'mt.msg.restored': 'Restored {name}',
      'mt.msg.preRestore': 'Previous file saved as {name}',
      'mt.msg.deleted': 'Deleted {name}',
      'mt.msg.restoreFail': 'Restore failed: {e}',
      'mt.tools': 'Toolchain',
      'mt.toolsHint': 'core / dev / nice. Missing tools are reported, never auto-installed.',
      'mt.core': 'core',
      'mt.toolsAll': 'All present',
      'mt.toolsMissing': 'Missing {n}: {list}',
      'mt.schedule': 'Scheduled sync',
      'mt.scheduleHint': 'Windows Task Scheduler: logon + daily 03:00, runs status → pull → push.',
      'mt.scheduleOn': 'Enabled',
      'mt.scheduleOff': 'Disabled',
      'mt.scheduleInstall': 'Enable',
      'mt.scheduleRemove': 'Disable',
      'mt.scheduleNext': 'Next run: {t}',
      'mt.msg.scheduleOn': 'Scheduled task created',
      'mt.msg.scheduleOff': 'Scheduled task removed',
      'mt.credential': 'Gitee credential',
      'mt.credentialOk': 'Stored in Windows Credential Manager ({user})',
      'mt.credentialMissing': 'Not configured. Log in from the console — tokens never pass through this plugin.',
      'mt.portable': 'Portable setup',
      'mt.portableHint': 'After a new machine pulls: clone self-built plugin sources, write links, mount bundles.',
      'mt.portableRun': 'Run setup (dry run)',
      'mt.console': 'Open console',
      'mt.manual': 'Open manual',
      'mt.consoleHint': 'Identity switch (typed YES), one-shot bootstrap, manual conflict handling.',
      'mt.log': 'Logs',
      'mt.logPath': 'Path: {p}',
      'mt.pluginUpdate': 'Plugin update',
      'mt.pluginUpdateHint': 'Check if dsh-sync-hub plugin has a new version.',
      'mt.pluginCheck': 'Check for updates',
      'mt.pluginChecking': 'Checking… (connecting to GitHub)',
      'mt.pluginUpToDate': 'Up to date ({v}) — nothing to update.',
      'mt.pluginVersion': 'Version',
      'mt.pluginNotChecked': 'Not checked',
      'mt.pluginUpdateAvailable': 'A new version is available. Consider updating.',
      'mt.pluginApply': 'Update now',
      'mt.pluginApplyTip': 'Runs it all: fetch new version → back up current install → copy the full set in → verify by re-reading; any failure auto-rolls back, never leaves a half install.',
      'mt.pluginApplied': 'Updated to {v} (verification passed).',
      'mt.pluginRestart': 'Restart DSH to run the new version.',
      'mt.pluginBackup': 'Previous version kept at: {p}',

      // ── S3/S4: missing workspaces (the real fix for "ungrouped") ──
      'se.missingTitle': '⚠ {n} workspace(s) do not exist here (sessions show as ungrouped)',
      'se.missingHint': 'DSH groups sessions by whether the folder exists — not by its contents. So an empty folder is enough; you do not need to sync the whole project.',
      'se.missingMeta': '{m} · {n} sessions',
      'se.missingMore': '…and {n} more not shown',
      'se.missingHow': 'Two options: A click "create empty folders" to group them now; B sync the project code via fnOS to the same path (the hub does not carry project code) — sync only what you need.',
      'se.mkdir': '📁 Create empty folders',
      'se.mkdirCreated': '[Verdict] Created {n} empty folder(s); sessions will group correctly.',
      'se.mkdirExisted': '{n} already existed (skipped).',
      'se.mkdirFailed': '{n} failed (usually permissions).',
      'se.mkdirHint': '[Detail] Only empty folders were created; no session was downloaded. Use fnOS to sync project code.',

      // ── 💬 Session archive semantics (v2.2 D1: one-way archive) ──
      'se.archiveTitle': 'About session archiving (one-way, not two-way sync)',
      'se.archiveLine1': '· Each machine backs up on its own: upload = save a copy of this machine\'s sessions to the cloud archive (it never overwrites back and forth).',
      'se.archiveLine2': '· Restore is read-only: download = copy another machine\'s sessions here; sessions already on this machine are never overwritten (existing ones are skipped).',
      'se.archiveLine3': '· Project files do not travel here: only chat records are archived. Sync project code with fnOS; sessions are grouped by workspace folder, so a missing folder shows as ungrouped.',

      // ── 📚 Knowledge page (v2.2 D5: IMA-first) ──
      'kb.title': 'Knowledge base (IMA)',
      'kb.hint': 'Phone upload → Tencent cloud KB → ask from PC. dsh-ima-copilot is installed on both machines.',
      'kb.installed': 'IMA Copilot plugin installed (dsh-ima-copilot) — I can query the knowledge base for you',
      'kb.divide': 'Split: IMA handles "capture on the go + instant Q&A"; the hub handles structured long-term memory (memory/skills/config). Project code stays out of the hub; use fnOS sync across machines.',
      'kb.askPlaceholder': 'What do you want to look up? e.g. "how was that quote written"',
      'kb.ask': 'Ask',
      'kb.askViaModel': 'Just ask me in chat — I will query the knowledge base and answer.',
      'kb.setup': 'First-time setup (one-off, ~5 min)',
      'kb.setupHint': 'The plugin is installed but 3 credentials are missing. Location: DSH Settings → Plugins → Configurable → IMA Copilot',
      'kb.step1': 'Sign in to ima.qq.com in a browser',
      'kb.step1Body': 'Open the IMA web app and sign in (same account as the phone app).',
      'kb.step2': 'Grab two values with F12',
      'kb.step2Body': 'DevTools → Network → click any request → copy IMA_X_IMA_COOKIE and IMA_X_IMA_BKN.',
      'kb.step3': 'Fill in the knowledge base id and save',
      'kb.step3Body': 'Open your knowledge base, copy the id from the URL into IMA_KNOWLEDGE_BASE_IDS, save and restart DSH.',
      'kb.mobile': 'Phone capture',
      'kb.mobileHint': 'Install the IMA app and save anything on the go',
      'kb.mobile1': '· Scan paper documents / contracts',
      'kb.mobile2': '· Save WeChat articles in one tap',
      'kb.mobile3': '· Upload PDFs, spreadsheets, slides',
      'kb.split': 'No duplicate system',
      'kb.splitHint': 'Why TiddlyWiki is not the primary store',
      'kb.splitBody': 'IMA already has a phone app and cloud sync — a better experience. TiddlyWiki has no mobile app. The hub keeps only git-managed memory/skills/config and will not build a separate wiki track.',

      // Skills page
      'sk.summary': 'Sync overview',
      'sk.invalidWarn': '⚠ These skill folder names are invalid (DSH requires kebab-case and skips them silently — installed but never loaded)',
      'sk.list': 'Skill comparison (local ↔ hub)',
      'sk.filterAll': 'All',
      'sk.noRows': '(no matching skills)',
      'sk.local': 'local',
      'sk.hub': 'hub',
      'sk.placeholder': 'placeholder',
      'sk.scopeTitle': 'Scope',
      'sk.scopeBody': 'This page only compares and classifies: which skills exist on one side only, which differ, which are empty shells. Importing, trash and cloud-side edits are write operations scheduled for later milestones; use the console or the sync_hub_* tools meanwhile.',

      // ── 🏠 Machine role (v2.2 S5) ──
      'mt.role.title': 'Machine role (who is authoritative here)',
      'mt.role.hint': 'Stored in the hub, visible to both machines. After changing it, run "upload backup" to sync. Default: host.',
      'mt.role.host': 'Host',
      'mt.role.hostDesc': 'This machine is authoritative: daily "upload backup" only; use "download & restore" carefully so old content never overwrites new.',
      'mt.role.follower': 'Follower',
      'mt.role.followerDesc': 'Follows the host: daily "download & restore"; preview changes before uploading.',
      'mt.role.both': 'Two-way',
      'mt.role.bothDesc': 'Peers, upload/download freely; conflicts are resolved manually.',
      'mt.role.current': ' (current)',

      // Sessions page
      'se.local': 'Local sessions',
      'se.localHint': 'Chat history is copied read-only into the hub; credential files are never included (hard guard, covered by negative tests).',
      'se.files': 'files',
      'se.backup': '📤 Upload backup (to hub)',
      'se.hub': 'Cross-machine session archive (read-only)',
      'se.hubHint': 'Expand by machine → workspace to browse what the other PC chatted about. Read-only; nothing is written back.',
      'se.noMachines': '(no session archives in the hub yet)',
      'se.restoreFrom': '📥 Download & restore here ({machine})',
      'se.msg.backed': '[Verdict] Archived {n} session(s) to the hub.\n[Key] Archived {n} · skipped unchanged {skipped}\n[Detail] Secret guard passed: no credential files found, zero leakage. The other machine will not get them automatically — it must run "download & restore" itself.',
      'se.msg.restored': '[Verdict] Restored {n} session(s) (skipped {same} already present here).\n[Key] Restored {n} · skipped existing {same} · path-mapped {mapped}\n[Detail] If sessions show as ungrouped: make sure that project folder was synced here via fnOS (existing local sessions are never overwritten).',

      // Conflict resolver (N1)
      'cf.title': 'Pull conflict · resolver',
      'cf.warn': '⚠ "Remote" is the other machine version, "Local" is what this machine just committed. Picking the wrong side loses content.',
      'cf.base': 'Common ancestor',
      'cf.remote': 'Remote (other machine)',
      'cf.local': 'Local (this machine)',
      'cf.emptyStage': '(no content in this stage)',
      'cf.useThis': 'Use this',
      'cf.editor': 'Resolved content (editable; saving writes it to the working tree)',
      'cf.saveNext': 'Save & next',
      'cf.saveLast': 'Save this file',
      'cf.savedLast': 'Saved. Finish only after every file is resolved.',
      'cf.finish': 'Finish (git add + rebase --continue)',
      'cf.finishHint': 'Only adds the files you named; refuses while conflicts remain.',
      'cf.finished': 'Finished — rebase complete.',
    }

    /** 简易占位符填充：'x {a} y' + {a:1} → 'x 1 y'。 */
    function fill(text, args) {
      if (typeof text !== 'string' || !args) return text
      let s = text
      for (const [k, v] of Object.entries(args)) s = s.split('{' + k + '}').join(String(v))
      return s
    }

    /** 字节数的人类可读形态。 */
    function humanBytes(n) {
      const v = Number(n) || 0
      if (v < 1024) return `${v} B`
      if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
      return `${(v / 1024 / 1024).toFixed(1)} MB`
    }

    // ─────────────────── 数据层 ───────────────────

    /** 当前语言（跟随宿主 locale）。 */
    function localeTag(ctx) {
      try {
        const snap = typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : ctx.locale?.getSnapshot?.()
        const v = snap?.active ?? ctx.locale?.locale
        return typeof v === 'string' && v.startsWith('en') ? 'en' : 'zh'
      } catch { return 'zh' }
    }

    /**
     * 造一个带 translate 的运行时（每页共用）。
     * @param {object} ctx client root context。
     * @returns {{t: Function, tag: string}}
     */
    function makeT(ctx) {
      const tag = localeTag(ctx)
      const table = tag === 'en' ? EN : ZH
      return { t: (key, args) => fill(table[key] ?? key, args), tag }
    }

    /**
     * GET 一个 API 路由。
     * @param {string} route 如 '/overview'。
     * @returns {Promise<object>}
     */
    async function apiGet(route) {
      const r = await fetch(`/api/sync-hub${route}`, { headers: { accept: 'application/json' } })
      return r.json()
    }

    /**
     * POST 一个 API 路由。
     * @param {string} route 如 '/sync'。
     * @param {object} body 请求体。
     * @returns {Promise<object>}
     */
    async function apiPost(route, body) {
      const r = await fetch(`/api/sync-hub${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      return r.json()
    }

    /** 打开控制台（宿主提供受控入口；与旧版 /console 同语义）。 */
    async function openConsole() {
      try { await apiPost('/env', { action: 'console' }) } catch { /* 控制台开不开关不住主界面 */ }
    }

    // ─────────────────── 通用小组件 ───────────────────

    /** 状态点：level = pass | warn | fail | info。 */
    function Dot({ level }) {
      const color = level === 'pass' ? 'var(--dsw-alias-status-success, #22c55e)'
        : level === 'warn' ? 'var(--dsw-alias-status-warning, #f59e0b)'
          : level === 'fail' ? 'var(--dsw-alias-status-danger, #ef4444)'
            : 'var(--dsw-alias-label-tertiary, #888)'
      return h('span', {
        'aria-hidden': true,
        style: {
          width: 8, height: 8, borderRadius: '50%',
          background: color, flex: '0 0 auto', display: 'inline-block',
        },
      })
    }

    /** 一张卡片（标题 + 子内容）。span=2 时在双列网格里占整行。 */
    function Card({ title, hint, children, right, span }) {
      return h('section', {
        style: {
          border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))',
          borderRadius: 10, padding: '12px 14px', marginBottom: 12,
          display: 'flex', flexDirection: 'column', gap: 8,
          ...(span === 2 ? { gridColumn: '1 / -1', marginBottom: 0 } : {}),
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 } },
          h('h3', { style: { margin: 0, fontSize: 14, fontWeight: 600 } }, title),
          right ?? null,
        ),
        hint ? h('p', { style: { margin: 0, fontSize: 12, opacity: 0.6, lineHeight: '18px' } }, hint) : null,
        children,
      )
    }

    /** 主按钮（就地反馈：busy 时禁用并显示转圈文案）。 */
    function ActionButton({ label, onClick, busy, tone, disabled, small, title }) {
      const bg = tone === 'primary'
        ? 'var(--dsw-alias-button-primary-bg, #2563eb)'
        : tone === 'danger'
          ? 'var(--dsw-alias-status-danger, #ef4444)'
          : 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.05))'
      const fg = tone ? '#fff' : 'inherit'
      return h('button', {
        type: 'button',
        title: title ?? undefined,
        disabled: busy || disabled,
        onClick,
        style: {
          appearance: 'none', border: 'none', cursor: (busy || disabled) ? 'default' : 'pointer',
          background: bg, color: fg,
          borderRadius: 8, fontWeight: 500,
          padding: small ? '4px 10px' : '7px 14px',
          fontSize: small ? 12 : 13,
          opacity: (busy || disabled) ? 0.6 : 1,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        },
      }, busy ? h('span', null, '…') : null, label)
    }

    /** 就地反馈条（memory 4.20：贴在被触发的控件旁）。 */
    function InlineNote({ tone, children }) {
      if (!children) return null
      const color = tone === 'error' ? 'var(--dsw-alias-status-danger, #ef4444)'
        : tone === 'success' ? 'var(--dsw-alias-status-success, #22c55e)'
          : 'var(--dsw-alias-label-secondary, #666)'
      return h('p', {
        style: {
          margin: '4px 0 0', fontSize: 12, lineHeight: '18px', color,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        },
      }, children)
    }

    /** 空态提示。 */
    function Empty({ children }) {
      return h('p', { style: { margin: '4px 0', fontSize: 12, opacity: 0.5 } }, children)
    }

    // ─────────────────── 密度组件（D4 方案 A） ───────────────────

    /**
     * 自适应网格容器：窄容器自动降列，宽容器自动多列。不写死列数。
     *
     * v2.6：默认 stretch=false —— 修复"同一行卡片被强制等高，内容多的把整行
     * 撑高、内容少的跟着一片空白"（老大 2026-10-17 实锤：最近动态内容多，
     * 同行机器看板大片空白）。false = 每张卡按自身内容高，空隙留在卡外。
     * 需要等高的场景（并排输入区等）显式传 stretch。
     * @param {object} p { min?:number, gap?:number, stretch?:boolean }
     */
    function Grid({ min = 160, gap = 8, stretch = false, children }) {
      return h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
          gap,
          marginBottom: 4,
          alignItems: stretch ? 'stretch' : 'start',
        },
      }, children)
    }

    /**
     * 指标块：短数字/短文本专用（版本、技能数、领先 N）。
     * 一屏能看十几项，不再一行占满全宽。
     * @param {object} p { label, value, level?, hint?, mono? }
     */
    function StatTile({ label, value, level, hint, mono }) {
      const color = level === 'pass' ? 'var(--dsw-alias-status-success, #22c55e)'
        : level === 'warn' ? 'var(--dsw-alias-status-warning, #f59e0b)'
          : level === 'fail' ? 'var(--dsw-alias-status-danger, #ef4444)'
            : 'var(--dsw-alias-label-primary, inherit)'
      return h('div', {
        style: {
          border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))',
          borderRadius: 10, padding: '9px 12px',
          display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
        },
      },
        h('div', {
          style: {
            fontSize: 11, opacity: 0.6, lineHeight: '16px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
        }, label),
        h('div', {
          style: {
            fontSize: 17, fontWeight: 600, lineHeight: '24px', color,
            fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
        }, String(value ?? '—')),
        hint ? h('div', { style: { fontSize: 11, opacity: 0.45, lineHeight: '15px' } }, hint) : null,
      )
    }

    // ─────────────────── 全局状态条 ───────────────────

    /**
     * 顶部常驻状态条：任何页都能看到"现在能不能同步"。
     * @param {object} p { t, data }
     */
    function StatusBar({ t, data }) {
      const st = data?.status ?? {}
      const items = []
      items.push({ key: 'ahead', label: t('bar.ahead'), value: st.ahead ?? 0, level: (st.ahead ?? 0) > 0 ? 'warn' : 'pass' })
      items.push({ key: 'behind', label: t('bar.behind'), value: st.behind ?? 0, level: (st.behind ?? 0) > 0 ? 'warn' : 'pass' })
      items.push({ key: 'dirty', label: t('bar.dirty'), value: st.dirtyCount ?? 0, level: (st.dirtyCount ?? 0) > 0 ? 'warn' : 'pass' })
      items.push({
        key: 'credential',
        label: t('bar.credential'),
        value: data?.credential?.haveCredential ? (data.credential.user || t('bar.ok')) : t('bar.missing'),
        level: data?.credential?.haveCredential ? 'pass' : 'fail',
      })
      items.push({
        key: 'schedule',
        label: t('bar.schedule'),
        value: data?.schedule?.installed ? t('bar.on') : t('bar.off'),
        level: data?.schedule?.installed ? 'pass' : 'info',
      })
      return h('div', {
        style: {
          display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center',
          padding: '6px 20px', fontSize: 12,
          borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))',
          flex: '0 0 auto',
        },
        'data-sync-hub-status': 'bar',
      }, items.map((it) => h('span', {
        key: it.key,
        style: { display: 'inline-flex', alignItems: 'center', gap: 5 },
        title: `${it.label}: ${it.value}`,
      },
        h(Dot, { level: it.level }),
        h('span', { style: { opacity: 0.6 } }, it.label),
        h('span', { style: { fontWeight: 500 } }, String(it.value)),
      )))
    }

    // ─────────────────── 总览页 ───────────────────

    /** 待办驱动（§4.2）：按优先级出 1–3 条，点了直达同步页。 */
    function buildTodos(t, data) {
      const list = []
      const st = data?.status ?? {}
      if (data?.credential && !data.credential.haveCredential) {
        list.push({ key: 'credential', level: 'fail', text: t('ov.todo.credential') })
      }
      if ((st.behind ?? 0) > 0) {
        list.push({ key: 'behind', level: 'warn', text: t('ov.todo.behind', { n: st.behind }) })
      }
      if ((st.dirtyCount ?? 0) > 0) {
        list.push({ key: 'commit', level: 'warn', text: t('ov.todo.commit', { n: st.dirtyCount }) })
      }
      const missing = data?.tools?.missingCore ?? []
      if (missing.length > 0) {
        list.push({ key: 'core', level: 'fail', text: t('ov.todo.core', { list: missing.join('、') }) })
      }
      return list.slice(0, 3)
    }

    /**
     * 总览页。
     * @param {object} p { t, data, onGoSync }
     */
    function OverviewPage({ t, data, onGoSync }) {
      const st = data?.status ?? {}
      const todos = buildTodos(t, data)
      const recent = data?.recent ?? []
      const [timelineOpen, setTimelineOpen] = useState(false)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } },
        // v2.6：待办 + 健康分都是短内容，并排不占整行（Grid 默认按各自内容高，
        // 谁也不会被同行撑出一片空白）。
        h(Grid, { min: 300 },
          // 待办卡
          h(Card, { title: t('ov.todo') },
            todos.length === 0
              ? h(Empty, null, t('ov.todo.empty'))
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                todos.map((item) => h('div', {
                  key: item.key,
                  style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
                },
                  h(Dot, { level: item.level }),
                  h('span', { style: { flex: '1 1 auto' } }, item.text),
                  item.key === 'core'
                    ? null
                    : h(ActionButton, { label: t('ov.goSync'), small: true, onClick: onGoSync }),
                )),
              ),
          ),
          // 健康分卡（N4：0–100 单一指标 + 点击拆明细）
          data?.health?.items?.length
            ? h(Card, {
              title: t('ov.health'),
              right: h('span', {
                style: {
                  fontSize: 20, fontWeight: 600,
                  color: (data.health.score ?? 0) >= 90 ? 'var(--dsw-alias-status-success, #22c55e)'
                    : (data.health.score ?? 0) >= 60 ? 'var(--dsw-alias-status-warning, #f59e0b)'
                      : 'var(--dsw-alias-status-danger, #ef4444)',
                },
                'data-sync-hub-health': 'score',
              }, String(data.health.score ?? 0)),
            },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                data.health.items.map((it) => h('div', {
                  key: it.key,
                  style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
                },
                  h(Dot, { level: it.level }),
                  h('span', { style: { flex: '0 0 auto', opacity: 0.7 } }, it.label),
                  h('span', { style: { flex: '1 1 auto', textAlign: 'right', opacity: 0.6 } }, it.reason),
                  h('span', { style: { flex: '0 0 auto', fontVariantNumeric: 'tabular-nums', opacity: 0.8 } }, `${it.got}/${it.max}`),
                )),
              ),
            )
            : null,
        ),

        // 中枢卡（D4 密度改造：平铺 Row → 自适应网格指标块）
        h(Card, { title: t('ov.hub') },
          h(Grid, { min: 140 },
            h(StatTile, { label: t('ov.version'), value: data?.version ?? '—', mono: true }),
            h(StatTile, { label: t('ov.branch'), value: st.branch ?? '—', mono: true }),
            h(StatTile, { label: t('ov.skills'), value: data?.inventory?.skills ?? '—' }),
            h(StatTile, { label: t('ov.machines'), value: data?.inventory?.machines ?? '—' }),
            h(StatTile, {
              label: t('ov.tools'),
              value: data?.tools ? `${data.tools.present}/${data.tools.total}` : '—',
              level: (data?.tools?.missingCore?.length ?? 0) > 0 ? 'fail' : 'pass',
              mono: true,
            }),
            h(StatTile, {
              label: t('ov.lastCommit'),
              value: st.lastCommit ? st.lastCommit.hash : '—',
              hint: st.lastCommit ? st.lastCommit.subject : null,
              mono: true,
            }),
          ),
        ),
        // 本机卡（D4：两行信息 → 双列网格，不再各占全宽）
        h(Card, { title: t('ov.machine') },
          h(Grid, { min: 220 },
            h(StatTile, { label: t('bar.identity'), value: data?.machine?.computer ?? '—', mono: true }),
            h(StatTile, { label: t('ov.dshHome'), value: data?.machine?.dshHome ?? '—', mono: true }),
          ),
        ),
        // 机器看板 + 最近动态（D4：内容量相近的两卡并排，不各占整行）
        h(Grid, { min: 300 },
          h(Card, { title: t('ov.board') },
            (data?.board ?? []).length === 0
              ? h(Empty, null, t('ov.noBoard'))
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                (data.board ?? []).map((m) => h('div', {
                  key: m.id,
                  style: {
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                    padding: '5px 0', borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.05))',
                  },
                },
                  h(Dot, { level: m.lastWhen ? 'pass' : 'info' }),
                  h('span', { style: { flex: '0 0 auto', fontWeight: 500 } }, m.id),
                  h('span', { style: { flex: '0 0 auto', opacity: 0.5, fontSize: 12 } }, m.computer ?? '?'),
                  h('span', {
                    style: { flex: '1 1 auto', textAlign: 'right', fontSize: 12, opacity: 0.7 },
                    title: m.lastSubject ?? undefined,
                  }, m.lastWhen ? `${m.lastWhen}${m.lastCommit ? ' · ' + m.lastCommit : ''}` : t('ov.boardNever')),
                )),
              ),
          ),
          h(Card, {
            title: t('ov.recent'),
            right: h(ActionButton, {
              label: timelineOpen ? t('tl.collapse') : t('tl.expand'),
              small: true,
              onClick: () => setTimelineOpen(!timelineOpen),
            }),
          },
            timelineOpen
              ? h(TimelineView, { t })
              : (recent.length === 0
                ? h(Empty, null, t('ov.noRecent'))
                : h('div', {
                  // v2.6：限高 + 内部滚动。提交信息长短不一，不限高会把
                  // 同行卡片的位置顶得忽高忽低；要看全量点右上「展开」。
                  style: {
                    display: 'flex', flexDirection: 'column', gap: 4,
                    maxHeight: 220, overflow: 'auto',
                  },
                },
                  recent.slice(0, 6).map((c) => h('div', {
                    key: c.hash,
                    style: { display: 'flex', gap: 8, fontSize: 12, alignItems: 'baseline' },
                  },
                    h('span', { style: { opacity: 0.5, fontFamily: 'ui-monospace, monospace', flex: '0 0 auto' } }, c.hash.slice(0, 7)),
                    h('span', {
                      style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    }, c.subject),
                    h('span', { style: { opacity: 0.5, flex: '0 0 auto' } }, c.date),
                  )),
                )),
          ),
        ),
      )
    }

    /**
     * N2 同步时间线视图：按机器筛选 + 文件数 + 完整历史（宿主 /timeline 取 120 条）。
     * @param {object} p { t }
     */
    function TimelineView({ t }) {
      const [commits, setCommits] = useState(null)
      const [error, setError] = useState(null)
      const [machine, setMachine] = useState('all')

      useEffect(() => {
        apiGet('/timeline').then((r) => {
          if (r.ok) setCommits(r.commits)
          else setError(r.error)
        }).catch((e) => setError(String(e?.message ?? e)))
      }, [])

      const machines = useMemo(() => {
        const set = new Set((commits ?? []).map((c) => c.machine).filter(Boolean))
        return [...set]
      }, [commits])

      const rows = (commits ?? []).filter((c) => (machine === 'all' ? true : c.machine === machine))

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        error ? h(InlineNote, { tone: 'error' }, t('error', { e: error })) : null,
        // 机器筛选
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          h(ActionButton, {
            label: t('tl.allMachines'), small: true,
            onClick: () => setMachine('all'),
            tone: machine === 'all' ? 'primary' : undefined,
          }),
          machines.map((m) => h(ActionButton, {
            key: m, label: m, small: true,
            onClick: () => setMachine(m),
            tone: machine === m ? 'primary' : undefined,
          })),
        ),
        !commits
          ? h(Empty, null, t('loading'))
          : rows.length === 0
            ? h(Empty, null, t('tl.noRows'))
            : h('div', {
              style: {
                maxHeight: 420, overflow: 'auto',
                border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))', borderRadius: 8,
              },
            },
              rows.map((c) => h('div', {
                key: c.hash,
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12,
                  borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.05))',
                },
              },
                h('span', { style: { opacity: 0.5, fontFamily: 'ui-monospace, monospace', flex: '0 0 auto' } }, c.short),
                c.machine ? h(Tag, { text: c.machine, level: 'info' }) : null,
                h('span', {
                  style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  title: c.subject,
                }, c.subject),
                h('span', { style: { opacity: 0.5, flex: '0 0 auto' } }, `${c.files} ${t('tl.files')}`),
                h('span', { style: { opacity: 0.5, flex: '0 0 auto' } }, `${c.date} ${c.time}`),
              )),
            ),
      )
    }

    // ─────────────────── 长动作统一运行器（v2.0.5 反馈打磨） ───────────────────

    /**
     * useJob —— 长动作统一状态机。
     *
     * 解决的问题（老大 2026-10-14 反馈）：
     *   "点击同步就一直显示正在同步，也看不到进度，不知道到底同步了没有" ——
     *   旧实现只有 busy 布尔 + 一条会消失的 note。新运行器给每个动作：
     *     · 步骤态：idle / running / success / error（**常驻，不自动消失**）
     *     · 已用时计时器（running 时每秒走字，长操作看得到在动）
     *     · 结构化回执（commit / 文件数 / 错误 + 修复提示），成败都留痕
     *     · running 期间调用方禁其它动作（防并发推送搅乱 git）
     */
    function useJob() {
      const [state, setState] = useState('idle')
      const [elapsed, setElapsed] = useState(0)
      const [result, setResult] = useState(null)
      const [error, setError] = useState(null)

      useEffect(() => {
        if (state !== 'running') return undefined
        const started = Date.now()
        setElapsed(0)
        const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
        return () => clearInterval(timer)
      }, [state])

      const run = useCallback(async (fn) => {
        setState('running')
        setResult(null)
        setError(null)
        try {
          const r = await fn()
          if (r?.ok) { setResult(r); setState('success') } else {
            setError({ text: r?.error ?? '未知错误', hint: r?.hint })
            setState('error')
          }
          return r
        } catch (e) {
          setError({ text: String(e?.message ?? e) })
          setState('error')
          return null
        }
      }, [])

      const reset = useCallback(() => {
        setState('idle'); setResult(null); setError(null); setElapsed(0)
      }, [])

      return { state, elapsed, result, error, run, reset, running: state === 'running' }
    }

    /** 秒数 → mm:ss。 */
    function fmtSecs(n) {
      const m = Math.floor(n / 60)
      const s = n % 60
      return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`
    }

    /**
     * JobView —— 一个 useJob 的常驻状态视图（就地，不消失）。
     * idle 时不渲染；running 转圈 + 已用时；success/error 结构化回执。
     *
     * @param {object} p { t, job, title, detail?, onReset? }
     */
    function JobView({ t, job, title, detail, onReset }) {
      if (job.state === 'idle') return null
      const level = job.state === 'running' ? 'info' : job.state === 'success' ? 'pass' : 'fail'
      return h('div', {
        style: {
          marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12,
          border: `1px solid ${job.state === 'error' ? 'var(--dsw-alias-status-danger, #ef4444)' : 'var(--dsw-alias-border-l3, rgba(0,0,0,0.08))'}`,
          background: job.state === 'success' ? 'transparent' : 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.03))',
        },
        'data-sync-hub-job': job.state,
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(Dot, { level }),
          h('span', { style: { fontWeight: 500 } }, title),
          job.state === 'running'
            ? h('span', { style: { opacity: 0.7 } }, t('job.running') + (job.elapsed > 0 ? ` · ${fmtSecs(job.elapsed)}` : ''))
            : h('span', { style: { opacity: 0.5 } }, t('job.took', { t: fmtSecs(job.elapsed) })),
          job.state !== 'running' && onReset
            ? h(ActionButton, { label: t('job.dismiss'), small: true, onClick: onReset })
            : null,
        ),
        // 结构化回执
        job.state === 'success' && detail
          ? h('div', { style: { marginTop: 4, opacity: 0.8, lineHeight: '18px' } }, detail)
          : null,
        job.state === 'error'
          ? h('div', { style: { marginTop: 4, color: 'var(--dsw-alias-status-danger, #ef4444)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '18px' } },
            job.error.text + (job.error.hint ? `\n${job.error.hint}` : ''))
          : null,
      )
    }

    // ─────────────────── 同步页 ───────────────────

    /** 推送范围（与宿主 SCOPE_PATHS 的键一致）。 */
    const SCOPES = ['memory', 'skills', 'config', 'sessions', 'dshconfig', 'plugins', 'pluginsrc']

    /**
     * 同步页：范围多选 + 预演 + 推/拉，反馈全部就地。
     * @param {object} p { t, data, onRefresh }
     */
    function SyncPage({ t, data, onRefresh }) {
      const [scopes, setScopes] = useState(['memory', 'skills', 'config', 'pluginsrc'])
      const [except, setExcept] = useState([])
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)
      const [preview, setPreview] = useState(null)
      // 冲突文件列表：非空即渲染冲突解决器（拉取撞车或手动查询命中）
      const [conflicts, setConflicts] = useState([])
      const [resolverOpen, setResolverOpen] = useState(false)
      // 长动作运行器（v2.0.5）：推送/拉取各有独立常驻状态
      const pushJob = useJob()
      const pullJob = useJob()
      const anyRunning = pushJob.running || pullJob.running

      const toggle = (key) => {
        setScopes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
      }

      const runPreview = async () => {
        setBusy('preview')
        setNote(null)
        const r = await apiPost('/sync', { action: 'preview', scopes, except })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        setPreview(r)
      }

      const runPush = async () => {
        setNote(null)
        await pushJob.run(async () => {
          const r = await apiPost('/sync', { action: 'push', scopes, except })
          if (r.ok) {
            setPreview(null)
            onRefresh()
          } else if (r.conflict) {
            setConflicts(r.conflicts ?? [])
            setResolverOpen(true)
          }
          return r
        })
      }

      const runPull = async () => {
        setNote(null)
        await pullJob.run(async () => {
          const r = await apiPost('/sync', { action: 'pull' })
          if (r.ok) onRefresh()
          return r
        })
      }

      const runConflicts = async () => {
        setBusy('conflicts')
        const r = await apiPost('/sync', { action: 'conflicts' })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        setConflicts(r.conflicts ?? [])
        setResolverOpen((r.conflicts ?? []).length > 0)
        if ((r.conflicts ?? []).length === 0) setNote({ tone: 'info', text: t('sync.msg.noConflict') })
      }

      // N6 一键同步流：预演 → 确认 → 执行 → 结果 → 提示重启，一条流内完成不跳页。
      // v2.0.6：mode = 'push'（只推）| 'roundtrip'（先拉后推，对齐 bat [5] 完整同步一轮）
      const [flow, setFlow] = useState(null)
      const [flowMode, setFlowMode] = useState('push')
      const [flowBusy, setFlowBusy] = useState(false)
      const flowJob = useJob()

      const flowPreview = async () => {
        setFlowBusy(true)
        let r
        if (flowMode === 'roundtrip') {
          // 先拉后推：预演的是"拉取后的推送"，这里先只报拉取意图，确认后执行
          setFlowBusy(false)
          setFlow({ stage: 'confirm', files: null, totalBytes: 0, roundtrip: true })
          return
        }
        r = await apiPost('/sync', { action: 'preview', scopes, except })
        setFlowBusy(false)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        if (!r.files?.length) {
          setNote({ tone: 'info', text: t('sync.previewEmpty') })
          return
        }
        setFlow({ stage: 'confirm', files: r.files, totalBytes: r.totalBytes })
      }

      const flowRun = async () => {
        setFlow({ ...flow, stage: 'running' })
        const r = await flowJob.run(async () => {
          // 先拉后推模式：第一步拉取（撞车即停，进冲突解决器）
          if (flow.roundtrip) {
            const pulled = await apiPost('/sync', { action: 'pull' })
            if (!pulled.ok) {
              if (pulled.conflict) { setConflicts(pulled.conflicts ?? []); setResolverOpen(true) }
              return pulled
            }
          }
          const out = await apiPost('/sync', { action: 'push', scopes, except })
          if (out.ok) {
            onRefresh()
          } else if (out.conflict) {
            setConflicts(out.conflicts ?? [])
            setResolverOpen(true)
          }
          return out
        })
        if (r?.ok) setFlow({ stage: 'done', fileCount: r.fileCount ?? 0, commit: r.commit ?? '', roundtrip: flow.roundtrip })
        else setFlow(null)
      }

      return h('div', null,
        // 冲突解决器（撞车时置顶展开）
        resolverOpen && conflicts.length > 0
          ? h(ConflictResolver, {
            t,
            files: conflicts,
            onDone: () => { setResolverOpen(false); setConflicts([]); onRefresh() },
          })
          : null,

        // v2.6：重排为「说明 / 范围+主操作 并排两列 / 回执」三区。
        // 原来范围 chips 与按钮行上下堆叠占满整卡高度；现在两列并排，
        // 左边选范围、右边点主操作，一眼看完不用滚动（窄屏自动降列）。
        h(Card, { title: t('sync.opTitle'), hint: t('sync.opHint') },
          h('div', {
            style: {
              fontSize: 12, lineHeight: '18px', opacity: 0.8,
              padding: '6px 8px', borderRadius: 8,
              background: 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.04))',
            },
          },
            h('div', null, t('sync.incr1')),
            h('div', null, t('sync.incr2')),
          ),
          !flow
            ? h(Grid, { min: 320, gap: 10 },
              // 左列：选范围
              h('div', null,
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                  h('span', { style: { fontSize: 13, fontWeight: 600 } }, t('sync.scope')),
                  h(ActionButton, { label: t('sync.all'), small: true, onClick: () => setScopes([...SCOPES]) }),
                  h(ActionButton, { label: t('sync.none'), small: true, onClick: () => setScopes([]) }),
                  h('span', { style: { fontSize: 12, opacity: 0.6, marginLeft: 'auto' } },
                    scopes.length === 0 ? t('sync.pickCat') : t('flow.picked', { n: scopes.length })),
                ),
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                  SCOPES.map((s) => h('button', {
                    key: s,
                    type: 'button',
                    onClick: () => toggle(s),
                    'aria-pressed': scopes.includes(s),
                    title: t(`scope.${s}.tip`),
                    style: {
                      appearance: 'none', cursor: 'pointer', fontSize: 12,
                      padding: '4px 10px', borderRadius: 999,
                      border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
                      background: scopes.includes(s)
                        ? 'var(--dsw-alias-button-primary-bg, #2563eb)' : 'transparent',
                      color: scopes.includes(s) ? '#fff' : 'inherit',
                    },
                  }, t(`scope.${s}`))),
                ),
              ),
              // 右列：主操作（主路径一个蓝按钮 + 手动挡小按钮）
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h(ActionButton, {
                  label: t('flow.start'), tone: 'primary',
                  onClick: flowPreview, busy: flowBusy, disabled: scopes.length === 0,
                  title: t('flow.startTip'),
                }),
                h(ActionButton, {
                  label: t('flow.roundtrip'), onClick: flowPreview, busy: flowBusy,
                  disabled: scopes.length === 0, small: true,
                  title: t('flow.roundtripTip'),
                }),
                h('div', { style: { height: 1, background: 'var(--dsw-alias-border-l3, rgba(0,0,0,0.08))' } }),
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                  h(ActionButton, {
                    label: t('sync.preview'), onClick: runPreview,
                    busy: busy === 'preview', disabled: anyRunning,
                    title: t('sync.term.preview'), small: true,
                  }),
                  h(ActionButton, {
                    label: t('sync.push'), onClick: runPush,
                    busy: pushJob.running, disabled: anyRunning || scopes.length === 0,
                    title: t('sync.term.push'), small: true,
                  }),
                  h(ActionButton, {
                    label: t('sync.pull'), onClick: runPull,
                    busy: pullJob.running, disabled: anyRunning,
                    title: t('sync.term.pull'), small: true,
                  }),
                  h(ActionButton, {
                    label: t('sync.conflicts'), onClick: runConflicts,
                    busy: busy === 'conflicts', disabled: anyRunning, small: true,
                  }),
                ),
              ),
            )
            : null,
          h(InlineNote, { tone: note?.tone }, note?.text),
          flow && flow.stage === 'confirm'
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                flow.roundtrip
                  ? h('p', { style: { margin: 0, fontSize: 13 } }, t('flow.confirmRoundtrip', { n: scopes.length }))
                  : h('p', { style: { margin: 0, fontSize: 13 } },
                    t('sync.confirmPush', { n: flow.files.length }) + ' · ' + t('sync.files', {
                      n: flow.files.length, size: humanBytes(flow.totalBytes),
                    })),
                !flow.roundtrip
                  ? h('div', {
                    style: {
                      maxHeight: 160, overflow: 'auto', padding: 8, borderRadius: 8, fontSize: 11,
                      background: 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.04))',
                      fontFamily: 'ui-monospace, monospace', lineHeight: '17px',
                    },
                  },
                    flow.files.slice(0, 60).map((f) => h('div', { key: f.path }, f.path)),
                  )
                  : null,
                h('div', { style: { display: 'flex', gap: 8 } },
                  h(ActionButton, { label: t('flow.confirm'), tone: 'primary', onClick: flowRun }),
                  h(ActionButton, { label: t('act.cancel'), onClick: () => setFlow(null) }),
                ),
              )
              : (flow && flow.stage !== 'confirm'
                ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  // v2.0.5：running 态由 flowJob 渲染（带已用时），done 态常驻
                  flow.stage === 'running'
                    ? h(JobView, { t, job: flowJob, title: t('sync.push') })
                    : h(JobView, {
                      t,
                      job: { state: 'success', elapsed: flowJob.elapsed, result: flow, error: null },
                      title: t('sync.push'),
                      detail: t('flow.done', { n: flow.fileCount, commit: flow.commit }) + '\n' + t('flow.restartHint'),
                      onReset: () => { flowJob.reset(); setFlow(null) },
                    }),
                  flow.stage !== 'running'
                    ? h('div', null, h(ActionButton, { label: t('flow.again'), small: true, onClick: () => setFlow(null) }))
                    : null,
                )
                : null),
        ),

// 同步范围 + 动作卡（v2.4：已并入上方操作卡，这里只剩回执区）
        h('div', null,
          // 常驻回执（不消失；running 显示已用时走字）
          h(JobView, {
            t,
            job: pushJob,
            title: t('sync.push'),
            detail: pushJob.result
              ? t('sync.msg.pushed', { n: pushJob.result.fileCount ?? 0, commit: pushJob.result.commit ?? '' })
                + (pushJob.result.files?.length ? `\n${pushJob.result.files.slice(0, 8).join('\n')}${pushJob.result.files.length > 8 ? `\n…共 ${pushJob.result.files.length} 个文件` : ''}` : '')
              : null,
            onReset: pushJob.reset,
          }),
          h(JobView, {
            t,
            job: pullJob,
            title: t('sync.pull'),
            detail: pullJob.result
              ? (() => {
                const ap = pullJob.result.applied
                const lines = [t('sync.pullCommit', { commit: pullJob.result.commit ?? '' })]
                if (ap) {
                  lines.push(ap.agentsOk
                    ? t('sync.pullAgents', { bytes: `${Math.round((ap.agentsBytes ?? 0) / 1024)}KB` })
                    : t('sync.pullAgentsFail', { e: ap.agentsError ?? t('sync.pullNoId') }))
                  if (ap.skillsAdded > 0) lines.push(t('sync.pullSkills', { n: ap.skillsAdded }))
                }
                lines.push(t('sync.pullRestart'))
                return lines.join('\n')
              })()
              : null,
            onReset: pullJob.reset,
          }),
          h('p', { style: { margin: '6px 0 0', fontSize: 12, opacity: 0.6 } }, t('sync.hint.pull')),
          preview && preview.files?.length > 0
            ? h('div', {
              style: {
                marginTop: 8, padding: 8, borderRadius: 8, fontSize: 12,
                background: 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.04))',
                maxHeight: 200, overflow: 'auto',
              },
            },
              h('div', { style: { fontWeight: 500, marginBottom: 4 } },
                t('sync.previewTitle') + ' · ' + t('sync.files', {
                  n: preview.files.length, size: humanBytes(preview.totalBytes),
                })),
              preview.files.slice(0, 50).map((f) => h('div', {
                key: f.path,
                style: { fontFamily: 'ui-monospace, monospace', opacity: 0.8, lineHeight: '18px' },
              }, f.path)),
            )
            : preview
              ? h(Empty, null, t('sync.previewEmpty'))
              : null,
        ),
      )
    }

    // ─────────────────── 维护页 ───────────────────

    /**
     * 维护页：备份 / 工具链 / 定时 / 凭据 / 换机补齐 / 控制台。
     * @param {object} p { t, data, onRefresh }
     */
    function MaintainPage({ t, data, onRefresh }) {
      // v2.5：备份/定时/自动推送已搬去同步页；这里只剩 角色/工具链/插件更新/凭据/换机/控制台。
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)
      const [portable, setPortable] = useState(null)
      const [pluginUpdate, setPluginUpdate] = useState(null)

      const portableJob = useJob()
      // v2.3.1：插件更新检查也用 useJob —— 旧版按钮点击无任何反馈（无 busy、失败不显示），
      // 加上后端 execSync 卡死事件循环，看起来就像"假按钮"。
      const pluginCheckJob = useJob()
      // v2.4.1：一键更新落地（拉 tag → 备份 → 拷入 → 回读校验，失败自动回滚）
      const pluginApplyJob = useJob()

      const doPortable = async () => {
        const r = await portableJob.run(() => apiPost('/portable', { action: 'setup', profile: 'desktop', dryRun: true }))
        if (r) setPortable(r)
      }

      const tools = data?.tools ?? {}
      const missingAll = [...(tools.missingCore ?? []), ...(tools.missingDev ?? []), ...(tools.missingNice ?? [])]

      // ── v2.2 S5：本机角色（🏠主机 / 💻副机 / 🔄双向） ──
      const [roleInfo, setRoleInfo] = useState(null)
      useEffect(() => {
        apiGet('/env').then((r) => {
          if (r.ok) setRoleInfo({ machineId: r.machineId, roles: r.roles?.roles ?? {}, updatedAt: r.roles?.updatedAt ?? null })
        }).catch(() => {})
      }, [])
      const myRole = roleInfo?.roles?.[roleInfo.machineId] ?? 'host' // 默认主机（方案 S5）
      const setRole = async (role) => {
        setBusy('set-role')
        setNote(null)
        const r = await apiPost('/env', { action: 'set-role', role })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        setRoleInfo((prev) => prev ? { ...prev, roles: { ...prev.roles, [prev.machineId]: r.role } } : prev)
        setNote({ tone: 'success', text: `${r.receipt}\n${r.note}` })
      }
      const ROLE_META = [
        { id: 'host', icon: '🏠', label: t('mt.role.host'), desc: t('mt.role.hostDesc') },
        { id: 'follower', icon: '💻', label: t('mt.role.follower'), desc: t('mt.role.followerDesc') },
        { id: 'both', icon: '🔄', label: t('mt.role.both'), desc: t('mt.role.bothDesc') },
      ]

      return h('div', null,
        // 本机角色（S5：设置页第一位——先说清"这台机器是谁"，再谈别的）
        h(Card, {
          title: t('mt.role.title'),
          hint: t('mt.role.hint'),
        },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            ...ROLE_META.map((m) => h('button', {
              key: m.id,
              onClick: () => setRole(m.id),
              disabled: busy === 'set-role',
              style: {
                flex: '1 1 160px', textAlign: 'left', cursor: 'pointer',
                border: `1px solid ${myRole === m.id ? 'var(--dsw-alias-brand, #4f7cff)' : 'var(--dsw-alias-border-l3, rgba(0,0,0,0.08))'}`,
                borderRadius: 8, padding: '8px 10px', fontSize: 12, lineHeight: '18px',
                background: myRole === m.id ? 'var(--dsw-alias-fill-brand, rgba(79,124,255,0.08))' : 'transparent',
                color: 'inherit',
              },
            },
              h('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 2 } },
                `${m.icon} ${m.label}${myRole === m.id ? t('mt.role.current') : ''}`),
              h('div', { style: { opacity: 0.65 } }, m.desc),
            )),
          ),
          h(InlineNote, { tone: note?.tone }, note?.text),
        ),

        // v2.5：备份快照/定时同步/自动推送 已搬去 🔄同步页（老大反馈"同步的事分散在状态页和设置页"）

        // 工具链 + 插件更新 + 凭据（D4：信息量小的卡并排）
        h(Grid, { min: 280 },
          h(Card, { title: t('mt.tools'), hint: t('mt.toolsHint') },
          missingAll.length === 0
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
              h(Dot, { level: 'pass' }), h('span', null, t('mt.toolsAll')))
            : h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
              h(Dot, { level: (tools.missingCore?.length ?? 0) > 0 ? 'fail' : 'warn' }),
              h('span', null, t('mt.toolsMissing', { n: missingAll.length, list: missingAll.join('、') }))),
          h('div', { style: { fontSize: 12, opacity: 0.6 } },
            `${t('mt.core')} ${(tools.present ?? 0)}/${tools.total ?? 0}`),
        ),

        // 插件更新（v2.3.1：useJob 常驻回执 + 检查中反馈 + 失败显示原因）
        h(Card, {
          title: t('mt.pluginUpdate'), hint: t('mt.pluginUpdateHint'),
          right: h(ActionButton, {
            label: pluginCheckJob.running ? t('mt.pluginChecking') : t('mt.pluginCheck'),
            small: true, tone: 'primary',
            busy: pluginCheckJob.running,
            disabled: pluginCheckJob.running,
            onClick: async () => {
              const r = await pluginCheckJob.run(() => apiPost('/content', { action: 'plugin-update-check' }))
              if (r?.ok) setPluginUpdate(r.update)
            },
          }),
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
            h(Dot, { level: pluginCheckJob.running ? 'info' : (pluginUpdate?.hasUpdate ? 'warn' : 'info') }),
            h('span', null, pluginCheckJob.running
              ? t('mt.pluginChecking')
              : (pluginUpdate
                ? `${t('mt.pluginVersion')}: ${pluginUpdate.current} → ${pluginUpdate.latest}`
                : t('mt.pluginNotChecked'))),
          ),
          pluginUpdate?.hasUpdate
            ? h('div', { style: { marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-status-warn, #f59e0b)' } },
                t('mt.pluginUpdateAvailable')),
              h(ActionButton, {
                label: t('mt.pluginApply'), small: true, tone: 'primary',
                busy: pluginApplyJob.running, disabled: pluginApplyJob.running,
                title: t('mt.pluginApplyTip'),
                onClick: async () => {
                  await pluginApplyJob.run(() => apiPost('/content', {
                    action: 'plugin-update-apply', tag: pluginUpdate.latest,
                  }))
                },
              }),
            )
            : null,
          pluginUpdate && !pluginUpdate.hasUpdate
            ? h('div', { style: { marginTop: 6, fontSize: 12, opacity: 0.6 } },
              t('mt.pluginUpToDate', { v: pluginUpdate.current }))
            : null,
          h(JobView, {
            t, job: pluginApplyJob, title: t('mt.pluginApply'),
            detail: pluginApplyJob.result
              ? t('mt.pluginApplied', { v: pluginApplyJob.result.version ?? '' }) + '\n' + t('mt.pluginRestart')
                + (pluginApplyJob.result.backup ? `\n${t('mt.pluginBackup', { p: pluginApplyJob.result.backup })}` : '')
              : null,
            onReset: pluginApplyJob.reset,
          }),
          h(JobView, {
            t, job: pluginCheckJob, title: t('mt.pluginCheck'),
            detail: null,
            onReset: pluginCheckJob.reset,
          }),
        ),

        // 凭据
        h(Card, { title: t('mt.credential') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
            h(Dot, { level: data?.credential?.haveCredential ? 'pass' : 'fail' }),
            h('span', null, data?.credential?.haveCredential
              ? t('mt.credentialOk', { user: data.credential.user })
              : t('mt.credentialMissing')),
          ),
        ),
        ),

        // 换机补齐
        h(Card, { title: t('mt.portable'), hint: t('mt.portableHint') },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h(ActionButton, { label: t('mt.portableRun'), small: true, onClick: doPortable, busy: portableJob.running }),
          ),
          h(JobView, {
            t, job: portableJob, title: t('mt.portableRun'),
            detail: null,
            onReset: portableJob.reset,
          }),
          portable
            ? h('div', {
              style: {
                marginTop: 6, padding: 8, borderRadius: 8, fontSize: 12,
                background: 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.04))',
              },
            },
              portable.steps?.map((s) => h('div', {
                key: s.step,
                style: { display: 'flex', gap: 6, alignItems: 'baseline', lineHeight: '18px' },
              },
                h('span', { style: { color: s.ok ? 'var(--dsw-alias-status-success, #22c55e)' : 'var(--dsw-alias-status-danger, #ef4444)' } }, s.ok ? '✓' : '✗'),
                h('span', { style: { opacity: 0.6, flex: '0 0 auto' } }, s.step),
                h('span', { style: { flex: '1 1 auto' } }, s.detail),
              )),
            )
            : null,
        ),

        // 控制台 + 使用手册 + 日志
        h(Card, { title: t('mt.console'), hint: t('mt.consoleHint') },
          h(ActionButton, { label: t('mt.console'), small: true, onClick: openConsole }),
          h(ActionButton, {
            label: t('mt.manual'), small: true,
            onClick: () => {
              const hub = data?.hub
              if (hub) {
                // 用宿主同源 API 打开手册（复用受控入口），失败则复制路径
                apiPost('/env', { action: 'open-manual', hub }).catch(() => {})
              }
            },
          }),
        ),
        h(Card, { title: t('mt.log') },
          h('div', { style: { fontSize: 12, opacity: 0.7, fontFamily: 'ui-monospace, monospace' } },
            t('mt.logPath', { p: data?.logFile ?? '—' })),
        ),
      )
    }

    // ─────────────────── 技能页 ───────────────────

    /** 差异徽标：四类 + 占位 + 非法。 */
    const DIFF_LABEL = {
      'only-local': '仅本机',
      'only-hub': '仅中枢',
      differ: '两边不同',
      identical: '一致',
    }
    const DIFF_LEVEL = {
      'only-local': 'warn',
      'only-hub': 'info',
      differ: 'fail',
      identical: 'pass',
    }

    /** 一个小徽标。 */
    function Tag({ text, level }) {
      const color = level === 'pass' ? 'var(--dsw-alias-status-success, #22c55e)'
        : level === 'warn' ? 'var(--dsw-alias-status-warning, #f59e0b)'
          : level === 'fail' ? 'var(--dsw-alias-status-danger, #ef4444)'
            : 'var(--dsw-alias-label-tertiary, #888)'
      return h('span', {
        style: {
          fontSize: 11, lineHeight: '16px', padding: '1px 6px', borderRadius: 999,
          border: `1px solid ${color}`, color, flex: '0 0 auto',
        },
      }, text)
    }

    /**
     * 技能页：本机 ↔ 中枢双列 + 四类差异徽标 + 汇总。
     * @param {object} p { t, data, onRefresh }
     */
    function SkillsPage({ t, data, onRefresh }) {
      const [skills, setSkills] = useState(null)
      const [error, setError] = useState(null)
      const [filter, setFilter] = useState('all')

      const load = useCallback(async () => {
        setError(null)
        const r = await apiGet('/skills')
        if (!r.ok) { setError(r.error); return }
        setSkills(r)
      }, [])
      useEffect(() => { load() }, [load])

      const summary = skills?.summary
      const rows = (skills?.diff ?? []).filter((d) => (filter === 'all' ? true : d.kind === filter))
      const invalid = [...(summary?.invalidLocal ?? []), ...(summary?.invalidHub ?? [])]

      return h('div', null,
        // 汇总卡
        // 过滤 + 列表
        h(Card, { title: t('sk.list') },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 } },
            ['all', 'only-local', 'only-hub', 'differ', 'identical'].map((k) => h('button', {
              key: k,
              type: 'button',
              onClick: () => setFilter(k),
              style: {
                appearance: 'none', cursor: 'pointer', fontSize: 12,
                padding: '3px 10px', borderRadius: 999,
                border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
                background: filter === k ? 'var(--dsw-alias-button-primary-bg, #2563eb)' : 'transparent',
                color: filter === k ? '#fff' : 'inherit',
              },
            }, k === 'all' ? t('sk.filterAll') : DIFF_LABEL[k])),
          ),
          rows.length === 0
            ? h(Empty, null, t('sk.noRows'))
            : h('div', {
              style: {
                maxHeight: 360, overflow: 'auto',
                border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))', borderRadius: 8,
              },
            },
              rows.map((d) => h('div', {
                key: d.name,
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  fontSize: 13, borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.05))',
                },
              },
                h(Dot, { level: DIFF_LEVEL[d.kind] }),
                h('span', {
                  style: { flex: '1 1 auto', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                }, d.name),
                h('span', { style: { fontSize: 11, opacity: 0.5, flex: '0 0 auto' } },
                  d.local ? `${t('sk.local')}${d.local.sha ? ' ' + d.local.sha : ''}` : '—',
                  ' / ',
                  d.hub ? `${t('sk.hub')}${d.hub.sha ? ' ' + d.hub.sha : ''}` : '—'),
                d.local?.placeholder || d.hub?.placeholder ? h(Tag, { text: t('sk.placeholder'), level: 'info' }) : null,
                h(Tag, { text: DIFF_LABEL[d.kind], level: DIFF_LEVEL[d.kind] }),
              )),
            ),
        ),

        // 同步概览 + 能力边界说明（D4：两张矮卡并排，不各占整行）
        h(Grid, { min: 300 },
          h(Card, { title: t('sk.summary'), right: h(ActionButton, { label: t('refresh'), small: true, onClick: load }) },
            error ? h(InlineNote, { tone: 'error' }, t('error', { e: error })) : null,
            summary
              ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 13 } },
                h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Dot, { level: 'pass' }), `一致 ${summary.identical}`),
                h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Dot, { level: 'warn' }), `仅本机 ${summary.onlyLocal}`),
                h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Dot, { level: 'info' }), `仅中枢 ${summary.onlyHub}`),
                h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Dot, { level: 'fail' }), `两边不同 ${summary.differ}`),
                summary.placeholders > 0
                  ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Dot, { level: 'info' }), `占位/空壳 ${summary.placeholders}`)
                  : null,
              )
              : h(Empty, null, t('loading')),
            // 非法名警示（DSH 会静默跳过它们，这里必须让人看见）
            invalid.length > 0
              ? h(InlineNote, { tone: 'error' },
                `${t('sk.invalidWarn')}：${invalid.join('、')}`)
              : null,
          ),

          // 能力边界说明（不假装已有导入/回收站）
          h(Card, { title: t('sk.scopeTitle') },
            h('p', { style: { margin: 0, fontSize: 12, opacity: 0.7, lineHeight: '18px' } }, t('sk.scopeBody')),
          ),
        ),
      )
    }

    // ─────────────────── 会话页 ───────────────────

    /**
     * 会话页：跨机会话备份浏览（只读）+ 本机概况 + 备份/恢复动作。
     * @param {object} p { t, data, onRefresh }
     */
    function SessionsPage({ t, data, onRefresh }) {
      const [info, setInfo] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)
      const [open, setOpen] = useState(null)

      const load = useCallback(async () => {
        setError(null)
        const r = await apiGet('/sessions')
        if (!r.ok) { setError(r.error); return }
        setInfo(r)
      }, [])
      useEffect(() => { load() }, [load])

      const act = async (action, body) => {
        setBusy(action)
        setNote(null)
        const r = await apiPost('/sessions', { action, ...(body ?? {}) })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        setNote({
          tone: 'success',
          text: action === 'backup'
            ? t('se.msg.backed', { n: r.copied ?? 0, skipped: r.skipped ?? 0 })
            : t('se.msg.restored', { n: r.restored ?? 0, same: r.same ?? 0, mapped: r.mapped ?? 0 }),
        })
        load()
        onRefresh()
      }

      const machines = info?.hub?.machines ?? []
      const missing = info?.missing ?? []

      // S4：一键创建缺失空目录（只建空目录，不写任何文件）
      const createDirs = async () => {
        setBusy('mkdir')
        setNote(null)
        const r = await apiPost('/sessions', {
          action: 'create-missing-dirs',
          paths: missing.map((m) => m.path),
        })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        const parts = []
        if (r.created?.length) parts.push(t('se.mkdirCreated', { n: r.created.length }))
        if (r.existed?.length) parts.push(t('se.mkdirExisted', { n: r.existed.length }))
        if (r.failed?.length) parts.push(t('se.mkdirFailed', { n: r.failed.length }))
        setNote({
          tone: r.failed?.length ? 'error' : 'success',
          text: parts.join('\n')
            + '\n' + t('se.mkdirHint'),
        })
        load()
      }

      return h('div', null,
        // v2.2 D1：会话轨道定位明示 —— 单向归档，不是双向同步
        h(Card, { title: t('se.archiveTitle') },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, lineHeight: '19px' } },
            h('div', null, t('se.archiveLine1')),
            h('div', null, t('se.archiveLine2')),
            h('div', null, t('se.archiveLine3')),
          ),
        ),

        // v2.2 S3/S4：缺失工作区检测 + 一键建空目录（"未分组"的真正解药）
        missing.length > 0
          ? h(Card, {
            title: t('se.missingTitle', { n: missing.length }),
            hint: t('se.missingHint'),
            right: h(ActionButton, {
              label: t('se.mkdir'), tone: 'primary', small: true,
              onClick: createDirs, busy: busy === 'mkdir',
            }),
          },
            h('div', {
              style: {
                display: 'flex', flexDirection: 'column', gap: 6,
                fontSize: 12, lineHeight: '18px',
              },
            },
              ...missing.slice(0, 8).map((m) => h('div', {
                key: m.path,
                style: {
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  gap: 8, padding: '5px 8px', borderRadius: 6,
                  background: 'var(--dsw-alias-fill-quaternary, rgba(0,0,0,0.03))',
                },
              },
                h('span', {
                  style: {
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  },
                }, m.path),
                h('span', { style: { opacity: 0.6, flex: '0 0 auto', fontSize: 11 } },
                  t('se.missingMeta', { m: m.machines.join('/'), n: m.files })),
              )),
              missing.length > 8
                ? h('div', { style: { opacity: 0.55, fontSize: 11 } },
                  t('se.missingMore', { n: missing.length - 8 }))
                : null,
              h('div', { style: { opacity: 0.65, marginTop: 2 } }, t('se.missingHow')),
            ),
          )
          : null,

        h(Card, {
          title: t('se.local'), hint: t('se.localHint'),
          right: h(ActionButton, {
            label: t('se.backup'), tone: 'primary', small: true,
            onClick: () => act('backup'), busy: busy === 'backup',
          }),
        },
          h(InlineNote, { tone: note?.tone }, note?.text),
          h('div', { style: { fontSize: 13 } },
            info?.local
              ? `${t('se.files')} ${info.local.files} · ${humanBytes(info.local.bytes)}`
              : t('loading')),
        ),

        h(Card, { title: t('se.hub'), hint: t('se.hubHint') },
          machines.length === 0
            ? h(Empty, null, t('se.noMachines'))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              machines.map((m) => h('div', {
                key: m.machine,
                style: {
                  border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))',
                  borderRadius: 8, padding: '8px 10px',
                },
              },
                h('div', {
                  style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
                  onClick: () => setOpen(open === m.machine ? null : m.machine),
                },
                  h('span', { style: { flex: '1 1 auto', fontWeight: 500, fontSize: 13 } }, m.machine),
                  h('span', { style: { fontSize: 12, opacity: 0.6 } }, `${t('se.files')} ${m.files} · ${humanBytes(m.bytes)}`),
                  h('span', { style: { opacity: 0.5, fontSize: 12 } }, open === m.machine ? '▾' : '▸'),
                ),
                open === m.machine
                  ? h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 } },
                    m.workspaces.map((w) => h('div', {
                      key: w.folder,
                      style: { fontSize: 12, display: 'flex', gap: 8, alignItems: 'baseline' },
                    },
                      h('span', {
                        style: { flex: '1 1 auto', fontFamily: 'ui-monospace, monospace', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                        title: w.path ?? w.folder,
                      }, w.path ?? w.folder),
                      h('span', { style: { opacity: 0.5, flex: '0 0 auto' } }, `${w.files}`),
                    )),
                    h('div', { style: { marginTop: 6 } },
                      h(ActionButton, {
                        label: t('se.restoreFrom', { machine: m.machine }), small: true,
                        onClick: () => act('restore', { from: m.machine }),
                        busy: busy === 'restore',
                      }),
                    ),
                  )
                  : null,
              )),
            ),
        ),
      )
    }

    // ─────────────────── 冲突解决器（N1，D7） ───────────────────

    /**
     * 三方冲突解决器：base / 对端 / 本机 三栏 + 选边或手写 + 收尾。
     *
     * 语义警示（实测坑，2026-10-14 固化在 lib/hub/conflict.js）：
     *   rebase 场景下 git 阶段索引 :2: 是**对端**、:3: 是**本机**，
     *   与字面直觉相反。这里按宿主返回的 stage2/stage3 明确标注
     *   「对端 / 本机」，绝不靠猜。
     *
     * @param {object} p { t, files, onDone }
     */
    function ConflictResolver({ t, files, onDone }) {
      const [index, setIndex] = useState(0)
      const [info, setInfo] = useState(null)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)

      const file = files[index] ?? null

      const load = useCallback(async (f) => {
        if (!f) return
        setBusy('inspect')
        setNote(null)
        const r = await apiPost('/sync', { action: 'conflict-inspect', file: f })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); setInfo(null); return }
        setInfo(r)
        // 预填：默认用本机内容（stage3），让用户有个起点自己改。
        setDraft(r.stage3 ?? r.stage2 ?? r.base ?? '')
      }, [])
      useEffect(() => { load(file) }, [file, load])

      const pick = (which) => {
        if (!info) return
        const v = which === 'base' ? info.base : which === 'remote' ? info.stage2 : info.stage3
        setDraft(v ?? '')
      }

      const save = async () => {
        if (!file) return
        setBusy('save')
        setNote(null)
        const r = await apiPost('/sync', { action: 'conflict-resolve', file, content: draft })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        if (index + 1 < files.length) {
          setIndex(index + 1)
        } else {
          setNote({ tone: 'success', text: t('cf.savedLast') })
        }
      }

      const finish = async () => {
        setBusy('finish')
        setNote(null)
        const r = await apiPost('/sync', { action: 'conflict-finish', files })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        setNote({ tone: 'success', text: t('cf.finished') })
        onDone()
      }

      if (!file) return null

      const col = (title, text, onPick) => h('div', {
        style: {
          flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4,
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { fontSize: 12, fontWeight: 500 } }, title),
          onPick ? h(ActionButton, { label: t('cf.useThis'), small: true, onClick: onPick, disabled: text == null }) : null,
        ),
        h('pre', {
          style: {
            margin: 0, padding: 8, borderRadius: 8, fontSize: 11, lineHeight: '16px',
            background: 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.04))',
            maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            opacity: text == null ? 0.4 : 1,
          },
        }, text == null ? t('cf.emptyStage') : (text || t('cf.emptyStage'))),
      )

      return h('div', {
        style: {
          border: '1px solid var(--dsw-alias-status-danger, #ef4444)',
          borderRadius: 10, padding: 12, marginBottom: 12,
        },
        'data-sync-hub-conflict': 'resolver',
      },
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 } },
          h('h3', { style: { margin: 0, fontSize: 14, fontWeight: 600 } },
            `${t('cf.title')}（${index + 1}/${files.length}）`),
          h('span', { style: { fontSize: 12, fontFamily: 'ui-monospace, monospace', opacity: 0.7 } }, file),
        ),

        h(InlineNote, { tone: 'warn' }, t('cf.warn')),

        busy === 'inspect' || !info
          ? h(Empty, null, t('loading'))
          : h('div', { style: { display: 'flex', gap: 10, marginTop: 8 } },
            col(t('cf.base'), info.base, () => pick('base')),
            col(t('cf.remote'), info.stage2, () => pick('remote')),
            col(t('cf.local'), info.stage3, () => pick('local')),
          ),

        h('div', { style: { marginTop: 10 } },
          h('div', { style: { fontSize: 12, opacity: 0.6, marginBottom: 4 } }, t('cf.editor')),
          h('textarea', {
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            rows: 8,
            spellCheck: false,
            style: {
              width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8,
              fontSize: 12, lineHeight: '18px', resize: 'vertical',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
              background: 'var(--dsw-alias-bg-base, transparent)',
              color: 'inherit',
            },
          }),
        ),

        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' } },
          h(ActionButton, {
            label: index + 1 < files.length ? t('cf.saveNext') : t('cf.saveLast'),
            tone: 'primary', onClick: save, busy: busy === 'save',
          }),
          index + 1 >= files.length
            ? h(ActionButton, { label: t('cf.finish'), tone: 'danger', onClick: finish, busy: busy === 'finish' })
            : null,
          h('span', { style: { fontSize: 12, opacity: 0.6 } }, t('cf.finishHint')),
        ),
        h(InlineNote, { tone: note?.tone }, note?.text),
      )
    }

    // ─────────────────── 记忆·配置页（白名单编辑器） ───────────────────

    /**
     * 记忆·配置页：左侧白名单文件列表（按组），右侧多标签编辑。
     *
     * 宿主守卫（lib/hub/memory.js）：白名单硬闸 / JSON 先校验 / 保存前归档 /
     * 基线不一致拒保存（另一台改过）/ 本地 commit 不推送。
     *
     * @param {object} p { t, data, onRefresh }
     */
    function MemoryPage({ t, data, onRefresh }) {
      const [files, setFiles] = useState(null)
      const [error, setError] = useState(null)
      const [tabs, setTabs] = useState([]) // [{path, content, baseSha, dirty, loading}]
      const [activeTab, setActiveTab] = useState(null)
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)
      const [filter, setFilter] = useState('')

      const load = useCallback(async () => {
        setError(null)
        const r = await apiGet('/memory')
        if (!r.ok) { setError(r.error); return }
        setFiles(r.files)
      }, [])
      useEffect(() => { load() }, [load])

      const openFile = async (path) => {
        const existing = tabs.find((x) => x.path === path)
        if (existing) { setActiveTab(path); return }
        setBusy('read')
        const r = await apiPost('/memory', { action: 'read', path })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        setTabs((prev) => [...prev, { path, content: r.content, baseSha: r.sha, dirty: false, group: r.group }])
        setActiveTab(path)
      }

      const closeTab = (path) => {
        setTabs((prev) => prev.filter((x) => x.path !== path))
        if (activeTab === path) {
          const rest = tabs.filter((x) => x.path !== path)
          setActiveTab(rest.length ? rest[rest.length - 1].path : null)
        }
      }

      const edit = (value) => {
        setTabs((prev) => prev.map((x) => (x.path === activeTab ? { ...x, content: value, dirty: true } : x)))
      }

      const save = async () => {
        const tab = tabs.find((x) => x.path === activeTab)
        if (!tab) return
        setBusy('save')
        setNote(null)
        const r = await apiPost('/memory', {
          action: 'save', path: tab.path, content: tab.content, baseSha: tab.baseSha,
        })
        setBusy(null)
        if (!r.ok) {
          setNote({ tone: 'error', text: r.error + (r.hint === 'stale-baseline' ? `\n${t('mm.staleHint')}` : '') })
          return
        }
        setTabs((prev) => prev.map((x) => (x.path === tab.path ? { ...x, dirty: false, baseSha: undefined } : x)))
        setNote({
          tone: 'success',
          text: t('mm.saved', { p: r.path }) + (r.commit ? `（${r.commit}）` : '') + (r.warning ? `\n${r.warning}` : '') + (r.archived ? `\n${t('mm.archived', { n: r.archived })}` : ''),
        })
        load()
        onRefresh()
      }

      const groups = useMemo(() => {
        const q = filter.trim().toLowerCase()
        const map = new Map()
        for (const f of files ?? []) {
          if (q && !f.path.toLowerCase().includes(q)) continue
          if (!map.has(f.group)) map.set(f.group, [])
          map.get(f.group).push(f)
        }
        return map
      }, [files, filter])

      const tab = tabs.find((x) => x.path === activeTab) ?? null

      return h('div', null,
        h(Card, {
          title: t('mm.title'), hint: t('mm.hint'),
          right: h(ActionButton, { label: t('refresh'), small: true, onClick: load }),
        },
          error ? h(InlineNote, { tone: 'error' }, t('error', { e: error })) : null,
          h(InlineNote, { tone: note?.tone }, note?.text),
        ),

        h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
          // 左：文件列表
          h('div', {
            style: {
              flex: '0 0 280px', border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))',
              borderRadius: 10, padding: 8,
              alignSelf: 'stretch', maxHeight: 'calc(100vh - 260px)', overflow: 'auto',
              minWidth: 0,
            },
          },
            h('input', {
              value: filter,
              onChange: (e) => setFilter(e.target.value),
              placeholder: t('mm.search'),
              style: {
                width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: 8,
                fontSize: 12, borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
                background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit',
              },
            }),
            !files
              ? h(Empty, null, t('loading'))
              : [...groups.entries()].map(([group, list]) => h('div', { key: group, style: { marginBottom: 8 } },
                h('div', { style: { fontSize: 11, opacity: 0.5, marginBottom: 3 } }, `${group} · ${list.length}`),
                list.map((f) => h('div', {
                  key: f.path,
                  onClick: () => openFile(f.path),
                  style: {
                    fontSize: 12, padding: '4px 6px', borderRadius: 6, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: activeTab === f.path ? 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.05))' : 'transparent',
                  },
                },
                  f.dirty ? h(Dot, { level: 'warn' }) : null,
                  h('span', {
                    style: {
                      flex: '1 1 auto', fontFamily: 'ui-monospace, monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    },
                    title: f.path,
                  }, (f.path.includes('/') ? f.path.split('/').slice(-2).join('/') : f.path) + (f.dirty ? ' *' : '')),
                )),
              ))),

          // 右：编辑器
          h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            !tab
              ? h(Empty, null, t('mm.pick'))
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                // 标签页条
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                  tabs.map((x) => h('span', {
                    key: x.path,
                    onClick: () => setActiveTab(x.path),
                    style: {
                      fontSize: 12, padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
                      background: activeTab === x.path ? 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.05))' : 'transparent',
                    },
                  },
                    x.path.split('/').slice(-1)[0],
                    x.dirty ? h('span', { style: { opacity: 0.6 } }, '*' ) : null,
                    h('button', {
                      type: 'button',
                      onClick: (e) => { e.stopPropagation(); closeTab(x.path) },
                      'aria-label': t('mm.close'),
                      style: {
                        appearance: 'none', border: 'none', background: 'transparent',
                        cursor: 'pointer', padding: 0, fontSize: 12, opacity: 0.5, lineHeight: 1,
                      },
                    }, '×'),
                  )),
                ),
                // 文件头 + 保存
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('span', {
                    style: { fontSize: 12, opacity: 0.6, fontFamily: 'ui-monospace, monospace', flex: '1 1 auto' },
                  }, tab.path),
                  h(ActionButton, {
                    label: t('mm.save'), tone: 'primary', small: true,
                    onClick: save, busy: busy === 'save', disabled: !tab.dirty,
                  }),
                ),
                h('textarea', {
                  value: tab.content,
                  onChange: (e) => edit(e.target.value),
                  spellCheck: false,
                  style: {
                    width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8,
                    fontSize: 12, lineHeight: '19px', resize: 'vertical',
                    minHeight: 320,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
                    background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit',
                  },
                }),
                h('p', { style: { margin: 0, fontSize: 11, opacity: 0.5 } }, t('mm.saveNote')),
              ),
          ),
        ),
      )
    }

    /** 一页占位：施工期给结构反馈，不假装功能已好。 */
    function PageStub({ t, label }) {
      return h('div', { style: { padding: '24px 0' } },
        h('p', { style: { margin: 0, opacity: 0.6, fontSize: 13 } }, label),
        h('p', { style: { margin: '4px 0 0', opacity: 0.4, fontSize: 12 } }, t('todo.placeholder')),
      )
    }

    /** 页内二级 Tab 条（内容页/知识库页复用）。 */
    function SubTabs({ tabs, active, onPick }) {
      return h('div', {
        role: 'tablist',
        style: {
          display: 'flex', gap: 4, marginBottom: 12,
          borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))',
        },
      }, tabs.map((x) => h('button', {
        key: x.id,
        type: 'button',
        role: 'tab',
        'aria-selected': active === x.id,
        onClick: () => onPick(x.id),
        style: {
          appearance: 'none', border: 'none', background: 'transparent', cursor: 'pointer',
          padding: '7px 12px', fontSize: 13, lineHeight: '20px',
          color: active === x.id
            ? 'var(--dsw-alias-label-primary, inherit)'
            : 'var(--dsw-alias-label-tertiary, inherit)',
          borderBottom: active === x.id ? '2px solid var(--dsw-alias-label-primary, currentColor)' : '2px solid transparent',
          marginBottom: -1,
        },
      }, x.label)))
    }

    /**
     * 通用文件浏览器（v2.5 批2）：列目录 / 读 / 编辑保存 / 删除（=留底）。
     * 守卫全在后端 lib/hub/fileman.js（白名单根/路径消毒/凭据硬墙/删除必留底）。
     * @param {object} p { t, roots:string[], title, hint, onRefresh? }
     */
    function FileManager({ t, roots, title, hint, onRefresh }) {
      const [root, setRoot] = useState(roots[0])
      const [dirPath, setDirPath] = useState('')
      const [entries, setEntries] = useState(null)
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)
      const [editing, setEditing] = useState(null) // {file, text, dirty}
      const [confirmDel, setConfirmDel] = useState(null) // entry 待确认

      const load = useCallback(async () => {
        setEntries(null)
        setNote(null)
        const r = await apiGet(`/files?root=${encodeURIComponent(root)}&path=${encodeURIComponent(dirPath)}`)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); setEntries([]) ; return }
        setEntries(r.entries ?? [])
      }, [root, dirPath])
      useEffect(() => { load() }, [load])

      const segs = dirPath ? dirPath.split('/') : []
      const goDir = (e) => { setEditing(null); setConfirmDel(null); setDirPath(dirPath ? `${dirPath}/${e.name}` : e.name) }
      const goUp = () => { setEditing(null); setConfirmDel(null); setDirPath(segs.slice(0, -1).join('/')) }
      const goSeg = (i) => { setEditing(null); setConfirmDel(null); setDirPath(segs.slice(0, i + 1).join('/')) }

      const openFile = async (e) => {
        setBusy(e.name)
        const r = await apiGet(`/files?root=${encodeURIComponent(root)}&path=${encodeURIComponent(dirPath ? `${dirPath}/${e.name}` : e.name)}&action=read`)
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        setEditing({ file: e.name, text: r.text, dirty: false })
      }

      const doSave = async () => {
        if (!editing) return
        setBusy('save')
        const r = await apiPost('/files', { action: 'save', root, path: dirPath ? `${dirPath}/${editing.file}` : editing.file, text: editing.text })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        setNote({ tone: 'success', text: t('fm.saved', { n: editing.file }) + (r.backup ? `\n${t('fm.oldKept', { p: r.backup })}` : '') })
        setEditing(null)
        load()
        onRefresh?.()
      }

      const doDelete = async (e) => {
        setBusy(e.name)
        const r = await apiPost('/files', { action: 'delete', root, path: dirPath ? `${dirPath}/${e.name}` : e.name })
        setBusy(null)
        setConfirmDel(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        setNote({ tone: 'success', text: `${r.receipt}\n${r.scopeNote}` })
        load()
        onRefresh?.()
      }

      return h(Card, { title, hint },
        // 根切换（多根时）
        roots.length > 1
          ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            roots.map((rk) => h('button', {
              key: rk,
              type: 'button',
              onClick: () => { setRoot(rk); setDirPath(''); setEditing(null) },
              style: {
                appearance: 'none', cursor: 'pointer', fontSize: 12, padding: '4px 10px', borderRadius: 999,
                border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
                background: root === rk ? 'var(--dsw-alias-button-primary-bg, #2563eb)' : 'transparent',
                color: root === rk ? '#fff' : 'inherit',
              },
            }, t(`fm.root.${rk}`))))
          : null,
        // 面包屑
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, flexWrap: 'wrap' } },
          h('button', {
            type: 'button', onClick: () => { setDirPath(''); setEditing(null) },
            style: { appearance: 'none', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', padding: 2, fontSize: 12 },
          }, t(`fm.root.${root}`)),
          ...segs.map((s, i) => h('span', { key: `${s}-${i}`, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h('span', { style: { opacity: 0.4 } }, '/'),
            h('button', {
              type: 'button', onClick: () => goSeg(i),
              style: { appearance: 'none', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', padding: 2, fontSize: 12 },
            }, s)))),
        dirPath
          ? h(ActionButton, { label: t('fm.up'), small: true, onClick: goUp })
          : null,
        // 编辑器
        editing
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 } },
            h('div', { style: { fontSize: 12, fontWeight: 600 } }, `✎ ${editing.file}`),
            h('textarea', {
              value: editing.text,
              onChange: (e) => setEditing({ ...editing, text: e.target.value, dirty: true }),
              rows: 14,
              style: {
                width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12, lineHeight: '17px', padding: 8, borderRadius: 8, resize: 'vertical',
                border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
                background: 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.03))', color: 'inherit',
              },
            }),
            h('div', { style: { display: 'flex', gap: 8 } },
              h(ActionButton, { label: t('fm.save'), tone: 'primary', small: true, onClick: doSave, busy: busy === 'save', disabled: !editing.dirty }),
              h(ActionButton, { label: t('fm.cancel'), small: true, onClick: () => setEditing(null) }),
            ),
          )
          : null,
        // 列表
        entries === null
          ? h(Empty, null, t('loading'))
          : entries.length === 0
            ? h(Empty, null, t('fm.empty'))
            : h('div', {
              style: {
                border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))', borderRadius: 8,
                maxHeight: 280, overflow: 'auto', marginTop: 4,
              },
            },
              entries.map((e) => h('div', {
                key: e.name,
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12,
                  borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.05))',
                },
              },
                h('span', { style: { flex: '0 0 auto' } }, e.dir ? '📁' : '📄'),
                h('span', {
                  style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                }, e.name),
                h('span', { style: { opacity: 0.45, flex: '0 0 auto', fontSize: 11 } },
                  e.dir ? '' : `${humanBytes(e.bytes)} · ${e.mtime}`),
                e.dir
                  ? h(ActionButton, { label: t('fm.open'), small: true, onClick: () => goDir(e) })
                  : textExtOk(e.name)
                    ? h(ActionButton, { label: t('fm.edit'), small: true, onClick: () => openFile(e), busy: busy === e.name })
                    : null,
                confirmDel && confirmDel.name === e.name                  ? h('span', { style: { display: 'inline-flex', gap: 4, flex: '0 0 auto' } },
                    h(ActionButton, { label: t('fm.confirmYes'), small: true, tone: 'danger', onClick: () => doDelete(e), busy: busy === e.name }),
                    h(ActionButton, { label: t('fm.confirmNo'), small: true, onClick: () => setConfirmDel(null) }))
                  : h(ActionButton, { label: t('fm.delete'), small: true, tone: 'danger', onClick: () => setConfirmDel(e) }),
              ))),
        h(InlineNote, { tone: note?.tone }, note?.text),
        h('div', { style: { fontSize: 11, opacity: 0.55, marginTop: 4 } }, t('fm.foot')),
      )
    }

    /** 前端粗判可编辑扩展名（后端 F6 才是硬守卫，这里只决定显不显示编辑按钮）。 */
    const textExtOk = (name) => /\.(md|txt|json|yml|yaml|csv|ini|ps1|js|cjs|mjs|bat|cmd)$/i.test(name)

    /**
     * 📊 状态页（v2.2 D3）：原「总览」+「同步」合并。
     * 上半 = 一屏看完的指标，下半 = 传什么的动作（一键同步 / 范围 / 执行）。
     */
    /**
     * 同步页下半部（v2.5 从设置页搬来）：定时同步 / 自动推送 / 本机备份快照。
     * 与同步操作同属"同步节奏怎么安排"，放一页才不成两截。
     */
    function SyncExtrasPage({ t, data, onRefresh }) {
      const [backups, setBackups] = useState(null)
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)
      const [autoPush, setAutoPush] = useState(false)
      const backupJob = useJob()
      const scheduleJob = useJob()

      useEffect(() => {
        apiGet('/autopush').then((r) => { if (r.ok) setAutoPush(r.enabled === true) }).catch(() => {})
      }, [])

      const loadBackups = useCallback(async () => {
        const r = await apiGet('/content')
        if (r.ok) setBackups(r.backups.backups)
      }, [])
      useEffect(() => { loadBackups() }, [loadBackups])

      const act = async (action, body) => {
        setBusy(action)
        setNote(null)
        const r = await apiPost('/content', { action, ...(body ?? {}) })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: t('mt.msg.restoreFail', { e: r.error }) }); return r }
        return r
      }

      const doBackup = async () => {
        const r = await backupJob.run(() => apiPost('/content', { action: 'backup' }))
        if (r?.ok) loadBackups()
      }
      const doRestore = async (name) => {
        const r = await act('restore', { name })
        if (r?.ok) {
          setNote({
            tone: 'success',
            text: t('mt.msg.restored', { name }) + (r.preRestore ? `\n${t('mt.msg.preRestore', { name: r.preRestore })}` : ''),
          })
        }
      }
      const doDelete = async (name) => {
        const r = await act('delete', { name })
        if (r?.ok) {
          setNote({ tone: 'success', text: t('mt.msg.deleted', { name }) })
          loadBackups()
        }
      }
      const doSchedule = async (action) => {
        const r = await scheduleJob.run(() => apiPost('/env', { action }))
        if (r?.ok) onRefresh()
      }

      return h('div', null,
        // 定时同步 + 自动推送（并排：都是"同步节奏"开关）
        h(Grid, { min: 280 },
          h(Card, {
            title: t('mt.schedule'), hint: t('mt.scheduleHint'),
            right: data?.schedule?.installed
              ? h(ActionButton, { label: t('mt.scheduleRemove'), small: true, onClick: () => doSchedule('schedule-remove'), busy: scheduleJob.running })
              : h(ActionButton, { label: t('mt.scheduleInstall'), small: true, tone: 'primary', onClick: () => doSchedule('schedule-install'), busy: scheduleJob.running }),
          },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
              h(Dot, { level: data?.schedule?.installed ? 'pass' : 'info' }),
              h('span', null, data?.schedule?.installed ? t('mt.scheduleOn') : t('mt.scheduleOff')),
              data?.schedule?.nextRun ? h('span', { style: { opacity: 0.6, fontSize: 12 } }, t('mt.scheduleNext', { t: data.schedule.nextRun })) : null,
            ),
            h(JobView, {
              t, job: scheduleJob, title: t('mt.schedule'),
              detail: scheduleJob.result
                ? (scheduleJob.result.partial ? scheduleJob.result.error : t(scheduleJob.result.tasks ? 'mt.msg.scheduleOn' : 'mt.msg.scheduleOff'))
                : null,
              onReset: scheduleJob.reset,
            }),
          ),
          // N7 自动推送开关（记忆页保存后是否立即 push；默认关）
          h(Card, { title: t('ap.title'), hint: t('ap.hint') },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
              h(Dot, { level: autoPush ? 'pass' : 'info' }),
              h('span', { style: { flex: '1 1 auto' } }, autoPush ? t('ap.on') : t('ap.off')),
              h(ActionButton, {
                label: autoPush ? t('ap.turnOff') : t('ap.turnOn'),
                small: true,
                tone: autoPush ? undefined : 'primary',
                onClick: async () => {
                  const r = await apiPost('/autopush', { enabled: !autoPush })
                  if (r.ok) setAutoPush(!autoPush)
                },
              }),
            ),
          ),
        ),

        // 本机备份快照
        h(Card, {
          title: t('mt.backup'), hint: t('mt.backupHint'),
          right: h(ActionButton, { label: t('mt.backupNow'), tone: 'primary', small: true, onClick: doBackup, busy: backupJob.running }),
        },
          h(JobView, {
            t, job: backupJob, title: t('mt.backupNow'),
            detail: backupJob.result ? t('mt.msg.backed', { n: backupJob.result.created?.length ?? 0 }) : null,
            onReset: backupJob.reset,
          }),
          h(InlineNote, { tone: note?.tone }, note?.text),
          h('div', { style: { marginTop: 4 } },
            h('div', { style: { fontSize: 12, opacity: 0.6, marginBottom: 4 } }, t('mt.backups')),
            !backups
              ? h(Empty, null, t('loading'))
              : backups.length === 0
                ? h(Empty, null, t('mt.backupsEmpty'))
                : h('div', {
                  style: {
                    maxHeight: 220, overflow: 'auto',
                    border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))', borderRadius: 8,
                  },
                },
                  backups.slice(0, 40).map((b) => h('div', {
                    key: b.name,
                    style: {
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                      fontSize: 12, borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.05))',
                    },
                  },
                    h('span', {
                      style: { flex: '1 1 auto', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    }, b.name),
                    h('span', { style: { opacity: 0.5, flex: '0 0 auto' } }, humanBytes(b.bytes)),
                    h(ActionButton, { label: t('mt.restore'), small: true, onClick: () => doRestore(b.name), busy: busy === 'restore' }),
                    h(ActionButton, { label: t('mt.delete'), small: true, tone: 'danger', onClick: () => doDelete(b.name), busy: busy === 'delete' }),
                  )),
                ),
          ),
        ),
      )
    }

    /**
     * 🔄 同步页（v2.5：同步的事一页说完）。
     * 同步操作（一键/范围/手动挡）+ 定时同步 + 自动推送 + 本机备份快照。
     * 原来分散在状态页（操作）和设置页（定时/自动推送/备份），老大反馈"分散混乱"。
     */
    function SyncPageWrapper({ t, data, onRefresh }) {
      return h('div', null,
        h(SyncPage, { t, data, onRefresh }),
        h('div', { style: { height: 12 } }),
        h(SyncExtrasPage, { t, data, onRefresh }),
      )
    }

    function StatusPage({ t, data, onRefresh, onGoSync }) {
      return h('div', null,
        h(OverviewPage, { t, data, onGoSync }),
      )
    }

    /**
     * 📁 内容页（v2.2 D3）：原「技能」+「记忆配置」+「会话」合并为三 Tab。
     * 都是"传什么"的内容，Tab 切换省去顶层页签来回跳。
     */
    /**
     * 📁 内容页（v2.5 批2）：记忆 / 技能 / 插件 / 会话 四 Tab。
     * 技能与插件从"只能看"升级为"能管"（FileManager），会话补管理区。
     */
    function ContentPage({ t, data, onRefresh }) {
      const [tab, setTab] = useState('memory')
      const tabs = [
        { id: 'memory', label: t('page.memory') },
        { id: 'skills', label: t('page.skills') },
        { id: 'plugins', label: t('page.plugins') },
        { id: 'sessions', label: t('page.sessionsArchive') },
      ]
      return h('div', null,
        h(SubTabs, { tabs, active: tab, onPick: setTab }),
        // v2.5：语义常驻说明（老大"有歧义必须说清楚"铁律第一条实例）
        h('div', {
          style: {
            fontSize: 12, lineHeight: '18px', opacity: 0.75, marginBottom: 10,
            padding: '6px 8px', borderRadius: 8,
            background: 'var(--dsw-alias-bg-fill-subtle, rgba(0,0,0,0.04))',
          },
        },
          h('div', null, t('content.scopeLine')),
          h('div', null, t('content.deleteLine')),
        ),
        tab === 'memory' ? h(MemoryPage, { t, data, onRefresh })
          : tab === 'skills' ? h('div', null,
            h(SkillsPage, { t, data, onRefresh }),
            h('div', { style: { height: 12 } }),
            h(FileManager, {
              t, roots: ['hub/skills', 'local/skills'], onRefresh,
              title: t('fm.skillsTitle'), hint: t('fm.skillsHint'),
            }),
          )
            : tab === 'plugins' ? h(FileManager, {
              t, roots: ['hub/config', 'hub/plugins'], onRefresh,
              title: t('fm.pluginsTitle'), hint: t('fm.pluginsHint'),
            })
              : tab === 'sessions' ? h('div', null,
                h(SessionsPage, { t, data, onRefresh }),
                h('div', { style: { height: 12 } }),
                h(FileManager, {
                  t, roots: ['hub/session-backup'], onRefresh,
                  title: t('fm.sessionsTitle'), hint: t('fm.sessionsHint'),
                }),
              )
                : null,
      )
    }

    /**
     * 📚 知识库页（v2.2 D5）：IMA 为主。
     * 投喂（手机 App）→ 云端知识库 → 电脑端 dsh-ima-copilot 随时问。
     * 中枢只管 memory/ 与 skills/，不建 wiki/ 轨道（避免两套维护）。
     */
    function KnowledgePage({ t, data }) {
      const [q, setQ] = useState('')
      const [state, setState] = useState({ kind: 'idle', text: null })
      const [ask, setAsk] = useState('')

      return h('div', null,
        // IMA 状态 + 问答
        h(Card, { title: t('kb.title'), hint: t('kb.hint') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
            h(Dot, { level: 'pass' }),
            h('span', null, t('kb.installed')),
          ),
          h(InlineNote, { tone: 'info' }, t('kb.divide')),
          // 问一句
          h('div', { style: { display: 'flex', gap: 6, marginTop: 4 } },
            h('input', {
              value: ask,
              onChange: (e) => setAsk(e.target.value),
              placeholder: t('kb.askPlaceholder'),
              style: {
                flex: '1 1 auto', minWidth: 0, padding: '7px 10px', fontSize: 13, borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
                background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit',
              },
            }),
            h(ActionButton, {
              label: t('kb.ask'), tone: 'primary',
              disabled: !ask.trim(),
              onClick: () => { setState({ kind: 'idle', text: t('kb.askViaModel') }) },
            }),
          ),
          state.text ? h(InlineNote, { tone: state.kind }, state.text) : null,
        ),

        // 凭据未配时的图文指引
        h(Card, { title: t('kb.setup'), hint: t('kb.setupHint') },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, lineHeight: '20px', opacity: 0.8 } },
            h('div', { style: { fontWeight: 600, opacity: 1 } }, `1. ${t('kb.step1')}`),
            h('div', null, t('kb.step1Body')),
            h('div', { style: { fontWeight: 600, opacity: 1, marginTop: 4 } }, `2. ${t('kb.step2')}`),
            h('div', null, t('kb.step2Body')),
            h('div', { style: { fontWeight: 600, opacity: 1, marginTop: 4 } }, `3. ${t('kb.step3')}`),
            h('div', null, t('kb.step3Body')),
          ),
        ),

        // 手机投喂 + 分工
        h(Grid, { min: 300 },
          h(Card, { title: t('kb.mobile'), hint: t('kb.mobileHint') },
            h('div', { style: { fontSize: 12, opacity: 0.75, lineHeight: '20px' } },
              `${t('kb.mobile1')}\n${t('kb.mobile2')}\n${t('kb.mobile3')}`),
          ),
          h(Card, { title: t('kb.split'), hint: t('kb.splitHint') },
            h('div', { style: { fontSize: 12, opacity: 0.75, lineHeight: '20px' } }, t('kb.splitBody')),
          ),
        ),
      )
    }

    // ─────────────────── 面板骨架 ───────────────────

    // ─────────────────── 首次运行引导（onboarding） ───────────────────

    /**
     * 首次运行向导：没有中枢时，整面板换成它。
     * 两步：① 指路径（已有中枢）或 ② 克隆（还没有）；凭据缺失时先提示。
     *
     * @param {object} p { t, onReady } —— onReady 在配置完成后回调（触发重载）。
     */
    function Onboarding({ t, onReady }) {
      const [info, setInfo] = useState(null)
      const [hubPath, setHubPath] = useState('')
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)

      useEffect(() => {
        apiGet('/onboarding').then((r) => {
          if (r.ok) {
            setInfo(r)
            setHubPath(r.savedPath ?? r.hubPath ?? '')
          }
        }).catch((e) => setNote({ tone: 'error', text: String(e?.message ?? e) }))
      }, [])

      const savePath = async () => {
        setBusy('save')
        setNote(null)
        const r = await apiPost('/onboarding', { action: 'save-path', path: hubPath })
        setBusy(null)
        if (!r.ok) { setNote({ tone: 'error', text: r.error }); return }
        if (r.resolved?.needsOnboarding) {
          setNote({ tone: 'warn', text: t('ob.savedButIncomplete', { p: r.resolved.hub }) })
          return
        }
        setNote({ tone: 'success', text: t('ob.saved') })
        onReady()
      }

      const clone = async () => {
        setBusy('clone')
        setNote(null)
        const r = await apiPost('/onboarding', { action: 'clone', target: hubPath })
        setBusy(null)
        if (!r.ok) {
          setNote({ tone: 'error', text: r.error + (r.hint ? `\n${r.hint}` : '') })
          return
        }
        setNote({ tone: 'success', text: t('ob.cloned', { p: r.target }) })
        onReady()
      }

      const gitOk = Boolean(info?.git)
      const credOk = Boolean(info?.credential?.haveCredential)

      return h('div', {
        style: { maxWidth: 560, margin: '0 auto', paddingTop: 24 },
        'data-sync-hub-onboarding': 'wizard',
      },
        h('h2', { style: { margin: '0 0 4px', fontSize: 17, fontWeight: 600 } }, t('ob.title')),
        h('p', { style: { margin: '0 0 16px', fontSize: 13, opacity: 0.7, lineHeight: '20px' } }, t('ob.subtitle')),

        // 环境体检行
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginBottom: 16, fontSize: 13 } },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
            h(Dot, { level: gitOk ? 'pass' : 'fail' }), `git ${info?.git ?? t('ob.checking')}`),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
            h(Dot, { level: credOk ? 'pass' : 'warn' }),
            credOk ? t('ob.credOk', { user: info.credential.user }) : t('ob.credMissing')),
        ),
        !credOk
          ? h(InlineNote, { tone: 'warn' }, t('ob.credHint'))
          : null,

        // 路径输入 + 两个动作
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('label', { style: { fontSize: 12, opacity: 0.7 } }, t('ob.pathLabel')),
          h('input', {
            value: hubPath,
            onChange: (e) => setHubPath(e.target.value),
            placeholder: t('ob.pathPlaceholder'),
            spellCheck: false,
            style: {
              padding: '8px 10px', borderRadius: 8, fontSize: 13,
              border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
              background: 'var(--dsw-alias-bg-base, transparent)',
              color: 'inherit', fontFamily: 'ui-monospace, monospace',
            },
          }),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            h(ActionButton, {
              label: t('ob.useExisting'), tone: 'primary',
              onClick: savePath, busy: busy === 'save',
              disabled: !hubPath.trim(),
            }),
            h(ActionButton, {
              label: t('ob.clone'), onClick: clone, busy: busy === 'clone',
              disabled: !hubPath.trim() || !gitOk,
              title: gitOk ? undefined : t('ob.needGit'),
            }),
          ),
          h(InlineNote, { tone: note?.tone }, note?.text),
          h('p', { style: { margin: '8px 0 0', fontSize: 12, opacity: 0.55, lineHeight: '18px' } }, t('ob.explain')),
        ),
      )
    }

    /**
     * 同步中枢主面板（main 插槽 key = PANEL_ID 的正文）。
     *
     * 标准 props 由框架免费提供：useResource / useWorkspaces / usePanelInfo /
     * useSessions / t / renderSlot；另有本插件 inject 注入的字段。
     *
     * @param {object} p 框架 props（含 t）。
     */
    function SyncHubPanel(p) {
      const t = typeof p.t === 'function' ? p.t : makeT(p.ctx ?? {}).t
      const [pageId, setPageId] = useState('status')
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [needsOnboarding, setNeedsOnboarding] = useState(false)

      const refresh = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const r = await apiGet('/overview')
          if (r.ok) {
            setNeedsOnboarding(false)
            setData(r)
          } else if (r.stage === 'no-hub') {
            // 没中枢：进入首次运行引导，而不是亮一片"—"
            setNeedsOnboarding(true)
            setData(null)
          } else {
            throw new Error(r.error || 'unknown')
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => { refresh() }, [refresh])

      const goSync = useCallback(() => setPageId('sync'), [])

      const page = PAGES.find((x) => x.id === pageId) ?? PAGES[0]

      // 首次运行：整面板换成向导（不渲染页签与状态条，避免一片"—"误导）
      if (needsOnboarding && !loading) {
        return h('div', {
          style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'auto' },
          'data-sync-hub-panel': PANEL_ID,
        }, h(Onboarding, { t, onReady: refresh }))
      }

      let body
      if (loading && !data) body = h(Empty, null, t('loading'))
      else if (error && !data) {
        body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' } },
          h(InlineNote, { tone: 'error' }, t('error', { e: error })),
          h(ActionButton, { label: t('retry'), small: true, onClick: refresh }),
        )
      } else if (pageId === 'status') body = h(StatusPage, { t, data, onRefresh: refresh, onGoSync: goSync })
      else if (pageId === 'sync') body = h(SyncPageWrapper, { t, data, onRefresh: refresh })
      else if (pageId === 'content') body = h(ContentPage, { t, data, onRefresh: refresh })
      else if (pageId === 'knowledge') body = h(KnowledgePage, { t, data })
      else if (pageId === 'settings') body = h(MaintainPage, { t, data, onRefresh: refresh })
      else body = h(PageStub, { t, label: t(page.labelKey) })

      return h('div', {
        style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
        'data-sync-hub-panel': PANEL_ID,
      },
        // 全局状态条
        h(StatusBar, { t, data }),
        // 页签条：固定尺寸，不随内容跳动（memory 4.20）。
        h('div', {
          role: 'tablist', 'aria-label': t('panel'),
          style: {
            display: 'flex', gap: 4, padding: '8px 20px 0',
            borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08))',
            flex: '0 0 auto',
          },
        }, PAGES.map((x) => h('button', {
          key: x.id,
          type: 'button',
          role: 'tab',
          'aria-selected': pageId === x.id,
          onClick: () => setPageId(x.id),
          style: {
            appearance: 'none', border: 'none', background: 'transparent', cursor: 'pointer',
            padding: '8px 12px', fontSize: 13, lineHeight: '20px',
            color: pageId === x.id
              ? 'var(--dsw-alias-label-primary, inherit)'
              : 'var(--dsw-alias-label-tertiary, inherit)',
            borderBottom: pageId === x.id
              ? '2px solid var(--dsw-alias-border-brand, currentColor)'
              : '2px solid transparent',
          },
          'data-sync-hub-tab': x.id,
        }, t(x.labelKey)))),
        // 页体
        h('div', {
          style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '12px 20px 20px' },
          'data-sync-hub-page': pageId,
        },
          h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 } },
            h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, t(page.labelKey)),
            h(ActionButton, { label: t('refresh'), small: true, onClick: refresh, busy: loading }),
          ),
          body,
        ),
      )
    }

    /**
     * 侧栏入口图标。
     * 收 owner 提供的 { size, active }（SidebarPanelIconOwnerProps），
     * 图标用 primitives 官方语义图标（决策 D18）。
     */
    function PanelIcon({ size }) {
      return h(P.IconCompareSplitOutlineMedium, { size })
    }

    /**
     * 客户端插件入口。
     * @param {object} ctx client root context。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)

      // ① 文案：扁平键，官方解析。
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'sync-hub: dictionaries')

      // ② 侧栏入口（与插件管理器 / 任务管理器同一插槽）。
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
