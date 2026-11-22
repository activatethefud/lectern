import { createHash } from 'node:crypto'
import type { StoredQuestion } from './questions'

export interface Grade {
  score: number
  total: number
  percent: number
  threshold: number
  passMark: number
  passed: boolean
  /** slide numbers answered incorrectly — never the correct option */
  wrong: number[]
}

/** 90 % of 10 questions → 9 correct. Round up: "90 %" must never mean "80 % is enough". */
export function passMark(total: number, threshold: number): number {
  return Math.ceil(total * threshold)
}

export function gradeAttempt(
  answers: Record<number, number>,
  questions: { total: number, questionSlides: number[], byNumber: Map<number, StoredQuestion> },
  threshold: number,
): Grade {
  const wrong: number[] = []
  let score = 0

  for (const n of questions.questionSlides) {
    const question = questions.byNumber.get(n)!
    if (answers[n] === question.answer) score++
    else wrong.push(n)
  }

  const total = questions.total
  const mark = passMark(total, threshold)

  return {
    score,
    total,
    percent: total ? Math.round((score / total) * 1000) / 10 : 0,
    threshold,
    passMark: mark,
    passed: score >= mark,
    wrong,
  }
}
