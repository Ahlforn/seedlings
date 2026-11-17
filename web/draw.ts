/** Paints the town on a canvas. All text reaches the canvas through fillText, never as markup. */

import { TILE_H, TILE_W, buildingFaces, drawOrder, tileToScreen } from '../src/shared/iso.ts'
import type { Face, Point } from '../src/shared/iso.ts'
import type { Building, Feature, StateView, Tile } from '../src/shared/types.ts'

type Person = StateView['characters'][number]
type Drawable = { at: Tile; draw(): void }

const GRASS = '#8fbf6a'
const GRASS_LINE = '#84b360'
const EDGE_LEFT = '#6a9a4c'
const EDGE_RIGHT = '#5a8840'
const INK = '#2b2b2b'
const BUBBLE_MAX = 48

const centreOf = (t: Tile, origin: Point): Point => tileToScreen({ x: t.x + 0.5, y: t.y + 0.5 }, origin)

function polygon(ctx: CanvasRenderingContext2D, points: Point[], fill: string, stroke = 'rgba(0,0,0,0.18)'): void {
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1
  ctx.stroke()
}

function shadow(ctx: CanvasRenderingContext2D, at: Point, rx: number, ry: number): void {
  ctx.beginPath()
  ctx.ellipse(at.x, at.y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fill()
}

function ground(ctx: CanvasRenderingContext2D, size: number, origin: Point): void {
  const back = tileToScreen({ x: 0, y: 0 }, origin)
  const right = tileToScreen({ x: size, y: 0 }, origin)
  const front = tileToScreen({ x: size, y: size }, origin)
  const left = tileToScreen({ x: 0, y: size }, origin)
  const drop = (p: Point): Point => ({ x: p.x, y: p.y + 14 })
  polygon(ctx, [left, front, drop(front), drop(left)], EDGE_LEFT)
  polygon(ctx, [front, right, drop(right), drop(front)], EDGE_RIGHT)
  polygon(ctx, [back, right, front, left], GRASS)
  ctx.strokeStyle = GRASS_LINE
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < size; i++) {
    const a = tileToScreen({ x: i, y: 0 }, origin)
    const b = tileToScreen({ x: i, y: size }, origin)
    const c = tileToScreen({ x: 0, y: i }, origin)
    const d = tileToScreen({ x: size, y: i }, origin)
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
    ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y)
  }
  ctx.stroke()
}

