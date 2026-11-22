import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pickLocalized, type CourseListEntry, type Localized } from '#shared/course'

export interface CourseJson {
  slug: string
  title: Localized
  description?: Localized
  tags?: string[]
  lang?: string
  passThreshold?: number
  order?: number
  author?: string
}

export interface Variant {
  /** deck file, e.g. `slides.zh-CN.pptx` */
  deck: string
  deckSha: string
  /** image directory relative to the course folder */
  dir: string
  images: string[]
}

export interface Manifest {
  deckSha: string
  baseLang: string
  slideCount: number
  images: string[]
  variants: Record<string, Variant>
  builtAt: string
}

export interface LoadedCourse {
  dir: string
  meta: CourseJson
  manifest: Manifest | null
  hasPptx: boolean
  pptxBytes: number
}

export function courseRoot(): string {
  return resolve(process.cwd(), useRuntimeConfig().courseRoot)
}

export async function loadCourse(slug: string): Promise<LoadedCourse | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return null
  const dir = join(courseRoot(), slug)
  let meta: CourseJson
  try {
    meta = JSON.parse(await readFile(join(dir, 'course.json'), 'utf8'))
  } catch {
    return null
  }

  let manifest: Manifest | null = null
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  } catch {
    manifest = null // not baked yet — course is listed as "unavailable"
  }

  let hasPptx = false
  let pptxBytes = 0
  try {
    const st = await stat(join(dir, 'slides.pptx'))
    hasPptx = st.isFile()
    pptxBytes = st.size
  } catch { /* no deck */ }

  return { dir, meta: { ...meta, slug }, manifest, hasPptx, pptxBytes }
}

export async function listCourses(): Promise<LoadedCourse[]> {
  let entries: string[]
  try {
    entries = await readdir(courseRoot())
  } catch {
    return [] // no courses directory yet
  }

  const loaded = await Promise.all(
    entries.filter((e) => !e.startsWith('.')).map((e) => loadCourse(e)),
  )

  return loaded
    .filter((c): c is LoadedCourse => c !== null)
    .sort((a, b) => (a.meta.order ?? 1000) - (b.meta.order ?? 1000)
      || String(pickLocalized(a.meta.title, 'en')).localeCompare(String(pickLocalized(b.meta.title, 'en'))))
}

export function toListEntry(c: LoadedCourse, locale: string): CourseListEntry {
  return {
    slug: c.meta.slug,
    title: pickLocalized(c.meta.title, locale, c.meta.lang),
    description: pickLocalized(c.meta.description, locale, c.meta.lang),
    tags: c.meta.tags ?? [],
    lang: c.meta.lang ?? 'sr',
    slideCount: c.manifest?.slideCount ?? 0,
    hasPptx: c.hasPptx,
    pptxBytes: c.pptxBytes,
  }
}

/** Per-course override, else the global 90 % from runtimeConfig. */
export function thresholdOf(course: LoadedCourse): number {
  return course.meta.passThreshold ?? Number(useRuntimeConfig().passThreshold)
}

/**
 * Which deck (and image set) to show for a requested UI language: the translated variant when it
 * exists, otherwise the deck the course was written in.
 */
export function variantFor(manifest: Manifest, lang: string): Variant {
  return manifest.variants[lang] ?? manifest.variants[manifest.baseLang] ?? Object.values(manifest.variants)[0]!
}

export function availableLangs(manifest: Manifest): string[] {
  return Object.keys(manifest.variants)
}
