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
