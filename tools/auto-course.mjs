#!/usr/bin/env node
/**
 * Turn a .pptx deck into a Lectern course folder.
 *
 *   node tools/auto-course.mjs <deck.pptx> --slug <slug> --grade 5 --order 11 [--lang sr]
 *
 * Produces, in `courses/<slug>/`:
 *   slides.pptx                    the deck
 *   course.json                    title/description in sr, en, zh-CN (model-written) + tags
 *   questions.json                  one 4-option question per content slide, in three languages
 *   translation/en.json            run-by-run translation of the deck (layout preserved)
 *   translation/zh-CN.json
 *   slides.en.pptx, slides.zh-CN.pptx  via tools/translate-deck.mjs apply
 *
 * Needs an OpenRouter key: `OPENROUTER_API_KEY`, or `~/openrouter_key.txt`.
 * Baked images are *not* produced here — run `npm run bake <slug>` afterwards.
 *
 * The model drafts; this script enforces the invariants (numbering, four distinct options,
 * answer range, same number of translation runs) and retries once before giving up.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const ROOT = path.resolve(process.env.COURSE_ROOT || 'courses')
const MODEL = process.env.AUTOCOURSE_MODEL || 'openai/gpt-4o-mini'
const RUN = /<a:t>([^<]*)<\/a:t>/g

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name) => args.includes(name)

const deckPath = args.find((a) => a.endsWith('.pptx'))
const slug = flag('--slug')
const grade = flag('--grade')
const order = Number(flag('--order') ?? 100)
const baseLang = flag('--lang') ?? 'sr'
const force = has('--force')
const minQuestions = Number(flag('--min-questions') ?? 6)

if (!deckPath || !slug || !grade) {
  console.error('usage: node tools/auto-course.mjs <deck.pptx> --slug <slug> --grade <n> [--order N] [--force]')
  process.exit(1)
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const apiKey = process.env.OPENROUTER_API_KEY
  ?? (existsSync(`${process.env.HOME}/openrouter_key.txt`)
    ? (await fs.readFile(`${process.env.HOME}/openrouter_key.txt`, 'utf8')).trim()
    : '')
if (!apiKey) throw new Error('no OpenRouter key: set OPENROUTER_API_KEY or ~/openrouter_key.txt')

function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error(`model did not return JSON: ${text.slice(0, 200)}`)
  return JSON.parse(cleaned.slice(start, end + 1))
}

async function llm(prompt, { maxTokens = 6000 } = {}) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(240_000),
  })
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = await res.json()
  return extractJson(body.choices?.[0]?.message?.content ?? '')
}

/** Slide number → every text run, in document order. */
async function readDeck(file) {
  const zip = await JSZip.loadAsync(await fs.readFile(file))
  const names = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]))

  const slides = []
  for (const name of names) {
    const xml = await zip.file(name).async('string')
    const runs = [...xml.matchAll(RUN)].map((m) => unescape(m[1]))

    // paragraphs are the unit a translator can actually handle: runs are often half-sentences
    const paras = []
    for (const block of xml.split('</a:p>')) {
      const paraRuns = [...block.matchAll(RUN)].map((m) => unescape(m[1]))
      if (paraRuns.length) paras.push(paraRuns)
    }

    slides.push({ n: Number(name.match(/(\d+)/)[1]), runs, paras })
  }
  return slides
}

const textOf = (slide) => slide.runs.filter((r) => r.trim()).join(' | ')

