/** The side panel and top bar. Everything a model wrote is set with textContent, never as markup. */

import type { DiaryView, StateView, TraceView } from '../src/shared/types.ts'

const byId = (id: string) => document.getElementById(id) as HTMLElement

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  if (className) node.className = className
  return node
}

export function showState(state: StateView): void {
  byId('clock').textContent = state.clock
  byId('weather').textContent = state.weather
  const finished = state.buildings.filter((b) => b.workLeft === 0).length
  const sites = state.buildings.length - finished
  byId('count').textContent = `${finished} ${finished === 1 ? 'building' : 'buildings'}${sites ? `, ${sites} being built` : ''}`

  byId('reason').textContent = state.budget.reason
  byId('reason').title = state.budget.trouble
  byId('left').textContent = `${Math.round(state.budget.leftToday * 100)}% of today left`
  const fill = byId('meter-fill')
  fill.style.width = `${Math.round(state.budget.leftToday * 100)}%`
  fill.classList.toggle('stopped', !state.budget.canThink || state.budget.trouble !== '')

  const pip = state.characters.find((c) => c.tier === 'origin')
  if (!pip) return
  byId('doing').textContent = pip.doing === 'idle' ? 'Not doing anything in particular.' : `Pip is ${pip.doing}.`
  byId('thought').textContent = pip.thought ? `“${pip.thought}”` : 'Nothing yet.'
  byId('mind').replaceChildren(...pip.onMind.map((text) => el('li', text)))
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
    saw.append(el('summary', 'What Pip saw'), el('dd', turn.saw))
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
    const shown = item.querySelector('.trace')
    if (shown) {
      shown.remove()
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

function render(entries: DiaryView[]): void {
  const list = byId('diary')
  if (entries.length === 0) {
    list.replaceChildren(el('li', 'Pip has not written anything yet.', 'quiet'))
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

let newest: DiaryView[] = []

async function loadOlder(beforeId: number): Promise<void> {
  const page = await getJson<DiaryView[]>(`/api/diary?character=pip&before=${beforeId}`)
  if (!page) return
  older = [...older, ...page.filter((entry) => !older.some((known) => known.id === entry.id))]
  moreToLoad = page.length === PAGE
  render([...newest, ...older])
}

export async function showDiary(): Promise<void> {
  const page = await getJson<DiaryView[]>('/api/diary?character=pip')
  if (!page) return
  newest = page
  const oldestShown = page.length ? page[page.length - 1].id : 0
  older = older.filter((entry) => entry.id < oldestShown)
  if (older.length === 0) moreToLoad = page.length === PAGE
  render([...newest, ...older])
}
