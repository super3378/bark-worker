import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare'

test('Cloudflare runtime: MCP sessions, SQLite Durable Objects, alarms, isolation and restart', { timeout: 60000 }, async t => {
    mkdirSync('work', { recursive: true })
    const persistRoot = resolve(mkdtempSync('work/cloud-test-'))
    const pushes = []
    const options = convertV4MiniflareOptions({
        name: 'bark-test',
        modules: ['main.js', 'mcp-tools.js', 'reminders.js', 'mcp-stream.js'].map(path => ({ type: 'ESModule', path: resolve(path) })),
        compatibilityDate: '2026-03-01',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['database'],
        durableObjects: { REMINDERS: { className: 'ReminderScheduler', useSQLite: true } },
        resourcePersistencePath: persistRoot,
        log: new Log(LogLevel.ERROR),
        outboundService: async request => {
            assert.match(request.url, /^https:\/\/api\.push\.apple\.com\/3\/device\//)
            pushes.push(await request.json())
            return new Response(null, { status: 200 })
        },
    })
    let mf = new Miniflare(options)
    t.after(async () => mf.dispose())
    await mf.ready
    const database = await mf.getD1Database('database')
    for (const file of ['001_create_authorization.sql', '002_create_devices.sql', '003_create_session.sql']) {
        await database.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'))
    }
    await database.prepare('INSERT INTO devices(key,token) VALUES(?,?),(?,?)').bind('DeviceA', 'a'.repeat(64), 'DeviceB', 'b'.repeat(64)).run()
    await database.prepare('INSERT INTO authorization(id,token,time) VALUES(1,?,?)').bind('fake-test-auth', String(Math.floor(Date.now() / 1000))).run()

    let requestId = 0
    async function rpc(path, session, method, params = {}) {
        const response = await mf.dispatchFetch('https://bark.test' + path, {
            method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { 'mcp-session-id': session } : {}) },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
        })
        assert.equal(response.status, 200)
        return { response, body: await response.json() }
    }
    async function connect(path) {
        const { response, body } = await rpc(path, null, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
        assert.match(body.result.instructions, /ONLY/)
        return response.headers.get('mcp-session-id')
    }
    const call = async (session, name, args, path = '/mcp/DeviceA') => (await rpc(path, session, 'tools/call', { name, arguments: args })).body.result
    const list = async (session, args = {}, path) => (await call(session, 'list_scheduled_notifications', args, path)).structuredContent
    let sessionA = await connect('/mcp/DeviceA')
    const sessionB = await connect('/mcp/DeviceB')

    await t.test('unsupported MCP methods return 405 without affecting POST tools', async () => {
        for (const path of ['/mcp', '/mcp/DeviceA']) {
            for (const method of ['PUT', 'HEAD']) {
                const response = await mf.dispatchFetch('https://bark.test' + path, {
                    method, headers: { accept: 'text/event-stream', 'mcp-session-id': sessionA },
                })
                assert.equal(response.status, 405)
                assert.equal(response.headers.get('allow'), 'GET, POST, DELETE')
                await response.arrayBuffer()
            }
        }
        assert.equal((await list(sessionA)).total, 0)
        assert.equal(pushes.length, 0)
    })

    await t.test('GET keeps a private comment-only SSE connection open without sending notifications', async () => {
        for (const path of ['/mcp', '/mcp/DeviceA']) {
            const response = await mf.dispatchFetch('https://bark.test' + path, { headers: { accept: 'text/event-stream' } })
            assert.equal(response.status, 200)
            assert.equal(response.headers.get('content-type'), 'text/event-stream')
            const reader = response.body.getReader()
            const first = new TextDecoder().decode((await reader.read()).value)
            assert.match(first, /retry: 60000/)
            assert.ok(!first.includes('DeviceA'))
            const endedEarly = await Promise.race([reader.read().then(() => true), delay(100).then(() => false)])
            assert.equal(endedEarly, false)
            assert.equal((await list(sessionA)).total, 0)
            await reader.cancel()
        }
        assert.equal(pushes.length, 0)
    })

    await t.test('tool discovery and immediate sends use the original push pipeline', async () => {
        const { body } = await rpc('/mcp/DeviceA', sessionA, 'tools/list')
        assert.deepEqual(body.result.tools.map(tool => tool.name), ['notify', 'list_scheduled_notifications', 'cancel_scheduled_notification'])
        const result = await call(sessionA, 'notify', { user_requested: true, body: '立即发送测试', group: '测试', send_at: null })
        assert.equal(result.structuredContent.status, 'accepted')
        assert.equal(pushes.length, 1)
        assert.equal(pushes[0].aps.alert.body, '立即发送测试')
        assert.equal(pushes[0].ttl, undefined)
        assert.equal(pushes[0].send_at, undefined)
    })

    await t.test('listing creates no push; invalid authorization and time create no task', async () => {
        for (const args of [{ body: 'x' }, { user_requested: false, body: 'x' }, { user_requested: true, body: 'x', send_at: 'none' }, { user_requested: true, body: 'x', send_at: '2027-02-30T15:30:00+08:00' }]) {
            assert.equal((await call(sessionA, 'notify', args)).isError, true)
        }
        assert.equal((await list(sessionA)).total, 0)
        assert.equal(pushes.length, 1)
    })

    await t.test('device-scoped list/cancel and a second client share only their own queue', async () => {
        const job = await call(sessionA, 'notify', { user_requested: true, body: '待取消', send_at: new Date(Date.now() + 60000).toISOString() })
        assert.equal(job.structuredContent.status, 'pending')
        const id = job.structuredContent.task_id
        const sameDevice = await connect('/mcp/DeviceA')
        assert.equal((await list(sameDevice)).tasks[0].task_id, id)
        assert.equal((await list(sessionB, {}, '/mcp/DeviceB')).total, 0)
        const wrongDevice = await call(sessionB, 'cancel_scheduled_notification', { task_id: id, user_requested: true }, '/mcp/DeviceB')
        assert.equal(wrongDevice.isError, true)
        const cancelled = await call(sameDevice, 'cancel_scheduled_notification', { task_id: id, user_requested: true })
        assert.equal(cancelled.structuredContent.cancelled, true)
        const repeated = await call(sessionA, 'cancel_scheduled_notification', { task_id: id, user_requested: true })
        assert.equal(repeated.structuredContent.cancelled, true)
        assert.equal((await list(sessionA)).total, 0)
        assert.equal(pushes.length, 1)
    })

    await t.test('actual Alarm fires once without an active MCP connection', async () => {
        const job = await call(sessionA, 'notify', { user_requested: true, body: 'Alarm 测试', send_at: new Date(Date.now() + 1200).toISOString() })
        assert.equal(job.structuredContent.status, 'pending')
        const deadline = Date.now() + 10000
        // Do not poll the Worker while waiting: the Alarm must wake it itself.
        while (pushes.length < 2 && Date.now() < deadline) await delay(100)
        assert.equal(pushes.length, 2)
        const tasks = (await list(sessionA, { include_completed: true })).tasks
        assert.equal(tasks.find(task => task.task_id === job.structuredContent.task_id).status, 'accepted')
        await delay(100)
        assert.equal(pushes.length, 2)
    })

    await t.test('persisted reminders survive a complete local runtime restart', async () => {
        const job = await call(sessionA, 'notify', { user_requested: true, body: '重启后的提醒', send_at: new Date(Date.now() + 2500).toISOString() })
        assert.equal(job.structuredContent.status, 'pending')
        await mf.dispose()
        mf = new Miniflare(options)
        await mf.ready
        sessionA = await connect('/mcp/DeviceA')
        const restored = await list(sessionA, { include_completed: true })
        assert.ok(restored.tasks.some(task => task.task_id === job.structuredContent.task_id), 'reminder must be persisted across runtime restart')
        const deadline = Date.now() + 10000
        while (pushes.length < 3 && Date.now() < deadline) await delay(100)
        assert.equal(pushes.length, 3)
        const tasks = (await list(sessionA, { include_completed: true })).tasks
        assert.equal(tasks.find(task => task.task_id === job.structuredContent.task_id).status, 'accepted')
        assert.ok(!JSON.stringify(tasks).includes('DeviceA'))
    })
})
