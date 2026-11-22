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
}

const LABELS: Record<string, Labels> = {
  sr: {
    title: 'SERTIFIKAT O POLOŽENOM KURSU',
    awarded: 'dodeljuje se',
    date: 'Datum',
    score: 'Rezultat',
    id: 'Broj sertifikata',
    verify: 'Provera',
  },
  en: {
    title: 'CERTIFICATE OF COMPLETION',
    awarded: 'awarded to',
    date: 'Date',
    score: 'Score',
    id: 'Certificate ID',
    verify: 'Verify',
  },
  'zh-CN': {
    title: '课程结业证书',
    awarded: '授予',
    date: '日期',
    score: '成绩',
    id: '证书编号',
    verify: '验证',
  },
}

export interface CertificateInput {
  name: string
  courseTitle: string
  finishedAt: string
  score: number
  total: number
  percent: number
  certId: string
  verifyUrl: string
  locale: string
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text)
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

/** Name font: whichever file's subset covers the characters actually typed. */
function pickFont(name: string): 'cjk' | 'latin' {
  return hasCjk(name) ? 'cjk' : 'latin'
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
    info: { Title: `${labels.title} — ${input.courseTitle}`, Author: 'slide-course' },
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

  doc.fillColor(ACCENT).font('latin').fontSize(11)
  doc.text(labels.title, 0, 78, { width: W, align: 'center', characterSpacing: 2.4 })

  doc.fillColor(MUTED).fontSize(10)
  doc.text(labels.awarded, 0, 132, { width: W, align: 'center', characterSpacing: 1.6 })

  // learner name, shrunk to fit
  let nameSize = 40
  doc.font(pickFont(input.name))
  while (nameSize > 16 && doc.fontSize(nameSize).widthOfString(input.name) > W - 200) nameSize -= 2
  doc.fillColor(INK).fontSize(nameSize)
  doc.text(input.name, 100, 158, { width: W - 200, align: 'center' })

  doc.fillColor(INK).font('latin').fontSize(17)
  doc.text(input.courseTitle, 100, 246, { width: W - 200, align: 'center' })

  // meta row
  const metaY = 330
  const cols = [
    { label: labels.score, value: `${input.score} / ${input.total} · ${input.percent} %` },
    { label: labels.date, value: formatDate(input.finishedAt, input.locale === 'zh-CN' ? 'zh-CN' : input.locale) },
    { label: labels.id, value: input.certId },
  ]
  const colW = (W - 240) / cols.length
  cols.forEach((col, i) => {
    const x = 120 + colW * i
    doc.fillColor(MUTED).font('latin').fontSize(8.5)
    doc.text(col.label.toUpperCase(), x, metaY, { width: colW, align: 'center', characterSpacing: 1 })
    doc.fillColor(INK).fontSize(13)
    doc.text(col.value, x, metaY + 15, { width: colW, align: 'center' })
  })

  // footer: how to check this document later
  doc.fillColor(MUTED).font('latin').fontSize(8.5)
  doc.text(`${labels.verify}: ${input.verifyUrl}`, 0, H - pad - 46, { width: W, align: 'center' })

  doc.end()
  return finished
}
