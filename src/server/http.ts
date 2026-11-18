/** The private window onto the town: login, live state, diary, and the trace behind each diary entry. */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import type { BudgetKeeper, BudgetReason } from '../budget/keeper.ts'
import type { DiaryView, StateView, TraceView, World } from '../shared/types.ts'
import type { DiaryEntry, Store } from '../store/store.ts'
import type { Scheduler } from '../town/scheduler.ts'
import { clockOf } from '../world/clock.ts'
import { RAIN_WORDS } from '../world/seam.ts'
import { PIP_ID } from '../world/world.ts'
import { usesToday } from '../facilities/contract.ts'
import { FACILITIES } from '../facilities/index.ts'
import { candidateSites } from '../world/sites.ts'
import type { EventResult } from '../town/events.ts'

const COOKIE = 'seedlings_session'
const SAID_FOR_MINUTES = 30
const DIARY_PAGE = 20
const ON_MIND = 3
const EVENTS_SHOWN = 20
const GALLERY_SHOWN = 12
const MISSES_SHOWN = 10
const MAX_LOGIN_BODY = 10_000
const MAX_EVENT_BODY = 10_000
const WRONG_PASSWORD_DELAY_MS = 300

const REASONS: Record<BudgetReason, string> = {
  ok: 'thinking',
  day_share_spent: "resting until tomorrow's share",
  five_hour_limit: 'resting: five-hour limit',
  weekly_limit: 'resting: weekly limit',
  month_spent: "resting: this month's allowance is spent",
  charged_to_balance: 'stopped: a reply was charged to your balance',
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seedlings</title>
<style>body{font-family:system-ui,sans-serif;background:#22303c;color:#f3ead6;display:grid;place-items:center;min-height:100vh;margin:0}
form{display:grid;gap:12px;width:min(280px,80vw)}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #5b6b7a}
button{background:#6fbf5a;border-color:#6fbf5a;color:#16212b;cursor:pointer}</style></head>
<body><form method="post" action="/login"><label for="password">Password</label>
<input id="password" name="password" type="password" autofocus autocomplete="current-password">
<button type="submit">Open the town</button></form></body></html>`

const TROUBLE_MAX = 160

export function stateView(world: World, store: Store, budget: BudgetKeeper, thoughtOf: (id: string) => string, trouble = ''): StateView {
  const clock = clockOf(world.minutes)
  const status = budget.status('town')
  return {
    clock: clock.label,
    day: clock.day,
    night: clock.night,
    weather: RAIN_WORDS[world.rain],
    size: world.size,
    features: world.features,
    buildings: world.buildings,
    notes: world.notes,
    characters: world.characters.map((c) => ({
      id: c.id,
      name: c.name,
      tier: c.tier,
      look: c.look,
      home: world.buildings.find((b) => b.id === c.homeId)?.name ?? '',
      at: c.at,
      asleep: c.asleep,
      doing: c.asleep ? 'asleep' : c.doing,
      said: c.said && world.minutes - c.saidAt <= SAID_FOR_MINUTES ? c.said : '',
      mood: c.body.mood,
      thought: thoughtOf(c.id),
      onMind: store.openMindItems(c.id).slice(0, ON_MIND).map((item) => item.text),
    })),
    events: world.events.slice(-EVENTS_SHOWN).reverse().map((e) => ({ clock: clockOf(e.minute).label, text: e.text })),
    population: { count: world.characters.filter((c) => c.tier === 'inhabitant').length, limit: world.populationLimit },
    cafe: {
      today: usesToday(world, 'cafe'),
      ...store.lookupStats(),
      recentMisses: store.recentMisses(MISSES_SHOWN).map((l) => ({
        who: world.characters.find((c) => c.id === l.characterId)?.name ?? 'someone who has gone',
        words: l.words,
        clock: clockOf(l.worldMinutes).label,
      })),
    },
    owner: {
      sites: candidateSites(world).map((s) => s.name),
      buildings: world.buildings.map((b) => b.name),
      facilities: FACILITIES.map((f) => ({ kind: f.kind, name: f.name })),
      weathers: [...RAIN_WORDS],
    },
    gallery: store.gallery(GALLERY_SHOWN).map((p) => ({
      id: p.id, title: p.title, byName: p.byName, mood: p.mood, description: p.description, clock: clockOf(p.minute).label, shapes: p.shapes,
    })),
    budget: {
      leftToday: status.leftTodayFraction,
      canThink: status.canThink,
      // A town that may think but cannot reach its model, or cannot save, says so rather than "thinking".
      reason: status.canThink && trouble ? 'trouble reaching the model, trying again' : REASONS[status.reason],
      trouble: trouble.slice(0, TROUBLE_MAX),
    },
  }
}

const diaryView = (entry: DiaryEntry): DiaryView => ({ id: entry.id, clock: clockOf(entry.worldMinutes).label, text: entry.text })

function traceView(store: Store, world: World, entry: DiaryEntry): TraceView {
  return {
    name: world.characters.find((c) => c.id === entry.characterId)?.name ?? '',
    entry: diaryView(entry),
    turns: store.turnsBetween(entry.characterId, entry.fromTurn, entry.toTurn).map((turn) => {
      const decision = safeParse(turn.decision) as { consider?: string; moves?: TraceView['turns'][number]['moves']; because?: string } | null
      const results = (safeParse(turn.results) as { success: boolean; message: string }[] | null) ?? []
      return {
        clock: clockOf(turn.worldMinutes).label,
        saw: turn.userPrompt,
        consider: decision?.consider ?? '',
        moves: decision?.moves ?? [],
        because: decision?.because ?? '',
        results: results.map((result) => ({ success: Boolean(result.success), message: String(result.message ?? '') })),
      }
    }),
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((done, fail) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > limit) {
        fail(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => done(body))
    req.on('error', fail)
  })
}

const digest = (text: string) => createHash('sha256').update(text).digest()

export function createServer(deps: {
  world: () => World
  store: Store
  budget: BudgetKeeper
  scheduler: Pick<Scheduler, 'onChange' | 'lastThought' | 'trouble'>
  /** carries out an owner event; the server only checks who sent it and how */
  applyEvent(input: unknown): Promise<EventResult>
  password: string
  staticDir: string
}): Server {
  const sessions = new Set<string>()
  const streams = new Set<() => void>()
  const staticRoot = resolve(deps.staticDir)
  const state = () => stateView(deps.world(), deps.store, deps.budget, (id) => deps.scheduler.lastThought(id), deps.scheduler.trouble())

  function signedIn(req: IncomingMessage): boolean {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [name, value] = part.trim().split('=')
      if (name === COOKIE && value && sessions.has(value)) return true
    }
    return false
  }

  async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let given = ''
    try {
      given = new URLSearchParams(await readBody(req, MAX_LOGIN_BODY)).get('password') ?? ''
    } catch {
      res.writeHead(413).end()
      return
    }
    if (!timingSafeEqual(digest(given), digest(deps.password))) {
      await new Promise((wait) => setTimeout(wait, WRONG_PASSWORD_DELAY_MS))
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }).end(LOGIN_PAGE)
      return
    }
    const token = randomBytes(32).toString('hex')
    sessions.add(token)
    res.writeHead(302, { Location: '/', 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/` }).end()
  }

  /** Only the signed-in owner, only from the watch page itself, only JSON: a link or form elsewhere cannot send one. */
  async function event(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin
    let fromHere = false
    try {
      fromHere = origin !== undefined && new URL(origin).host === req.headers.host
    } catch {
      fromHere = false
    }
    if (!fromHere) return sendJson(res, 403, { error: 'events are only accepted from the watch page' })
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return sendJson(res, 415, { error: 'send JSON' })
    let input: unknown
    try {
      input = JSON.parse(await readBody(req, MAX_EVENT_BODY))
    } catch (error) {
      if (error instanceof Error && error.message === 'body too large') return sendJson(res, 413, { error: 'too large' })
      return sendJson(res, 400, { error: 'not JSON' })
    }
    const result = await deps.applyEvent(input)
    sendJson(res, 200, result)
    // Show the change at once rather than at the next step.
    for (const send of streams) send()
  }

  function stream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    const send = () => res.write(`data: ${JSON.stringify(state())}\n\n`)
    send()
    const stop = deps.scheduler.onChange(send)
    streams.add(send)
    req.on('close', () => { streams.delete(send) })
    req.on('close', stop)
  }

  async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      res.writeHead(404).end()
      return
    }
    const file = resolve(staticRoot, `.${decoded === '/' ? '/index.html' : decoded}`)
    if (!file.startsWith(staticRoot + sep)) {
      res.writeHead(404).end()
      return
    }
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'X-Content-Type-Options': 'nosniff',
    })
    createReadStream(file).pipe(res)
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // The raw path is kept as sent: URL parsing would quietly fold away ".." segments.
    const [rawPath, query = ''] = (req.url ?? '/').split('?')
    const params = new URLSearchParams(query)

    if (rawPath === '/login') {
      if (req.method === 'POST') return login(req, res)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(LOGIN_PAGE)
      return
    }
    if (!signedIn(req)) {
      if (rawPath.startsWith('/api/')) return sendJson(res, 401, { error: 'not signed in' })
      res.writeHead(302, { Location: '/login' }).end()
      return
    }
    if (rawPath === '/api/event' && req.method === 'POST') return event(req, res)
    if (req.method !== 'GET') {
      res.writeHead(405).end()
      return
    }

    if (rawPath === '/api/state') return sendJson(res, 200, state())
    if (rawPath === '/api/stream') return stream(req, res)
    if (rawPath === '/api/diary') {
      const before = Number(params.get('before'))
      const entries = deps.store.diary(params.get('character') ?? PIP_ID, DIARY_PAGE, before > 0 ? before : undefined)
      return sendJson(res, 200, entries.map(diaryView))
    }
    if (rawPath === '/api/trace') {
      const entry = deps.store.diaryEntry(Number(params.get('diary')))
      if (!entry) return sendJson(res, 404, { error: 'no such diary entry' })
      return sendJson(res, 200, traceView(deps.store, deps.world(), entry))
    }
    if (rawPath.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })
    return serveStatic(rawPath, res)
  }

  return createHttpServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('[seedlings] request failed:', error instanceof Error ? error.message : error)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
}
