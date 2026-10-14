/**
 * lib/hub-paths.js —— 中枢路径解析（通用化版本）。
 *
 * 判定标准：目录里同时有 VERSION 和 tools/status.ps1 即视为中枢仓库根。
 *
 * 解析顺序（对任何用户都成立，不含任何作者个人路径）：
 *   1. config.hubPath —— 插件配置（cordis.patch.yml 的 config 段 / 设置页可写）；
 *   2. 环境变量 SYNC_HUB_PATH；
 *   3. 持久化偏好文件 <DSH_HOME>/sync-hub-path（首次引导向导写入）；
 *   4. 通用惯例位置：~/sync-hub 与 ~/Documents/sync-hub（允许空仓起步）；
 *   5. 找不到 → path:null，由上层进入"首次运行引导"。
 *
 * 作者本机的具体路径在作者自己的 DSH_HOME/sync-hub-path 里，不入代码仓。
 *
 * @module lib/hub-paths.js
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { dshHome } from './hub/snapshot.js'

/**
 * 判断一个目录是否是中枢仓库根。
 * @param {string} p 目录路径。
 * @returns {boolean}
 */
export function looksLikeHub(p) {
  try {
    return fs.statSync(path.join(p, 'VERSION')).isFile()
      && fs.statSync(path.join(p, 'tools', 'status.ps1')).isFile()
  } catch {
    return false
  }
}

/**
 * 持久化偏好文件路径（引导向导"记住这个路径"写这里）。
 * @returns {string}
 */
export function preferenceFile() {
  return path.join(dshHome(), 'sync-hub-path')
}

/**
 * N7 自动推送开关的偏好文件（内容为 '1' = 开）。
 * @returns {string}
 */
export function autoPushPrefFile() {
  return path.join(dshHome(), 'sync-hub-autopush')
}

/**
 * 读自动推送开关（N7）。默认关：文件不存在或内容非 '1' 都视为关。
 * @returns {boolean}
 */
export function readAutoPush() {
  try { return fs.readFileSync(autoPushPrefFile(), 'utf8').trim() === '1' } catch { return false }
}

/**
 * 写自动推送开关（N7）。
 * @param {boolean} on 开/关。
 * @returns {{ok:boolean, on?:boolean, error?:string}}
 */
export function writeAutoPush(on) {
  try {
    if (on) fs.writeFileSync(autoPushPrefFile(), '1', 'utf8')
    else {
      const f = autoPushPrefFile()
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    return { ok: true, on: Boolean(on) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * 读取持久化的中枢路径偏好。
 * @returns {string|null} 没存过或内容为空返回 null。
 */
export function readSavedHubPath() {
  try {
    const saved = fs.readFileSync(preferenceFile(), 'utf8').trim()
    return saved || null
  } catch {
    return null
  }
}

/**
 * 保存中枢路径偏好（首次引导/设置页写入）。
 *
 * 守卫：
 *   1. 只接受绝对路径，拒绝相对路径与不存在路径；
 *   2. 写入前统一规范化（正斜杠 → 系统分隔符、折叠重复分隔符、去尾部分隔符），
 *      防止多层转义产生的 `D:\\dir\\` 双斜杠脏数据进偏好文件
 *      （2026-10-14 实测：PowerShell→Node 双层转义曾写入 20 字符的双反斜杠路径）。
 *
 * @param {string} p 绝对路径。
 * @returns {{ok:boolean, saved?:string, error?:string}}
 */
export function saveHubPath(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: '路径不能为空' }
  }
  const cleaned = raw.trim().replace(/\//g, '\\')
  if (!path.isAbsolute(cleaned)) {
    return { ok: false, error: '必须是绝对路径' }
  }
  // 折叠重复分隔符并去尾部：D:\\a\\b\\ → D:\a\b
  const normalized = cleaned.replace(/\\{2,}/g, '\\').replace(/\\+$/, '')
  if (!fs.existsSync(normalized)) {
    return { ok: false, error: `目录不存在：${normalized}` }
  }
  try {
    fs.writeFileSync(preferenceFile(), normalized, 'utf8')
    return { ok: true, saved: normalized }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * 通用惯例候选（任何用户都合理的安装位置；允许空仓起步，只查存在性）。
 * @returns {string[]}
 */
function genericCandidates() {
  const home = os.homedir()
  return [
    path.join(home, 'sync-hub'),
    path.join(home, 'Documents', 'sync-hub'),
    path.join(home, 'Documents', 'AI', 'sync-hub'),
  ]
}

/**
 * 解析中枢路径。
 *
 * @param {{hubPath?:string}} [config] 插件配置。
 * @returns {{path:string|null, source:string, needsOnboarding:boolean}}
 *   path 为 null 时 needsOnboarding:true —— 上层应进入首次运行引导。
 *   source 说明来源：'config' | 'env' | 'saved' | 'candidate:<i>' | 'none'。
 */
export function resolveHubPath(config) {
  // 1) 插件配置
  if (config?.hubPath && looksLikeHub(config.hubPath)) {
    return { path: config.hubPath, source: 'config', needsOnboarding: false }
  }
  // 2) 环境变量
  const fromEnv = process.env.SYNC_HUB_PATH
  if (fromEnv && looksLikeHub(fromEnv)) {
    return { path: fromEnv, source: 'env', needsOnboarding: false }
  }
  // 3) 持久化偏好（引导向导写入）
  const saved = readSavedHubPath()
  if (saved) {
    if (looksLikeHub(saved)) {
      return { path: saved, source: 'saved', needsOnboarding: false }
    }
    // 存了偏好但目录现在不是完整中枢（比如刚 clone 完还没有 VERSION）：
    // 仍返回该路径但标记 needsOnboarding，让面板显示"路径已记住但缺文件"。
    if (fs.existsSync(saved)) {
      return { path: saved, source: 'saved', needsOnboarding: true }
    }
  }
  // 4) 通用惯例位置（允许空仓起步）
  const candidates = genericCandidates()
  for (let i = 0; i < candidates.length; i += 1) {
    if (fs.existsSync(candidates[i])) {
      return { path: candidates[i], source: `candidate:${i}`, needsOnboarding: !looksLikeHub(candidates[i]) }
    }
  }
  // 5) 什么都没有 → 首次运行引导
  return { path: null, source: 'none', needsOnboarding: true }
}

/**
 * 读取中枢 VERSION 文件内容。
 * @param {string} hub 中枢路径。
 * @returns {string|null}
 */
export function readHubVersion(hub) {
  try { return fs.readFileSync(path.join(hub, 'VERSION'), 'utf8').trim() } catch { return null }
}
