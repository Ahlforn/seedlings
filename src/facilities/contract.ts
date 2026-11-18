/**
 * What a facility is. A facility is a module that adds a place with moves of its own. The world offers those
 * moves only to someone standing at a finished, open, unbroken building of that kind, within its hours.
 */

import type { Building, Character, Recipe, World } from '../shared/types.ts'
import type { Store } from '../store/store.ts'
import { clockOf } from '../world/clock.ts'
import type { Left, MoveSpec } from '../world/seam.ts'

/** What the town lends a facility. It never gets the model. */
export type FacilityServices = {
  store: Store
  /** GET a URL and parse JSON; rejects on network errors, timeouts and non-2xx answers */
  fetchJson(url: string): Promise<unknown>
  now(): number
}

export type FacilityContext = { world: World; c: Character; building: Building; services: FacilityServices }

export type FacilityOutcome =
  | { ok: true; message: string; minutes: number; moodDelta: number; label: string; event: string; leaves?: Left[] }
  /** quiet: not the character's doing, so no mood penalty and no event */
  | { ok: false; reason: string; quiet?: boolean }

export type FacilityMove = {
  /** spec.tier is the smallest tier allowed */
  spec: MoveSpec
  /** Choices that are true right now, or a reason the move is refused. Pure: reads the world only. */
  offer(ctx: Omit<FacilityContext, 'services'>): Record<string, string[]> | string
  perform(ctx: FacilityContext, params: Record<string, string>): FacilityOutcome | Promise<FacilityOutcome>
}

export type Facility = {
  /** the word used as a building's purpose, e.g. 'cafe' */
  kind: string
  /** e.g. 'an internet café' */
  name: string
  /** one plain line: what it is for */
  about: string
  /** how it looks when the owner places one */
  look: Recipe
  /** in-world hours, closes exclusive; null when always open */
  hours: { opens: number; closes: number } | null
  moves: FacilityMove[]
  /** extra lines a character standing here observes */
  observe?(world: World, building: Building): string[]
}

/** Days for daily limits run from 06:00, as diaries do. */
const DAY_STARTS_AT = 360
const dayOf = (world: World) => clockOf(Math.max(0, world.minutes - DAY_STARTS_AT)).day

export function usesToday(world: World, key: string): number {
  const use = world.uses[key]
  return use && use.day === dayOf(world) ? use.count : 0
}

export function countUse(world: World, key: string): void {
  world.uses[key] = { day: dayOf(world), count: usesToday(world, key) + 1 }
}
