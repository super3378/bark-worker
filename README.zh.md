<p align="center">
    <h1 align="center">Bark-Worker</h1>
</p>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**[English](README.md)** | 中文文档

Bark-Worker 是部署在 Cloudflare Workers 上的 [Bark](https://github.com/Finb/Bark) 推送服务端，可通过 HTTP API 或 MCP 向 iPhone 发送通知，无需额外购买服务器。

本仓库基于 [cwxiaos/bark-worker](https://github.com/cwxiaos/bark-worker) 修改，保留原项目的 Bark 推送 API 和云端 MCP，并扩展了一次性定时提醒、任务查询与取消功能。感谢原作者及 [Bark-Server](https://github.com/Finb/bark-server) 项目的贡献，沿用 [GPL-3.0 许可证](LICENSE)。

### 什么是 [Bark](https://github.com/Finb/Bark)?
[Bark](https://github.com/Finb/Bark) 是一个允许向iPhone发送通知的iOS APP.

> [!NOTE]
> 如果worker.dev域名在当前国家/地区不可用，则需要一个自己的域名

## 特性

- 支持所有的Bark-Server API
    - `register`
    - `ping`
    - `healthz`
    - `info`
    - `push`
- 基于路径的参数解析
- 云端 MCP（D1 版）：`notify` 立即发送或安排提醒，`list_scheduled_notifications` 查看任务，`cancel_scheduled_notification` 取消待发送任务
- 定时任务保存在 SQLite Durable Objects 中，由 Alarm 到点触发；创建成功后，电脑关机或 MCP 客户端断开仍可执行
- 便于部署, 低成本且方便管理

MCP 连接方式、工具参数和任务执行规则见 [MCP 使用说明](doc/mcp.zh.md)。目前支持一次性提醒，暂不支持周期重复；发送和取消操作需由用户明确要求。

## 部署

> [!NOTE]
> 使用云端 MCP 和定时提醒请选择 D1 版：D1 保存设备注册和 MCP 会话，Durable Objects 保存并调度提醒。KV 版仅提供 Bark HTTP 推送 API。

### 直接部署D1版本

> [!NOTE]
> Cloudflare API Token必须有D1权限

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/super3378/bark-worker)

部署时需配置 `APNS_PRIVATE_KEY`、`APNS_TEAM_ID`、`APNS_KEY_ID` 三个 Worker Secrets，详见 [MCP 部署说明](doc/mcp.zh.md#部署与验证)。它们是 APNs 服务端凭据，与 Bark 设备 Key 不同。

### 或手动部署

参考 [部署指南](doc/setup_guide.zh.md)

#### Cloudflare D1 版本

创建一个Worker和D1 数据库, 将D1 数据库绑定至Worker并命名为 `database`

#### Cloudflare KV 版本

创建一个Worker和KV 存储, 将KV 存储绑定至Worker并命名为 `database`

## Tips

- 批量推送中，`device_keys` 非空时优先于 `device_key`
- 一个设备使用多个Key
- 设备Key别名
- D1数据库Console管理
- etc.

参考 [Tips](doc/tips.zh.md)
