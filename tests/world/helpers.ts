import type { Character, Tile, World } from '../../src/shared/types.ts'

/** Adds an inhabitant by hand, the way create_inhabitant would but with nothing written for it. */
export function addInhabitant(w: World, name: string, at: Tile): Character {
  const c: Character = {
    id: `c${w.nextId++}`, name, tier: 'inhabitant', at: { x: at.x, y: at.y },
    body: { hunger: 0.2, tiredness: 0.1, mood: 0 }, asleep: false, busyUntil: 0, doing: 'idle',
    said: '', saidAt: 0, queue: [], queueTurn: 0, homeId: null, look: null, sheet: null, heard: [],
  }
  w.characters.push(c)
  return c
}
