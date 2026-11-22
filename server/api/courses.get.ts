import { matchesQuery } from '#shared/course'

/**
 * GET /api/courses?q=…&locale=sr
 * The catalogue for the home page. Decks number in the dozens: the page loads it once
 * and filters instantly client-side; `q` exists so the same logic is testable server-side.
 */
export default defineEventHandler(async (event) => {
  const { q = '', locale = 'sr' } = getQuery(event) as { q?: string; locale?: string }
  const courses = await listCourses()

  return courses
    .map((c) => toListEntry(c, locale))
    .filter((c) => matchesQuery(q, [c.title, c.description, c.slug, ...c.tags]))
})
