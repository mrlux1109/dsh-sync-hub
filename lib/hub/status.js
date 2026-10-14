/**
 * lib/hub/status.js —— 中枢状态聚合（M3 第一个业务模块）。
 *
 * 移植自旧版 v0.11.0 的 status 相关逻辑（原 index.js /status 路由 + tools/status.ps1 的
 * 只读部分）。旧版走 spawn powershell → tools/status.ps1；v2.0 改为直调 git，
 * 每个 git 调用都可取消、可超时、输出按 UTF-8 读。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单（绝对不做；移植自旧 ps1 的显式约束，D16 验收逐条对照）      │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 本模块**只读**：只跑 status / log / rev-list / diff --stat 等     │
 * │    查询命令，绝不跑 add / commit / push / pull / checkout 等写命令。  │
 * │ G2 不修改任何文件、不写缓存、不动 git 配置。                          │
 * │ G3 输出按 exit code 判定成败，**绝不按 stderr 内容判定**（git 进度行   │
 * │    走 stderr，按文本猜会把正常判定成失败）。                          │
 * │ G4 单个 git 调用超时 15s；全部查询并发但有总预算，绝不久等。          │
 * │ G5 权限不足 / 非 git 仓库 / 路径不存在 → 如实报错，**绝不静默兜底**   │
 * │    （不返回假的"干净"状态误导用户）。                                 │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/status.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { git } from '../exec.js'
import { readHubVersion } from '../hub-paths.js'

/**
 * 一次 git 查询并把 stdout 切成非空行。
 * @param {string[]} args git 参数。
 * @param {{repo:string, signal?:AbortSignal}} options
 * @returns {Promise<{ok:boolean, lines:string[], error?:string}>}
 */
async function queryLines(args, { repo, signal }) {
  const r = await git(args, { repo, signal })
  return {
    ok: r.ok,
    lines: r.ok ? r.stdout.split(/\r?\n/).filter((l) => l.length > 0) : [],
    ...(r.ok ? {} : { error: r.stderr.trim() || r.error || `git exited ${r.code}` }),
  }
}

/**
 * 汇总中枢仓库状态。
 *
 * @param {string} hub 中枢路径（必须是 git 仓库）。
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<object>} 结构化状态；失败时 error 字段带原因。
 */
export async function hubStatus(hub, options = {}) {
  const { signal } = options
  const result = {
    path: hub,
    version: readHubVersion(hub),
    ok: false,
  }

  // G5：非仓库直接报错，不兜底。
  const probe = await queryLines(['rev-parse', '--is-inside-work-tree'], { repo: hub, signal })
  if (!probe.ok) {
    return { ...result, error: `不是 git 仓库或不可读：${probe.error}` }
  }

  // 并发查询：本地工作区、暂存区、领先/落后、最近提交。
  const [porcelain, ahead, behind, lastCommit, branch] = await Promise.all([
    queryLines(['status', '--porcelain'], { repo: hub, signal }),
    queryLines(['rev-list', '--count', '@{upstream}..HEAD'], { repo: hub, signal }),
    queryLines(['rev-list', '--count', 'HEAD..@{upstream}'], { repo: hub, signal }),
    queryLines(['log', '-1', '--format=%h%x09%s%x09%an%x09%ar'], { repo: hub, signal }),
    queryLines(['rev-parse', '--abbrev-ref', 'HEAD'], { repo: hub, signal }),
  ])

  result.ok = true
  result.branch = branch.ok ? branch.lines[0] ?? null : null
  // porcelain 每行形如 " M path" / "?? path" / "A  path"，前两列是状态码。
  result.dirty = porcelain.lines.map((line) => {
    const code = line.slice(0, 2)
    const file = line.slice(3)
    return { code: code.trim() || '??', file }
  })
  result.dirtyCount = result.dirty.length
  // 上游不存在时 rev-list 失败 → 记为 null（未推送过），不当成 0 谎报"一致"。
  result.ahead = ahead.ok ? Number(ahead.lines[0] ?? 0) : null
  result.behind = behind.ok ? Number(behind.lines[0] ?? 0) : null
  result.lastCommit = lastCommit.ok && lastCommit.lines[0]
    ? parseCommitLine(lastCommit.lines[0])
    : null
  return result
}

