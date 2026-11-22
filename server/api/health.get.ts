/**
 * GET /api/health — used by the Docker HEALTHCHECK and by uptime checks.
 * Deliberately cheap: counts course folders, does not touch the DB.
 */
export default defineEventHandler(async () => {
  const courses = await listCourses()
  return {
    ok: true,
    courses: courses.filter((c) => c.manifest !== null).length,
    uptime: Math.round(process.uptime()),
  }
})
