# 云端 MCP

D1 版支持通过 HTTP 连接 MCP，提供立即发送、一次性定时提醒、查看和取消任务。定时任务运行在 Cloudflare，电脑关机或客户端断开后仍可执行。

## 连接

客户端选择 Streamable HTTP，填写以下一种地址：

```text
https://你的域名/mcp/设备Key
https://你的域名/mcp
```

第一种固定设备；第二种需要在每次工具调用中填写 `device_key`。如果设置了 `ROOT_PATH`，地址前还需加上对应路径；设置了 `BASIC_AUTH` 时需提供相应 Basic 请求头。

GET 提供持续的 SSE 连接，每 25 秒发送一次注释心跳；心跳不会创建新 HTTP 请求、查询任务或发送 Bark 通知。实际工具调用使用 POST，提醒仍由 Durable Object Alarm 触发。

## 工具

| 工具 | 用途 | 主要参数 |
| --- | --- | --- |
| `notify` | 立即发送或创建提醒 | 消息内容、`user_requested: true`、可选 `send_at` |
| `list_scheduled_notifications` | 查看当前设备 Key 的任务 | 可选 `include_completed`、`limit`、`offset` |
| `cancel_scheduled_notification` | 取消待发送任务 | `task_id`、`user_requested: true` |

发送、安排和取消提醒必须由用户明确要求。新版 `notify` 要求 `user_requested: true`；旧客户端升级后应重新加载工具定义。

```json
{
  "user_requested": true,
  "title": "喝水提醒",
  "body": "休息一下，喝点水。",
  "send_at": "2027-01-01T15:30:00+08:00"
}
```

- 不传 `send_at` 或设为 `null`：立即发送。
- 传带日期、时区的未来 ISO 时间：创建提醒并立即返回 `task_id`。相对时间由 Agent 换算；返回时间采用 UTC。
- 消息至少包含 `title`、`subtitle`、`body`、`markdown` 中的一项。分组、链接、铃声等参数保留在工具定义中；`ttl` 没有默认值，控制历史保存时长，与定时发送无关。
- 查看工具默认显示 `pending`／`sending`；`include_completed: true` 同时显示历史。每页默认 50 条，`limit` 最大 100，`offset` 用于翻页。
- 只能取消 `pending` 任务，重复取消安全；已经发送的通知不能撤回。工具返回的任务 ID 与 Bark 通知 ID 不是同一种标识。

## 任务执行

每个设备 Key 使用独立的 SQLite Durable Object 保存任务，由 Alarm 到点唤醒。最多同时保存 500 条活动任务；完成记录在后续访问时清理 30 天前的数据。

`pending` 表示已保存，`sending` 表示正在尝试发送，`accepted` 表示 Bark 接受请求，不保证手机已显示。其他状态为 `rejected`、`unknown`、`cancelled`、`expired`。

Cloudflare 故障或维护可能造成延迟，不承诺严格准点。晚到不超过 30 分钟的待处理任务可补发，超过则过期。Alarm 重复触发不会重新发送已领取任务；发送中断或结果不确定时记录 `unknown`，不自动重试，请先查看手机。

## 部署与验证

更新现有服务时，沿用原 Worker 名称、D1 数据库绑定、域名和变量。`wrangler.jsonc` 新增了 `REMINDERS` 绑定和 `v1-reminders` SQLite Durable Object migration，部署时一并创建，不需要 Windows 定时任务或额外服务器。保留 migration 记录，后续更新不要改名或删除。

部署前，在 Worker 的 Variables and Secrets 中配置 `APNS_PRIVATE_KEY`、`APNS_TEAM_ID`、`APNS_KEY_ID` 三个 Secrets。它们是 APNs 服务端推送凭据，与 Bark 设备 Key 不同；升级时使用原服务对应的值。本版 D1/KV 源码均改为读取 Secrets，缺少配置时无法生成新的 APNs 认证令牌。本地开发可复制 `.dev.vars.example` 为 `.dev.vars` 后填写。

```sh
npm ci
npm test
npm run build:check
npm run deploy
```

`npm test` 使用本机模拟 D1、Durable Objects 和 APNs，不发送真实通知。`build:check` 仅打包检查。`deploy` 会执行原有 D1 migration 流程并更新线上服务；已配置 Workers Builds 时，推送部署分支可自动部署。部署完成后重载客户端 MCP。

SQLite Durable Objects 支持 Workers 免费计划，使用量受其额度限制。KV 版不包含这些 MCP 功能。
