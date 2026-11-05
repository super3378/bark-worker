# Deployment guide

[Back to README](../README.md)

This version requires the complete source, D1, and SQLite-backed Durable Objects. Since `main.js` imports other modules, pasting that file alone into the Worker editor is not sufficient.

## One-click deployment

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/super3378/bark-worker)

Use the button and follow the prompts to connect GitHub and create a Worker. Cloudflare reads `wrangler.jsonc` to provision and bind D1 and Durable Objects automatically; you do not need to create databases manually first. See [Cloudflare's deployment button guide](https://developers.cloudflare.com/workers/platform/deploy-buttons/). After deployment, check these settings:

| Setting | Requirement |
| --- | --- |
| Worker entry point | `main.js`, with the repository's imported modules |
| D1 | Binding `database`, pointing to a database in your own account |
| Durable Object | Binding `REMINDERS`, class `ReminderScheduler` |
| SQLite migration | Retain the `v1-reminders` declaration with `new_sqlite_classes` |
| APNs Secrets | `APNS_PRIVATE_KEY`, `APNS_TEAM_ID`, `APNS_KEY_ID` |

For a fresh deployment of this version, provide the three valid APNs Secrets when prompted. If they were not entered during deployment, add them under the Worker's Settings → Variables and Secrets. Existing services with these Secrets configured do not need to enter them again when updating code.

The original imported version embedded APNs credentials in its source, so it did not require manual credential configuration. This version reads them from Secrets instead. Cloudflare does not generate APNs credentials matching the Bark client, and `.dev.vars.example` contains only names and placeholders, not usable credential values. They are separate from the phone's device key.

After successful deployment and any required Secret configuration, continue with verification below.

## Manual deployment

Install a Node.js LTS release that supports this project's dependencies and Git, and prepare a Cloudflare account. Run the following commands in the cloned repository.

### 1. Get the source and sign in

```sh
git clone https://github.com/super3378/bark-worker.git
cd bark-worker
npm ci
npx wrangler login
```

### 2. Create your D1 database

For a new deployment:

```sh
npx wrangler d1 create bark-worker-db
```

Set the returned name and ID in `wrangler.jsonc`, keeping the binding name `database`:

```jsonc
// The d1_databases field in wrangler.jsonc
"d1_databases": [
  {
    "binding": "database",
    "database_name": "bark-worker-db",
    "database_id": "YOUR_D1_DATABASE_ID"
  }
]
```

Replace the database ID supplied in the repository. For an existing service, retain the original database instead of creating a replacement.

The same file declares the `REMINDERS` Durable Object binding and `v1-reminders` migration. Wrangler creates those resources during the first deployment; a second D1 database is not needed. See the [Cloudflare Durable Objects documentation](https://developers.cloudflare.com/durable-objects/get-started/).

### 3. Set APNs Secrets

Skip this step if the existing Worker already has all three Secrets. Fresh deployments need valid APNs server credentials matching the Bark client. Check that the Worker `name` in `wrangler.jsonc` matches your intended deployment, then use these interactive commands:

```sh
npx wrangler secret put APNS_PRIVATE_KEY
npx wrangler secret put APNS_TEAM_ID
npx wrangler secret put APNS_KEY_ID
```

Use the complete PEM private key for `APNS_PRIVATE_KEY`. You can also set Secrets in the Worker's Variables and Secrets settings. If prompted to create the Worker first, create it with the same name or complete an initial deployment before setting Secrets.

### 4. Check and deploy

```sh
npm test
npm run build:check
npm run deploy
```

Tests use local resources and mocked APNs without sending real notifications. `build:check` is a dry run. `deploy` first applies remote D1 migrations, then deploys the Worker, Durable Object code, and configuration.

If you use Workers Builds, ensure the build/deployment flow also applies remote D1 migrations. This project's `npm run deploy` includes that step.

## Verify and register

1. Confirm deployment, D1 migrations, and all three APNs Secrets are complete.
2. Open `https://YOUR_HOST/ping` to check the service response. Include the configured `ROOT_PATH` prefix if applicable.
3. Add the server base URL in the iPhone Bark app, register the device, and obtain its device key. New registrations require `ALLOW_NEW_DEVICE`, which is enabled by default.
4. Follow the [README connection tutorial](../README.md#connect-a-local-agent), list scheduled reminders, and test sending when needed.

If `BASIC_AUTH` is enabled, include the corresponding Basic authentication information with push and MCP requests. Bind a custom domain if your network cannot reach `workers.dev`.

## Upgrade an existing service

- Retain the Worker name, D1 database, domain, required variables, and existing Secrets.
- Keep the `REMINDERS` binding, `ReminderScheduler` class name, and deployed migration history. Changing or deleting them can affect existing tasks.
- Deploy the complete updated repository and reload tool definitions in MCP clients.

D1 stores device information, cached APNs authorization, and MCP sessions. Scheduled tasks use the Durable Object's own SQLite storage and Alarms. Cloudflare plan quotas apply to each resource.
