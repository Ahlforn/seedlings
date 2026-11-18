import { createWorld, character, advance, PIP_ID } from '../../src/world/world.ts'
import { manifest, observe, act } from '../../src/world/seam.ts'

const names = (o: ReturnType<typeof observe>) => o.available.map(a => a.name)
const firstSite = (w: ReturnType<typeof createWorld>) =>
  observe(w, PIP_ID).available.find(a => a.name === 'start_building')!.params.site[0]

test('the manifest carries the stance and every move', () => {
  expect(manifest('origin').stance).toBe('Nobody tells you what to do with your day.')
  expect(manifest('origin').moves.map((m) => m.name)).toContain('leave_note')
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

// Final review I3: a rested character is not offered sleep just because it is night.
test('sleep is not offered to a rested character at night', () => {
  const w = createWorld(1); w.minutes = 23 * 60; character(w, PIP_ID).body.tiredness = 0.05
  expect(names(observe(w, PIP_ID))).not.toContain('sleep')
  character(w, PIP_ID).body.tiredness = 0.2
  expect(names(observe(w, PIP_ID))).toContain('sleep')
})
// Found on the first live run: the model wrote "berry bush" and "middle of the plot", dropping "the".
test('a place named without its "the" is still understood', () => {
  const w = createWorld(1); character(w, PIP_ID).body.hunger = 0.7
  expect(act(w, PIP_ID, { action: 'eat', params: { target: 'berry bush' } }).success).toBe(true)
  expect(act(createWorld(1), PIP_ID, { action: 'start_building', params: { site: 'middle of the plot', purpose: 'home' } }).success).toBe(true)
  expect(act(createWorld(1), PIP_ID, { action: 'look_at', params: { target: 'The Pond' } }).success).toBe(true)
  expect(act(createWorld(1), PIP_ID, { action: 'look_at', params: { target: 'the moon' } }).success).toBe(false)
})

// ---- Stage 2: people, hearing, notes ----
import { addInhabitant } from './helpers.ts'

test('speaking to someone is heard by everyone near and remembered by each', () => {
  const w = createWorld(1); const pip = character(w, PIP_ID)
  const mo = addInhabitant(w, 'Mo', pip.at); const fen = addInhabitant(w, 'Fen', { x: pip.at.x + 1, y: pip.at.y })
  const r = act(w, PIP_ID, { action: 'speak', params: { to: 'Mo', text: 'Hello' } })
  expect(r.success).toBe(true); expect([...r.heardBy].sort()).toEqual([mo.id, fen.id].sort())
  expect(mo.heard[0]).toMatchObject({ from: 'Pip', text: 'Hello', toYou: true })
  expect(fen.heard[0].toYou).toBe(false)
  expect(r.leaves).toContainEqual({ characterId: mo.id, text: 'Pip said to me: "Hello"', kind: 'person' })
  expect(r.leaves).toContainEqual({ characterId: fen.id, text: 'Pip said: "Hello"', kind: 'person' })
  expect(observe(w, mo.id).heard).toEqual(['Pip said to you: "Hello"'])
  expect(observe(w, fen.id).heard).toEqual(['Pip said: "Hello"'])
  expect(w.events.at(-1)!.text).toBe('Pip said to Mo: "Hello"')
})
test('speaking to someone out of earshot is refused in words', () => {
  const w = createWorld(1); const pip = character(w, PIP_ID)
  addInhabitant(w, 'Mo', { x: pip.at.x + 10, y: pip.at.y })
  const r = act(w, PIP_ID, { action: 'speak', params: { to: 'Mo', text: 'Hello' } })
  expect(r.success).toBe(false); expect(r.message).toContain('anyone')
})
test('a note left at the pond is seen by whoever stands there', () => {
  const w = createWorld(1)
  act(w, PIP_ID, { action: 'move_to', params: { target: 'the pond' } }); character(w, PIP_ID).busyUntil = 0
  const r = act(w, PIP_ID, { action: 'leave_note', params: { text: 'Gone fishing' } })
  expect(r.success).toBe(true)
  const pond = w.features.find((f) => f.kind === 'pond')!
  const there = addInhabitant(w, 'Mo', pond.at); const away = addInhabitant(w, 'Fen', { x: pond.at.x + 5, y: pond.at.y })
  expect(observe(w, there.id).notes).toEqual(['A note at the pond from Pip: "Gone fishing"'])
  expect(observe(w, away.id).notes).toEqual([])
})
test('an empty note is refused', () => {
  const r = act(createWorld(1), PIP_ID, { action: 'leave_note', params: { text: '  ' } })
  expect(r).toMatchObject({ success: false, message: 'You have nothing to write.' })
})
test('notes beyond forty push out the oldest', () => {
  const w = createWorld(1)
  for (let i = 0; i < 41; i++) {
    character(w, PIP_ID).busyUntil = 0
    expect(act(w, PIP_ID, { action: 'leave_note', params: { text: `note ${i}` } }).success).toBe(true)
  }
  expect(w.notes).toHaveLength(40); expect(w.notes[0].text).toBe('note 1')
})
test('an inhabitant is not offered building moves and learns Pip built the town', () => {
  const w = createWorld(1); const mo = addInhabitant(w, 'Mo', { x: 3, y: 3 })
  const offered = names(observe(w, mo.id))
  expect(offered).toEqual(expect.arrayContaining(['move_to', 'look_at', 'speak', 'leave_note', 'wait']))
  expect(offered).not.toContain('start_building'); expect(observe(w, mo.id).cannot.join()).not.toContain('start_building')
  expect(manifest('inhabitant').description).toContain('Pip, a seedling, built everything else here')
  expect(manifest('inhabitant').moves.map((m) => m.name)).not.toContain('start_building')
  expect(observe(w, mo.id).home).toBe('You have no home.')
  expect(observe(w, PIP_ID).home).toBe('')
})
test('everyone sees who else is around', () => {
  const w = createWorld(1); const pip = character(w, PIP_ID)
  const mo = addInhabitant(w, 'Mo', { x: pip.at.x + 2, y: pip.at.y }); mo.asleep = true
  expect(observe(w, PIP_ID).people).toEqual(['Mo, a few steps away, asleep'])
  expect(observe(w, mo.id).people).toEqual(['Pip, a few steps away, idle'])
})
test('Pip can walk to an inhabitant by name', () => {
  const w = createWorld(1); const mo = addInhabitant(w, 'Mo', { x: 3, y: 3 })
  expect(act(w, PIP_ID, { action: 'move_to', params: { target: 'mo' } }).success).toBe(true)
  expect(character(w, PIP_ID).at).toEqual(mo.at)
})
test('a home tells an inhabitant who built it and who lives there', () => {
  const w = createWorld(1)
  w.buildings.push({ id: 'b1', name: 'Burrow', purpose: 'home', about: 'a snug home', at: { x: 2, y: 2 }, workLeft: 0, workTotal: 3, startedDay: 1, facility: null, builtBy: 'origin', closed: false, repairLeft: 0,
    recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'flat', roofColour: 'red', door: true, windows: 0, sign: '', extras: [] } })
  const mo = addInhabitant(w, 'Mo', { x: 2, y: 2 }); mo.homeId = 'b1'
  const r = act(w, mo.id, { action: 'look_at', params: { target: 'Burrow' } })
  expect(r.message).toBe('Burrow: a snug home. Pip built it. Home to Mo.')
  expect(observe(w, mo.id).home).toBe('Your home is Burrow.')
  character(w, PIP_ID).busyUntil = 0
  expect(act(w, PIP_ID, { action: 'look_at', params: { target: 'Burrow' } }).message).toBe('Burrow: a snug home. You built it. Home to Mo.')
})
test('every result says who heard it and what it leaves behind', () => {
  const r = act(createWorld(1), PIP_ID, { action: 'wait', params: {} })
  expect(r).toMatchObject({ heardBy: [], leaves: [], created: null })
  const refused = act(createWorld(1), PIP_ID, { action: 'fly', params: {} })
  expect(refused).toMatchObject({ heardBy: [], leaves: [], created: null })
})
