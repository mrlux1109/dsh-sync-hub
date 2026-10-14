/**
 * lib/tools.js —— 12 个 sync_hub_* 模型工具（P0 功能审计回补）。
 *
 * 背景（功能审计 2026-10-15）：v2.0 重写时工具层未移植，15 个旧工具全部消失。
 * 本模块按审计裁决补 12 个：
 *   status / push / pull / version / open_console / backup / backup_list /
 *   skill_list / skill_toggle / skill_import / skill_create / plugin_list
 *   （plugin_install/uninstall/update 不补——D6：官方 dshmarket 接管）
 *
 * 与旧版的本质区别：execute 不再 spawn powershell 跑 ps1，
 * **直接调用 lib/hub/* 模块**——执行层统一（D11），工具只是模块的薄壳。
 *
 * 注册契约（memory 4.17，宿主实证）：
 *   · ctx.tools.register(裸对象)，不 import '@deepseek-ai/dsh-tools'；
 *   · parameters/output.schema 用标准 JSON Schema（required 是数组）；
 *   · output.render 必须是函数；
 *   · execute(args, exec) 返回值对象；exec.signal 观察取消。
 *
 * @module lib/tools.js
 */

import { hubStatus, hubInventory, hubLog } from './hub/status.js'
import { push, pull } from './hub/sync.js'
import { listBackups, createBackup } from './hub/snapshot.js'
import { compareSkills, scanSkills } from './hub/skills.js'
import { savedMachineId, listMachines } from './hub/apply.js'
import { dshHome } from './hub/snapshot.js'
import fs from 'node:fs'
import path from 'node:path'

/** 统一输出 schema（旧版同款：{ok, code, text}）。 */
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    code: { type: 'number' },
    text: { type: 'string' },
  },
  required: ['ok', 'code', 'text'],
  additionalProperties: false,
}

const OUT = {
  schema: RESULT_SCHEMA,
  render(_args, value) {
    const text = value && typeof value.text === 'string' ? value.text : JSON.stringify(value)
    return [{ type: 'text', text }]
  },
}

const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false }

const RESULT = (ok, code, text) => ({ ok, code, text: String(text ?? '') })

/** 节流输出：截尾到 ~3000 字符，AI 上下文友好。 */
const tail = (s) => {
  const t = String(s ?? '')
  return t.length > 3000 ? `…（截断）\n${t.slice(-3000)}` : t
}

/**
 * 注册全部工具（由 index.js 的 apply 调用）。
 *
 * @param {object} ctx cordis 上下文（含 ctx.tools）。
 * @param {object} deps { config, getHub: () => string|null }。
 * @returns {number} 成功注册的工具数。
 */
