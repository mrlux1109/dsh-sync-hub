/**
 * lib/hub/sync.js —— 推送 / 拉取 / 预演（M3 第二个业务模块）。
 *
 * 移植自 tools/push.ps1（355 行，本次只读参考，未改动原文件）。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单（从 push.ps1 逐条提取，D16 验收逐条对照，一条不落）           │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **密钥守卫**：中枢内出现 .credentials.yaml / .anonymous-user-id / │
 * │    sessions 目录时**拒绝推送**（除非显式 allowSecrets 且调用方知情）。│
 * │    原 ps1：throw "Refusing to publish: forbidden items in hub"。      │
 * │ G2 **冲突不自动解决**：pull --rebase 失败 → 立即停手，返回 exit 2 语义│
 * │    与冲突文件清单，**绝不**跑 add/continue/abort 任何收尾命令。       │
 * │    原 ps1：exit 2 + "Resolve manually … rebase --continue"。          │
 * │ G3 **范围外改动保护**：范围暂存会把范围外编辑留在工作区，挡住           │
 * │    pull --rebase → 先 git stash 停泊，push 成功后 stash pop 还原；     │
 * │    push 失败也要 pop（否则用户改动被关在 stash 里）。                  │
 * │ G4 **凭据/网络失败不重试**：Authentication failed / schannel 报错时   │
 * │    如实透传并给修复提示，**绝不自动重试**（重试会触发凭据弹窗风暴）。   │
 * │ G5 **预演零副作用**：dryRun 只 add+diff --cached 然后 reset，不 commit、│
 * │    不 push、不 stash。                                                │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/sync.js
 */

import path from 'node:path'
import fs from 'node:fs'
import { git } from '../exec.js'

/** 中枢内永不外泄的条目（G1）。 */
const FORBIDDEN = ['.credentials.yaml', '.anonymous-user-id', 'sessions']

/** 范围名 → 要暂存的路径集合（与 push.ps1 的映射逐条一致）。 */
const SCOPE_PATHS = {
  memory: ['memory/'],
  skills: ['skills/', 'config/skill-categories.json', 'config/recommended-skills.md'],
  config: ['config/'],
  sessions: ['session-backup/'],
  dshconfig: ['config/dshconfig/'],
  plugins: ['config/plugin.txt'],
  // 插件源码：与 plugins 清单是两回事，少了这类"改了等于没改"（原 ps1 注释实锤）。
  pluginsrc: ['plugins/'],
}

/**
 * G1 密钥守卫。
 * @param {string} hub 中枢路径。
 * @returns {{ok:true} | {ok:false, hits:string[]}}
 */
export function secretGuard(hub) {
  const hits = FORBIDDEN.filter((rel) => fs.existsSync(path.join(hub, rel)))
  return hits.length > 0 ? { ok: false, hits } : { ok: true }
}

/**
 * 把范围名解析成路径集合。
 * @param {string[]} scopes 范围名数组，如 ['memory','skills']。
 * @returns {{paths:string[], unknown:string[]}}
 */
export function resolveScopes(scopes) {
  const paths = []
  const unknown = []
  for (const raw of scopes ?? []) {
    const key = String(raw).trim().toLowerCase()
    if (SCOPE_PATHS[key]) paths.push(...SCOPE_PATHS[key])
    else if (key) unknown.push(key)
  }
  return { paths, unknown }
}

/**
 * 把"已暂存但不在范围内"的文件取消暂存（G3 的前置，对应 ps1 的 reset 循环）。
 *
 * @param {string} hub 中枢路径。
 * @param {string[]} paths 允许的路径前缀。
 * @returns {Promise<string[]>} 被取消暂存的文件。
 */
async function unstageOutOfScope(hub, paths) {
  const staged = await git(['diff', '--cached', '--name-only'], { repo: hub, timeoutMs: 20_000 })
  if (!staged.ok) return []
  const dropped = []
  for (const f of staged.stdout.split(/\r?\n/).filter(Boolean)) {
    const inScope = paths.some((p) => f.startsWith(p))
    if (!inScope) {
      await git(['reset', '--', f], { repo: hub, timeoutMs: 20_000 })
      dropped.push(f)
    }
  }
  return dropped
}

