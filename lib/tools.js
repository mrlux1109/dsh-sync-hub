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
import { checkPluginUpdate, compareVersions } from './hub/plugin-update.js'
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

/**
 * 回执三段式（v2.2 S6，参考 tiddlywiki 的做法）。
 *
 * 反例（改之前的样子）：回执开头就是 `exit code` 和 stash/G 编号，
 * 人看不懂到底成没成。现在统一为：
 *   第 1 段 结论一句话 —— 成功 / 被挡 / 冲突
 *   第 2 段 关键数字   —— 几个文件、领先/落后几个提交、跳过几个
 *   第 3 段 细节建议   —— 折叠在末尾（可选）
 *
 * @param {string} verdict  第 1 段：结论一句话（不要以数字或 exit code 开头）
 * @param {string|string[]} facts 第 2 段：关键数字（数组自动换行）
 * @param {string} [detail] 第 3 段：细节 / 修复建议（可选）
 * @returns {string} 可直接塞进 RESULT 的三段式文本
 */
function receipt(verdict, facts, detail) {
  const mid = Array.isArray(facts) ? facts.filter(Boolean).join('\n') : String(facts ?? '')
  const out = [`【结论】${verdict}`]
  if (mid) out.push('', '【关键】', mid)
  if (detail) out.push('', '【细节/建议】', String(detail))
  return out.join('\n')
}

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
      if (!st.ok) return RESULT(false, 1, receipt(`读取中枢状态失败。`, [], `原因：${st.error}`))
      const facts = [
        `分支 ${st.branch ?? '?'} · 待上传 ${st.ahead ?? 0} 个提交 · 待恢复 ${st.behind ?? 0} 个提交 · 未提交改动 ${st.dirtyCount} 个文件`,
        `技能 ${inv.skills} 个 · 机器档案 ${inv.machines} 份 · 工具 ${inv.tools} 项`,
        st.lastCommit ? `最近提交 ${st.lastCommit.hash} ${st.lastCommit.subject}` : null,
      ]
      const detail = st.dirtyCount > 0
        ? `未提交明细：\n${st.dirty.slice(0, 15).map((d) => `  ${d.code} ${d.file}`).join('\n')}`
        : '一切干净：没有未提交改动，可以直接上传备份。'
      return RESULT(true, 0, tail(receipt(
        st.dirtyCount > 0 || (st.behind ?? 0) > 0
          ? `有 ${st.dirtyCount} 个未提交改动、${st.behind ?? 0} 个待恢复提交。`
          : '中枢与本机一致，无需操作。',
        facts,
        detail,
      )))
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
      if (!r.ok) {
        if (r.stage === 'secret-guard') {
          return RESULT(false, 3, tail(receipt(
            '被密钥守卫挡住，未上传。',
            [`命中违禁项：${(r.hits ?? []).join('、') || '未指明'}`],
            '凭据类文件绝不进中枢，请先从中枢里清掉，再重试上传。',
          )))
        }
        if (r.stage === 'rebase') {
          return RESULT(false, 2, tail(receipt(
            `冲突未解决（${(r.conflicts ?? []).length} 个文件），已阻止上传。`,
            (r.conflicts ?? []).slice(0, 15).map((f) => `  ${f}`),
            '处理办法：打开冲突解决器，逐个选边或手写；插件绝不自动解决。',
          )))
        }
        if (r.stage === 'scope') {
          return RESULT(false, 1, tail(receipt(
            '没有可上传的范围（已中止，未改动任何文件）。',
            r.unknown?.length ? [`无法识别的范围名：${r.unknown.join('、')}`] : [],
            '合法范围：memory / skills / config / plugins / sessions / dshconfig / pluginsrc。',
          )))
        }
        return RESULT(false, 1, tail(receipt('上传备份失败。', [], `阶段 ${r.stage ?? '?'}：${r.error}`)))
      }
      return RESULT(true, 0, tail(receipt(
        `已上传 ${r.fileCount} 个文件到中枢。`,
        [`提交号 ${r.commit}${r.subject ? ` · ${r.subject}` : ''}`, `文件数 ${r.fileCount}`],
        r.fileCount === 0 ? '本次没有新改动需要上传。' : '另一台机器执行"下载恢复"即可拿到这些内容。',
      )))
    },
  })) registered += 1

  // ③ pull
  if (reg({
    name: 'sync_hub_pull',
    description:
      '从云端中枢下载恢复另一台电脑的改动并应用到本机（pull --rebase，专业术语 pull / 拉取）。'
      + '用户说"下载恢复/拉取/同步下来/拿最新"时用。'
      + '退出码 2 = 冲突：停下向用户报告冲突文件，不要自动解决（用同步面板的冲突解决器或控制台处理）。'
      + '注意：会话轨道是单向归档，本工具恢复的是记忆/技能/配置，不会覆盖本机会话。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async (_args, exec) => {
      const hub = getHub()
      if (!hub) return noHub()
      const r = await pull(hub, { signal: exec?.signal })
      if (!r.ok) {
        if (r.stage === 'secret-guard') {
          return RESULT(false, 3, tail(receipt(
            '被密钥守卫挡住，未恢复。',
            [`命中违禁项：${(r.hits ?? []).join('、') || '未指明'}`],
            '凭据类文件绝不跨机传，请先处理干净。',
          )))
        }
        if (r.stage === 'pull' && (r.conflicts ?? []).length) {
          return RESULT(false, 2, tail(receipt(
            `恢复撞车：${r.conflicts.length} 个文件冲突，已停下。`,
            r.conflicts.slice(0, 15).map((f) => `  ${f}`),
            '用冲突解决器逐个选边或手写；插件绝不自动解决。',
          )))
        }
        return RESULT(false, 1, tail(receipt('下载恢复失败。', [], `阶段 ${r.stage ?? '?'}：${r.error}`)))
      }
      return RESULT(true, 0, tail(receipt(
        '已从中枢恢复内容到本机。',
        [`提交号 ${r.commit ?? '—'}${r.subject ? ` · ${r.subject}` : ''}`],
        '涉及记忆/插件的改动重启 DSH 后完整生效；会话本机已有的不会被覆盖。',
      )))
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
      let ver = '?'
      try { ver = fs.readFileSync(path.join(hub, 'VERSION'), 'utf8').trim() } catch { /* 无 VERSION */ }
      return RESULT(true, 0, receipt(
        `中枢版本 ${ver}。`,
        [
          c ? `最近提交 ${c.hash.slice(0, 7)} ${c.subject}（${c.date}）` : '（无提交）',
          `技能 ${inv.skills} · 机器档案 ${inv.machines} · 工具 ${inv.tools} · 配置 ${inv.configs}`,
        ],
      ))
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
        if (!alt) {
          return RESULT(false, 1, receipt('控制台入口没找到。', [], '中枢里既没有 同步中枢.bat，也没有 sync.cmd / tools/menu.ps1，请确认中枢仓库完整。'))
        }
        const { spawn } = await import('node:child_process')
        const child = spawn('cmd', ['/c', 'start', '', alt.replace(/tools[\\/]menu\.ps1$/, 'tools\\menu.ps1')],
          { detached: true, stdio: 'ignore', windowsHide: false })
        child.unref()
        return RESULT(true, 0, receipt(`已弹出 ${path.basename(alt)} 控制台窗口。`, [], '窗口在任务栏，请在那个窗口里操作（换身份要手输 YES）。'))
      }
      const { spawn } = await import('node:child_process')
      const child = spawn('cmd', ['/c', 'start', '', bat], { detached: true, stdio: 'ignore', windowsHide: false })
      child.unref()
      return RESULT(true, 0, receipt('已弹出 同步中枢.bat 控制台窗口。', [], '换机器身份、全自动一条龙、冲突人工处理请在那个窗口操作（换身份要手输 YES）。'))
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
      if (!r.ok) return RESULT(false, 1, receipt('备份失败。', [], r.error))
      return RESULT(true, 0, receipt(
        `已创建 ${r.created.length} 份快照。`,
        r.created,
        '备份永不自动删除；恢复请到同步中枢面板的维护页。',
      ))
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
      if (!r.ok) return RESULT(false, 1, receipt('读取备份列表失败。', [], r.error))
      if (r.backups.length === 0) {
        return RESULT(true, 0, receipt('还没有任何备份。', [], '改记忆/插件配置前建议先跑 sync_hub_backup 存一份。'))
      }
      return RESULT(true, 0, tail(receipt(
        `共 ${r.backups.length} 份快照（显示最近 ${Math.min(30, r.backups.length)} 份）。`,
        r.backups.slice(0, 30).map((b) => `${b.name}  ${Math.round(b.bytes / 1024)}KB  ${b.mtime.slice(0, 16).replace('T', ' ')}`),
        '恢复请到同步中枢面板的维护页。',
      )))
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
      const verdict = r.summary.differ === 0 && r.summary.onlyLocal === 0
        ? '技能两机完全一致，无需处理。'
        : `技能有 ${r.summary.differ + r.summary.onlyLocal + r.summary.onlyHub} 处差异。`
      const facts = [`一致 ${r.summary.identical} · 仅本机 ${r.summary.onlyLocal} · 仅中枢 ${r.summary.onlyHub} · 两边不同 ${r.summary.differ}`]
      const interesting = r.diff.filter((d) => d.kind !== 'identical')
      if (interesting.length) facts.push('', ...interesting.slice(0, 20).map((d) => `  ${d.kind.padEnd(10)} ${d.name}`))
      if (r.summary.invalidLocal.length) {
        facts.push('', `非法名（DSH 静默跳过）：${r.summary.invalidLocal.join('、')}`)
      }
      const advice = r.summary.differ > 0
        ? '两边不同的技能需要人工 diff 后决定保留哪份；中枢的 apply 是"只补缺失"，不会覆盖本机同名技能。'
        : r.summary.onlyLocal > 0
          ? '仅本机的技能可执行上传备份（sync_hub_push）把它带进中枢。'
          : '保持现状即可。'
      return RESULT(true, 0, tail(receipt(verdict, facts, advice)))
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
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return RESULT(false, 1, receipt('技能名不合法。', [], `要 kebab-case（小写字母/数字/连字符），收到的是：${name}`))
      const dir = path.join(dshHome(), 'skills', name)
      const on = path.join(dir, 'SKILL.md')
      const off = path.join(dir, 'SKILL.md.disabled')
      if (args?.enable === true) {
        if (!fs.existsSync(off)) {
          return RESULT(false, 1, receipt(fs.existsSync(on) ? `${name} 本来就是启用状态，无需操作。` : `技能不存在：${name}。`, [], fs.existsSync(on) ? '保持现状即可。' : '可用 sync_hub_skill_list 看两边的技能分布。'))
        }
        fs.renameSync(off, on)
        return RESULT(true, 0, receipt(`已启用 ${name}。`, [], '若刚导入/改名，重启 DSH 后技能才会被加载。'))
      }
      if (!fs.existsSync(on)) {
        return RESULT(false, 1, receipt(fs.existsSync(off) ? `${name} 本来就是停用状态，无需操作。` : `技能不存在或没有 SKILL.md：${name}。`, [], fs.existsSync(off) ? '保持现状即可。' : '可用 sync_hub_skill_list 看两边的技能分布。'))
      }
      fs.renameSync(on, off)
      return RESULT(true, 0, receipt(`已停用 ${name}。`, ['重命名 SKILL.md → SKILL.md.disabled，内容未删，随时可逆。'], 'DSH 不再加载它；恢复用 sync_hub_skill_toggle enable=true。'))
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
        if (!clone.ok) return RESULT(false, 1, receipt('克隆仓库失败，未导入。', [], tail(`${clone.stdout}\n${clone.stderr}`)))
        const srcDir = args?.skillPath ? path.join(tmp, ...String(args.skillPath).split('/')) : tmp
        const skillMd = path.join(srcDir, 'SKILL.md')
        if (!fs.existsSync(skillMd)) return RESULT(false, 1, receipt('仓库里没找到 SKILL.md，未导入。', [], `${args?.skillPath ?? '仓库根'} 缺 SKILL.md；可用 skillPath 参数指到仓库内的技能子目录。`))
        const name = path.basename(srcDir)
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
          return RESULT(false, 1, receipt(`目录名 "${name}" 不是 kebab-case，未导入。`, [], '请手动改名后用技能面板导入。'))
        }
        const dst = path.join(dshHome(), 'skills', name)
        if (fs.existsSync(path.join(dst, 'SKILL.md')) || fs.existsSync(path.join(dst, 'SKILL.md.disabled'))) {
          return RESULT(false, 1, receipt(`同名技能已存在：${name}，未覆盖。`, [], '先停用/删除同名技能再导入；绝不静默覆盖。'))
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
        return RESULT(true, 0, receipt(
          `已导入技能 ${name}。`,
          [`位置 ${dst}`],
          '重启 DSH 后生效；同名绝不覆盖的守卫全程生效。',
        ))
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
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return RESULT(false, 1, receipt('名字不合法。', [], `必须 kebab-case（小写字母/数字/连字符），收到的是：${name}`))
      const desc = String(args?.description ?? '').trim()
      if (!desc) return RESULT(false, 1, receipt('description 必填。', [], '它决定技能何时被调用；空描述的技能 DSH 会静默跳过。'))
      const dst = path.join(dshHome(), 'skills', name)
      if (fs.existsSync(dst)) return RESULT(false, 1, receipt(`已存在：${name}，未覆盖。`, [], '同名绝不覆盖；要重建请先删旧目录。'))
      const fm = `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n${args?.body ?? '（在此写技能正文）'}\n`
      fs.mkdirSync(dst, { recursive: true })
      fs.writeFileSync(path.join(dst, 'SKILL.md'), fm, 'utf8')
      return RESULT(true, 0, receipt(
        `已创建技能 ${name}。`,
        [`位置 ${path.join(dst, 'SKILL.md')}`],
        '重启 DSH 后生效；要同步到另一台机器，跑一次上传备份（skills 范围）。',
      ))
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
      let depTotal = 0
      for (const p of profiles) {
        const pkgPath = path.join(profRoot, p.name, 'package.json')
        let pkg
        try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch { continue }
        const deps = Object.keys(pkg.dependencies ?? {})
        const bundles = pkg.dsh?.profile?.bundles ?? []
        depTotal += deps.length
        lines.push(`profile ${p.name}：${deps.length} 个依赖，${bundles.length} 个已挂载`)
        for (const d of deps) {
          const mounted = bundles.includes(d) ? '已挂载' : '未挂载'
          lines.push(`  ${d}  [${mounted}]`)
        }
      }
      if (!lines.length) {
        return RESULT(true, 0, receipt('没有发现任何 profile。', [], '确认 DSH_HOME 下的 profiles/ 目录是否存在。'))
      }
      const unmounted = lines.filter((l) => l.includes('[未挂载]')).length
      return RESULT(true, 0, tail(receipt(
        unmounted > 0
          ? `共 ${depTotal} 个插件依赖，其中 ${unmounted} 个未挂载（装了但没生效）。`
          : `共 ${depTotal} 个插件依赖，全部已挂载。`,
        lines,
        unmounted > 0 ? '未挂载的插件不会加载：检查 profile package.json 的 dsh.profile.bundles 是否包含它。' : '安装/卸载/更新请走官方 设置 → 插件（dshmarket）。',
      )))
    },
  })) registered += 1

  // ⑬ plugin_update —— 检查插件更新（从 GitHub 私有仓拉取最新 tag）
  if (reg({
    name: 'sync_hub_plugin_update',
    description:
      '检查 dsh-sync-hub 插件是否有新版本。从 GitHub 私有仓拉取最新 tag，对比本地版本，返回更新状态。'
      + '用户问"插件有更新吗/怎么升级插件"时用。返回当前版本、最新版本、是否有更新。',
    parameters: NO_PARAMS,
    output: OUT,
    execute: async (_args, exec) => {
      // v2.3.1：走 lib/hub/plugin-update.js 单一事实源（旧版这里抄了一份 api.js 的
      // execSync 逻辑：同步阻塞、硬钉 profiles/desktop、无镜像兜底）。
      const r = await checkPluginUpdate({ signal: exec?.signal })
      if (!r.ok) return RESULT(false, -1, tail(receipt('检查更新失败：GitHub 连不上。', [`本机版本 ${r.current}`], r.error)))

      const same = compareVersions(r.current, r.latest) === 0
      return RESULT(true, 0, receipt(
        r.hasUpdate
          ? `有新版本：${r.current} → ${r.latest}。`
          : same
            ? `已是最新版本 ${r.current}。`
            : '本机未安装（或版本未知），无法判断。',
        [`本机 ${r.current}（${r.where}）`, `GitHub 最新 tag ${r.latest}`],
        r.hasUpdate
          ? '更新方式：设置 → 插件 → dshmarket 更新；或让 AI 从 GitHub 拉取后覆盖 profile 内的 dsh-sync-hub 目录，重启 DSH 生效。'
          : same ? '无需操作。' : '先在 profile 里装好本插件再查。',
      ))
    },
  })) registered += 1

  return registered
}
