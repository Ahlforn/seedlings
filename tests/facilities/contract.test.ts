import { advance, character, createWorld, PIP_ID } from '../../src/world/world.ts'
import { act, actAny, manifest, observe } from '../../src/world/seam.ts'
import { placeFacility } from '../../src/world/owner.ts'
import { candidateSites } from '../../src/world/sites.ts'
import { FACILITIES } from '../../src/facilities/index.ts'
import { countUse, usesToday } from '../../src/facilities/contract.ts'
import { openStore } from '../../src/store/store.ts'
import type { World } from '../../src/shared/types.ts'
import { addInhabitant } from '../world/helpers.ts'
import { BENCH } from './bench.ts'

beforeAll(() => { FACILITIES.push(BENCH) })
afterAll(() => { FACILITIES.splice(FACILITIES.indexOf(BENCH), 1) })

const services = { store: openStore(':memory:'), fetchJson: async () => ({}), now: () => 0 }
const place = (w: World) => {
  const site = candidateSites(w)[0].name
  expect(placeFacility(w, 'bench', site).ok).toBe(true)
  return w.buildings.at(-1)!
}
const names = (w: World, id: string) => observe(w, id).available.map((m) => m.name)

test('a facility move is offered only at a finished, open, unbroken building of its kind, within hours', () => {
  const w = createWorld(1); w.minutes = 10 * 60
  const b = place(w); const mo = addInhabitant(w, 'Mo', b.at)
  expect(names(w, mo.id)).toContain('sit'); expect(names(w, mo.id)).not.toContain('wish')
  expect(observe(w, mo.id).here).toEqual(['The bench is warm from the sun.'])
  mo.at = { x: b.at.x + 5, y: b.at.y }; expect(names(w, mo.id)).not.toContain('sit')
  mo.at = { x: b.at.x + 1, y: b.at.y }; expect(names(w, mo.id)).toContain('sit')
  w.minutes = 22 * 60
  expect(observe(w, mo.id).cannot).toContain('sit: Bench is shut until 08:00')
  expect(observe(w, mo.id).here).toEqual(['Bench opens at 08:00.'])
  w.minutes = 10 * 60; b.closed = true; expect(names(w, mo.id)).not.toContain('sit')
  b.closed = false; b.repairLeft = 1; expect(names(w, mo.id)).not.toContain('sit')
})
test('a facility move is carried out and answered in words', async () => {
  const w = createWorld(1); w.minutes = 10 * 60; const b = place(w); const mo = addInhabitant(w, 'Mo', b.at)
  const r = await actAny(w, mo.id, { action: 'sit', params: {} }, services)
  expect(r).toMatchObject({ success: true, message: 'You sit on the bench.', minutes: 20, heardBy: [], leaves: [], created: null })
  expect(mo.busyUntil).toBe(w.minutes + 20); expect(w.events.at(-1)!.text).toBe('Mo sat on the bench')
  const world = await actAny(w, PIP_ID, { action: 'wait', params: {} }, services)
  expect(world.success).toBe(true)
  mo.busyUntil = 0; mo.at = { x: 0, y: 0 }
  expect((await actAny(w, mo.id, { action: 'sit', params: {} }, services)).message).toBe('That is not something you can do here.')
})
test('a facility error is a quiet refusal, never a throw', async () => {
  const w = createWorld(1); w.minutes = 10 * 60; const b = place(w); const pip = character(w, PIP_ID); pip.at = b.at
  const mood = pip.body.mood
  const r = await actAny(w, PIP_ID, { action: 'wish', params: {} }, services)
  expect(r).toMatchObject({ success: false, moodDelta: 0, message: 'Something went wrong there. It might work later.' })
  expect(pip.body.mood).toBe(mood)
})
test('Pip can build a facility kind, and the owner can place one', () => {
  expect(manifest('origin').glossary).toContain('a bench (build it with purpose "bench"): somewhere to sit')
  expect(manifest('origin').moves.map((m) => m.name)).toEqual(expect.arrayContaining(['sit', 'wish']))
  expect(manifest('inhabitant').moves.map((m) => m.name)).not.toContain('wish')
  const w = createWorld(1); const site = candidateSites(w)[0].name
  const r = act(w, PIP_ID, { action: 'start_building', params: { site, purpose: 'bench', name: 'Seat', about: 'a seat', footprint: '1', floors: '1',
    wall: 'brown', roof: 'flat', roof_colour: 'brown', windows: '0' } })
  expect(r.success).toBe(true)
  expect(w.buildings[0]).toMatchObject({ name: 'Seat', purpose: 'other', facility: 'bench', builtBy: 'origin' })
  const v = createWorld(1); const spot = candidateSites(v)[0].name
  const placed = placeFacility(v, 'bench', spot)
  expect(placed).toEqual({ ok: true, message: `Bench appeared ${spot === 'the middle of the plot' ? 'in the middle of the plot' : spot}.` })
  expect(v.buildings[0]).toMatchObject({ name: 'Bench', workLeft: 0, builtBy: 'nobody', facility: 'bench' })
  expect(placeFacility(v, 'bench', spot === candidateSites(v)[0].name ? 'the moon' : spot).ok).toBe(false)
  expect(placeFacility(v, 'spa', candidateSites(v)[0].name).ok).toBe(false)
})
// Review Focus 4
test('Pip can pull down a facility the owner placed', () => {
  const w = createWorld(1); place(w)
  expect(act(w, PIP_ID, { action: 'pull_down', params: { target: 'Bench' } }).success).toBe(true)
  expect(w.buildings).toHaveLength(0)
})
test('daily uses count per in-world day from 06:00', () => {
  const w = createWorld(1); w.minutes = 10 * 60
  countUse(w, 'cafe'); countUse(w, 'cafe'); expect(usesToday(w, 'cafe')).toBe(2)
  advance(w, 19 * 60); expect(usesToday(w, 'cafe')).toBe(2)          // 05:00 the next morning
  advance(w, 60); expect(usesToday(w, 'cafe')).toBe(0)               // 06:00: a new day
})
