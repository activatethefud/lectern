/** POST /api/c/:slug/restart — throws away the open attempt and starts a fresh one. */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const course = await loadCourse(slug)
  if (!course?.manifest) throw createError({ statusCode: 404, statusMessage: `no such course: ${slug}` })

  restartAttempt(event, slug, course.meta.lang ?? 'sr')
  return { ok: true }
})
