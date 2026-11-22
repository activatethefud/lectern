import { pickLocalized } from '#shared/course'

/** GET /api/c/:slug — cover data: what the course is, and where the learner left off. */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { locale = 'sr' } = getQuery(event) as { locale?: string }

  const course = await loadCourse(slug)
  if (!course?.manifest) {
    throw createError({ statusCode: 404, statusMessage: `no such course: ${slug}` })
  }

  const lang = course.meta.lang ?? 'sr'
  const questions = await loadQuestions(course.dir, slug, course.manifest.slideCount)
  const attempt = currentAttempt(event, slug, lang)
  const answers = answersOf(attempt.id)
  const nextSlide = questions.questionSlides.find((n) => answers[n] === undefined) ?? null
  const last = latestFinished(slug, attempt.sid)

  return {
    slug,
    title: pickLocalized(course.meta.title, locale, lang),
    description: pickLocalized(course.meta.description, locale, lang),
    tags: course.meta.tags ?? [],
    lang,
    slideCount: course.manifest.slideCount,
    total: questions.total,
    answeredCount: Object.keys(answers).length,
    nextSlide,
    done: nextSlide === null,
    hasPptx: course.hasPptx,
    /** a previously finished attempt for this browser, so its certificate stays reachable */
    lastFinished: last
      ? { passed: last.passed, score: last.score, total: last.total, certId: last.certId, finishedAt: last.finishedAt }
      : null,
  }
})
