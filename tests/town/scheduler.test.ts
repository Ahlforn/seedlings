import { createScheduler } from '../../src/town/scheduler.ts'
import { character, PIP_ID } from '../../src/world/world.ts'
import { scriptedClient } from '../../src/model/scripted.ts'
import { ModelError } from '../../src/model/client.ts'
import { deps } from './helpers.ts'

const worldMinutesCap = (2 * 5000) * 4 / 60000
const wait = '{"consider":"hm","do":[{"action":"wait","params":{}}],"because":"."}'

test('time passes and Pip thinks when free, at the budget pace', async () => {
  const d = deps([wait, wait, wait]); const s = createScheduler(d)
  await s.step(5000); expect(d.model.requests).toHaveLength(1)        // thinks at once on start
  expect(d.world.minutes).toBeCloseTo(360 + 5000 * 4 / 60000)
  d.clock.t += 5000; await s.step(5000); expect(d.model.requests).toHaveLength(1)   // too soon
  d.clock.t += d.budget.status().intervalMs
  for (let i = 0; i < 60; i++) await s.step(10_000)                   // lets the 15-minute wait finish
  expect(d.model.requests.length).toBeGreaterThanOrEqual(2)
  expect(s.lastThought()).toBe('hm')
})
test('a sleeping Pip does not think', async () => {
  const d = deps([wait]); character(d.world, PIP_ID).asleep = true; character(d.world, PIP_ID).body.tiredness = 0.9
  const s = createScheduler(d); await s.step(5000)
  expect(d.model.requests).toHaveLength(0)
})
test('no thinking when the budget says no', async () => {
  const d = deps([wait]); d.store.setFlag('halt', 'charged_to_balance')
  await createScheduler(d).step(5000); expect(d.model.requests).toHaveLength(0)
})
// Review Focus 3
test('provider failures back off and the world keeps ticking', async () => {
  const d = deps([new ModelError('down'), new ModelError('down'), wait]); const s = createScheduler(d)
  await s.step(5000); const m1 = d.world.minutes
  d.clock.t += 30_000; await s.step(5000)
  expect(d.model.requests).toHaveLength(1)                            // still backing off after 30 s
  expect(d.world.minutes).toBeGreaterThan(m1)
  d.clock.t += 31_000; await s.step(5000); expect(d.model.requests).toHaveLength(2)   // retried after 60 s
  d.clock.t += 100_000; await s.step(5000); expect(d.model.requests).toHaveLength(2)  // now waits 120 s
  d.clock.t += 21_000; await s.step(5000); expect(d.model.requests).toHaveLength(3)
  expect(d.store.spentBetween(0, d.clock.t + 1)).toBeCloseTo(0.01)
})
// Review Focus 1
test('a restart resumes without jumping time or losing work', async () => {
  const d = deps([wait]); const s1 = createScheduler(d)
  d.world.buildings.push({ id: 'b1', name: 'Half', purpose: 'home', about: '', at: { x: 2, y: 2 }, workLeft: 1, workTotal: 2,
    startedDay: 1, recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'flat', roofColour: 'red', door: true, windows: 0, sign: '', extras: [] } })
  await s1.step(5000); const before = d.world.minutes
  d.clock.t += 6 * 3_600_000                                          // six hours of downtime
  const reloaded = d.store.loadWorld()!
  const s2 = createScheduler({ ...d, world: reloaded, model: scriptedClient([wait]) })
  await s2.step(6 * 3_600_000)                                        // a careless caller passes the whole gap
  expect(reloaded.minutes - before).toBeLessThanOrEqual(worldMinutesCap + 1e-9)
  expect(reloaded.buildings[0]).toMatchObject({ name: 'Half', workLeft: 1 })
})
test('falling asleep triggers the end-of-day diary', async () => {
  const sleep = '{"consider":"tired","do":[{"action":"sleep","params":{"target":"the hollow tree"}}],"because":"night"}'
  const d = deps([sleep, '{"diary":"A long first day.","memories":[],"mind":[],"done":[]}'])
  character(d.world, PIP_ID).body.tiredness = 0.8; d.world.minutes = 22 * 60
  await createScheduler(d).step(5000)
  expect(d.store.diary(PIP_ID, 5)[0].text).toBe('A long first day.')
})
test('listeners hear about every step and can leave', async () => {
  const d = deps([wait]); const s = createScheduler(d); let n = 0
  const off = s.onChange(() => n++); await s.step(5000); off(); await s.step(5000); expect(n).toBe(1)
})
test('the first diary entry waits four in-world hours like any other', async () => {
  const d = deps([wait, wait, wait, wait]); const s = createScheduler(d)
  for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < 30; i++) await s.step(10_000)                 // 20 in-world minutes: the wait finishes
    d.clock.t += d.budget.status().intervalMs
  }
  for (let i = 0; i < 30; i++) await s.step(10_000)
  expect(d.store.lastTurnId(PIP_ID)).toBeGreaterThanOrEqual(3)        // three turns, about an hour in
  expect(d.model.requests).toHaveLength(d.store.lastTurnId(PIP_ID))   // and no reflection was asked for
})