/**
 * 按单个技能名 / 会话工作区名窄选（对应 ps1 的 -Skills / -Sessions 参数）。
 *
 * @param {string} hub 中枢路径。
 * @param {{skills?:string[], sessions?:string[]}} narrow 白名单（空 = 不窄选）。
 * @returns {Promise<{droppedSkills:string[], droppedSessions:string[]}>}
 */
async function narrowItems(hub, narrow = {}) {
  const allowSkills = (narrow.skills ?? []).map((s) => s.toLowerCase()).filter(Boolean)
  const allowSess = (narrow.sessions ?? []).map((s) => s.toLowerCase()).filter(Boolean)
  const result = { droppedSkills: [], droppedSessions: [] }
  if (allowSkills.length === 0 && allowSess.length === 0) return result

  const staged = await git(['diff', '--cached', '--name-only'], { repo: hub, timeoutMs: 20_000 })
  if (!staged.ok) return result
  for (const f of staged.stdout.split(/\r?\n/).filter(Boolean)) {
    if (allowSkills.length > 0 && f.startsWith('skills/')
        && f !== 'config/skill-categories.json'
        && f !== 'config/recommended-skills.md') {
      const seg = f.slice('skills/'.length).split('/')
      const name = (seg[0] ?? '').toLowerCase()
      if (!allowSkills.includes(name)) {
        await git(['reset', '--', f], { repo: hub, timeoutMs: 20_000 })
        result.droppedSkills.push(f)
      }
    }
    if (allowSess.length > 0 && f.startsWith('session-backup/')) {
      const seg = f.split('/')
      const name = (seg[2] ?? '').toLowerCase()
      if (!allowSess.includes(name)) {
        await git(['reset', '--', f], { repo: hub, timeoutMs: 20_000 })
        result.droppedSessions.push(f)
      }
    }
  }
  return result
}

/**
 * 预演：本次推送会包含哪些文件、多大体积（G5：零副作用）。
 *
 * @param {string} hub 中枢路径。
 * @param {{scopes?:string[], except?:string[], skills?:string[], sessions?:string[]}} [options]
 * @returns {Promise<{ok:boolean, files:Array<{path:string,bytes:number}>, totalBytes:number, unknown:string[], error?:string}>}
 */
export async function previewPush(hub, options = {}) {
  const { paths, unknown } = resolveScopes(
    options.scopes?.length ? options.scopes : Object.keys(SCOPE_PATHS),
  )
  if (paths.length === 0) {
    return { ok: false, files: [], totalBytes: 0, unknown, error: '没有有效的推送范围' }
  }

  // except：整块移除对应范围（对应 ps1 的 $Except 分支）。
  let effective = [...paths]
  for (const ex of options.except ?? []) {
    const drop = SCOPE_PATHS[String(ex).trim().toLowerCase()]
    if (drop) effective = effective.filter((p) => !drop.includes(p))
  }
  if (effective.length === 0) {
    return { ok: false, files: [], totalBytes: 0, unknown, error: '排除后没有剩余范围' }
  }

  for (const p of effective) await git(['add', '--', p], { repo: hub, timeoutMs: 20_000 })
  // 删除也要进暂存区（ps1 的 add -u）。
  await git(['add', '-u'], { repo: hub, timeoutMs: 20_000 })
  await unstageOutOfScope(hub, effective)
  await narrowItems(hub, { skills: options.skills, sessions: options.sessions })

  const staged = await git(['diff', '--cached', '--name-only'], { repo: hub, timeoutMs: 20_000 })
  if (!staged.ok) {
    return { ok: false, files: [], totalBytes: 0, unknown, error: staged.stderr.trim() || 'diff 失败' }
  }
  const files = []
  let totalBytes = 0
  for (const rel of staged.stdout.split(/\r?\n/).filter(Boolean)) {
    let bytes = 0
    try { bytes = fs.statSync(path.join(hub, rel)).size } catch { /* 已删除文件体积记 0 */ }
    files.push({ path: rel, bytes })
    totalBytes += bytes
  }
  // G5：预演完必须把暂存区还原，绝不留下副作用。
  await git(['reset', '-q'], { repo: hub, timeoutMs: 20_000 })
  return { ok: true, files, totalBytes, unknown }
}

