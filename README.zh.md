# Bark-Worker

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

[English](README.md) | 中文文档

部署在 Cloudflare Workers 上的 [Bark](https://github.com/Finb/Bark) 推送服务端。通过 HTTP API 或云端 MCP 向 iPhone 发送通知；云端 MCP 还支持一次性定时提醒、任务查询和取消。任务保存到云端后，电脑关机或 Agent 退出仍可执行，无需额外购买服务器。

本仓库基于 [cwxiaos/bark-worker](https://github.com/cwxiaos/bark-worker) 扩展，保留原有 Bark API 和云端 MCP，新增定时提醒与任务管理。感谢原作者及 [Bark-Server](https://github.com/Finb/bark-server) 项目，沿用 [GPL-3.0 许可证](LICENSE)。

## 架构

当前部署方案使用 **D1 + SQLite Durable Objects** 两套存储，它们各自独立：

| Cloudflare 组件 | 用途 |
| --- | --- |
| Workers | 提供 Bark HTTP API 和 MCP 接口，执行通知发送 |
| D1 | 保存设备注册信息、APNs 授权缓存和 MCP 会话 |
| Durable Objects（自带 SQLite） | 保存定时任务，通过 Alarm 到点触发发送 |

定时任务不保存在 D1 中，也不依赖本地定时器。Durable Objects 的 SQLite 数据在其自身的存储中查看，不会出现在 D1 的表列表里。

## 部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/super3378/bark-worker)

1. 点击按钮，按 Cloudflare 提示连接 GitHub 并部署此仓库。D1 和 Durable Objects 会根据仓库配置自动创建并绑定，无需另行手工建库。
2. 全新部署当前版本时，按页面提示提供 `APNS_PRIVATE_KEY`、`APNS_TEAM_ID`、`APNS_KEY_ID` 三项 Secrets；也可部署后在 Worker 的 Variables and Secrets 中补齐。已有服务配置过这三项时无需重复填写。它们是与 Bark 客户端匹配的 APNs 服务端凭据，不是设备 Key，也不会由 Cloudflare 自动生成。
3. 部署及必要配置完成后，在 iPhone 的 Bark App 中添加服务根地址，例如 `https://YOUR_HOST`，完成设备注册并获取设备 Key。

如果当前网络无法访问 `workers.dev`，可绑定自己的域名。服务地址需要能同时被手机和 Agent 访问。

手动部署、数据库配置及已有服务升级步骤见 [部署指南](doc/setup_guide.zh.md)。请部署完整仓库，不能只复制 `main.js`。

## 接入本地 Agent

将下面的 `YOUR_HOST` 和 `YOUR_DEVICE_KEY` 替换为服务域名和 Bark 设备 Key，再把整段提示词发给 Agent，让它按当前客户端的配置方式完成接入：

```text
请帮我在当前 Agent 客户端中添加以下云端 Bark MCP 服务：
服务名称：bark-cloud
连接方式：Streamable HTTP
服务地址：https://YOUR_HOST/mcp/YOUR_DEVICE_KEY

请按当前客户端支持的方式配置。如果需要重新加载或重启客户端，请告诉我具体步骤。
接入后查询定时提醒来验证连接；只有我明确要求时，才能发送、安排或取消通知。
```

客户端需支持远程 MCP，Agent 需有相应配置权限。本地无需运行 Node.js MCP 程序。自定义路径和 Basic 认证见 [MCP 连接说明](doc/mcp.zh.md#连接)。

## 工具与用法

| 工具 | 用途 |
| --- | --- |
| `notify` | 立即发送通知，或指定未来时间创建提醒 |
| `list_scheduled_notifications` | 查看当前设备的定时任务 |
| `cancel_scheduled_notification` | 取消尚未开始发送的提醒 |

直接用自然语言向 Agent 提出请求，例如：

- “给我发一条测试通知。”
- “半小时后提醒我喝水。”
- “明天早上八点半提醒我起床。”
- “查看我当前的定时提醒。”
- “取消刚才的喝水提醒。”

参数、任务状态和执行规则见 [MCP 使用说明](doc/mcp.zh.md)。HTTP 推送继续支持 `register`、`ping`、`healthz`、`info`、`push` 等原有接口，其他用法见 [使用技巧](doc/tips.zh.md)。

## 使用说明与排查

- 当前支持一次性提醒，暂不支持周期重复；发送和取消必须由用户明确要求。
- `send_at` 不填或为 `null` 时立即发送；相对时间由 Agent 换算为带时区的具体时间。`ttl` 控制通知归档保存时长，不是发送延迟，也没有默认值。
- 定时任务以云端返回创建成功和任务编号为准，可再查询确认。服务接受推送不代表手机已确认收到，定时触发也可能存在延迟。
- 连接失败时，检查域名、设备 Key、客户端对 Streamable HTTP 的支持，以及代理和认证配置。浏览器能打开服务主页，并不能单独证明 MCP 握手成功。
