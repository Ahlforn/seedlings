/** What comes to mind, what gets learned, and what fades. */

import type { Memory, Store } from '../store/store.ts'
import type { ActResult, Observation } from '../world/seam.ts'

const MOOD_THRESHOLD = 0.05
/** Of the memories recalled, this many places always go to the most recent ones. */
const RECENT_PLACES = 2

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? [])

const newestFirst = (a: Memory, b: Memory) => b.sinceMinutes - a.sinceMinutes || b.id - a.id

/**
 * Picks the memories most likely to matter here. Sharing words with the scene counts for most;
 * strength counts on a log scale, so a memory recalled for weeks cannot crowd out everything else;
 * and some places always go to the most recent memories, so new ones get a chance to take hold.
 */
export function recall(memories: Memory[], o: Observation, n: number): Memory[] {
  const scene = words([o.room, o.body, ...o.recentEvents, ...o.people, ...o.heard, ...o.notes, ...o.here].join(' '))
  const scored = memories.map((memory) => {
    let shared = 0
    for (const word of words(memory.text)) if (scene.has(word)) shared++
    return { memory, score: (1 + 2 * shared) * (1 + Math.log2(Math.max(1, memory.strength))) }
  })
  scored.sort((a, b) => b.score - a.score || newestFirst(a.memory, b.memory))

  const reserved = Math.min(RECENT_PLACES, Math.floor(n / 2))
  const picked = scored.slice(0, n - reserved).map((entry) => entry.memory)
  const recent = [...memories].sort(newestFirst).filter((memory) => !picked.includes(memory))
  return [...picked, ...recent.slice(0, n - picked.length)]
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
