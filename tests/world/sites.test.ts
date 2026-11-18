import { createWorld } from '../../src/world/world.ts'
import { candidateSites, isFree, footprintTiles } from '../../src/world/sites.ts'

test('sites are few, uniquely named, free and repeatable', () => {
  const w = createWorld(1); const sites = candidateSites(w)
  expect(sites.length).toBeGreaterThan(0); expect(sites.length).toBeLessThanOrEqual(6)
  expect(new Set(sites.map(s => s.name)).size).toBe(sites.length)
  for (const s of sites) expect(isFree(w, s.at, s.maxFootprint)).toBe(true)
  expect(candidateSites(createWorld(1))).toEqual(sites)
})
test('a site taken by a building is no longer offered', () => {
  const w = createWorld(1); const s = candidateSites(w)[0]
  w.buildings.push({ id: 'b1', name: 'x', purpose: 'home', about: '', at: s.at, workLeft: 0, workTotal: 2,
    startedDay: 1, facility: null, builtBy: 'origin', closed: false, repairLeft: 0, recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'flat', roofColour: 'red',
      door: true, windows: 0, sign: '', extras: [] } })
  expect(candidateSites(w).some(c => c.at.x === s.at.x && c.at.y === s.at.y)).toBe(false)
})
test('footprint tiles and the plot edge', () => {
  expect(footprintTiles({ x: 2, y: 3 }, 2)).toHaveLength(4)
  expect(isFree(createWorld(1), { x: 23, y: 23 }, 2)).toBe(false)
})
