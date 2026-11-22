import { describe, expect, it } from 'vitest'
import { setup, fetch } from '@nuxt/test-utils/e2e'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const COURSE = 'bezbedno-koriscenje'
const courseDir = join(process.cwd(), 'courses', COURSE)

interface StoredQuestion { n: number, skip?: boolean, answer?: number }

/** The answer key, read straight from the course folder — the test is allowed to know it. */
const questions = JSON.parse(readFileSync(join(courseDir, 'questions.json'), 'utf8'))
  .slides as StoredQuestion[]
const answerKey = new Map(
  questions.filter((q) => q.skip !== true).map((q) => [q.n, q.answer!] as const),
)
const questionSlides = [...answerKey.keys()]

/** Any key named `answer` anywhere in a payload is a design failure. */
function findKey(value: unknown, key: string, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKey(v, key, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(k === key ? [`${path}.${k}`] : []),
      ...findKey(v, key, `${path}.${k}`),
    ])
  }
  return []
}

/** One browser: cookies threaded by hand, because that is exactly what the site relies on. */
function newSession() {
  let cookie = ''
  return async function request(path: string, init: RequestInit = {}) {
    const res = await fetch(path, {
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string> | undefined) },
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]!
    return res
  }
}

type Session = ReturnType<typeof newSession>

