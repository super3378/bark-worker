# Bark-Worker

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

English | [中文文档](README.zh.md)

A [Bark](https://github.com/Finb/Bark) push notification backend on Cloudflare Workers. Send notifications to your iPhone through HTTP APIs or cloud MCP. Cloud MCP also supports one-time reminders, task listing, and cancellation. Saved reminders run after your computer shuts down or your Agent disconnects, without a separate server.

This repository extends [cwxiaos/bark-worker](https://github.com/cwxiaos/bark-worker), preserving its Bark APIs and cloud MCP while adding scheduled reminders and task management. Thanks to the original author and the [Bark-Server](https://github.com/Finb/bark-server) project. Licensed under [GPL-3.0](LICENSE).

## Architecture

The current deployment uses two independent storage systems: **D1 and SQLite-backed Durable Objects**.

| Cloudflare component | Purpose |
| --- | --- |
| Workers | Serve Bark HTTP APIs and MCP, and send notifications |
| D1 | Store device registrations, cached APNs authorization, and MCP sessions |
| Durable Objects (with their own SQLite storage) | Persist scheduled tasks and trigger delivery through Alarms |

Reminders are stored outside D1 and do not depend on local timers. Their SQLite data belongs to Durable Objects and does not appear in the D1 table list.

## Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/super3378/bark-worker)

1. Use the button and follow Cloudflare's prompts to connect GitHub and deploy this repository. D1 and Durable Objects are provisioned and bound from the repository configuration; no separate manual database setup is needed.
2. For a fresh deployment of this version, provide `APNS_PRIVATE_KEY`, `APNS_TEAM_ID`, and `APNS_KEY_ID` when prompted, or add them in the Worker's Variables and Secrets settings afterward. Existing services with these Secrets configured do not need to enter them again. They are APNs server credentials matching the Bark client, not device keys, and Cloudflare does not generate them.
3. After deployment and any required configuration, add the server base URL, such as `https://YOUR_HOST`, in the iPhone Bark app. Register the device and obtain its device key.

If your network cannot reach `workers.dev`, bind a custom domain. Both the phone and the Agent need access to the service.

See the [deployment guide](doc/setup_guide.md) for manual deployment, database setup, and upgrades. Deploy the complete repository rather than copying only `main.js`.

## Connect a local Agent

Replace `YOUR_HOST` and `YOUR_DEVICE_KEY` below with your server domain and Bark device key, then give the entire prompt to your Agent so it can configure the current client:

```text
Please add this cloud Bark MCP service to my current Agent client:
Server name: bark-cloud
Transport: Streamable HTTP
URL: https://YOUR_HOST/mcp/YOUR_DEVICE_KEY

Configure it using the method supported by this client. If a reload or restart is needed, tell me the steps.
Verify the connection by listing scheduled reminders. Send, schedule, or cancel notifications only when I explicitly request it.
```

The client must support remote MCP, and the Agent needs permission to configure it. No local Node.js MCP process is needed. For custom paths or Basic authentication, see the [MCP connection guide](doc/mcp.md#connect).

## Tools and examples

| Tool | Purpose |
| --- | --- |
| `notify` | Send now or schedule a reminder for a future time |
| `list_scheduled_notifications` | List this device's scheduled tasks |
| `cancel_scheduled_notification` | Cancel a reminder that has not started sending |

Ask your Agent in natural language:

- "Send me a test notification."
- "Remind me to drink water in half an hour."
- "Remind me to wake up at 8:30 tomorrow morning."
- "List my scheduled reminders."
- "Cancel the water reminder I just created."

See the [MCP guide](doc/mcp.md) for arguments, task states, and execution rules. The existing HTTP APIs, including `register`, `ping`, `healthz`, `info`, and `push`, remain available. See [Tips](doc/tips.md) for other uses.

## Usage notes and troubleshooting

- Reminders are one-time only; recurring schedules are not supported. Sending and cancellation require an explicit user request.
- Omit `send_at` or use `null` to send now. The Agent converts relative times to timestamps with timezones. `ttl` controls notification archive lifetime, not a send delay, and has no default.
- A saved reminder returns a task ID; list tasks to confirm it. An accepted push is not confirmation of phone delivery, and scheduled execution can be delayed.
- If the connection fails, check the domain, device key, Streamable HTTP support, proxy routing, and authentication. Opening the service homepage alone does not verify an MCP handshake.
