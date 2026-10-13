# dsh-sync-hub

跨机记忆同步中枢（sync-hub）的 DSH 插件——把控制台里**非交互、安全**的那部分
暴露成 5 个模型工具；交互类操作仍走 `同步中枢.bat` 菜单。

## 工具清单

| 工具 | 对应菜单 | 副作用 | 说明 |
|---|---|---|---|
| `sync_hub_status` | [6] | 无（只读） | 本机/中枢/Gitee 差异；push 前必跑 |
| `sync_hub_push` | [1]/[2] | 推送到 Gitee | 参数 `scope`（all/memory/skills/config/sessions）、`message` |
| `sync_hub_pull` | [3] | 拉取+应用到本机 | 退出码 2=冲突→停下报告，禁止自动解决 |
| `sync_hub_version` | [V] | 无（只读） | VERSION / 最新提交 / 工作区状态 / 技能数 |
| `sync_hub_open_console` | 双击 bat | 开窗口 | apply 换身份、一条龙、会话恢复等人操作入口 |

**安全边界**：不包 `apply.ps1`（身份守卫要手输 YES）、不包 [13] 一条龙、不做冲突解决。
这些必须人来，工具只负责打开控制台窗口。

## 注册方式（宿主实证 2026-10-13）

- `package.json` → `dsh.bundle.patch: ./cordis.patch.yml`
- `cordis.patch.yml` → `insert: id=sync-hub`
- `index.js` → `export const inject = ['tools']` + `export function apply(ctx, config)`
- **零外部依赖裸注册**：直接 `ctx.tools.register(裸对象)`（与 MCP 桥接 `createMcpToolDefinition` 同款），
  `parameters`/`output.schema` 用**标准 JSON Schema**（`required` 是数组）。
  ⚠️ 实测：第三方插件目录 `import('@deepseek-ai/dsh-tools')` 报 ERR_MODULE_NOT_FOUND
  （宿主只给 dsh-llm/credentials/cordis/schemastery 供解析通道），所以**不要用 defineTool**。
- 校验底线：`register()` 只强制 `output.render` 是函数 + `output.schema` 过
  `assertSupportedJsonSchema`（子集：type/oneOf/properties/required/additionalProperties/items/enum/const + 注解）。

## 已验证（Electron-as-node 探针，家机实测）

- `loadProfileDirectory`：18 层含 dsh-sync-hub，skipped 为空，bundle 目录解析正确
- `apply(mockCtx)`：5 个 `sync_hub_*` 全部注册成功；5/5 schema 过宿主真校验器
- `sync_hub_version.execute` 实跑返回真实数据；`output.render` 产出 `[{type:'text',...}]`

## 中枢路径解析

按顺序：`config.hubPath` → `env SYNC_HUB_PATH` → 候选
`D:\【AI智能】\sync-hub`（家机）/ `D:\AI\sync-hub`（店机）/ `~/sync-hub`。
判定标准：目录里同时有 `VERSION` 和 `tools/status.ps1`。

## 本机安装（两台机器各做一次）

```powershell
# 1) 源码已在中枢 plugins/dsh-sync-hub（随 git 同步）
# 2) 实体拷贝到 profile
$prof = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item -Recurse '<中枢>\plugins\dsh-sync-hub' "$prof\node_modules\dsh-sync-hub"
# 3) profile package.json 加两项（改前备份）：
#    dependencies."dsh-sync-hub" = "file:C:/Users/<用户>/.dsh/profiles/desktop/node_modules/dsh-sync-hub"
#    dsh.profile.bundles += "dsh-sync-hub"
# 4) 重启 DSH 桌面版生效
```

卸载 = 从 `bundles` 删一行 + 删 `node_modules\dsh-sync-hub` + 重启（原功能全部不受影响）。

## 验证

重启后新会话里应能看到 5 个 `sync_hub_*` 工具；先问「中枢什么版本」跑 `sync_hub_version`。
