import { pickLocalized } from '#shared/course'

/**
 * GET /api/c/:slug/slide/:n — one slide of the player.
 * Returns the question with its four options and, if it is already answered, which option was
 * chosen. It never returns `answer` or `why`: that is the whole point of grading on the server.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const n = Number(getRouterParam(event, 'n'))
  const { locale = 'sr', lang: requestedLang } = getQuery(event) as { locale?: string, lang?: string }

  const course = await loadCourse(slug)
  if (!course?.manifest) throw createError({ statusCode: 404, statusMessage: `no such course: ${slug}` })

  const { slideCount } = course.manifest
  if (!Number.isInteger(n) || n < 1 || n > slideCount) {
    throw createError({ statusCode: 404, statusMessage: `slide ${n} is out of range (1..${slideCount})` })
  }

  const langs = availableLangs(course.manifest)
  const deckLang = requestedLang && course.manifest.variants[requestedLang]
    ? requestedLang
    : (course.manifest.variants[locale] ? locale : course.manifest.baseLang)
  const variant = variantFor(course.manifest, deckLang)

  const lang = course.meta.lang ?? 'sr'
  const questions = await loadQuestions(course.dir, slug, slideCount)
  const attempt = currentAttempt(event, slug, lang)
  const answers = answersOf(attempt.id)

  const stored = questions.byNumber.get(n)
  const question = stored
    ? {
        n,
        q: pickLocalized(stored.q, locale, lang),
        options: stored.options.map((o) => pickLocalized(o, locale, lang)),
      }
    : null

  return {
    slug,
    n,
    slideCount,
    image: `/c/${slug}/slide/${n}?lang=${deckLang}&v=${variant.deckSha.slice(0, 8)}`,
    deckLang,
    langs,
    question,
    /** the choice this session already locked in, or null */
    answered: answers[n] ?? null,
    total: questions.total,
    answeredCount: Object.keys(answers).length,
    prev: n > 1 ? n - 1 : null,
    next: n < slideCount ? n + 1 : null,
  }
})
