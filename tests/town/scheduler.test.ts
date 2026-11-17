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