// ---- Final review fixes ----
const sleepReply = '{"consider":"tired","do":[{"action":"sleep","params":{"target":"the hollow tree"}}],"because":"night"}'
const diaryReply = '{"diary":"A day.","memories":[],"mind":[],"done":[]}'
const free = (d: ReturnType<typeof deps>) => { const p = character(d.world, PIP_ID); p.asleep = false; p.busyUntil = 0; p.queue = [] }
const halfBuilt = (d: ReturnType<typeof deps>) => d.world.buildings.push({ id: 'b1', name: 'Half', purpose: 'home', about: '', at: { x: 12, y: 12 },
  workLeft: 1, workTotal: 2, startedDay: 1, recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'flat', roofColour: 'red', door: true, windows: 0, sign: '', extras: [] } })
const work = '{"consider":"build","do":[{"action":"work_on","params":{"target":"Half"}}],"because":"."}'

test('I2: a failing reflection does not make Pip think faster', async () => {
  const d = deps([work, new ModelError('rate limited', 429), wait, diaryReply, wait]); halfBuilt(d)
  const s = createScheduler(d)
  await s.step(5000)                                                   // turn finishes the building; the reflection fails
  expect(d.model.requests).toHaveLength(2)
  free(d); d.clock.t += 120_000; await s.step(5000)                    // past any 60 s backoff, well inside the thinking interval
  expect(d.model.requests).toHaveLength(2)
  expect(s.trouble()).toContain('rate limited')
  free(d); d.clock.t += d.budget.status().intervalMs; await s.step(5000)   // the next turn comes at the budget's pace, and the diary is retried
  expect(d.model.requests).toHaveLength(4)
  expect(d.store.diary(PIP_ID, 5)).toHaveLength(1)
  expect(s.trouble()).toBe('')
})
test('I5: retry-after cannot shorten the backoff, and cannot stall thinking for hours', async () => {
  const d = deps([new ModelError('slow down', 429, 1000), new ModelError('go away', 429, 10 * 3_600_000), wait]); const s = createScheduler(d)
  await s.step(5000)
  d.clock.t += 30_000; await s.step(5000); expect(d.model.requests).toHaveLength(1)     // 1 s was asked for; 60 s is kept
  d.clock.t += 31_000; await s.step(5000); expect(d.model.requests).toHaveLength(2)
  d.clock.t += 29 * 60_000; await s.step(5000); expect(d.model.requests).toHaveLength(2)
  d.clock.t += 61_000; await s.step(5000); expect(d.model.requests).toHaveLength(3)     // ten hours was asked for; 30 min is the most
})
test('I8: an unexpected error is treated like a provider failure', async () => {
  const d = deps([new Error('boom'), wait]); const s = createScheduler(d)
  await expect(s.step(5000)).resolves.toBeUndefined()
  expect(s.trouble()).toContain('boom')
  d.clock.t += 30_000; await s.step(5000); expect(d.model.requests).toHaveLength(1)
  d.clock.t += 31_000; await s.step(5000); expect(d.model.requests).toHaveLength(2)
})
test('I4: a restart does not think sooner than the pace allows', async () => {
  const d = deps([wait]); await createScheduler(d).step(5000)
  expect(d.model.requests).toHaveLength(1)
  const model = scriptedClient([wait]); const world = d.store.loadWorld()!
  const again = createScheduler({ ...d, world, model })
  world.characters[0].busyUntil = 0; d.clock.t += 10_000; await again.step(5000)
  expect(model.requests).toHaveLength(0)
  d.clock.t += d.budget.status().intervalMs; await again.step(5000)
  expect(model.requests).toHaveLength(1)
})
test('I4: a database that cannot be written stops the asking, not the town', async () => {
  const d = deps([wait, wait, wait])
  const fail = () => { throw new Error('disk full') }
  const broken = { ...d.store, setFlag: fail, addSpend: fail, addTurn: fail, saveWorld: fail, setTurnResults: fail }
  const s = createScheduler({ ...d, store: broken })
  for (let i = 0; i < 5; i++) { await expect(s.step(5000)).resolves.toBeUndefined(); d.clock.t += 3_600_000 }
  expect(d.model.requests).toHaveLength(0)
  expect(s.trouble()).toContain('disk full')
})
test('I3: going back to sleep the same night does not write a second end-of-day entry', async () => {
  const d = deps([sleepReply, diaryReply, sleepReply, diaryReply]); const s = createScheduler(d)
  d.world.minutes = 22 * 60; character(d.world, PIP_ID).body.tiredness = 0.8
  await s.step(5000)
  expect(d.model.requests.at(-1)!.user).toContain('The day is ending')
  free(d); character(d.world, PIP_ID).body.tiredness = 0.5; d.clock.t += d.budget.status().intervalMs
  await s.step(5000)
  expect(d.model.requests).toHaveLength(3)                             // sleep, diary, sleep: no second diary
  expect(d.store.diary(PIP_ID, 5)).toHaveLength(1)
})
test('I3: a daytime nap is not the end of the day', async () => {
  const d = deps([sleepReply, diaryReply]); const s = createScheduler(d)
  d.world.minutes = 10 * 60; character(d.world, PIP_ID).body.tiredness = 0.5
  await s.step(5000)
  expect(d.model.requests).toHaveLength(1)
  expect(d.store.diary(PIP_ID, 5)).toHaveLength(0)
})
test('I8: a reply charged to balance ends all asking, including the diary', async () => {
  const d = deps([]); let asked = 0
  const model = { async complete() { asked++
    return { text: sleepReply, usage: { allowance: 0.01, inputTokens: 1, outputTokens: 1, billingSource: 'balance' } } } }
  const s = createScheduler({ ...d, model })
  d.world.minutes = 22 * 60; character(d.world, PIP_ID).body.tiredness = 0.8
  await s.step(5000)
  free(d); d.clock.t += 2 * 86_400_000; await s.step(5000); await s.step(5000)
  expect(asked).toBe(1)
})

