/** Looking back: the diary entry, and what the stretch just lived leaves behind in memory. */

import type { MemoryKind, MindItem, MindKind, TurnRow } from '../store/store.ts'
import { clockOf } from '../world/clock.ts'
import type { ActResult } from '../world/seam.ts'
import { MEMORY_KINDS, isRecord, line, readJson } from './decision.ts'
import type { Decision } from './decision.ts'
import { whoYouAre } from './prompt.ts'
import type { Sheet } from './sheet.ts'

export type Reflection = {
  diary: string
  memories: { text: string; kind: MemoryKind }[]
  mind: { kind: MindKind; text: string }[]
  done: number[]
}

const MIND_KINDS: MindKind[] = ['want', 'worry', 'question', 'promise']
const MAX_ITEMS = 3
const DIARY_MAX = 700

export function shouldReflect(i: {
  minutesSinceLast: number
  turnsSinceLast: number
  buildingFinished: boolean
  goingToSleep: boolean
  /** false for a mind that writes only at the end of its day */
  everyFewHours: boolean
}): boolean {
  if (i.goingToSleep) return i.turnsSinceLast >= 1
  if (!i.everyFewHours) return false
  if (i.buildingFinished) return true
  return i.minutesSinceLast >= 240 && i.turnsSinceLast >= 3
}

function describeTurn(turn: TurnRow): string {
  const decision = readJson(turn.decision) as Partial<Decision> | null
  const results = (readJson(`{"r":${turn.results}}`) as { r?: ActResult[] } | null)?.r ?? []
  const did = results.map((result) => (result.success ? result.label : `${result.label} (it did not work)`)).join(', then ')
  const happened = results.map((result) => result.message).join(' ')
  return `- ${clockOf(turn.worldMinutes).label} — you thought: ${decision?.consider || 'nothing in particular'} — you did: ${did || 'nothing'} — what happened: ${happened || 'nothing'}`
}

export function reflectionPrompt(
  sheet: Sheet,
  clock: string,
  turns: TurnRow[],
  open: MindItem[],
  endOfDay: boolean,
): { system: string; user: string } {
  const system = `${whoYouAre(sheet)}

You keep a diary. Nobody reads it but you. Write as yourself, in the first person, plainly: what happened and how it sat with you. Do not list every action. Do not explain who you are.

RESPOND WITH JSON ONLY:
{"diary": "the entry, eighty words at most", "memories": [{"text": "something worth keeping, in your own words", "kind": "person|work|fact|moment"}], "mind": [{"kind": "want|worry|question|promise", "text": "something now on your mind"}], "done": [ids of things on your mind that are settled now]}
At most three memories and three new things on your mind. Any of the lists may be empty.`

  const sections = [
    `THE TIME: ${clock}.`,
    `SINCE YOU LAST WROTE:\n${turns.map(describeTurn).join('\n')}`,
  ]
  if (open.length) sections.push(`ON YOUR MIND:\n${open.map((item) => `- [${item.id}] ${item.kind}: ${item.text}`).join('\n')}`)
  sections.push(endOfDay ? 'The day is ending. Write about the whole day. JSON only.' : 'Write the entry for this stretch of the day. JSON only.')
  return { system, user: sections.join('\n\n') }
}

/** Null when the reply has no diary text. */
export function readReflection(text: string): Reflection | null {
  const answer = readJson(text)
  if (!isRecord(answer) || typeof answer.diary !== 'string') return null
  const diary = answer.diary.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, DIARY_MAX)
  if (diary === '') return null

  const memories: Reflection['memories'] = []
  for (const item of Array.isArray(answer.memories) ? answer.memories : []) {
    if (!isRecord(item) || line(item.text) === '') continue
    const kind = MEMORY_KINDS.find((k) => k === item.kind)
    if (kind && memories.length < MAX_ITEMS) memories.push({ text: line(item.text), kind })
  }
  const mind: Reflection['mind'] = []
  for (const item of Array.isArray(answer.mind) ? answer.mind : []) {
    if (!isRecord(item) || line(item.text) === '') continue
    const kind = MIND_KINDS.find((k) => k === item.kind)
    if (kind && mind.length < MAX_ITEMS) mind.push({ kind, text: line(item.text) })
  }
  const done = (Array.isArray(answer.done) ? answer.done : []).filter((id): id is number => Number.isInteger(id))
  return { diary, memories, mind, done }
}
