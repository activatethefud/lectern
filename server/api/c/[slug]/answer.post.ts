/**
 * POST /api/c/:slug/answer  { n, choice }
 *
 * Records (or replaces) the answer for one slide and answers nothing else — no correctness, no
 * score, no explanation. Answers stay editable until the attempt is finished; only the value
 * stored when the report is generated is graded.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const body = await readBody<{ n?: unknown; choice?: unknown }>(event)

  const course = await loadCourse(slug)
  if (!course?.manifest) throw createError({ statusCode: 404, statusMessage: `no such course: ${slug}` })

  const lang = course.meta.lang ?? 'sr'
  const questions = await loadQuestions(course.dir, slug, course.manifest.slideCount)

  const n = Number(body?.n)
  const choice = Number(body?.choice)
  if (!questions.byNumber.has(n)) {
    throw createError({ statusCode: 422, statusMessage: `slide ${body?.n} has no question` })
  }
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
    throw createError({ statusCode: 422, statusMessage: 'choice must be 0..3' })
  }

  // A finished attempt is closed: its answers are what was graded. Changing them now would mean
  // rewriting a certificate, so the learner starts a retake instead (POST /restart).
  const open = findOpenAttempt(slug, sessionId(event))
  if (!open && latestAttempt(slug, sessionId(event))?.finishedAt) {
    throw createError({ statusCode: 409, statusMessage: 'the attempt is finished — start a retake' })
  }

  const attempt = open ?? currentAttempt(event, slug, lang)
  recordAnswer(attempt.id, n, choice)
  return { ok: true, n, choice, editable: true }
})