// ---- Stage 2: a whole town ----
import { addInhabitant } from '../world/helpers.ts'
import type { ModelRequest } from '../../src/model/client.ts'

const SMALL = 'glm-5.3-flash'
const withInhabitants = (d: ReturnType<typeof deps>, n: number) => Array.from({ length: n }, (_, i) => {
  const c = addInhabitant(d.world, ['Mo', 'Fen', 'Dot'][i], character(d.world, PIP_ID).at)
  c.sheet = { name: c.name, you: 'a moth', core: 'Shy.', traits: ['shy'], values: ['quiet'], fears: ['noise'] }
  return c
})
/** Answers each character from its own list, then waits. */
const byWho = (lists: Record<string, string[]>) => scriptedClient([(req: ModelRequest) => lists[req.sessionId]?.shift() ?? wait], true)
const say = (to: string, text: string) => JSON.stringify({ consider: 'talk', do: [{ action: 'speak', params: { to, text } }], because: '.' })
const small = (d: { model: { requests: ModelRequest[] } }) => d.model.requests.filter((r) => r.model === SMALL)
const tick = async (d: ReturnType<typeof deps>, s: ReturnType<typeof createScheduler>, ms = 10_000) => { d.clock.t += ms; await s.step(ms) }

test('an inhabitant thinks with the small model on its own pace', async () => {
  const d = deps([wait, wait]); withInhabitants(d, 1); const s = createScheduler(d)
  await s.step(5000)
  expect(d.model.requests.map((r) => r.model)).toEqual(['glm-5.2', SMALL])
})
test('at most one inhabitant thinks in a step, the most overdue first', async () => {
  const d = deps([wait, wait, wait, wait]); const [a, b] = withInhabitants(d, 2); const s = createScheduler(d)
  await s.step(5000)
  expect(small(d)).toHaveLength(1)
  free(d); await tick(d, s, 1000)
  expect(small(d).map((r) => r.sessionId)).toEqual([a.id, b.id])
})
// Review Focus 1
test('someone spoken to answers sooner, but never within a minute of their last turn', async () => {
  const d = deps([]); const [mo] = withInhabitants(d, 1)
  const twice = JSON.stringify({ consider: 'talk', do: [{ action: 'speak', params: { to: 'Mo', text: 'Hello' } }, { action: 'speak', params: { to: 'Mo', text: 'Still there?' } }], because: '.' })
  const model = byWho({ pip: [twice], [mo.id]: [say('Pip', 'Hi'), say('Pip', 'Yes')] })
  const town = { ...d, model }; const s = createScheduler(town)
  await s.step(5000)                                                   // Pip says hello; Mo, hearing it, answers at once
  expect(small(town)).toHaveLength(1)
  expect(d.budget.status('inhabitants').intervalMs).toBeGreaterThan(120_000)
  for (let i = 0; i < 5; i++) await tick(d, s)                         // Pip's second line comes about 30 s in
  expect(mo.heard.at(-1)?.text ?? d.store.memories(mo.id).at(-1)!.text).toContain('Still there?')
  expect(small(town)).toHaveLength(1)                                  // 50 s after Mo's turn: not yet
  await tick(d, s); await tick(d, s)
  expect(small(town)).toHaveLength(2)                                  // a minute after: Mo answers
})
// Review Focus 1
test('a conversation stops when the day share is spent', async () => {
  const d = deps([]); const [mo] = withInhabitants(d, 1)
  d.store.addSpend(d.clock.t, mo.id, 0.995)                            // the inhabitants' 1.00 is all but gone
  const model = byWho({ pip: [say('Mo', 'Hello'), say('Mo', 'Hello?'), say('Mo', 'Mo?')] })
  const town = { ...d, model }; const s = createScheduler(town)
  for (let i = 0; i < 3; i++) { free(d); await tick(d, s, d.budget.status('origin').intervalMs) }
  expect(model.requests.filter((r) => r.sessionId === PIP_ID).length).toBeGreaterThanOrEqual(3)
  expect(small(town)).toHaveLength(0)
})
// Review Focus 5
test('the small model failing backs off every inhabitant and leaves Pip thinking', async () => {
  const d = deps([]); withInhabitants(d, 2)
  const model = scriptedClient([(req: ModelRequest) => { if (req.model === SMALL) throw new ModelError('down'); return wait }], true)
  const town = { ...d, model }; const s = createScheduler(town)
  await s.step(5000)
  for (let i = 0; i < 5; i++) await tick(d, s)                         // 50 s: everyone is waiting out the first failure
  expect(small(town)).toHaveLength(1)
  expect(s.trouble()).toBe('Inhabitants: down')
  await tick(d, s, 11_000); expect(small(town)).toHaveLength(2)        // after 60 s, one inhabitant tries again
  free(d); await tick(d, s, d.budget.status('origin').intervalMs)
  expect(model.requests.filter((r) => r.sessionId === PIP_ID)).toHaveLength(2)
  expect(d.store.spentBetween(0, d.clock.t + 1, { except: PIP_ID })).toBe(0)
})
test('an inhabitant writes its diary when it goes to bed in the evening, and not at a nap', async () => {
  const d = deps([]); const [mo] = withInhabitants(d, 1)
  character(d.world, PIP_ID).asleep = true; character(d.world, PIP_ID).body.tiredness = 0.9
  const model = byWho({ [mo.id]: [sleepReply, diaryReply] }); const town = { ...d, model }
  mo.body.tiredness = 0.8; d.world.minutes = 22 * 60
  await createScheduler(town).step(5000)
  expect(model.requests.map((r) => r.sessionId)).toEqual([mo.id, mo.id])
  expect(model.requests[1].system).toContain('You are Mo, a moth')
  expect(d.store.diary(mo.id, 5)).toHaveLength(1); expect(d.store.diary(PIP_ID, 5)).toHaveLength(0)

  const e = deps([]); const [fen] = withInhabitants(e, 1)
  character(e.world, PIP_ID).asleep = true; character(e.world, PIP_ID).body.tiredness = 0.9
  const napper = byWho({ [fen.id]: [sleepReply, diaryReply] })
  fen.body.tiredness = 0.5; e.world.minutes = 10 * 60
  await createScheduler({ ...e, model: napper }).step(5000)
  expect(napper.requests).toHaveLength(1); expect(e.store.diary(fen.id, 5)).toHaveLength(0)
})
test('the population the town supports is written into the world', async () => {
  const d = deps([wait]); await createScheduler(d).step(5000); expect(d.world.populationLimit).toBe(1)
})
test('each character has its own last thought', async () => {
  const d = deps([]); const [mo] = withInhabitants(d, 1)
  const model = byWho({ pip: [wait], [mo.id]: ['{"consider":"so quiet","do":[{"action":"wait","params":{}}],"because":"."}'] })
  const s = createScheduler({ ...d, model }); await s.step(5000)
  expect(s.lastThought()).toBe('hm'); expect(s.lastThought(mo.id)).toBe('so quiet')
})

