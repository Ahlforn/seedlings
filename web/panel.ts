/** The side panel and top bar. Everything a model wrote is set with textContent, never as markup. */

import type { DiaryView, StateView, TraceView } from '../src/shared/types.ts'
import { drawPicture } from './draw.ts'

type Person = StateView['characters'][number]

const byId = (id: string) => document.getElementById(id) as HTMLElement
const TOWN = 'town'
const SELECTED_KEY = 'seedlings:selected'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  if (className) node.className = className
  return node
}

function remembered(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? 'pip'
  } catch {
    return 'pip'
  }
}

/** Who the panel is about: a character's id, or 'town'. */
let selected = remembered()
let latest: StateView | null = null

/** The character the panel shows, falling back to Pip when the selected one is gone. Null on the Town tab. */
function shown(state: StateView): Person | null {
  if (selected === TOWN) return null
  return state.characters.find((c) => c.id === selected) ?? state.characters.find((c) => c.tier === 'origin') ?? null
}

/** The id whose diary should be on show, or '' on the Town tab. */
export function selectedId(): string {
  return latest ? (shown(latest)?.id ?? '') : selected === TOWN ? '' : selected
}

export function select(id: string): void {
  if (id === selected) return
  selected = id
  try {
    localStorage.setItem(SELECTED_KEY, id)
  } catch {
    // only a convenience
  }
  openTraces.clear()
  older = []
  moreToLoad = false
  newest = []
  if (latest) showState(latest)
}

let onPick: (id: string) => void = select
/** Lets the page hear about tab clicks, so it can refetch the diary and redraw the selection. */
export function onSelect(fn: (id: string) => void): void {
  onPick = (id) => { select(id); fn(id) }
}

function tabs(state: StateView): void {
  const current = shown(state)?.id ?? TOWN
  const button = (id: string, label: string) => {
    const b = el('button', label, 'tab')
    b.type = 'button'
    b.setAttribute('aria-pressed', String(id === current))
    b.addEventListener('click', () => onPick(id))
    return b
  }
  byId('tabs').replaceChildren(...state.characters.map((c) => button(c.id, c.name)), button(TOWN, 'Town'))
}

export function showState(state: StateView): void {
  latest = state
  byId('clock').textContent = state.clock
  byId('weather').textContent = state.weather
  const finished = state.buildings.filter((b) => b.workLeft === 0).length
  const sites = state.buildings.length - finished
  const people = state.population.count
  byId('count').textContent =
    `${finished} ${finished === 1 ? 'building' : 'buildings'}${sites ? `, ${sites} being built` : ''}, ${people} ${people === 1 ? 'inhabitant' : 'inhabitants'}`

  byId('reason').textContent = state.budget.reason
  byId('reason').title = state.budget.trouble
  byId('left').textContent = `${Math.round(state.budget.leftToday * 100)}% of today left`
  const fill = byId('meter-fill')
  fill.style.width = `${Math.round(state.budget.leftToday * 100)}%`
  fill.classList.toggle('stopped', !state.budget.canThink || state.budget.trouble !== '')

  tabs(state)
  const who = shown(state)
  byId('person').hidden = who === null
  byId('townview').hidden = who !== null
  if (who === null) {
    const { count, limit } = state.population
    byId('population').textContent = `${count} ${count === 1 ? 'inhabitant' : 'inhabitants'}, of ${limit} the town can support right now.`
    const cafe = state.cafe
    byId('cafe').textContent = `${cafe.today} ${cafe.today === 1 ? 'lookup' : 'lookups'} today, ${cafe.total} in all: ${cafe.missing} found nothing, ${cafe.failed} could not connect.`
    byId('misses').replaceChildren(...cafe.recentMisses.map((m) => el('li', `Not found: "${m.words}" (${m.who}, ${m.clock})`)))
    showGallery(state)
    byId('events').replaceChildren(...state.events.map((e) => {
      const item = el('li')
      item.append(el('time', e.clock), el('span', e.text))
      return item
    }))
    return
  }
  byId('name').textContent = who.name
  byId('doing').textContent = who.doing === 'idle' ? 'Not doing anything in particular.' : `${who.name} is ${who.doing}.`
  byId('mind-heading').textContent = `On ${who.name}'s mind`
  byId('thought').textContent = who.thought ? `“${who.thought}”` : 'Nothing yet.'
  byId('mind').replaceChildren(...who.onMind.map((text) => el('li', text)))
  byId('home-heading').hidden = who.tier === 'origin'
  byId('home').hidden = who.tier === 'origin'
  byId('home').textContent = who.home || 'No home.'
  byId('hint').textContent = `Open an entry to see what ${who.name} saw and thought.`
}

const PICTURE_PX = 96
let galleryKey = ''