function validateQuestions(doc, slideCount) {
  const errors = []
  const meta = doc.meta
  for (const key of ['title', 'description']) {
    if (!meta?.[key]) errors.push(`meta.${key} missing`)
    else for (const l of ['sr', 'en', 'zh-CN']) if (!meta[key][l]) errors.push(`meta.${key}.${l} missing`)
  }
  if (!Array.isArray(meta?.tags)) errors.push('meta.tags missing')

  const slides = doc.slides
  if (!Array.isArray(slides)) return { errors: ['slides missing'] }

  const byN = new Map()
  for (const s of slides) {
    if (!Number.isInteger(s?.n)) { errors.push('entry without integer n'); continue }
    if (byN.has(s.n)) errors.push(`slide ${s.n} twice`)
    byN.set(s.n, s)
  }

  let answered = 0
  for (const s of byN.values()) {
    if (s.skip === true) continue
    answered++
    for (const l of ['sr', 'en', 'zh-CN']) {
      const q = s.q?.[l]?.trim()
      if (!q) errors.push(`slide ${s.n}: q.${l} missing`)
      if (!Array.isArray(s.options) || s.options.length !== 4) { errors.push(`slide ${s.n}: need 4 options`); break }
      const opts = s.options.map((o) => o?.[l]?.trim() ?? '')
      if (opts.some((o) => !o)) errors.push(`slide ${s.n}: empty option in ${l}`)
      if (new Set(opts.map((o) => o.toLowerCase())).size !== 4) errors.push(`slide ${s.n}: duplicates in ${l}`)
      if (!s.why?.[l]?.trim()) errors.push(`slide ${s.n}: why.${l} missing`)
    }
    if (!Number.isInteger(s.answer) || s.answer < 0 || s.answer > 3) errors.push(`slide ${s.n}: answer 0..3`)
  }
  if (answered < minQuestions) errors.push(`only ${answered} answered slides (need ≥ ${minQuestions})`)
  return { errors, answered }
}

function validateTranslations(doc, slides) {
  const errors = []
  const byN = new Map((doc.slides ?? []).map((s) => [s.n, s]))
  for (const slide of slides) {
    const entry = byN.get(slide.n)
    if (!entry) { errors.push(`slide ${slide.n} missing`); continue }
    if (!Array.isArray(entry.dst) || entry.dst.length !== slide.paras.length) {
      errors.push(`slide ${slide.n}: expected ${slide.paras.length} paragraphs, got ${entry.dst?.length ?? 0}`)
    }
  }
  return errors
}

const questionsPrompt = (slides, grade) => `You are writing a 4-option comprehension quiz for one school informatics lesson (Serbian curriculum, grade ${grade}).

For EVERY slide below write at most one question that is answerable from that slide alone.
Skip (mark {"n":N,"skip":true}) slides that are: the title slide, an agenda/goal slide, a quiz-question slide, an answer-key slide, or a homework/thank-you/closing slide.

Hard rules:
- exactly 4 options, all distinct, exactly one correct; "answer" is its 0-based index (0=A,1=B,2=C,3=D)
- distractors must be plausible but clearly wrong according to that slide
- every text field is an object with the same three keys: "sr" (Serbian latin script), "en" (English), "zh-CN" (Simplified Chinese)
- "why" is one short sentence explaining the correct answer, in all three languages
- no question about material that is not on its slide

Also produce metadata: title and description (all three languages) and 4-6 short tags (Serbian, lowercase).

Return JSON only, shaped exactly like this:
{"meta":{"title":{"sr":"...","en":"...","zh-CN":"..."},"description":{"sr":"...","en":"...","zh-CN":"..."},"tags":["informatika","5. razred"]},
 "slides":[{"n":1,"skip":true},{"n":2,"q":{"sr":"...","en":"...","zh-CN":"..."},"options":[{"sr":"...","en":"...","zh-CN":"..."},{"sr":"...","en":"...","zh-CN":"..."},{"sr":"...","en":"...","zh-CN":"..."},{"sr":"...","en":"...","zh-CN":"..."}],"answer":0,"why":{"sr":"...","en":"...","zh-CN":"..."}}]}

Slides (JSON, ${slides.length} of them):
${JSON.stringify(slides.map((s) => ({ n: s.n, text: s.runs })))}`

const translationPrompt = (slides, lang) => `Translate a Serbian school presentation into ${lang === 'zh-CN' ? 'Simplified Chinese (zh-CN)' : 'English'}.

Below is an array of slides; each "paras" array holds that slide's text paragraphs in reading order.
Return an object {"slides":[{"n":1,"dst":[...]}]} where each "dst" is the translation of the corresponding paragraph:
- EXACTLY the same length and order as the source array — never merge, split, drop or add paragraphs
- keep numbers, formulas, passwords, code, product names (Wi-Fi, Paint, Word, PowerPoint) as they are
- keep leading bullets (•) and punctuation style
- empty strings stay empty strings
- translate short labels too; keep the tone of a school lesson
- no notes, no explanations, JSON only

Source slides (${slides.length}):
${JSON.stringify(slides.map((s) => ({ n: s.n, paras: s.paras.map((p) => p.join('')) })))}`

