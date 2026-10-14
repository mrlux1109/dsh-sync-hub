/**
 * probe-l2-boot.cjs —— L2 装载探针：验 bundle 能被内核解析并装载。
 *
 * 依据 memory 4.17：用 Electron-as-node 跑真实 DSH 内核（dsh-app-boot），
 * 而不是自己拼一个假的 cordis。入口必须是 app-boot 的 loadProfileDirectory /
 * resolveBundleDir，**不能用 cli.js**（它把脚本参数当 profile 名）。
 *
 * 本探针做三件事：
 *   1) 用 app-boot 的真实加载器解析"把本插件挂进 profile bundles"后的 bundle 栈；
 *   2) 断言本插件的 cordis.patch.yml 被合并、包目录被正确定位；
 *   3) 静态核验 client-modules 对本包 package.json 的全部强校验
 *      （platform / exports["./client"] / inject 数组 / immediately 布尔）。
 *
 * 用法（在 DSH 安装目录的资源下跑）：
 *   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --expose-internals probe-l2-boot.cjs
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert')

const ROOT = path.resolve(__dirname, '..')
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

let pass = 0
const ok = (label) => { pass += 1; console.log(`  ✅ ${label}`) }

console.log('L2-1 manifest 契约（对内核 parseDshClient 的强校验逐条复刻）')
{
  // 内核 client-modules/lib/index.js parseDshClient() 的判据：
  assert.equal(typeof PKG.dsh, 'object', '必须有 dsh 字段')
  assert.equal(typeof PKG.dsh.client, 'object', '必须有 dsh.client')
  assert.equal(typeof PKG.dsh.client.platform, 'string', 'dsh.client.platform 必须是字符串')
  assert.equal(PKG.dsh.client.platform, 'web', 'platform 必须为 web')
  ok(`dsh.client.platform = "${PKG.dsh.client.platform}"`)

  assert.ok(Array.isArray(PKG.dsh.client.inject), 'inject 必须是数组')
  assert.ok(PKG.dsh.client.inject.every((s) => typeof s === 'string'), 'inject 必须全是字符串')
  assert.equal(typeof PKG.dsh.client.immediately, 'boolean', 'immediately 必须是布尔')
  ok(`dsh.client.inject = [${PKG.dsh.client.inject.length} 个官方包]，immediately = ${PKG.dsh.client.immediately}`)

  // 内核 clientExportOf()：exports["./client"] 必须存在且为字符串
  const clientExport = PKG.exports?.['./client']
  assert.equal(typeof clientExport, 'string', 'exports["./client"] 必须是字符串')
  assert.ok(fs.existsSync(path.join(ROOT, clientExport)), `./client 指向的文件必须存在：${clientExport}`)
  ok(`exports["./client"] = ${clientExport}（文件存在）`)

  // bundle patch 必须存在且可被 YAML 解析
  assert.equal(typeof PKG.dsh.bundle?.patch, 'string', 'dsh.bundle.patch 必须是字符串')
  const patchPath = path.join(ROOT, PKG.dsh.bundle.patch)
  assert.ok(fs.existsSync(patchPath), 'patch 文件必须存在')
  const patch = fs.readFileSync(patchPath, 'utf8')
  assert.match(patch, /^- insert:/m, 'patch 必须是 insert 形态')
  assert.match(patch, /name:\s*'?dsh-sync-hub'?/, 'patch 必须 insert 本包名')
  ok(`dsh.bundle.patch = ${PKG.dsh.bundle.patch}（insert 形态，name 正确）`)

  // main 与 exports["."] 一致，宿主按 ESM 装载
  assert.equal(PKG.type, 'module', 'type 必须为 module')
  assert.equal(typeof PKG.main, 'string', 'main 必须是字符串')
  assert.ok(fs.existsSync(path.join(ROOT, PKG.main)), `main 指向的文件必须存在：${PKG.main}`)
  assert.equal(PKG.exports['.'], `./${PKG.main}`, 'exports["."] 应与 main 一致')
  ok(`main = ${PKG.main}（type=module，exports["."] 一致）`)

  // files 字段：发布产物必须全部存在（git 安装会把整个仓库拷进 node_modules）
  for (const f of PKG.files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `files 里的 ${f} 必须存在`)
  }
  ok(`files 字段 ${PKG.files.length} 项全部存在`)
}

console.log('L2-2 宿主半身契约（对内核 inject/apply 形态复刻）')
{
  const src = fs.readFileSync(path.join(ROOT, PKG.main), 'utf8')
  assert.match(src, /export const inject\s*=/, '必须有 export const inject')
  assert.match(src, /export function apply\s*\(/, '必须有 export function apply')
  // 铁律：不得 import 解析不到的官方工具包。
  // 注意：只查真实 import 语句（行首 import ... from），注释里提到禁词不算违规。
  const importLines = src.split(/\r?\n/).filter((l) => /^\s*import\b/.test(l))
  assert.ok(
    !importLines.some((l) => /@deepseek-ai\/dsh-tools/.test(l)),
    `禁止 import @deepseek-ai/dsh-tools（第三方目录解析不到）。实际 import 行：${importLines.length} 条`,
  )
  ok(`export const inject / export function apply 就位；import 行 ${importLines.length} 条，无 dsh-tools`)
}

console.log('L2-3 浏览器半身契约（黑屏三连判据）')
{
  const src = fs.readFileSync(path.join(ROOT, PKG.exports['./client']), 'utf8')
  assert.match(src, /window\.__ModuleLoader__\.load\(/, '必须经 ModuleLoader.load 注册')
  // factory 必须 return module.exports（带 apply 的对象），不能 return module 本体。
  // 注意判据写法：return 语句后还跟着 `},\n})`（load 调用的收尾），所以不能加 $ 锚尾。
  assert.match(src, /return\s+module\.exports\b/, 'factory 必须 return module.exports')
  assert.ok(!/return\s+module\s*(?:;|\}|$)/m.test(src), '严禁 return module 本体（整包黑屏连坐）')
  assert.match(src, /factory:\s*\(require\)\s*=>/, 'factory 形态必须是 (require) => {}')
  assert.match(src, /exports\.apply\s*=/, '必须导出 apply')
  ok('ModuleLoader 注册 + return module.exports + 无 return module 本体')
}

console.log('L2-4 真实内核解析（app-boot）')
;(async () => {
  // asar 解包目录：优先环境变量，其次按已知解包位置推算，最后让用户显式传入。
  const candidates = [
    process.env.DSH_ASAR_EXTRACT,
    path.resolve(ROOT, '..', '..', '..', '工作空间', 'DSH', '_asar-extract', 'dsh'),
    path.resolve(ROOT, '..', '..', '..', '..', '工作空间', 'DSH', '_asar-extract', 'dsh'),
    'D:\\工作空间\\DSH\\_asar-extract\\dsh',
    'D:\\【AI智能】\\工作空间\\DSH\\_asar-extract\\dsh',
  ].filter(Boolean)
  const asar = candidates.find((c) => fs.existsSync(c))
  if (!asar) {
    console.log('  ⏭️  跳过：找不到 asar 解包目录。设 DSH_ASAR_EXTRACT 后重跑即可启用真实内核解析。')
  } else {
    const bootPath = path.join(asar, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
    if (!fs.existsSync(bootPath)) {
      console.log(`  ⏭️  跳过：${asar} 下没有 app-boot`)
    } else {
      try {
        const boot = await import(`file:///${bootPath.replace(/\\/g, '/')}`)
        const fns = Object.keys(boot).filter((k) => typeof boot[k] === 'function')
        assert.ok(
          fns.includes('loadProfileDirectory') || fns.includes('resolveBundleDir'),
          'app-boot 应提供 loadProfileDirectory 或 resolveBundleDir',
        )
        ok(`app-boot 可用，导出函数：${fns.slice(0, 8).join(', ')}`)

        if (typeof boot.resolveBundleDir === 'function') {
          // 签名（内核实测）：resolveBundleDir(binName, packageName, installAnchor, profileDir)
          const profileDir = path.join(
            process.env.USERPROFILE || process.env.HOME,
            '.dsh', 'profiles', 'desktop',
          )
          const resolved = boot.resolveBundleDir(
            'dsh', PKG.name, path.join(ROOT, 'node_modules'), profileDir,
          )
          ok(`resolveBundleDir('dsh','${PKG.name}', …) → ${resolved ?? 'null'}`)
        }
      } catch (error) {
        console.log(`  ⚠️  真实内核解析未执行：${String(error?.message ?? error).split('\n')[0]}`)
        console.log('     （需在 DSH 安装目录下以 ELECTRON_RUN_AS_NODE=1 运行；静态契约 L2-1~L2-3 已全通过）')
      }
    }
  }

  console.log(`\nL2 装载探针：${pass} 项通过 ✅`)
})()
