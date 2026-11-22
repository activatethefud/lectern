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
  const sid = sessionId(event)
  const attempt = latestAttempt(slug, sid)
  const answers = attempt ? answersOf(attempt.id) : {}
  const finished = Boolean(attempt?.finishedAt)
  const nextSlide = finished ? null : (questions.questionSlides.find((n) => answers[n] === undefined) ?? null)
  const last = latestFinished(slug, sid)
  const lastCert = last ? certificateForAttempt(last.id) : null

  return {
    slug,
    title: pickLocalized(course.meta.title, locale, lang),
    description: pickLocalized(course.meta.description, locale, lang),
    tags: course.meta.tags ?? [],
    lang,
    slideCount: course.manifest.slideCount,
    cover: `/c/${slug}/slide/1?lang=${course.manifest.variants[locale] ? locale : course.manifest.baseLang}`,
    deckLang: course.manifest.variants[locale] ? locale : course.manifest.baseLang,
    langs: availableLangs(course.manifest),
    total: questions.total,
    answeredCount: Object.keys(answers).length,
    nextSlide,
    done: nextSlide === null,
    finished,
    hasPptx: course.hasPptx,
    /** a previously finished attempt for this browser, so its certificate stays reachable */
    lastFinished: last
      ? {
          passed: last.passed, score: last.score, total: last.total, finishedAt: last.finishedAt,
          certificate: lastCert ? { serial: lastCert.serial, verifyId: lastCert.verifyId } : null,
        }
      : null,
  }
})
