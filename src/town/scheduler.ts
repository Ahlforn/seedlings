/**
 * The loop: moves time forward and gives characters their turns when they are free and the budget allows.
 * Each step, Pip may think and at most one inhabitant may think. Calls are made one at a time, so what a
 * call cost is always recorded before the next one is made.
 */

import { MINDS } from '../mind/tiers.ts'
import { shouldReflect } from '../mind/reflect.ts'
import { ModelError } from '../model/client.ts'
import type { Character } from '../shared/types.ts'
import { START_MINUTES, clockOf, worldMinutesFor } from '../world/clock.ts'
import { PIP_ID, advance } from '../world/world.ts'
import { performQueued, runReflection, runTurn, turnsSinceReflection } from './turn.ts'
import type { TownDeps, TurnOutcome } from './turn.ts'

export type Scheduler = {
  /** Advances the town by this much real time. Exposed so tests can drive it. Never rejects. */
  step(realElapsedMs: number): Promise<void>
  start(): void
  /** Stops the loop. Resolves once any step in flight has finished. */
  stop(): Promise<void>
  onChange(fn: () => void): () => void
  /** What a character last thought before acting; Pip's when no id is given. */
  lastThought(characterId?: string): string
  /** Why thinking or saving is failing right now, or an empty string when all is well. */
  trouble(): string
}

const FIRST_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 30 * 60_000
/** Someone spoken to is moved up to think next, but never sooner than this after their last turn. */
const HURRY_GAP_MS = 60_000
/**
 * A conversation may run ahead of the day's pace by at most this much of the day's share. Beyond it,
 * answers come at the normal pace, so a chatty morning cannot leave a silent afternoon.
 */
const AHEAD_OF_PACE = 0.1
const DAY_MS = 86_400_000
/** An in-world day runs from 06:00 to 06:00, so sleeping after midnight still ends the day before. */
const DAY_STARTS_AT = 360
const EVENING_HOUR = 18

// Pip keeps the flag name it had before there were inhabitants, so a restart keeps its pace.
const nextThinkFlag = (id: string) => (id === PIP_ID ? 'next_think_at' : `next_think_at:${id}`)
const dayEndedFlag = (id: string) => `day_ended:${id}`

/** An outcome in which nothing happened, for revisiting a diary that is owed. */
const NOTHING: TurnOutcome = { turnId: 0, results: [], wentToSleep: false, finishedBuilding: false, heardBy: [], addressed: null, created: null }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** How long to hold off after a failure. A provider's Retry-After can lengthen the wait but never shorten or unbound it. */
function backoff(error: unknown, failures: number): number {
  const exponential = Math.min(FIRST_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS)
  const asked = error instanceof ModelError ? (error.retryAfterMs ?? 0) : 0
  return Math.min(Math.max(asked, exponential), MAX_BACKOFF_MS)
}

/** One character's pace and diary. */
type Mind = {
  nextThinkAt: number
  lastTurnAt: number
  nextReflectAt: number
  reflectFailures: number
  finishedSinceDiary: boolean
  reflectTrouble: string
  /** the in-world day whose bedtime diary is still to be written, or null */
  owedDay: string | null
}
/** One tier's model: when it fails, everyone on it waits. */
type Line = { failures: number; waitUntil: number; trouble: string }

