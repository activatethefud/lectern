import { pickLocalized } from '#shared/course'

/**
 * GET /api/verify/:id — public, no session, no login: the certificate id is the whole key.
 * Returns only what is printed on the certificate.
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').replace(/\.pdf$/i, '').toUpperCase()
  const attempt = attemptByCertId(id)
  if (!attempt || !attempt.passed || !attempt.finishedAt) {
    throw createError({ statusCode: 404, statusMessage: 'unknown certificate' })
  }

  const course = await loadCourse(attempt.slug)
  const locale = String((getQuery(event) as { locale?: string }).locale ?? 'sr')

  return {
    valid: true,
    certId: attempt.certId,
    name: attempt.name,
    courseSlug: attempt.slug,
    courseTitle: course ? pickLocalized(course.meta.title, locale, course.meta.lang) : attempt.slug,
    finishedAt: attempt.finishedAt,
    score: attempt.score,
    total: attempt.total,
    passed: attempt.passed,
  }
})
