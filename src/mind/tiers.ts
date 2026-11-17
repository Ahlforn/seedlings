/** What differs between Pip's mind and an inhabitant's. Everything else about a mind is the same. */

import type { Pool } from '../budget/keeper.ts'
import type { Config } from '../config.ts'
import type { Character, Sheet } from '../shared/types.ts'
import { PIP_SHEET } from './sheet.ts'

export type MindSettings = {
  memoriesRecalled: number
  mindShown: number
  memoryCap: number
  /** Pip writes every few hours and after anything notable; inhabitants once a day */
  diaryEveryFewHours: boolean
  pool: Pool
}

export const MINDS: Record<Character['tier'], MindSettings> = {
  origin: { memoriesRecalled: 5, mindShown: 3, memoryCap: 200, diaryEveryFewHours: true, pool: 'origin' },
  inhabitant: { memoriesRecalled: 3, mindShown: 2, memoryCap: 60, diaryEveryFewHours: false, pool: 'inhabitants' },
}

/** Pip's own sheet, or the one Pip wrote. A hand-edited world may lack one; the stand-in is deliberately plain. */
export function sheetFor(c: Character): Sheet {
  if (c.tier === 'origin') return PIP_SHEET
  return c.sheet ?? {
    name: c.name, you: 'a small creature', core: `${c.name} lives in the town Pip built.`,
    traits: ['quiet'], values: ['getting by'], fears: ['being alone'],
  }
}

export function modelFor(c: Character, config: Config): string {
  return c.tier === 'origin' ? config.pipModel : config.inhabitantModel
}
