import { createReadStream } from 'node:fs'
import { join } from 'node:path'

/**
 * GET /c/:slug/slide/:n?lang=en — the baked image of slide n.
 * `lang` picks a translated deck; missing translation falls back to the course's own language.
 * Immutable: the URL carries the deck hash, so a changed deck means a new URL.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const n = Number(getRouterParam(event, 'n'))
  const { lang } = getQuery(event) as { lang?: string }

  const course = await loadCourse(slug)
  if (!course?.manifest) throw createError({ statusCode: 404, statusMessage: `no such course: ${slug}` })

  const variant = variantFor(course.manifest, String(lang || course.manifest.baseLang))
  const name = variant.images[n - 1]
  if (!Number.isInteger(n) || !name) {
    throw createError({ statusCode: 404, statusMessage: `slide ${n} is out of range` })
  }

  setResponseHeaders(event, {
    'content-type': 'image/jpeg',
    'cache-control': 'public, max-age=31536000, immutable',
  })
  return sendStream(event, createReadStream(join(course.dir, variant.dir, name)))
})
