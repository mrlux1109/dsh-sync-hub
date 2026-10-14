# dsh-sync-hub

DSH **同步中枢**插件：侧栏入口 + 六页信息面板，两台电脑的 AI 记忆 / 技能 / 配置同步。

> v2.0 是标准 DSH 客户端插件的彻底重写版（旧版是 bat 演化出的"设置页 8 Tab 应用"）。
> 开发文档：`D:\[AI智能]\工作空间\DSH\DSH同步中枢插件-标准重构开发文档.md`（唯一真相源）。

## 两条轨道（互不干扰）

| 轨道 | 仓库 | 内容 |
|---|---|---|
| **代码** | `github.com/mrlux1109/dsh-sync-hub`（public） | 本插件源码 |
| **数据** | `gitee.com/mrlux/ai-sync-hub`（private） | 记忆 / 技能 / 配置 / 会话备份 / 插件清单 |

public 仓库**不含任何 token**；Gitee 令牌只存 Windows 凭据管理器。

## 安装（官方通道）

设置 → 插件 → **添加插件** → 贴仓库地址：

```
https://github.com/mrlux1109/dsh-sync-hub
```

安装源按网络情况选（大陆选「中国大陆镜像源」）。

> ⚠️ **安装 / 更新前请完全退出 DSH**，否则 pnpm 被锁、安装会失败。
> ⚠️ 官方弹窗明示"暂不支持自动更新"：升级 = 先卸载旧版，再贴地址装新版。
>    每次发版都会 bump `version` 并打 tag，卸载重装后版本号变化即可确认生效。

## 装好后长什么样

- **左侧栏**多一个「同步中枢」图标（与「插件」「任务管理」同级），点击后**中间整列**是同步中枢面板。
- 面板顶部一条**全局状态条**：机器身份 · 待推送 N · 待拉取 M · 凭据状态 · 定时任务 · 健康分。
- 六个一级页：**总览 / 同步 / 技能 / 记忆·配置 / 会话 / 维护**（按内容域分，每域内"本机 ↔ 云端"双列）。
- 动作反馈一律**就地**显示在按钮旁，不滚页、不倾倒终端文本。
- 拉取撞车有**三方冲突解决器**（base / 本机 / 云端 三栏，选边或合并，自动 git 收尾），不必再手工跑 `git add && git rebase --continue`。
- 「打开控制台」按钮仍在——换机器身份（要手输 YES）、全自动一条龙、冲突人工处理这类**必须人工确认**的流程保留 `.bat` 窗口作安全网。

## 与旧版（v0.11.0 设置页卡片）的关系

- v2.0 上线后**双入口过渡一个版本**：旧设置卡片降级为一张只读跳转卡（"请用侧栏同步中枢"），
  不再承载任何动作；v2.1 起删除。**旧版 8 Tab 代码整段删除**，不做遮蔽保留。

## 开发者说明

### 结构

```
dsh-sync-hub/
├─ package.json          # manifest：dsh.client.inject 声明四个官方包
├─ cordis.patch.yml      # insert: id=sync-hub, name=dsh-sync-hub
├─ index.js              # 宿主半身：服务提供 + 路径解析（M3 起挂 HTTP 与工具）
├─ client.js             # 浏览器半身：ModuleLoader + 侧栏/main 插槽
├─ lib/
│  ├─ exec.js            # 执行层唯一出口：git 直调 + Node fs，不 spawn powershell
│  ├─ hub-paths.js       # 中枢路径解析（config → env → 候选）
│  └─ hub/
│     └─ status.js       # 状态聚合（带 G1–G5 守卫清单）
└─ tests/
   ├─ probe-m2.cjs       # 装载 + 渲染探针（L2/L3）
   └─ guard-tests.mjs    # 守卫负例单测（L3b）
```

### 标准契约（写代码前必读）

1. `client.js` 的 factory **必须 `return module.exports`**——返回 `module` 本体会让内核判 invalid，**同 bundle 的其他插件连坐黑屏**。
2. `dsh.client.inject` 声明官方包名（不钉版本），才能 `require('@deepseek-ai/dsh-client-ui-primitives')` 等。
3. 侧栏入口 `sidebar.panellist` 的 **id 必须等于** `main` 插槽的 **key**（本插件均为 `sync-hub`）。
4. 文案走 `ctx.locale.bind(NS)` + `register(NS, {zh, en})`，**扁平键**（嵌套键不会解析）。
5. `webServer` 必须用 `ctx.inject(['webServer'], …)` 拿，一次性 `ctx.get()` 会拿到 undefined。
6. 执行层只 spawn `git` 与系统程序（`schtasks` 等），**不 spawn powershell**；参数一律数组、不拼字符串。

### 本地验证

```powershell
node --check client.js          # 语法
node tests/probe-m2.cjs         # 装载 + 注册 + 渲染断言
node tests/guard-tests.mjs      # 守卫负例
node tests/probe-m4-http.cjs    # HTTP 面端到端
node tests/check-unused.mjs     # import 自检
```

### 关于 client.js 单文件 45KB（为什么不拆）

开发文档 §8.8 曾定"单文件 ≤ 40KB"。落地时重新评估后**维持单文件**，依据三条实测：

1. **官方拆分机制依赖 tsdown 构建**：内核 `client-modules` 文档明确"经 tsdown 拆分的源码
   `import()` 会编译为 `require.async("./client.<name>.js")`"。零构建插件（本插件与
   whale-pet 同款）手工拆成 `client.<name>.js` 需自己维护 `require.async` 时序，收益不成比例。
2. **参照物更大**：官方渠道安装的 whale-pet 其 `client.js` 为 **272KB 单文件**；
   本插件 45KB 约为其 1/6。
3. **抖动条件不成立**：memory 4.8 的 Edit 抖动来自"同一文件多处**并行** Edit"。
   本插件的修改一律是**单次全量 write**（重写而非增量补丁），不触发该条件；
   每次改动后跑 probe-m2 + guard-tests 回归兜底。

后续若 client.js 超过 ~120KB 或需多人并行编辑，再引入 tsdown 拆分。

### 卸载

从 `dsh.profile.bundles` 删 `dsh-sync-hub` 一行、删 `node_modules/dsh-sync-hub`、重启 DSH。
旧功能（其他插件、模型工具）不受影响。