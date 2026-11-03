export class ToolInputError extends Error {}

export const notificationFields = {
    title: { type: 'string', description: 'Notification title' },
    subtitle: { type: 'string', description: 'Notification subtitle' },
    body: { type: 'string', description: 'Notification content' },
    markdown: { type: 'string', description: 'Markdown content, overrides body' },
    level: { type: 'string', enum: ['critical', 'active', 'timeSensitive', 'passive'] },
    volume: { type: 'number', minimum: 0, maximum: 10 },
    badge: { type: 'integer', minimum: 0 },
    call: { type: 'string', enum: ['0', '1'], description: "Use '1' only if the user explicitly requests repeated ringing" },
    sound: { type: 'string' },
    icon: { type: 'string' },
    image: { type: 'string' },
    group: { type: 'string' },
    isArchive: { type: 'string', enum: ['0', '1'] },
    ttl: { type: 'integer', minimum: 1, description: 'Archive lifetime in seconds; not a send delay. No default.' },
    url: { type: 'string' },
    copy: { type: 'string' },
}

const authorization = { type: 'boolean', const: true, description: 'Must be true: the user explicitly requested this send, schedule, or cancellation' }

export function listMcpTools(boundDevice) {
    const device = boundDevice ? {} : { device_key: { type: 'string', description: 'Bark device key' } }
    const requiredDevice = boundDevice ? [] : ['device_key']
    const schema = (properties, required) => ({ type: 'object', properties: { ...device, ...properties }, required: [...requiredDevice, ...required], additionalProperties: false })
    return [
        {
            name: 'notify',
            description: 'Send or schedule a Bark notification ONLY when the user explicitly requests it. Task completion alone is not permission. Omit send_at or use null to send now. Use a future ISO timestamp with timezone to schedule; show the user the scheduled local time. Do not retry an unknown outcome automatically.',
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
            inputSchema: schema({
                ...notificationFields,
                user_requested: authorization,
                send_at: { type: ['string', 'null'], description: 'Future ISO 8601 date/time with timezone, e.g. 2027-01-01T15:30:00+08:00; omitted/null sends now' },
            }, ['user_requested']),
        },
        {
            name: 'list_scheduled_notifications',
            description: 'List this device key\'s scheduled reminders. By default returns pending/sending only; include_completed also returns finished records (kept for 30 days). Times are ISO UTC. Does not send notifications.',
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
            inputSchema: schema({
                include_completed: { type: 'boolean', default: false },
                limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
                offset: { type: 'integer', minimum: 0, default: 0 },
            }, []),
        },
        {
            name: 'cancel_scheduled_notification',
            description: 'Cancel a pending reminder ONLY when the user explicitly requests cancellation. Sending/finished notifications cannot be recalled. Repeated cancellation is safe.',
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
            inputSchema: schema({ task_id: { type: 'string', format: 'uuid' }, user_requested: authorization }, ['task_id', 'user_requested']),
        },
    ]
}

export function parseSendAt(value, now = Date.now()) {
    if (value === undefined || value === null) return null
    const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    if (!match) throw new ToolInputError('send_at must be a future ISO timestamp with a date and timezone, or null')
    const [, year, month, day, hour, minute, second, zone] = match
    const y = Number(year), m = Number(month), d = Number(day)
    const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    const invalidZone = zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)
    const time = Date.parse(value)
    if (!y || m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || invalidZone || !Number.isFinite(time) || time <= now) {
        throw new ToolInputError('send_at must be a valid future date/time with timezone')
    }
    return time
}

