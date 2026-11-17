/** What comes to mind, what gets learned, and what fades. */

import type { Memory, Store } from '../store/store.ts'
import type { ActResult, Observation } from '../world/seam.ts'

const MOOD_THRESHOLD = 0.05

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? [])

/** Picks the memories most likely to matter here: strong ones, and ones that share words with the scene. */
export function recall(memories: Memory[], o: Observation, n: number): Memory[] {
  const scene = words([o.room, o.body, ...o.recentEvents].join(' '))
  const scored = memories.map((memory) => {
    let shared = 0
    for (const word of words(memory.text)) if (scene.has(word)) shared++
    return { memory, score: memory.strength * (1 + shared) }
  })
  scored.sort((a, b) => b.score - a.score || b.memory.sinceMinutes - a.memory.sinceMinutes)
  return scored.slice(0, n).map((entry) => entry.memory)
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** A belief is learned from how a move turned out. Nothing is learned from an unremarkable result. */
export function beliefFor(result: ActResult): { key: string; text: string } | null {
  const label = capital(result.label)
  if (!result.success) return { key: `${result.label}:wrong`, text: `${label} keeps going wrong.` }
  if (result.moodDelta >= MOOD_THRESHOLD) return { key: `${result.label}:lifts`, text: `${label} lifts me.` }
  if (result.moodDelta <= -MOOD_THRESHOLD) return { key: `${result.label}:winds`, text: `${label} winds me up.` }
  return null
}

/** Memories that came to mind today grow stronger; beyond the cap, the weakest and oldest are let go. */
export function tidyMemories(store: Store, characterId: string, recalledToday: number[], cap: number): void {
  store.strengthen(recalledToday)
  const all = store.memories(characterId)
  if (all.length <= cap) return
  const weakestFirst = [...all].sort((a, b) => a.strength - b.strength || a.sinceMinutes - b.sinceMinutes)
  store.dropMemories(weakestFirst.slice(0, all.length - cap).map((memory) => memory.id))
}