// ---- Final review #2: a conversation borrows only a little ahead of pace ----
test('a day of nonstop talk still leaves Pip thinking in the second half of the day', async () => {
  const d = deps([]); const [mo] = withInhabitants(d, 1); const t0 = d.clock.t
  const times: { who: string; at: number }[] = []
  const model = scriptedClient([(req: ModelRequest) => {
    times.push({ who: req.sessionId, at: d.clock.t })
    return req.sessionId === PIP_ID ? say('Mo', 'And then?') : say('Pip', 'Go on.')
  }], true)
  const s = createScheduler({ ...d, model })
  for (let i = 0; i < 8640; i++) await tick(d, s)                     // one real day in 10 s steps
  const pip = times.filter((t) => t.who === PIP_ID)
  expect(pip.filter((t) => t.at < t0 + 2 * 3_600_000).length).toBeLessThan(30)
  expect(pip.filter((t) => t.at >= t0 + 12 * 3_600_000).length).toBeGreaterThan(10)
  expect(times.filter((t) => t.who === mo.id && t.at >= t0 + 12 * 3_600_000).length).toBeGreaterThan(10)
}, 60_000)
test('someone who only overhears is not hurried', async () => {
  const d = deps([]); const [mo, fen] = withInhabitants(d, 2)
  const model = byWho({ pip: [say('Mo', 'Hello'), say('Mo', 'Hello again')], [mo.id]: [say('Pip', 'Hi'), say('Pip', 'Hi again')], [fen.id]: [say('anyone', 'Hm.'), say('anyone', 'Hm.')] })
  const town = { ...d, model }; const s = createScheduler(town)
  await s.step(5000)                                                   // Pip greets Mo; Mo (most overdue) answers
  free(d); await tick(d, s, 1000)                                      // Fen's first turn
  const fenTurns = () => small(town).filter((r) => r.sessionId === fen.id).length
  expect(fenTurns()).toBe(1)
  for (let i = 0; i < 12; i++) await tick(d, s)                        // two minutes: Pip speaks to Mo again within Fen's earshot
  expect(model.requests.filter((r) => r.sessionId === PIP_ID).length).toBeGreaterThanOrEqual(2)
  expect(fenTurns()).toBe(1)
})

