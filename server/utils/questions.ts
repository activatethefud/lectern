import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { pickLocalized, type Localized } from '#shared/course'

/** A question exactly as it is stored on disk. `answer`/`why` must never leave the server early. */
export interface StoredQuestion {
  n: number
  q: Localized
  options: Localized[]
  answer: number
  why?: Localized
}

export interface AnswerableQuestion {
  n: number
  q: string
  options: string[]
}

export function toAnswerable(q: StoredQuestion, locale: string, courseLang: string): AnswerableQuestion {
  return {
    n: q.n,
    q: pickLocalized(q.q, locale, courseLang),
    options: q.options.map((o) => pickLocalized(o, locale, courseLang)),
  }
}

/**
 * Loads and validates `questions.json` for a course.
 * Throws on anything that would make the course inconsistent with its deck — a course whose
 * question for slide 7 is actually about slide 6 is worse than a course that refuses to load.
 */
export async function loadQuestions(dir: string, slug: string, slideCount: number) {
  const file = join(dir, 'questions.json')
  if (!existsSync(file)) {
    throw createError({ statusCode: 500, statusMessage: `${slug}: questions.json is missing` })
  }

  const raw = JSON.parse(await readFile(file, 'utf8')) as { slides?: StoredQuestion[] }
  const entries = raw.slides
  if (!Array.isArray(entries)) {
    throw createError({ statusCode: 500, statusMessage: `${slug}: questions.json has no "slides" array` })
  }

  const problems: string[] = []
  const byNumber = new Map<number, StoredQuestion>()

  for (const entry of entries) {
    if (!Number.isInteger(entry?.n)) {
      problems.push('an entry has no integer "n"')
      continue
    }
    if (byNumber.has(entry.n)) problems.push(`slide ${entry.n} appears twice`)
    byNumber.set(entry.n, entry)
  }

  for (let n = 1; n <= slideCount; n++) {
    if (!byNumber.has(n)) problems.push(`no entry for slide ${n}`)
  }
  for (const n of byNumber.keys()) {
    if (n < 1 || n > slideCount) problems.push(`entry ${n} is outside the deck (${slideCount} slides)`)
  }

  for (const [n, entry] of byNumber) {
    if (entry.skip === true) continue
    if (!Array.isArray(entry.options) || entry.options.length !== 4) problems.push(`slide ${n}: needs 4 options`)
    if (!Number.isInteger(entry.answer) || entry.answer < 0 || entry.answer > 3) problems.push(`slide ${n}: "answer" must be 0..3`)
    const options = (entry.options ?? []).map((o) => pickLocalized(o, 'sr'))
    if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) {
      problems.push(`slide ${n}: options are not distinct`)
    }
  }

  if (problems.length) {
    throw createError({
      statusCode: 500,
      statusMessage: `${slug}: questions.json — ${problems.slice(0, 5).join('; ')}`,
    })
  }

  const answerable = [...byNumber.values()]
    .filter((q) => q.skip !== true)
    .sort((a, b) => a.n - b.n)

  return {
    total: answerable.length,
    questionSlides: answerable.map((q) => q.n),
    byNumber: new Map(answerable.map((q) => [q.n, q])),
  }
}
