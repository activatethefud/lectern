import { pickLocalized } from '#shared/course'

/**
 * GET /api/c/:slug/report
 *
 * Finalizes the attempt (idempotent — the score is derived from stored answers, never from the
 * client) and returns per-question detail:
 *   • which option the learner chose, and whether it was correct  → green/red in the UI
 *   • `why` only when the attempt passed
 * The correct option is never included in the payload, before or after completion.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { locale = 'sr' } = getQuery(event) as { locale?: string }

  const course = await loadCourse(slug)
  if (!course?.manifest) throw createError({ statusCode: 404, statusMessage: `no such course: ${slug}` })

  const lang = course.meta.lang ?? 'sr'
  const questions = await loadQuestions(course.dir, slug, course.manifest.slideCount)
  const sid = sessionId(event)
  const open = findOpenAttempt(slug, sid)
  let attempt = open

  if (open) {
    // An unfinished attempt means the learner is still playing — even if an older attempt passed.
    const answers = answersOf(open.id)
    const missing = questions.questionSlides.filter((n) => answers[n] === undefined)
    if (missing.length) {
      throw createError({
        statusCode: 409,
        statusMessage: 'the attempt is not finished yet',
        data: { nextSlide: missing[0] },
      })
    }
  } else {
    // Nothing open: show the result of the last finished attempt (reload, or a visit days later).
    attempt = latestFinished(slug, sid)
    if (!attempt) {
      throw createError({
        statusCode: 409,
        statusMessage: 'no attempt yet',
        data: { nextSlide: questions.questionSlides[0] ?? 1 },
      })
    }
  }

  if (!attempt) throw createError({ statusCode: 409, statusMessage: 'no attempt yet', data: { nextSlide: 1 } })

  // Grade from stored answers — the client has never seen `answer`, and it cannot submit a score.
  const stored = answersOf(attempt.id)
  const threshold = thresholdOf(course)
  const grade = gradeAttempt(stored, questions, threshold)
  if (!attempt.finishedAt) attempt = finalizeAttempt(attempt, grade)
  const answersUsed = stored

  const items = questions.questionSlides.map((n) => {
    const q = questions.byNumber.get(n)!
    const chosen = answersUsed[n]!
    return {
      n,
      q: pickLocalized(q.q, locale, lang),
      options: q.options.map((o) => pickLocalized(o, locale, lang)),
      chosen,
      correct: chosen === q.answer,
      ...(grade.passed ? { why: pickLocalized(q.why, locale, lang) } : {}),
    }
  })

  const issued = certificateForAttempt(attempt.id)

  return {
    slug,
    title: pickLocalized(course.meta.title, locale, lang),
    name: attempt.name,
    finishedAt: attempt.finishedAt,
    score: grade.score,
    total: grade.total,
    percent: grade.percent,
    passMark: grade.passMark,
    threshold: grade.threshold,
    passed: grade.passed,
    certificate: issued ? { serial: issued.serial, verifyId: issued.verifyId, issuedAt: issued.issuedAt } : null,
    items,
  }
})
