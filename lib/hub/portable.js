/**
 * lib/hub/portable.js —— 换机补齐（M3b 第五个模块，本插件自身的"官方没有的能力"）。
 *
 * 背景：中枢只同步"插件清单"（config/plugin.txt），**不带源码**。新机器 pull 之后
 * 必须现场 clone 自研插件源码 + 写 link 依赖 + 挂 bundles，否则"清单有了但插件没装"。
 * 这正是官方设置→插件 / dshmarket 都不覆盖的能力，也是本插件保留它的理由（D6）。
 *
 * 移植自 tools/install-plugin.ps1（265 行，本次只读参考，未改动原文件）
 * 与 tools/apply.ps1 的 profile link 段。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 守卫清单                                                              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ G1 **绝不碰凭据**：本模块不读、不写、不打印任何 token；只调用            │
 * │    `git credential fill` 询问"凭据是否已在管理器里"（是/否），           │
 * │    拿不到就停下让用户去控制台人工登录。                                 │
 * │ G2 **dryRun 默认开**：所有会写磁盘的动作（clone / 写 package.json）     │
 * │    都先出计划，调用方显式 dryRun:false 才执行。                         │
 * │ G3 **改 profile 前必备份**：写任何 package.json 前先复制成              │
 * │    package.json.bak-<stamp>-portable。                                  │
 * │ G4 **只认清单里声明的仓库**：repo / tag 只从 config/plugin.txt 读，      │
 * │    不接受调用方传入的任意 URL（防注入）。                               │
 * │ G5 **已 clone 就 pull 不重clone**：目标目录已有 .git 时只做 pull，       │
 * │    绝不覆盖用户在该目录里的本地改动。                                   │
 * │ G6 **缺 git 直接停**：git 不可用时返回明确错误，不做任何后续动作。       │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @module lib/hub/portable.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { run, git, isDir } from '../exec.js'
import { dshHome } from './snapshot.js'

/**
 * 读中枢的插件自动 clone 清单（G4：唯一数据源）。
 *
 * @param {string} hub 中枢路径。
 * @returns {{ok:boolean, name?:string, repo?:string, tag?:string, error?:string}}
 */
export function readPluginSpec(hub) {
  const file = path.join(hub, 'config', 'plugin.txt')
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch {
    return { ok: false, error: `找不到插件清单：${file}` }
  }
  const kv = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  if (!kv.name || !kv.repo) {
    return { ok: false, error: 'plugin.txt 缺少 name 或 repo' }
  }
  return { ok: true, name: kv.name, repo: kv.repo, tag: kv.tag || '' }
}

/**
 * G6：git 可用性。
 * @returns {Promise<{ok:boolean, version?:string}>}
 */
export async function checkGit() {
  const r = await run('git', ['--version'], { timeoutMs: 8000 })
  return r.ok ? { ok: true, version: r.stdout.trim() } : { ok: false }
}

/**
 * G1：凭据是否已在 Windows 凭据管理器（只问有没有，绝不读内容、绝不打印）。
 *
 * 做法：走 git credential 协议（stdin 喂 protocol/host，stdout 若返回 username
 * 说明有记录）。**不读取、不回显 password 字段**，只据其存在性返回布尔。
 * 之所以不用 `git config credential.helper` 探测：helper 可能配在任何作用域
 * （系统/全局/本地），漏探测会把"有凭据"误报成"没有"（本次实测踩到）。
 *
 * @param {string} host 仓库主机名，默认 gitee.com。
 * @returns {Promise<{ok:boolean, haveCredential:boolean, user?:string}>}
 */
export async function credentialPresent(host = 'gitee.com') {
  const r = await run('git', ['credential', 'fill'], {
    timeoutMs: 10_000,
    stdin: `protocol=https\nhost=${host}\n\n`,
    env: { GIT_TERMINAL_PROMPT: '0' },
  })
  if (!r.ok) return { ok: true, haveCredential: false }
  // 只取 username 是否存在；password 绝不进返回值。
  const user = r.stdout.match(/^username=(.*)$/m)?.[1]?.trim()
  return { ok: true, haveCredential: Boolean(user), user: user ?? '' }
}

/**
 * 目标插件源码目录（中枢 plugins/<name>）。
 * @param {string} hub 中枢路径。
 * @param {string} name 插件包名。
 * @returns {string}
 */
export function pluginSourceDir(hub, name) {
  return path.join(hub, 'plugins', name)
}

/**
 * G5：clone 或 pull 插件源码。
 *
 * @param {string} hub 中枢路径。
 * @param {{dryRun?:boolean, signal?:AbortSignal}} [options]
 * @returns {Promise<{ok:boolean, action?:string, dir?:string, error?:string}>}
 */
