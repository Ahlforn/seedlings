/**
 * Keeps the town inside its model allowance and sets the pace of thinking.
 * Each day gets an even share of what is left of the month; the share sets how often a mind may think.
 */

import type { ModelUsage } from '../model/client.ts'
import type { SpendPool, Store } from '../store/store.ts'
import { PIP_ID } from '../world/world.ts'

export type BudgetSettings = {
  monthlyAllowance: number
  /** day of the month the allowance renews */
  periodStartDay: number
  minIntervalMs: number
  maxIntervalMs: number
  /** prices used when a provider does not report an allowance figure */
  fallbackInputPerM: number
  fallbackOutputPerM: number
  /** assumed cost of a turn before there is any history */
  seedCost: number
  /** the inhabitants' part of each day's share, once there are any */
  inhabitantShare: number
  /** model calls an inhabitant is expected to make in a real day, for working out how many the town supports */
  turnsPerInhabitantDay: number
  maxPopulation: number
  /** inhabitant calls to see before trusting their average cost; until then the town supports one */
  probeCalls: number
}

export const DEFAULT_PACING = {
  minIntervalMs: 60_000,
  maxIntervalMs: 3_600_000,
  fallbackInputPerM: 1.4,
  fallbackOutputPerM: 4.4,
  seedCost: 0.02,
  inhabitantShare: 0.5,
  turnsPerInhabitantDay: 200,
  maxPopulation: 12,
  probeCalls: 10,
}

/** Whose share: the whole town's, Pip's, or the inhabitants' together. */
export type Pool = 'town' | 'origin' | 'inhabitants'

export type BudgetReason = 'ok' | 'day_share_spent' | 'five_hour_limit' | 'weekly_limit' | 'month_spent' | 'charged_to_balance'
export type BudgetStatus = {
  canThink: boolean
  reason: BudgetReason
  resumeAt: number | null
  leftTodayFraction: number
  intervalMs: number
}
export type BudgetKeeper = {
  record(characterId: string, usage: ModelUsage): void
  /** For the inhabitants, intervalMs is how often each one of them may think. */
  status(pool?: Pool): BudgetStatus
  /** How many inhabitants the town can support. */
  supportable(): number
  clearHalt(): void
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const HALT_FLAG = 'halt'
const WEEK_SHARE = 0.5
const FIVE_HOUR_SHARE = 0.2
const HISTORY = 20

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const POOLS: Record<Pool, SpendPool | undefined> = { town: undefined, origin: { only: PIP_ID }, inhabitants: { except: PIP_ID } }

export function createBudgetKeeper(store: Store, settings: BudgetSettings, now: () => number, population: () => number = () => 0): BudgetKeeper {
  /** The renewal moment in a given month. A renewal day the month does not have falls on its last day. */
  function renewal(year: number, month: number): number {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return Date.UTC(year, month, Math.min(settings.periodStartDay, daysInMonth))
  }

  function period(at: number): { start: number; end: number } {
    const date = new Date(at)
    const year = date.getUTCFullYear()
    let month = date.getUTCMonth()
    if (renewal(year, month) > at) month -= 1
    return { start: renewal(year, month), end: renewal(year, month + 1) }
  }

  return {
    record(characterId, usage) {
      const cost =
        usage.allowance ??
        (usage.inputTokens * settings.fallbackInputPerM + usage.outputTokens * settings.fallbackOutputPerM) / 1_000_000
      store.addSpend(now(), characterId, cost)
      if (usage.billingSource === 'balance') store.setFlag(HALT_FLAG, 'charged_to_balance')
    },

    clearHalt() {
      store.setFlag(HALT_FLAG, null)
    },

    status(pool = 'town') {
      const at = now()
      const dayStart = Math.floor(at / DAY) * DAY
      const dayEnd = dayStart + DAY
      const { start, end } = period(at)
      const monthly = settings.monthlyAllowance
      const whose = POOLS[pool]
      const people = population()

      const spentPeriod = store.spentBetween(start, at + 1)
      const spentTodayTown = store.spentBetween(dayStart, at + 1)
      const daysLeft = Math.max(1, Math.ceil((end - dayStart) / DAY))
      const townShare = Math.max(0, (monthly - (spentPeriod - spentTodayTown)) / daysLeft)
      // Alone, Pip has the whole share; with company, the inhabitants have their part of it.
      const fraction = pool === 'town' ? 1 : people === 0 ? (pool === 'origin' ? 1 : 0) : pool === 'origin' ? 1 - settings.inhabitantShare : settings.inhabitantShare
      const share = townShare * fraction
      const spentToday = whose ? store.spentBetween(dayStart, at + 1, whose) : spentTodayTown
      const leftToday = share - spentToday
      const typical = store.averageSpend(HISTORY, whose) || settings.seedCost

      const turnsLeft = Math.floor(leftToday / typical + 1e-9)
      // The inhabitants' turns are shared between them, so each one waits that much longer.
      const turnsEach = pool === 'inhabitants' ? turnsLeft / Math.max(1, people) : turnsLeft
      const intervalMs = turnsLeft > 0
        ? clamp(Math.floor((dayEnd - at) / turnsEach), settings.minIntervalMs, settings.maxIntervalMs)
        : settings.maxIntervalMs
      const leftTodayFraction = share > 0 ? clamp(leftToday / share, 0, 1) : 0
      const stopped = (reason: BudgetReason, resumeAt: number | null): BudgetStatus =>
        ({ canThink: false, reason, resumeAt, leftTodayFraction, intervalMs })

      if (store.getFlag(HALT_FLAG) !== null) return stopped('charged_to_balance', null)
      if (spentPeriod >= monthly) return stopped('month_spent', end)
      if (store.spentBetween(at - 7 * DAY, at + 1) + typical > WEEK_SHARE * monthly) return stopped('weekly_limit', at + HOUR)
      if (store.spentBetween(at - 5 * HOUR, at + 1) + typical > FIVE_HOUR_SHARE * monthly) return stopped('five_hour_limit', at + HOUR)
      if (turnsLeft < 1) return stopped('day_share_spent', dayEnd)
      return { canThink: true, reason: 'ok', resumeAt: null, leftTodayFraction, intervalMs }
    },

    supportable() {
      const whose = POOLS.inhabitants
      if (store.spendCount(whose) < settings.probeCalls) return Math.max(1, population())
      const { start, end } = period(now())
      const daysInPeriod = Math.max(1, Math.round((end - start) / DAY))
      const perDay = (settings.monthlyAllowance * settings.inhabitantShare) / daysInPeriod
      const typical = store.averageSpend(HISTORY, whose)
      if (typical <= 0) return settings.maxPopulation
      return clamp(Math.floor(perDay / (typical * settings.turnsPerInhabitantDay) + 1e-9), 0, settings.maxPopulation)
    },
  }
}
