/**
 * POST /api/c/:slug/certificate  { name }
 *
 * Only for a passed attempt. The name is written once (COALESCE), the certificate id is derived
 * from the attempt itself, and the PDF is regenerated on demand from that id — so a certificate
 * can always be re-downloaded from `/certificate/<id>`.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const body = await readBody<{ name?: unknown }>(event)

  const course = await loadCourse(slug)
  if (!course?.manifest) throw createError({ statusCode: 404, statusMessage: `no such course: ${slug}` })

  const name = String(body?.name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (name.length < 2 || name.length > 60) {
    throw createError({ statusCode: 422, statusMessage: 'name must be 2–60 characters' })
  }

  const attempt = latestFinished(slug, sessionId(event))
  if (!attempt) throw createError({ statusCode: 409, statusMessage: 'no finished attempt' })
  if (!attempt.passed) throw createError({ statusCode: 403, statusMessage: 'the attempt was not passed' })

  const certId = attempt.certId ?? certificateId(attempt.id, slug, attempt.finishedAt!)
  attachCertificate(attempt.id, name, certId)

  return {
    certId,
    name: attempt.name ?? name,
    pdf: `/certificate/${certId}`,
    verify: `/verify/${certId}`,
  }
})
