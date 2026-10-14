/**
 * lib/exec.js —— 执行层：脱离 PowerShell 的唯一出口。
 *
 * 设计依据（开发文档 §6.1，决策 D11）：
 *   旧版 v0.11.0 的宿主半身有 56 处 spawn powershell 调 .ps1，踩遍
 *   编码 / BOM / 自动变量 / 函数名遮蔽四类坑（memory 4.19 / 4.21 / 4.22）。
 *   v2.0 起本模块是**唯一** spawn 出口，且**只 spawn 两类程序**：
 *     1) git —— 只读查询（status / log / diff / rev-list）与同步动作；
 *     2) 系统程序 —— schtasks（定时任务）等，按需增加，仍不 spawn powershell。
 *   文件操作一律 Node fs；递归复制逐文件 copyFileSync（不用 cpSync，memory 4.6）。
 *
 * 铁律（写死在实现里，改代码前先读）：
 *   1. 参数一律数组形态传给 child_process，**绝不拼字符串**（BOM/编码坑根除）；
 *   2. 每个调用带 AbortSignal + 超时，超时杀进程树，不留下孤儿 PowerShell；
 *   3. stdout/stderr 一律按 UTF-8 读，不做任何码页假设；
 *   4. 结果统一结构化 { ok, code, data, text }，调用方按 ok 分支，**绝不按 message 猜**；
 *   5. 本模块不包含任何业务判断，业务（守卫）在 lib/hub/* 各模块。
 *
 * @module lib/exec.js
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 默认超时：只读查询 15s，写动作 10 分钟（推送/拉取大仓库可能慢）。 */
export const TIMEOUT_READ_MS = 15_000
export const TIMEOUT_WRITE_MS = 600_000

/**
 * spawn 一个外部程序并回收其完整输出。
 *
 * 为什么不用 execSync：它抛异常时拿不到部分输出，且无法取消；
 * 为什么不用 shell：见铁律 1。
 *
 * 编码说明：系统程序（schtasks / cmd / taskkill）在中文 Windows 上按系统 ANSI
 * 码页（GBK/936）输出，直接按 UTF-8 解码会得到乱码，进而让"任务不存在"这类
 * 正常状态被误判成错误（memory 4.9 同款坑）。因此 encoding 选项默认 'auto'：
 * 先按 UTF-8 试解，出现替换字符则按系统码页重解。
 *
 * @param {string} program 程序名或绝对路径（'git' 由 PATH 解析）。
 * @param {string[]} args 参数数组，**禁止**含 shell 元字符的拼接串。
 * @param {object} [options]
 * @param {string} [options.cwd] 工作目录；git 类调用必须显式给中枢路径。
 * @param {number} [options.timeoutMs] 超时毫秒；到点杀进程。
 * @param {AbortSignal} [options.signal] 外部取消信号（调用方取消）。
 * @param {Record<string,string>} [options.env] 附加环境变量。
 * @param {number} [options.maxBuffer] 输出上限，默认 32MB。
 * @param {'auto'|'utf8'|'ansi'} [options.encoding] 输出解码方式，默认 'auto'。
 * @param {string} [options.stdin] 写入子进程 stdin 的文本（用于 git credential fill 这类协议）。
 * @returns {Promise<{ok:boolean, code:number, stdout:string, stderr:string, error?:string, timedOut?:boolean, aborted?:boolean}>}
 */
