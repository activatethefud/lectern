import PDFDocument from 'pdfkit'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Certificate PDF, drawn with pdfkit (pure JS) so the runtime image needs no browser and no
 * office suite. Two fonts are committed: Noto Sans (Latin + Cyrillic) and Noto Sans SC (CJK —
 * Serbian Cyrillic is *not* in the SC subset, Chinese is not in Noto Sans).
 */
const FONT_DIR = join(process.cwd(), 'server/assets/fonts')
const LATIN = join(FONT_DIR, 'NotoSans-Regular.ttf')
const CJK = join(FONT_DIR, 'NotoSansSC-Regular.otf')

const ACCENT = '#2f6f4f'
const INK = '#1c1a17'
const MUTED = '#6b665e'

interface Labels {
  title: string
  awarded: string
  date: string
  score: string
  id: string
  verify: string
  disclaimer: string
}

const LABELS: Record<string, Labels> = {
  sr: {
    title: 'SERTIFIKAT O POLOŽENOM KURSU',
    awarded: 'dodeljuje se',
    date: 'Datum',
    score: 'Rezultat',
    id: 'Broj sertifikata',
    verify: 'Provera',
    disclaimer: 'Ovaj sertifikat nije akademski dokument i služi samo kao potvrda da je kurs završen.',
  },
  en: {
    title: 'CERTIFICATE OF COMPLETION',
    awarded: 'awarded to',
    date: 'Date',
    score: 'Score',
    id: 'Certificate ID',
    verify: 'Verify',
    disclaimer: 'This certificate is not an academic document; it only confirms that the course was completed.',
  },
  'zh-CN': {
    title: '课程结业证书',
    awarded: '授予',
    date: '日期',
    score: '成绩',
    id: '证书编号',
    verify: '验证',
    disclaimer: '本证书不是学历证明，仅用于证明该课程已经完成。',
  },
}

export interface CertificateInput {
  name: string
  courseTitle: string
  finishedAt: string
  score: number
  total: number
  percent: number
  /** sequential tracking number, printed on the document */
  serial: string
  /** HMAC over every field, printed small — a doctored copy no longer matches */
  signature: string
  verifyUrl: string
  locale: string
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text)
}

/** Issued at: the exact date *and time* the certificate was generated, in the reader's locale. */
function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

/** Name font: whichever file's subset covers the characters actually typed. */
function pickFont(text: string): 'cjk' | 'latin' {
  return hasCjk(text) ? 'cjk' : 'latin'
}

export function renderCertificate(input: CertificateInput): Promise<Buffer> {
  if (!existsSync(LATIN) || !existsSync(CJK)) {
    throw createError({ statusCode: 503, statusMessage: 'certificate fonts are missing' })
  }

  const labels = LABELS[input.locale] ?? LABELS.sr!
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    info: { Title: `${labels.title} — ${input.courseTitle}`, Author: 'Lectern' },
  })

  doc.registerFont('latin', readFileSync(LATIN))
  doc.registerFont('cjk', readFileSync(CJK))

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  const W = doc.page.width
  const H = doc.page.height
  const pad = 34

  // frame
  doc.lineWidth(2).strokeColor(ACCENT).rect(pad, pad, W - pad * 2, H - pad * 2).stroke()
  doc.lineWidth(0.7).strokeColor(ACCENT).rect(pad + 9, pad + 9, W - (pad + 9) * 2, H - (pad + 9) * 2).stroke()

  doc.fillColor(ACCENT).font(pickFont(labels.title)).fontSize(11)
  doc.text(labels.title, 0, 78, { width: W, align: 'center', characterSpacing: 2.4 })

  doc.fillColor(MUTED).font(pickFont(labels.awarded)).fontSize(10)
  doc.text(labels.awarded, 0, 132, { width: W, align: 'center', characterSpacing: 1.6 })

  // learner name, shrunk to fit
  let nameSize = 40
  doc.font(pickFont(input.name))
  while (nameSize > 16 && doc.fontSize(nameSize).widthOfString(input.name) > W - 200) nameSize -= 2
  doc.fillColor(INK).fontSize(nameSize)
  doc.text(input.name, 100, 158, { width: W - 200, align: 'center' })

  doc.fillColor(INK).font(pickFont(input.courseTitle)).fontSize(17)
  doc.text(input.courseTitle, 100, 246, { width: W - 200, align: 'center' })

  // meta row — every string picks its own font, so a translated label never renders as boxes
  const metaY = 330
  const cols = [
    { label: labels.score, value: `${input.score} / ${input.total} · ${input.percent} %` },
    { label: labels.date, value: formatDate(input.finishedAt, input.locale === 'zh-CN' ? 'zh-CN' : input.locale) },
    { label: labels.id, value: input.serial },
  ]
  const colW = (W - 240) / cols.length
  cols.forEach((col, i) => {
    const x = 120 + colW * i
    const label = col.label.toUpperCase()
    doc.fillColor(MUTED).font(pickFont(label)).fontSize(8.5)
    doc.text(label, x, metaY, { width: colW, align: 'center', characterSpacing: 1 })
    doc.fillColor(INK).font(pickFont(col.value)).fontSize(13)
    doc.text(col.value, x, metaY + 15, { width: colW, align: 'center' })
  })

  // disclaimer: the document is a course-completion record, nothing more
  doc.fillColor(MUTED).font(pickFont(labels.disclaimer)).fontSize(7.5)
  doc.text(labels.disclaimer, 60, H - pad - 66, { width: W - 120, align: 'center' })

  // footer: how to check this document later, and the signature that makes edits visible
  const footer = `${labels.verify}: ${input.verifyUrl}   ·   sig ${input.signature}`
  doc.fillColor(MUTED).font(pickFont(footer)).fontSize(8.5)
  doc.text(footer, 0, H - pad - 46, { width: W, align: 'center' })

  doc.end()
  return finished
}
