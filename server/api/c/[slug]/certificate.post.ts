import { pickLocalized } from '#shared/course'

/**
 * POST /api/c/:slug/certificate  { name }
 *
 * Issues the certificate for a passed attempt: a sequential tracking number (printed), a random
 * document key (only the learner's session may download the PDF with it), and an HMAC signature
 * over the printed fields.
 *
 * Idempotent per attempt: submitting again returns the same serial. The name is frozen at issue.
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

  const sid = sessionId(event)
  const attempt = latestFinished(slug, sid)
  if (!attempt) throw createError({ statusCode: 409, statusMessage: 'no finished attempt' })
  if (!attempt.passed) throw createError({ statusCode: 403, statusMessage: 'the attempt was not passed' })
  if (attempt.name && attempt.name !== name) {
    throw createError({ statusCode: 409, statusMessage: 'this certificate was already issued to another name' })
  }

  const certificate = issueCertificate({
    attemptId: attempt.id,
    slug,
    sid,
    name,
    score: attempt.score ?? 0,
    total: attempt.total ?? 0,
    passed: true,
    issuedAt: attempt.finishedAt ?? new Date().toISOString(),
    verifyId: newVerifyId(),
    buildSerial: formatSerial,
    sign: signCertificate,
  })

  attachCertificate(attempt.id, certificate.name, certificate.serial)

  return {
    serial: certificate.serial,
    verifyId: certificate.verifyId,
    name: certificate.name,
    issuedAt: certificate.issuedAt,
    pdf: `/certificate/${certificate.verifyId}`,
    verify: `/verify/${certificate.serial}`,
  }
})
