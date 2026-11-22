#!/usr/bin/env node
/**
 * Bake slide images for every deck of every course.
 *
 *   courses/<slug>/slides.pptx        → slides/001.jpg …        (the course's own language)
 *   courses/<slug>/slides.<lang>.pptx → slides/<lang>/001.jpg …  (translated decks)
 *
 * Writes courses/<slug>/manifest.json. The result is committed and ships to production, so the
 * runtime image never needs LibreOffice.
 *
 *   node scripts/bake-courses.mjs                  # all courses
 *   node scripts/bake-courses.mjs <slug> […]       # only these
 *   node scripts/bake-courses.mjs --force          # ignore the deck hashes
 *   node scripts/bake-courses.mjs --check          # verify only, exit 1 when stale
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

const sha256 = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex')
const exists = async (file) => {
  try { await fs.access(file); return true } catch { return false }
}
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))

/** Localized strings in course.json/questions.json may be `"x"` or `{"sr": "x"}`. */
const text = (value) => (value == null ? '' : typeof value === 'string' ? value : (value.sr ?? Object.values(value)[0] ?? ''))

function validateQuestions(questions, slideCount) {
  const errors = []
  const warnings = []
  if (!questions || !Array.isArray(questions.slides)) {
    return { errors: ['questions.json: missing "slides" array'], warnings, answered: 0 }
  }

  const seen = new Map()
  for (const e of questions.slides) {
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
  for (const e of questions.slides) {
    if (!Number.isInteger(e?.n) || e.skip === true) continue
    answered++
    if (!text(e.q).trim()) errors.push(`slide ${e.n}: empty question`)
    if (!Array.isArray(e.options) || e.options.length !== 4) {
      errors.push(`slide ${e.n}: needs exactly 4 options`)
      continue
    }
    const opts = e.options.map((o) => text(o).trim().toLowerCase())
    if (opts.some((o) => !o)) errors.push(`slide ${e.n}: empty option`)
    if (new Set(opts).size !== 4) errors.push(`slide ${e.n}: options are not all distinct`)
    if (!Number.isInteger(e.answer) || e.answer < 0 || e.answer > 3) errors.push(`slide ${e.n}: "answer" must be 0..3`)
    if (!text(e.why).trim()) warnings.push(`slide ${e.n}: no "why" — nothing to show after a pass`)
  }

  if (answered < 8) warnings.push(`only ${answered} answered slides; a course should have at least 8`)
  if (answered > 0 && Math.ceil(answered * 0.9) === answered) {
    warnings.push(`90 % of ${answered} questions means a perfect score is required — consider more slides`)
  }
  return { errors, warnings, answered }
}

/** `slides.pptx` → the course's own language; `slides.<lang>.pptx` → a translated variant. */
async function decksOf(dir, baseLang) {
  const files = (await fs.readdir(dir)).filter((f) => /^slides(\.[\w-]+)?\.pptx$/.test(f))
  const decks = []
  for (const file of files) {
    const lang = file === 'slides.pptx' ? baseLang : file.slice('slides.'.length, -'.pptx'.length)
    decks.push({ lang, file, isBase: file === 'slides.pptx' })
  }
  // base first, then a stable order
  return decks.sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.lang.localeCompare(b.lang))
}

function convert(deckPath, outDir) {
  execFileSync('soffice', [
    '--headless', '--norestore', '--nologo', '--nofirststartwizard',
    `-env:UserInstallation=file://${path.join(outDir, 'lo-profile')}`,
    '--convert-to', 'pdf', '--outdir', outDir, deckPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 })

  const pdf = path.join(outDir, `${path.basename(deckPath).replace(/\.pptx$/i, '')}.pdf`)
  if (!existsSync(pdf)) throw new BakeError(`LibreOffice produced no PDF for ${deckPath}`)
  return pdf
}

function rasterise(pdfPath, outDir) {
  execFileSync('pdftoppm', [
    '-jpeg', '-jpegopt', `quality=${JPEG_QUALITY}`,
    '-scale-to-x', String(IMAGE_WIDTH), '-scale-to-y', '-1',
    pdfPath, path.join(outDir, 'page'),
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 })
}

async function renderDeck(slug, dir, deck, tmp) {
  const pdf = convert(path.join(dir, deck.file), tmp)
  rasterise(pdf, tmp)
  const pages = (await fs.readdir(tmp)).filter((f) => /^page-\d+\.jpg$/.test(f)).sort()
  if (!pages.length) throw new BakeError(`${slug}: no pages rendered for ${deck.file}`)

  const dirName = deck.isBase ? 'slides' : path.join('slides', deck.lang)
  const imagesDir = path.join(dir, dirName)
  await fs.rm(imagesDir, { recursive: true, force: true })
  await fs.mkdir(imagesDir, { recursive: true })

  const pad = Math.max(3, String(pages.length).length)
  const images = []
  for (const [i, page] of pages.entries()) {
    const name = `${String(i + 1).padStart(pad, '0')}.jpg`
    await fs.copyFile(path.join(tmp, page), path.join(imagesDir, name))
    images.push(name)
  }
  for (const page of pages) await fs.rm(path.join(tmp, page), { force: true })

  return {
    variant: {
      deck: deck.file,
      deckSha: await sha256(path.join(dir, deck.file)),
      dir: dirName.split(path.sep).join('/'),
      images,
    },
    bytes: (await Promise.all(images.map((f) => fs.stat(path.join(imagesDir, f)))))
      .reduce((sum, s) => sum + s.size, 0),
  }
}