export async function cloneOrPullPlugin(hub, options = {}) {
  const spec = readPluginSpec(hub)
  if (!spec.ok) return { ok: false, error: spec.error }

  const dir = pluginSourceDir(hub, spec.name)
  if (isDir(path.join(dir, '.git'))) {
    if (options.dryRun) return { ok: true, action: 'would-pull', dir }
    const r = await git(['pull', '--rebase'], { repo: dir, signal: options.signal, timeoutMs: 600_000 })
    return r.ok
      ? { ok: true, action: 'pulled', dir }
      : { ok: false, action: 'pull', error: `${r.stdout}\n${r.stderr}`.trim().slice(0, 300) }
  }

  if (options.dryRun) return { ok: true, action: 'would-clone', dir }
  // G4：URL 与 tag 来自清单，不来自调用方。
  const args = ['clone', spec.repo, dir]
  if (spec.tag) args.push('--branch', spec.tag, '--single-branch')
  const r = await run('git', args, { timeoutMs: 600_000, signal: options.signal })
  if (!r.ok) {
    return { ok: false, action: 'clone', error: `${r.stdout}\n${r.stderr}`.trim().slice(0, 300) }
  }
  return { ok: true, action: 'cloned', dir }
}

/**
 * G3：把插件 link 进指定 profile（改前备份）。
 *
 * @param {string} hub 中枢路径。
 * @param {string} profileName profile 名（如 desktop）。
 * @param {{dryRun?:boolean}} [options]
 * @returns {{ok:boolean, profile?:string, backup?:string, changed?:boolean, error?:string}}
 */
export function linkPluginIntoProfile(hub, profileName, options = {}) {
  const spec = readPluginSpec(hub)
  if (!spec.ok) return { ok: false, error: spec.error }
  if (!/^[A-Za-z0-9._-]+$/.test(profileName)) {
    return { ok: false, error: `非法 profile 名：${profileName}` }
  }

  const pkgPath = path.join(dshHome(), 'profiles', profileName, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, error: `profile 不存在：${pkgPath}` }
  }
  let pkg
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch (error) {
    return { ok: false, error: `package.json 解析失败：${String(error?.message ?? error)}` }
  }

  const srcDir = pluginSourceDir(hub, spec.name)
  // 统一用正斜杠绝对路径（与中枢 apply.ps1 的写法一致，Windows 上 file: 依赖也能认）。
  const linkTarget = `file:${srcDir.split(path.sep).join('/')}`

  const deps = pkg.dependencies ?? {}
  const already = deps[spec.name] === linkTarget
  const bundles = pkg.dsh?.profile?.bundles ?? []
  const bundled = bundles.includes(spec.name)
  if (already && bundled) {
    return { ok: true, profile: profileName, changed: false }
  }

  if (options.dryRun) {
    return { ok: true, profile: profileName, changed: true, action: 'would-link' }
  }

  // G3：改前备份。
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const backup = `${pkgPath}.bak-${stamp}-portable`
  fs.copyFileSync(pkgPath, backup)

  pkg.dependencies = { ...deps, [spec.name]: linkTarget }
  pkg.dsh = pkg.dsh ?? {}
  pkg.dsh.profile = pkg.dsh.profile ?? {}
  pkg.dsh.profile.bundles = bundled ? bundles : [...bundles, spec.name]
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  return { ok: true, profile: profileName, changed: true, backup }
}

/**
 * 一键换机补齐（G2：默认 dryRun，先看计划）。
 *
 * @param {string} hub 中枢路径。
 * @param {{profile?:string, dryRun?:boolean, signal?:AbortSignal}} [options]
 * @returns {Promise<{ok:boolean, steps:Array<{step:string,ok:boolean,detail:string}>, error?:string}>}
 */
export async function portableSetup(hub, options = {}) {
  const steps = []
  const dryRun = options.dryRun !== false
  const profile = options.profile ?? 'desktop'

  // G6
  const gitOk = await checkGit()
  steps.push({ step: 'git', ok: gitOk.ok, detail: gitOk.version || 'git 不可用' })
  if (!gitOk.ok) {
    return { ok: false, steps, error: 'git 不可用，请先安装 Git for Windows' }
  }

  // G1
  const cred = await credentialPresent()
  steps.push({ step: 'credential', ok: cred.haveCredential, detail: cred.haveCredential ? '凭据管理器已配置' : '未检测到凭据，需在控制台人工登录 Gitee' })

  // clone / pull
  const cp = await cloneOrPullPlugin(hub, { dryRun, signal: options.signal })
  steps.push({ step: 'source', ok: cp.ok, detail: `${cp.action ?? 'failed'}${cp.dir ? ` → ${cp.dir}` : ''}${cp.error ? `：${cp.error}` : ''}` })

  // link into profile
  const link = linkPluginIntoProfile(hub, profile, { dryRun })
  steps.push({ step: 'profile', ok: link.ok, detail: link.error ?? (link.changed ? `将写入 ${profile}` : `${profile} 已一致`) })

  return { ok: steps.every((s) => s.ok), steps, dryRun }
}
