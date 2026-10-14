/**
 * lib/hub/skills.js —— 技能域（M6）：本机 ↔ 中枢双列对比。
 *
 * 对照旧版 v0.11.0 技能页（含跨 Agent 扫描、导入、回收站、云端增删），
 * v2.0 先做"对比 + 分类"这一核心（开发文档 §4.2 技能页），
 * 导入/回收站/云端增删留待 M7（依赖更多路由与确认交互）。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单                                                              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **只读对比**：scan/compare 只读两侧目录，绝不写、绝不删。           │
 * │ G2 **四类差异如实分类**：only-local / only-hub / differ / identical；  │
 * │    不合并、不猜测"哪个更新"——内容不同就是不同，交由人判断。            │
 * │ G3 **占位技能标出但不删**：名字里带 auto/placeholder 特征或            │
 * │    SKILL.md 缺失的，标 placeholder，绝不自动清理。                      │
 * │ G4 **只扫一层**：<root>/<skill>/ 即一个技能，不递归进技能内部；         │
 * │    符号链接目录跳过（防环）。                                          │
 * │ G5 **非法技能名跳过并报告**：不符合 kebab-case 的目录名不进列表，       │
 * │    但计入 invalid 计数（DSH 会静默跳过它们，这里要让人看见）。          │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/skills.js
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dshHome } from './snapshot.js'

/** kebab-case 名（DSH 技能发现器的硬要求，见 memory/shared.md 第 5 节）。 */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 扫一个技能根目录，返回每个技能的信息。
 *
 * @param {string} root 技能根（如 ~/.dsh/skills 或 <hub>/skills）。
 * @returns {{skills: Array<{name:string, hasSkillMd:boolean, disabled:boolean, sha:string|null, bytes:number, valid:boolean, placeholder:boolean}>, invalid: string[]}}
 */
export function scanSkills(root) {
  const out = { skills: [], invalid: [] }
  let entries
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    // G4：只一层；符号链接跳过。
    if (!e.isDirectory() || e.isSymbolicLink()) continue
    if (e.name.startsWith('.')) continue
    const dir = path.join(root, e.name)
    const skillMd = path.join(dir, 'SKILL.md')
    const disabledMd = path.join(dir, 'SKILL.md.disabled')
    const hasSkillMd = fs.existsSync(skillMd)
    const disabled = !hasSkillMd && fs.existsSync(disabledMd)
    let sha = null
    let bytes = 0
    const target = hasSkillMd ? skillMd : disabledMd
    if (fs.existsSync(target)) {
      try {
        const buf = fs.readFileSync(target)
        bytes = buf.length
        sha = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)
      } catch { /* 读不到就记 null */ }
    }
    const valid = KEBAB.test(e.name)
    if (!valid) out.invalid.push(e.name)
    out.skills.push({
      name: e.name,
      hasSkillMd,
      disabled,
      sha,
      bytes,
      valid,
      // G3：没有 SKILL.md（也无 .disabled）的视为占位/空壳。
      placeholder: !hasSkillMd && !disabled,
    })
  }
  out.skills.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * 对比本机与中枢的技能分布（G2：四类差异如实分类）。
 *
 * @param {string} hub 中枢路径。
 * @returns {{ok:boolean, local:object, hub:object, diff:Array<{name:string, kind:'only-local'|'only-hub'|'differ'|'identical', local?:object, hub?:object}>, summary:object}}
 */
export function compareSkills(hub) {
  const localRoot = path.join(dshHome(), 'skills')
  const hubRoot = path.join(hub, 'skills')
  const local = scanSkills(localRoot)
  const remote = scanSkills(hubRoot)
  const byLocal = new Map(local.skills.map((s) => [s.name, s]))
  const byHub = new Map(remote.skills.map((s) => [s.name, s]))
  const diff = []
  const names = [...new Set([...byLocal.keys(), ...byHub.keys()])].sort()

  for (const name of names) {
    const l = byLocal.get(name)
    const r = byHub.get(name)
    if (l && !r) diff.push({ name, kind: 'only-local', local: l })
    else if (!l && r) diff.push({ name, kind: 'only-hub', hub: r })
    else if (l.sha !== r.sha) diff.push({ name, kind: 'differ', local: l, hub: r })
    else diff.push({ name, kind: 'identical', local: l, hub: r })
  }

  return {
    ok: true,
    local,
    hub: remote,
    diff,
    summary: {
      total: names.length,
      identical: diff.filter((d) => d.kind === 'identical').length,
      differ: diff.filter((d) => d.kind === 'differ').length,
      onlyLocal: diff.filter((d) => d.kind === 'only-local').length,
      onlyHub: diff.filter((d) => d.kind === 'only-hub').length,
      placeholders: diff.filter((d) => (d.local?.placeholder) || (d.hub?.placeholder)).length,
      invalidLocal: local.invalid,
      invalidHub: remote.invalid,
    },
  }
}
