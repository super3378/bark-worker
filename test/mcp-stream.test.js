import assert from 'node:assert/strict'
import test from 'node:test'
import { createMcpEventStream } from '../mcp-stream.js'

test('SSE heartbeat stays on one connection and cancellation stops the timer', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const response = createMcpEventStream(new Request('https://worker.test/mcp'))
    const reader = response.body.getReader()
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'retry: 60000\n: connected\n\n')
    t.mock.timers.tick(25000)
    assert.equal(new TextDecoder().decode((await reader.read()).value), ': keepalive\n\n')
    await reader.cancel()
    t.mock.timers.tick(50000)
    assert.equal((await reader.read()).done, true)
})

test('SSE abort closes the stream and clears its heartbeat', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const abort = new AbortController()
    const response = createMcpEventStream(new Request('https://worker.test/mcp', { signal: abort.signal }))
    const reader = response.body.getReader()
    await reader.read()
    abort.abort()
    assert.equal((await reader.read()).done, true)
    t.mock.timers.tick(50000)
})

test('an already aborted SSE request never starts a heartbeat', async () => {
    const response = createMcpEventStream(new Request('https://worker.test/mcp', { signal: AbortSignal.abort() }))
    assert.equal((await response.body.getReader().read()).done, true)
})
