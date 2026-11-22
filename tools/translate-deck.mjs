#!/usr/bin/env node
/**
 * Translate a course deck without touching its layout.
 *
 *   node tools/translate-deck.mjs extract <slug> <lang>
 *   node tools/translate-deck.mjs apply   <slug> <lang>
 *
 * `extract` writes `courses/<slug>/translation/<lang>.json`: every text run of every slide, in
 * document order, with an empty `dst` string to fill in. `apply` writes the filled translations
 * back into a copy of the pptx (`slides.<lang>.pptx`) — same shapes, same positions, same fonts,
 * only `<a:t>` text changes.
 *
 * The file also records the deck hash and the original runs, so a stale translation is caught
 * (edit the deck → extract again) instead of silently translating the wrong slide.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

const ROOT = path.resolve(process.env.COURSE_ROOT || 'courses')
const [mode, slug, lang] = process.argv.slice(2)

if (!['extract', 'apply'].includes(mode ?? '') || !slug || !lang) {
  console.error('usage: node tools/translate-deck.mjs <extract|apply> <slug> <lang>')
  process.exit(1)
}

const dir = path.join(ROOT, slug)
const deck = path.join(dir, 'slides.pptx')
const translationFile = path.join(dir, 'translation', `${lang}.json`)

const RUN = /<a:t>([^<]*)<\/a:t>/g
const EMPTY_RUN = /<a:t\/>/g

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function runsOf(xml) {
  return [...xml.matchAll(RUN)].map((m) => unescapeXml(m[1]))
}

async function slidePaths(zip) {
  return Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]))
}

async function extract() {
  const buf = await fs.readFile(deck)
  const zip = await JSZip.loadAsync(buf)
  const slides = []

  for (const file of await slidePaths(zip)) {
    const xml = await zip.file(file).async('string')
    const runs = runsOf(xml)
    // a slide with no text (image only) still needs an entry, so numbering stays aligned
    slides.push({
      n: Number(file.match(/(\d+)/)[1]),
      src: runs,
      dst: runs.map(() => ''),
    })
  }

  await fs.mkdir(path.dirname(translationFile), { recursive: true })
  const existing = existsSync(translationFile) ? JSON.parse(await fs.readFile(translationFile, 'utf8')) : null

  // keep already-filled translations if the source text is unchanged
  if (existing?.slides?.length === slides.length) {
    for (const slide of slides) {
      const old = existing.slides.find((s) => s.n === slide.n)
      if (old && JSON.stringify(old.src) === JSON.stringify(slide.src)) slide.dst = old.dst
    }
  }

  const out = { lang, deckSha: sha256(buf), slides }
  await fs.writeFile(translationFile, `${JSON.stringify(out, null, 2)}\n`)

  const total = slides.reduce((sum, s) => sum + s.src.length, 0)
  console.log(`extracted ${slides.length} slides, ${total} runs → ${path.relative(ROOT, translationFile)}`)
  console.log('fill in every "dst" (same order, same count), then: apply')
}

async function apply() {
  if (!existsSync(translationFile)) {
    throw new Error(`${translationFile} is missing — run extract first`)
  }
  const translation = JSON.parse(await fs.readFile(translationFile, 'utf8'))
  const buf = await fs.readFile(deck)
  const zip = await JSZip.loadAsync(buf)

  if (translation.deckSha !== sha256(buf)) {
    throw new Error('the deck changed since it was extracted — run extract again (translations are kept)')
  }

  const slides = []
  for (const file of await slidePaths(zip)) {
    const n = Number(file.match(/(\d+)/)[1])
    const entry = translation.slides.find((s) => s.n === n)
    const xml = await zip.file(file).async('string')
    const src = runsOf(xml)

    if (!entry) throw new Error(`slide ${n}: no translation entry`)
    if (entry.src.length !== src.length || JSON.stringify(entry.src) !== JSON.stringify(src)) {
      throw new Error(`slide ${n}: the deck text changed since extraction — run extract again`)
    }
    if (entry.dst.length !== src.length) {
      throw new Error(`slide ${n}: expected ${src.length} translations, got ${entry.dst.length}`)
    }

    const missing = entry.dst
      .map((d, i) => (String(d ?? '').trim() === '' && String(src[i] ?? '').trim() !== '' ? i : -1))
      .filter((i) => i >= 0)
    if (missing.length) {
      throw new Error(`slide ${n}: empty translation for run(s) ${missing.join(', ')}`)
    }

    // replace in document order; runs with no text in the source stay untouched
    let index = 0
    let out = xml.replace(RUN, (_m, text) => {
      const replacement = entry.dst[index++]
      return `<a:t>${escapeXml(String(replacement ?? unescapeXml(text)))}</a:t>`
    })
    out = out.replace(EMPTY_RUN, '<a:t/>')

    zip.file(file, out)
    slides.push(n)
  }

  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const target = path.join(dir, `slides.${lang}.pptx`)
  await fs.writeFile(target, out)
  console.log(`wrote ${path.relative(process.cwd(), target)} (${slides.length} slides, ${(out.length / 1024).toFixed(0)} KB)`)
}

try {
  if (mode === 'extract') await extract()
  else await apply()
} catch (err) {
  console.error(`error: ${err.message}`)
  process.exit(1)
}