export function run(program, args, options = {}) {
  const {
    cwd,
    timeoutMs = TIMEOUT_READ_MS,
    signal,
    env,
    maxBuffer = 32 * 1024 * 1024,
    encoding = 'auto',
    stdin,
  } = options

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false
    let child = null

    /** 唯一结算出口：无论成功、失败、取消、超时都走这里，绝不二次 resolve。 */
    const settle = (extra = {}) => {
      if (settled) return
      settled = true
      try { if (signal) signal.removeEventListener('abort', onAbort) } catch { /* 已移除或无监听器 */ }
      resolve({
        ok: extra.ok ?? false,
        code: extra.code ?? 1,
        stdout,
        stderr,
        ...extra,
      })
    }

    const onAbort = () => {
      aborted = true
      if (child && child.pid) {
        // Windows 下 kill 不发 SIGTERM 给 git 这类不装信号处理器的程序，
        // 用 taskkill /T /F 连带进程树，避免留下孤儿。
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      }
      if (child) child.kill()
    }

    if (signal?.aborted) {
      settle({ ok: false, code: 1, error: 'aborted', aborted: true })
      return
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    try {
      child = spawn(program, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        windowsHide: true,
        stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
      // stdin 文本（git credential 协议用）：写完立即 end，避免子进程挂等。
      if (stdin !== undefined && child.stdin) {
        child.stdin.on('error', () => { /* EPIPE：子进程提前退出时无害 */ })
        child.stdin.end(stdin, 'utf8')
      }
    } catch (error) {
      settle({ ok: false, code: 1, error: String(error?.message ?? error) })
      return
    }

    let bytesOut = 0
    let bytesErr = 0
    child.stdout?.on('data', (chunk) => {
      bytesOut += chunk.length
      if (bytesOut <= maxBuffer) stdout += decodeChunk(chunk, encoding)
    })
    child.stderr?.on('data', (chunk) => {
      bytesErr += chunk.length
      if (bytesErr <= maxBuffer) stderr += decodeChunk(chunk, encoding)
    })

    const timer = setTimeout(() => {
      timedOut = true
      if (child && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      }
      if (child) child.kill()
    }, Math.max(1, timeoutMs))
    if (typeof timer.unref === 'function') timer.unref()

    child.on('error', (error) => {
      clearTimeout(timer)
      settle({ ok: false, code: 1, error: String(error?.message ?? error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      settle({
        ok: code === 0,
        code: code ?? 1,
        ...(timedOut ? { timedOut: true, error: `timeout after ${timeoutMs}ms` } : {}),
        ...(aborted ? { aborted: true } : {}),
      })
    })
  })
}

/** 系统 ANSI 码页（中文 Windows = 936）。运行时探测一次即可。 */
let SYSTEM_CP = null
function systemCodePage() {
  if (SYSTEM_CP !== null) return SYSTEM_CP
  try {
    // 用 cmd 的 chcp 输出探测当前活动码页。
    const { execSync } = require('node:child_process')
    const out = execSync('chcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const m = String(out).match(/(\d{3})/)
    SYSTEM_CP = m ? Number(m[1]) : 936
  } catch {
    SYSTEM_CP = 936
  }
  return SYSTEM_CP
}

/**
 * 按指定策略解码一段输出。
 *
 * @param {Buffer} chunk 原始字节。
 * @param {'auto'|'utf8'|'ansi'} mode 解码策略。
 * @returns {string}
 */
function decodeChunk(chunk, mode) {
  if (mode === 'utf8') return chunk.toString('utf8')
  if (mode === 'ansi') return decodeAnsi(chunk)
  // auto：先 UTF-8；若含替换符（说明不是合法 UTF-8）则按系统码页重解。
  const asUtf8 = chunk.toString('utf8')
  if (!asUtf8.includes('\uFFFD')) return asUtf8
  return decodeAnsi(chunk)
}

/**
 * 按系统 ANSI 码页解码（Node 无内置 iconv，用 cp 支持的解码器）。
 * @param {Buffer} chunk 原始字节。
 * @returns {string}
 */
function decodeAnsi(chunk) {
  const cp = systemCodePage()
  try {
    // Node 的 Buffer 只内置 utf8/utf16le/base64/hex/latin1，
    // 对 GBK 需要 ICU 支持的 'gbk' 标签（Node 24 全量 ICU 默认带）。
    const tag = cp === 936 ? 'gbk' : cp === 950 ? 'big5' : cp === 932 ? 'shift_jis' : `cp${cp}`
    return new TextDecoder(tag).decode(chunk)
  } catch {
    return chunk.toString('latin1')
  }
}

/**
 * git 只读查询。git 的正常进度行（Cloning into...）走 stderr，
 * 所以 stderr 有内容**不代表失败**，一律以 exit code 判定。
 *
 * @param {string[]} args git 子命令与参数，如 ['status', '--porcelain']。
 * @param {{repo:string, timeoutMs?:number, signal?:AbortSignal, env?:Record<string,string>}} options
 * @returns {Promise<{ok:boolean, code:number, stdout:string, stderr:string}>}
 */
export function git(args, { repo, timeoutMs = TIMEOUT_READ_MS, signal, env } = {}) {
  return run('git', ['-C', repo, ...args], { timeoutMs, signal, cwd: repo, env })
}

/**
 * 逐文件递归复制（替代 fs.cpSync，规避 Node 空目录崩溃，memory 4.6）。
 *
 * @param {string} src 源目录。
 * @param {string} dst 目标目录（不存在则创建）。
 * @returns {{copied:number, files:string[]}} 复制结果。
 */
export function copyTree(src, dst) {
  let copied = 0
  const files = []
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, entry.name)
      const t = path.join(to, entry.name)
      if (entry.isDirectory()) {
        walk(s, t)
      } else if (entry.isFile()) {
        fs.copyFileSync(s, t)
        copied += 1
        files.push(path.relative(dst, t).split(path.sep).join('/'))
      }
      // 其他类型（符号链接 / socket 等）跳过：中枢内容不需要。
    }
  }
  walk(src, dst)
  return { copied, files }
}

/**
 * 递归删除目录（替代 fs.rmSync，规避受管目录 EIO / ENOTEMPTY，memory 4.6）。
 *
 * @param {string} target 要删除的目录。
 * @returns {number} 删除的文件数。
 */
export function removeTree(target) {
  let removed = 0
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else { fs.unlinkSync(p); removed += 1 }
    }
    fs.rmdirSync(dir)
  }
  if (fs.existsSync(target)) walk(target)
  return removed
}

/**
 * 判断某路径是否存在且是目录。
 * @param {string} p 路径。
 * @returns {boolean}
 */
export function isDir(p) {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

/**
 * 判断某路径是否存在且是普通文件。
 * @param {string} p 路径。
 * @returns {boolean}
 */
export function isFile(p) {
  try { return fs.statSync(p).isFile() } catch { return false }
}
