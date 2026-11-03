import { callMcpTool, listMcpTools, ToolInputError } from './mcp-tools.js'
import { ReminderQueue } from './reminders.js'
import { createMcpEventStream } from './mcp-stream.js'

export default {
    async fetch(request, env, ctx) {
        return await handleRequest(request, env, ctx)
    }
}

async function handleRequest(request, env, ctx) {
    const allowNewDevice = env.ALLOW_NEW_DEVICE !== undefined ? (env.ALLOW_NEW_DEVICE === 'false' ? false : Boolean(env.ALLOW_NEW_DEVICE)) : true
    const allowQueryNums = env.ALLOW_QUERY_NUMS !== undefined ? (env.ALLOW_QUERY_NUMS === 'false' ? false : Boolean(env.ALLOW_QUERY_NUMS)) : true
    const rootPath = env.ROOT_PATH || '/'
    const basicAuth = env.BASIC_AUTH

    const db = new Database(env)
    ctx.waitUntil(db.cleanupExpiredSessions())

    const { searchParams, pathname } = new URL(request.url)
    const handler = new Handler(db, { allowNewDevice, allowQueryNums, reminders: env.REMINDERS, apns: env })
    const realPathname = pathname.replace((new RegExp('^' + rootPath.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'))), '/')

    switch (realPathname) {
        case '/register': {
            return handler.register(searchParams)
        }
        case '/ping': {
            return handler.ping(searchParams)
        }
        case '/healthz': {
            return handler.healthz(searchParams)
        }
        case '/info': {
            if (!util.validateBasicAuth(request, basicAuth)) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: {
                        'content-type': 'text/plain',
                        'WWW-Authenticate': 'Basic realm="Bark"',
                    }
                })
            }
            return handler.info(searchParams)
        }
        case '/mcp': {
            if (!util.validateBasicAuth(request, basicAuth)) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: {
                        'content-type': 'text/plain',
                        'WWW-Authenticate': 'Basic realm="Bark"',
                    }
                })
            }
            return handler.mcp(request, undefined)
        }
        default: {
            const pathParts = realPathname.split('/')

            if (pathParts[1]) {
                if (!util.validateBasicAuth(request, basicAuth)) {
                    return new Response('Unauthorized', {
                        status: 401,
                        headers: {
                            'content-type': 'text/plain',
                            'WWW-Authenticate': 'Basic',
                        }
                    })
                }

                if (pathParts[1] === 'mcp') {
                    return handler.mcp(request, pathParts[2])
                }

                const contentType = request.headers.get('content-type')
                let requestBody = {}

                try {
                    if (contentType && contentType.includes('application/json')) {
                        requestBody = await request.json()

                        requestBody = Object.keys(requestBody).reduce((obj, key) => {
                            obj[key.toLowerCase()] = requestBody[key]
                            return obj
                        }, {})
                    } else if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
                        const formData = await request.formData()
                        formData.forEach((value, key) => { requestBody[key.toLowerCase()] = value })

                        try {
                            if (requestBody.title) {
                                requestBody.title = decodeURIComponent(requestBody.title.replaceAll('\+', '%20'))
                            }

                            if (requestBody.subtitle) {
                                requestBody.subtitle = decodeURIComponent(requestBody.subtitle.replaceAll('\+', '%20'))
                            }

                            if (requestBody.body) {
                                requestBody.body = decodeURIComponent(requestBody.body.replaceAll('\+', '%20'))
                            }

                            if (requestBody.markdown) {
                                requestBody.markdown = decodeURIComponent(requestBody.markdown.replaceAll('\+', '%20'))
                            }
                        } catch (error) {
                            return new Response(JSON.stringify({
                                'code': 500,
                                'message': `url path parse failed: ${error}`,
                                'timestamp': util.getTimestamp(),
                            }), {
                                status: 500,
                                headers: {
                                    'content-type': 'application/json',
                                }
                            })
                        }
                    } else {
                        searchParams.forEach((value, key) => { requestBody[key.toLowerCase()] = value })

                        if (pathParts.length === 3) {
                            requestBody.body = pathParts[2]
                        } else if (pathParts.length === 4) {
                            requestBody.title = pathParts[2]
                            requestBody.body = pathParts[3]
                        } else if (pathParts.length === 5) {
                            requestBody.title = pathParts[2]
                            requestBody.subtitle = pathParts[3]
                            requestBody.body = pathParts[4]
                        } else if (pathParts.length > 5) {
                            return new Response(JSON.stringify({
                                'code': 404,
                                'message': `Cannot ${request.method} ${realPathname}`,
                                'timestamp': util.getTimestamp(),
                            }), {
                                status: 404,
                                headers: {
                                    'content-type': 'application/json',
                                }
                            })
                        }

                        try {
                            if (requestBody.title) {
                                requestBody.title = decodeURIComponent(requestBody.title.replaceAll('\+', '%20'))
                            }

                            if (requestBody.subtitle) {
                                requestBody.subtitle = decodeURIComponent(requestBody.subtitle.replaceAll('\+', '%20'))
                            }

                            if (requestBody.body) {
                                requestBody.body = decodeURIComponent(requestBody.body.replaceAll('\+', '%20'))
                            }

                            if (requestBody.markdown) {
                                requestBody.markdown = decodeURIComponent(requestBody.markdown.replaceAll('\+', '%20'))
                            }
                        } catch (error) {
                            return new Response(JSON.stringify({
                                'code': 500,
                                'message': `url path parse failed: ${error}`,
                                'timestamp': util.getTimestamp(),
                            }), {
                                status: 500,
                                headers: {
                                    'content-type': 'application/json',
                                }
                            })
                        }
                    }

                    if (requestBody.device_keys && typeof requestBody.device_keys === 'string') {
                        if (requestBody.device_keys.startsWith('[') || requestBody.device_keys.endsWith(']')) {
                            requestBody.device_keys = JSON.parse(requestBody.device_keys)
                        } else {
                            requestBody.device_keys = (decodeURIComponent(requestBody.device_keys).trim()).split(',').map(item => item.replace(/['"]/g, '').trim())
                        }

                        if (typeof requestBody.device_keys === 'string') {
                            requestBody.device_keys = [requestBody.device_keys]
                        }
                    }
                } catch (error) {
                    return new Response(JSON.stringify({
                        'code': 400,
                        'message': `request bind failed: ${error}`,
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 400,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                if (requestBody.device_keys && requestBody.device_keys.length > 0) {
                    return new Response(JSON.stringify({
                        'code': 200,
                        'message': 'success',
                        'data': await Promise.all(requestBody.device_keys.map(async (device_key) => {
                            if (!device_key) {
                                return {
                                    code: 400,
                                    message: 'device key is empty',
                                    device_key: device_key,
                                }
                            }

                            const response = await handler.push({ ...requestBody, device_key })
                            const responseBody = await response.json()
                            return {
                                code: response.status,
                                message: responseBody.message,
                                device_key: device_key,
                            }
                        })),
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                if (realPathname != '/push') {
                    requestBody.device_key = pathParts[1]
                }

                if (!requestBody.device_key) {
                    return new Response(JSON.stringify({
                        'code': 400,
                        'message': 'device key is empty',
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 400,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                return handler.push(requestBody)
            }

            if (realPathname === '/') {
                return new Response('ok', {
                    status: 200,
                    headers: {
                        'content-type': 'text/plain',
                    }
                })
            }

            return new Response(JSON.stringify({
                'code': 404,
                'message': `Cannot ${request.method} ${realPathname}`,
                'timestamp': util.getTimestamp(),
            }), {
                status: 404,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }
    }
}

class Handler {
    constructor(db, options) {
        this.version = 'v2.3.4-reminders.1'
        this.build = '2026-09-12 17:45:41'
        this.arch = 'js'
        this.commit = '3db0918856d5aca4d141300c84d5c7a9f851ba44'
        this.allowNewDevice = options.allowNewDevice
        this.allowQueryNums = options.allowQueryNums

        this.register = async (parameters) => {
            const deviceToken = parameters.get('devicetoken')
            let key = parameters.get('key')

            if (!deviceToken) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token is empty',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (deviceToken.length > 160) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token is invalid',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (!(key && await db.deviceTokenByKey(key) != undefined)) {
                if (this.allowNewDevice) {
                    key = await util.newShortUUID()
                } else {
                    return new Response(JSON.stringify({
                        'code': 500,
                        'message': 'device registration failed: register disabled',
                    }), {
                        status: 500,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }
            }

            await db.saveDeviceTokenByKey(key, deviceToken)

            return new Response(JSON.stringify({
                'code': 200,
                'message': 'success',
                'timestamp': util.getTimestamp(),
                'data': {
                    'key': key,
                    'device_key': key,
                    'device_token': deviceToken,
                },
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.ping = async (parameters) => {
            return new Response(JSON.stringify({
                'code': 200,
                'message': 'pong',
                'timestamp': util.getTimestamp(),
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.healthz = async (parameters) => {
            return new Response('ok', {
                status: 200,
                headers: {
                    'content-type': 'text/plain',
                }
            })
        }

        this.info = async (parameters) => {
            if (this.allowQueryNums) {
                this.devices = await db.countAll()
            }

            return new Response(JSON.stringify({
                'version': this.version,
                'build': this.build,
                'arch': this.arch,
                'commit': this.commit,
                'devices': this.devices,
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.push = async (parameters, { timeoutMs } = {}) => {
            const deviceToken = await db.deviceTokenByKey(parameters.device_key)

            if (deviceToken === undefined) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': `failed to get device token: failed to get [${parameters.device_key}] device token from database`,
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (!deviceToken) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token invalid',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            const title = parameters.title || undefined
            const subtitle = parameters.subtitle || undefined
            const body = parameters.body || undefined

            let sound = parameters.sound || undefined
            if (sound) {
                if (!sound.endsWith('.caf')) {
                    sound += '.caf'
                }
            } else {
                sound = '1107'
            }

            const group = parameters.group || undefined
            const call = parameters.call || undefined
            const isArchive = parameters.isarchive || undefined
            const icon = parameters.icon || undefined
            const ciphertext = parameters.ciphertext || undefined
            const level = parameters.level || undefined
            const volume = parameters.volume || undefined
            const url = parameters.url || undefined
            const image = parameters.image || undefined
            const copy = parameters.copy || undefined
            const badge = parameters.badge?.toString()
            const autoCopy = parameters.autocopy || undefined
            const action = parameters.action || undefined
            const iv = parameters.iv || undefined
            const id = parameters.id || undefined
            const _delete = parameters.delete || undefined
            const markdown = parameters.markdown || undefined
            const ttl = parameters.ttl || undefined

            // https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
            const aps = {
                'aps': (_delete) ? {
                    'content-available': 1,
                    'mutable-content': 1,
                } : {
                    'alert': {
                        'title': title,
                        'subtitle': subtitle,
                        'body': (!title && !subtitle && !body) ? 'Empty Message' : body,
                        'launch-image': undefined,
                        'title-loc-key': undefined,
                        'title-loc-args': undefined,
                        'subtitle-loc-key': undefined,
                        'subtitle-loc-args': undefined,
                        'loc-key': undefined,
                        'loc-args': undefined,
                    },
                    'badge': undefined,
                    'sound': sound,
                    'thread-id': group,
                    'category': 'myNotificationCategory',
                    'content-available': undefined,
                    'mutable-content': 1,
                    'target-content-id': undefined,
                    'interruption-level': undefined,
                    'relevance-score': undefined,
                    'filter-criteria': undefined,
                    'stale-date': undefined,
                    'content-state': undefined,
                    'timestamp': undefined,
                    'event': undefined,
                    'dimissal-date': undefined,
                    'attributes-type': undefined,
                    'attributes': undefined,
                },
                // ExtParams
                'group': group,
                'call': call,
                'isarchive': isArchive,
                'icon': icon,
                'ciphertext': ciphertext,
                'level': level,
                'volume': volume,
                'url': url,
                'copy': copy,
                'badge': badge,
                'autocopy': autoCopy,
                'action': action,
                'iv': iv,
                'image': image,
                'id': id,
                'delete': _delete,
                'markdown': markdown,
                'ttl': ttl,
            }

            const headers = {
                'apns-topic': undefined,
                'apns-id': undefined,
                'apns-collapse-id': id,
                'apns-priority': undefined,
                'apns-expiration': undefined,
                'apns-push-type': (_delete) ? 'background' : 'alert',
            }

            const apns = new APNs(db, options.apns)
            const response = await apns.push(deviceToken, headers, aps, timeoutMs)

            if (response.status === 200) {
                return new Response(JSON.stringify({
                    'code': 200,
                    'message': 'success',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            } else {
                let message
                const responseText = await response.text()

                try {
                    message = JSON.parse(responseText).reason
                } catch (err) {
                    message = responseText
                }

                if ((response.status === 410) || ((response.status === 400) && (message.includes('BadDeviceToken')))) {
                    await db.saveDeviceTokenByKey(parameters.device_key, '')
                }

                return new Response(JSON.stringify({
                    'code': response.status,
                    'message': `push failed: ${message}`,
                    'timestamp': util.getTimestamp(),
                }), {
                    status: response.status,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }
        }

        this.mcp = async (request, deviceKey) => {
            if (request.method === 'GET') return createMcpEventStream(request)

            if (request.method === 'DELETE') {
                const sessionId = request.headers.get('mcp-session-id')
                if (sessionId) {
                    await db.deleteSessionBySessionID(sessionId)
                }
                return new Response(null, {
                    status: 200
                })
            }

            if (request.method !== 'POST') {
                return new Response('Method not allowed', {
                    status: 405,
                    headers: {
                        'content-type': 'text/plain; charset=utf-8',
                        'allow': 'GET, POST, DELETE',
                    }
                })
            }

            let body = {}
            try {
                body = await request.json()
            } catch (err) {
                return new Response(JSON.stringify({
                    'jsonrpc': '2.0',
                    'id': null,
                    'error': {
                        'code': -32700,
                        'message': 'request body is not valid json',
                    }
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            const {
                jsonrpc,
                id,
                method,
                params,
            } = body

            if (jsonrpc !== '2.0') {
                return new Response(JSON.stringify({
                    'jsonrpc': '2.0',
                    'id': id || null,
                    'error': {
                        'code': -32600,
                        'message': 'Invalid Request',
                    }
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            switch (method) {
                case 'initialize': {
                    const sessionId = await util.newMCPSessionUUID()
                    await db.saveSessionBySessionID(sessionId, deviceKey, true, null)

                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id,
                        'result': {
                            'protocolVersion': '2025-03-26',
                            'capabilities': {
                                'tools': {
                                    'listChanged': true,
                                },
                            },
                            'serverInfo': {
                                name: deviceKey ? 'Bark MCP Server (Specific)' : 'Bark MCP Server',
                                version: this.version,
                            },
                            'instructions': 'Send, schedule, and cancel notifications ONLY when the user explicitly requests it. Do not notify merely because work completed or failed. Never automatically retry an unknown send outcome. Display scheduled times in the user\'s timezone.',
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                            'mcp-session-id': sessionId,
                        }
                    })
                }
                case 'notifications/initialized': {
                    const sessionId = request.headers.get('mcp-session-id')
                    const session = await db.sessionBySessionID(sessionId)
                    
                    if (!session) {
                        return new Response(null, {
                            status: 400
                        })
                    }
                    
                    await db.saveSessionBySessionID(session.id, session.device_key, true, undefined)

                    return new Response(null, {
                        status: 202
                    })
                }
                case 'tools/list': {
                    const sessionId = request.headers.get('mcp-session-id')
                    const session = await db.sessionBySessionID(sessionId)
                    
                    if (!session) {
                        return new Response('Invalid session ID', {
                            status: 400,
                            headers: {
                                'content-type': 'text/plain',
                            }
                        })
                    }

                    await db.saveSessionBySessionID(session.id, session.device_key, true, undefined)

                    if (deviceKey && deviceKey !== session.device_key) return new Response('Session belongs to another device', { status: 400 })
                    return Response.json({ jsonrpc: '2.0', id, result: { tools: listMcpTools(session.device_key) } })
                }
                case 'tools/call': {
                    const sessionId = request.headers.get('mcp-session-id')
                    const session = await db.sessionBySessionID(sessionId)
                    if (!session || (deviceKey && deviceKey !== session.device_key)) return new Response('Invalid session ID', { status: 400 })
                    await db.saveSessionBySessionID(session.id, session.device_key, true, undefined)
                    const { name, arguments: args = {} } = params || {}
                    if (!listMcpTools(session.device_key).some(tool => tool.name === name)) {
                        return Response.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Tool not found' } })
                    }
                    const result = await callMcpTool(name, args, session.device_key, {
                        database: db,
                        reminders: options.reminders,
                        push: parameters => this.push(parameters, { timeoutMs: 15000 }),
                    })
                    return Response.json({ jsonrpc: '2.0', id, result })
                }
                default: {
                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id || null,
                        'error': {
                            'code': -32601,
                            'message': `Method not found: ${method}`,
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }
            }
        }
    }
}

class APNs {
    constructor(db, credentials = {}) {
        const generateAuthToken = async () => {
            const TOKEN_KEY = credentials.APNS_PRIVATE_KEY
            const TEAM_ID = credentials.APNS_TEAM_ID
            const AUTH_KEY_ID = credentials.APNS_KEY_ID
            if (!TOKEN_KEY || !TEAM_ID || !AUTH_KEY_ID) throw new Error('Configure APNS_PRIVATE_KEY, APNS_TEAM_ID, and APNS_KEY_ID as Worker secrets')

            // Parse private key
            const privateKeyPEM = TOKEN_KEY.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
            // Decode private key
            const privateKeyArrayBuffer = util.base64ToArrayBuffer(privateKeyPEM)
            const privateKey = await crypto.subtle.importKey('pkcs8', privateKeyArrayBuffer, { name: 'ECDSA', namedCurve: 'P-256', }, false, ['sign'])
            // Generate the JWT token
            const JWT_ISSUE_TIME = util.getTimestamp()
            const JWT_HEADER = btoa(JSON.stringify({ alg: 'ES256', kid: AUTH_KEY_ID })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
            const JWT_CLAIMS = btoa(JSON.stringify({ iss: TEAM_ID, iat: JWT_ISSUE_TIME })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
            const JWT_HEADER_CLAIMS = JWT_HEADER + '.' + JWT_CLAIMS
            // Sign
            const jwtArray = new TextEncoder().encode(JWT_HEADER_CLAIMS)
            const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, jwtArray)
            const signatureArray = new Uint8Array(signature)
            const JWT_SIGNED_HEADER_CLAIMS = btoa(String.fromCharCode(...signatureArray)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
            const AUTHENTICATION_TOKEN = JWT_HEADER_CLAIMS + '.' + JWT_SIGNED_HEADER_CLAIMS

            return AUTHENTICATION_TOKEN
        }

        const getAuthToken = async () => {
            let authToken = await db.authorizationToken()

            if (authToken) {
                return await authToken
            }

            authToken = await generateAuthToken()
            await db.saveAuthorizationToken(authToken)

            return authToken
        }

        this.push = async (deviceToken, headers, aps, timeoutMs) => {
            const TOPIC = 'me.fin.bark'
            const APNS_HOST_NAME = 'api.push.apple.com'
            const AUTHENTICATION_TOKEN = await getAuthToken()

            return await fetch(`https://${APNS_HOST_NAME}/3/device/${deviceToken}`, {
                method: 'POST',
                headers: JSON.parse(JSON.stringify({
                    'apns-topic': headers['apns-topic'] || TOPIC,
                    'apns-id': headers['apns-id'] || undefined,
                    'apns-collapse-id': headers['apns-collapse-id'] || undefined,
                    'apns-priority': (headers['apns-priority'] > 0) ? headers['apns-priority'] : undefined,
                    'apns-expiration': headers['apns-expiration'] || util.getTimestamp() + 86400,
                    'apns-push-type': headers['apns-push-type'] || 'alert',
                    'authorization': `bearer ${AUTHENTICATION_TOKEN}`,
                    'content-type': 'application/json',
                })),
                body: JSON.stringify(aps),
                signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
            })
        }
    }
}

let cachedAuthToken = {}
let cachedDeviceToken = {}
let cachedMCPSession = {}

class Database {
    constructor(env) {
        const db = env.database

        db.exec('CREATE TABLE IF NOT EXISTS `devices` (`id` INTEGER PRIMARY KEY, `key` VARCHAR(255) NOT NULL, `token` VARCHAR(255) NOT NULL, UNIQUE (`key`))')
        db.exec('CREATE TABLE IF NOT EXISTS `authorization` (`id` INTEGER PRIMARY KEY, `token` VARCHAR(255) NOT NULL, `time` VARCHAR(255) NOT NULL)')
        db.exec('CREATE TABLE IF NOT EXISTS `sessions` (`id` VARCHAR(64) PRIMARY KEY, `device_key` VARCHAR(255), `initialized` INTEGER DEFAULT 0, `created_at` INTEGER NOT NULL, `last_seen` INTEGER NOT NULL)')

        this.countAll = async () => {
            const query = 'SELECT COUNT(*) as rowCount FROM `devices`'
            const result = await db.prepare(query).run()

            return (result.results[0] || { 'rowCount': -1 }).rowCount
        }

        this.deviceTokenByKey = async (key) => {
            const device_key = (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_'

            if (device_key && cachedDeviceToken[device_key]) {
                return cachedDeviceToken[device_key]
            }

            const query = 'SELECT `token` FROM `devices` WHERE `key` = ?'
            const result = await db.prepare(query).bind(device_key).run()

            if (result.results.length > 0) {
                cachedDeviceToken[device_key] = result.results[0].token

                return result.results[0].token
            }
            
            return undefined
        }

        this.saveDeviceTokenByKey = async (key, token) => {
            const device_token = (token || '').replace(/[^a-z0-9]/g, '') || ''
            const query = 'INSERT INTO `devices` (`key`, `token`) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET `token` = EXCLUDED.`token`'
            const result = await db.prepare(query).bind(key, device_token).run()

            if (device_token === '') {
                delete cachedDeviceToken[key]
            } else {
                cachedDeviceToken[key] = device_token
            }

            return result
        }

        this.deleteDeviceByKey = async (key) => {
            const device_key = (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_'
            const query = 'DELETE FROM `devices` WHERE `key` = ?'
            const result = await db.prepare(query).bind(device_key).run()

            delete cachedDeviceToken[device_key]

            return result
        }

        this.saveAuthorizationToken = async (token) => {
            const timestamp = util.getTimestamp()
            const query = 'INSERT INTO `authorization` (`id`, `token`, `time`) VALUES (1, ?, ?) ON CONFLICT(`id`) DO UPDATE SET `token` = EXCLUDED.`token`,`time` = EXCLUDED.`time`'
            const result = await db.prepare(query).bind(token, timestamp).run()

            cachedAuthToken = {
                'token': token,
                'timestamp': timestamp,
            }

            return result
        }

        this.authorizationToken = async () => {
            if (cachedAuthToken && (util.getTimestamp() - cachedAuthToken.timestamp < 3000)) {
                return cachedAuthToken.token
            }

            const query = 'SELECT `token`, `time` FROM `authorization` WHERE `id` = 1'
            const result = await db.prepare(query).run()

            if (result.results.length > 0) {
                const tokenTime = parseInt(result.results[0].time)

                if (util.getTimestamp() - tokenTime <= 3000) {
                    cachedAuthToken = {
                        'token': result.results[0].token,
                        'timestamp': tokenTime,
                    }

                    return result.results[0].token
                }
            }

            return undefined
        }

        this.sessionBySessionID = async (sessionId) => {
            const timestamp = util.getTimestamp()

            if (sessionId && cachedMCPSession[sessionId]) {
                const session = cachedMCPSession[sessionId]
                if (session.last_seen > timestamp - 3600 && session.created_at > timestamp - 86400) {
                    return session
                } else {
                    delete cachedMCPSession[sessionId]
                }
            }

            const query = 'SELECT `id`, `device_key`, `initialized`, `created_at`, `last_seen` FROM `sessions` WHERE `id` = ? AND `last_seen` > ? AND `created_at` > ?'
            const result = await db.prepare(query).bind(sessionId, timestamp - 3600, timestamp - 86400).run()

            if (result.results.length > 0) {
                cachedMCPSession[sessionId] = result.results[0]

                return result.results[0]
            }

            return undefined
        }

        this.saveSessionBySessionID = async (sessionId, deviceKey, initialized, lastSeen) => {
            const timestamp = util.getTimestamp()
            const query = 'INSERT INTO `sessions` (`id`, `device_key`, `initialized`, `created_at`, `last_seen`) VALUES (?, ?, ?, ?, ?) ON CONFLICT(`id`) DO UPDATE SET `initialized` = EXCLUDED.`initialized`, `last_seen` = EXCLUDED.`last_seen`'
            const result = await db.prepare(query).bind(sessionId, deviceKey || null, initialized ? 1 : 0, timestamp, lastSeen ?? timestamp).run()

            if (cachedMCPSession[sessionId]) {
                cachedMCPSession[sessionId].initialized = initialized ? 1 : 0
                cachedMCPSession[sessionId].last_seen = lastSeen ?? timestamp
            } else {
                cachedMCPSession[sessionId] = {
                    id: sessionId,
                    device_key: deviceKey || null,
                    initialized: initialized ? 1 : 0,
                    created_at: timestamp,
                    last_seen: lastSeen ?? timestamp
                }
            }

            return result
        }

        this.deleteSessionBySessionID = async (sessionId) => {
            const query = 'DELETE FROM `sessions` WHERE `id` = ?'
            const result = await db.prepare(query).bind(sessionId).run()

            delete cachedMCPSession[sessionId]

            return result
        }

        this.cleanupExpiredSessions = async () => {
            const timestamp = util.getTimestamp()

            const query = 'DELETE FROM `sessions` WHERE `last_seen` < ? OR `created_at` < ?'
            const result = await db.prepare(query).bind(timestamp - 3600, timestamp - 86400).run()

            for (const id in cachedMCPSession) {
                const session = cachedMCPSession[id]
                if (session.last_seen < timestamp - 3600 || session.created_at < timestamp - 86400) {
                    delete cachedMCPSession[id]
                }
            }

            return result
        }
    }
}

class Util {
    constructor() {
        this.getTimestamp = () => {
            return Math.floor(Date.now() / 1000)
        }

        this.base64ToArrayBuffer = (base64) => {
            const binaryString = atob(base64)
            const length = binaryString.length
            const buffer = new Uint8Array(length)
            for (let i = 0; i < length; i++) {
                buffer[i] = binaryString.charCodeAt(i)
            }
            return buffer
        }

        this.newShortUUID = async () => {
            const uuid = crypto.randomUUID()
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uuid))
            const hashArray = Array.from(new Uint8Array(hashBuffer))

            return btoa(String.fromCharCode(...hashArray)).replace(/[^a-zA-Z0-9]|[lIO01]/g, '').slice(0, 22)
        }

        this.newMCPSessionUUID = async () => {
            const uuid = crypto.randomUUID()
            
            return `mcp-session-${uuid}`
        }

        const constantTimeCompare = (a, b) => {
            if (typeof a !== 'string' || typeof b !== 'string') { return false }
            if (a.length !== b.length) { return false }
            let result = 0
            for (let i = 0; i < a.length; i++) {
                result |= a.charCodeAt(i) ^ b.charCodeAt(i)
            }
            return result === 0
        }

        this.validateBasicAuth = (request, basicAuth) => {
            if (basicAuth) {
                const authHeader = request.headers.get('Authorization')
                if (typeof authHeader !== 'string' || !authHeader.startsWith('Basic ')) { return false }
                const received = authHeader.slice(6) // Remove 'Basic ' prefix
                const expected = btoa(`${basicAuth}`)
                return constantTimeCompare(received, expected)
            }
            return true
        }
    }
}

const util = new Util()


// Called only through the Worker binding; this is not an extra public HTTP route.
export class ReminderScheduler {
    constructor(ctx, env) {
        const handler = new Handler(new Database(env), { apns: env })
        this.queue = new ReminderQueue(ctx.storage, parameters => handler.push(parameters, { timeoutMs: 15000 }))
        this.ready = ctx.blockConcurrencyWhile(async () => this.queue.initialize())
    }

    async fetch(request) {
        await this.ready
        try {
            const args = await request.json()
            if (args.operation === 'notify') return Response.json(await this.queue.schedule(args.device_key, args.parameters, args.send_at))
            if (args.operation === 'list_scheduled_notifications') return Response.json(this.queue.list(args))
            if (args.operation === 'cancel_scheduled_notification') return Response.json(await this.queue.cancel(args.task_id))
            return Response.json({ error: 'Unknown reminder operation' }, { status: 400 })
        } catch (error) {
            return Response.json({ error: error instanceof ToolInputError ? error.message : 'Reminder operation failed' }, { status: 400 })
        }
    }

    async alarm() {
        await this.ready
        await this.queue.runDue()
    }
}
