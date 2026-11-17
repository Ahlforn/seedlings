/** Isometric drawing maths. Pure: turns tiles and building recipes into points and coloured faces. */

import type { Building, Colour, Tile } from './types.ts'

export const TILE_W = 64
export const TILE_H = 32
export const FLOOR_H = 26

export type Point = { x: number; y: number }
export type Face = {
  points: Point[]
  fill: string
  kind: 'wall-left' | 'wall-right' | 'roof' | 'door' | 'window' | 'sign' | 'extra'
  text?: string
}

export const PALETTE: Record<Colour, { light: string; dark: string }> = {
  cream: { light: '#f3e6c8', dark: '#d9c9a3' },
  white: { light: '#f4f6f7', dark: '#cfd6db' },
  sand: { light: '#e8cf9a', dark: '#cdb27c' },
  brick: { light: '#c8694e', dark: '#a5523b' },
  red: { light: '#d9634f', dark: '#b84c3c' },
  blue: { light: '#6f96c4', dark: '#557aa6' },
  green: { light: '#78b06a', dark: '#5e9352' },
  yellow: { light: '#f0cd5a', dark: '#d3b045' },
  grey: { light: '#aab3ba', dark: '#8a949c' },
  brown: { light: '#9a7352', dark: '#7c5a3f' },
}

const DOOR = '#6b4a30'
const GLASS = '#a9d6e8'
const SIGN = '#fff8e6'
const GARDEN = '#5f9c4d'
const LANTERN = '#ffd97a'
const SITE_MIN = 0.15

/** Screen position of the top corner of a tile's diamond. Tiles may be fractional. */
export function tileToScreen(t: Tile, origin: Point): Point {
  return { x: origin.x + (t.x - t.y) * (TILE_W / 2), y: origin.y + (t.x + t.y) * (TILE_H / 2) }
}

/** The tile under a screen position. The inverse of tileToScreen. */
export function screenToTile(p: Point, origin: Point): Tile {
  const dx = (p.x - origin.x) / (TILE_W / 2)
  const dy = (p.y - origin.y) / (TILE_H / 2)
  return { x: Math.floor((dy + dx) / 2), y: Math.floor((dy - dx) / 2) }
}

/** Back to front: by x + y, then x. */
export function drawOrder<T extends { at: Tile }>(things: T[]): T[] {
  return [...things].sort((a, b) => a.at.x + a.at.y - (b.at.x + b.at.y) || a.at.x - b.at.x)
}

const lift = (p: Point, by: number): Point => ({ x: p.x, y: p.y - by })
const along = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** A slanted rectangle lying on a wall: between two fractions of the wall's foot, between two heights. */
function onWall(a: Point, b: Point, from: number, to: number, low: number, high: number): Point[] {
  return [lift(along(a, b, from), low), lift(along(a, b, to), low), lift(along(a, b, to), high), lift(along(a, b, from), high)]
}

