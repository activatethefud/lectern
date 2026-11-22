import { pickLocalized } from '#shared/course'

/**
 * GET /certificate/:id — the PDF itself, addressed by certificate id only.
 * Anybody holding the id can download it (that is what makes the certificate shareable);
 * `/verify/:id` is the authoritative check.
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').replace(/\.pdf$/i, '').toUpperCase()
  const locale = String((getQuery(event) as { locale?: string }).locale ?? 'sr')

  const attempt = attemptByCertId(id)
  if (!attempt || !attempt.passed || !attempt.finishedAt || !attempt.name) {
    throw createError({ statusCode: 404, statusMessage: 'unknown certificate' })
  }

  const course = await loadCourse(attempt.slug)
  if (!course) throw createError({ statusCode: 404, statusMessage: 'unknown course' })

  const pdf = await renderCertificate({
    name: attempt.name,
    courseTitle: pickLocalized(course.meta.title, locale, course.meta.lang),
    finishedAt: attempt.finishedAt,
    score: attempt.score ?? 0,
    total: attempt.total ?? 0,
    percent: attempt.total ? Math.round((1000 * (attempt.score ?? 0)) / attempt.total) / 10 : 0,
    certId: attempt.certId!,
    verifyUrl: `${getRequestProtocol(event)}://${getRequestHost(event)}/verify/${attempt.certId}`,
    locale,
  })

  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="certificate-${attempt.certId}.pdf"`,
    'content-length': String(pdf.length),
    'cache-control': 'private, max-age=0, must-revalidate',
  })
  return pdf
})