// ---- Final review #3: a bedtime diary that cannot be written then is owed, not lost ----
const isDiary = (r: ModelRequest) => r.system.includes('You keep a diary')
const bedtime = (d: ReturnType<typeof deps>) => {
  const pip = character(d.world, PIP_ID); pip.asleep = true; pip.body.tiredness = 0.9
  d.world.minutes = 22 * 60
}
test('a bedtime diary missed because the share was spent is written once the new day begins', async () => {
  const d = deps([]); const [mo] = withInhabitants(d, 1); bedtime(d); mo.body.tiredness = 0.8
  for (let i = 0; i < 99; i++) d.store.addSpend(d.clock.t, mo.id, 0.01)   // room for exactly one more inhabitant call today
  const model = byWho({ [mo.id]: [sleepReply, diaryReply] }); const s = createScheduler({ ...d, model })
  await s.step(5000)
  expect(model.requests.filter(isDiary)).toHaveLength(0)
  expect(mo.asleep).toBe(true)
  await tick(d, s, 86_400_000 - (d.clock.t % 86_400_000) + 1000)          // just past midnight UTC
  expect(model.requests.filter(isDiary)).toHaveLength(1)
  expect(model.requests.filter(isDiary)[0].user).toContain('The day is ending')
  expect(d.store.diary(mo.id, 5)).toHaveLength(1)
  await tick(d, s); expect(model.requests.filter(isDiary)).toHaveLength(1) // and only once
})
test('a bedtime diary whose call failed is tried again', async () => {
  const d = deps([]); const [mo] = withInhabitants(d, 1); bedtime(d); mo.body.tiredness = 0.8
  const model = byWho({ [mo.id]: [sleepReply, diaryReply] }); let failed = false
  const flaky = { requests: model.requests, async complete(req: ModelRequest) {
    if (isDiary(req) && !failed) { failed = true; model.requests.push(req); throw new ModelError('busy', 503) }
    return model.complete(req) } }
  const s = createScheduler({ ...d, model: flaky })
  await s.step(5000)
  expect(model.requests.filter(isDiary)).toHaveLength(1); expect(d.store.diary(mo.id, 5)).toHaveLength(0)
  await tick(d, s, 61_000)
  expect(d.store.diary(mo.id, 5)).toHaveLength(1)
})
test('no diary is asked of a model the tier is backing off from', async () => {
  const d = deps([]); const [mo, fen] = withInhabitants(d, 2); bedtime(d)
  const night = JSON.stringify({ consider: 'late', do: [{ action: 'speak', params: { text: 'Night.' } }, { action: 'sleep', params: { target: 'the hollow tree' } }], because: '.' })
  mo.body.tiredness = 0.8; let fenFailed = false
  const model = scriptedClient([(req: ModelRequest) => {
    if (req.sessionId === fen.id && !isDiary(req) && !fenFailed) { fenFailed = true; throw new ModelError('down') }
    if (isDiary(req)) return diaryReply
    return req.sessionId === mo.id ? night : wait
  }], true)
  const s = createScheduler({ ...d, model })
  await s.step(5000)                                                     // Mo: "Night." then sleep, queued
  await tick(d, s, 1000)                                                 // Fen's call fails: the small model is backed off
  for (let i = 0; i < 4; i++) await tick(d, s)                          // Mo's queued sleep happens in here
  expect(mo.asleep).toBe(true)
  expect(model.requests.filter(isDiary)).toHaveLength(0)
  await tick(d, s, 30_000)                                              // past the minute's wait
  expect(model.requests.filter(isDiary)).toHaveLength(1); expect(d.store.diary(mo.id, 5)).toHaveLength(1)
})
