import { pickLocalized } from '#shared/course'

/**
 * GET /certificate/:verifyId — the PDF, addressed by its unguessable document key.
 *
 * Only the session that earned the certificate may download it: the id is enough to *verify*
 * (that is `/verify/:serial`, public), but not to obtain somebody else's document. Certificates
 * are therefore not transferable by passing a link around.
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').replace(/\.pdf$/i, '').toUpperCase()
  const locale = String((getQuery(event) as { locale?: string }).locale ?? 'sr')

  const certificate = certificateByAnyId(id)
  // 404 for unknown id *and* for the wrong session: an attacker learns nothing by probing.
  if (!certificate || certificate.revokedAt || certificate.verifyId !== id) {
    throw createError({ statusCode: 404, statusMessage: 'unknown certificate' })
  }
  if (certificate.sid !== sessionId(event)) {
    throw createError({ statusCode: 404, statusMessage: 'unknown certificate' })
  }

  const course = await loadCourse(certificate.slug)
  if (!course) throw createError({ statusCode: 404, statusMessage: 'unknown course' })

  const signatureOk = signatureMatches({
    serial: certificate.serial,
    verifyId: certificate.verifyId,
    name: certificate.name,
    slug: certificate.slug,
    score: certificate.score,
    total: certificate.total,
    issuedAt: certificate.issuedAt,
  }, certificate.signature)

  const pdf = await renderCertificate({
    name: certificate.name,
    courseTitle: pickLocalized(course.meta.title, locale, course.meta.lang),
    finishedAt: certificate.issuedAt,
    score: certificate.score,
    total: certificate.total,
    percent: certificate.total ? Math.round((1000 * certificate.score) / certificate.total) / 10 : 0,
    serial: certificate.serial,
    signature: signatureOk ? certificate.signature : 'INVALID',
    verifyUrl: `${getRequestProtocol(event)}://${getRequestHost(event)}/verify/${certificate.serial}`,
    locale,
  })

  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="certificate-${certificate.serial}.pdf"`,
    'content-length': pdf.length,
    'cache-control': 'private, max-age=0, must-revalidate',
  })
  return pdf
})
