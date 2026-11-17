import { advance, character, PIP_ID } from '../../src/world/world.ts'
import { runTurn, runReflection, performQueued } from '../../src/town/turn.ts'
import { ModelError } from '../../src/model/client.ts'
import { deps } from './helpers.ts'

const eat = '{"consider":"peckish","do":[{"action":"eat","params":{"target":"the berry bush"}}],"because":"food","remember":{"text":"the berries are sour","kind":"fact"}}'

test('a turn acts, records everything, remembers and spends', async () => {
  const d = deps([eat]); character(d.world, PIP_ID).body.hunger = 0.7
  const out = await runTurn(d, PIP_ID)
  expect(out.results[0].success).toBe(true)
  const row = d.store.getTurn(out.turnId)!
  expect(row.rawReply).toBe(eat); expect(row.systemPrompt).toContain('You are Pip')
  expect(JSON.parse(row.results)[0].success).toBe(true); expect(row.allowance).toBeCloseTo(0.01)
  expect(d.store.memories(PIP_ID)[0].text).toBe('the berries are sour')
  expect(d.store.beliefs(PIP_ID)[0].text).toContain('lifts me')
  expect(d.store.spentBetween(0, d.now() + 1)).toBeCloseTo(0.01)
  expect(d.store.loadWorld()!.characters[0].body.hunger).toBeCloseTo(0.05)
})
test('one thought can hold several moves; the later ones happen without thinking again', async () => {
  const d = deps(['{"do":[{"action":"look_at","params":{"target":"the pond"}},{"action":"speak","params":{"text":"cold"}},{"action":"fly","params":{}}]}'])
  const first = await runTurn(d, PIP_ID)
  expect(first.results).toHaveLength(1); expect(character(d.world, PIP_ID).queue).toHaveLength(2)
  advance(d.world, first.results[0].minutes)
  expect(performQueued(d, PIP_ID)!.results[0].success).toBe(true)        // speak
  expect(character(d.world, PIP_ID).said).toBe('cold')
  advance(d.world, 2)
  expect(performQueued(d, PIP_ID)!.results[0].success).toBe(false)       // fly is refused and empties the queue
  expect(character(d.world, PIP_ID).queue).toEqual([])
  expect(performQueued(d, PIP_ID)).toBeNull()
  expect(JSON.parse(d.store.getTurn(first.turnId)!.results)).toHaveLength(3)
  expect(d.model.requests).toHaveLength(1)
})
test('an unreadable reply is asked for once more, then Pip waits', async () => {
  const d = deps(['nonsense', 'still nonsense'])
  const out = await runTurn(d, PIP_ID)
  expect(d.model.requests).toHaveLength(2)
  expect(JSON.parse(d.store.getTurn(out.turnId)!.decision).moves[0].action).toBe('wait')
  expect(d.store.spentBetween(0, d.now() + 1)).toBeCloseTo(0.02)       // both replies cost allowance
})
// Review Focus 2
test('a move that is not on offer is refused, recorded, and does not crash', async () => {
  const d = deps(['{"do":[{"action":"fly","params":{}}]}'])
  const out = await runTurn(d, PIP_ID)
  expect(out.results[0].success).toBe(false)
  expect(d.store.getTurn(out.turnId)).not.toBeNull()
  expect(d.store.beliefs(PIP_ID)[0].text).toContain('keeps going wrong')
})
test('a model failure records nothing and spends nothing', async () => {
  const d = deps([new ModelError('down')])
  await expect(runTurn(d, PIP_ID)).rejects.toBeInstanceOf(ModelError)
  expect(d.store.lastTurnId(PIP_ID)).toBe(0); expect(d.store.spentBetween(0, d.now() + 1)).toBe(0)
})
test('a reflection writes a diary entry that points at its turns', async () => {
  const d = deps([eat, '{"diary":"Ate berries. Sour.","memories":[],"mind":[{"kind":"want","text":"sweeter berries"}],"done":[]}'])
  const t = await runTurn(d, PIP_ID)
  const id = await runReflection(d, PIP_ID, false)
  expect(d.store.diaryEntry(id!)).toMatchObject({ text: 'Ate berries. Sour.', fromTurn: t.turnId, toTurn: t.turnId })
  expect(d.store.openMindItems(PIP_ID)[0].text).toBe('sweeter berries')
  expect(await runReflection(d, PIP_ID, false)).toBeNull()             // nothing new; no model call
  expect(d.model.requests).toHaveLength(2)
})