/**
 * 推送：add（按范围）→ commit → pull --rebase → push。
 *
 * @param {string} hub 中枢路径。
 * @param {object} [options]
 * @param {string[]} [options.scopes] 范围；空 = 全部。
 * @param {string[]} [options.except] 排除范围。
 * @param {string[]} [options.skills] 只推这些技能。
 * @param {string[]} [options.sessions] 只推这些会话工作区。
 * @param {string} [options.message] 提交信息。
 * @param {boolean} [options.allowSecrets] 显式绕过 G1（调用方必须已知情）。
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} 结构化结果；冲突时 ok:false + conflicts 数组。
 */
export async function push(hub, options = {}) {
  const { signal, allowSecrets = false } = options

  // G1：密钥守卫，默认开启。
  if (!allowSecrets) {
    const guard = secretGuard(hub)
    if (!guard.ok) {
      return {
        ok: false,
        stage: 'secret-guard',
        error: `拒绝推送：中枢内含禁推项 ${guard.hits.join(', ')}`,
        hits: guard.hits,
      }
    }
  }

  const { paths, unknown } = resolveScopes(
    options.scopes?.length ? options.scopes : Object.keys(SCOPE_PATHS),
  )
  if (paths.length === 0) {
    return { ok: false, stage: 'scope', error: '没有有效的推送范围', unknown }
  }
  let effective = [...paths]
  for (const ex of options.except ?? []) {
    const drop = SCOPE_PATHS[String(ex).trim().toLowerCase()]
    if (drop) effective = effective.filter((p) => !drop.includes(p))
  }

  // 暂存
  for (const p of effective) await git(['add', '--', p], { repo: hub, signal, timeoutMs: 30_000 })
  await git(['add', '-u'], { repo: hub, signal, timeoutMs: 30_000 })
  await unstageOutOfScope(hub, effective)
  await narrowItems(hub, { skills: options.skills, sessions: options.sessions })

  // 提交（无改动时继续走 pull/push，让用户看到仓库状态——对应 ps1 的 fall through）
  const message = options.message?.trim() || defaultMessage()
  const commit = await git(['commit', '-m', message], { repo: hub, signal, timeoutMs: 60_000 })
  if (!commit.ok) {
    const text = `${commit.stdout}\n${commit.stderr}`
    if (!/nothing to commit|no changes added/i.test(text)) {
      return { ok: false, stage: 'commit', error: text.trim().slice(0, 500), unknown }
    }
  }

  // G3：范围外改动停泊，避免挡住 rebase。
  const dirty = await git(['status', '--porcelain'], { repo: hub, signal, timeoutMs: 20_000 })
  let parked = false
  if (dirty.ok && dirty.stdout.trim() !== '') {
    const stash = await git(['stash', 'push', '-m', 'sync-hub scoped push parking'],
      { repo: hub, signal, timeoutMs: 30_000 })
    parked = stash.ok
  }

  /** push 失败时也要还原停泊的改动（G3 后半句）。 */
  const restore = async () => {
    if (!parked) return
    await git(['stash', 'pop'], { repo: hub, timeoutMs: 30_000 })
    parked = false
  }

  // rebase
  const upstream = await git(['rev-parse', '--abbrev-ref', '@{u}'], { repo: hub, signal, timeoutMs: 20_000 })
  if (upstream.ok) {
    const rebase = await git(['pull', '--rebase'], { repo: hub, signal, timeoutMs: 600_000 })
    if (!rebase.ok) {
      await restore()
      // G2：绝不自动解决冲突，只报告。
      const conflicts = await conflictedFiles(hub)
      return {
        ok: false,
        stage: 'rebase',
        conflict: true,
        conflicts,
        error: `pull --rebase 失败${conflicts.length ? `，冲突文件：${conflicts.join(', ')}` : ''}。请用冲突解决器或控制台处理，插件不会自动解决。`,
        log: `${rebase.stdout}\n${rebase.stderr}`.trim().slice(0, 1000),
      }
    }
  }

  // push
  const pushed = await git(['push', '-u', 'origin', 'HEAD'], { repo: hub, signal, timeoutMs: 600_000 })
  if (!pushed.ok) {
    await restore()
    const text = `${pushed.stdout}\n${pushed.stderr}`
    // G4：凭据/网络类失败给修复提示，不自动重试。
    const hint = /Authentication failed|could not read Username/i.test(text)
      ? 'Git 凭据未被接受。请在普通终端手动跑一次 git push 让凭据管理器弹窗登录，或执行 git config --global credential.helper manager。'
      : /schannel|SEC_E_NO_CREDENTIALS/i.test(text)
        ? 'TLS 后端故障：执行 git config --global http.sslBackend openssl 后重试。'
        : ''
    return { ok: false, stage: 'push', error: text.trim().slice(0, 500), hint, unknown }
  }

  await restore()
  // 成功回执：提交号 + 本次推送的文件清单。
  const head = await git(['log', '-1', '--format=%h\t%s'], { repo: hub, timeoutMs: 20_000 })
  const diff = await git(['diff', '--name-only', 'HEAD@{1}', 'HEAD'], { repo: hub, timeoutMs: 20_000 })
  const files = diff.stdout.split(/\r?\n/).filter(Boolean)
  return {
    ok: true,
    stage: 'done',
    commit: head.stdout.split('\t')[0]?.trim() ?? null,
    subject: head.stdout.split('\t')[1]?.trim() ?? null,
    files,
    fileCount: files.length,
    unknown,
  }
}

