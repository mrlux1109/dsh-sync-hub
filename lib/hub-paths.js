/**
 * lib/hub-paths.js —— 中枢路径解析。
 *
 * 移植自旧版 v0.11.0 的 HUB_CANDIDATES 逻辑（原 index.js），
 * 保持判定标准不变：目录里同时有 VERSION 和 tools/status.ps1 即视为中枢。
 *
 * 解析顺序：config.hubPath → env SYNC_HUB_PATH → 候选列表（家机 / 店机 / 家目录）。
 *
 * @module lib/hub-paths.js
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 按机器排列的候选中枢路径（店机 D:\AI\sync-hub，家机 D:\【AI智能】\sync-hub）。 */
const CANDIDATES = [
  'D:\\【AI智能】\\sync-hub',
  'D:\\AI\\sync-hub',
  'D:\\AI\\龙虾\\工作空间\\sync-hub',
]

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
 * 解析中枢路径。
 *
 * @param {{hubPath?:string}} [config] 插件配置（cordis patch 的 config 段）。
 * @returns {{path:string|null, source:string}}
 *   path 为 null 表示没找到；source 说明来源，便于诊断（'config' | 'env' | 'candidate:<i>' | 'none'）。
 */
export function resolveHubPath(config) {
  if (config?.hubPath && looksLikeHub(config.hubPath)) {
    return { path: config.hubPath, source: 'config' }
  }
  const fromEnv = process.env.SYNC_HUB_PATH
  if (fromEnv && looksLikeHub(fromEnv)) {
    return { path: fromEnv, source: 'env' }
  }
  for (let i = 0; i < CANDIDATES.length; i += 1) {
    if (looksLikeHub(CANDIDATES[i])) return { path: CANDIDATES[i], source: `candidate:${i}` }
  }
  // 兜底：家目录下 sync-hub（不强制 VERSION 判定，允许空仓起步）。
  const home = path.join(os.homedir(), 'sync-hub')
  if (fs.existsSync(home)) return { path: home, source: 'candidate:home' }
  return { path: null, source: 'none' }
}

/**
 * 读取中枢 VERSION 文件内容。
 * @param {string} hub 中枢路径。
 * @returns {string|null}
 */
export function readHubVersion(hub) {
  try { return fs.readFileSync(path.join(hub, 'VERSION'), 'utf8').trim() } catch { return null }
}