/**
 * 解析 `git log -1 --format=%h%x09%s%x09%an%x09%ar` 的一行。
 * @param {string} line 格式化的提交行。
 * @returns {{hash:string, subject:string, author:string, relative:string}|null}
 */
function parseCommitLine(line) {
  const parts = line.split('\t')
  if (parts.length < 4) return null
  return { hash: parts[0], subject: parts[1], author: parts[2], relative: parts[3] }
}

/**
 * 统计中枢内各类内容的规模（概览页用）。
 *
 * 只读目录树；隐藏项与 .git 不计入。
 * 注意：不同类别存放形态不同 —— skills/ 下是目录，memory/machines/ 与
 * tools/ 下是文件（.md / .ps1），所以统一按「非隐藏条目」计数，
 * 旧版只数目录导致 machines/tools 恒为 0。
 *
 * @param {string} hub 中枢路径。
 * @returns {{skills:number, machines:number, tools:number, configs:number}}
 */
export function hubInventory(hub) {
  const count = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith('.')).length
    } catch {
      return 0
    }
  }
  return {
    skills: count(path.join(hub, 'skills')),
    machines: count(path.join(hub, 'memory', 'machines')),
    tools: count(path.join(hub, 'tools')),
    configs: count(path.join(hub, 'config')),
  }
}

/**
 * 列出 git 历史（同步时间线 N2 的数据源）。
 *
 * @param {string} hub 中枢路径。
 * @param {{limit?:number, signal?:AbortSignal}} [options] limit 默认 50。
 * @returns {Promise<{ok:boolean, commits:Array<{hash:string,subject:string,author:string,date:string,files:number}>, error?:string}>}
 */
export async function hubLog(hub, options = {}) {
  const { signal, limit = 50 } = options
  const r = await git(
    ['log', `-n${Math.min(Math.max(1, limit), 200)}`, '--format=%H%x09%s%x09%an%x09%ad', '--date=short'],
    { repo: hub, signal },
  )
  if (!r.ok) return { ok: false, commits: [], error: r.stderr.trim() || r.error || `git exited ${r.code}` }
  const commits = r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, subject, author, date] = line.split('\t')
    return { hash, subject, author, date, files: 0 }
  })
  return { ok: true, commits }
}

/**
 * N2 同步时间线：带"改动文件数 + 每台机器的提交归属"的完整历史。
 *
 * 机器归属按中枢约定：提交信息以机器短名开头（"home …" / "shop …"）。
 * files 数来自 --numstat 的行数（同一 log 进程内取，不逐提交再查）。
 *
 * @param {string} hub 中枢路径。
 * @param {{limit?:number, signal?:AbortSignal}} [options] limit 默认 100。
 * @returns {Promise<{ok:boolean, commits:Array<{hash:string,short:string,subject:string,author:string,date:string,time:string,machine:string|null,files:number}>, error?:string}>}
 */
export async function hubTimeline(hub, options = {}) {
  const { signal, limit = 100 } = options
  const r = await git(
    ['log', `-n${Math.min(Math.max(1, limit), 300)}`, '--numstat', '--date=format:%Y-%m-%d %H:%M', '--format=%H%x09%h%x09%s%x09%an%x09%ad'],
    { repo: hub, signal, timeoutMs: 30_000 },
  )
  if (!r.ok) return { ok: false, commits: [], error: r.stderr.trim() || r.error || `git exited ${r.code}` }

  const commits = []
  let current = null
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length >= 5 && /^[0-9a-f]{40}$/.test(parts[0])) {
      const [hash, short, subject, author, ad] = parts
      // %ad 默认带时区，形如 "2026-10-14 22:31:35 +0800"
      const date = ad?.slice(0, 10) ?? ''
      const time = ad?.slice(11, 19) ?? ''
      // 机器归属：提交信息开头的短名（home/shop/...），匹配不到记 null
      const machine = subject.match(/^(home|shop)\b/i)?.[1]?.toLowerCase()
        ?? null
      current = { hash, short, subject, author, date, time, machine, files: 0 }
      commits.push(current)
      continue
    }
    // numstat 行：adds\tdeletes\tpath（二进制是 '-'）
    if (current && /^\d+\t\d+\t/.test(line)) current.files += 1
  }
  return { ok: true, commits }
}
