<p align="center">
    <h1 align="center">Bark-Worker</h1>
</p>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

English | **[中文文档](README.zh.md)**

Bark-Worker is a [Bark](https://github.com/Finb/Bark) push notification backend on Cloudflare Workers. Send notifications to your iPhone through HTTP APIs or MCP without running a separate server.

This repository is based on [cwxiaos/bark-worker](https://github.com/cwxiaos/bark-worker). It preserves the original Bark APIs and cloud MCP support, and adds one-time scheduled reminders, task listing, and cancellation. Thanks to the original author and the [Bark-Server](https://github.com/Finb/bark-server) project. This version remains licensed under [GPL-3.0](LICENSE).

### What is [Bark](https://github.com/Finb/Bark)?
[Bark](https://github.com/Finb/Bark) is an iOS App which allows you to push customed notifications to your iPhone.

> [!NOTE]
> A domain is required if worker.dev is unavailable in your country/region

## Features

- Full Bark-Server APIs support
    - `register`
    - `ping`
    - `healthz`
    - `info`
    - `push`
- Path based parameters resolve
- Cloud MCP (D1 version): `notify` sends or schedules notifications, `list_scheduled_notifications` lists tasks, and `cancel_scheduled_notification` cancels pending tasks
- Persistent reminders in SQLite Durable Objects, triggered by Alarms; once saved, tasks can run after your computer shuts down or the MCP client disconnects
- Easy to deploy, Cheap to use and Convenient to manage

See the [MCP guide](doc/mcp.md) for connection details, parameters, and execution rules. Reminders are one-time only; recurring schedules are not supported. Sending and cancellation require an explicit user request.

## Setup

> [!NOTE]
> Choose the D1 version for cloud MCP and scheduled reminders: D1 stores device registrations and MCP sessions, while Durable Objects store and schedule reminders. The KV version provides Bark HTTP APIs only.

### Follow the instructions for D1 Version

> [!NOTE]
> The Cloudflare API Token must have D1 permission.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/super3378/bark-worker)

Configure the Worker Secrets `APNS_PRIVATE_KEY`, `APNS_TEAM_ID`, and `APNS_KEY_ID` during setup; see the [MCP deployment guide](doc/mcp.md). These are APNs server credentials, separate from your Bark device key.

### Or manually deploy

Refer to [Setup Guide](doc/setup_guide.md)

#### Cloudflare D1 Version

Create a Worker and a D1 Database, bind D1 database to Worker with name `database`

#### Cloudflare KV Version

Create a Worker and a KV Storage, bind KV Storage to Worker with name `database`

## Tips

- For batch pushes, a non-empty `device_keys` takes priority over `device_key`
- Multi Device Key to one Device
- Device Key Alias
- D1 Database Manage in Console
- etc.

Refer to [Tips](doc/tips.md)
