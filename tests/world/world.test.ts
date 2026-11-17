import { createWorld, advance, urgency, addEvent, character, PIP_ID } from '../../src/world/world.ts'

test('the plot starts with only natural features and Pip', () => {
  const w = createWorld(1)
  expect(w.buildings).toEqual([])
  expect(w.features.map(f => f.kind).sort()).toEqual(
    ['berry_bush', 'hollow_tree', 'pond', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree'])
  expect(w.characters).toHaveLength(1)
  expect(character(w, PIP_ID)).toMatchObject({ name: 'Pip', tier: 'origin', asleep: false })
})
test('the same seed gives the same world', () => {
  expect(createWorld(7)).toEqual(createWorld(7))
  expect(createWorld(7).features).not.toEqual(createWorld(8).features)
})
test('no two features share a tile', () => {
  const tiles = createWorld(3).features.map(f => `${f.at.x},${f.at.y}`)
  expect(new Set(tiles).size).toBe(tiles.length)
})
test('an hour awake makes Pip hungrier and more tired', () => {
  const w = createWorld(1); advance(w, 60)
  expect(character(w, PIP_ID).body.hunger).toBeCloseTo(0.26, 5)
  expect(character(w, PIP_ID).body.tiredness).toBeCloseTo(0.15, 5)
})
test('a sleeper rests and wakes on its own', () => {
  const w = createWorld(1); const p = character(w, PIP_ID)
  p.asleep = true; p.body.tiredness = 0.5
  advance(w, 240)
  expect(p.asleep).toBe(false)
  expect(w.events.at(-1)!.text).toBe('Pip woke up')
})
test('body values stay in range over a long time', () => {
  const w = createWorld(1); advance(w, 1440 * 5)
  const b = character(w, PIP_ID).body
  expect(b.hunger).toBeLessThanOrEqual(1); expect(b.tiredness).toBeLessThanOrEqual(1)
})
test('urgency words', () => {
  expect([0.1, 0.4, 0.7, 0.9].map(urgency)).toEqual(['satisfied', 'mild', 'strong', 'urgent'])
})
test('only the newest 50 events are kept', () => {
  const w = createWorld(1); for (let i = 0; i < 60; i++) addEvent(w, `e${i}`)
  expect(w.events).toHaveLength(50); expect(w.events.at(-1)!.text).toBe('e59')
})