async function manifestIsFresh(dir, manifestPath, decks) {
  if (!(await exists(manifestPath))) return null
  const manifest = await readJson(manifestPath)
  if (!manifest.variants) return null
  for (const deck of decks) {
    const variant = manifest.variants[deck.lang]
    if (!variant) return null
    if (variant.deckSha !== (await sha256(path.join(dir, deck.file)))) return null
    if (!variant.images?.length) return null
    for (const image of variant.images) {
      if (!(await exists(path.join(dir, variant.dir, image)))) return null
    }
  }
  return manifest
}

async function bakeCourse(slug) {
  const dir = path.join(ROOT, slug)
  const manifestPath = path.join(dir, 'manifest.json')
  const meta = (await exists(path.join(dir, 'course.json'))) ? await readJson(path.join(dir, 'course.json')) : {}
  const baseLang = meta.lang ?? 'sr'
  const decks = await decksOf(dir, baseLang)
  if (!decks.some((d) => d.isBase)) throw new BakeError(`${slug}: no slides.pptx`)

  const fresh = await manifestIsFresh(dir, manifestPath, decks)

  if (CHECK) {
    if (fresh) {
      console.log(`${c.green('ok')}     ${slug} ${c.dim(`(${fresh.slideCount} slides, ${Object.keys(fresh.variants).join('+')})`)}`)
      return { slug, check: true }
    }
    const problem = (await exists(manifestPath)) ? 'slides are stale — a deck changed since the last bake' : 'not baked yet'
    console.log(`${c.red('FAIL')}   ${slug} ${c.dim(`(${problem})`)}`)
    return { slug, check: false }
  }

  if (fresh && !FORCE) {
    console.log(`${c.dim('skip')}   ${slug} ${c.dim(`(up to date, ${fresh.slideCount} slides, ${Object.keys(fresh.variants).join('+')})`)}`)
    return { slug, skipped: true }
  }

  need('soffice')
  need('pdftoppm')

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `bake-${slug}-`))
  try {
    const variants = {}
    let slideCount = 0
    let bytes = 0

    for (const deck of decks) {
      const rendered = await renderDeck(slug, dir, deck, tmp)
      variants[deck.lang] = rendered.variant
      bytes += rendered.bytes
      if (deck.isBase) slideCount = rendered.variant.images.length
      else if (rendered.variant.images.length !== slideCount) {
        throw new BakeError(
          `${slug}: ${deck.file} has ${rendered.variant.images.length} slides, the base deck has ${slideCount}`,
        )
      }
    }

    // Questions must line up with what we just rendered.
    const qPath = path.join(dir, 'questions.json')
    let validation = { errors: [], warnings: [`${slug}: no questions.json — course cannot be played`], answered: 0 }
    if (await exists(qPath)) validation = validateQuestions(await readJson(qPath), slideCount)
    for (const w of validation.warnings) console.log(`${c.yellow('warn')}   ${slug}: ${w}`)
    if (validation.errors.length) {
      for (const e of validation.errors) console.error(`${c.red('error')}  ${slug}: ${e}`)
      throw new BakeError(`${slug}: questions.json does not match the deck (${slideCount} slides)`)
    }

    const manifest = {
      deckSha: variants[baseLang].deckSha,
      baseLang,
      slideCount,
      answeredSlides: validation.answered,
      images: variants[baseLang].images,
      variants,
      builtAt: new Date().toISOString(),
    }
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    console.log(
      `${c.green('baked')}  ${slug} ${c.dim(
        `${slideCount} slides × ${Object.keys(variants).join('+')}, ${validation.answered} questions, ${(bytes / 1024 / 1024).toFixed(1)} MB`,
      )}`,
    )
    return { slug, slideCount }
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
      console.error(`${c.red('error')}  ${err instanceof BakeError ? err.message : `${slug}: ${err.message}`}`)
    }
  }

  if (CHECK && failures) {
    console.error(`\n${c.red(`${failures} course(s) need re-baking`)} → npm run bake`)
    process.exit(1)
  }
  if (!CHECK && failures) process.exit(1)
  if (CHECK) console.log(`\n${c.green('all courses are baked against their current decks')}`)
}

main().catch((err) => {
  console.error(`${c.red('error')}  ${err.message}`)
  process.exit(1)
})
