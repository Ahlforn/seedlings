import { wanderingClient } from '../../src/model/scripted.ts'
import { readDecision } from '../../src/mind/decision.ts'
import { readReflection } from '../../src/mind/reflect.ts'
import { systemPrompt, whatISee } from '../../src/mind/prompt.ts'
import { PIP_SHEET } from '../../src/mind/sheet.ts'
import { act, manifest, observe } from '../../src/world/seam.ts'
import { advance, character, createWorld, PIP_ID } from '../../src/world/world.ts'

const ask = async (client: ReturnType<typeof wanderingClient>, w: ReturnType<typeof createWorld>) => {
  const o = observe(w, PIP_ID)
  return client.complete({ model: 'fake', system: systemPrompt(manifest('origin'), o, PIP_SHEET), user: whatISee(o, [], [], []), sessionId: 'pip', maxTokens: 400 })
}

test('the wandering stand-in only picks moves the world accepts, costs nothing, and gets a building built', async () => {
  const client = wanderingClient(); const w = createWorld(1)
  for (let i = 0; i < 40; i++) {
    const p = character(w, PIP_ID)
    if (p.asleep) { advance(w, 60); continue }
    const reply = await ask(client, w)
    expect(reply.usage.allowance).toBe(0)
    const decision = readDecision(reply.text)!
    const result = act(w, PIP_ID, decision.moves[0])
    expect(result.success, `${JSON.stringify(decision.moves[0])}: ${result.message}`).toBe(true)
    advance(w, Math.max(result.minutes, 1))
  }
  expect(w.buildings.some(b => b.workLeft === 0)).toBe(true)
})
test('the wandering stand-in writes a diary line when asked to reflect', async () => {
  const reply = await wanderingClient().complete({ model: 'fake', system: 'You are Pip.\n\nYou keep a diary.', user: '', sessionId: 'pip', maxTokens: 500 })
  expect(readReflection(reply.text)!.diary.length).toBeGreaterThan(0)
})

// ---- Stage 2 ----
import { createScheduler } from '../../src/town/scheduler.ts'
import { createBudgetKeeper, DEFAULT_PACING } from '../../src/budget/keeper.ts'
import { deps } from '../town/helpers.ts'

test('a fake town grows a population that talks and leaves notes, and every move it picks is accepted', async () => {
  const d = deps([]); const model = wanderingClient()
  const population = () => d.world.characters.filter((c) => c.tier === 'inhabitant').length
  const budget = createBudgetKeeper(d.store, { monthlyAllowance: 60, periodStartDay: 1, ...DEFAULT_PACING, minIntervalMs: 1000, maxIntervalMs: 1000 }, d.now, population)
  // A fake run reads from the stand-in Wikipedia, as startTown gives it.
  const s = createScheduler({ ...d, model, budget, config: { ...d.config, daysPerRealDay: 480 }, services: { ...d.services, fetchJson: fakeWikipedia() } })
  for (let i = 0; i < 1500 && population() < 2; i++) { d.clock.t += 1000; await s.step(5000) }
  for (let i = 0; i < 300; i++) { d.clock.t += 1000; await s.step(5000) }
  expect(population()).toBeGreaterThanOrEqual(2)
  const turns = d.world.characters.flatMap((c) => d.store.turnsBetween(c.id, 1, d.store.lastTurnId(c.id)))
  const results = turns.flatMap((t) => JSON.parse(t.results) as { success: boolean; message: string }[])
  // A café lookup that finds nothing is the one refusal a fake town is meant to show.
  expect(results.filter((r) => !r.success && !/find nothing about it/.test(r.message)).map((r) => r.message)).toEqual([])
  expect(turns.some((t) => t.decision.includes('"speak"') && !t.decision.includes('"to":"anyone"'))).toBe(true)
  expect(turns.some((t) => t.decision.includes('"leave_note"'))).toBe(true)
}, 30_000)

// ---- Stage 3 ----
import { fakeWikipedia } from '../../src/facilities/cafe/fake.ts'
test('a fake town builds facilities, paints, reads and misses', async () => {
  const d = deps([]); const model = wanderingClient()
  const population = () => d.world.characters.filter((c) => c.tier === 'inhabitant').length
  const budget = createBudgetKeeper(d.store, { monthlyAllowance: 60, periodStartDay: 1, ...DEFAULT_PACING, minIntervalMs: 1000, maxIntervalMs: 1000 }, d.now, population)
  const services = { store: d.store, fetchJson: fakeWikipedia(), now: d.now }
  const s = createScheduler({ ...d, model, budget, services, config: { ...d.config, daysPerRealDay: 480 } })
  const done = () => d.store.gallery(1).length > 0 && d.store.lookupStats().missing > 0 && d.store.lookupStats().total > d.store.lookupStats().missing
  for (let i = 0; i < 6000 && !done(); i++) { d.clock.t += 1000; await s.step(5000) }
  expect(d.world.buildings.some((b) => b.facility === 'art')).toBe(true)
  expect(d.world.buildings.some((b) => b.facility === 'cafe')).toBe(true)
  expect(d.store.gallery(5).length).toBeGreaterThan(0)
  expect(d.store.lookupStats().missing).toBeGreaterThan(0)
  expect(d.store.lookupStats().total).toBeGreaterThan(d.store.lookupStats().missing)
  const turns = d.world.characters.flatMap((c) => d.store.turnsBetween(c.id, 1, d.store.lastTurnId(c.id)))
  const results = turns.flatMap((t) => JSON.parse(t.results) as { success: boolean; message: string }[])
  expect(results.filter((r) => !r.success && !/find nothing about it/.test(r.message)).map((r) => r.message)).toEqual([])
}, 120_000)
test('the stand-in writes a stranger\'s sheet when asked for one', async () => {
  const reply = await wanderingClient().complete({ model: 'fake', system: 'You write a character sheet for someone who has just arrived.', user: 'Who arrives: a baker', sessionId: 'stranger', maxTokens: 400 })
  expect(JSON.parse(reply.text)).toMatchObject({ name: 'Bram', colour: expect.any(String), mark: expect.any(String) })
})
