/**
 * guard-conflict.mjs —— 冲突解决器真场景测试（N1，D16 验收）。
 *
 * 为什么必须造真冲突：冲突解决器的守卫（不自动解决、不 add -A、
 * 有未解决就拒绝 finish、非 rebase 状态拒绝 finish）只有在 git 真的进入
 * rebase 冲突态时才能被验证。mock 数据证明不了任何事。
 *
 * 场景构造（全在临时目录，绝不碰真中枢）：
 *   1) init 一个仓库，提交 base 版 shared.md；
 *   2) 开分支 other，改成"对端版本"并提交；
 *   3) 回 main，改成"本机版本"并提交；
 *   4) git rebase other → 必然冲突；
 *   5) 逐条跑守卫断言。
 *
 * 用法：node tests/guard-conflict.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { run, git } from '../lib/exec.js'
import {
  isRebasing, listConflicts, inspectConflict, writeResolution, finishRebase,
} from '../lib/hub/conflict.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
const failures = []

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

/** 造一个处于 rebase 冲突态的仓库，返回其路径。 */
async function makeConflictedRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-hub-conflict-'))
  const g = async (args) => {
    const r = await run('git', ['-C', base, ...args], { timeoutMs: 15_000 })
    if (!r.ok) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
    return r
  }
  await g(['init', '-q', '-b', 'main'])
  await g(['config', 'user.email', 't@t'])
  await g(['config', 'user.name', 't'])
  // 无编辑器环境下 rebase --continue 会挂起等编辑器；置为 true 直接退出。
  await g(['config', 'core.editor', 'true'])
  fs.writeFileSync(path.join(base, 'shared.md'), 'BASE\n', 'utf8')
  await g(['add', '.'])
  await g(['commit', '-qm', 'base'])

  await g(['checkout', '-q', '-b', 'other'])
  fs.writeFileSync(path.join(base, 'shared.md'), 'THEIRS\n', 'utf8')
  await g(['commit', '-qam', 'theirs'])

  await g(['checkout', '-q', 'main'])
  fs.writeFileSync(path.join(base, 'shared.md'), 'OURS\n', 'utf8')
  await g(['commit', '-qam', 'ours'])

  // rebase 必冲突
  await run('git', ['-C', base, 'rebase', 'other'], { timeoutMs: 15_000 })
  return base
}

console.log('真场景：rebase 冲突态')

const repo = await makeConflictedRepo()
console.log(`  临时仓库：${repo}`)

await test('G6/G1 确实进入 rebase 冲突态，且列出冲突文件', async () => {
  assert.equal(isRebasing(repo), true, '必须检测到 rebase 进行中')
  const r = await listConflicts(repo)
  assert.equal(r.ok, true)
  assert.deepStrictEqual(r.files, ['shared.md'], '冲突文件必须是 shared.md')
})

await test('G2 inspect 给出三段内容且不做文本合并', async () => {
  const r = await inspectConflict(repo, 'shared.md')
  assert.equal(r.ok, true)
  assert.equal(r.base, 'BASE\n', 'base 段必须是共同祖先内容')
  // 实测语义（git rebase 场景，2026-10-14 在本测试中确证）：
  //   :2:（stage2）= 被 rebase 上去的那一端（other 分支）= 对端内容
  //   :3:（stage3）= 当前分支（main）= 本机内容
  // 这正是模块不用 ours/theirs 命名的原因——字面命名会把两边标反。
  assert.equal(r.stage2, 'THEIRS\n', 'stage2 必须是对端（other）内容')
  assert.equal(r.stage3, 'OURS\n', 'stage3 必须是本机（main）内容')
})

await test('G1 未调用 resolve 前工作区文件仍是 git 原样（带冲突标记）', async () => {
  const text = fs.readFileSync(path.join(repo, 'shared.md'), 'utf8')
  assert.match(text, /<<<<<<<|>>>>>>>/, 'git 写的冲突标记必须还在（没被偷偷解决）')
})

await test('G4/G5 finish 在仍有冲突时拒绝（且不 add -A）', async () => {
  const r = await finishRebase(repo, [])
  assert.equal(r.ok, false, '没点名文件必须拒绝')
  assert.match(r.error, /没有指定/)
})

await test('路径守卫：绝对路径 / 盘符 / .. 全部拒绝', async () => {
  assert.equal((await inspectConflict(repo, '/etc/passwd')).ok, false, '绝对路径必须拒')
  assert.equal((await inspectConflict(repo, 'C:\\windows\\x')).ok, false, '盘符路径必须拒')
  assert.equal((await inspectConflict(repo, '../outside.md')).ok, false, '.. 穿越必须拒')
  assert.equal(writeResolution(repo, '../evil.md', 'x').ok, false, '写操作同样拒 ..')
  assert.equal(writeResolution(repo, '/abs/evil.md', 'x').ok, false, '写操作同样拒绝对路径')
})

await test('G1/G2 解决单个文件后，其余冲突仍能列出', async () => {
  const w = writeResolution(repo, 'shared.md', 'MERGED BY HAND\n')
  assert.equal(w.ok, true)
  assert.equal(w.file, 'shared.md')
  // 写完之后 git 仍认为它未解决（没 add），所以仍在冲突列表里。
  const r = await listConflicts(repo)
  assert.deepStrictEqual(r.files, ['shared.md'], '未 add 前仍算未解决')
})

await test('G3/G4/G5 add + continue 收尾成功', async () => {
  const r = await finishRebase(repo, ['shared.md'])
  assert.equal(r.ok, true, `收尾应成功：${r.error ?? ''}`)
  assert.equal(isRebasing(repo), false, 'rebase 必须结束')
  const text = fs.readFileSync(path.join(repo, 'shared.md'), 'utf8')
  assert.equal(text, 'MERGED BY HAND\n', '文件内容必须是解决后的值')
  const log = await git(['log', '--oneline'], { repo })
  assert.ok(log.stdout.includes('ours'), '本机提交必须保留在历史里')
})

await test('G6 rebase 结束后再次 finish 被拒绝', async () => {
  const r = await finishRebase(repo, ['shared.md'])
  assert.equal(r.ok, false)
  assert.match(r.error, /没有进行中的 rebase/)
})

await test('正常仓库上 listConflicts 返回空而非报错', async () => {
  const r = await listConflicts(repo)
  assert.equal(r.ok, true)
  assert.deepStrictEqual(r.files, [])
})

// 清理
fs.rmSync(repo, { recursive: true, force: true })

console.log(`\n冲突解决器测试：${passed} 通过，${failures.length} 失败`)
if (failures.length > 0) {
  console.log('\n失败清单：')
  for (const f of failures) console.log(`  - ${f.name}`)
  process.exitCode = 1
}
