import { createWorld, character, advance, PIP_ID } from '../../src/world/world.ts'
import { manifest, observe, act } from '../../src/world/seam.ts'

const names = (o: ReturnType<typeof observe>) => o.available.map(a => a.name)
const firstSite = (w: ReturnType<typeof createWorld>) =>
  observe(w, PIP_ID).available.find(a => a.name === 'start_building')!.params.site[0]

test('the manifest carries the stance and ten moves', () => {
  expect(manifest().stance).toBe('Nobody tells you what to do with your day.')
  expect(manifest().moves).toHaveLength(10)
})
test('on day one Pip can start a building but has nothing to work on', () => {
  const o = observe(createWorld(1), PIP_ID)
  expect(names(o)).toContain('start_building')
  expect(names(o)).not.toContain('work_on')
  expect(o.cannot.some(c => c.startsWith('work_on'))).toBe(true)
  expect(o.clock).toBe('06:00, day 1')
  expect(o.environment).toBe('Early morning, dry.')
})
test('observations never leak ids', () => {
  const text = JSON.stringify(observe(createWorld(1), PIP_ID))
  expect(text).not.toMatch(/berry_bush|hollow_tree|"pip"/)
})
test('eating walks there, takes time, fills Pip up and is recorded', () => {
  const w = createWorld(1); character(w, PIP_ID).body.hunger = 0.7
  const r = act(w, PIP_ID, { action: 'eat', params: { target: 'the berry bush' } })
  expect(r).toMatchObject({ success: true, moodDelta: 0.2 })
  expect(r.minutes).toBe(20 + 3 * 7)                       // (12,12) to (8,9) is 7 tiles
  expect(character(w, PIP_ID).body.hunger).toBeCloseTo(0.05)
  expect(character(w, PIP_ID).busyUntil).toBe(w.minutes + r.minutes)
  expect(w.events.at(-1)!.text).toContain('Pip')
})
test('a building goes from site to finished', () => {
  const w = createWorld(1); const site = firstSite(w)
  const started = act(w, PIP_ID, { action: 'start_building',
    params: { site, purpose: 'home', name: 'First House', about: 'somewhere to be' } })
  expect(started.success).toBe(true)
  expect(w.buildings[0]).toMatchObject({ name: 'First House', purpose: 'home', workLeft: 2, workTotal: 2 })
  advance(w, started.minutes)
  const one = act(w, PIP_ID, { action: 'work_on', params: { target: 'First House' } })
  expect(one.moodDelta).toBeCloseTo(0.03); advance(w, one.minutes)
  const two = act(w, PIP_ID, { action: 'work_on', params: { target: 'First House' } })
  expect(two.moodDelta).toBeCloseTo(0.3)
  expect(w.buildings[0].workLeft).toBe(0)
  advance(w, two.minutes); character(w, PIP_ID).body.tiredness = 0.5
  const o = observe(w, PIP_ID)
  expect(o.available.find(a => a.name === 'sleep')?.params.target ?? []).toContain('First House')
})
test('a third building site is refused while two are unfinished', () => {
  const w = createWorld(1)
  for (let i = 0; i < 2; i++) {
    const r = act(w, PIP_ID, { action: 'start_building', params: { site: firstSite(w), purpose: 'other', name: `B${i}` } })
    advance(w, r.minutes)
  }
  expect(names(observe(w, PIP_ID))).not.toContain('start_building')
})
test('a finished building can be changed, keeping what was not mentioned', () => {
  const w = createWorld(1)
  advance(w, act(w, PIP_ID, { action: 'start_building', params: { site: firstSite(w), purpose: 'other', name: 'Hut', floors: '2' } }).minutes)
  w.buildings[0].workLeft = 0
  expect(act(w, PIP_ID, { action: 'change_building', params: { target: 'Hut', wall: 'blue', sign: 'HUT' } }).success).toBe(true)
  expect(w.buildings[0].recipe).toMatchObject({ wall: 'blue', sign: 'HUT', floors: 2, roof: 'pitched' })
})
test('pulling a building down removes it', () => {
  const w = createWorld(1)
  advance(w, act(w, PIP_ID, { action: 'start_building', params: { site: firstSite(w), purpose: 'other', name: 'Shed' } }).minutes)
  expect(act(w, PIP_ID, { action: 'pull_down', params: { target: 'Shed' } }).success).toBe(true)
  expect(w.buildings).toHaveLength(0)
})
// Review Focus 2
test.each([
  [{ action: 'fly', params: {} }],
  [{ action: 'work_on', params: { target: 'nothing' } }],
  [{ action: 'eat', params: { target: 'the pond' } }],
  [{ action: 'start_building', params: { site: 'the moon', purpose: 'home' } }],
  [{ action: 'start_building', params: { site: 'the middle of the plot', purpose: 'home', roof: 'thatched' } }],
])('a move that is not on offer is refused in words: %j', (move) => {
  const w = createWorld(1); const before = JSON.stringify(w.buildings)
  const r = act(w, PIP_ID, move)
  expect(r.success).toBe(false); expect(r.moodDelta).toBe(-0.05)
  expect(r.message.length).toBeGreaterThan(5)
  expect(JSON.stringify(w.buildings)).toBe(before)
})
test('a busy or sleeping character cannot act', () => {
  const w = createWorld(1)
  act(w, PIP_ID, { action: 'wait', params: {} })
  expect(act(w, PIP_ID, { action: 'wait', params: {} }).success).toBe(false)
  advance(w, 15); character(w, PIP_ID).asleep = true
  expect(act(w, PIP_ID, { action: 'wait', params: {} }).success).toBe(false)
})
test('speech is cleaned and remembered on the character', () => {
  const w = createWorld(1)
  act(w, PIP_ID, { action: 'speak', params: { text: 'hello\u0000 plot' } })
  expect(character(w, PIP_ID).said).toBe('hello plot')
})
