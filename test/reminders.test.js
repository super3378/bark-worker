import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { ReminderQueue, GRACE_MS, HISTORY_MS } from '../reminders.js'
import { callMcpTool, listMcpTools, parseSendAt } from '../mcp-tools.js'
import { TestStorage } from './helpers/storage.js'

function setup(t, push = async () => new Response(null, { status: 200 }), storage = new TestStorage()) {
    const clock = { now: Date.now() }
    const queue = new ReminderQueue(storage, push, () => clock.now)
    queue.initialize()
    t.after(() => storage.close())
    return { clock, queue, storage }
}

test('tools preserve notify and expose device-scoped list/cancel with explicit authorization', () => {
    const tools = listMcpTools('DeviceA')
    assert.deepEqual(tools.map(t => t.name), ['notify', 'list_scheduled_notifications', 'cancel_scheduled_notification'])
    assert.equal(tools[0].inputSchema.properties.device_key, undefined)
    assert.deepEqual(tools[0].inputSchema.required, ['user_requested'])
    assert.equal(tools[0].inputSchema.properties.ttl.default, undefined)
    assert.equal(tools[0].inputSchema.properties.volume.default, undefined)
    for (const tool of listMcpTools(null)) assert.ok(tool.inputSchema.required.includes('device_key'))
})

test('schedule time requires a future real calendar date with timezone', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    assert.equal(parseSendAt(null, now), null)
    assert.equal(parseSendAt(undefined, now), null)
    assert.equal(parseSendAt('2026-01-01T08:01:00+08:00', now), now + 60000)
    for (const value of ['none', '2026-02-30T00:00:00Z', '2026-01-01T00:01:00', '2026-01-01T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00+25:00', 123]) {
        assert.throws(() => parseSendAt(value, now))
    }
})

const database = { deviceTokenByKey: async key => key === 'RegisteredKey' ? 'fake-device-token' : undefined }

test('immediate notify strips scheduling fields, preserves optional values, and does not access reminders', async () => {
    const sent = []
    const deps = { database, push: async args => { sent.push(args); return new Response(null, { status: 200 }) } }
    const result = await callMcpTool('notify', { user_requested: true, title: '测试', send_at: null, isArchive: '0', badge: 0 }, 'RegisteredKey', deps)
    assert.equal(result.structuredContent.status, 'accepted')
    assert.deepEqual(sent, [{ title: '测试', isarchive: '0', badge: 0, device_key: 'RegisteredKey' }])
})

test('invalid/unauthorized calls cause no push and do not leak credentials', async () => {
    let sent = 0
    const deps = { database, push: async () => { sent++; throw Error('RegisteredKey fake-device-token') } }
    for (const args of [{ body: 'x' }, { body: 'x', user_requested: false }, { body: 'x', user_requested: true, device_key: 'OtherKey' }, { user_requested: true }, { body: 'x', user_requested: true, ttl: 0 }, { body: 'x', user_requested: true, send_at: 'none' }]) {
        const result = await callMcpTool('notify', args, 'RegisteredKey', deps)
        assert.equal(result.isError, true)
    }
    assert.equal(sent, 0)
    const uncertain = await callMcpTool('notify', { body: 'x', user_requested: true }, 'RegisteredKey', deps)
    assert.equal(uncertain.structuredContent.status, 'unknown')
    assert.ok(!JSON.stringify(uncertain).includes('RegisteredKey'))
    assert.equal(sent, 1)
})

test('scheduled MCP uses an opaque device object and never calls push immediately', async () => {
    const calls = []
    const reminders = { idFromName: name => { assert.match(name, /^[a-f0-9]{64}$/); return name }, get: () => ({ fetch: async (url, init) => {
        assert.equal(url, 'https://reminders.internal/')
        calls.push(JSON.parse(init.body))
        return Response.json({ task_id: 'fake-task', status: 'pending' })
    } }) }
    const result = await callMcpTool('notify', { body: 'later', user_requested: true, send_at: new Date(Date.now() + 60000).toISOString() }, 'RegisteredKey', { database, reminders, push: () => assert.fail('early send') })
    assert.equal(result.structuredContent.status, 'pending')
    assert.equal(calls[0].device_key, 'RegisteredKey')
    assert.deepEqual(calls[0].parameters, { body: 'later' })
    const missing = await callMcpTool('notify', { body: 'later', user_requested: true, send_at: new Date(Date.now() + 60000).toISOString() }, 'RegisteredKey', { database })
    assert.match(missing.content[0].text, /REMINDERS/)
})

test('jobs and alarms survive reopening SQLite and send only at the due time', async t => {
    mkdirSync('work', { recursive: true })
    const path = resolve(mkdtempSync('work/reminders-test-'), 'tasks.sqlite')
    const first = new TestStorage(path)
    let now = Date.now(), sends = 0
    const queue1 = new ReminderQueue(first, () => assert.fail('early push'), () => now)
    queue1.initialize()
    const job = await queue1.schedule('SecretKey', { title: '持久化提醒' }, now + 60000)
    assert.equal(await first.getAlarm(), now + 60000)
    first.close()
    const reopened = new TestStorage(path)
    t.after(() => reopened.close())
    const queue2 = new ReminderQueue(reopened, async () => { sends++; return new Response(null, { status: 200 }) }, () => now)
    queue2.initialize()
    assert.equal(queue2.list().tasks[0].task_id, job.task_id)
    assert.ok(!JSON.stringify(queue2.list()).includes('SecretKey'))
    await queue2.runDue()
    assert.equal(sends, 0)
    now += 60000
    await queue2.runDue()
    await queue2.runDue()
    assert.equal(sends, 1)
    assert.equal(queue2.list().total, 0)
    assert.equal(queue2.list({ include_completed: true }).tasks[0].status, 'accepted')
    assert.equal(await reopened.getAlarm(), null)
})

