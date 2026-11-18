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

import type { Building } from '../../src/shared/types.ts'

/** A finished building of three spells' work, pushed into the world. */
export function home(w: World, name: string, over: Partial<Building> = {}): Building {
  const b: Building = {
    id: `b${w.nextId++}`, name, purpose: 'home', about: '', at: { x: 2, y: 2 }, workLeft: 0, workTotal: 3, startedDay: 1,
    facility: null, builtBy: 'origin', closed: false, repairLeft: 0,
    recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'flat', roofColour: 'red', door: true, windows: 0, sign: '', extras: [] },
    ...over,
  }
  w.buildings.push(b)
  return b
}
