/**
 * POST /api/c/:slug/answer  { n, choice }
 *
 * Records the answer and answers nothing else — no correctness, no score, no explanation.
 * A second answer for the same slide is a 409: the client may render "locked", the server
 * enforces it.
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

  const attempt = currentAttempt(event, slug, lang)
  const existing = answersOf(attempt.id)[n]
  if (existing !== undefined) {
    throw createError({ statusCode: 409, statusMessage: `slide ${n} is already answered` })
  }

  recordAnswer(attempt.id, n, choice)
  return { ok: true, n, choice }
})
