# dsh-sync-hub

跨机记忆同步中枢（sync-hub）的 DSH 插件——**装一个插件，两台电脑的全部同步工作都在 DSH 里完成，不必再用 bat**。

两条腿：
1. **模型工具**（对话里用）：`sync_hub_*` 5 个，见下表。
2. **设置页卡片**（点鼠标）：设置 → 「同步中枢」，覆盖菜单的绝大部分功能
   （日常同步 / 备份与会话 / 环境维护 / 插件与技能 / **AI 工具链体检+一键装** /
   Gitee 凭据 / **新机自助接入**）。

## 工具清单

| 工具 | 对应菜单 | 副作用 | 说明 |
|---|---|---|---|
| `sync_hub_status` | [6] | 无（只读） | 本机/中枢/Gitee 差异；push 前必跑 |
| `sync_hub_push` | [1]/[2] | 推送到 Gitee | 参数 `scope`（all/memory/skills/config/sessions）、`message` |
| `sync_hub_pull` | [3] | 拉取+应用到本机 | 退出码 2=冲突→停下报告，禁止自动解决 |
| `sync_hub_version` | [V] | 无（只读） | VERSION / 最新提交 / 工作区状态 / 技能数 |
| `sync_hub_open_console` | 双击 bat | 开窗口 | 换身份/一条龙/冲突处理等人工入口 |

**安全边界**：不包 `apply.ps1` 的换身份（要手输 YES）、不包 [13] 一条龙、不做冲突解决；
这些仍需人工，卡片只提供「打开控制台」按钮。

## 新机器怎么装（三步，之后全在 DSH 里）

```powershell
# 1) 装 git（没有的话），然后一条命令：
powershell -ExecutionPolicy Bypass -File install-plugin.ps1 -CloneTo D:\AI\sync-hub -Machine home
#    没有现成脚本时，先用 -User/-Token 让向导顺手存凭据：
powershell -ExecutionPolicy Bypass -File install-plugin.ps1 -CloneTo D:\AI\sync-hub -Machine home -User <gitee名> -Token <私人令牌>
# 2) 重启 DSH
# 3) 设置 → 同步中枢：以后上传/拉取/装工具/备份都在这里点
```

`install-plugin.ps1` 做四件事：确保 Gitee 凭据 → clone 中枢 → `apply.ps1`（记忆/技能/配置）
→ 把本插件装进每个 profile（物理拷贝 + 依赖 + bundles，改前备份 package.json）。
**已在中枢里的机器**：拉取后 `plugins\dsh-sync-hub\README.md` 同款步骤，或直接跑上面的命令（幂等）。

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

## 设置页卡片（v0.2.0 浏览器半身，已实证）

- **入口**：DSH 设置 → 「同步中枢」分区（settings.section id `sync-hub`，order 36）。
- **内容**：版本/最新提交/技能数/工作区状态 + 按钮：刷新、查看差异、上传备份、拉取并应用、打开控制台。
- **通道**：卡片走宿主半身同源 API `/api/sync-hub/{info,status,push,pull,console}`；
  带 same-origin 围栏（Origin/referer 主机不等于请求主机 → 403），局域网裸调会被拒。
- **探针实证（2026-10-13）**：mock ctx 注入捕获 → 起真 HTTP 分发 → GET /info 200 真数据、
  无 Origin 403、POST /console 开窗口成功；5/5 模型工具同场注册正常。
- **约束不变**：push/pull 之外（换身份/一条龙/冲突处理）仍只能在打开的控制台窗口里人工操作。

## 验证

重启后新会话里应能看到 5 个 `sync_hub_*` 工具；先问「中枢什么版本」跑 `sync_hub_version`。
