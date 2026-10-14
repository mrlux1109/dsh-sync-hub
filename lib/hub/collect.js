/**
 * lib/hub/collect.js —— 工具链体检（M3b 第四个模块）。
 *
 * 移植自 tools/tools.ps1（256 行，本次只读参考，未改动原文件）。
 * 数据源：中枢 config/tools.txt（key|winget|probe|version|need|note）。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单                                                              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **只读体检**：list/missing 只探测存在性与版本，绝不装任何东西。      │
 * │ G2 **安装是显式动作**：install 只接受 manifest 里存在的 key 或          │
 * │    'missing'；拼错的名字报错列出可用项，绝不盲装。                      │
 * │ G3 **绝不重装已存在**：present 的工具跳过，避免无谓的 winget 网络操作。 │
 * │ G4 **不装 DSH 自带件**：rg / soffice 明确排除（DSH 自带 ripgrep 与     │
 * │    LibreOffice kit，装了反而重复占空间）——manifest 注释即契约。         │
 * │ G5 **版本探测永不抛**：探测命令失败/超时只记空版本，不影响整表。        │
 * │ G6 **探测命令白名单化**：只跑 manifest 里写的 probe + version 参数，    │
 * │    不执行任何来自用户输入的字符串。                                    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/collect.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { run } from '../exec.js'

/**
 * 解析 config/tools.txt。
 *
 * @param {string} hub 中枢路径。
 * @returns {{ok:boolean, tools:Array<{key:string,winget:string,probe:string,versionArgs:string[],need:string,note:string}>, error?:string}}
 */
export function readToolManifest(hub) {
  const file = path.join(hub, 'config', 'tools.txt')
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch {
    return { ok: false, tools: [], error: `找不到工具清单：${file}` }
  }
  const tools = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const p = line.split('|')
    if (p.length < 6) continue
    tools.push({
      key: p[0].trim(),
      winget: p[1].trim(),
      probe: p[2].trim(),
      versionArgs: p[3].trim() ? p[3].trim().split(/\s+/).filter(Boolean) : [],
      need: p[4].trim(),
      note: p.slice(5).join('|').trim(),
    })
  }
  return { ok: true, tools }
}

/**
 * 探测单个命令是否存在（G1/G5：只读，失败不抛）。
 *
 * @param {string} probe 命令名。
 * @returns {Promise<{present:boolean, version:string}>}
 */
async function probeTool(probe, versionArgs) {
  // 用 where.exe 探测存在性（比 Get-Command 更贴近"命令行能不能跑"）。
  const where = await run('where', [probe], { timeoutMs: 5000 })
  if (!where.ok) return { present: false, version: '' }
  if (versionArgs.length === 0) return { present: true, version: '' }
  const v = await run(probe, versionArgs, { timeoutMs: 8000 })
  if (!v.ok) return { present: true, version: '' }
  const first = `${v.stdout}\n${v.stderr}`.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''
  return { present: true, version: first.slice(0, 44) }
}

/**
 * 全量体检（G1）。
 *
 * @param {string} hub 中枢路径。
 * @returns {Promise<{ok:boolean, tools:Array<object>, summary:object, error?:string}>}
 */
export async function inspectTools(hub) {
  const manifest = readToolManifest(hub)
  if (!manifest.ok) return { ok: false, tools: [], summary: {}, error: manifest.error }

  const tools = []
  for (const t of manifest.tools) {
    const { present, version } = await probeTool(t.probe, t.versionArgs)
    tools.push({ ...t, present, version })
  }
  const summary = {
    total: tools.length,
    present: tools.filter((t) => t.present).length,
    missingCore: tools.filter((t) => t.need === 'core' && !t.present).map((t) => t.key),
    missingDev: tools.filter((t) => t.need === 'dev' && !t.present).map((t) => t.key),
    missingNice: tools.filter((t) => t.need === 'nice' && !t.present).map((t) => t.key),
  }
  return { ok: true, tools, summary }
}

/**
 * 安装指定工具（G2/G3：显式 key、跳过已装）。
 *
 * @param {string} hub 中枢路径。
 * @param {string[]} keys 工具 key 数组，或 ['missing']。
 * @param {{includeNice?:boolean}} [options]
 * @returns {Promise<{ok:boolean, installed:Array<{key:string,ok:boolean,detail:string}>, skipped:string[], unknown:string[], error?:string}>}
 */
export async function installTools(hub, keys, options = {}) {
  const manifest = readToolManifest(hub)
  if (!manifest.ok) return { ok: false, installed: [], skipped: [], unknown: [], error: manifest.error }
  const byKey = new Map(manifest.tools.map((t) => [t.key, t]))

  // G2：解析要装的集合。
  let targets = []
  const unknown = []
  for (const raw of keys ?? []) {
    const k = String(raw).trim().toLowerCase()
    if (k === 'missing') {
      targets = manifest.tools.filter((t) => !t.present && (t.need !== 'nice' || options.includeNice))
      break
    }
    const t = byKey.get(k)
    if (t) targets.push(t)
    else unknown.push(k)
  }
  // 去重。
  targets = [...new Map(targets.map((t) => [t.key, t])).values()]

  const installed = []
  const skipped = []
  for (const t of targets) {
    // G3：已存在就跳过（重新探测一次，避免 list 与 install 之间状态变化）。
    const { present } = await probeTool(t.probe, [])
    if (present) { skipped.push(t.key); continue }
    if (!t.winget || t.winget.startsWith('(')) {
      installed.push({ key: t.key, ok: false, detail: `没有 winget 包（${t.winget || '未提供'}），需手动安装` })
      continue
    }
    // G6：参数来自 manifest，不来自用户输入。
    const r = await run('winget', [
      'install', '--id', t.winget, '--silent', '--accept-package-agreements', '--accept-source-agreements',
    ], { timeoutMs: 600_000 })
    installed.push({
      key: t.key,
      ok: r.ok,
      detail: r.ok ? '已安装' : `${r.stdout}\n${r.stderr}`.trim().slice(0, 200),
    })
  }
  return { ok: installed.every((i) => i.ok), installed, skipped, unknown }
}

/**
 * 机器/环境盘点（"这台机器长什么样"，概览页用）。
 * 只读；绝不外传（这里没有任何凭据）。
 *
 * @returns {{os:string, node:string, arch:string, user:string, home:string}}
 */
export function machineFacts() {
  return {
    os: `${process.platform} ${process.arch}`,
    node: process.version,
    arch: process.arch,
    user: process.env.USERNAME ?? process.env.USER ?? '',
    computer: process.env.COMPUTERNAME ?? '',
    home: process.env.USERPROFILE ?? process.env.HOME ?? '',
    dshHome: process.env.DSH_HOME ?? '',
  }
}