export function registerTools(ctx, { config, getHub }) {
  if (!ctx.tools || typeof ctx.tools.register !== 'function') {
    ctx.logger?.error?.('[dsh-sync-hub] tools service missing - sync tools NOT registered')
    return 0
  }
  const noHub = () => RESULT(false, -1,
    '未找到中枢仓库（试过 config.hubPath / SYNC_HUB_PATH / 偏好文件 / 常规位置）。'
    + '修复：在同步中枢面板的首次引导里指定路径，或在中枢里 clone 后重试。')

  const reg = (def) => {
    try { ctx.tools.register(def); return true } catch (e) {
      ctx.logger?.error?.('[dsh-sync-hub] tool registration failed for ' + def.name + ': ' + String(e))
      return false
    }
  }

  let registered = 0

  // ① status —— 只读状态
  if (reg({
    name: 'sync_hub_status',
    description:
      '查看跨机记忆同步中枢(sync-hub)状态, 只读无副作用: 分支/待推送/待拉取/未提交/技能数/机器档案。'
      + '用户问"同步状态/差多少/有什么要传/更新了吗"时用它, 也是 sync_hub_push 前必须先跑的确认步骤。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async (_args, exec) => {
      const hub = getHub()
      if (!hub) return noHub()
      const [st, inv] = await Promise.all([
        hubStatus(hub, { signal: exec?.signal }).catch((e) => ({ ok: false, error: String(e?.message ?? e) })),
        Promise.resolve(hubInventory(hub)),
      ])
      if (!st.ok) return RESULT(false, 1, `读取失败：${st.error}`)
      const lines = [
        `分支 ${st.branch ?? '?'} · 待推送 ${st.ahead ?? 0} · 待拉取 ${st.behind ?? 0} · 未提交 ${st.dirtyCount}`,
        ...(st.dirtyCount > 0 ? ['未提交文件：', ...st.dirty.slice(0, 15).map((d) => `  ${d.code} ${d.file}`)] : []),
        `技能 ${inv.skills} · 机器档案 ${inv.machines} · 工具 ${inv.tools}`,
        st.lastCommit ? `最近提交 ${st.lastCommit.hash} ${st.lastCommit.subject}` : '',
      ]
      return RESULT(true, 0, tail(lines.filter(Boolean).join('\n')))
    },
  })) registered += 1

  // ② push
  if (reg({
    name: 'sync_hub_push',
    description:
      '把本机 sync-hub 改动推送到 Gitee (上传备份)。必须先跑 sync_hub_status 让用户看到差异并确认后再调用。'
      + 'categories 控制范围: memory=记忆, skills=技能, config=配置, plugins=插件清单, sessions=会话备份, dshconfig=DSH运行配置, pluginsrc=插件源码; 省略=全部。'
      + '用户说"上传/推上去/备份记忆/同步给另一台"时用。冲突时返回冲突文件清单, 不要自动解决。',
    parameters: {
      type: 'object',
      properties: {
        categories: { type: 'array', items: { type: 'string' }, description: '上传范围（见描述），省略=全部' },
        skills: { type: 'array', items: { type: 'string' }, description: '只上传这些技能名（省略=全部）' },
        sessions: { type: 'array', items: { type: 'string' }, description: '只上传这些会话工作区名（省略=全部）' },
        message: { type: 'string', description: '提交说明（进 git log）' },
      },
      additionalProperties: false,
    },
    output: OUT,
    execute: async (args, exec) => {
      const hub = getHub()
      if (!hub) return noHub()
      const r = await push(hub, {
        scopes: args?.categories,
        skills: args?.skills,
        sessions: args?.sessions,
        message: args?.message,
        signal: exec?.signal,
      })
      if (!r.ok) return RESULT(false, r.conflict ? 2 : r.stage === 'secret-guard' ? 3 : 1, tail(r.error))
      return RESULT(true, 0, `已推送 ${r.fileCount} 个文件（${r.commit}）${r.subject ? `：${r.subject}` : ''}`)
    },
  })) registered += 1

  // ③ pull
  if (reg({
    name: 'sync_hub_pull',
    description:
      '从 Gitee 拉取另一台电脑的改动并应用到本机 (pull --rebase)。退出码 2 = 冲突：停下向用户报告冲突文件，'
      + '不要自动解决（用同步面板的冲突解决器或控制台处理）。用户说"拉取/同步下来/拿最新"时用。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async (_args, exec) => {
      const hub = getHub()
      if (!hub) return noHub()
      const r = await pull(hub, { signal: exec?.signal })
      if (!r.ok) return RESULT(false, r.conflict ? 2 : 1, tail(r.error))
      return RESULT(true, 0, `已拉取（${r.commit ?? ''}）${r.subject ? `：${r.subject}` : ''}。涉及记忆/插件的改动重启 DSH 后完整生效。`)
    },
  })) registered += 1

  // ④ version
  if (reg({
    name: 'sync_hub_version',
    description: '中枢版本速览（VERSION 文件 + 最近提交 + 技能/机器档案计数），只读轻量。用户问"中枢什么版本"时用。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const hub = getHub()
      if (!hub) return noHub()
      const inv = hubInventory(hub)
      const log = await hubLog(hub, { limit: 1 }).catch(() => ({ ok: false, commits: [] }))
      const c = log.ok ? log.commits[0] : null
      return RESULT(true, 0, [
        `VERSION：${fs.readFileSync(path.join(hub, 'VERSION'), 'utf8').trim()}`,
        c ? `最近提交：${c.hash.slice(0, 7)} ${c.subject}（${c.date}）` : '（无提交）',
        `技能 ${inv.skills} · 机器档案 ${inv.machines} · 工具 ${inv.tools} · 配置 ${inv.configs}`,
      ].join('\n'))
    },
  })) registered += 1

  // ⑤ open_console —— 打开 .bat 控制台窗口（高危人工流程入口，D20）
  if (reg({
    name: 'sync_hub_open_console',
    description:
      '打开同步中枢的 .bat 控制台窗口（给用户自己操作的彩色菜单）。'
      + '换机器身份（要手输 YES）、全自动一条龙、冲突人工处理这类必须人工确认的流程只能在那里做。'
      + '用户说"打开控制台/换机器身份"时用。注意：会真的弹出一个控制台窗口。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const hub = getHub()
      if (!hub) return noHub()
      const bat = path.join(hub, '同步中枢.bat')
      if (!fs.existsSync(bat)) {
        // 兜底：找 sync.cmd / menu.ps1
        const alt = ['sync.cmd', 'tools/menu.ps1'].map((r) => path.join(hub, r)).find((p) => fs.existsSync(p))
        if (!alt) return RESULT(false, 1, '中枢里没找到 同步中枢.bat / sync.cmd / tools/menu.ps1')
        const { spawn } = await import('node:child_process')
        const child = spawn('cmd', ['/c', 'start', '', alt.replace(/tools[\\/]menu\.ps1$/, 'tools\\menu.ps1')],
          { detached: true, stdio: 'ignore', windowsHide: false })
        child.unref()
        return RESULT(true, 0, `已打开 ${path.basename(alt)}`)
      }
      const { spawn } = await import('node:child_process')
      const child = spawn('cmd', ['/c', 'start', '', bat], { detached: true, stdio: 'ignore', windowsHide: false })
      child.unref()
      return RESULT(true, 0, '已打开 同步中枢.bat 控制台窗口')
    },
  })) registered += 1

  // ⑥ backup —— 立即备份
  if (reg({
    name: 'sync_hub_backup',
    description: '立即创建本机备份快照（AGENTS.md + 各 profile 的 package.json）。用户改记忆/插件配置前说"先备份一下"时用。备份永不自动删除。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const r = createBackup()
      if (!r.ok) return RESULT(false, 1, r.error)
      return RESULT(true, 0, `已创建 ${r.created.length} 份快照：\n${r.created.join('\n')}`)
    },
  })) registered += 1

  // ⑦ backup_list
  if (reg({
    name: 'sync_hub_backup_list',
    description: '列出本机备份快照（名称/大小/时间），只读。恢复请到同步中枢面板的维护页。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const r = listBackups()
      if (!r.ok) return RESULT(false, 1, r.error)
      if (r.backups.length === 0) return RESULT(true, 0, '（还没有备份）')
      return RESULT(true, 0, tail(r.backups.slice(0, 30).map((b) => `${b.name}  ${Math.round(b.bytes / 1024)}KB  ${b.mtime.slice(0, 16).replace('T', ' ')}`).join('\n')))
    },
  })) registered += 1

  // ⑧ skill_list —— 双侧对比
  if (reg({
    name: 'sync_hub_skill_list',
    description:
      '对比本机与中枢的技能分布（只读）：一致/仅本机/仅中枢/两边不同 各多少，并列出差异清单。'
      + '非法名（非 kebab-case）也会列出——DSH 会静默跳过它们。用户问"技能有哪些/两边差多少"时用。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const hub = getHub()
      if (!hub) return noHub()
      const r = compareSkills(hub)
      const lines = [
        `一致 ${r.summary.identical} · 仅本机 ${r.summary.onlyLocal} · 仅中枢 ${r.summary.onlyHub} · 两边不同 ${r.summary.differ}`,
      ]
      const interesting = r.diff.filter((d) => d.kind !== 'identical')
      if (interesting.length) lines.push('', ...interesting.slice(0, 30).map((d) => `${d.kind.padEnd(10)} ${d.name}`))
      if (r.summary.invalidLocal.length) lines.push('', `⚠ 非法名（DSH 静默跳过）：${r.summary.invalidLocal.join('、')}`)
      return RESULT(true, 0, tail(lines.join('\n')))
    },
  })) registered += 1

  // ⑨ skill_toggle —— 启用/停用（重命名 SKILL.md ↔ .disabled）
  if (reg({
    name: 'sync_hub_skill_toggle',
    description:
      '启用或停用一个本机 DSH 技能（重命名 SKILL.md ↔ SKILL.md.disabled，完全可逆，不删内容）。'
      + '停用后 DSH 不再加载该技能。skillName 用 kebab-case 名。',
    parameters: {
      type: 'object',
      properties: {
        skillName: { type: 'string', description: '技能名（kebab-case）' },
        enable: { type: 'boolean', description: 'true=启用, false=停用' },
      },
      required: ['skillName', 'enable'],
      additionalProperties: false,
    },
    output: OUT,
    execute: async (args) => {
      const name = String(args?.skillName ?? '').trim()
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return RESULT(false, 1, `技能名不合法（要 kebab-case）：${name}`)
      const dir = path.join(dshHome(), 'skills', name)
      const on = path.join(dir, 'SKILL.md')
      const off = path.join(dir, 'SKILL.md.disabled')
      if (args?.enable === true) {
        if (!fs.existsSync(off)) return RESULT(false, 1, fs.existsSync(on) ? '已经是启用状态' : `技能不存在：${name}`)
        fs.renameSync(off, on)
        return RESULT(true, 0, `已启用 ${name}`)
      }
      if (!fs.existsSync(on)) return RESULT(false, 1, fs.existsSync(off) ? '已经是停用状态' : `技能不存在或没有 SKILL.md：${name}`)
      fs.renameSync(on, off)
      return RESULT(true, 0, `已停用 ${name}（重命名 SKILL.md → .disabled，可逆）`)
    },
  })) registered += 1

  // ⑩ skill_import —— 从网址导入（git clone 到临时目录再拷技能目录）
  if (reg({
    name: 'sync_hub_skill_import',
    description:
      '从 GitHub 仓库地址导入一个技能到本机 DSH 技能目录。gitUrl 是仓库地址；'
      + '可选 skillPath 指仓库内的技能子目录。同名技能绝不覆盖。',
    parameters: {
      type: 'object',
      properties: {
        gitUrl: { type: 'string', description: 'GitHub 仓库地址（https）' },
        skillPath: { type: 'string', description: '仓库内技能子目录（省略=仓库根就是技能）' },
      },
      required: ['gitUrl'],
      additionalProperties: false,
    },
    output: OUT,
    execute: async (args, exec) => {
      const url = String(args?.gitUrl ?? '').trim()
      if (!/^https:\/\//.test(url)) return RESULT(false, 1, 'gitUrl 必须是 https 地址')
      const { run } = await import('./exec.js')
      const os = await import('node:os')
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-imp-'))
      try {
        const clone = await run('git', ['clone', '--depth', '1', url, tmp], { timeoutMs: 300_000, signal: exec?.signal })
        if (!clone.ok) return RESULT(false, 1, `克隆失败：${tail(`${clone.stdout}\n${clone.stderr}`)}`)
        const srcDir = args?.skillPath ? path.join(tmp, ...String(args.skillPath).split('/')) : tmp
        const skillMd = path.join(srcDir, 'SKILL.md')
        if (!fs.existsSync(skillMd)) return RESULT(false, 1, `${args?.skillPath ?? '仓库根'} 里没有 SKILL.md（可用 skillPath 指子目录）`)
        const name = path.basename(srcDir)
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
          return RESULT(false, 1, `目录名 "${name}" 不是 kebab-case，请手动改名后用技能面板导入`)
        }
        const dst = path.join(dshHome(), 'skills', name)
        if (fs.existsSync(path.join(dst, 'SKILL.md')) || fs.existsSync(path.join(dst, 'SKILL.md.disabled'))) {
          return RESULT(false, 1, `同名技能已存在，不覆盖：${name}（先停用/删除再导）`)
        }
        fs.mkdirSync(dst, { recursive: true })
        const copy = (from, to) => {
          for (const e of fs.readdirSync(from, { withFileTypes: true })) {
            if (e.name === '.git') continue
            const s = path.join(from, e.name); const t = path.join(to, e.name)
            if (e.isDirectory()) { fs.mkdirSync(t, { recursive: true }); copy(s, t) } else fs.copyFileSync(s, t)
          }
        }
        copy(srcDir, dst)
        return RESULT(true, 0, `已导入技能 ${name} → ${dst}`)
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    },
  })) registered += 1

  // ⑪ skill_create —— 新建技能
  if (reg({
    name: 'sync_hub_skill_create',
    description: '新建一个本机 DSH 技能（生成目录 + SKILL.md 骨架）。name 必须 kebab-case；description 必填（决定何时被调用）。同名不覆盖。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名（kebab-case）' },
        description: { type: 'string', description: '技能描述（frontmatter description，必填）' },
        body: { type: 'string', description: 'SKILL.md 正文（可省略，给骨架）' },
      },
      required: ['name', 'description'],
      additionalProperties: false,
    },
    output: OUT,
    execute: async (args) => {
      const name = String(args?.name ?? '').trim()
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return RESULT(false, 1, `名字必须 kebab-case：${name}`)
      const desc = String(args?.description ?? '').trim()
      if (!desc) return RESULT(false, 1, 'description 必填（决定技能何时被调用）')
      const dst = path.join(dshHome(), 'skills', name)
      if (fs.existsSync(dst)) return RESULT(false, 1, `已存在：${name}（不覆盖）`)
      const fm = `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n${args?.body ?? '（在此写技能正文）'}\n`
      fs.mkdirSync(dst, { recursive: true })
      fs.writeFileSync(path.join(dst, 'SKILL.md'), fm, 'utf8')
      return RESULT(true, 0, `已创建技能 ${name} → ${path.join(dst, 'SKILL.md')}`)
    },
  })) registered += 1

  // ⑫ plugin_list —— 只读（install/uninstall/update 不补：官方 dshmarket 接管）
  if (reg({
    name: 'sync_hub_plugin_list',
    description:
      '列出本机各 profile 已装插件与挂载状态（只读）。用户问"装了哪些插件/xx插件装了吗"时用。'
      + '安装/卸载/更新请引导用户用官方 设置 → 插件（dshmarket）。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async () => {
      const profRoot = path.join(dshHome(), 'profiles')
      const lines = []
      let profiles = []
      try { profiles = fs.readdirSync(profRoot, { withFileTypes: true }).filter((e) => e.isDirectory()) } catch { /* 无 */ }
      for (const p of profiles) {
        const pkgPath = path.join(profRoot, p.name, 'package.json')
        let pkg
        try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch { continue }
        const deps = Object.keys(pkg.dependencies ?? {})
        const bundles = pkg.dsh?.profile?.bundles ?? []
        lines.push(`profile ${p.name}：${deps.length} 个依赖，${bundles.length} 个已挂载`)
        for (const d of deps) {
          const mounted = bundles.includes(d) ? '已挂载' : '未挂载'
          lines.push(`  ${d}  [${mounted}]`)
        }
      }
      return RESULT(true, 0, tail(lines.join('\n') || '（没有 profile）'))
    },
  })) registered += 1

  return registered
}
