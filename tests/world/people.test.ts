import { createWorld, character, PIP_ID } from '../../src/world/world.ts'
import { withinHearing, homesWithRoom, residents } from '../../src/world/people.ts'
import type { Building } from '../../src/shared/types.ts'
import { addInhabitant } from './helpers.ts'

const home = (floors: 1 | 2 | 3, workLeft = 0): Building => ({ id: 'b1', name: 'Burrow', purpose: 'home', about: '', at: { x: 2, y: 2 },
  workLeft, workTotal: 3, startedDay: 1, facility: null, builtBy: 'origin', closed: false, repairLeft: 0, recipe: { footprint: 1, floors, wall: 'cream', roof: 'flat', roofColour: 'red', door: true, windows: 0, sign: '', extras: [] } })

test('only awake characters within four tiles can hear', () => {
  const w = createWorld(1); const pip = character(w, PIP_ID)
  addInhabitant(w, 'Mo', { x: pip.at.x + 4, y: pip.at.y })
  addInhabitant(w, 'Fen', { x: pip.at.x + 5, y: pip.at.y })
  const sleeper = addInhabitant(w, 'Dot', pip.at); sleeper.asleep = true
  expect(withinHearing(w, pip).map((c) => c.name)).toEqual(['Mo'])
})
test('a home has room for as many as it has floors', () => {
  const w = createWorld(1); const b = home(2); w.buildings.push(b)
  expect(homesWithRoom(w)).toEqual([b])
  addInhabitant(w, 'Mo', b.at).homeId = b.id
  expect(residents(w, b).map((c) => c.name)).toEqual(['Mo'])
  expect(homesWithRoom(w)).toEqual([b])
  addInhabitant(w, 'Fen', b.at).homeId = b.id
  expect(homesWithRoom(w)).toEqual([])
})
test('an unfinished home has no room', () => {
  const w = createWorld(1); w.buildings.push(home(3, 2))
  expect(homesWithRoom(w)).toEqual([])
})