export function validateToolArgs(name, args, boundDevice) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolInputError('arguments must be an object')
    const tool = listMcpTools(boundDevice).find(tool => tool.name === name)
    if (!tool) throw new ToolInputError('Unknown tool')
    const { properties, required } = tool.inputSchema
    for (const field of required) if (!(field in args)) throw new ToolInputError(`${field} is required`)
    for (const [field, value] of Object.entries(args)) {
        const spec = properties[field]
        if (!spec) throw new ToolInputError(`Unsupported parameter: ${field.slice(0, 60)}`)
        const types = Array.isArray(spec.type) ? spec.type : [spec.type]
        const type = value === null ? 'null' : typeof value
        if (!types.includes(type) && !(spec.type === 'integer' && Number.isInteger(value))) throw new ToolInputError(`Invalid parameter type: ${field}`)
        if ((typeof value === 'number' && !Number.isFinite(value)) || (spec.type === 'integer' && !Number.isInteger(value))) throw new ToolInputError(`Invalid number: ${field}`)
        if (spec.const !== undefined && value !== spec.const) throw new ToolInputError(`${field} must be true`)
        if (spec.enum && !spec.enum.includes(value)) throw new ToolInputError(`Invalid value: ${field}`)
        if (typeof value === 'number' && ((spec.minimum !== undefined && value < spec.minimum) || (spec.maximum !== undefined && value > spec.maximum))) throw new ToolInputError(`Out of range: ${field}`)
    }
    if (name === 'notify') {
        if (!['title', 'subtitle', 'body', 'markdown'].some(field => args[field]?.trim())) throw new ToolInputError('Provide title, subtitle, body, or markdown')
        if (args.volume !== undefined && args.level !== 'critical') throw new ToolInputError('volume requires level=critical')
        if (args.ttl !== undefined && args.isArchive === '0') throw new ToolInputError('ttl requires archiving')
        if (new TextEncoder().encode(JSON.stringify(args)).length > 16384) throw new ToolInputError('Notification arguments exceed 16 KiB')
    }
    if (name === 'cancel_scheduled_notification' && !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(args.task_id)) throw new ToolInputError('task_id must be a UUID')
}

export async function pushOutcome(push, parameters) {
    try {
        const response = await push(parameters)
        if (response.status === 200) return { status: 'accepted', message: 'Bark accepted the notification; phone delivery is not confirmed' }
        return { status: 'rejected', http_status: response.status, message: 'Bark rejected the notification' }
    } catch {
        // Never echo provider errors: they can contain device keys/tokens or request URLs.
        return { status: 'unknown', message: 'The send outcome is uncertain; check the phone before manually retrying' }
    }
}

export const toolResult = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data })
export const toolError = message => ({ content: [{ type: 'text', text: message }], isError: true })

export async function callMcpTool(name, args, boundDevice, { database, reminders, push }) {
    try {
        validateToolArgs(name, args, boundDevice)
        const key = boundDevice || args.device_key
        if (typeof key !== 'string' || !/^[a-zA-Z0-9]{1,255}$/.test(key)) throw new ToolInputError('Invalid device_key')
        if (!await database.deviceTokenByKey(key)) throw new ToolInputError('Device is not registered')
        const sendAt = name === 'notify' ? parseSendAt(args.send_at) : null
        const parameters = Object.fromEntries(Object.keys(notificationFields).filter(field => args[field] !== undefined).map(field => [field.toLowerCase(), args[field]]))
        if (name === 'notify' && sendAt === null) {
            const outcome = await pushOutcome(push, { ...parameters, device_key: key })
            return { ...toolResult(outcome), ...(outcome.status !== 'accepted' ? { isError: true } : {}) }
        }
        if (!reminders) throw new ToolInputError('Cloud reminders are not configured: deploy the REMINDERS Durable Object binding')
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
        const objectName = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
        const stub = reminders.get(reminders.idFromName(objectName))
        const response = await stub.fetch('https://reminders.internal/', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ operation: name, device_key: key, parameters, send_at: sendAt, task_id: args.task_id, include_completed: args.include_completed, limit: args.limit, offset: args.offset }),
        })
        const result = await response.json()
        if (!response.ok) return toolError(result.error || 'Reminder operation failed')
        return toolResult(result)
    } catch (error) {
        return toolError(error instanceof ToolInputError ? error.message : 'MCP operation failed; no automatic resend was attempted')
    }
}
