/** Reads the model's words back as a decision. Lenient about wrapping, strict about shape. */

import { cleanText } from '../shared/recipe.ts'
import type { Act } from '../shared/types.ts'
import type { MemoryKind } from '../store/store.ts'

export type Decision = {
  consider: string
  moves: Act[]
  because: string
  remember: { text: string; kind: MemoryKind } | null
}

export const MEMORY_KINDS: MemoryKind[] = ['person', 'work', 'fact', 'moment']
const MAX_MOVES = 3
const LINE_MAX = 200

export const WAIT: Decision = { consider: '', moves: [{ action: 'wait', params: {} }], because: '', remember: null }

/** Parses JSON that may be wrapped in a code fence or surrounded by prose. Null when there is none. */
export function readJson(text: string): unknown | null {
  const tries = [text.trim()]
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) tries.push(text.slice(first, last + 1))
  for (const candidate of tries) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next one
    }
  }
  return null
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const line = (value: unknown) => (typeof value === 'string' ? cleanText(value, LINE_MAX) : '')

/** Null when the reply is not JSON or holds no moves. Whether a move is allowed is the world's call. */
export function readDecision(text: string): Decision | null {
  const answer = readJson(text)
  if (!isRecord(answer) || !Array.isArray(answer.do)) return null

  const moves: Act[] = []
  for (const item of answer.do) {
    if (!isRecord(item) || typeof item.action !== 'string' || item.action.trim() === '') continue
    const params: Record<string, string> = {}
    if (isRecord(item.params)) {
      for (const [key, value] of Object.entries(item.params)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') params[key] = String(value)
        else if (Array.isArray(value)) params[key] = value.join(', ')
      }
    }
    moves.push({ action: item.action.trim(), params })
    if (moves.length === MAX_MOVES) break
  }
  if (moves.length === 0) return null

  let remember: Decision['remember'] = null
  const kept = answer.remember
  if (isRecord(kept) && line(kept.text) !== '') {
    const kind = MEMORY_KINDS.find((k) => k === kept.kind) ?? 'moment'
    remember = { text: line(kept.text), kind }
  }
  return { consider: line(answer.consider), moves, because: line(answer.because), remember }
}
