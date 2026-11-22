import { createReadStream } from 'node:fs'
import { join } from 'node:path'

/**
 * GET /c/:slug/slides.pptx?lang=zh-CN — the deck as a download, translated when available.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { lang } = getQuery(event) as { lang?: string }

  const course = await loadCourse(slug)
  if (!course?.hasPptx || !course.manifest) {
    throw createError({ statusCode: 404, statusMessage: `no presentation for ${slug}` })
  }

  const variant = variantFor(course.manifest, String(lang || course.manifest.baseLang))
  const etag = `"${variant.deckSha}"`
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }

  setResponseHeaders(event, {
    'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'content-disposition': `attachment; filename="${slug}-${course.manifest.baseLang === lang ? 'original' : lang}.pptx"`,
    'etag': etag,
    'cache-control': 'public, max-age=600',
  })
  return sendStream(event, createReadStream(join(course.dir, variant.deck)))
})
