import { describe, expect, it } from 'vitest'
import { setup, fetch } from '@nuxt/test-utils/e2e'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const COURSE = 'bezbedno-koriscenje'

/** Any key named answer/why anywhere in a payload is a design failure. */
function findLeaks(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findLeaks(v, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(k === 'answer' || k === 'why' ? [`${path}.${k}`] : []),
      ...findLeaks(v, `${path}.${k}`),
    ])
  }
  return []
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

  // One browser: cookies threaded by hand, because that is exactly what the site relies on.
  let cookie = ''
  async function request(path: string, init: RequestInit = {}) {
    const res = await fetch(path, {
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string> | undefined) },
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]!
    return res
  }

  const getJson = async <T>(path: string) => (await (await request(path)).json()) as T
  const postJson = (path: string, body: unknown) => request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  it('serves a slide with exactly four options and no answer', async () => {
    const slide = await getJson<{
      n: number
      question: { q: string, options: string[] } | null
      answered: number | null
      slideCount: number
    }>(`/api/c/${COURSE}/slide/2`)

    expect(slide.n).toBe(2)
    expect(slide.question?.options).toHaveLength(4)
    expect(slide.answered).toBeNull()
    expect(slide.slideCount).toBeGreaterThan(10)
    expect(findLeaks(slide)).toEqual([])
  })

  it('does not expose the answer in the rendered page', async () => {
    const html = await (await request(`/c/${COURSE}/2`)).text()
    expect(html).toContain('fajl sistem') // an option is visible…
    expect(html).not.toContain('Ključni pojmovi časa su lični podaci') // …the explanation is not
    expect(html).not.toMatch(/"answer"\s*:/)
    expect(html).not.toMatch(/"why"\s*:/)
  })

  it('locks an answer on the server: the second attempt is a 409', async () => {
    expect((await postJson(`/api/c/${COURSE}/answer`, { n: 3, choice: 2 })).status).toBe(200)
    expect((await postJson(`/api/c/${COURSE}/answer`, { n: 3, choice: 0 })).status).toBe(409)
  })

  it('remembers the answer for the same session', async () => {
    const slide = await getJson<{ answered: number | null }>(`/api/c/${COURSE}/slide/3`)
    expect(slide.answered).toBe(2)
  })

  it('rejects an answer for a slide that has no question, and out-of-range choices', async () => {
    expect((await postJson(`/api/c/${COURSE}/answer`, { n: 1, choice: 0 })).status).toBe(422)
    expect((await postJson(`/api/c/${COURSE}/answer`, { n: 4, choice: 7 })).status).toBe(422)
  })

  it('serves the slide image as immutable jpeg', async () => {
    const res = await request(`/c/${COURSE}/slide/2`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toContain('immutable')
    const bytes = new Uint8Array((await res.arrayBuffer()).slice(0, 2))
    expect([...bytes]).toEqual([0xff, 0xd8]) // JPEG magic
  })

  it('offers the pptx as a download', async () => {
    const res = await request(`/c/${COURSE}/slides.pptx`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('presentationml')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const bytes = new Uint8Array((await res.arrayBuffer()).slice(0, 2))
    expect([...bytes]).toEqual([0x50, 0x4b]) // zip magic
  })

  it('404s on an unknown course and an out-of-range slide', async () => {
    expect((await request('/api/c/nope/slide/1')).status).toBe(404)
    expect((await request(`/api/c/${COURSE}/slide/999`)).status).toBe(404)
  })

  it('lists the course in the catalogue with its slide count', async () => {
    const list = await getJson<Array<{ slug: string, slideCount: number, hasPptx: boolean }>>('/api/courses')
    const course = list.find((c) => c.slug === COURSE)
    expect(course).toBeDefined()
    expect(course!.slideCount).toBe(15)
    expect(course!.hasPptx).toBe(true)
  })
})
