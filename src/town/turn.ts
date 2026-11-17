/** One full turn of a mind: see, decide, act, record. And the reflection that writes the diary. */

import type { BudgetKeeper } from '../budget/keeper.ts'
import type { Config } from '../config.ts'
import { WAIT, readDecision } from '../mind/decision.ts'
import type { Decision } from '../mind/decision.ts'
import { beliefFor, recall, tidyMemories } from '../mind/memory.ts'
import { systemPrompt, whatISee } from '../mind/prompt.ts'
import { readReflection, reflectionPrompt } from '../mind/reflect.ts'
import { PIP_SHEET } from '../mind/sheet.ts'
import type { ModelClient, ModelReply } from '../model/client.ts'
import type { Act, World } from '../shared/types.ts'
import type { Store } from '../store/store.ts'
import { clockOf } from '../world/clock.ts'
import { act, manifest, observe } from '../world/seam.ts'
import type { ActResult } from '../world/seam.ts'
import { character } from '../world/world.ts'

export type TownDeps = {
  world: World
  store: Store
  model: ModelClient
  budget: BudgetKeeper
  config: Config
  now: () => number
}
export type TurnOutcome = { turnId: number; results: ActResult[]; wentToSleep: boolean; finishedBuilding: boolean }

const MEMORIES_RECALLED = 5
const MIND_ITEMS_SHOWN = 3
const TURN_TOKENS = 400
const REFLECTION_TOKENS = 500
const MEMORY_CAP = 200
const DAY_MINUTES = 1440

const finishedCount = (world: World) => world.buildings.filter((b) => b.workLeft === 0).length

/** Acts one move and applies what it teaches. */
function perform(deps: TownDeps, characterId: string, move: Act): { result: ActResult; wentToSleep: boolean; finishedBuilding: boolean } {
  const { world, store } = deps
  const c = character(world, characterId)
  const wasAsleep = c.asleep
  const finishedBefore = finishedCount(world)
  const result = act(world, characterId, move)
  const belief = beliefFor(result)
  if (belief) store.bumpBelief(characterId, belief.key, belief.text)
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

  const observation = observe(world, characterId)
  const recalled = recall(store.memories(characterId), observation, MEMORIES_RECALLED)
  const system = systemPrompt(manifest(), observation, PIP_SHEET)
  const user = whatISee(observation, recalled, store.beliefs(characterId), store.openMindItems(characterId).slice(0, MIND_ITEMS_SHOWN))

  const replies: ModelReply[] = []
  let decision: Decision | null = null
  for (let attempt = 0; attempt < 2 && !decision; attempt++) {
    const reply = await model.complete({ model: config.pipModel, system, user, sessionId: characterId, maxTokens: TURN_TOKENS })
    budget.record(characterId, reply.usage)
    replies.push(reply)
    decision = readDecision(reply.text)
  }
  decision ??= WAIT

  store.touchMemories(recalled.map((memory) => memory.id), world.minutes)
  const [first, ...rest] = decision.moves
  const done = perform(deps, characterId, first)
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
    model: config.pipModel,
    allowance: replies.reduce((sum, reply) => sum + (reply.usage.allowance ?? 0), 0),
    inputTokens: replies.reduce((sum, reply) => sum + reply.usage.inputTokens, 0),
    outputTokens: replies.reduce((sum, reply) => sum + reply.usage.outputTokens, 0),
  })
  c.queueTurn = turnId
  store.saveWorld(world)
  return { turnId, results: [done.result], wentToSleep: done.wentToSleep, finishedBuilding: done.finishedBuilding }
}

/** Acts the next move left over from the last decision, with no model call. Null when there is none. */
export function performQueued(deps: TownDeps, characterId: string): TurnOutcome | null {
  const { world, store } = deps
  const c = character(world, characterId)
  const move = c.queue.shift()
  if (!move) return null

  const done = perform(deps, characterId, move)
  if (!done.result.success) c.queue = []
  const turn = store.getTurn(c.queueTurn)
  if (turn) {
    const results = JSON.parse(turn.results) as ActResult[]
    store.setTurnResults(turn.id, JSON.stringify([...results, done.result]))
  }
  store.saveWorld(world)
  return { turnId: c.queueTurn, results: [done.result], wentToSleep: done.wentToSleep, finishedBuilding: done.finishedBuilding }
}

/** Writes a diary entry about the turns since the last one. Null when there is nothing new or the reply is unreadable. */
export async function runReflection(deps: TownDeps, characterId: string, endOfDay: boolean): Promise<number | null> {
  const { world, store, model, budget, config } = deps
  const last = store.diary(characterId, 1)[0]
  const turns = store.turnsBetween(characterId, (last?.toTurn ?? 0) + 1, store.lastTurnId(characterId))
  if (turns.length === 0) return null

  const open = store.openMindItems(characterId)
  const prompt = reflectionPrompt(PIP_SHEET, clockOf(world.minutes).label, turns, open, endOfDay)
  const reply = await model.complete({ model: config.pipModel, system: prompt.system, user: prompt.user, sessionId: characterId, maxTokens: REFLECTION_TOKENS })
  budget.record(characterId, reply.usage)
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
    model: config.pipModel,
    allowance: reply.usage.allowance ?? 0,
    inputTokens: reply.usage.inputTokens,
    outputTokens: reply.usage.outputTokens,
  })
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

  if (endOfDay) {
    const recalledToday = store.memories(characterId)
      .filter((memory) => memory.recalled > 0 && memory.lastRecalledMinutes > world.minutes - DAY_MINUTES)
      .map((memory) => memory.id)
    tidyMemories(store, characterId, recalledToday, MEMORY_CAP)
  }
  return diaryId
}