const getJson = async <T>(s: Session, path: string) => (await (await s(path)).json()) as T
const postJson = (s: Session, path: string, body: unknown) => s(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function answerAll(s: Session, right: boolean) {
  for (const n of questionSlides) {
    const correct = answerKey.get(n)!
    const choice = right ? correct : (correct + 1) % 4
    const res = await postJson(s, `/api/c/${COURSE}/answer`, { n, choice })
    expect(res.status).toBe(200)
  }
}

interface Report {
  score: number
  total: number
  percent: number
  passMark: number
  passed: boolean
  certificate: { serial: string, verifyId: string } | null
  items: Array<{ n: number, chosen: number, correct: boolean, why?: string }>
}

describe('player api', async () => {
  await setup({
    server: true,
    build: true,
    env: {
      // keep test attempts out of the real database
      DATA_DIR: mkdtempSync(join(tmpdir(), 'slide-course-test-')),
      COURSE_ROOT: join(process.cwd(), 'courses'),
    },
  })

  const learner = newSession()

  it('serves a slide with exactly four options and no answer', async () => {
    const slide = await getJson<{
      n: number
      question: { q: string, options: string[] } | null
      answered: number | null
      slideCount: number
    }>(learner, `/api/c/${COURSE}/slide/2`)

    expect(slide.n).toBe(2)
    expect(slide.question?.options).toHaveLength(4)
    expect(slide.answered).toBeNull()
    expect(slide.slideCount).toBeGreaterThan(10)
    expect(findKey(slide, 'answer')).toEqual([])
    expect(findKey(slide, 'why')).toEqual([])
  })

  it('does not expose the answer in the rendered page', async () => {
    const html = await (await learner(`/c/${COURSE}/2`)).text()
    expect(html).toContain('fajl sistem') // an option is visible…
    expect(html).not.toContain('Ključni pojmovi časa su lični podaci') // …the explanation is not
    expect(html).not.toMatch(/"answer"\s*:/)
    expect(html).not.toMatch(/"why"\s*:/)
  })

  it('locks an answer on the server: the second attempt is a 409', async () => {
    expect((await postJson(learner, `/api/c/${COURSE}/answer`, { n: 3, choice: 2 })).status).toBe(200)
    expect((await postJson(learner, `/api/c/${COURSE}/answer`, { n: 3, choice: 0 })).status).toBe(409)
  })

  it('remembers the answer for the same session', async () => {
    const slide = await getJson<{ answered: number | null }>(learner, `/api/c/${COURSE}/slide/3`)
    expect(slide.answered).toBe(2)
  })

  it('rejects an answer for a slide that has no question, and out-of-range choices', async () => {
    expect((await postJson(learner, `/api/c/${COURSE}/answer`, { n: 1, choice: 0 })).status).toBe(422)
    expect((await postJson(learner, `/api/c/${COURSE}/answer`, { n: 4, choice: 7 })).status).toBe(422)
  })

  it('serves the slide image as immutable jpeg', async () => {
    const res = await learner(`/c/${COURSE}/slide/2`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toContain('immutable')
    const bytes = new Uint8Array((await res.arrayBuffer()).slice(0, 2))
    expect([...bytes]).toEqual([0xff, 0xd8]) // JPEG magic
  })

  it('offers the pptx as a download', async () => {
    const res = await learner(`/c/${COURSE}/slides.pptx`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('presentationml')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const bytes = new Uint8Array((await res.arrayBuffer()).slice(0, 2))
    expect([...bytes]).toEqual([0x50, 0x4b]) // zip magic
  })

  it('404s on an unknown course and an out-of-range slide', async () => {
    expect((await learner('/api/c/nope/slide/1')).status).toBe(404)
    expect((await learner(`/api/c/${COURSE}/slide/999`)).status).toBe(404)
  })

  it('lists the course in the catalogue with its slide count', async () => {
    const list = await getJson<Array<{ slug: string, slideCount: number, hasPptx: boolean }>>(learner, '/api/courses')
    const course = list.find((c) => c.slug === COURSE)
    expect(course).toBeDefined()
    expect(course!.slideCount).toBe(15)
    expect(course!.hasPptx).toBe(true)
  })

  it('serves translated decks per language', async () => {
    const zh = await getJson<{ deckLang: string, langs: string[], image: string, question: { options: string[] } }>(
      learner,
      `/api/c/${COURSE}/slide/2?locale=zh-CN`,
    )
    expect(zh.deckLang).toBe('zh-CN')
    expect(zh.langs).toEqual(expect.arrayContaining(['sr', 'en', 'zh-CN']))
    expect(zh.image).toContain('lang=zh-CN')
    expect(zh.question.options.join(' ')).toContain('文件系统')

    // the three image sets really are different renders of the same slide
    const sizes = []
    for (const lang of ['sr', 'en', 'zh-CN']) {
      const res = await learner(`/c/${COURSE}/slide/2?lang=${lang}`)
      expect(res.status).toBe(200)
      sizes.push((await res.arrayBuffer()).byteLength)
    }
    expect(new Set(sizes).size).toBe(3)

    // …and so are the downloadable decks
    const en = await learner(`/c/${COURSE}/slides.pptx?lang=en`)
    expect(en.headers.get('content-disposition')).toContain('en.pptx')
    const bytes = new Uint8Array((await en.arrayBuffer()).slice(0, 2))
    expect([...bytes]).toEqual([0x50, 0x4b])
  })

  it('409s on the report while questions are still unanswered', async () => {
    const res = await learner(`/api/c/${COURSE}/report`)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { data: { nextSlide: number } }
    expect(body.data.nextSlide).toBeGreaterThan(1)
  })

  it('a failed attempt: wrong answers marked, but no explanation and no correct option', async () => {
    const s = newSession()
    await answerAll(s, false)

    const report = await getJson<Report>(s, `/api/c/${COURSE}/report`)
    expect(report.passed).toBe(false)
    expect(report.score).toBe(0)
    expect(report.percent).toBe(0)
    expect(report.passMark).toBe(Math.ceil(report.total * 0.9))
    expect(report.items.every((i) => i.correct === false)).toBe(true)
    expect(report.items.every((i) => i.why === undefined)).toBe(true)
    expect(findKey(report, 'answer')).toEqual([])

    // …and no certificate can be issued for it
    const cert = await postJson(s, `/api/c/${COURSE}/certificate`, { name: 'Neko Drugi' })
    expect(cert.status).toBe(403)
  })

  it('a passed attempt: explanations are shown, still no answer key', async () => {
    const s = newSession()
    await answerAll(s, true)

    const report = await getJson<Report>(s, `/api/c/${COURSE}/report`)
    expect(report.passed).toBe(true)
    expect(report.score).toBe(report.total)
    expect(report.percent).toBe(100)
    expect(report.items.every((i) => i.correct)).toBe(true)
    expect(report.items.every((i) => typeof i.why === 'string' && i.why!.length > 0)).toBe(true)
    expect(findKey(report, 'answer')).toEqual([])

    // idempotent: reloading the report neither rescores nor duplicates
    const again = await getJson<Report>(s, `/api/c/${COURSE}/report`)
    expect(again.score).toBe(report.score)
    expect(again.certificate).toBeNull()
  })

  it('issues a certificate with a tracking number, and only its holder can download the pdf', async () => {
    const s = newSession()
    await answerAll(s, true)
    await s(`/api/c/${COURSE}/report`)

    const cert = await $fetchCert(s, `/api/c/${COURSE}/certificate`, { name: 'Đorđe Petrović' })
    // sequential, human-readable tracking number + unguessable document key
    expect(cert.serial).toMatch(/^SC-\d{4}-\d{6}$/)
    expect(cert.verifyId).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/)
    expect(cert.pdf).toBe(`/certificate/${cert.verifyId}`)
    expect(cert.verify).toBe(`/verify/${cert.serial}`)

    // the learner's own session can download it…
    const pdf = await s(cert.pdf)
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(pdf.headers.get('content-disposition')).toContain(`certificate-${cert.serial}.pdf`)
    const bytes = Buffer.from(await pdf.arrayBuffer())
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(2000)

    // …nobody else can, even with the exact document key
    const anon = newSession()
    expect((await anon(cert.pdf)).status).toBe(404)

    // verification is public and works by tracking number or by document key
    const verified = await getJson<{ valid: boolean, name: string, score: number, serial: string, signatureOk: boolean }>(
      anon,
      `/api/verify/${cert.serial}`,
    )
    expect(verified.valid).toBe(true)
    expect(verified.signatureOk).toBe(true)
    expect(verified.serial).toBe(cert.serial)
    expect(verified.name).toBe('Đorđe Petrović')
    expect(verified.score).toBe(questionSlides.length)
    expect((await getJson<{ serial: string }>(anon, `/api/verify/${cert.verifyId}`)).serial).toBe(cert.serial)

    expect((await anon('/api/verify/SC-2026-999999')).status).toBe(404)
    expect((await anon('/certificate/0000-0000-0000-0000-0000-0000')).status).toBe(404)
  })

  it('keeps one serial per attempt and refuses to rename an issued certificate', async () => {
    const s = newSession()
    await answerAll(s, true)
    await s(`/api/c/${COURSE}/report`)

    const first = await $fetchCert(s, `/api/c/${COURSE}/certificate`, { name: 'Ana Anić' })
    const again = await $fetchCert(s, `/api/c/${COURSE}/certificate`, { name: 'Ana Anić' })
    expect(again.serial).toBe(first.serial) // no second tracking number for the same attempt
    expect(again.verifyId).toBe(first.verifyId)

    // a certificate cannot be "re-issued" to somebody else
    expect((await postJson(s, `/api/c/${COURSE}/certificate`, { name: 'Neko Treći' })).status).toBe(409)

    // and serials never repeat across learners
    const other = newSession()
    await answerAll(other, true)
    await other(`/api/c/${COURSE}/report`)
    const second = await $fetchCert(other, `/api/c/${COURSE}/certificate`, { name: 'Marko Marković' })
    expect(second.serial).not.toBe(first.serial)
    expect(second.verifyId).not.toBe(first.verifyId)
  })

  it('rejects a too-short name and an unfinished attempt', async () => {
    const s = newSession()
    await answerAll(s, true)
    expect((await postJson(s, `/api/c/${COURSE}/certificate`, { name: 'X' })).status).toBe(422)

    const fresh = newSession()
    expect((await postJson(fresh, `/api/c/${COURSE}/certificate`, { name: 'Ana Anić' })).status).toBe(409)
  })
})

interface IssuedCertificate {
  serial: string
  verifyId: string
  name: string
  issuedAt: string
  pdf: string
  verify: string
}

async function $fetchCert(s: Session, path: string, body: unknown): Promise<IssuedCertificate> {
  const res = await postJson(s, path, body)
  expect(res.status).toBe(200)
  return (await res.json()) as IssuedCertificate
}