/** Pictures in the gallery, redrawn only when the set of pictures changes. */
function showGallery(state: StateView): void {
  const key = state.gallery.map((p) => p.id).join(',')
  if (key === galleryKey) return
  galleryKey = key
  if (state.gallery.length === 0) {
    byId('gallery').replaceChildren(el('li', 'Nobody has made a picture yet.', 'quiet'))
    return
  }
  byId('gallery').replaceChildren(...state.gallery.map((p) => {
    const item = el('li')
    const canvas = el('canvas')
    const ratio = window.devicePixelRatio || 1
    canvas.width = PICTURE_PX * ratio
    canvas.height = PICTURE_PX * ratio
    canvas.style.width = canvas.style.height = `${PICTURE_PX}px`
    const ctx = canvas.getContext('2d')
    if (ctx) { ctx.scale(ratio, ratio); drawPicture(ctx, p.shapes, PICTURE_PX) }
    const words = el('div')
    words.append(el('strong', p.title), el('span', `${p.byName}, ${p.mood}`, 'quiet'))
    if (p.description) words.append(el('span', p.description))
    words.append(el('time', p.clock))
    item.append(canvas, words)
    return item
  }))
}

function traceNode(trace: TraceView): HTMLElement {
  const box = el('div', '', 'trace')
  if (trace.turns.length === 0) box.append(el('p', 'Nothing is recorded for this entry.', 'quiet'))
  for (const turn of trace.turns) {
    const list = el('dl')
    const row = (label: string, value: string, className = '') => {
      list.append(el('dt', label), el('dd', value, className))
    }
    row('When', turn.clock)
    row('Thought', turn.consider || '(nothing)')
    row('Did', turn.moves.map((move) => {
      const settings = Object.entries(move.params).map(([key, value]) => `${key}: ${value}`).join(', ')
      return settings ? `${move.action} (${settings})` : move.action
    }).join('\n') || '(nothing)')
    if (turn.because) row('Why', turn.because)
    for (const result of turn.results) row(result.success ? 'It worked' : 'It did not work', result.message, result.success ? '' : 'failed')
    const saw = el('details')
    saw.append(el('summary', `What ${trace.name || 'they'} saw`), el('dd', turn.saw))
    list.append(saw)
    box.append(list)
  }
  return box
}

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url)
  if (response.status === 401) {
    location.href = '/login'
    return null
  }
  return response.ok ? ((await response.json()) as T) : null
}

const PAGE = 20
const openTraces = new Set<number>()
/** Entries older than the newest page, fetched when the reader asks for them. */
let older: DiaryView[] = []
let moreToLoad = false
let newest: DiaryView[] = []

function entryNode(entry: DiaryView): HTMLElement {
  const item = el('li')
  const button = el('button')
  button.type = 'button'
  button.setAttribute('aria-expanded', String(openTraces.has(entry.id)))
  button.append(el('time', entry.clock), el('span', entry.text, 'text'))
  item.append(button)

  let loading = false
  const open = async () => {
    if (loading) return
    loading = true
    const trace = await getJson<TraceView>(`/api/trace?diary=${entry.id}`)
    loading = false
    if (trace && openTraces.has(entry.id) && !item.querySelector('.trace')) item.append(traceNode(trace))
  }
  button.addEventListener('click', () => {
    const shownTrace = item.querySelector('.trace')
    if (shownTrace) {
      shownTrace.remove()
      openTraces.delete(entry.id)
    } else {
      openTraces.add(entry.id)
      void open()
    }
    button.setAttribute('aria-expanded', String(openTraces.has(entry.id)))
  })
  if (openTraces.has(entry.id)) void open()
  return item
}

function render(entries: DiaryView[], name: string): void {
  const list = byId('diary')
  if (entries.length === 0) {
    list.replaceChildren(el('li', `${name} has not written anything yet.`, 'quiet'))
    return
  }
  const items = entries.map(entryNode)
  if (moreToLoad) {
    const item = el('li')
    const more = el('button', 'Older entries', 'more')
    more.type = 'button'
    more.addEventListener('click', () => void loadOlder(entries[entries.length - 1].id))
    item.append(more)
    items.push(item)
  }
  list.replaceChildren(...items)
}

const nameOf = (id: string) => latest?.characters.find((c) => c.id === id)?.name ?? 'They'

async function loadOlder(beforeId: number): Promise<void> {
  const id = selectedId()
  if (!id) return
  const page = await getJson<DiaryView[]>(`/api/diary?character=${encodeURIComponent(id)}&before=${beforeId}`)
  if (!page || id !== selectedId()) return
  older = [...older, ...page.filter((entry) => !older.some((known) => known.id === entry.id))]
  moreToLoad = page.length === PAGE
  render([...newest, ...older], nameOf(id))
}

export async function showDiary(): Promise<void> {
  const id = selectedId()
  if (!id) return
  const page = await getJson<DiaryView[]>(`/api/diary?character=${encodeURIComponent(id)}`)
  // The reader may have picked someone else while this was on its way.
  if (!page || id !== selectedId()) return
  newest = page
  const oldestShown = page.length ? page[page.length - 1].id : 0
  older = older.filter((entry) => entry.id < oldestShown)
  if (older.length === 0) moreToLoad = page.length === PAGE
  render([...newest, ...older], nameOf(id))
}
