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
  score: number | null
  total: number | null
  passed: boolean | null
  certId: string | null
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
    score: row.score == null ? null : Number(row.score),
    total: row.total == null ? null : Number(row.total),
    passed: row.passed == null ? null : Number(row.passed) === 1,
    certId: row.cert_id == null ? null : String(row.cert_id),
  }
}

/** The learner's current (unfinished) attempt, created on first visit. */
export function findOpenAttempt(slug: string, sid: string): Attempt | null {
  const row = getDb()
    .prepare('SELECT * FROM attempts WHERE slug = ? AND sid = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .get(slug, sid) as Record<string, unknown> | undefined
  return row ? rowToAttempt(row) : null
}

export function currentAttempt(event: H3Event, slug: string, lang: string): Attempt {
  const sid = sessionId(event)
  const open = findOpenAttempt(slug, sid)
  if (open) return open

  const conn = getDb()
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  conn
    .prepare('INSERT INTO attempts (id, slug, sid, lang, started_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, slug, sid, lang, startedAt)

  return {
    id, slug, sid, name: null, startedAt, finishedAt: null,
    score: null, total: null, passed: null, certId: null,
  }
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

/** The most recent finished attempt for this browser, if any. */
export function latestFinished(slug: string, sid: string): Attempt | null {
  const row = getDb()
    .prepare('SELECT * FROM attempts WHERE slug = ? AND sid = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1')
    .get(slug, sid) as Record<string, unknown> | undefined
  return row ? rowToAttempt(row) : null
}

/** Freezes the score. Returns the stored attempt; a second call is a no-op. */
export function finalizeAttempt(
  attempt: Attempt,
  grade: { score: number, total: number, passed: boolean },
): Attempt {
  const finishedAt = new Date().toISOString()
  getDb()
    .prepare('UPDATE attempts SET finished_at = ?, score = ?, total = ?, passed = ? WHERE id = ? AND finished_at IS NULL')
    .run(finishedAt, grade.score, grade.total, grade.passed ? 1 : 0, attempt.id)

  return {
    ...attempt,
    finishedAt,
    score: grade.score,
    total: grade.total,
    passed: grade.passed,
  }
}

/** Attaches the learner's name and the certificate id; both are immutable afterwards. */
export function attachCertificate(attemptId: string, name: string, certId: string): void {
  getDb()
    .prepare('UPDATE attempts SET name = COALESCE(name, ?), cert_id = COALESCE(cert_id, ?) WHERE id = ?')
    .run(name, certId, attemptId)
}

/** Public lookup: the certificate id is the only key the document itself carries. */
export function attemptByCertId(certId: string): (Attempt & { courseLang: string | null }) | null {
  const row = getDb()
    .prepare('SELECT * FROM attempts WHERE cert_id = ? LIMIT 1')
    .get(certId) as Record<string, unknown> | undefined
  if (!row) return null
  return { ...rowToAttempt(row), courseLang: (row.lang as string) ?? null }
}
