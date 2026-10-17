/**
 * tests/fileman-check.mjs —— 内容页文件管理守卫实测（v2.5 批2）。
 * 临时中枢真操作；反向验证必须占大头（这是唯一能删东西的 API）。
 */
import { resolveSafe, listDir, readText, saveText, deleteEntry, FILE_ROOTS } from '../lib/hub/fileman.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}

const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'fileman-'))
fs.mkdirSync(path.join(hub, 'memory', 'machines'), { recursive: true })
fs.mkdirSync(path.join(hub, 'skills', 'good-skill'), { recursive: true })
fs.writeFileSync(path.join(hub, 'memory', 'shared.md'), '# 记忆\nv1\n', 'utf8')
fs.writeFileSync(path.join(hub, 'memory', 'machines', 'home.md'), '# home\n', 'utf8')
fs.writeFileSync(path.join(hub, 'skills', 'good-skill', 'SKILL.md'), '---\nname: good-skill\ndescription: x\n---\n', 'utf8')
fs.writeFileSync(path.join(hub, 'memory', 'big.bin'), Buffer.alloc(600 * 1024, 1), 'utf8')

console.log('── F1 根白名单')
check('6 个根注册齐', Object.keys(FILE_ROOTS).length === 6, Object.keys(FILE_ROOTS).join(','))
check('未知根被拒', !resolveSafe(hub, 'hub/../../etc', 'passwd').ok)
check('hub/wiki 不在白名单被拒', !resolveSafe(hub, 'hub/wiki', 'x.md').ok)

console.log('')
console.log('── F2 路径消毒')
check('.. 逃逸被拒', !resolveSafe(hub, 'hub/memory', '../config').ok)
check('绝对路径被拒', !resolveSafe(hub, 'hub/memory', 'C:\\Windows\\x.md').ok)
check('UNC 被拒', !resolveSafe(hub, 'hub/memory', '\\\\srv\\share\\x').ok)
check('正常相对路径放行', resolveSafe(hub, 'hub/memory', 'shared.md').ok === true)
check('嵌套相对路径放行', resolveSafe(hub, 'hub/memory', 'machines/home.md').ok === true)

console.log('')
console.log('── F3 凭据硬墙')
check('.credentials.yaml 被拒', !resolveSafe(hub, 'hub/memory', '.credentials.yaml').ok)
check('.anonymous-user-id 被拒', !resolveSafe(hub, 'hub/memory', 'sub/.anonymous-user-id').ok)

console.log('')
console.log('── 列表 / 读 / 写')
const ls = listDir(hub, 'hub/memory', '')
check('列表成功（machines/big.bin/shared.md 共 3 项）', ls.ok && ls.entries.length === 3, JSON.stringify(ls.entries ?? ls))
check('目录排前', ls.entries[0].name === 'machines' && ls.entries[0].dir === true)
const rd = readText(hub, 'hub/memory', 'shared.md')
check('读文本成功', rd.ok && rd.text.includes('# 记忆'))
check('二进制扩展名拒读', !readText(hub, 'hub/memory', 'big.bin').ok)
const wr = saveText(hub, 'hub/memory', 'shared.md', '# 记忆\nv2 改过了\n')
check('写成功且留底', wr.ok === true && !!wr.backup && fs.existsSync(wr.backup), JSON.stringify(wr))
check('新内容落盘', fs.readFileSync(path.join(hub, 'memory', 'shared.md'), 'utf8').includes('v2'))
check('留底里是旧内容', wr.backup && fs.readFileSync(wr.backup, 'utf8').includes('v1'))
check('新建子目录文件可行', saveText(hub, 'hub/memory', 'machines/new.md', '# new\n').ok === true)

console.log('')
console.log('── F4 删除 = 移进 backups 留底（可逆）')
const del = deleteEntry(hub, 'hub/skills', 'good-skill')
check('删除成功', del.ok === true, JSON.stringify(del))
check('原位置没了', !fs.existsSync(path.join(hub, 'skills', 'good-skill')))
check('backups 里完整还在', del.backup && fs.existsSync(path.join(del.backup, 'SKILL.md')), del.backup)
check('删除不存在的报错', deleteEntry(hub, 'hub/skills', 'no-such').ok === false)
check('删凭据被硬墙拒', deleteEntry(hub, 'hub/memory', '.credentials.yaml').ok === false)

console.log('')
console.log('── 清理')
fs.rmSync(hub, { recursive: true, force: true })
check('临时中枢已删', !fs.existsSync(hub))

console.log('')
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
