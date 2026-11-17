/** Who is where: who can hear whom, and which homes have room. */

import type { Building, Character, Tile, World } from '../shared/types.ts'

/** How far speech carries, in tiles. */
export const HEARING = 4
/** What a character keeps of what it heard, until its next turn. */
export const HEARD_MAX = 5
/** Notes in the whole world; the oldest go first. */
export const NOTES_MAX = 40
/** Words that already mean something to the world and cannot be a name. */
export const RESERVED_NAMES = ['anyone', 'wander', 'here']

export const distance = (a: Tile, b: Tile) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

export function others(world: World, c: Character): Character[] {
  return world.characters.filter((other) => other !== c)
}

/** Awake characters near enough to hear c, nearest first. */
export function withinHearing(world: World, c: Character): Character[] {
  return others(world, c)
    .filter((other) => !other.asleep && distance(other.at, c.at) <= HEARING)
    .sort((a, b) => distance(a.at, c.at) - distance(b.at, c.at))
}

export function residents(world: World, b: Building): Character[] {
  return world.characters.filter((c) => c.homeId === b.id)
}

/** Finished homes with fewer residents than floors. */
export function homesWithRoom(world: World): Building[] {
  return world.buildings.filter(
    (b) => b.purpose === 'home' && b.workLeft === 0 && residents(world, b).length < b.recipe.floors,
  )
}