/** The coloured faces of a building, back to front. A building site is low walls and nothing else. */
export function buildingFaces(b: Building, origin: Point): Face[] {
  const r = b.recipe
  const n = r.footprint
  const wall = PALETTE[r.wall]
  const roof = PALETTE[r.roofColour]

  // Corners of the footprint on the ground: back (top), right, front (bottom), left.
  const right = tileToScreen({ x: b.at.x + n, y: b.at.y }, origin)
  const front = tileToScreen({ x: b.at.x + n, y: b.at.y + n }, origin)
  const left = tileToScreen({ x: b.at.x, y: b.at.y + n }, origin)
  const back = tileToScreen(b.at, origin)

  const finished = b.workLeft === 0
  const progress = b.workTotal > 0 ? 1 - b.workLeft / b.workTotal : 1
  const fullHeight = r.floors * FLOOR_H
  const h = finished ? fullHeight : fullHeight * (SITE_MIN + (1 - SITE_MIN) * progress * 0.8)

  const faces: Face[] = [
    { kind: 'wall-left', fill: wall.light, points: [left, front, lift(front, h), lift(left, h)] },
    { kind: 'wall-right', fill: wall.dark, points: [front, right, lift(right, h), lift(front, h)] },
  ]
  if (!finished) return faces

  const [tl, tf, tr, tb] = [lift(left, h), lift(front, h), lift(right, h), lift(back, h)]
  const rise = n * 12 + 8
  const centre = lift(along(tl, tr, 0.5), 0)

  if (r.roof === 'flat') {
    faces.push({ kind: 'roof', fill: roof.light, points: [tb, tr, tf, tl] })
  } else if (r.roof === 'pitched') {
    // The ridge runs front to back over the middle; we see one slope and the gable end.
    const ridgeBack = lift(along(tl, tb, 0.5), rise)
    const ridgeFront = lift(along(tf, tr, 0.5), rise)
    faces.push({ kind: 'roof', fill: roof.light, points: [tl, tf, ridgeFront, ridgeBack] })
    faces.push({ kind: 'roof', fill: roof.dark, points: [tf, tr, ridgeFront] })
  } else if (r.roof === 'pyramid') {
    const apex = lift(centre, rise + 6)
    faces.push({ kind: 'roof', fill: roof.light, points: [tl, tf, apex] })
    faces.push({ kind: 'roof', fill: roof.dark, points: [tf, tr, apex] })
  } else {
    const points: Point[] = [tl]
    for (let i = 1; i < 8; i++) {
      const t = i / 8
      points.push(lift(along(tl, tr, t), Math.sin(t * Math.PI) * (rise + 10)))
    }
    points.push(tr, tf)
    faces.push({ kind: 'roof', fill: roof.light, points })
  }

  // Door and sign on the right-hand wall, windows on the left-hand wall.
  const doorHalf = 0.16 / n
  const doorHeight = Math.min(18, h * 0.7)
  faces.push({ kind: 'door', fill: DOOR, points: onWall(front, right, 0.5 - doorHalf, 0.5 + doorHalf, 0, doorHeight) })

  const windowHalf = 0.11 / n
  for (let i = 0; i < r.windows; i++) {
    const at = (i + 1) / (r.windows + 1)
    faces.push({ kind: 'window', fill: GLASS, points: onWall(left, front, at - windowHalf, at + windowHalf, h - FLOOR_H * 0.75, h - FLOOR_H * 0.3) })
  }

  if (r.sign !== '') {
    const low = Math.min(doorHeight + 3, h - 11)
    faces.push({ kind: 'sign', fill: SIGN, text: r.sign, points: onWall(front, right, 0.12, 0.88, low, low + 10) })
  }

  for (const extra of r.extras) {
    if (extra === 'chimney') {
      const foot = lift(along(tb, tr, 0.5), r.roof === 'flat' ? 0 : rise * 0.4)
      faces.push({ kind: 'extra', fill: PALETTE.brick.dark, points: [{ x: foot.x - 4, y: foot.y }, { x: foot.x + 4, y: foot.y }, { x: foot.x + 4, y: foot.y - 16 }, { x: foot.x - 4, y: foot.y - 16 }] })
    } else if (extra === 'awning') {
      const top = onWall(front, right, 0.5 - doorHalf * 1.8, 0.5 + doorHalf * 1.8, doorHeight, doorHeight)
      faces.push({ kind: 'extra', fill: PALETTE.red.light, points: [top[0], top[1], { x: top[1].x + 7, y: top[1].y + 7 }, { x: top[0].x + 7, y: top[0].y + 7 }] })
    } else if (extra === 'garden') {
      const a = tileToScreen({ x: b.at.x, y: b.at.y + n }, origin)
      const c = tileToScreen({ x: b.at.x + n * 0.6, y: b.at.y + n }, origin)
      faces.push({ kind: 'extra', fill: GARDEN, points: [a, c, { x: c.x - 10, y: c.y + 5 }, { x: a.x - 10, y: a.y + 5 }] })
    } else {
      const post = onWall(front, right, 0.82, 0.9, doorHeight * 0.6, doorHeight * 0.6 + 7)
      faces.push({ kind: 'extra', fill: LANTERN, points: post })
    }
  }
  return faces
}
