import { createWorld, PIP_ID } from '../../src/world/world.ts'
import { observe } from '../../src/world/seam.ts'
import { openStore } from '../../src/store/store.ts'
import { recall, beliefFor, tidyMemories } from '../../src/mind/memory.ts'

const mem = (id: number, text: string, strength = 1, since = 0) =>
  ({ id, characterId: 'pip', text, kind: 'fact' as const, strength, recalled: 0, sinceMinutes: since, lastRecalledMinutes: 0 })

test('recall prefers memories that share words with what is in front of Pip', () => {
  const o = { ...observe(createWorld(1), PIP_ID), room: 'the pond, a few steps away' }
  const got = recall([mem(1, 'the sky was grey'), mem(2, 'the pond is cold'), mem(3, 'strong one', 3)], o, 2)
  expect(got.map(m => m.id)).toEqual([3, 2])
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
