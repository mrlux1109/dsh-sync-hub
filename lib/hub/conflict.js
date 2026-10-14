/**
 * lib/hub/conflict.js —— 拉取撞车三方解决器（N1，决策 D7）。
 *
 * 旧版做法：提示用户自己跑 `git add <文件> && git rebase --continue`，或去控制台。
 * 本模块把这件事做成可编程的三段式：
 *
 *   1) inspect：列出冲突文件 + 三段内容（base 来自 merge-base、
 *      ours 来自 :2:、theirs 来自 :3:）——git 的三阶段索引，不自己解析 <<<<<<<；
 *   2) resolve：把"选边或手写"的结果写回工作区文件；
 *   3) finish：git add + rebase --continue，**仅在调用方显式确认后**。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单（冲突是全中枢最危险的时刻，一条都不能少）                     │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **绝不自动解决**：没有 resolve 调用就没有任何写操作；                │
 * │    inspect / list 纯只读。                                            │
 * │ G2 **不猜内容**：三段内容全部由 git 索引提供，本模块不做文本合并；      │
 * │    "合并"由人在界面上完成（或选一边）。                                 │
 * │ G3 **finish 只做两件事**：git add <已解决文件> + rebase --continue；   │
 * │    绝不 --skip、绝不 abort、绝不 amend、绝不 force push。               │
 * │ G4 **逐个确认**：finish 只 add 调用方点名的那几个文件，不 add -A。      │
 * │ G5 **仍有未解决冲突时拒绝 finish**：git 层面还有 U 状态文件 → 拒绝，     │
 * │    防止带着残缺冲突继续 rebase。                                       │
 * │ G6 **rebase 不在进行中时拒绝 finish**：没有 .git/rebase-merge 目录      │
 * │    （或 rebase-apply）即拒绝，避免误伤正常状态。                        │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/conflict.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { git } from '../exec.js'

/** 单段内容的最大字节（防止把巨型文件整个读进内存/响应）。 */
const MAX_STAGE_BYTES = 512 * 1024

/**
 * 当前是否处于 rebase 冲突中（G6）。
 * @param {string} hub 中枢路径。
 * @returns {boolean}
 */
export function isRebasing(hub) {
  const gitDir = path.join(hub, '.git')
  return fs.existsSync(path.join(gitDir, 'rebase-merge'))
    || fs.existsSync(path.join(gitDir, 'rebase-apply'))
}

/**
 * 列出冲突文件（G1：只读）。
 * @param {string} hub 中枢路径。
 * @returns {Promise<{ok:boolean, files:string[], error?:string}>}
 */
export async function listConflicts(hub) {
  const r = await git(['diff', '--name-only', '--diff-filter=U'], { repo: hub, timeoutMs: 20_000 })
  if (!r.ok) return { ok: false, files: [], error: r.stderr.trim() || r.error || 'git exited non-zero' }
  return { ok: true, files: r.stdout.split(/\r?\n/).filter(Boolean) }
}

/**
 * 读一个冲突文件的三段内容。
 *
 * ⚠️ 命名坑（2026-10-14 实测，git rebase 场景）：
 *   在 `git rebase other`（当前分支被 rebase 上去）时，阶段索引的语义是
 *     :1: = merge-base（共同祖先）
 *     :2: = **other 分支的内容**（被 rebase 上去的那一端的"现状"）
 *     :3: = **当前分支的内容**（本机正在 rebase 的提交）
 *   即"看起来像 ours 的 :2: 实际是对端，看起来像 theirs 的 :3: 实际是本机"。
 *   若按字面把 :2: 叫 ours，UI 会把两边标反，用户就会选错边、把本机内容
 *   覆盖成远端。因此本模块**不用 ours/theirs 命名**，改用 stage2/stage3，
 *   由调用方（UI）按场景决定哪个标签给用户看，并明确标注"待确认"。
 *
 * @param {string} hub 中枢路径。
 * @param {string} file 仓库相对路径。
 * @returns {Promise<{ok:boolean, file:string, base?:string|null, stage2?:string|null, stage3?:string|null, truncated?:boolean, error?:string}>}
 */
