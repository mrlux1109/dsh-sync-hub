/**
 * lib/trust.js —— HTTP 面信任围栏。
 *
 * 为什么必须有：插件注册的前缀比内核 /api 更长，webServer 是最长前缀优先分发，
 * 所以本插件的路由跑在 connection 服务的准入门禁**之前**，否则任何 loopback
 * 调用者都能打到（含 DNS rebinding）。
 *
 * 实现依据（memory 4.17⑤ + 2026-10-13 实锤）：照抄 dsh-our-free-model/src/trust.js
 * 的 structuralReason 结构，不自己另写一套。两层，按序尝试：
 *   1) 组合自带的 connection 服务（内核 /api 的同一道准入门禁，含浏览器鉴权）；
 *   2) 结构复制品：Host 必须 loopback、拒 cross-site、Origin/Referer 与 Host
 *      权威一致，并对桌面版 dsh-app://app 中继 Referer 开窄口。
 *
 * ⚠️ 窄口为什么必须开：桌面版页面是 dsh-app://app，经 forwardWebRequest 中继到
 * loopback HTTP 时**没有 Origin、没有 Sec-Fetch-*，只留 Referer: dsh-app://app/...**。
 * 严格 same-origin 会把自家面板 403 死（症状：面板红字"后端不可达"）。
 *
 * @module lib/trust.js
 */

/** 同一机器调用者可用的主机名。 */
const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])

/**
 * 该地址是否是同一机器调用者可达（只绑 loopback）。
 * @param {string} value Host 值。
 * @returns {boolean}
 */
export function isLoopbackHost(value) {
  const authority = authorityOf(String(value ?? ''), 'http')
  return authority !== null && LOOPBACK_NAMES.has(authority.hostname)
}

/**
 * 把一个 Host/Origin/Referer 值拆成 {scheme, hostname, port}（端口缺省补齐）。
 * @param {string} value 头部值。
 * @param {string} [defaultScheme] 无 scheme 时的默认协议。
 * @returns {{scheme:string, hostname:string, port:string}|null}
 */
function authorityOf(value, defaultScheme) {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url
  try {
    url = new URL(value.includes('://') ? value.trim() : `${defaultScheme ?? 'http'}://${value.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  return { scheme: url.protocol.replace(':', ''), hostname: url.hostname.toLowerCase(), port }
}

/** 只放行本应用页面，不是任意自定义协议页面。 */
function isDesktopRelayReferer(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && url.port === ''
      && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/**
 * 结构围栏的判定理由；undefined = 放行。
 *
 * @param {import('node:http').IncomingMessage} req 请求。
 * @returns {string|undefined} 固定理由串（绝不回显调用方内容）。
 */
function structuralReason(req) {
  const host = authorityOf(req.headers.host, 'http')
  if (host === null || !LOOPBACK_NAMES.has(host.hostname)) return 'host-not-loopback'
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') return 'cross-site'
  for (const header of ['origin', 'referer']) {
    const raw = req.headers[header]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    if (header === 'referer' && isDesktopRelayReferer(raw)) {
      // 桌面中继剥掉了浏览器标记只留这个 Referer；它不是一个 Origin 授权，
      // 也不能覆盖已挂载 Host 的鉴权决定。若同时带了 Origin / Sec-Fetch-*，
      // 说明不是本家中继 → 拒绝。
      if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) {
        return 'desktop-relay-markers'
      }
      continue
    }
    const authority = authorityOf(raw.trim())
    if (authority === null) return `${header}-invalid`
    if (authority.scheme !== host.scheme || authority.hostname !== host.hostname || authority.port !== host.port) {
      return `${header}-mismatch`
    }
  }
  return undefined
}

/**
 * 结构围栏的拒绝状态（无 connection 服务时用）。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @returns {number|undefined} 403 或 undefined（放行）。
 */
export function structuralRejection(req) {
  return structuralReason(req) === undefined ? undefined : 403
}

/**
 * 判定一个请求：返回要拒绝的 HTTP 状态，或 undefined 放行。
 *
 * 与参考实现一致的两层顺序；connection 服务可以是对象或"每请求解析一次的 thunk"
 * （组合可能晚于插件加载才发布它）。
 *
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {object|(() => object|undefined)} [connection] 组合的 connection 服务。
 * @param {(decision: {status:number, source:string, reason:string}) => void} [onRejection]
 *   只收固定诊断字段，绝不收请求头或错误文本。
 * @returns {number|undefined}
 */
export function rejectionFor(req, connection, onRejection) {
  let decision
  try {
    const admit = typeof connection === 'function' ? connection()?.admit : connection?.admit
    if (typeof admit === 'function') {
      const admission = admit.call(connection, req)
      const status = admission && typeof admission === 'object' ? admission.rejection : undefined
      if (status === undefined) return undefined
      decision = { status, source: 'connection', reason: 'host-rejected' }
    } else {
      const reject = typeof connection === 'function' ? connection()?.requestRejection : connection?.requestRejection
      if (typeof reject === 'function') {
        const status = reject.call(connection, req)
        if (status === undefined) return undefined
        decision = { status, source: 'connection', reason: 'host-rejected' }
      }
    }
  } catch {
    // 已挂载的 Host 服务出错时，绝不因此绕过浏览器鉴权。
    decision = { status: 503, source: 'connection', reason: 'admission-error' }
  }
  if (decision === undefined) {
    const reason = structuralReason(req)
    if (reason === undefined) return undefined
    decision = { status: 403, source: 'structural', reason }
  }
  try {
    onRejection?.(decision)
  } catch {
    // 诊断是观察性的，logger 不能改变 HTTP 决定。
  }
  return decision.status
}