export function createScheduler(deps: TownDeps): Scheduler {
  const { world, store, budget, config } = deps
  const listeners = new Set<() => void>()
  const minds = new Map<string, Mind>()
  const lines: Record<Character['tier'], Line> = {
    origin: { failures: 0, waitUntil: 0, trouble: '' },
    inhabitant: { failures: 0, waitUntil: 0, trouble: '' },
  }
  let saveTrouble = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let inFlight: Promise<void> = Promise.resolve()

  function mindOf(id: string): Mind {
    let mind = minds.get(id)
    if (!mind) {
      // The pace survives a restart: without this, every restart would think at once.
      mind = {
        nextThinkAt: Number(store.getFlag(nextThinkFlag(id)) ?? 0),
        lastTurnAt: store.getTurn(store.lastTurnId(id))?.realTs ?? 0,
        nextReflectAt: 0,
        reflectFailures: 0,
        finishedSinceDiary: false,
        reflectTrouble: '',
        owedDay: null,
      }
      minds.set(id, mind)
    }
    return mind
  }

  function thinkNext(id: string, at: number): void {
    mindOf(id).nextThinkAt = at
    try {
      store.setFlag(nextThinkFlag(id), String(at))
    } catch (error) {
      saveTrouble = message(error)
    }
  }

  /** Whoever was spoken to thinks sooner, so a conversation does not stall between slow and fast minds. */
  function hurry(id: string | null): void {
    const c = id === null ? undefined : world.characters.find((other) => other.id === id)
    if (!c) return
    const dayLeft = 1 - (deps.now() % DAY_MS) / DAY_MS
    if (budget.status(MINDS[c.tier].pool).leftTodayFraction < dayLeft - AHEAD_OF_PACE) return
    const mind = mindOf(c.id)
    const soonest = Math.max(deps.now(), mind.lastTurnAt + HURRY_GAP_MS)
    if (soonest < mind.nextThinkAt) thinkNext(c.id, soonest)
  }

  /**
   * Writes the diary when it is due. A failure here never touches the pace of thinking. A bedtime entry
   * that cannot be written at bedtime (no budget left, the model failing) is owed, and tried again later.
   */
  async function reflectIfDue(c: Character, outcome: TurnOutcome): Promise<void> {
    const mind = mindOf(c.id)
    if (outcome.finishedBuilding) mind.finishedSinceDiary = true

    const clock = clockOf(world.minutes)
    const day = String(clockOf(Math.max(0, world.minutes - DAY_STARTS_AT)).day)
    const evening = clock.night || clock.hour >= EVENING_HOUR
    // Only the first sleep of the evening ends the day; naps and going back to sleep do not.
    if (outcome.wentToSleep && evening && store.getFlag(dayEndedFlag(c.id)) !== day) mind.owedDay = day
    if (deps.now() < mind.nextReflectAt || deps.now() < lines[c.tier].waitUntil) return

    const endOfDay = mind.owedDay !== null
    const last = store.diary(c.id, 1)[0]
    const due = shouldReflect({
      minutesSinceLast: world.minutes - (last?.worldMinutes ?? START_MINUTES),
      turnsSinceLast: turnsSinceReflection(store, c.id),
      buildingFinished: mind.finishedSinceDiary,
      goingToSleep: endOfDay,
      everyFewHours: MINDS[c.tier].diaryEveryFewHours,
    })
    if (!due || !budget.status(MINDS[c.tier].pool).canThink) return

    try {
      await runReflection(deps, c.id, endOfDay)
      mind.finishedSinceDiary = false
      if (mind.owedDay !== null) store.setFlag(dayEndedFlag(c.id), mind.owedDay)
      mind.owedDay = null
      mind.reflectFailures = 0
      mind.reflectTrouble = ''
    } catch (error) {
      mind.reflectFailures += 1
      mind.nextReflectAt = deps.now() + backoff(error, mind.reflectFailures)
      mind.reflectTrouble = message(error)
      console.error(`[seedlings] ${c.name}'s diary could not be written (${mind.reflectFailures}):`, mind.reflectTrouble)
    }
  }

  async function after(c: Character, outcome: TurnOutcome): Promise<void> {
    hurry(outcome.addressed)
    await reflectIfDue(c, outcome)
  }

  async function think(c: Character): Promise<void> {
    const line = lines[c.tier]
    let outcome: TurnOutcome
    try {
      outcome = await runTurn(deps, c.id)
    } catch (error) {
      line.failures += 1
      const wait = backoff(error, line.failures)
      line.waitUntil = deps.now() + wait
      line.trouble = message(error)
      console.error(`[seedlings] ${c.name}: thinking failed (${line.failures}), trying again in ${Math.round(wait / 1000)}s:`, line.trouble)
      return
    }
    line.failures = 0
    line.trouble = ''
    mindOf(c.id).lastTurnAt = deps.now()
    thinkNext(c.id, deps.now() + budget.status(MINDS[c.tier].pool).intervalMs)
    await after(c, outcome)
  }

  const free = (c: Character) => !c.asleep && world.minutes >= c.busyUntil
  const due = (c: Character) => deps.now() >= mindOf(c.id).nextThinkAt && deps.now() >= lines[c.tier].waitUntil
  const ready = (c: Character) => free(c) && c.queue.length === 0 && due(c)

  async function step(realElapsedMs: number): Promise<void> {
    try {
      world.populationLimit = budget.supportable()
      // A long gap means the process was stopped or suspended; the town does not live through it.
      const elapsed = Math.min(realElapsedMs, 2 * config.tickMs)
      advance(world, worldMinutesFor(elapsed, config.daysPerRealDay))

      // Moves left over from an earlier decision need no model call.
      for (const c of [...world.characters]) {
        if (free(c) && c.queue.length > 0) await after(c, (await performQueued(deps, c.id))!)
      }

      const pip = world.characters.find((c) => c.tier === 'origin')
      if (pip && ready(pip) && budget.status('origin').canThink) await think(pip)

      // The most overdue inhabitant; ties go to whoever has lived here longest.
      const waiting = world.characters.filter((c) => c.tier === 'inhabitant' && ready(c))
      if (waiting.length > 0 && budget.status('inhabitants').canThink) {
        const next = waiting.reduce((best, c) => (mindOf(c.id).nextThinkAt < mindOf(best.id).nextThinkAt ? c : best))
        await think(next)
      }
      // One owed bedtime diary per step, asleep or not.
      const owing = world.characters.find((c) => mindOf(c.id).owedDay !== null)
      if (owing) await reflectIfDue(owing, NOTHING)
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
    lastThought(characterId = PIP_ID) {
      const turn = store.getTurn(store.lastTurnId(characterId))
      if (!turn) return ''
      try {
        return (JSON.parse(turn.decision) as { consider?: string }).consider ?? ''
      } catch {
        return ''
      }
    },
    trouble() {
      const inhabitants = lines.inhabitant.trouble ? `Inhabitants: ${lines.inhabitant.trouble}` : ''
      const diary = [...minds.values()].find((mind) => mind.reflectTrouble)?.reflectTrouble ?? ''
      return saveTrouble || lines.origin.trouble || inhabitants || diary
    },
  }
}
