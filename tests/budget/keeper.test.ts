import { openStore } from '../../src/store/store.ts'
import { createBudgetKeeper, DEFAULT_PACING } from '../../src/budget/keeper.ts'

const DAY = 86_400_000
const t0 = Date.UTC(2026, 10, 1, 0, 0, 0)                     // 1 Nov 2026, 30-day month
const make = (now: { t: number }) => { const store = openStore(':memory:')
  return { store, k: createBudgetKeeper(store, { monthlyAllowance: 60, periodStartDay: 1, ...DEFAULT_PACING }, () => now.t) } }
const used = (allowance: number, billingSource = 'go') => ({ allowance, inputTokens: 0, outputTokens: 0, billingSource })

test('a fresh month gives a thirtieth per day and paces by the seed cost', () => {
  const now = { t: t0 }; const { k } = make(now); const s = k.status()
  expect(s).toMatchObject({ canThink: true, reason: 'ok', leftTodayFraction: 1 })
  expect(s.intervalMs).toBe(DAY / 100)                         // 2.00 share / 0.02 seed cost = 100 turns
})
test('spending shrinks today and stretches the interval', () => {
  const now = { t: t0 + DAY / 2 }; const { k } = make(now)
  for (let i = 0; i < 50; i++) k.record('pip', used(0.02))
  const s = k.status()
  expect(s.leftTodayFraction).toBeCloseTo(0.5)
  expect(s.intervalMs).toBe((DAY / 2) / 50)
})
test('when the day share is gone the town sleeps until midnight', () => {
  const now = { t: t0 + 1000 }; const { k } = make(now)
  for (let i = 0; i < 100; i++) k.record('pip', used(0.02))
  expect(k.status()).toMatchObject({ canThink: false, reason: 'day_share_spent', resumeAt: t0 + DAY })
})
test('unspent share carries over to the remaining days', () => {
  const now = { t: t0 + 10 * DAY }; const { k } = make(now)    // nothing spent in ten days
  expect(k.status().intervalMs).toBe(Math.max(60_000, Math.floor(DAY / 150)))  // 60 / 20 days = 3.00 a day
})
test('the five hour limit holds even if the day share allows more', () => {
  const now = { t: t0 + 20 * DAY }; const { store, k } = make(now)
  store.addSpend(now.t - 3_600_000, 'pip', 11.99)
  expect(k.status()).toMatchObject({ canThink: false, reason: 'five_hour_limit', resumeAt: now.t + 3_600_000 })
})
test('the weekly limit', () => {
  const now = { t: t0 + 20 * DAY }; const { store, k } = make(now)
  store.addSpend(now.t - 2 * DAY, 'pip', 29.99)
  expect(k.status().reason).toBe('weekly_limit')
})
test('a spent month waits for the next period', () => {
  const now = { t: t0 + 20 * DAY }; const { store, k } = make(now)
  store.addSpend(t0 + DAY, 'pip', 60)
  expect(k.status()).toMatchObject({ canThink: false, reason: 'month_spent', resumeAt: Date.UTC(2026, 11, 1) })
})
test('without an allowance figure, cost is estimated from tokens', () => {
  const now = { t: t0 }; const { store, k } = make(now)
  k.record('pip', { allowance: null, inputTokens: 1_000_000, outputTokens: 0, billingSource: null })
  expect(store.spentBetween(0, now.t + 1)).toBeCloseTo(1.4)
})
// Review Focus 4
test('being charged to balance halts thinking until cleared, across restarts', () => {
  const now = { t: t0 }; const { store, k } = make(now)
  k.record('pip', used(0.02, 'balance'))
  expect(k.status()).toMatchObject({ canThink: false, reason: 'charged_to_balance', resumeAt: null })
  const again = createBudgetKeeper(store, { monthlyAllowance: 60, periodStartDay: 1, ...DEFAULT_PACING }, () => now.t)
  expect(again.status().canThink).toBe(false)
  again.clearHalt(); expect(again.status().canThink).toBe(true)
})
test('the interval is clamped', () => {
  const now = { t: t0 + DAY - 5000 }; const { k } = make(now)
  expect(k.status().intervalMs).toBe(60_000)
})

// Final review I6: a renewal day the month does not have.
test('a renewal day of 31 falls on the last day of shorter months', () => {
  const now = { t: Date.UTC(2027, 2, 1) }                       // 1 March 2027
  const store = openStore(':memory:')
  const k = createBudgetKeeper(store, { monthlyAllowance: 60, periodStartDay: 31, ...DEFAULT_PACING }, () => now.t)
  store.addSpend(Date.UTC(2027, 1, 28, 12), 'pip', 58)          // spent on 28 February, the first day of this period
  for (let i = 0; i < 20; i++) store.addSpend(Date.UTC(2027, 1, 28, 13), 'pip', 0)
  expect(k.status().intervalMs).toBe(3_600_000)                 // 2 left over 31 days: almost nothing per day
  store.addSpend(now.t, 'pip', 2)
  expect(k.status()).toMatchObject({ reason: 'month_spent', resumeAt: Date.UTC(2027, 2, 31) })
})
