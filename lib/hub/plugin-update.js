/**
 * lib/hub/plugin-update.js —— 插件更新检查（单一事实源，v2.3.1）。
 *
 * 此前 api.js 的 checkPluginUpdate 和 tools.js 的 sync_hub_plugin_update
 * 各抄了一份几乎相同的逻辑（数据红线：禁止手抄副本）。本模块合并：
 *   · 本地版本：认 DSH_HOME，遍历所有 profile 找装了本插件的那个
 *   （旧版硬钉 os.homedir()+profiles/desktop，profile 不叫 desktop 就永远 unknown）
 *   · 远端 tag：run() 异步 spawn —— 旧版 execSync 同步阻塞最长 15 秒，
 *   期间面板所有 HTTP 请求卡死（老大报「检查更新按钮点不动」的真凶）
 *   · 镜像兜底：gh-proxy 挂了退回直连
 *
 * @module lib/hub/plugin-update
 */

import fs from 'node:fs'
import path from 'node:path'
import { run } from '../exec.js'
import { dshHome } from './snapshot.js'

/** 插件源码仓库地址候选：主镜像 → 直连兜底（plugin-apply.js 共用同一份）。 */
export const PLUGIN_REPO_URLS = [
  'https://gh-proxy.com/https://github.com/mrlux1109/dsh-sync-hub.git',
  'https://github.com/mrlux1109/dsh-sync-hub.git',
]

/**
 * 语义版本比较。
 * @param {string} a 版本（可带 v 前缀）。
 * @param {string} b 版本。
 * @returns {number} a<b 负 / a==b 零 / a>b 正。
 */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number)
  const pb = String(b).replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0
    const y = Number.isFinite(pb[i]) ? pb[i] : 0
    if (x !== y) return x - y
  }
  return 0
}

/**
 * 找本机已安装插件的位置与版本。
 * @returns {{found:boolean, version:string, where:string}}
 */
export function resolveInstalledPlugin() {
  const profRoot = path.join(dshHome(), 'profiles')
  let profiles = []
  try {
    profiles = fs.readdirSync(profRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return { found: false, version: 'unknown', where: `profiles 目录不存在：${profRoot}` }
  }
  for (const p of profiles) {
    const pkgPath = path.join(profRoot, p, 'node_modules', 'dsh-sync-hub', 'package.json')
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      return { found: true, version: String(pkg.version ?? 'unknown'), where: `profile ${p}` }
    } catch { /* 这个 profile 没装，看下一个 */ }
  }
  return { found: false, version: 'unknown', where: `已查 ${profiles.length} 个 profile 都没装` }
}

/**
 * 检查更新：异步 ls-remote 各候选地址，返回对比结果。
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<{ok:boolean, current?:string, latest?:string, hasUpdate?:boolean, where?:string, error?:string}>}
 */
export async function checkPluginUpdate(options = {}) {
  const local = resolveInstalledPlugin()
  let latest = 'unknown'
  const tried = []
  for (const repoUrl of PLUGIN_REPO_URLS) {
    const r = await run('git', ['-c', 'credential.helper=', 'ls-remote', '--tags', repoUrl], {
      timeoutMs: 20_000,
      signal: options.signal,
    })
    if (!r.ok) {
      tried.push(`${repoUrl.replace('https://gh-proxy.com/', '')}：${String(r.stderr ?? r.error ?? '失败').trim().slice(0, 120)}`)
      continue
    }
    const tags = String(r.stdout)
      .split('\n')
      .map((line) => {
        const m = line.match(/refs\/tags\/(v?\d+\.\d+\.\d+)/)
        return m ? m[1] : null
      })
      .filter(Boolean)
    if (tags.length === 0) {
      tried.push(`${repoUrl.replace('https://gh-proxy.com/', '')}：拿到 0 个 tag`)
      continue
    }
    tags.sort(compareVersions)
    latest = tags[tags.length - 1]
    break
  }
  if (latest === 'unknown') {
    return {
      ok: false,
      current: local.version,
      error: `GitHub 连不上，检查不了更新。逐地址失败原因：\n${tried.join('\n')}\n提示：确认镜像/直连可用（gh-mirror.bat 可切换镜像）。`,
    }
  }
  return {
    ok: true,
    current: local.version,
    latest,
    hasUpdate: local.found && compareVersions(local.version, latest) < 0,
    where: local.where,
  }
}
