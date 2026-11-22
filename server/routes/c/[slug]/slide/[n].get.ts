import { createReadStream } from 'node:fs'
import { join } from 'node:path'

/**
 * GET /c/:slug/slide/:n — the baked image for slide n.
 * Immutable: the URL carries the deck hash, so a changed deck means a new URL.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const n = Number(getRouterParam(event, 'n'))

  const course = await loadCourse(slug)
  if (!course?.manifest) throw createError({ statusCode: 404, statusMessage: `no such course: ${slug}` })

  const name = course.manifest.images[n - 1]
  if (!Number.isInteger(n) || !name) {
    throw createError({ statusCode: 404, statusMessage: `slide ${n} is out of range` })
  }

  setResponseHeaders(event, {
    'content-type': 'image/jpeg',
    'cache-control': 'public, max-age=31536000, immutable',
  })
  return sendStream(event, createReadStream(join(course.dir, 'slides', name)))
})
