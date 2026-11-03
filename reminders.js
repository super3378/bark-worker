import { pushOutcome, ToolInputError } from './mcp-tools.js'

export const GRACE_MS = 30 * 60 * 1000
export const HISTORY_MS = 30 * 24 * 60 * 60 * 1000
const WATCHDOG_MS = 60 * 1000
const MAX_PENDING = 500

function publicTask(row) {
    return {
        task_id: row.task_id, status: row.status,
        send_at: new Date(row.send_at).toISOString(),
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
        notification: JSON.parse(row.payload),
        ...(row.outcome ? { result: JSON.parse(row.outcome) } : {}),
    }
}

// SQLite-backed Durable Object storage. SQL and alarm updates commit together.
export class ReminderQueue {
    constructor(storage, push, now = () => Date.now()) {
        this.storage = storage
        this.sql = storage.sql
        this.push = push
        this.now = now
    }

    initialize() {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS reminders (
            task_id TEXT PRIMARY KEY, send_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
            started_at INTEGER, outcome TEXT
        ); CREATE INDEX IF NOT EXISTS reminders_due ON reminders(status, send_at);
        CREATE TABLE IF NOT EXISTS reminder_device (id INTEGER PRIMARY KEY CHECK(id=1), device_key TEXT NOT NULL);`)
        // A fresh object instance has no in-flight send. Never retry interrupted sends.
        this.sql.exec("UPDATE reminders SET status='unknown', updated_at=?, outcome=? WHERE status='sending'", this.now(), JSON.stringify({ status: 'unknown', message: 'Execution was interrupted; check the phone before manually retrying' }))
    }

    purgeHistory() {
        this.sql.exec("DELETE FROM reminders WHERE status NOT IN ('pending','sending') AND updated_at < ?", this.now() - HISTORY_MS)
    }

    async armNext() {
        const pending = [...this.sql.exec("SELECT MIN(send_at) AS time FROM reminders WHERE status='pending'")][0]?.time
        const sending = [...this.sql.exec("SELECT MIN(started_at) + ? AS time FROM reminders WHERE status='sending'", WATCHDOG_MS)][0]?.time
        const times = [pending, sending].filter(time => time !== null && time !== undefined)
        if (times.length) await this.storage.setAlarm(Math.max(this.now() + 1, Math.min(...times)))
        else await this.storage.deleteAlarm()
    }

    async schedule(deviceKey, parameters, sendAt) {
        if (!Number.isFinite(sendAt) || sendAt <= this.now()) throw new ToolInputError('Scheduled time must still be in the future')
        const now = this.now()
        // Generate outside a retryable transaction so its retries keep the same identity.
        const id = crypto.randomUUID()
        const task = await this.storage.transaction(async () => {
            this.purgeHistory()
            const count = [...this.sql.exec("SELECT COUNT(*) AS n FROM reminders WHERE status IN ('pending','sending')")][0].n
            if (count >= MAX_PENDING) throw new ToolInputError('This device already has 500 active reminders')
            this.sql.exec('INSERT INTO reminder_device(id,device_key) VALUES(1,?) ON CONFLICT(id) DO NOTHING', deviceKey)
            const storedKey = [...this.sql.exec('SELECT device_key FROM reminder_device WHERE id=1')][0].device_key
            if (storedKey !== deviceKey) throw new ToolInputError('Device mismatch')
            this.sql.exec("INSERT INTO reminders(task_id,send_at,created_at,updated_at,status,payload) VALUES(?,?,?,?,'pending',?)", id, sendAt, now, now, JSON.stringify(parameters))
            await this.armNext()
            return publicTask([...this.sql.exec('SELECT * FROM reminders WHERE task_id=?', id)][0])
        })
        return task
    }

    list({ include_completed = false, limit = 50, offset = 0 } = {}) {
        this.purgeHistory()
        const where = include_completed ? '' : "WHERE status IN ('pending','sending')"
        const total = [...this.sql.exec(`SELECT COUNT(*) AS n FROM reminders ${where}`)][0].n
        const tasks = [...this.sql.exec(`SELECT * FROM reminders ${where} ORDER BY send_at, task_id LIMIT ? OFFSET ?`, limit, offset)].map(publicTask)
        return { tasks, total, limit, offset }
    }

    async cancel(id) {
        return this.storage.transaction(async () => {
            const row = [...this.sql.exec('SELECT * FROM reminders WHERE task_id=?', id)][0]
            if (!row) throw new ToolInputError('Reminder not found for this device')
            if (row.status === 'pending') {
                this.sql.exec("UPDATE reminders SET status='cancelled',updated_at=? WHERE task_id=? AND status='pending'", this.now(), id)
                await this.armNext()
            }
            const task = publicTask([...this.sql.exec('SELECT * FROM reminders WHERE task_id=?', id)][0])
            return { ...task, cancelled: task.status === 'cancelled' }
        })
    }

    async runDue() {
        // Bound each invocation; armNext schedules any remaining work immediately.
        for (let i = 0; i < 10; i++) {
            const row = await this.storage.transaction(async () => {
                this.purgeHistory()
                this.sql.exec("UPDATE reminders SET status='unknown',updated_at=?,outcome=? WHERE status='sending' AND started_at<=?", this.now(), JSON.stringify({ status: 'unknown', message: 'Execution timed out; not automatically retried' }), this.now() - WATCHDOG_MS)
                this.sql.exec("UPDATE reminders SET status='expired',updated_at=? WHERE status='pending' AND send_at<?", this.now(), this.now() - GRACE_MS)
                const next = [...this.sql.exec("SELECT * FROM reminders WHERE status='pending' AND send_at<=? ORDER BY send_at,task_id LIMIT 1", this.now())][0]
                if (next) this.sql.exec("UPDATE reminders SET status='sending',started_at=?,updated_at=? WHERE task_id=? AND status='pending'", this.now(), this.now(), next.task_id)
                await this.armNext()
                return next
            })
            if (!row) return
            const deviceKey = [...this.sql.exec('SELECT device_key FROM reminder_device WHERE id=1')][0].device_key
            // The sending state is committed before making any external request.
            const outcome = await pushOutcome(this.push, { ...JSON.parse(row.payload), device_key: deviceKey })
            await this.storage.transaction(async () => {
                this.sql.exec("UPDATE reminders SET status=?,updated_at=?,outcome=? WHERE task_id=? AND status='sending'", outcome.status, this.now(), JSON.stringify(outcome), row.task_id)
                await this.armNext()
            })
        }
    }
}
