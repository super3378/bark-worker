import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../main.js?credentials-test'

class DatabaseWithoutAuthCache {
    exec() {}
    prepare(query) {
        const result = () => ({ results: query.includes('SELECT `token` FROM `devices`') ? [{ token: 'fake-device-token' }] : [] })
        return { run: async () => result(), bind: () => ({ run: async () => result() }) }
    }
}

const request = () => new Request('https://worker.test/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_key: 'CredentialTest', body: 'test' }) })

test('missing APNs secrets fails before contacting Apple', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = () => assert.fail('must not contact Apple without credentials')
    try {
        await assert.rejects(worker.fetch(request(), { database: new DatabaseWithoutAuthCache() }, { waitUntil() {} }), /Configure APNS_PRIVATE_KEY/)
    } finally { globalThis.fetch = originalFetch }
})

test('Worker secrets generate a verifiable APNs JWT using an ephemeral test key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
    // Generated only in memory during this test; no real credentials are used.
    const pem = ['-----BEGIN PRIVATE KEY-----', Buffer.from(der).toString('base64'), '-----END PRIVATE KEY-----'].join('\n')
    const originalFetch = globalThis.fetch
    let jwt
    globalThis.fetch = async (_url, options) => { jwt = options.headers.authorization.slice(7); return new Response(null, { status: 200 }) }
    try {
        const response = await worker.fetch(request(), {
            database: new DatabaseWithoutAuthCache(), APNS_PRIVATE_KEY: pem,
            APNS_TEAM_ID: 'TESTTEAM', APNS_KEY_ID: 'TESTKEY',
        }, { waitUntil() {} })
        assert.equal(response.status, 200)
        assert.match(jwt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
        const [header, claims, signature] = jwt.split('.')
        assert.equal(JSON.parse(Buffer.from(header, 'base64url')).kid, 'TESTKEY')
        assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).iss, 'TESTTEAM')
        assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(header + '.' + claims)), true)
    } finally { globalThis.fetch = originalFetch }
})