/**
 * 拉取：pull --rebase（G2：冲突即停手，不自动解决）。
 *
 * @param {string} hub 中枢路径。
 * @param {{force?:boolean, signal?:AbortSignal}} [options]
 * @returns {Promise<object>}
 */
export async function pull(hub, options = {}) {
  const { signal } = options
  const guard = secretGuard(hub)
  if (!guard.ok) {
    // 拉取侧同样要拦：禁推项若在中枢里，说明机器状态异常，先报告再拉。
    return {
      ok: false,
      stage: 'secret-guard',
      error: `中枢内出现禁推项 ${guard.hits.join(', ')}，请先人工确认再拉取`,
      hits: guard.hits,
    }
  }
  const r = await git(['pull', '--rebase'], { repo: hub, signal, timeoutMs: 600_000 })
  if (!r.ok) {
    const conflicts = await conflictedFiles(hub)
    return {
      ok: false,
      stage: 'pull',
      conflict: true,
      conflicts,
      error: conflicts.length
        ? `拉取撞车：${conflicts.join(', ')}。用冲突解决器处理，或打开控制台。插件不会自动解决。`
        : `拉取失败：${`${r.stdout}\n${r.stderr}`.trim().slice(0, 500)}`,
      log: `${r.stdout}\n${r.stderr}`.trim().slice(0, 1000),
    }
  }
  const head = await git(['log', '-1', '--format=%h\t%s'], { repo: hub, timeoutMs: 20_000 })
  return {
    ok: true,
    stage: 'done',
    commit: head.stdout.split('\t')[0]?.trim() ?? null,
    subject: head.stdout.split('\t')[1]?.trim() ?? null,
    output: r.stdout.trim().slice(0, 500),
  }
}

/**
 * 列出当前处于冲突状态的文件（G2 的报告数据源）。
 * @param {string} hub 中枢路径。
 * @returns {Promise<string[]>}
 */
export async function conflictedFiles(hub) {
  const r = await git(['diff', '--name-only', '--diff-filter=U'], { repo: hub, timeoutMs: 20_000 })
  if (!r.ok) return []
  return r.stdout.split(/\r?\n/).filter(Boolean)
}

/**
 * 默认提交信息（对应 ps1 的 "machine COMPUTERNAME sync yyyy-MM-dd HH:mm"）。
 * @returns {string}
 */
function defaultMessage() {
  let machine = ''
  try {
    const mk = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', '.sync-hub-machine')
    machine = fs.existsSync(mk) ? fs.readFileSync(mk, 'utf8').trim() : ''
  } catch { /* 读不到就退回计算机名 */ }
  const who = machine || process.env.COMPUTERNAME || 'unknown'
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${who} sync ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}
