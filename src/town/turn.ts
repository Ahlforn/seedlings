/** One full turn of a mind: see, decide, act, record. And the reflection that writes the diary. */

import type { BudgetKeeper } from '../budget/keeper.ts'
import type { FacilityServices } from '../facilities/contract.ts'
import type { Config } from '../config.ts'
import { WAIT, readDecision } from '../mind/decision.ts'
import type { Decision } from '../mind/decision.ts'
import { beliefFor, recall, tidyMemories } from '../mind/memory.ts'
import { systemPrompt, whatISee } from '../mind/prompt.ts'
import { readReflection, reflectionPrompt } from '../mind/reflect.ts'
import { MINDS, modelFor, sheetFor } from '../mind/tiers.ts'
import { ModelError } from '../model/client.ts'
import type { ModelClient, ModelReply } from '../model/client.ts'
import type { Act, World } from '../shared/types.ts'
import type { Store } from '../store/store.ts'
import { clockOf } from '../world/clock.ts'
import { actAny, manifest, observe } from '../world/seam.ts'
import type { ActResult } from '../world/seam.ts'
import { character } from '../world/world.ts'

export type TownDeps = {
  world: World
  store: Store
  model: ModelClient
  budget: BudgetKeeper
  config: Config
  now: () => number
  /** what facilities may use */
  services: FacilityServices
}
export type TurnOutcome = {
  turnId: number
  results: ActResult[]
  wentToSleep: boolean
  finishedBuilding: boolean
  /** who heard what was said */
  heardBy: string[]
  /** who was spoken to by name, so they can answer sooner */
  addressed: string | null
  /** a character brought to life by this turn */
  created: string | null
}

const DAY_MINUTES = 1440
/** A reflection looks back over at most this many turns, so its prompt cannot grow without bound. */
const REFLECTION_TURNS = 12
/** At most this many things stay on a mind; the oldest are let go. */
const MIND_CAP = 12
const CALL_FLAG = 'last_call_at'
const reflectedFlag = (characterId: string) => `reflected:${characterId}`

/** The last turn a reflection has already looked at, whether or not it produced a diary entry. */
function reflectedUpTo(store: Store, characterId: string): number {
  const last = store.diary(characterId, 1)[0]
  return Math.max(last?.toTurn ?? 0, Number(store.getFlag(reflectedFlag(characterId)) ?? 0))
}

/** How many turns have happened that no reflection has looked at yet. */
export function turnsSinceReflection(store: Store, characterId: string): number {
  return store.turnsBetween(characterId, reflectedUpTo(store, characterId) + 1, store.lastTurnId(characterId)).length
}

/** A reply cut off by the token limit cannot be used, and asking again would only cut it off again. */
function refuseIfCutOff(reply: ModelReply): void {
  if (reply.finishReason !== 'length') return
  throw new ModelError('The model ran out of room before it finished answering. Raise SEEDLINGS_MAX_TOKENS.')
}

const finishedCount = (world: World) => world.buildings.filter((b) => b.workLeft === 0).length

type Performed = { result: ActResult; wentToSleep: boolean; finishedBuilding: boolean }

/** Acts one move and applies what it teaches, to the actor and to anyone the move reached. */
async function perform(deps: TownDeps, characterId: string, move: Act): Promise<Performed> {
  const { world, store } = deps
  const c = character(world, characterId)
  const wasAsleep = c.asleep
  const finishedBefore = finishedCount(world)
  const result = await actAny(world, characterId, move, deps.services)
  const belief = beliefFor(result)
  if (belief) store.bumpBelief(characterId, belief.key, belief.text)
  for (const left of result.leaves) store.addMemory({ ...left, sinceMinutes: world.minutes })
  return {
    result,
    wentToSleep: !wasAsleep && c.asleep,
    finishedBuilding: result.success && finishedCount(world) > finishedBefore,
  }
}