export async function inspectConflict(hub, file) {
  const rel = normalizeRel(file)
  if (!rel) return { ok: false, file: String(file ?? ''), error: '非法文件路径' }
  const out = { ok: true, file: rel }
  let truncated = false
  for (const [stage, key] of [[1, 'base'], [2, 'stage2'], [3, 'stage3']]) {
    const r = await git(['show', `:${stage}:${rel}`], { repo: hub, timeoutMs: 20_000 })
    if (!r.ok) {
      // 该阶段不存在（如新增文件没有 base）→ null，不是错误。
      out[key] = null
      continue
    }
    if (Buffer.byteLength(r.stdout, 'utf8') > MAX_STAGE_BYTES) {
      out[key] = r.stdout.slice(0, MAX_STAGE_BYTES)
      truncated = true
    } else {
      out[key] = r.stdout
    }
  }
  out.truncated = truncated
  return out
}

/**
 * 把一段内容写成某个冲突文件的解决结果（G1：只在调用方明确要求时写）。
 *
 * @param {string} hub 中枢路径。
 * @param {string} file 仓库相对路径。
 * @param {string} content 解决后的完整内容。
 * @returns {{ok:boolean, file:string, bytes?:number, error?:string}}
 */
export function writeResolution(hub, file, content) {
  const rel = normalizeRel(file)
  if (!rel) return { ok: false, file: String(file ?? ''), error: '非法文件路径' }
  const target = path.join(hub, rel.split('/').join(path.sep))
  // 防目录穿越：解析后必须仍在中枢内。
  const resolved = path.resolve(target)
  if (!resolved.startsWith(path.resolve(hub) + path.sep)) {
    return { ok: false, file: rel, error: '路径越出中枢目录' }
  }
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, String(content ?? ''), 'utf8')
    return { ok: true, file: rel, bytes: Buffer.byteLength(String(content ?? ''), 'utf8') }
  } catch (error) {
    return { ok: false, file: rel, error: String(error?.message ?? error) }
  }
}

/**
 * 收尾：git add 指定文件 + rebase --continue（G3/G4/G5/G6）。
 *
 * @param {string} hub 中枢路径。
 * @param {string[]} files 要标记为已解决的文件（仓库相对路径）。
 * @returns {Promise<{ok:boolean, added?:string[], error?:string, remaining?:string[]}>}
 */
export async function finishRebase(hub, files) {
  // G6
  if (!isRebasing(hub)) {
    return { ok: false, error: '当前没有进行中的 rebase，无需收尾' }
  }
  // G4：只 add 点名的文件。
  const list = (files ?? []).map((f) => normalizeRel(f)).filter(Boolean)
  if (list.length === 0) {
    return { ok: false, error: '没有指定要标记为已解决的文件' }
  }
  for (const rel of list) {
    const r = await git(['add', '--', rel], { repo: hub, timeoutMs: 30_000 })
    if (!r.ok) {
      return { ok: false, error: `git add ${rel} 失败：${r.stderr.trim().slice(0, 200)}` }
    }
  }
  // G5：还有未解决冲突就拒绝继续。
  const remaining = await listConflicts(hub)
  if (remaining.ok && remaining.files.length > 0) {
    return {
      ok: false,
      error: `仍有 ${remaining.files.length} 个文件未解决：${remaining.files.join(', ')}`,
      remaining: remaining.files,
    }
  }
  // G3：只 add + continue。
  // ⚠️ 必须给 GIT_EDITOR：无编辑器环境下 rebase --continue 会挂起等编辑器
  // （实测在临时仓库里直接卡死 120s+）。'true' 命令直接退出 0，不改 commit message。
  const cont = await git(['rebase', '--continue'], {
    repo: hub,
    timeoutMs: 120_000,
    env: { GIT_EDITOR: 'true', EDITOR: 'true' },
  })
  if (!cont.ok) {
    return {
      ok: false,
      error: `rebase --continue 失败：${`${cont.stdout}\n${cont.stderr}`.trim().slice(0, 300)}`,
    }
  }
  return { ok: true, added: list }
}

/**
 * 规范化仓库相对路径：拒绝绝对路径、盘符、.. 穿越。
 * @param {string} file 用户/调用方给的路径。
 * @returns {string|null} 合法相对路径；非法返回 null。
 */
function normalizeRel(file) {
  if (typeof file !== 'string') return null
  const s = file.trim().replace(/\\/g, '/')
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s)) return null
  const parts = []
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return null
    parts.push(seg)
  }
  return parts.length > 0 ? parts.join('/') : null
}
