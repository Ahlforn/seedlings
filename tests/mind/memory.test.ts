import { createWorld, PIP_ID } from '../../src/world/world.ts'
import { observe } from '../../src/world/seam.ts'
import { openStore } from '../../src/store/store.ts'
import { recall, beliefFor, tidyMemories } from '../../src/mind/memory.ts'

const mem = (id: number, text: string, strength = 1, since = 0) =>
  ({ id, characterId: 'pip', text, kind: 'fact' as const, strength, recalled: 0, sinceMinutes: since, lastRecalledMinutes: 0 })

test('recall prefers memories that share words with what is in front of Pip', () => {
  const o = { ...observe(createWorld(1), PIP_ID), room: 'the pond, a few steps away' }
  const got = recall([mem(1, 'the sky was grey'), mem(2, 'the pond is cold'), mem(3, 'strong one', 3)], o, 2)
  expect(got.map(m => m.id)).toEqual([2, 3])     // the relevant one first, then the newest of the rest
})
test('beliefs come from how a move turned out', () => {
  const r = { success: true, message: '', moodDelta: 0.2, minutes: 1, label: 'eating at the berry bush' }
  expect(beliefFor(r)).toEqual({ key: 'eating at the berry bush:lifts', text: 'Eating at the berry bush lifts me.' })
  expect(beliefFor({ ...r, success: false, moodDelta: -0.05 })!.text).toBe('Eating at the berry bush keeps going wrong.')
  expect(beliefFor({ ...r, moodDelta: 0.03 })).toBeNull()
})
test('tidying strengthens what was recalled and drops the weakest beyond the cap', () => {
  const s = openStore(':memory:')
  const ids = [0, 1, 2, 3, 4].map(i => s.addMemory({ characterId: 'pip', text: `m${i}`, kind: 'fact', sinceMinutes: i }))
  tidyMemories(s, 'pip', [ids[0]], 3)
  const left = s.memories('pip')
  expect(left.map(m => m.id)).toEqual([ids[0], ids[3], ids[4]])
  expect(left[0].strength).toBe(2)
})

// Final review C1: recall must not lock onto a few old, much-recalled memories.
test('a strongly relevant weak memory beats a strong irrelevant one', () => {
  const o = { ...observe(createWorld(1), PIP_ID), room: 'the pond, the berry bush and the hollow tree', recentEvents: [] }
  const got = recall([mem(1, 'something else entirely', 48), mem(2, 'hollow tree by the pond has berry stains')], o, 1)
  expect(got.map(m => m.id)).toEqual([2])
})
test('new memories still surface when old ones have been recalled for weeks', () => {
  const o = { ...observe(createWorld(1), PIP_ID), room: 'nothing much', recentEvents: [] }
  const old = [1, 2, 3, 4, 5].map(i => mem(i, `old habit number ${i}`, 48, i))
  const got = recall([...old, mem(6, 'a stranger waved today', 1, 9000), mem(7, 'the fence fell over', 1, 9500)], o, 5)
  expect(got.map(m => m.id)).toContain(6)
  expect(got.map(m => m.id)).toContain(7)
  expect(got).toHaveLength(5)
})
