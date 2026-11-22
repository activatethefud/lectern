#!/usr/bin/env node
/**
 * Bake slide images for a course folder.
 *
 *   courses/<slug>/slides.pptx  --(soffice)-->  pdf  --(pdftoppm)-->  slides/001.jpg …
 *
 * Writes courses/<slug>/manifest.json and commits happily: the result is a build artifact that
 * ships to production, so the runtime image never needs LibreOffice.
 *
 *   node scripts/bake-courses.mjs                # all courses
 *   node scripts/bake-courses.mjs <slug> [<slug>]  # only these
 *   node scripts/bake-courses.mjs --force        # ignore the deck hash
 *   node scripts/bake-courses.mjs --check        # verify only, exit 1 when stale
 *
 * Output format is JPEG on purpose: poppler is built with or without libwebp depending on the
 * distro, and a course must bake identically on NixOS and in the Docker bake stage.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(process.env.COURSE_ROOT || 'courses')
const IMAGE_WIDTH = 1600
const JPEG_QUALITY = 88

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const FORCE = argv.includes('--force')
const slugs = argv.filter((a) => !a.startsWith('--'))

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
}

class BakeError extends Error {}

function need(cmd) {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
  } catch {
    throw new BakeError(`\`${cmd}\` not found. Run \`./bake\` (dev shell) or \`docker compose run --rm bake\`.`)
  }
}

async function sha256(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

/** Localized strings in course.json/questions.json may be `"x"` or `{"sr": "x"}`. */
function text(value) {
  if (value == null) return ''
  return typeof value === 'string' ? value : (value.sr ?? Object.values(value)[0] ?? '')
}

/**
 * Validate questions.json against the baked slide count. Fatal on structural problems: a course
 * whose questions are off by one slide is worse than no course at all.
 */
function validateQuestions(questions, slideCount, slug) {
  const errors = []
  const warnings = []

  if (!questions || !Array.isArray(questions.slides)) {
    return { errors: ['questions.json: missing "slides" array'], warnings, answered: 0 }
  }

  const entries = questions.slides
  const seen = new Map()
  for (const e of entries) {
    if (!Number.isInteger(e?.n)) { errors.push('an entry has no integer "n"'); continue }
    if (seen.has(e.n)) errors.push(`slide ${e.n} appears twice`)
    seen.set(e.n, e)
  }

  for (let n = 1; n <= slideCount; n++) {
    if (!seen.has(n)) errors.push(`no entry for slide ${n} (deck has ${slideCount} slides)`)
  }
  for (const n of seen.keys()) {
    if (n < 1 || n > slideCount) errors.push(`entry for slide ${n} but the deck has ${slideCount} slides`)
  }

  let answered = 0
  for (const e of entries) {
    if (!Number.isInteger(e?.n)) continue
    if (e.skip === true) continue
    answered++
    const q = text(e.q).trim()
    if (!q) errors.push(`slide ${e.n}: empty question`)

    if (!Array.isArray(e.options) || e.options.length !== 4) {
      errors.push(`slide ${e.n}: needs exactly 4 options, has ${Array.isArray(e.options) ? e.options.length : 'none'}`)
      continue
    }
    const opts = e.options.map((o) => text(o).trim())
    if (opts.some((o) => !o)) errors.push(`slide ${e.n}: empty option`)
    const folded = opts.map((o) => o.toLowerCase())
    if (new Set(folded).size !== 4) errors.push(`slide ${e.n}: options are not all distinct`)

    if (!Number.isInteger(e.answer) || e.answer < 0 || e.answer > 3) {
      errors.push(`slide ${e.n}: "answer" must be 0..3`)
    }
    if (!text(e.why).trim()) warnings.push(`slide ${e.n}: no "why" — nothing to show after a pass`)
  }

  if (answered < 8) {
    warnings.push(`only ${answered} answered slides; a course should have at least 8`)
  }
  if (answered > 0 && Math.ceil(answered * 0.9) === answered) {
    warnings.push(`90 % of ${answered} questions means a perfect score is required — consider more slides`)
  }
  return { errors, warnings, answered }
}

function convert(deckPath, outDir) {
  const profile = path.join(outDir, 'lo-profile')
  execFileSync(
    'soffice',
    [
      '--headless', '--norestore', '--nologo', '--nofirststartwizard',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to', 'pdf',
      '--outdir', outDir,
      deckPath,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 },
  )
  const pdf = path.join(outDir, `${path.basename(deckPath).replace(/\.pptx$/i, '')}.pdf`)
  if (!existsSync(pdf)) throw new BakeError(`LibreOffice produced no PDF for ${deckPath}`)
  return pdf
}

function rasterise(pdfPath, outDir) {
  execFileSync(
    'pdftoppm',
    ['-jpeg', '-jpegopt', `quality=${JPEG_QUALITY}`, '-scale-to-x', String(IMAGE_WIDTH), '-scale-to-y', '-1',
      pdfPath, path.join(outDir, 'page')],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 },
  )
}

