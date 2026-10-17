/**
 * tests/pull-apply-e2e.mjs —— v2.3.2 拉取/推送修复实测（老大现场复现）。
 *
 * 复现两个真凶：
 *  T1 脏工作区（session-backup 永远在变）→ 旧版 pull --rebase 直接拒绝，
 *     现在 --autostash 必须拉成功，且本地脏改动一个不丢。
 *  T2 pull 后必须 apply 到本机（AGENTS.md 重建 + 技能合并），
 *     回执里 applied 必须如实反映。
 *  T3 push 同病复现：脏工作区 + 远端有新提交 → 旧版 park 失败或 pull --rebase
 *     被拒导致「上传也有问题」；现在必须推成功且脏改动不丢、远端真收到。
 *
 * 用临时 git 仓库 + 临时 DSH_HOME 做，不碰真中枢、不写真 AGENTS.md。
 */
import { pull, push } from '../lib/hub/sync.js'
import { git, run } from '../lib/exec.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}

// ── 搭建：远端裸仓库 + "另一台机"推内容 + 本机克隆 + 制造脏工作区 ──
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-e2e-'))
const remote = path.join(root, 'remote.git')
const hub = path.join(root, 'hub')
const dsh = path.join(root, 'dshhome')
process.env.DSH_HOME = dsh
fs.mkdirSync(dsh, { recursive: true })

const sh = async (cmd, args, cwd) => {
  const r = await git(['-c', 'user.name=Test', '-c', 'user.email=t@x.io', ...args], { repo: cwd ?? hub })
  return r
}

// 裸远端（-b main：避免默认 HEAD 指 master 导致 clone 跟踪错分支）
await run('git', ['init', '--bare', '-b', 'main', remote], { timeoutMs: 30_000 })
// 本机克隆
fs.mkdirSync(hub, { recursive: true })
await run('git', ['-c', 'user.name=T', '-c', 'user.email=t@x.io', 'clone', remote, hub], { timeoutMs: 30_000 })

// 初始中枢内容（memory + 一台远端机器 home 推过的新记忆）
const mk = (p, txt) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt, 'utf8') }
mk(path.join(hub, 'memory', 'shared.md'), '# 共享记忆\n旧内容\n')
mk(path.join(hub, 'memory', 'machines', 'shop.md'), '# 店机\n本机是 shop\n')
mk(path.join(hub, 'VERSION'), '1\n')
mk(path.join(hub, 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: demo\n---\nbody\n')
await sh('git', ['add', '-A'], hub)
await sh('git', ['commit', '-m', 'init'], hub)
await sh('git', ['push', 'origin', 'HEAD:refs/heads/main'], hub)

// 模拟"另一台机"推新内容（用第二个克隆）
const other = path.join(root, 'other')
await run('git', ['-c', 'user.name=O', '-c', 'user.email=o@x.io', 'clone', remote, other], { timeoutMs: 30_000 })
mk(path.join(other, 'memory', 'shared.md'), '# 共享记忆\n新内容来自家机\n')
mk(path.join(other, 'memory', 'machines', 'home.md'), '# 家机\n')
await sh('git', ['add', '-A'], other)
await sh('git', ['commit', '-m', 'home push'], other)
await sh('git', ['push', 'origin', 'HEAD:refs/heads/main'], other)

// ── T1：制造脏工作区（session-backup 永远在变的现场）──
const dirtyFile = path.join(hub, 'session-backup', 'shop', 'dirty-session.txt')
mk(dirtyFile, '正在进行的对话记录\n')
const dirtyBefore = fs.readFileSync(dirtyFile, 'utf8')
check('现场就绪：脏文件已写入', fs.existsSync(dirtyFile))

// 设身份（apply 需要已保存的机器 id）
fs.writeFileSync(path.join(dsh, '.sync-hub-machine'), 'shop', 'utf8')

// ── 跑真实 pull（带修复的逻辑）──
const r = await pull(hub, {})
console.log('  pull 返回：', JSON.stringify({ ok: r.ok, stage: r.stage, commit: r.commit, applied: r.applied }).slice(0, 300))

check('T1 脏工作区下拉取成功（旧版此处报 "cannot pull with rebase"）', r.ok === true, r.error)
check('中枢文件真的更新（shared.md 变新内容）', fs.readFileSync(path.join(hub, 'memory', 'shared.md'), 'utf8').includes('新内容来自家机'))
check('T1 脏文件一个没丢（autostash 恢复）', fs.existsSync(dirtyFile) && fs.readFileSync(dirtyFile, 'utf8') === dirtyBefore)
check('T2 applied 存在且 agents 重建成功', r.applied?.agentsOk === true, JSON.stringify(r.applied))
check('T2 AGENTS.md 真落到 ~/.dsh', fs.existsSync(path.join(dsh, 'AGENTS.md')) && fs.readFileSync(path.join(dsh, 'AGENTS.md'), 'utf8').includes('新内容来自家机'))
check('T2 技能真合并（demo-skill 出现）', fs.existsSync(path.join(dsh, 'skills', 'demo-skill', 'SKILL.md')))
check('回执带机器 id', r.applied?.machine === 'shop')

// ── 再跑一次幂等：无新内容也不炸 ──
const r2 = await pull(hub, {})
check('重复拉取幂等（无新内容 ok=true）', r2.ok === true)

// ── T3：push 同现场（老大「上传也有问题」复现）──
// 条件：本地脏改动 + 本地新提交 + 远端也有新提交（diverged）。
// 旧版 park（stash）后 pull --rebase，任一环节失败整单崩；现在必须全绿。
mk(path.join(other, 'memory', 'machines', 'home.md'), '# 家机\n远端又动过一次\n')
await sh('git', ['add', '-A'], other)
await sh('git', ['commit', '-m', 'home push 2'], other)
await sh('git', ['push', 'origin', 'HEAD:refs/heads/main'], other)
// 本地：改记忆（要推的）+ 写会话（不该动的脏改动）
mk(path.join(hub, 'memory', 'shared.md'), '# 共享记忆\n新内容来自家机\n店机加了一句\n')
mk(path.join(hub, 'session-backup', 'shop', 'new-live.txt'), '对话进行中\n')
const pr = await push(hub, { scopes: ['memory'], message: 'shop 上传' })
console.log('  push 返回：', JSON.stringify({ ok: pr.ok, stage: pr.stage, commit: pr.commit, fileCount: pr.fileCount }).slice(0, 200))
check('T3 脏+diverged 下推送成功', pr.ok === true, pr.error)
// v2.3.2：旧版 rebase 后 HEAD@{1} 语义错 → 明明推了 shared.md 回执却说 0 个文件
check('T3 回执如实报 1 个文件（不再谎报 0）', pr.fileCount === 1 && (pr.files ?? []).includes('memory/shared.md'), `fileCount=${pr.fileCount} files=${(pr.files ?? []).join(', ')}`)
await sh('git', ['pull', '--rebase'], other)
check('T3 other 看到店机加的句子', fs.readFileSync(path.join(other, 'memory', 'shared.md'), 'utf8').includes('店机加了一句'))
check('T3 本地脏文件仍在（park/pop 或 autostash 还原）', fs.existsSync(dirtyFile) && fs.readFileSync(dirtyFile, 'utf8') === dirtyBefore)
check('T3 会话新文件也在（未被范围提交吞掉）', fs.existsSync(path.join(hub, 'session-backup', 'shop', 'new-live.txt')))

console.log('')
console.log('── 清理')
fs.rmSync(root, { recursive: true, force: true })
check('临时目录已删', !fs.existsSync(root))

console.log('')
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
