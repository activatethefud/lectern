import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Certificate identity.
 *
 * A certificate carries two different keys, on purpose:
 *
 *   serial       SC-2026-000042   short, printed, sequential — the *tracking number* a human
 *                                 reads over the phone. Guessable, so it reveals nothing.
 *   verifyId     8F3K-…          128 random bits — the key to the PDF, only handed to the
 *                                 session that earned it.
 *
 * `signature` is an HMAC over the certificate's own fields, so a certificate cannot be edited
 * (name swapped, score inflated) without the verify endpoint rejecting it.
 */

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford: no I, L, O, U

function base32(buffer: Buffer, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += BASE32[buffer[i]! % 32]
  return out
}

function group(text: string, size = 4): string {
  return text.match(new RegExp(`.{1,${size}}`, 'g'))!.join('-')
}

/** Unguessable document key: 24 base32 chars ≈ 120 bits. */
export function newVerifyId(): string {
  return group(base32(randomBytes(24), 24))
}

/** Human-readable tracking number, e.g. `SC-2026-000042`. */
export function formatSerial(seq: number, issuedAt: string): string {
  const year = issuedAt.slice(0, 4)
  return `SC-${year}-${String(seq).padStart(6, '0')}`
}

/**
 * Server secret used to sign certificates. Set `NUXT_CERTIFICATE_SECRET` in production; in dev it
 * is generated once and kept in the data directory so signatures stay valid across restarts.
 */
let cachedSecret: string | null = null
export function certificateSecret(): string {
  if (cachedSecret) return cachedSecret
  const fromEnv = process.env.NUXT_CERTIFICATE_SECRET || process.env.CERTIFICATE_SECRET
  if (fromEnv) return (cachedSecret = fromEnv)

  const dir = resolve(process.cwd(), useRuntimeConfig().dataDir)
  const file = join(dir, '.certificate-secret')
  if (existsSync(file)) return (cachedSecret = readFileSync(file, 'utf8').trim())

  mkdirSync(dir, { recursive: true })
  const generated = randomBytes(32).toString('hex')
  writeFileSync(file, generated, { mode: 0o600 })
  return (cachedSecret = generated)
}

export interface CertificateFields {
  serial: string
  verifyId: string
  name: string
  slug: string
  score: number
  total: number
  issuedAt: string
}

/** HMAC over every field printed on the document. Recompute to detect a doctored copy. */
export function signCertificate(fields: CertificateFields): string {
  const payload = [
    fields.serial, fields.verifyId, fields.name,
    fields.slug, fields.score, fields.total, fields.issuedAt,
  ].join('|')
  return group(base32(createHmac('sha256', certificateSecret()).update(payload).digest(), 16), 4)
}

export function signatureMatches(fields: CertificateFields, signature: string): boolean {
  return signCertificate(fields) === signature
}
