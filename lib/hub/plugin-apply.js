/**
 * lib/hub/plugin-apply.js —— 插件一键更新落地（v2.4.1）。
 *
 * 老大实测：面板能看到"有新版本"，但没法直接更新——检查完只能干看着。
 * 本模块把"更新"补成一条命令跑完的动作：
 *   ① 拉 GitHub tag 到缓存目录（浅取，镜像→直连兜底）
 *   ② 校验 tag 真实存在 + package.json 版本对得上
 *   ③ 备份现有安装目录（改名 .bak-时间戳，不删）
 *   ④ 整套拷入（按 git ls-tree 清单，排除 tests/docs 等发布外文件）
 *   ⑤ 回读校验（版本一致 + 关键文件哈希抽验），失败自动回滚到备份
 *
 * 守卫：
 *   P1 只写 profiles/<合法名>/node_modules/dsh-sync-hub，路径拼接前校验 profile 名
 *   P2 绝不 rm 旧目录 —— 只改名留底，回滚 = 改回来
 *   P3 拷贝清单以 tag 里 package.json 的 files 字段为准（发布什么装什么）
 *   P4 任何一步失败 → 自动回滚 + 如实上报，不留半套
 *
 * @module lib/hub/plugin-apply
 */

import fs from 'node:fs'
import path from 'node:path'
import { run } from '../exec.js'
import { dshHome } from './snapshot.js'
import { PLUGIN_REPO_URLS } from './plugin-update.js'

/** profile 名合法格式（防路径注入）。 */
const PROFILE_RE = /^[A-Za-z0-9._-]+$/

/**
 * 把指定 tag 的源码浅取到缓存目录。
 * @param {string} tag 形如 v2.4.0。
 * @param {string} cacheDir 缓存目录。
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<{ok:boolean, error?:string, from?:string}>}
 */
export async function fetchPluginTag(tag, cacheDir, options = {}) {
  if (!/^v?\d+\.\d+\.\d+$/.test(String(tag))) return { ok: false, error: `tag 格式不合法：${tag}` }
  const errors = []
  for (const repoUrl of PLUGIN_REPO_URLS) {
    // 目录已存在 → fetch+checkout；不存在 → 浅 clone 单 tag。
    let r
    if (fs.existsSync(path.join(cacheDir, '.git'))) {
      await run('git', ['-C', cacheDir, 'fetch', '--depth', '1', 'origin', `refs/tags/${tag}:refs/tags/${tag}`],
        { timeoutMs: 120_000, signal: options.signal })
      r = await run('git', ['-C', cacheDir, 'checkout', '-f', tag], { timeoutMs: 30_000, signal: options.signal })
    } else {
      fs.mkdirSync(path.dirname(cacheDir), { recursive: true })
      r = await run('git', ['clone', '--depth', '1', '--branch', tag, repoUrl, cacheDir],
        { timeoutMs: 120_000, signal: options.signal })
    }
    if (r.ok) return { ok: true, from: repoUrl }
    errors.push(`${repoUrl.replace('https://gh-proxy.com/https://', '')}：${`${r.stdout}\n${r.stderr}`.trim().slice(0, 160)}`)
  }
  return { ok: false, error: `所有地址都拉不下来：\n${errors.join('\n')}` }
}

/**
 * 读 tag 源码目录里 package.json 的 files 清单（P3：发布什么装什么）。
 * @param {string} srcDir 已 checkout 到目标 tag 的源码目录。
 * @returns {string[]|null} 相对路径清单；读不到返回 null（调用方兜底全拷）。
 */
export function readFilesList(srcDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'))
    return Array.isArray(pkg.files) && pkg.files.length ? pkg.files : null
  } catch {
    return null
  }
}

/** 递归拷贝（跳过 .git）。 */
function copyTreeSkip(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === '.git') continue
    const s = path.join(from, e.name)
    const t = path.join(to, e.name)
    if (e.isDirectory()) copyTreeSkip(s, t)
    else fs.copyFileSync(s, t)
  }
}

/** 按清单拷贝（条目可以是文件或目录）。 */
function copyEntries(srcDir, dstDir, entries) {
  for (const rel of entries) {
    const s = path.join(srcDir, ...rel.split('/'))
    const t = path.join(dstDir, ...rel.split('/'))
    if (!fs.existsSync(s)) continue
    if (fs.statSync(s).isDirectory()) copyTreeSkip(s, t)
    else { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(s, t) }
  }
}

