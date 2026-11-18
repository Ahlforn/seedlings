import { createWorld } from '../../src/world/world.ts'
import { actAny, observe } from '../../src/world/seam.ts'
import { placeFacility } from '../../src/world/owner.ts'
import { candidateSites } from '../../src/world/sites.ts'
import { countUse } from '../../src/facilities/contract.ts'
import { openStore } from '../../src/store/store.ts'
import { addInhabitant } from '../world/helpers.ts'
import { stub } from './stub.ts'

const MOTH = { 'search/page?q=moths': { pages: [{ key: 'Moth' }] }, 'page/summary/Moth': { title: 'Moth', extract: 'Moths are insects related to butterflies. They fly at night.' },
  'search/page?q=glowing': { pages: [] }, 'feed/featured': { tfa: { titles: { normalized: 'Lighthouse' }, extract: 'A lighthouse is a tower.' } } }
const setup = (answers: Record<string, unknown> = MOTH) => {
  const w = createWorld(1); w.minutes = 10 * 60
  expect(placeFacility(w, 'cafe', candidateSites(w)[0].name).ok).toBe(true)
  const cafe = w.buildings.at(-1)!; const mo = addInhabitant(w, 'Mo', cafe.at); const store = openStore(':memory:')
  return { w, cafe, mo, store, services: { store, fetchJson: stub(answers), now: () => Date.UTC(2026, 10, 18) } }
}

test('a lookup is read, remembered as a gist, and recorded', async () => {
  const { w, mo, store, services } = setup()
  const r = await actAny(w, mo.id, { action: 'look_up', params: { topic: 'moths' } }, services)
  expect(r.success).toBe(true); expect(r.message).toBe('You read about Moth: Moths are insects related to butterflies. They fly at night.')
  expect(r.leaves).toEqual([{ characterId: mo.id, text: 'I read about Moth at the café: Moths are insects related to butterflies.', kind: 'fact' }])
  expect(store.lookupStats()).toEqual({ total: 1, missing: 0, failed: 0 })
  expect(w.events.at(-1)!.text).toBe('Mo read about Moth at Internet café')
})
test('a lookup that finds nothing is a miss, recorded with who asked and what for', async () => {
  const { w, mo, store, services } = setup()
  const r = await actAny(w, mo.id, { action: 'look_up', params: { topic: 'glowing snails' } }, services)
  expect(r).toMatchObject({ success: false, message: 'You look for glowing snails but find nothing about it.' })
  expect(store.recentMisses(5)[0]).toMatchObject({ characterId: mo.id, words: 'glowing snails', outcome: 'missing', kind: 'topic' })
})
test('an empty topic is not recorded', async () => {
  const { w, mo, store, services } = setup()
  expect((await actAny(w, mo.id, { action: 'look_up', params: { topic: ' ' } }, services)).message).toBe('You need something to look up.')
  expect(store.lookupStats().total).toBe(0)
})
// Review Focus 1
test('an unreachable Wikipedia is a quiet refusal recorded as failed, never a throw', async () => {
  const { w, mo, store, services } = setup({ 'search/page': new Error('timeout') })
  const mood = mo.body.mood
  const r = await actAny(w, mo.id, { action: 'look_up', params: { topic: 'moths' } }, services)
  expect(r).toMatchObject({ success: false, moodDelta: 0, message: "The café can't reach anything right now." })
  expect(mo.body.mood).toBe(mood)
  expect(store.lookupStats()).toEqual({ total: 1, missing: 0, failed: 1 })
})
test('reading the paper reads the day\'s featured article', async () => {
  const { w, mo, store, services } = setup()
  const r = await actAny(w, mo.id, { action: 'read_the_paper', params: {} }, services)
  expect(r.message).toBe('You read the paper. Today it is about Lighthouse: A lighthouse is a tower.')
  expect(services.fetchJson.asked.at(-1)).toContain('feed/featured/2026/11/18')
  expect(store.lookupStats().total).toBe(1)
})
test('the café is shut at night and full after thirty lookups', () => {
  const { w, cafe, mo } = setup()
  w.minutes = 21 * 60
  expect(observe(w, mo.id).cannot).toContain(`look_up: ${cafe.name} is shut until 08:00`)
  w.minutes = 10 * 60
  for (let i = 0; i < 30; i++) countUse(w, 'cafe')
  expect(observe(w, mo.id).cannot).toContain("look_up: the café's terminal is busy for the rest of the day")
  expect(observe(w, mo.id).cannot).toContain("read_the_paper: the café's terminal is busy for the rest of the day")
})
