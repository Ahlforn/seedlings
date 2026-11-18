import { advance, character, createWorld, PIP_ID } from '../../src/world/world.ts'
import { act, observe } from '../../src/world/seam.ts'
import { breakBuilding, setClosed, setWeather } from '../../src/world/owner.ts'
import { addInhabitant, home } from './helpers.ts'

test('the owner can set the weather and it holds for three hours', () => {
  const w = createWorld(1)
  expect(setWeather(w, 'a storm')).toEqual({ ok: true, message: 'The weather turned to a storm.' })
  expect(w.rain).toBe(3); expect(w.events.at(-1)!.text).toBe('The weather turned to a storm.')
  for (let h = 0; h < 3; h++) { advance(w, 60); expect(w.rain).toBe(3) }
  expect(setWeather(w, 'dry')).toEqual({ ok: true, message: 'The weather cleared.' })
  expect(setWeather(w, 'snow')).toEqual({ ok: false, message: 'Choose one of: dry, a thin rain, raining hard, a storm.' })
})
// Review Focus 4
test('a closed home is not slept in, and the resident is told why', () => {
  const w = createWorld(1); const b = home(w, 'Burrow'); const mo = addInhabitant(w, 'Mo', b.at); mo.homeId = b.id; mo.body.tiredness = 0.8
  expect(setClosed(w, 'burrow', true)).toEqual({ ok: true, message: 'Burrow was closed.' })
  expect(observe(w, mo.id).available.find((m) => m.name === 'sleep')!.params.target).not.toContain('Burrow')
  expect(act(w, mo.id, { action: 'sleep', params: { target: 'Burrow' } }).message).toBe('Burrow is closed.')
  expect(observe(w, mo.id).room).toContain('Burrow (closed)')
  expect(observe(w, mo.id).home).toBe('Your home is Burrow.')
  expect(setClosed(w, 'Burrow', false)).toEqual({ ok: true, message: 'Burrow opened again.' }); mo.busyUntil = 0
  expect(act(w, mo.id, { action: 'sleep', params: { target: 'Burrow' } }).success).toBe(true)
  expect(setClosed(w, 'Nowhere', true).ok).toBe(false)
})
// Review Focus 4
test('a broken building needs mending, and Pip mends it with work_on', () => {
  const w = createWorld(1); home(w, 'Burrow')
  expect(breakBuilding(w, 'Burrow')).toEqual({ ok: true, message: 'Burrow broke.' })
  expect(w.buildings[0].repairLeft).toBe(1)
  expect(observe(w, PIP_ID).room).toContain('Burrow (broken)')
  const r = act(w, PIP_ID, { action: 'work_on', params: { target: 'Burrow' } })
  expect(r.message).toBe('You mend Burrow. It works again.'); expect(w.buildings[0].repairLeft).toBe(0)
  expect(w.events.at(-1)!.text).toBe('Pip mended Burrow')
})
test('a big broken building takes a third of its work to mend', () => {
  const w = createWorld(1); home(w, 'Hall', { workTotal: 9 })
  breakBuilding(w, 'Hall'); expect(w.buildings[0].repairLeft).toBe(3)
  expect(act(w, PIP_ID, { action: 'work_on', params: { target: 'Hall' } }).message).toBe('You mend Hall. 2 more to go.')
})
test('a broken building is not a place to eat, and starting new sites ignores it', () => {
  const w = createWorld(1); home(w, 'Kitchen', { purpose: 'food' }); breakBuilding(w, 'Kitchen'); character(w, PIP_ID).body.hunger = 0.7
  expect(act(w, PIP_ID, { action: 'eat', params: { target: 'Kitchen' } }).message).toBe('Kitchen is broken.')
  home(w, 'Shed', { workLeft: 2 })
  expect(observe(w, PIP_ID).available.map((m) => m.name)).toContain('start_building')
})
test('an unfinished building cannot be broken', () => {
  const w = createWorld(1); home(w, 'Burrow', { workLeft: 2 })
  expect(breakBuilding(w, 'Burrow')).toEqual({ ok: false, message: 'Burrow is not finished yet.' })
})
test('a building nobody you know built says so', () => {
  const w = createWorld(1); home(w, 'Kiosk', { about: 'a little kiosk', builtBy: 'nobody', at: character(w, PIP_ID).at })
  expect(act(w, PIP_ID, { action: 'look_at', params: { target: 'Kiosk' } }).message).toBe('Kiosk: a little kiosk. Nobody you know built it.')
})