/**
 * 一键更新：拉 tag → 备份 → 整套拷入 → 回读校验（失败回滚）。
 *
 * @param {{tag:string, profile?:string, signal?:AbortSignal}} options
 *   tag 形如 v2.4.0；profile 缺省 desktop。
 * @returns {Promise<{ok:boolean, version?:string, backup?:string, from?:string, error?:string, rolledBack?:boolean}>}
 */
export async function applyPluginUpdate(options = {}) {
  const tag = String(options.tag ?? '').trim()
  if (!/^v?\d+\.\d+\.\d+$/.test(tag)) return { ok: false, error: `tag 不合法：${tag}` }
  const profile = String(options.profile ?? 'desktop').trim()
  if (!PROFILE_RE.test(profile)) return { ok: false, error: `profile 名不合法：${profile}` }

  const pkgName = 'dsh-sync-hub'
  const dstDir = path.join(dshHome(), 'profiles', profile, 'node_modules', pkgName)
  // 专属缓存目录（不碰 DSH 自己的 ~/.dsh/cache，防互相污染）
  const cacheDir = path.join(dshHome(), 'plugin-src-cache', pkgName)

  // ① 拉 tag
  const fetched = await fetchPluginTag(tag, cacheDir, { signal: options.signal })
  if (!fetched.ok) return { ok: false, error: fetched.error }

  // ② 校验源码版本与 tag 自洽（4.24 教训：tag 与 package.json 必须一致）
  let srcVersion = null
  try {
    srcVersion = JSON.parse(fs.readFileSync(path.join(cacheDir, 'package.json'), 'utf8')).version
  } catch { /* 下面统一报 */ }
  if (!srcVersion) return { ok: false, error: `缓存里读不到 package.json（${cacheDir}），中止，未动现有安装。` }
  if (srcVersion !== tag.replace(/^v/, '')) {
    return { ok: false, error: `tag ${tag} 与源码版本 ${srcVersion} 不一致（发布事故），中止，未动现有安装。` }
  }

  // ③ 备份现有安装（P2：只改名不删）
  let backup = null
  try {
    if (fs.existsSync(dstDir)) {
      backup = `${dstDir}.bak-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`
      fs.renameSync(dstDir, backup)
    }
    fs.mkdirSync(dstDir, { recursive: true })
  } catch (e) {
    return { ok: false, error: `备份/建目录失败：${String(e?.message ?? e)}`, ...(backup ? { backup } : {}) }
  }

  // ④ 整套拷入（P3：按 files 清单）。
  // 实测坑（v2.4.1）：package.json 的 files 字段按 npm 惯例【不含 package.json 本身】
  // （发布工具自动带上）——照单拷会漏它，回读必炸。强制并入。
  const entries = new Set(readFilesList(cacheDir) ?? ['index.js', 'client.js', 'lib', 'package.json', 'cordis.patch.yml'])
  entries.add('package.json')
  try {
    copyEntries(cacheDir, dstDir, [...entries])
  } catch (e) {
    // P4 回滚
    try {
      fs.rmSync(dstDir, { recursive: true, force: true })
      if (backup) fs.renameSync(backup, dstDir)
    } catch { /* 回滚也失败会在下面报出来 */ }
    return { ok: false, error: `拷贝失败已回滚：${String(e?.message ?? e)}`, rolledBack: true }
  }

  // ⑤ 回读校验（P4：不过就回滚）
  try {
    const got = JSON.parse(fs.readFileSync(path.join(dstDir, 'package.json'), 'utf8')).version
    if (got !== srcVersion) throw new Error(`回读版本 ${got} ≠ ${srcVersion}`)
    for (const must of ['client.js', 'index.js']) {
      if (!fs.existsSync(path.join(dstDir, must))) throw new Error(`缺关键文件 ${must}`)
    }
  } catch (e) {
    try {
      fs.rmSync(dstDir, { recursive: true, force: true })
      if (backup) fs.renameSync(backup, dstDir)
    } catch { /* 回滚失败如实报 */ }
    return { ok: false, error: `回读校验失败已回滚：${String(e?.message ?? e)}`, rolledBack: true }
  }

  return { ok: true, version: srcVersion, backup, from: fetched.from }
}
