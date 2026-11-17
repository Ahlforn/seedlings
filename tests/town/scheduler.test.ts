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
  character(d.world, PIP_ID).body.tiredness = 0.8
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
