import { createReadStream } from 'node:fs'
import { join } from 'node:path'

/** GET /c/:slug/slides.pptx — the original deck, as a download. */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const course = await loadCourse(slug)

  if (!course?.hasPptx) {
    throw createError({ statusCode: 404, statusMessage: `no presentation for ${slug}` })
  }

  const etag = `"${course.manifest?.deckSha ?? 'nobake'}"`
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }

  const filename = `${slug}.pptx`
  setResponseHeaders(event, {
    'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'content-disposition': `attachment; filename="${filename}"`,
    'etag': etag,
    'cache-control': 'public, max-age=600',
  })
  return sendStream(event, createReadStream(join(course.dir, 'slides.pptx')))
})
