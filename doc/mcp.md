# Cloud MCP

The D1 Worker supports immediate notifications, one-time reminders, listing, and cancellation over Streamable HTTP. Reminders run on Cloudflare after clients disconnect.

## Connect

Use `https://YOUR_HOST/mcp/DEVICE_KEY` for a fixed device, or `https://YOUR_HOST/mcp` and provide `device_key` in every tool call. Include any configured `ROOT_PATH` prefix and Basic Authorization header when `BASIC_AUTH` is enabled.

| Tool | Purpose | Main arguments |
| --- | --- | --- |
| `notify` | Send now or schedule | Message fields, `user_requested: true`, optional `send_at` |
| `list_scheduled_notifications` | List this device key's reminders | Optional `include_completed`, `limit`, `offset` |
| `cancel_scheduled_notification` | Cancel a pending reminder | `task_id`, `user_requested: true` |

Only send, schedule, or cancel when explicitly requested by the user. Upgraded clients must reload tool definitions: `notify` now requires `user_requested: true`.

```json
{
  "user_requested": true,
  "title": "Water break",
  "body": "Time for a glass of water.",
  "send_at": "2027-01-01T15:30:00+08:00"
}
```

Omit `send_at` or set it to `null` to send immediately. Otherwise use a future ISO timestamp with a date and timezone; the Agent converts relative times. Returned times use UTC. At least one of `title`, `subtitle`, `body`, or `markdown` is required. Other Bark fields are described by the tool schema. `ttl` has no default and controls archive lifetime, not scheduling.

Listing defaults to pending/sending tasks; set `include_completed: true` for history. Page size defaults to 50, maximum 100; use `offset` for pagination. Cancellation is idempotent and only applies to pending tasks. `task_id` is not a Bark notification ID.

## Execution and deployment

Each device key has its own SQLite Durable Object and Alarm. Up to 500 active tasks are allowed; completed records older than 30 days are purged on subsequent access. Statuses are `pending`, `sending`, `accepted`, `rejected`, `unknown`, `cancelled`, and `expired`. Accepted means Bark accepted the request, not confirmed phone delivery.

Alarms may be delayed by maintenance or failures. Pending tasks up to 30 minutes late may still execute; older ones expire. Claimed tasks are never automatically resent, including after interrupted/uncertain execution. Check the phone before manually retrying `unknown` results.

Preserve your existing Worker name, D1 binding, domain, and variables. Deploy the `REMINDERS` binding and `v1-reminders` SQLite migration from `wrangler.jsonc` together with the code. Keep that migration declaration on later updates. No extra server or local scheduler is needed.

Before deploying, configure `APNS_PRIVATE_KEY` (PEM), `APNS_TEAM_ID`, and `APNS_KEY_ID` as Worker Secrets using the values for your existing APNs service. These are server-side APNs credentials, not Bark device keys. Both D1/KV sources now read credentials from Secrets; missing values prevent new APNs authorization tokens from being generated. For local development, copy `.dev.vars.example` to `.dev.vars` and fill it in.

```sh
npm ci
npm test
npm run build:check
npm run deploy
```

Tests run against local Cloudflare resources and mocked APNs without sending real notifications. The build check is a dry run. Deployment also runs the existing D1 migrations; Workers Builds can deploy automatically when the production branch is pushed. Reload MCP clients after deployment. SQLite Durable Objects are available on Workers Free, subject to its limits. The KV Worker does not expose these tools.
