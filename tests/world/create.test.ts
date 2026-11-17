import { createWorld, character, PIP_ID } from '../../src/world/world.ts'
import { act, observe } from '../../src/world/seam.ts'
import { cleanText } from '../../src/shared/recipe.ts'
import type { Building, World } from '../../src/shared/types.ts'

const sheet = { name: 'Mo', kind: 'a moth', who: 'Mo is shy and notices everything.', traits: 'shy, watchful', cares_about: 'quiet',
  fears: 'loud noises', colour: 'blue', mark: 'antennae', home: 'Burrow' }
let w: World; let burrow: Building
beforeEach(() => {
  w = createWorld(1); w.populationLimit = 3
  burrow = { id: 'b1', name: 'Burrow', purpose: 'home', about: '', at: { x: 2, y: 2 }, workLeft: 0, workTotal: 3, startedDay: 1,
    recipe: { footprint: 1, floors: 2, wall: 'cream', roof: 'flat', roofColour: 'red', door: true, windows: 0, sign: '', extras: [] } }
  w.buildings.push(burrow)
})
const create = (params: Record<string, string>) => { character(w, PIP_ID).busyUntil = 0; return act(w, PIP_ID, { action: 'create_inhabitant', params }) }

test('Pip brings an inhabitant to life in a home with room', () => {
  const r = create(sheet)
  expect(r.success).toBe(true); expect(r.message).toBe('Mo blinks awake at Burrow and looks at you.')
  const mo = character(w, r.created!)
  expect(mo).toMatchObject({ tier: 'inhabitant', name: 'Mo', homeId: burrow.id, at: burrow.at, look: { colour: 'blue', mark: 'antennae' }, asleep: false, heard: [] })
  expect(mo.sheet).toEqual({ name: 'Mo', you: 'a moth', core: 'Mo is shy and notices everything.', traits: ['shy', 'watchful'], values: ['quiet'], fears: ['loud noises'] })
  expect(r.leaves).toContainEqual({ characterId: PIP_ID, text: 'I made Mo. They live at Burrow.', kind: 'person' })
  expect(r.leaves).toContainEqual({ characterId: mo.id, text: 'I opened my eyes at Burrow, and Pip was there.', kind: 'moment' })
  expect(w.events.at(-1)!.text).toBe('Pip made Mo, who will live at Burrow')
  expect(character(w, PIP_ID).at).toEqual(burrow.at)
})
test('the town refuses anyone beyond what it can support', () => {
  w.populationLimit = 0
  expect(observe(w, PIP_ID).available.map((m) => m.name)).not.toContain('create_inhabitant')
  expect(observe(w, PIP_ID).cannot).toContain('create_inhabitant: the town cannot support anyone more yet')
  expect(create(sheet).success).toBe(false)
})
test('a full home is not offered', () => {
  expect(create(sheet).success).toBe(true); expect(create({ ...sheet, name: 'Fen' }).success).toBe(true)
  expect(observe(w, PIP_ID).cannot).toContain('create_inhabitant: there is no finished home with room for someone new')
})
test('lists are trimmed and capped, and a missing kind gets a default', () => {
  const r = create({ ...sheet, kind: '', traits: 'a, b, , c, d, e', fears: 'x,y,z,w' })
  const mo = character(w, r.created!)
  expect(mo.sheet).toMatchObject({ you: 'a small creature', traits: ['a', 'b', 'c', 'd'], fears: ['x', 'y', 'z'] })
})
test('someone with no traits or no description is refused', () => {
  expect(create({ ...sheet, traits: ' , ' }).message).toMatch(/trait/)
  expect(create({ ...sheet, who: '' }).message).toMatch(/who they are/)
  expect(w.characters).toHaveLength(1)
})
// Review Focus 4
test.each(['Pip', 'the pond', 'Burrow', 'anyone', 'a tree', ''])('the name %j is refused in words', (name) => {
  const r = create({ ...sheet, name }); expect(r.success).toBe(false); expect(r.message).toMatch(/name/)
  expect(w.characters).toHaveLength(1)
})
test('two inhabitants cannot share a name', () => {
  create(sheet); const r = create(sheet)
  expect(r).toMatchObject({ success: false, message: 'There is already something called Mo. Choose another name.' })
})
test('a name with markup is kept as plain text', () => {
  const r = create({ ...sheet, name: '<b>Mo</b>' })
  expect(character(w, r.created!).name).toBe(cleanText('<b>Mo</b>', 30))
})
// Review Focus 2
test('pulling down a lived-in home leaves its inhabitants homeless but alive', () => {
  const mo = character(w, create(sheet).created!)
  character(w, PIP_ID).busyUntil = 0
  expect(act(w, PIP_ID, { action: 'pull_down', params: { target: 'Burrow' } }).success).toBe(true)
  expect(mo.homeId).toBeNull()
  expect(w.events.map((e) => e.text)).toContain('Mo no longer has a home')
  expect(observe(w, mo.id).home).toBe('You have no home.')
  mo.body.tiredness = 0.8
  expect(observe(w, mo.id).available.find((m) => m.name === 'sleep')!.params.target).toEqual(['the hollow tree'])
  expect(observe(w, PIP_ID).cannot).toContain('create_inhabitant: there is no finished home with room for someone new')
})
test('inhabitants cannot create inhabitants', () => {
  const mo = character(w, create(sheet).created!); mo.busyUntil = 0
  const r = act(w, mo.id, { action: 'create_inhabitant', params: { ...sheet, name: 'Fen' } })
  expect(r).toMatchObject({ success: false, message: 'That is not something you can do here.' })
})
// Final review #1
test('a colour or mark written in another case, or with "the", is stored as the kit names it', () => {
  const r = create({ ...sheet, colour: 'the Blue', mark: 'Antennae' })
  expect(r.success).toBe(true)
  expect(character(w, r.created!).look).toEqual({ colour: 'blue', mark: 'antennae' })
})
