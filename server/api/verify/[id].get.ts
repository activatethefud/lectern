import { pickLocalized } from '#shared/course'

/**
 * GET /api/verify/:id — public check by tracking number (`SC-2026-000042`) or by document key.
 * Returns only what is printed on the certificate, plus whether the stored signature still
 * matches the stored fields (i.e. the record has not been tampered with).
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').replace(/\.pdf$/i, '').toUpperCase()
  const certificate = certificateByAnyId(id)

  if (!certificate) {
    throw createError({ statusCode: 404, statusMessage: 'unknown certificate' })
  }

  const course = await loadCourse(certificate.slug)
  const locale = String((getQuery(event) as { locale?: string }).locale ?? 'sr')
  const signatureOk = signatureMatches({
    serial: certificate.serial,
    verifyId: certificate.verifyId,
    name: certificate.name,
    slug: certificate.slug,
    score: certificate.score,
    total: certificate.total,
    issuedAt: certificate.issuedAt,
  }, certificate.signature)

  return {
    valid: !certificate.revokedAt && certificate.passed && signatureOk,
    revoked: Boolean(certificate.revokedAt),
    signatureOk,
    serial: certificate.serial,
    name: certificate.name,
    courseSlug: certificate.slug,
    courseTitle: course ? pickLocalized(course.meta.title, locale, course.meta.lang) : certificate.slug,
    finishedAt: certificate.issuedAt,
    score: certificate.score,
    total: certificate.total,
    passed: certificate.passed,
  }
})
