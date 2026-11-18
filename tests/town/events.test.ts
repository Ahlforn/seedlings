import { applyEvent, readStrangerSheet, strangerPrompt } from '../../src/town/events.ts'
import { candidateSites } from '../../src/world/sites.ts'
import { deps } from './helpers.ts'

const sheet = (over: Record<string, string> = {}) => JSON.stringify({ name: 'Bram', kind: 'a tired traveller', who: 'Bram used to bake bread.', traits: 'quiet, patient',
  cares_about: 'warm bread', fears: 'being turned away', colour: 'brown', mark: 'scarf', ...over })

test('weather, closing, breaking and placing go through one door and are recorded', async () => {
  const d = deps([])
  expect(await applyEvent(d, { kind: 'weather', weather: 'a storm' })).toEqual({ ok: true, message: 'The weather turned to a storm.' })
  expect(d.world.rain).toBe(3)
  const site = candidateSites(d.world)[0].name
  expect((await applyEvent(d, { kind: 'facility', facility: 'art', site, name: 'The Easel' })).ok).toBe(true)
  expect(d.world.buildings[0]).toMatchObject({ name: 'The Easel', facility: 'art', builtBy: 'nobody' })
  expect(await applyEvent(d, { kind: 'close', building: 'the easel', closed: true })).toEqual({ ok: true, message: 'The Easel was closed.' })
  expect(await applyEvent(d, { kind: 'close', building: 'The Easel', closed: false })).toEqual({ ok: true, message: 'The Easel opened again.' })
  expect(await applyEvent(d, { kind: 'break', building: 'The Easel' })).toEqual({ ok: true, message: 'The Easel broke.' })
  expect(await applyEvent(d, { kind: 'parade' })).toEqual({ ok: false, message: 'That is not an event the town knows.' })
  expect(await applyEvent(d, 'nonsense')).toEqual({ ok: false, message: 'That is not an event the town knows.' })
  expect(await applyEvent(d, { kind: 'close', building: 'The Easel', closed: 'yes' })).toEqual({ ok: false, message: 'That is not an event the town knows.' })
  // newest first; something that is not an event at all is stored as '?'
  expect(d.store.ownerEvents(10).map((e) => e.kind)).toEqual(['close', '?', 'parade', 'break', 'close', 'close', 'facility', 'weather'])
  expect(d.store.ownerEvents(10).map((e) => e.ok)).toEqual([false, false, false, true, true, true, true, true])
  expect(d.store.loadWorld()!.rain).toBe(3)
})
test('a stranger is written from the premise and arrives homeless at the edge', async () => {
  const d = deps([sheet()]); d.world.populationLimit = 1
  expect(await applyEvent(d, { kind: 'stranger', premise: 'a tired traveller who used to be a baker' })).toEqual({ ok: true, message: 'Bram has arrived.' })
  const bram = d.world.characters.find((c) => c.name === 'Bram')!
  expect(bram).toMatchObject({ tier: 'inhabitant', homeId: null, look: { colour: 'brown', mark: 'scarf' } }); expect(bram.at.x).toBeLessThanOrEqual(1)
  expect(d.model.requests[0]).toMatchObject({ model: 'glm-5.3-flash', sessionId: 'stranger' }); expect(d.model.requests[0].user).toContain('used to be a baker')
  expect(d.store.spentBetween(0, d.now() + 1, { except: 'pip' })).toBeCloseTo(0.01)
  expect(d.world.events.at(-1)!.text).toBe('A stranger called Bram arrived at the edge of the plot.')
})
test('the very first stranger is allowed although the inhabitants\' own share is empty', async () => {
  const d = deps([sheet()]); d.world.populationLimit = 1
  expect(d.budget.status('inhabitants').canThink).toBe(false)
  expect((await applyEvent(d, { kind: 'stranger', premise: 'someone' })).ok).toBe(true)
})
// Review Focus 5
test('a premise that yields an unusable stranger twice fails plainly and changes nothing', async () => {
  const d = deps(['not json', sheet({ name: 'Pip' })]); d.world.populationLimit = 1
  const r = await applyEvent(d, { kind: 'stranger', premise: 'someone' })
  expect(r.ok).toBe(false); expect(r.message).toMatch(/^The stranger could not be written: There is already something called Pip/)
  expect(d.world.characters).toHaveLength(1); expect(d.model.requests).toHaveLength(2)
  expect(d.store.spentBetween(0, d.now() + 1)).toBeCloseTo(0.02)
})
test('a bad first answer is asked for once more', async () => {
  const d = deps(['{"name":""}', sheet()]); d.world.populationLimit = 1
  expect((await applyEvent(d, { kind: 'stranger', premise: 'someone' })).ok).toBe(true)
  expect(d.model.requests).toHaveLength(2)
})
test('no stranger when the town is full or the premise is empty, and no call is made', async () => {
  const d = deps([sheet()])
  expect(await applyEvent(d, { kind: 'stranger', premise: 'someone' })).toEqual({ ok: false, message: 'The town cannot support anyone more yet.' })
  d.world.populationLimit = 1
  expect(await applyEvent(d, { kind: 'stranger', premise: '  ' })).toEqual({ ok: false, message: 'Write a line or two about who arrives.' })
  d.store.setFlag('halt', 'charged_to_balance')
  expect(await applyEvent(d, { kind: 'stranger', premise: 'someone' })).toEqual({ ok: false, message: 'The town has no thinking left today.' })
  expect(d.model.requests).toHaveLength(0)
})
test('the stranger prompt asks for a sheet in the shape Pip fills in, and the reply is read leniently', () => {
  const p = strangerPrompt('a baker')
  for (const key of ['name', 'kind', 'who', 'traits', 'cares_about', 'fears', 'colour', 'mark']) expect(p.system).toContain(`"${key}"`)
  expect(p.system).toContain('brown'); expect(p.system).toContain('scarf'); expect(p.user).toContain('a baker')
  expect(readStrangerSheet('```json\n' + sheet() + '\n```')).toMatchObject({ name: 'Bram', traits: 'quiet, patient' })
  expect(readStrangerSheet(JSON.stringify({ name: 'Bram', traits: ['quiet', 'patient'] }))).toMatchObject({ traits: 'quiet, patient' })
  expect(readStrangerSheet('nope')).toBeNull()
})
