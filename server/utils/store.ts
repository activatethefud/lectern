import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { H3Event } from 'h3'

/**
 * Attempts live server-side only: the browser gets an opaque session cookie and never a score.
 * `node:sqlite` is built into Node 22+, so the runtime image stays free of native modules.
 */
let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  const dir = resolve(process.cwd(), useRuntimeConfig().dataDir)
  mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(join(dir, 'course.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS attempts (
      id          TEXT PRIMARY KEY,
      slug        TEXT NOT NULL,
      sid         TEXT NOT NULL,
      name        TEXT,
      lang        TEXT,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      score       INTEGER,
      total       INTEGER,
      passed      INTEGER,
      cert_id     TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS answers (
      attempt_id  TEXT NOT NULL,
      n           INTEGER NOT NULL,
      choice      INTEGER NOT NULL,
      answered_at TEXT NOT NULL,
      PRIMARY KEY (attempt_id, n)
    );
    CREATE INDEX IF NOT EXISTS attempts_slug_sid ON attempts (slug, sid, started_at);
  `)
  return db
}

export interface Attempt {
  id: string
  slug: string
  sid: string
  name: string | null
  startedAt: string
  finishedAt: string | null
}

const SID_COOKIE = 'sid'

/** Per-browser identity: no accounts, no password, one random cookie. */
export function sessionId(event: H3Event): string {
  const existing = getCookie(event, SID_COOKIE)
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing

  const sid = randomBytes(16).toString('hex')
  setCookie(event, SID_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  })
  return sid
}

function rowToAttempt(row: Record<string, unknown>): Attempt {
  return {
    id: String(row.id),
    slug: String(row.slug),
    sid: String(row.sid),
    name: row.name == null ? null : String(row.name),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at == null ? null : String(row.finished_at),
  }
}

/** The learner's current (unfinished) attempt for a course, created on first visit. */
export function currentAttempt(event: H3Event, slug: string, lang: string): Attempt {
  const sid = sessionId(event)
  const conn = getDb()

  const open = conn
    .prepare('SELECT * FROM attempts WHERE slug = ? AND sid = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .get(slug, sid) as Record<string, unknown> | undefined
  if (open) return rowToAttempt(open)

  const id = randomUUID()
  conn
    .prepare('INSERT INTO attempts (id, slug, sid, lang, started_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, slug, sid, lang, new Date().toISOString())

  return { id, slug, sid, name: null, startedAt: new Date().toISOString(), finishedAt: null }
}

export function answersOf(attemptId: string): Record<number, number> {
  const rows = getDb()
    .prepare('SELECT n, choice FROM answers WHERE attempt_id = ?')
    .all(attemptId) as Array<{ n: number; choice: number }>

  return Object.fromEntries(rows.map((r) => [Number(r.n), Number(r.choice)]))
}

/** Answers are final. The second call for the same slide is rejected by the primary key. */
export function recordAnswer(attemptId: string, n: number, choice: number): void {
  getDb()
    .prepare('INSERT INTO answers (attempt_id, n, choice, answered_at) VALUES (?, ?, ?, ?)')
    .run(attemptId, n, choice, new Date().toISOString())
}

export function restartAttempt(event: H3Event, slug: string, lang: string): Attempt {
  const sid = sessionId(event)
  getDb()
    .prepare('DELETE FROM attempts WHERE slug = ? AND sid = ? AND finished_at IS NULL')
    .run(slug, sid)
  return currentAttempt(event, slug, lang)
}