function feature(ctx: CanvasRenderingContext2D, f: Feature, origin: Point): void {
  const c = centreOf(f.at, origin)
  if (f.kind === 'pond') {
    ctx.beginPath()
    ctx.ellipse(c.x, c.y, TILE_W * 0.62, TILE_H * 0.62, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#6fb1d6'
    ctx.fill()
    ctx.strokeStyle = '#4f93b8'
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(c.x - 8, c.y - 3, 12, 4, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fill()
    return
  }
  shadow(ctx, c, 14, 5)
  if (f.kind === 'berry_bush') {
    for (const [dx, dy, r] of [[-7, -6, 9], [7, -6, 9], [0, -12, 10]]) {
      ctx.beginPath(); ctx.arc(c.x + dx, c.y + dy, r, 0, Math.PI * 2); ctx.fillStyle = '#4f8f4a'; ctx.fill()
    }
    for (const [dx, dy] of [[-8, -8], [4, -14], [9, -5], [-1, -6], [-5, -15]]) {
      ctx.beginPath(); ctx.arc(c.x + dx, c.y + dy, 2.2, 0, Math.PI * 2); ctx.fillStyle = '#7a2f5a'; ctx.fill()
    }
    return
  }
  const hollow = f.kind === 'hollow_tree'
  const trunk = hollow ? 9 : 4
  const height = hollow ? 30 : 20
  ctx.fillStyle = '#7a5a3a'
  ctx.fillRect(c.x - trunk, c.y - height, trunk * 2, height)
  if (hollow) {
    ctx.beginPath(); ctx.ellipse(c.x, c.y - 8, 5, 8, 0, 0, Math.PI * 2); ctx.fillStyle = '#3a2a1c'; ctx.fill()
  }
  ctx.beginPath()
  ctx.arc(c.x, c.y - height - (hollow ? 12 : 8), hollow ? 24 : 15, 0, Math.PI * 2)
  ctx.fillStyle = hollow ? '#437d43' : '#4f8f4a'
  ctx.fill()
}

function face(ctx: CanvasRenderingContext2D, f: Face): void {
  polygon(ctx, f.points, f.fill)
  if (f.kind !== 'sign' || !f.text) return
  const cx = f.points.reduce((sum, p) => sum + p.x, 0) / f.points.length
  const cy = f.points.reduce((sum, p) => sum + p.y, 0) / f.points.length
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(Math.atan2(f.points[1].y - f.points[0].y, f.points[1].x - f.points[0].x))
  ctx.fillStyle = '#5b3a1e'
  ctx.font = '700 8px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(f.text, 0, 0.5, Math.hypot(f.points[1].x - f.points[0].x, f.points[1].y - f.points[0].y) - 4)
  ctx.restore()
}

function building(ctx: CanvasRenderingContext2D, b: Building, origin: Point): void {
  for (const f of buildingFaces(b, origin)) face(ctx, f)
  if (b.workLeft > 0) {
    const c = tileToScreen({ x: b.at.x + b.recipe.footprint / 2, y: b.at.y + b.recipe.footprint / 2 }, origin)
    ctx.fillStyle = 'rgba(40,30,20,0.75)'
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('being built', c.x, c.y)
  }
}

/** Pip: a cream seed with two leaves sprouting from its head. */
function seedling(ctx: CanvasRenderingContext2D, at: Point, asleep: boolean): void {
  shadow(ctx, at, 11, 4)
  const top = at.y - 30
  ctx.beginPath()
  ctx.moveTo(at.x, top)
  ctx.bezierCurveTo(at.x + 14, top + 6, at.x + 15, top + 24, at.x, top + 29)
  ctx.bezierCurveTo(at.x - 15, top + 24, at.x - 14, top + 6, at.x, top)
  ctx.fillStyle = '#fff3d6'
  ctx.fill()
  ctx.strokeStyle = '#d6b57a'
  ctx.lineWidth = 1.2
  ctx.stroke()
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(at.x, top + 1)
    ctx.bezierCurveTo(at.x + side * 4, top - 10, at.x + side * 13, top - 12, at.x + side * 15, top - 6)
    ctx.bezierCurveTo(at.x + side * 9, top - 5, at.x + side * 4, top - 2, at.x, top + 1)
    ctx.fillStyle = side < 0 ? '#6fbf5a' : '#58a747'
    ctx.fill()
  }
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  for (const side of [-1, 1]) {
    ctx.beginPath()
    if (asleep) { ctx.moveTo(at.x + side * 5 - 2, top + 15); ctx.lineTo(at.x + side * 5 + 2, top + 15); ctx.stroke() }
    else { ctx.arc(at.x + side * 5, top + 15, 1.8, 0, Math.PI * 2); ctx.fill() }
    ctx.beginPath(); ctx.ellipse(at.x + side * 8.5, top + 19, 2.6, 1.5, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(245,169,160,0.7)'; ctx.fill(); ctx.fillStyle = INK
  }
  if (asleep) {
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#e8eef2'
    ctx.fillText('z z', at.x + 12, top - 6)
  }
}

function bubble(ctx: CanvasRenderingContext2D, at: Point, said: string): void {
  const text = said.length > BUBBLE_MAX ? `${said.slice(0, BUBBLE_MAX - 1)}…` : said
  ctx.font = '11px system-ui, sans-serif'
  const width = ctx.measureText(text).width + 14
  const x = at.x + 10
  const y = at.y - 62
  ctx.beginPath()
  ctx.roundRect(x, y, width, 20, 8)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.beginPath(); ctx.moveTo(x + 6, y + 19); ctx.lineTo(x - 2, y + 28); ctx.lineTo(x + 16, y + 19); ctx.fill()
  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 7, y + 10.5)
}

/** Where a character is shown: just in front of whatever shares its tile, so it is never hidden inside it. */
function standing(c: Person, state: StateView): Tile {
  for (const b of state.buildings) {
    const n = b.recipe.footprint
    if (c.at.x >= b.at.x && c.at.x < b.at.x + n && c.at.y >= b.at.y && c.at.y < b.at.y + n) {
      return { x: b.at.x + n, y: b.at.y + n / 2 - 0.5 }
    }
  }
  if (state.features.some((f) => f.at.x === c.at.x && f.at.y === c.at.y)) return { x: c.at.x + 0.7, y: c.at.y + 0.7 }
  return c.at
}

export function drawTown(ctx: CanvasRenderingContext2D, state: StateView, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height)

  // The view follows the first character (Pip), so the town stays readable at any plot size.
  const focusOn = state.characters[0] ? standing(state.characters[0], state) : { x: state.size / 2, y: state.size / 2 }
  const focus = centreOf(focusOn, { x: 0, y: 0 })
  const origin = { x: width / 2 - focus.x, y: height / 2 - focus.y + 20 }

  ground(ctx, state.size, origin)

  const things: Drawable[] = [
    ...state.features.map((f) => ({ at: f.at, draw: () => feature(ctx, f, origin) })),
    ...state.buildings.map((b) => ({
      at: { x: b.at.x + b.recipe.footprint - 1, y: b.at.y + b.recipe.footprint - 1 },
      draw: () => building(ctx, b, origin),
    })),
    ...state.characters.map((c) => {
      const at = standing(c, state)
      return { at: { x: at.x + 0.01, y: at.y + 0.01 }, draw: () => seedling(ctx, centreOf(at, origin), c.asleep) }
    }),
  ]
  for (const thing of drawOrder(things)) thing.draw()
  for (const c of state.characters) if (c.said) bubble(ctx, centreOf(standing(c, state), origin), c.said)

  if (state.weather !== 'dry') {
    const streaks = state.weather === 'a thin rain' ? 60 : state.weather === 'raining hard' ? 150 : 260
    ctx.strokeStyle = 'rgba(200,220,240,0.45)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < streaks; i++) {
      const x = (i * 97.3) % width
      const y = (i * 53.7) % height
      ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 9)
    }
    ctx.stroke()
  }
  if (state.night) {
    ctx.fillStyle = 'rgba(18,26,58,0.42)'
    ctx.fillRect(0, 0, width, height)
  }
}
