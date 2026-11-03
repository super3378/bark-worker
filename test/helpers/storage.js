import { DatabaseSync } from 'node:sqlite'

// Exercise production SQL against SQLite, including transactional alarm state.
export class TestStorage {
    constructor(path = ':memory:') {
        this.db = new DatabaseSync(path)
        this.db.exec('CREATE TABLE IF NOT EXISTS test_alarm(id INTEGER PRIMARY KEY,time INTEGER)')
        this.sql = { exec: (query, ...bindings) => {
            if (query.trim().startsWith('CREATE')) { this.db.exec(query); return [] }
            return this.db.prepare(query).all(...bindings)
        } }
        this.tail = Promise.resolve()
    }

    async transaction(callback) {
        const run = this.tail.then(async () => {
            this.db.exec('BEGIN')
            try { const result = await callback(this); this.db.exec('COMMIT'); return result }
            catch (error) { this.db.exec('ROLLBACK'); throw error }
        })
        this.tail = run.catch(() => {})
        return run
    }

    async setAlarm(time) { this.sql.exec('INSERT INTO test_alarm VALUES(1,?) ON CONFLICT(id) DO UPDATE SET time=excluded.time', time) }
    async deleteAlarm() { this.sql.exec('DELETE FROM test_alarm') }
    async getAlarm() { return this.sql.exec('SELECT time FROM test_alarm')[0]?.time ?? null }
    close() { this.db.close() }
}
