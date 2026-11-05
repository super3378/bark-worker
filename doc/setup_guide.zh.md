# 部署指南

[返回 README](../README.zh.md)

当前版本需要完整源码、D1 和 SQLite Durable Objects。`main.js` 会导入其他模块，不能只将单个文件粘贴到 Worker 编辑器中部署。

## 一键部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/super3378/bark-worker)

点击按钮后，按页面提示连接 GitHub 并创建 Worker。Cloudflare 会读取仓库的 `wrangler.jsonc`，自动创建所需的 D1 和 Durable Objects 并完成绑定，不需要先到控制台手工创建数据库。此行为见 [Cloudflare 一键部署说明](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。部署完成后可核对：

| 配置 | 要求 |
| --- | --- |
| Worker 入口 | `main.js`，同时部署仓库内的依赖模块 |
| D1 | 绑定名 `database`，指向自己账户内的数据库 |
| Durable Object | 绑定名 `REMINDERS`，类名 `ReminderScheduler` |
| SQLite migration | 保留 `v1-reminders` 的 `new_sqlite_classes` 声明 |
| APNs Secrets | `APNS_PRIVATE_KEY`、`APNS_TEAM_ID`、`APNS_KEY_ID` |

全新部署当前版本时，需要按部署页面提示提供三项有效 APNs Secrets；如果部署时没有填写，可在 Worker 的 Settings → Variables and Secrets 中补齐。已有服务配置过这三项时，更新代码无需重复填写。

原始导入版本曾将 APNs 凭据写在源码中，因此部署它时不需要手动配置；当前版本已改为从 Secrets 读取。Cloudflare 不会自动生成与 Bark 客户端匹配的 APNs 凭据，`.dev.vars.example` 中也只有名称和占位符，不能直接用作实际凭据。它们与手机设备 Key 不同。

确认部署成功、必要 Secrets 已配置后，继续下方“验证与注册”。

## 手动部署

安装可运行本项目依赖的 Node.js LTS 和 Git，并准备 Cloudflare 账户。以下命令在克隆后的仓库目录内执行。

### 1. 获取源码并登录

```sh
git clone https://github.com/super3378/bark-worker.git
cd bark-worker
npm ci
npx wrangler login
```

### 2. 创建自己的 D1 数据库

首次部署可创建一个新数据库：

```sh
npx wrangler d1 create bark-worker-db
```

将命令返回的数据库名称和 ID 填入 `wrangler.jsonc` 的 `d1_databases`，绑定名保持为 `database`：

```jsonc
// wrangler.jsonc 中的 d1_databases 字段
"d1_databases": [
  {
    "binding": "database",
    "database_name": "bark-worker-db",
    "database_id": "YOUR_D1_DATABASE_ID"
  }
]
```

不要直接沿用仓库里的数据库 ID。已有服务升级时使用原数据库，不要另建数据库覆盖绑定。

Durable Objects 的 `REMINDERS` 绑定和 `v1-reminders` migration 已在同一配置文件中声明，首次部署时由 Wrangler 创建对应资源，不需要再创建第二个 D1 数据库。可参考 [Cloudflare Durable Objects 文档](https://developers.cloudflare.com/durable-objects/get-started/)。

### 3. 配置 APNs Secrets

已有 Worker 配置过三项 Secrets 时可跳过本步。全新部署需提供与 Bark 客户端匹配的有效 APNs 服务端凭据；先确认 `wrangler.jsonc` 中的 Worker `name` 是准备部署的名称，再执行以下交互式命令：

```sh
npx wrangler secret put APNS_PRIVATE_KEY
npx wrangler secret put APNS_TEAM_ID
npx wrangler secret put APNS_KEY_ID
```

`APNS_PRIVATE_KEY` 使用完整 PEM 私钥。也可以在 Cloudflare 控制台的 Worker Variables and Secrets 中设置。若命令要求先创建 Worker，请按提示创建相同名称的 Worker，或先完成一次部署再设置 Secrets。

### 4. 检查并部署

```sh
npm test
npm run build:check
npm run deploy
```

测试使用本机模拟资源和 APNs，不发送真实通知。`build:check` 仅打包检查；`deploy` 会先执行远程 D1 migrations，再部署 Worker、Durable Object 代码和配置。

如果改为使用 Workers Builds 自动部署，构建与部署流程也应执行远程 D1 migrations；本项目的 `npm run deploy` 已包含该步骤。

## 验证与注册

1. 确认部署、D1 migrations 和三个 APNs Secrets 均已完成。
2. 访问 `https://YOUR_HOST/ping` 检查服务是否响应。如果使用了 `ROOT_PATH`，地址需带上对应前缀。
3. 在 iPhone 的 Bark App 中添加服务根地址，注册设备并取得设备 Key。注册时需允许新设备，变量 `ALLOW_NEW_DEVICE` 默认开启。
4. 按 [README 的接入教程](../README.zh.md#接入本地-agent) 配置 MCP，先查询定时任务，再按需发送测试通知。

如启用 `BASIC_AUTH`，推送和 MCP 请求需携带相应 Basic 认证信息。网络无法访问 `workers.dev` 时，可为 Worker 绑定自定义域名。

## 更新已有服务

- 沿用原 Worker 名称、D1 数据库、域名和所需变量，保留现有 Secrets。
- 保留 `REMINDERS` 绑定、`ReminderScheduler` 类名和已经部署的 migration 记录；随意改名或删除会影响已有任务。
- 更新完整仓库后执行部署，再让 MCP 客户端重新加载工具定义。

D1 保存设备信息、APNs 授权缓存和 MCP 会话；定时任务单独保存在 Durable Objects 自带的 SQLite 中，由 Alarm 触发。资源使用量受 Cloudflare 对应计划额度限制。
