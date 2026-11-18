/**
 * How the art place paints. Pure and deterministic: the same title, mood and description always give
 * the same picture. The mood chooses colours and how lively the shapes are; known words become motifs.
 */

import type { Mood, Shape } from './types.ts'

export const MOODS: Mood[] = ['calm', 'joyful', 'lonely', 'restless', 'tender', 'gloomy']
export const MOTIFS = ['sun', 'moon', 'star', 'cloud', 'bird', 'tree', 'flower', 'house', 'heart', 'hill', 'pond', 'water', 'rain', 'road', 'fish', 'boat']
const MAX_MOTIFS = 4
const HIGH = new Set(['sun', 'moon', 'star', 'cloud', 'bird', 'rain'])
const LOW = new Set(['pond', 'water', 'road', 'hill', 'fish', 'boat'])

type Style = { ground: string; palette: string[]; kinds: string[]; count: number; size: [number, number]; band: [number, number]; spin: boolean }

const STYLES: Record<Mood, Style> = {
  calm: { ground: '#dcebe6', palette: ['#7fb3a8', '#a8cbbf', '#5e8f99', '#f2e6c9'], kinds: ['circle', 'wave'], count: 4, size: [10, 25], band: [15, 85], spin: false },
  joyful: { ground: '#fff2c4', palette: ['#f0b23a', '#e8644e', '#6fbf5a', '#5b9bd5'], kinds: ['circle', 'triangle', 'dot'], count: 9, size: [6, 18], band: [5, 95], spin: true },
  lonely: { ground: '#d9dde3', palette: ['#6b7685', '#9aa4b1', '#3f4a59', '#c7ccd4'], kinds: ['dot', 'line'], count: 2, size: [4, 10], band: [30, 70], spin: false },
  restless: { ground: '#f3e1d6', palette: ['#c8502f', '#e3a13c', '#3c5a7a', '#8a3b5c'], kinds: ['triangle', 'line', 'square'], count: 10, size: [5, 20], band: [5, 95], spin: true },
  tender: { ground: '#f8e4e6', palette: ['#e7a1ae', '#f3c6b8', '#b78fb5', '#fff3e8'], kinds: ['circle', 'dot'], count: 5, size: [12, 28], band: [20, 80], spin: false },
  gloomy: { ground: '#4a4f5c', palette: ['#2f3440', '#5d6475', '#7a6f6a', '#3b4a5a'], kinds: ['square', 'wave'], count: 4, size: [15, 35], band: [50, 100], spin: false },
}

/** FNV-1a: a stable number from the picture's words. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Motif words in the description, whole words only, in the order they appear, at most four. */
function motifsIn(description: string): string[] {
  const words = description.toLowerCase().match(/[a-z]+/g) ?? []
  const found: string[] = []
  for (const word of words) if (MOTIFS.includes(word) && !found.includes(word) && found.length < MAX_MOTIFS) found.push(word)
  return found
}

export function paint(title: string, mood: Mood, description: string): Shape[] {
  const style = STYLES[mood]
  const random = seeded(hash(`${title}\u0000${mood}\u0000${description}`))
  const between = (low: number, high: number) => low + random() * (high - low)
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]
  const round = (n: number) => Math.round(n * 10) / 10

  const shapes: Shape[] = [{ kind: 'wash', x: 50, y: 50, size: 100, colour: style.ground, turn: 0 }]
  for (let i = 0; i < style.count; i++) {
    shapes.push({
      kind: pick(style.kinds),
      x: round(between(8, 92)),
      y: round(between(style.band[0], style.band[1])),
      size: round(between(style.size[0], style.size[1])),
      colour: pick(style.palette),
      turn: style.spin ? Math.round(between(0, 360)) : 0,
    })
  }
  for (const motif of motifsIn(description)) {
    const band: [number, number] = HIGH.has(motif) ? [10, 35] : LOW.has(motif) ? [65, 90] : [40, 70]
    shapes.push({ kind: motif, x: round(between(15, 85)), y: round(between(band[0], band[1])), size: round(between(14, 24)), colour: pick(style.palette), turn: 0 })
  }
  return shapes
}
