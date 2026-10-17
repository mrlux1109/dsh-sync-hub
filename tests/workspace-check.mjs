/**
 * tests/workspace-check.mjs —— S3/S4 实测：缺失工作区检测 + 空目录创建。
 * 含反向验证（G2/G3 必须拒绝危险路径）。
 */
import { normalizeWorkspacePath, createWorkspaceDirs, findMissingWorkspaces, describeMissing } from '../lib/hub/workspace.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}

console.log('── G2/G3 路径校验（危险路径必须被拒）')
check('正常绝对路径放行', normalizeWorkspacePath('D:\\【AI智能】\\工作空间\\DSH').ok)
check('相对路径被拒', !normalizeWorkspacePath('工作空间\\DSH').ok)
check('含 .. 被拒', !normalizeWorkspacePath('D:\\a\\..\\..\\Windows').ok)
check('C:\\Windows 被拒', !normalizeWorkspacePath('C:\\Windows\\Temp2').ok, JSON.stringify(normalizeWorkspacePath('C:\\Windows\\Temp2')))
check('Program Files 被拒', !normalizeWorkspacePath('C:\\Program Files\\x').ok)
check('空路径被拒', !normalizeWorkspacePath('').ok)

console.log('')
console.log('── S4 创建空目录（真建、用完即删）')
const root = path.join(os.tmpdir(), `ws-probe-${Date.now()}`)
const a = path.join(root, '项目A')
const b = path.join(root, '项目B')
const r1 = createWorkspaceDirs([a, b])
check('两个目录都建成', r1.created.length === 2, JSON.stringify(r1))
check('目录确实存在', fs.existsSync(a) && fs.existsSync(b))
check('建出来是空目录', fs.readdirSync(a).length === 0)
const r2 = createWorkspaceDirs([a])
check('重复创建幂等（已存在不报错）', r2.existed.length === 1 && r2.created.length === 0)
const r3 = createWorkspaceDirs(['相对路径', a])
check('部分失败不阻断其余', r3.failed.length === 1 && r3.existed.length === 1)

console.log('')
console.log('── S3 缺失检测（模拟中枢备份清单）')
const fakeBackups = {
  machines: [
    { machine: 'home', workspaces: [
      { folder: '--D-~3010AI~667A~80FD~3011-DSH--', path: 'D:\\【AI智能】\\工作空间\\DSH', files: 12 },
      { folder: '--D-~3010AI~667A~80FD~3011-x--', path: 'D:\\【AI智能】\\工作空间\\不存在', files: 5 },
    ] },
    { machine: 'home', workspaces: [{ folder: '--dup--', path: 'D:\\【AI智能】\\工作空间\\不存在', files: 3 }] },
    { machine: 'shop', workspaces: [{ folder: '--s--', path: a, files: 2 }] },
  ],
}
const det = findMissingWorkspaces('D:\\nope', fakeBackups, 'shop')
check(`检出 1 个缺失（去重后）`, det.missing.length === 1, JSON.stringify(det.missing))
check('缺失项文件数已累加 5+3=8', det.missing[0]?.files === 8, String(det.missing[0]?.files))
check('已存在的目录不算缺失', !det.missing.some((m) => m.path === a))
// 本机 shop 的 1 个工作区被排除，只数对方 home 的 3 个（两个 folder + 一个重复）
check('本机备份被排除，只检查对方的 3 个', det.checked === 3, `checked=${det.checked}`)
check('本机存在目录计入 exists', det.exists === 1, `exists=${det.exists}`)

// 本机没有任何备份时，全部对方工作区都要检查
const detAll = findMissingWorkspaces('D:\\nope', fakeBackups, null)
check('不传本机 id 时检查全部 4 个', detAll.checked === 4, `checked=${detAll.checked}`)

const desc = describeMissing(det.missing)
check('回执含建议创建说明', desc.includes('空目录') && desc.includes('飞牛'))

console.log('')
console.log('── 清理')
fs.rmSync(root, { recursive: true, force: true })
check('临时目录已删', !fs.existsSync(root))

console.log('')
console.log(fail === 0 ? `✓ 全部通过（${pass} 项）` : `✗ ${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
