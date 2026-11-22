import { describe, expect, it } from 'vitest'
import { fold, matchesQuery, pickLocalized } from '#shared/course'

describe('fold', () => {
  it('strips case and Serbian diacritics', () => {
    expect(fold('Čišćenje')).toBe('ciscenje')
    expect(fold('Đački Život')).toBe('dacki zivot')
  })

  it('transliterates Cyrillic to Latin', () => {
    expect(fold('чишћење')).toBe('ciscenje')
    expect(fold('Ђак')).toBe('djak')
    expect(fold('Љубав').startsWith('lj')).toBe(true)
  })

  it('leaves CJK intact', () => {
    expect(fold('电脑 清洁')).toBe('电脑 清洁')
  })
})

describe('matchesQuery', () => {
  const fields = ['Čišćenje i održavanje računara', 'informatika', 'demo-kurs']

  it('matches latin queries against diacritic and Cyrillic text', () => {
    expect(matchesQuery('ciscenje', fields)).toBe(true)
    expect(matchesQuery('чишћење', fields)).toBe(true)
    expect(matchesQuery('racunar', fields)).toBe(true)
  })

  it('requires every term', () => {
    expect(matchesQuery('ciscenje racunara', fields)).toBe(true)
    expect(matchesQuery('ciscenje kvantna', fields)).toBe(false)
  })

  it('treats an empty query as "everything"', () => {
    expect(matchesQuery('', fields)).toBe(true)
    expect(matchesQuery('   ', fields)).toBe(true)
  })
})

describe('pickLocalized', () => {
  const value = { sr: 'naslov', en: 'title', 'zh-CN': '标题' }

  it('picks the requested locale, then the course language, then en', () => {
    expect(pickLocalized(value, 'zh-CN')).toBe('标题')
    expect(pickLocalized(value, 'fr', 'sr')).toBe('naslov')
    expect(pickLocalized({ sr: 'samo sr' }, 'de')).toBe('samo sr')
  })

  it('passes plain strings through', () => {
    expect(pickLocalized('plain', 'zh-CN')).toBe('plain')
    expect(pickLocalized(undefined, 'en')).toBe('')
  })
})
