import { advance, createWorld } from '../../src/world/world.ts'
import { actAny, observe } from '../../src/world/seam.ts'
import { placeFacility } from '../../src/world/owner.ts'
import { candidateSites } from '../../src/world/sites.ts'
import { openStore } from '../../src/store/store.ts'
import type { World } from '../../src/shared/types.ts'
import { addInhabitant } from '../world/helpers.ts'

const setup = () => {
  const w = createWorld(1); w.minutes = 10 * 60
  expect(placeFacility(w, 'art', candidateSites(w)[0].name).ok).toBe(true)
  const place = w.buildings.at(-1)!
  const store = openStore(':memory:')
  return { w, place, store, services: { store, fetchJson: async () => ({}), now: () => 0 } }
}
const paintBy = (w: World, services: { store: ReturnType<typeof openStore>; fetchJson: () => Promise<unknown>; now: () => number }, id: string, title: string) =>
  actAny(w, id, { action: 'make_a_picture', params: { title, mood: 'calm' } }, services)

test('a picture is made, hangs, is seen and remembered by whoever looks', async () => {
  const { w, place, store, services } = setup()
  const mo = addInhabitant(w, 'Mo', place.at); const fen = addInhabitant(w, 'Fen', place.at)
  const made = await actAny(w, mo.id, { action: 'make_a_picture', params: { title: 'First Light', mood: 'Restless', description: 'the road' } }, services)
  expect(made).toMatchObject({ success: true, message: 'You make a picture called "First Light". It hangs on the wall now.', minutes: 60 })
  expect(made.leaves).toEqual([{ characterId: mo.id, text: 'I made a picture called First Light.', kind: 'moment' }])
  expect(w.pictures[0]).toMatchObject({ title: 'First Light', mood: 'restless', byName: 'Mo', by: mo.id, placeId: place.id, description: 'the road' })
  expect(store.gallery(5)).toHaveLength(1)
  expect(observe(w, fen.id).here).toContain('Pictures on the wall: "First Light" by Mo (restless)')
  const looked = await actAny(w, fen.id, { action: 'look_at_picture', params: { picture: 'first light' } }, services)
  expect(looked.message).toBe('"First Light" by Mo, restless. the road')
  expect(looked.leaves).toEqual([{ characterId: fen.id, text: 'Mo made a picture called First Light, restless: the road', kind: 'person' }])
  mo.busyUntil = 0
  const own = await actAny(w, mo.id, { action: 'look_at_picture', params: { picture: 'First Light' } }, services)
  expect(own.message).toBe('"First Light", which you made, restless.'); expect(own.leaves).toEqual([])
})
test('a picture needs a title, and looking needs something hanging', async () => {
  const { w, place, services } = setup(); const mo = addInhabitant(w, 'Mo', place.at)
  expect(observe(w, mo.id).cannot).toContain('look_at_picture: there are no pictures here yet')
  expect((await paintBy(w, services, mo.id, '  ')).message).toBe('A picture needs a title.')
})
test('one picture a day each', async () => {
  const { w, place, services } = setup(); const mo = addInhabitant(w, 'Mo', place.at)
  expect((await paintBy(w, services, mo.id, 'One')).success).toBe(true); mo.busyUntil = 0
  expect((await paintBy(w, services, mo.id, 'Two')).message).toBe('You cannot do that right now: you have already made a picture today.')
  advance(w, 20 * 60); mo.busyUntil = 0; mo.asleep = false
  expect((await paintBy(w, services, mo.id, 'Two')).success).toBe(true)
})
test('twelve pictures hang; the oldest comes down but stays in the gallery', async () => {
  const { w, place, store, services } = setup()
  for (let i = 0; i < 13; i++) expect((await paintBy(w, services, addInhabitant(w, `P${i}`, place.at).id, `Picture ${i}`)).success).toBe(true)
  const hanging = w.pictures.filter((p) => p.placeId === place.id)
  expect(hanging).toHaveLength(12); expect(hanging.map((p) => p.title)).not.toContain('Picture 0')
  expect(store.gallery(20)).toHaveLength(13)
})
