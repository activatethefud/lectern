// Shared between client and server (Nuxt auto-imports `shared/` in both).

export type Localized = string | Record<string, string>

export interface CourseListEntry {
  slug: string
  title: string
  description: string
  tags: string[]
  /** language the deck itself is written in */
  lang: string
  slideCount: number
  /** true when slides.pptx exists — the download icon is rendered from this */
  hasPptx: boolean
  pptxBytes: number
}

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i',
  ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's',
  // neighbours' letters, so a mixed-script query still matches
  ё: 'e', ѕ: 's', і: 'i', ї: 'i', ў: 'u', ю: 'ju', я: 'ja', ы: 'y', э: 'e',
}

/**
 * Search folding: case-, diacritic- and script-insensitive.
 * `ciscenje` matches `Čišćenje` and `чишћење`; `podaci` matches `Podaci`.
 */
export function fold(input: string): string {
  return input
    .toLowerCase()
    .replace(/đ/g, 'd') // Đ/đ has no canonical decomposition, unlike č/ć/š/ž
    .replace(/[\u0400-\u04ff]/g, (ch) => CYR_TO_LAT[ch] ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents: č ć š ž → c c s z
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim()
}

export function matchesQuery(query: string, fields: Array<string | undefined>): boolean {
  const q = fold(query)
  if (!q) return true
  const terms = q.split(' ').filter(Boolean)
  const hay = fold(fields.filter(Boolean).join(' '))
  return terms.every((term) => hay.includes(term))
}

/** Pick a locale from a `string | {sr, en, zh-CN}` value: requested → course lang → en. */
export function pickLocalized(value: Localized | undefined, locale: string, courseLang = 'en'): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return value[locale] ?? value[courseLang] ?? value.en ?? Object.values(value)[0] ?? ''
}
