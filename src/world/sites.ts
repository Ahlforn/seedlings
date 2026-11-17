/** Named places where a building may go. The mind picks a name; the world knows the tile. */

import type { Tile, World } from '../shared/types.ts'

export type Site = { name: string; at: Tile; maxFootprint: 1 | 2 | 3 }

const MAX_SITES = 6
const REACH = 3

export function footprintTiles(at: Tile, footprint: number): Tile[] {
  const tiles: Tile[] = []
  for (let dx = 0; dx < footprint; dx++) for (let dy = 0; dy < footprint; dy++) tiles.push({ x: at.x + dx, y: at.y + dy })
  return tiles
}

function occupied(world: World): Set<string> {
  const taken = new Set<string>()
  for (const f of world.features) taken.add(`${f.at.x},${f.at.y}`)
  for (const b of world.buildings) for (const t of footprintTiles(b.at, b.recipe.footprint)) taken.add(`${t.x},${t.y}`)
  return taken
}

/** True when a building of this footprint fits at this tile. Characters do not block. */
export function isFree(world: World, at: Tile, footprint: number): boolean {
  const taken = occupied(world)
  return footprintTiles(at, footprint).every(
    (t) => t.x >= 0 && t.y >= 0 && t.x < world.size && t.y < world.size && !taken.has(`${t.x},${t.y}`),
  )
}

function largestFit(world: World, at: Tile): 0 | 1 | 2 | 3 {
  for (const footprint of [3, 2, 1] as const) if (isFree(world, at, footprint)) return footprint
  return 0
}

const DIRECTIONS = [
  { word: 'north of', dx: 0, dy: -REACH },
  { word: 'east of', dx: REACH, dy: 0 },
  { word: 'south of', dx: 0, dy: REACH },
  { word: 'west of', dx: -REACH, dy: 0 },
]

/** At most six free spots, the same every time for the same world. */
export function candidateSites(world: World): Site[] {
  const sites: Site[] = []
  const names = new Set<string>()
  const tiles = new Set<string>()
  const offer = (name: string, at: Tile) => {
    if (sites.length >= MAX_SITES || names.has(name) || tiles.has(`${at.x},${at.y}`)) return
    const maxFootprint = largestFit(world, at)
    if (maxFootprint === 0) return
    names.add(name)
    tiles.add(`${at.x},${at.y}`)
    sites.push({ name, at, maxFootprint })
  }

  const middle = Math.floor(world.size / 2)
  offer('the middle of the plot', { x: middle, y: middle })

  const anchors = [
    ...world.features.filter((f) => f.kind !== 'tree').map((f) => ({ name: f.name, at: f.at })),
    ...world.buildings.map((b) => ({ name: b.name, at: b.at })),
  ]
  // One direction at a time across all anchors, so the offers spread over the plot.
  for (const direction of DIRECTIONS) {
    for (const anchor of anchors) {
      offer(`${direction.word} ${anchor.name}`, { x: anchor.at.x + direction.dx, y: anchor.at.y + direction.dy })
    }
  }
  return sites
}