async function bakeCourse(slug) {
  const dir = path.join(ROOT, slug)
  const deck = path.join(dir, 'slides.pptx')
  if (!(await exists(deck))) throw new BakeError(`${slug}: no slides.pptx`)

  const deckSha = await sha256(deck)
  const imagesDir = path.join(dir, 'slides')
  const manifestPath = path.join(dir, 'manifest.json')

  // Is the committed bake still the bake of *this* deck, with all its images present?
  let fresh = false
  let old = null
  if (await exists(manifestPath)) {
    old = await readJson(manifestPath)
    const imagesPresent = Array.isArray(old.images)
      && old.images.length > 0
      && (await Promise.all(old.images.map((f) => exists(path.join(imagesDir, f))))).every(Boolean)
    fresh = old.deckSha === deckSha && imagesPresent
  }

  if (CHECK) {
    if (fresh) {
      console.log(`${c.green('ok')}     ${slug} ${c.dim(`(${old.slideCount} slides, baked)`)}`)
      return { slug, check: true, slideCount: old.slideCount }
    }
    const problem = old
      ? 'slides are stale — the deck changed since the last bake'
      : 'not baked yet'
    console.log(`${c.red('FAIL')}   ${slug} ${c.dim(`(${problem})`)}`)
    return { slug, check: false, problem }
  }

  if (fresh && !FORCE) {
    console.log(`${c.dim('skip')}   ${slug} ${c.dim(`(up to date, ${old.slideCount} slides)`)}`)
    return { slug, skipped: true, slideCount: old.slideCount }
  }

  need('soffice')
  need('pdftoppm')

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `bake-${slug}-`))
  try {
    const pdf = convert(deck, tmp)
    rasterise(pdf, tmp)

    const pages = (await fs.readdir(tmp))
      .filter((f) => /^page-\d+\.jpg$/.test(f))
      .sort()
    if (pages.length === 0) throw new BakeError(`${slug}: no pages rendered`)

    await fs.rm(imagesDir, { recursive: true, force: true })
    await fs.mkdir(imagesDir, { recursive: true })

    const pad = Math.max(3, String(pages.length).length)
    const images = []
    for (const [i, page] of pages.entries()) {
      const name = `${String(i + 1).padStart(pad, '0')}.jpg`
      await fs.copyFile(path.join(tmp, page), path.join(imagesDir, name))
      images.push(name)
    }

    // Questions must line up with what we just rendered.
    const qPath = path.join(dir, 'questions.json')
    let validation = { errors: [], warnings: [`${slug}: no questions.json — course cannot be played`], answered: 0 }
    if (await exists(qPath)) {
      validation = validateQuestions(await readJson(qPath), images.length, slug)
    }
    for (const w of validation.warnings) console.log(`${c.yellow('warn')}   ${slug}: ${w}`)
    if (validation.errors.length) {
      for (const e of validation.errors) console.error(`${c.red('error')}  ${slug}: ${e}`)
      throw new BakeError(`${slug}: questions.json does not match the deck (${images.length} slides)`)
    }

    const manifest = {
      deckSha,
      slideCount: images.length,
      answeredSlides: validation.answered,
      images,
      builtAt: new Date().toISOString(),
    }
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const bytes = (await Promise.all(images.map((f) => fs.stat(path.join(imagesDir, f)))))
      .reduce((sum, s) => sum + s.size, 0)
    console.log(
      `${c.green('baked')}  ${slug} ${c.dim(`${images.length} slides, ${validation.answered} questions, ${(bytes / 1024 / 1024).toFixed(1)} MB`)}`,
    )
    return { slug, slideCount: images.length }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

async function main() {
  let dirs
  try {
    dirs = (await fs.readdir(ROOT, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    throw new BakeError(`no courses directory at ${ROOT}`)
  }

  const targets = slugs.length ? slugs : dirs
  const missing = slugs.filter((s) => !dirs.includes(s))
  if (missing.length) throw new BakeError(`unknown course(s): ${missing.join(', ')}`)

  let failures = 0
  for (const slug of targets) {
    try {
      const res = await bakeCourse(slug)
      if (res.check === false) failures++
    } catch (err) {
      failures++
      const msg = err instanceof BakeError ? err.message : `${slug}: ${err.message}`
      console.error(`${c.red('error')}  ${msg}`)
    }
  }

  if (CHECK) {
    if (failures) {
      console.error(`\n${c.red(`${failures} course(s) need re-baking`)} → npm run bake`)
      process.exit(1)
    }
    console.log(`\n${c.green('all courses are baked against their current decks')}`)
  } else if (failures) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`${c.red('error')}  ${err.message}`)
  process.exit(1)
})