// ---- Final review fixes ----
const charged = (text: string) => ({ requests: 0, async complete() { this.requests++
  return { text, usage: { allowance: 0.01, inputTokens: 1, outputTokens: 1, billingSource: 'balance' } } } })
const waitReply = '{"consider":"hm","do":[{"action":"wait","params":{}}],"because":"."}'

test('I1: a reply charged to balance is not followed by a second ask', async () => {
  const d = deps([]); const model = charged('nonsense')
  const out = await runTurn({ ...d, model }, PIP_ID)
  expect(model.requests).toBe(1)
  expect(JSON.parse(d.store.getTurn(out.turnId)!.decision).moves[0].action).toBe('wait')
})
test('I1: no reflection is asked for when the budget says no', async () => {
  const d = deps([eat, 'unused']); await runTurn(d, PIP_ID)
  d.store.setFlag('halt', 'charged_to_balance')
  expect(await runReflection(d, PIP_ID, false)).toBeNull()
  expect(d.model.requests).toHaveLength(1)
})
test('I2: an unreadable reflection is not asked about the same turns again', async () => {
  const d = deps([eat, 'nonsense', 'unused']); await runTurn(d, PIP_ID)
  expect(await runReflection(d, PIP_ID, false)).toBeNull()
  expect(await runReflection(d, PIP_ID, false)).toBeNull()
  expect(d.model.requests).toHaveLength(2)
})
test('I2: a reflection looks back over at most twelve turns', async () => {
  const d = deps([...Array(15).fill(waitReply), '{"diary":"Busy.","memories":[],"mind":[],"done":[]}'])
  const ids: number[] = []
  for (let i = 0; i < 15; i++) ids.push((await runTurn(d, PIP_ID)).turnId)
  const id = await runReflection(d, PIP_ID, false)
  expect(d.model.requests.at(-1)!.user.match(/you thought:/g)).toHaveLength(12)
  expect(d.store.diaryEntry(id!)).toMatchObject({ fromTurn: ids[3], toTurn: ids[14] })
})
test('I2: the things on Pip\'s mind are kept to twelve, newest kept', async () => {
  const d = deps([])
  for (let round = 0; round < 6; round++) {
    const mind = [0, 1, 2].map(i => ({ kind: 'want', text: `want ${round}-${i}` }))
    const model = { async complete(req: { system: string }) {
      const text = req.system.includes('You keep a diary') ? JSON.stringify({ diary: 'x', memories: [], mind, done: [] }) : waitReply
      return { text, usage: { allowance: 0, inputTokens: 0, outputTokens: 0, billingSource: 'go' } } } }
    await runTurn({ ...d, model }, PIP_ID); await runReflection({ ...d, model }, PIP_ID, false)
  }
  const open = d.store.openMindItems(PIP_ID)
  expect(open).toHaveLength(12)
  expect(open[0].text).toBe('want 5-2'); expect(open.some(i => i.text.startsWith('want 0-'))).toBe(false)
})
test('I4: nothing is asked of the model when the database cannot be written', async () => {
  const d = deps([waitReply])
  const broken = { ...d.store, setFlag() { throw new Error('disk full') }, addSpend() { throw new Error('disk full') },
    addTurn() { throw new Error('disk full') }, saveWorld() { throw new Error('disk full') } }
  await expect(runTurn({ ...d, store: broken }, PIP_ID)).rejects.toThrow('disk full')
  expect(d.model.requests).toHaveLength(0)
})
