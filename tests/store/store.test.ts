import { openStore } from '../../src/store/store.ts'
import { createWorld } from '../../src/world/world.ts'

const turn = (over = {}) => ({ characterId: 'pip', kind: 'turn' as const, realTs: 1, worldMinutes: 400,
  observation: '{}', systemPrompt: 's', userPrompt: 'u', rawReply: 'r', decision: '{}', results: '[]',
  model: 'm', allowance: 0.01, inputTokens: 10, outputTokens: 5, ...over })

test('a world survives being saved and loaded', () => {
  const s = openStore(':memory:'); expect(s.loadWorld()).toBeNull()
  const w = createWorld(4); s.saveWorld(w); expect(s.loadWorld()).toEqual(w)
})
test('turns are kept in full and reflections are left out of ranges', () => {
  const s = openStore(':memory:')
  const a = s.addTurn(turn()); s.addTurn(turn({ kind: 'reflection' })); const c = s.addTurn(turn())
  expect(s.getTurn(a)).toMatchObject({ id: a, rawReply: 'r', allowance: 0.01 })
  s.setTurnResults(a, '[1]'); expect(s.getTurn(a)!.results).toBe('[1]')
  expect(s.turnsBetween('pip', a, c).map(t => t.id)).toEqual([a, c])
  expect(s.lastTurnId('pip')).toBe(c); expect(s.lastTurnId('nobody')).toBe(0)
})
test('memories are touched, strengthened and dropped', () => {
  const s = openStore(':memory:')
  const id = s.addMemory({ characterId: 'pip', text: 'the pond is cold', kind: 'fact', sinceMinutes: 400 })
  s.touchMemories([id], 500); s.strengthen([id])
  expect(s.memories('pip')[0]).toMatchObject({ strength: 2, recalled: 1, lastRecalledMinutes: 500 })
  s.dropMemories([id]); expect(s.memories('pip')).toEqual([])
})
test('beliefs gather evidence', () => {
  const s = openStore(':memory:')
  s.bumpBelief('pip', 'eat:lifts', 'Eating lifts me.'); s.bumpBelief('pip', 'eat:lifts', 'Eating lifts me.')
  expect(s.beliefs('pip')).toEqual([{ characterId: 'pip', key: 'eat:lifts', text: 'Eating lifts me.', evidence: 2 }])
})
test('mind items open and close', () => {
  const s = openStore(':memory:')
  const id = s.addMindItem({ characterId: 'pip', kind: 'want', text: 'a roof', sinceMinutes: 400 })
  expect(s.openMindItems('pip')).toHaveLength(1); s.closeMindItems([id]); expect(s.openMindItems('pip')).toEqual([])
})
test('diary pages newest first', () => {
  const s = openStore(':memory:')
  const a = s.addDiary({ characterId: 'pip', worldMinutes: 400, text: 'one', fromTurn: 1, toTurn: 2 })
  const b = s.addDiary({ characterId: 'pip', worldMinutes: 800, text: 'two', fromTurn: 3, toTurn: 4 })
  expect(s.diary('pip', 10).map(e => e.id)).toEqual([b, a])
  expect(s.diary('pip', 10, b).map(e => e.id)).toEqual([a])
  expect(s.diaryEntry(a)!.text).toBe('one')
})
test('the ledger sums and averages', () => {
  const s = openStore(':memory:'); expect(s.averageSpend(5)).toBe(0)
  s.addSpend(100, 'pip', 0.02); s.addSpend(200, 'pip', 0.04)
  expect(s.spentBetween(0, 150)).toBeCloseTo(0.02); expect(s.averageSpend(5)).toBeCloseTo(0.03)
})
test('flags', () => {
  const s = openStore(':memory:'); expect(s.getFlag('halt')).toBeNull()
  s.setFlag('halt', 'x'); expect(s.getFlag('halt')).toBe('x'); s.setFlag('halt', null); expect(s.getFlag('halt')).toBeNull()
})

test('spending can be counted for one character or everyone else', () => {
  const s = openStore(':memory:'); s.addSpend(1, 'pip', 0.5); s.addSpend(2, 'c4', 0.1); s.addSpend(3, 'c5', 0.3)
  expect(s.spentBetween(0, 10, { only: 'pip' })).toBeCloseTo(0.5)
  expect(s.spentBetween(0, 10, { except: 'pip' })).toBeCloseTo(0.4)
  expect(s.spentBetween(0, 10)).toBeCloseTo(0.9)
  expect(s.averageSpend(5, { except: 'pip' })).toBeCloseTo(0.2)
  expect(s.averageSpend(5, { only: 'pip' })).toBeCloseTo(0.5)
  expect(s.spendCount({ except: 'pip' })).toBe(2); expect(s.spendCount()).toBe(3)
})
