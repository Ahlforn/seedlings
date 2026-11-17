/** The watch page: loads the town's state, follows the live stream, and redraws. */

import type { StateView } from '../src/shared/types.ts'
import { drawTown } from './draw.ts'
import { showDiary, showState } from './panel.ts'

const RECONNECT_MS = 3000
const canvas = document.getElementById('town') as HTMLCanvasElement
const status = document.getElementById('status') as HTMLElement
let latest: StateView | null = null
let lastDiaryKey = ''

function paint(): void {
  if (!latest) return
  const ratio = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  drawTown(ctx, latest, width, height)
}

function take(state: StateView): void {
  latest = state
  showState(state)
  paint()
  // The diary only changes when Pip has acted, so it is refetched when what Pip is doing changes.
  const key = `${state.day}|${state.pip.doing}|${state.pip.thought}`
  if (key !== lastDiaryKey) {
    lastDiaryKey = key
    void showDiary()
  }
}

function follow(): void {
  const stream = new EventSource('/api/stream')
  stream.onopen = () => { status.textContent = '' }
  stream.onmessage = (message) => take(JSON.parse(message.data) as StateView)
  stream.onerror = () => {
    stream.close()
    status.textContent = 'Lost the connection to the town. Trying again…'
    setTimeout(start, RECONNECT_MS)
  }
}

async function start(): Promise<void> {
  try {
    const response = await fetch('/api/state')
    if (response.status === 401) {
      location.href = '/login'
      return
    }
    if (!response.ok) throw new Error(String(response.status))
    take((await response.json()) as StateView)
    follow()
  } catch {
    status.textContent = 'The town is not answering. Trying again…'
    setTimeout(start, RECONNECT_MS)
  }
}

window.addEventListener('resize', paint)
void start()
