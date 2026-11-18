/** The "Cause an event" form. Sends JSON to the town and shows its answer. Text from the town is set as text. */

import type { StateView } from '../src/shared/types.ts'

type Kind = 'weather' | 'close' | 'reopen' | 'break' | 'stranger' | 'facility'
const PREMISE_MAX = 300

const byId = (id: string) => document.getElementById(id) as HTMLElement

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  return node
}

function choice(label: string, name: string, values: string[], words: (v: string) => string = (v) => v): HTMLElement {
  const wrap = el('label', label)
  const select = el('select')
  select.name = name
  for (const value of values) {
    const option = el('option', words(value))
    option.value = value
    select.append(option)
  }
  if (values.length === 0) select.append(el('option', 'nothing to choose'))
  select.disabled = values.length === 0
  wrap.append(select)
  return wrap
}

function fields(kind: Kind, state: StateView): HTMLElement[] {
  const owner = state.owner
  switch (kind) {
    case 'weather': return [choice('Weather', 'weather', owner.weathers)]
    case 'close': case 'reopen': case 'break': return [choice('Building', 'building', owner.buildings)]
    case 'facility': {
      const name = el('label', 'Name (optional)')
      const input = el('input'); input.name = 'name'; input.maxLength = 30
      name.append(input)
      const names = new Map(owner.facilities.map((f) => [f.kind, f.name]))
      return [choice('Facility', 'facility', owner.facilities.map((f) => f.kind), (k) => names.get(k) ?? k), choice('Where', 'site', owner.sites), name]
    }
    case 'stranger': {
      const wrap = el('label', 'Who arrives, in a line or two')
      const text = el('textarea'); text.name = 'premise'; text.maxLength = PREMISE_MAX; text.rows = 3
      const count = el('span', `0 / ${PREMISE_MAX}`); count.className = 'quiet'
      text.addEventListener('input', () => { count.textContent = `${text.value.length} / ${PREMISE_MAX}` })
      wrap.append(text, count)
      return [wrap]
    }
  }
}

function payload(kind: Kind, form: HTMLFormElement): Record<string, unknown> {
  const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? ''
  switch (kind) {
    case 'weather': return { kind, weather: value('weather') }
    case 'close': return { kind: 'close', building: value('building'), closed: true }
    case 'reopen': return { kind: 'close', building: value('building'), closed: false }
    case 'break': return { kind, building: value('building') }
    case 'stranger': return { kind, premise: value('premise') }
    case 'facility': return { kind, facility: value('facility'), site: value('site'), ...(value('name') ? { name: value('name') } : {}) }
  }
}

export function setupEvents(latest: () => StateView | null): void {
  const dialog = byId('event-dialog') as HTMLDialogElement
  const form = byId('event-form') as HTMLFormElement
  const kindSelect = byId('event-kind') as HTMLSelectElement
  const answer = byId('event-answer')
  const send = byId('event-send') as HTMLButtonElement

  const render = () => {
    const state = latest()
    if (!state) return
    const full = state.population.count >= state.population.limit
    const stranger = kindSelect.querySelector('option[value="stranger"]') as HTMLOptionElement
    stranger.disabled = full
    stranger.textContent = full ? 'A stranger arrives (the town is full)' : 'A stranger arrives'
    if (full && kindSelect.value === 'stranger') kindSelect.value = 'weather'
    byId('event-fields').replaceChildren(...fields(kindSelect.value as Kind, state))
  }

  byId('event-open').addEventListener('click', () => {
    answer.textContent = ''
    render()
    dialog.showModal()
  })
  byId('event-close').addEventListener('click', () => dialog.close())
  kindSelect.addEventListener('change', () => { answer.textContent = ''; render() })
  form.addEventListener('submit', async (submitted) => {
    submitted.preventDefault()
    send.disabled = true
    answer.textContent = kindSelect.value === 'stranger' ? 'Writing the stranger…' : 'Sending…'
    try {
      const response = await fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(kindSelect.value as Kind, form)),
      })
      if (response.status === 401) { location.href = '/login'; return }
      const result = (await response.json()) as { ok?: boolean; message?: string; error?: string }
      answer.textContent = result.message ?? result.error ?? 'The town did not answer.'
      answer.className = result.ok ? '' : 'failed'
      if (result.ok) render()
    } catch {
      answer.textContent = 'The town is not answering.'
      answer.className = 'failed'
    } finally {
      send.disabled = false
    }
  })
}