/** Throws ModelError when the model cannot be reached; nothing is recorded in that case. */
export async function runTurn(deps: TownDeps, characterId: string): Promise<TurnOutcome> {
  const { world, store, model, budget, config } = deps
  const c = character(world, characterId)

  const mind = MINDS[c.tier]
  const modelName = modelFor(c, config)
  const observation = observe(world, characterId)
  const recalled = recall(store.memories(characterId), observation, mind.memoriesRecalled)
  const system = systemPrompt(manifest(c.tier), observation, sheetFor(c))
  const user = whatISee(observation, recalled, store.beliefs(characterId), store.openMindItems(characterId).slice(0, mind.mindShown))

  // Written before asking: if the database cannot be written, the model is never called,
  // so no request can go unrecorded.
  store.setFlag(CALL_FLAG, String(deps.now()))

  const replies: ModelReply[] = []
  let decision: Decision | null = null
  for (let attempt = 0; attempt < 2 && !decision; attempt++) {
    // The first reply may have used up the budget, or been charged to balance: then there is no second ask.
    if (attempt > 0 && !budget.status(mind.pool).canThink) break
    const reply = await model.complete({ model: modelName, system, user, sessionId: characterId, maxTokens: config.maxTokens, reasoningEffort: config.reasoningEffort })
    budget.record(characterId, reply.usage)
    refuseIfCutOff(reply)
    replies.push(reply)
    decision = readDecision(reply.text)
  }
  decision ??= WAIT
  // What was heard has now been seen; it stays only if the model could not be asked.
  c.heard = []

  store.touchMemories(recalled.map((memory) => memory.id), world.minutes)
  const [first, ...rest] = decision.moves
  const done = await perform(deps, characterId, first)
  c.queue = done.result.success ? rest : []
  if (decision.remember) {
    store.addMemory({ characterId, text: decision.remember.text, kind: decision.remember.kind, sinceMinutes: world.minutes })
  }

  const turnId = store.addTurn({
    characterId,
    kind: 'turn',
    realTs: deps.now(),
    worldMinutes: world.minutes,
    observation: JSON.stringify(observation),
    systemPrompt: system,
    userPrompt: user,
    rawReply: replies.map((reply) => reply.text).join('\n---\n'),
    decision: JSON.stringify(decision),
    results: JSON.stringify([done.result]),
    model: modelName,
    allowance: replies.reduce((sum, reply) => sum + (reply.usage.allowance ?? 0), 0),
    inputTokens: replies.reduce((sum, reply) => sum + reply.usage.inputTokens, 0),
    outputTokens: replies.reduce((sum, reply) => sum + reply.usage.outputTokens, 0),
  })
  c.queueTurn = turnId
  store.saveWorld(world)
  return outcomeOf(turnId, done)
}

const outcomeOf = (turnId: number, done: Performed): TurnOutcome => ({
  turnId,
  results: [done.result],
  wentToSleep: done.wentToSleep,
  finishedBuilding: done.finishedBuilding,
  heardBy: done.result.heardBy,
  addressed: done.result.addressed,
  created: done.result.created,
})

/** Acts the next move left over from the last decision, with no model call. Null when there is none. */
export async function performQueued(deps: TownDeps, characterId: string): Promise<TurnOutcome | null> {
  const { world, store } = deps
  const c = character(world, characterId)
  const move = c.queue.shift()
  if (!move) return null

  const done = await perform(deps, characterId, move)
  if (!done.result.success) c.queue = []
  const turn = store.getTurn(c.queueTurn)
  if (turn) {
    const results = JSON.parse(turn.results) as ActResult[]
    store.setTurnResults(turn.id, JSON.stringify([...results, done.result]))
  }
  store.saveWorld(world)
  return outcomeOf(c.queueTurn, done)
}

/** Writes a diary entry about the turns since the last one. Null when there is nothing new or the reply is unreadable. */
export async function runReflection(deps: TownDeps, characterId: string, endOfDay: boolean): Promise<number | null> {
  const { world, store, model, budget, config } = deps
  const c = character(world, characterId)
  const mind = MINDS[c.tier]
  const modelName = modelFor(c, config)
  if (!budget.status(mind.pool).canThink) return null
  const unseen = store.turnsBetween(characterId, reflectedUpTo(store, characterId) + 1, store.lastTurnId(characterId))
  if (unseen.length === 0) return null
  const turns = unseen.slice(-REFLECTION_TURNS)

  const open = store.openMindItems(characterId)
  store.setFlag(CALL_FLAG, String(deps.now()))
  const prompt = reflectionPrompt(sheetFor(c), clockOf(world.minutes).label, turns, open, endOfDay)
  const reply = await model.complete({ model: modelName, system: prompt.system, user: prompt.user, sessionId: characterId, maxTokens: config.maxTokens, reasoningEffort: config.reasoningEffort })
  budget.record(characterId, reply.usage)
  refuseIfCutOff(reply)
  const reflection = readReflection(reply.text)
  store.addTurn({
    characterId,
    kind: 'reflection',
    realTs: deps.now(),
    worldMinutes: world.minutes,
    observation: '{}',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    rawReply: reply.text,
    decision: JSON.stringify(reflection),
    results: '[]',
    model: modelName,
    allowance: reply.usage.allowance ?? 0,
    inputTokens: reply.usage.inputTokens,
    outputTokens: reply.usage.outputTokens,
  })
  // These turns have been looked at, even if the reply could not be read: they are not asked about again.
  store.setFlag(reflectedFlag(characterId), String(turns[turns.length - 1].id))
  if (!reflection) return null

  const diaryId = store.addDiary({
    characterId,
    worldMinutes: world.minutes,
    text: reflection.diary,
    fromTurn: turns[0].id,
    toTurn: turns[turns.length - 1].id,
  })
  for (const memory of reflection.memories) store.addMemory({ characterId, ...memory, sinceMinutes: world.minutes })
  for (const item of reflection.mind) store.addMindItem({ characterId, ...item, sinceMinutes: world.minutes })
  store.closeMindItems(reflection.done.filter((id) => open.some((item) => item.id === id)))
  store.closeMindItems(store.openMindItems(characterId).slice(MIND_CAP).map((item) => item.id))

  if (endOfDay) {
    const recalledToday = store.memories(characterId)
      .filter((memory) => memory.recalled > 0 && memory.lastRecalledMinutes > world.minutes - DAY_MINUTES)
      .map((memory) => memory.id)
    tidyMemories(store, characterId, recalledToday, mind.memoryCap)
  }
  return diaryId
}
