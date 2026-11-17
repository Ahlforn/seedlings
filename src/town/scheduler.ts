/** The loop: moves time forward and gives Pip a turn when it is free and the budget allows. */

import { shouldReflect } from '../mind/reflect.ts'
import { ModelError } from '../model/client.ts'
import { worldMinutesFor } from '../world/clock.ts'
import { PIP_ID, advance, character } from '../world/world.ts'
import { performQueued, runReflection, runTurn } from './turn.ts'
import type { TownDeps, TurnOutcome } from './turn.ts'

export type Scheduler = {
  /** Advances the town by this much real time. Exposed so tests can drive it. */
  step(realElapsedMs: number): Promise<void>
  start(): void
  stop(): void
  onChange(fn: () => void): () => void
  lastThought(): string
}

const FIRST_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 30 * 60_000

export function createScheduler(deps: TownDeps): Scheduler {
  const { world, store, budget, config } = deps
  const listeners = new Set<() => void>()
  let nextThinkAt = 0
  let failures = 0
  let finishedSinceDiary = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false

  async function afterMove(outcome: TurnOutcome): Promise<void> {
    if (outcome.finishedBuilding) finishedSinceDiary = true
    const last = store.diary(PIP_ID, 1)[0]
    const turnsSinceLast = store.turnsBetween(PIP_ID, (last?.toTurn ?? 0) + 1, store.lastTurnId(PIP_ID)).length
    const due = shouldReflect({
      minutesSinceLast: world.minutes - (last?.worldMinutes ?? 0),
      turnsSinceLast,
      buildingFinished: finishedSinceDiary,
      goingToSleep: outcome.wentToSleep,
    })
    if (!due) return
    await runReflection(deps, PIP_ID, outcome.wentToSleep)
    finishedSinceDiary = false
  }

  async function step(realElapsedMs: number): Promise<void> {
    // A long gap means the process was stopped or suspended; the town does not live through it.
    const elapsed = Math.min(realElapsedMs, 2 * config.tickMs)
    advance(world, worldMinutesFor(elapsed, config.daysPerRealDay))

    const pip = character(world, PIP_ID)
    try {
      if (!pip.asleep && world.minutes >= pip.busyUntil) {
        if (pip.queue.length > 0) {
          await afterMove(performQueued(deps, PIP_ID)!)
        } else if (deps.now() >= nextThinkAt && budget.status().canThink) {
          const outcome = await runTurn(deps, PIP_ID)
          failures = 0
          nextThinkAt = deps.now() + budget.status().intervalMs
          await afterMove(outcome)
        }
      }
    } catch (error) {
      failures += 1
      const retryAfter = error instanceof ModelError ? error.retryAfterMs : null
      const backoff = retryAfter ?? Math.min(FIRST_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS)
      nextThinkAt = deps.now() + backoff
      console.error(`[seedlings] thinking failed (${failures}), trying again in ${Math.round(backoff / 1000)}s:`, error instanceof Error ? error.message : error)
    }

    store.saveWorld(world)
    for (const listener of listeners) listener()
  }

  return {
    step,
    start() {
      if (running) return
      running = true
      let last = Date.now()
      const tick = async () => {
        const now = Date.now()
        await step(now - last)
        last = now
        if (running) timer = setTimeout(tick, config.tickMs)
      }
      timer = setTimeout(tick, config.tickMs)
    },
    stop() {
      running = false
      if (timer) clearTimeout(timer)
      timer = null
    },
    onChange(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    lastThought() {
      const turn = store.getTurn(store.lastTurnId(PIP_ID))
      if (!turn) return ''
      try {
        return (JSON.parse(turn.decision) as { consider?: string }).consider ?? ''
      } catch {
        return ''
      }
    },
  }
}