test('cancellation is idempotent, rearms the next task, and prevents the cancelled send', async t => {
    const sent = []
    const { queue, clock, storage } = setup(t, async p => { sent.push(p.body); return new Response(null, { status: 200 }) })
    const first = await queue.schedule('Key', { body: 'cancel' }, clock.now + 1000)
    await queue.schedule('Key', { body: 'send' }, clock.now + 2000)
    assert.equal((await queue.cancel(first.task_id)).cancelled, true)
    assert.equal((await queue.cancel(first.task_id)).cancelled, true)
    assert.equal(await storage.getAlarm(), clock.now + 2000)
    clock.now += 2000
    await queue.runDue()
    assert.deepEqual(sent, ['send'])
    await assert.rejects(queue.cancel(crypto.randomUUID()), /not found/)
})

test('a send in progress cannot be cancelled or claimed twice', async t => {
    let release, signalStarted
    const started = new Promise(resolve => { signalStarted = resolve })
    const { queue, clock } = setup(t, async () => { signalStarted(); await new Promise(resolve => { release = resolve }); return new Response(null, { status: 200 }) })
    const job = await queue.schedule('Key', { body: 'in flight' }, clock.now + 1000)
    clock.now += 1000
    const running = queue.runDue()
    await started
    assert.equal((await queue.cancel(job.task_id)).cancelled, false)
    assert.equal(queue.list().tasks[0].status, 'sending')
    await queue.runDue()
    release()
    await running
    assert.equal(queue.list({ include_completed: true }).tasks[0].status, 'accepted')
})

test('interrupted sends become unknown after reconstruction, while later jobs still run', async t => {
    let sends = 0
    const { queue, clock, storage } = setup(t)
    const first = await queue.schedule('Key', { body: 'interrupted' }, clock.now + 1000)
    await queue.schedule('Key', { body: 'future' }, clock.now + 2000)
    storage.sql.exec("UPDATE reminders SET status='sending',started_at=? WHERE task_id=?", clock.now, first.task_id)
    const restored = new ReminderQueue(storage, async () => { sends++; return new Response(null, { status: 200 }) }, () => clock.now)
    restored.initialize()
    clock.now += 2000
    await restored.runDue()
    assert.equal(sends, 1)
    assert.deepEqual(restored.list({ include_completed: true }).tasks.map(t => t.status), ['unknown', 'accepted'])
})

test('network uncertainty and provider rejection are not retried or exposed as raw errors', async t => {
    let sends = 0
    const { queue, clock } = setup(t, async () => { sends++; if (sends === 1) throw Error('SecretKey'); return new Response(null, { status: 400 }) })
    await queue.schedule('SecretKey', { body: 'network failure' }, clock.now + 1000)
    await queue.schedule('SecretKey', { body: 'provider failure' }, clock.now + 2000)
    clock.now += 2000
    await queue.runDue()
    await queue.runDue()
    const result = queue.list({ include_completed: true })
    assert.deepEqual(result.tasks.map(t => t.status), ['unknown', 'rejected'])
    assert.ok(!JSON.stringify(result).includes('SecretKey'))
    assert.equal(sends, 2)
})

test('alarm write failure rolls back task creation, and failed claims never send', async t => {
    const { queue, clock, storage } = setup(t, () => assert.fail('must not send'))
    const setAlarm = storage.setAlarm.bind(storage)
    storage.setAlarm = async () => { throw Error('storage failed') }
    await assert.rejects(queue.schedule('Key', { body: 'atomic' }, clock.now + 1000))
    assert.equal(queue.list({ include_completed: true }).total, 0)
    storage.setAlarm = setAlarm
    await queue.schedule('Key', { body: 'atomic claim' }, clock.now + 1000)
    clock.now += 1000
    storage.setAlarm = async () => { throw Error('storage failed') }
    await assert.rejects(queue.runDue())
    assert.equal(queue.list().tasks[0].status, 'pending')
})

test('expiry, history retention, pagination and bounded alarm batches', async t => {
    let sends = 0
    const { queue, clock, storage } = setup(t, async () => { sends++; return new Response(null, { status: 200 }) })
    await queue.schedule('Key', { body: 'expire' }, clock.now + 1000)
    clock.now += GRACE_MS + 2000
    await queue.runDue()
    assert.equal(sends, 0)
    assert.equal(queue.list({ include_completed: true }).tasks[0].status, 'expired')
    for (let i = 0; i < 12; i++) await queue.schedule('Key', { body: String(i) }, clock.now + 1000 + i)
    assert.equal(queue.list({ limit: 5, offset: 5 }).tasks.length, 5)
    clock.now += 2000
    await queue.runDue()
    assert.equal(sends, 10)
    assert.equal(queue.list().total, 2)
    assert.ok(await storage.getAlarm())
    await queue.runDue()
    assert.equal(sends, 12)
    clock.now += HISTORY_MS + 1
    assert.equal(queue.list({ include_completed: true }).total, 0)
})

test('device identity and active-task limit are enforced within the transaction', async t => {
    const { queue, clock, storage } = setup(t)
    await queue.schedule('FirstKey', { body: 'one' }, clock.now + 1000)
    await assert.rejects(queue.schedule('AnotherKey', { body: 'other' }, clock.now + 1000), /Device mismatch/)
    for (let i = 1; i < 500; i++) storage.sql.exec("INSERT INTO reminders(task_id,send_at,created_at,updated_at,status,payload) VALUES(?,?,?,?,'pending','{}')", String(i), clock.now + 1000, clock.now, clock.now)
    await assert.rejects(queue.schedule('FirstKey', { body: 'over capacity' }, clock.now + 1000), /500/)
})