const dir = path.join(ROOT, slug)

async function main() {
  if (existsSync(path.join(dir, 'course.json')) && !force) {
    console.log(`skip ${slug}: course already exists (use --force)`)
    return
  }

  const slides = await readDeck(deckPath)
  const contentSlides = slides.filter((s) => textOf(s).length > 0)
  console.log(`${slug}: ${slides.length} slides, ${contentSlides.length} with text`)

  await fs.mkdir(path.join(dir, 'translation'), { recursive: true })
  await fs.copyFile(deckPath, path.join(dir, 'slides.pptx'))

  // --- questions -----------------------------------------------------------
  let questions
  let lastError = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const doc = await llm(questionsPrompt(contentSlides, grade))
    const { errors, answered } = validateQuestions(doc, slides.length)
    if (errors.length === 0) {
      questions = { doc, answered }
      break
    }
    lastError = errors.slice(0, 6).join('; ')
    console.log(`  questions attempt ${attempt} rejected: ${lastError}`)
  }
  if (!questions) throw new Error(`questions failed: ${lastError}`)

  const meta = questions.doc.meta
  await fs.writeFile(path.join(dir, 'course.json'), `${JSON.stringify({
    slug,
    title: meta.title,
    description: meta.description,
    tags: [...new Set([...(meta.tags ?? []), 'informatika', `${grade}. razred`])],
    lang: baseLang,
    order,
  }, null, 2)}\n`)

  // bake/courses.ts require an entry for every slide: whatever the model omitted becomes "skip"
  const answeredByN = new Map(questions.doc.slides.map((s) => [s.n, s]))
  const allSlides = Array.from({ length: slides.length }, (_, i) => answeredByN.get(i + 1) ?? { n: i + 1, skip: true })

  await fs.writeFile(path.join(dir, 'questions.json'), `${JSON.stringify({ slides: allSlides }, null, 2)}\n`)
  console.log(`  questions: ${questions.answered}`)

  // --- deck translation ----------------------------------------------------
  const { createHash } = await import('node:crypto')
  const deckSha = createHash('sha256').update(await fs.readFile(path.join(dir, 'slides.pptx'))).digest('hex')

  for (const lang of ['en', 'zh-CN']) {
    const source = slides.map((s) => ({ n: s.n, src: s.runs, dst: s.runs.map(() => '') }))
    const file = path.join(dir, 'translation', `${lang}.json`)
    let doc = null

    for (let attempt = 1; attempt <= 2; attempt++) {
      const candidate = await llm(translationPrompt(slides, lang), { maxTokens: 8000 })
      const errors = validateTranslations(candidate, slides)
      if (errors.length === 0) { doc = candidate; break }
      console.log(`  ${lang} attempt ${attempt} rejected: ${errors.slice(0, 4).join('; ')}`)
    }

    if (!doc) {
      // no translation, no variant: the player falls back to the deck's own language
      console.log(`  ${lang}: translation failed — no ${lang} variant`)
      continue
    }

    const byN = new Map(doc.slides.map((s) => [s.n, s.dst]))
    for (const [index, slide] of source.entries()) {
      // one paragraph → one string: the translation goes into the paragraph's first run and the
      // remaining runs are blanked (keepEmpty), which preserves the layout but not per-run styling
      const paraTranslations = byN.get(slide.n) ?? []
      const dst = []
      const paras = slides[index].paras
      for (const [p, para] of paras.entries()) {
        const translated = String(paraTranslations[p] ?? '').trim() || para.join('')
        for (let r = 0; r < para.length; r++) dst.push(r === 0 ? translated : '')
      }
      slide.dst = dst
    }

    await fs.writeFile(file, `${JSON.stringify({ lang, deckSha, keepEmpty: true, slides: source }, null, 2)}\n`)
    execFileSync('node', ['tools/translate-deck.mjs', 'apply', slug, lang], { cwd: process.cwd(), stdio: 'inherit' })
  }

  console.log(`${slug}: done → npm run bake ${slug}`)
}

main().catch((err) => {
  console.error(`${slug}: ${err.stack ?? err.message}`)
  process.exit(1)
})
