/** The loop: moves time forward and gives Pip a turn when it is free and the budget allows. */

import { shouldReflect } from '../mind/reflect.ts'
import { ModelError } from '../model/client.ts'
import { START_MINUTES, clockOf, worldMinutesFor } from '../world/clock.ts'
import { PIP_ID, advance, character } from '../world/world.ts'
import { performQueued, runReflection, runTurn, turnsSinceReflection } from './turn.ts'
import type { TownDeps, TurnOutcome } from './turn.ts'

export type Scheduler = {
  /** Advances the town by this much real time. Exposed so tests can drive it. Never rejects. */
  step(realElapsedMs: number): Promise<void>
  start(): void
  /** Stops the loop. Resolves once any step in flight has finished. */
  stop(): Promise<void>
  onChange(fn: () => void): () => void
  lastThought(): string
  /** Why thinking or saving is failing right now, or an empty string when all is well. */
  trouble(): string
}

const FIRST_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 30 * 60_000
const NEXT_THINK_FLAG = 'next_think_at'
const DAY_ENDED_FLAG = `day_ended:${PIP_ID}`
/** An in-world day runs from 06:00 to 06:00, so sleeping after midnight still ends the day before. */
const DAY_STARTS_AT = 360
const EVENING_HOUR = 18

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** How long to hold off after a failure. A provider's Retry-After can lengthen the wait but never shorten or unbound it. */
function backoff(error: unknown, failures: number): number {
  const exponential = Math.min(FIRST_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS)
  const asked = error instanceof ModelError ? (error.retryAfterMs ?? 0) : 0
  return Math.min(Math.max(asked, exponential), MAX_BACKOFF_MS)
}

export function createScheduler(deps: TownDeps): Scheduler {
  const { world, store, budget, config } = deps
  const listeners = new Set<() => void>()
  // The pace survives a restart: without this, every restart would think at once.
  let nextThinkAt = Number(store.getFlag(NEXT_THINK_FLAG) ?? 0)
  let nextReflectAt = 0
  let thinkFailures = 0
  let reflectFailures = 0
  let finishedSinceDiary = false
  let thinkTrouble = ''
  let reflectTrouble = ''
  let saveTrouble = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let inFlight: Promise<void> = Promise.resolve()

  function thinkNext(at: number): void {
    nextThinkAt = at
    try {
      store.setFlag(NEXT_THINK_FLAG, String(at))
    } catch (error) {
      saveTrouble = message(error)
    }
  }

  /** Writes the diary when it is due. A failure here never touches the pace of thinking. */
  async function reflectIfDue(outcome: TurnOutcome): Promise<void> {
    if (outcome.finishedBuilding) finishedSinceDiary = true
    if (deps.now() < nextReflectAt) return

    const clock = clockOf(world.minutes)
    const day = String(clockOf(Math.max(0, world.minutes - DAY_STARTS_AT)).day)
    const evening = clock.night || clock.hour >= EVENING_HOUR
    // Only the first sleep of the evening ends the day; naps and going back to sleep do not.
    const endOfDay = outcome.wentToSleep && evening && store.getFlag(DAY_ENDED_FLAG) !== day
    const last = store.diary(PIP_ID, 1)[0]
    const due = shouldReflect({
      minutesSinceLast: world.minutes - (last?.worldMinutes ?? START_MINUTES),
      turnsSinceLast: turnsSinceReflection(store, PIP_ID),
      buildingFinished: finishedSinceDiary,
      goingToSleep: endOfDay,
    })
    if (!due || !budget.status().canThink) return

    try {
      await runReflection(deps, PIP_ID, endOfDay)
      finishedSinceDiary = false
      if (endOfDay) store.setFlag(DAY_ENDED_FLAG, day)
      reflectFailures = 0
      reflectTrouble = ''
    } catch (error) {
      reflectFailures += 1
      nextReflectAt = deps.now() + backoff(error, reflectFailures)
      reflectTrouble = message(error)
      console.error(`[seedlings] the diary could not be written (${reflectFailures}):`, reflectTrouble)
    }
  }

  async function think(): Promise<void> {
    let outcome: TurnOutcome
    try {
      outcome = await runTurn(deps, PIP_ID)
    } catch (error) {
      thinkFailures += 1
      const wait = backoff(error, thinkFailures)
      thinkNext(deps.now() + wait)
      thinkTrouble = message(error)
      console.error(`[seedlings] thinking failed (${thinkFailures}), trying again in ${Math.round(wait / 1000)}s:`, thinkTrouble)
      return
    }
    thinkFailures = 0
    thinkTrouble = ''
    thinkNext(deps.now() + budget.status().intervalMs)
    await reflectIfDue(outcome)
  }

  async function step(realElapsedMs: number): Promise<void> {
    try {
      // A long gap means the process was stopped or suspended; the town does not live through it.
      const elapsed = Math.min(realElapsedMs, 2 * config.tickMs)
      advance(world, worldMinutesFor(elapsed, config.daysPerRealDay))

      const pip = character(world, PIP_ID)
      if (!pip.asleep && world.minutes >= pip.busyUntil) {
        if (pip.queue.length > 0) await reflectIfDue(performQueued(deps, PIP_ID)!)
        else if (deps.now() >= nextThinkAt && budget.status().canThink) await think()
      }
      store.saveWorld(world)
      saveTrouble = ''
    } catch (error) {
      // Almost always the database: nothing is asked of the model while it cannot be written.
      saveTrouble = message(error)
      console.error('[seedlings] the town could not be saved:', saveTrouble)
    }
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
        inFlight = step(now - last)
        await inFlight
        last = now
        if (running) timer = setTimeout(tick, config.tickMs)
      }
      timer = setTimeout(tick, config.tickMs)
    },
    stop() {
      running = false
      if (timer) clearTimeout(timer)
      timer = null
      return inFlight
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
    trouble() {
      return saveTrouble || thinkTrouble || reflectTrouble
    },
  }
}
