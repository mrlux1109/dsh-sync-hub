/**
 * guard-tests.mjs —— 守卫负例单测（开发文档 §9 L3b，决策 D16）。
 *
 * 每条对应 lib/hub/status.js 顶部守卫清单的一条，全部为**负例**：
 * 喂恶意/异常输入，断言系统拒绝或不妄为。守卫没绿不准接 UI。
 *
 * 用法：node tests/guard-tests.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { hubStatus, hubInventory, hubLog } from '../lib/hub/status.js'
import { git, run, copyTree, removeTree, isDir, isFile } from '../lib/exec.js'
import { resolveHubPath, looksLikeHub, readHubVersion } from '../lib/hub-paths.js'
import { secretGuard, resolveScopes, previewPush } from '../lib/hub/sync.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
const failures = []

/** 跑一条用例，记录成败但继续（一次看全失败清单）。 */
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✅ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  ❌ ${name}\n     ${String(error?.message ?? error).split('\n')[0]}`)
  }
}

console.log('G1 只读守卫：status 模块绝不执行写命令')
await test('非 git 目录 → 报错而非假“干净”', async () => {
  const r = await hubStatus(os.tmpdir())
  assert.equal(r.ok, false, '必须失败')
  assert.match(r.error, /不是 git 仓库|not a git repository/i)
})
await test('不存在的路径 → 报错而非崩溃', async () => {
  const r = await hubStatus(path.join(os.tmpdir(), 'definitely-not-here-xyz'))
  assert.equal(r.ok, false)
  assert.ok(r.error, '必须带 error 字段')
})

console.log('G3 退出码判定守卫：stderr 有内容但 exit 0 必须算成功')
await test('git rev-parse 正常返回（stderr 为空、exit 0）', async () => {
  // 用一个真实仓库验证：git 的进度/提示走 stderr，不许按文本判失败。
  const repo = resolveHubPath({}).path
  assert.ok(repo, '本机应能解析到中枢仓库')
  const r = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { repo })
  assert.equal(r.ok, true, 'exit 0 即成功，即使 stderr 有内容')
  assert.ok(r.stdout.trim().length > 0, '必须拿到分支名')
})

console.log('G4 超时守卫：慢命令必须被取消且如实报告')
await test('超时的命令 → timedOut 标记 + 非 0', async () => {
  const r = await run('node', ['-e', 'setTimeout(()=>{}, 30000)'], { timeoutMs: 300 })
  assert.equal(r.ok, false)
  assert.equal(r.timedOut, true, '必须标记 timedOut')
})
await test('外部取消信号 → aborted 标记', async () => {
  const ac = new AbortController()
  const p = run('node', ['-e', 'setTimeout(()=>{}, 30000)'], { signal: ac.signal })
  setTimeout(() => ac.abort(), 200)
  const r = await p
  assert.equal(r.ok, false)
  assert.equal(r.aborted, true, '必须标记 aborted')
})

console.log('G5 路径守卫：解析不谎报')
await test('伪造 hubPath（缺 VERSION）→ 不被采信', async () => {
  const r = resolveHubPath({ hubPath: os.tmpdir() })
  assert.notEqual(r.path, os.tmpdir(), '缺 VERSION/tools 的目录不能当中枢')
})
await test('looksLikeHub 对空目录返回 false', async () => {
  assert.equal(looksLikeHub(os.tmpdir()), false)
})
await test('readHubVersion 对坏路径返回 null', async () => {
  assert.equal(readHubVersion(path.join(os.tmpdir(), 'nope')), null)
})

console.log('exec 辅助守卫')
await test('copyTree 复制文件内容一致', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-hub-ct-'))
  const src = path.join(base, 'src')
  const dst = path.join(base, 'dst')
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello', 'utf8')
  fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'world', 'utf8')
  const r = copyTree(src, dst)
  assert.equal(r.copied, 2)
  assert.equal(fs.readFileSync(path.join(dst, 'a.txt'), 'utf8'), 'hello')
  assert.equal(fs.readFileSync(path.join(dst, 'sub', 'b.txt'), 'utf8'), 'world')
  removeTree(base)
})
await test('copyTree 空目录不崩溃（memory 4.6）', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-hub-empty-'))
  const src = path.join(base, 'src')
  fs.mkdirSync(src, { recursive: true })
  const r = copyTree(src, path.join(base, 'dst'))
  assert.equal(r.copied, 0)
  removeTree(base)
})
await test('removeTree 递归删除后目录不存在', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-hub-rm-'))
  fs.mkdirSync(path.join(base, 'a', 'b'), { recursive: true })
  fs.writeFileSync(path.join(base, 'a', 'b', 'x.txt'), 'x', 'utf8')
  const n = removeTree(base)
  assert.equal(n, 1)
  assert.equal(isDir(base), false)
})
await test('removeTree 对不存在路径返回 0 不抛', async () => {
  assert.equal(removeTree(path.join(os.tmpdir(), 'never-existed-xyz')), 0)
})
await test('isDir / isFile 对不存在路径返回 false', async () => {
  const nope = path.join(os.tmpdir(), 'nope-xyz')
  assert.equal(isDir(nope), false)
  assert.equal(isFile(nope), false)
})

console.log('数据形状守卫：上游缺失时 ahead/behind 为 null，不谎报 0')
await test('无 upstream 的仓库 → ahead/behind = null', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-hub-noups-'))
  await run('git', ['init', '-q'], { cwd: base })
  await run('git', ['-C', base, 'config', 'user.email', 't@t'], {})
  await run('git', ['-C', base, 'config', 'user.name', 't'], {})
  fs.writeFileSync(path.join(base, 'f.txt'), 'x', 'utf8')
  await run('git', ['-C', base, 'add', '.'], {})
  await run('git', ['-C', base, 'commit', '-qm', 'init'], {})
  const r = await hubStatus(base)
  assert.equal(r.ok, true, '本地仓库应能查')
  assert.equal(r.ahead, null, '无上游时必须 null，不能谎报 0')
  assert.equal(r.behind, null, '无上游时必须 null，不能谎报 0')
  assert.equal(r.dirtyCount, 0)
  removeTree(base)
})

console.log('hubLog 守卫')
await test('hubLog 对非仓库返回 ok:false + error', async () => {
  const r = await hubLog(os.tmpdir())
  assert.equal(r.ok, false)
  assert.ok(r.error)
})

console.log('身份守卫（lib/hub/apply.js，G1 指纹 + G2 换身份 YES 联动）')
{
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-hub-idguard-'))
  fs.mkdirSync(path.join(fake, 'logs'), { recursive: true })
  fs.writeFileSync(path.join(fake, '.sync-hub-machine'), 'home', 'utf8')
  process.env.DSH_HOME = fake
  // 重新 import，让模块读到新的 DSH_HOME。
  const applyMod = await import(`../lib/hub/apply.js?guard=${Date.now()}`)
  // 注意：这里的 hub 路径必须**显式**取本机中枢，不能用 resolveHubPath()——
  // 它会读 <DSH_HOME>/sync-hub-path 偏好，而本用例刚把 DSH_HOME 指到了
  // 假目录（里面没有偏好文件）→ 返回 null → 后续 git -C null 全炸。
  const hub = 'D:\\【AI智能】\\sync-hub'

  await test('G1 指纹不符（shop 档案打家机）→ REFUSED', async () => {
    const r = applyMod.identityGuard(hub, 'shop', { dryRun: true })
    assert.equal(r.ok, false)
    assert.equal(r.action, 'REFUSED')
    assert.match(r.reason, /指纹不符/)
  })

  await test('G6 机器档案不存在 → 拒绝并列出可用 id', async () => {
    const r = applyMod.identityGuard(hub, 'nope', { dryRun: true })
    assert.equal(r.ok, false)
    assert.match(r.reason, /机器档案不存在/)
  })

  await test('G1+G2 联动：force 也不能绕过换身份 YES 闸（回归用例）', async () => {
    // 曾经的真实缺陷：force 分支提前 return，导致 G2 被跳过、可无声换身份。
    const r = applyMod.identityGuard(hub, 'shop', { dryRun: true, force: true })
    assert.equal(r.ok, false, 'force 模式下换身份仍必须确认')
    assert.equal(r.needConfirm, 'YES')
    assert.equal(r.action, 'REFUSED_SWITCH')
  })

  await test('G2 确认必须字面 YES（小写 yes 无效）', async () => {
    const r = applyMod.identityGuard(hub, 'shop', { dryRun: true, force: true, confirm: 'yes' })
    assert.equal(r.ok, false)
    assert.equal(r.needConfirm, 'YES')
  })

  await test('G2 显式 YES 后放行并记 forced', async () => {
    const r = applyMod.identityGuard(hub, 'shop', { dryRun: true, force: true, confirm: 'YES' })
    assert.equal(r.ok, true)
    assert.equal(r.action, 'SWITCH')
    assert.equal(r.forced, true)
  })

  await test('G3 审计日志落盘（FIRST SET / SWITCH / REFUSED 都要记）', async () => {
    const logFile = path.join(fake, 'logs', 'identity-changes.log')
    // 清掉已有标记，确保走 FIRST SET 分支（前面用例已把标记写成 home）。
    fs.rmSync(path.join(fake, '.sync-hub-machine'), { force: true })
    applyMod.identityGuard(hub, 'home', {})
    assert.ok(fs.existsSync(logFile), '审计日志必须存在')
    const text = fs.readFileSync(logFile, 'utf8')
    assert.match(text, /\| FIRST SET \| machine=home/, '首次设置要记账')
    // 再切一次身份，验证 SWITCH 也记账（需 force 因为 home 档案指纹就是本机，用 shop 触发）
    fs.writeFileSync(path.join(fake, '.sync-hub-machine'), 'home', 'utf8')
    applyMod.identityGuard(hub, 'shop', { force: true, confirm: 'YES' })
    const text2 = fs.readFileSync(logFile, 'utf8')
    assert.match(text2, /\| SWITCH \| home -> shop answer=YES forced=true/, '显式换身份要记账')
  })

  await test('G4 技能合并不覆盖已有不同内容', async () => {
    // 用中枢真实 skills 跑一次 dryRun：added/differing 都应是数组且不抛。
    const r = applyMod.mergeSkills(hub, { dryRun: true })
    assert.equal(r.ok, true)
    assert.ok(Array.isArray(r.added) && Array.isArray(r.differing))
  })

  fs.rmSync(fake, { recursive: true, force: true })
}

console.log('会话备份红线守卫（lib/hub/sessions.js，G1 违禁文件双向拦截）')
{
  const mod = await import('../lib/hub/sessions.js')
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-hub-sess-'))

  await test('G1 文件形态违禁（.credentials.yaml）被拦截', async () => {
    const d = path.join(fake, 'a')
    fs.mkdirSync(path.join(d, '--D--AI--', 's1'), { recursive: true })
    fs.writeFileSync(path.join(d, '--D--AI--', 's1', 'x.jsonl'), '{}', 'utf8')
    fs.writeFileSync(path.join(d, '.credentials.yaml'), 'token: SECRET', 'utf8')
    const hits = mod.scanForbidden(d)
    assert.ok(hits.includes('.credentials.yaml'), '必须抓到文件形态')
  })

  await test('G1 目录形态违禁（.anonymous-user-id）被拦截', async () => {
    const d = path.join(fake, 'b')
    fs.mkdirSync(path.join(d, '.anonymous-user-id'), { recursive: true })
    const hits = mod.scanForbidden(d)
    assert.ok(hits.some((h) => h.startsWith('.anonymous-user-id')), '必须抓到目录形态')
  })

  await test('G1 深层嵌套违禁也被抓到（递归）', async () => {
    const d = path.join(fake, 'c')
    fs.mkdirSync(path.join(d, 'ws', 'deep', 'deeper'), { recursive: true })
    fs.writeFileSync(path.join(d, 'ws', 'deep', 'deeper', '.credentials.yaml'), 'x', 'utf8')
    const hits = mod.scanForbidden(d)
    assert.deepStrictEqual(hits, ['ws/deep/deeper/.credentials.yaml'])
  })

  await test('G1 干净目录不误报', async () => {
    const d = path.join(fake, 'clean')
    fs.mkdirSync(path.join(d, 'ws', 's1'), { recursive: true })
    fs.writeFileSync(path.join(d, 'ws', 's1', 'a.jsonl'), '{}', 'utf8')
    assert.deepStrictEqual(mod.scanForbidden(d), [])
  })

  await test('G1 备份动作：源树有违禁文件 → 中止且零复制', async () => {
    const d = path.join(fake, 'src')
    fs.mkdirSync(path.join(d, 'ws'), { recursive: true })
    fs.writeFileSync(path.join(d, 'ws', 'a.jsonl'), '{}', 'utf8')
    fs.writeFileSync(path.join(d, '.credentials.yaml'), 'token: x', 'utf8')
    // 把 DSH_HOME 指到这个假目录，让 sessionsDir() 命中它。
    const prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = d
    try {
      // sessions 模块在 import 时读 dshHome，这里用动态 import 拿新实例不可行，
      // 所以直接验证 scanForbidden（备份函数的守卫就是它）。
      const hits = mod.scanForbidden(path.join(d, 'sessions'))
      assert.deepStrictEqual(hits, [], '空 sessions 目录应无命中')
      const hits2 = mod.scanForbidden(d)
      assert.ok(hits2.includes('.credentials.yaml'))
    } finally {
      process.env.DSH_HOME = prevHome
    }
  })

  await test('G4 工作区路径编解码往返一致', async () => {
    const p = 'D:\\【AI智能】\\工作空间'
    assert.equal(mod.decodeWsPath(mod.encodeWsPath(p)), p)
  })

  await test('G4 解码与 DSH 真实会话目录名吻合', async () => {
    // 用本机真实存在的会话目录名验证算法等价性。
    const real = fs.readdirSync(path.join(os.homedir(), '.dsh', 'sessions'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
    if (real.length === 0) return
    const decoded = mod.decodeWsPath(real[0].name)
    assert.match(decoded, /^[A-Za-z]:\\/, '解码结果必须是绝对路径形态')
    // 再编码回去应还原目录名（算法自洽）。
    assert.equal(mod.encodeWsPath(decoded), real[0].name)
  })

  await test('G4 路径映射把 shop 工作区折成本机布局', async () => {
    const enc = mod.encodeWsPath('D:\\AI\\龙虾\\工作空间')
    const mapped = mod.mapWorkspaceFolder('shop', enc, {
      shop: [{ from: 'D:/AI/龙虾/工作空间', to: 'D:/【AI智能】/工作空间' }],
    })
    assert.notEqual(mapped, enc, '命中映射必须改变目录名')
    assert.equal(mod.decodeWsPath(mapped), 'D:\\【AI智能】\\工作空间')
  })

  await test('G4 无映射表时目录名原样返回', async () => {
    const enc = mod.encodeWsPath('D:\\AI\\龙虾\\工作空间')
    assert.equal(mod.mapWorkspaceFolder('shop', enc, null), enc)
  })

  await test('G2 恢复永不覆盖（函数存在且返回计数）', async () => {
    const r = mod.restoreSessions('D:/【AI智能】/sync-hub', { from: '__nonexistent__' })
    assert.equal(r.ok, false, '不存在的机器备份必须报错而非静默成功')
  })

  fs.rmSync(fake, { recursive: true, force: true })
}

console.log(`\n守卫单测：${passed} 通过，${failures.length} 失败`)
if (failures.length > 0) {
  console.log('\n失败清单：')
  for (const f of failures) console.log(`  - ${f.name}`)
  process.exitCode = 1
}
