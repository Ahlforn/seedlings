import { wanderingClient } from '../../src/model/scripted.ts'
import { readDecision } from '../../src/mind/decision.ts'
import { readReflection } from '../../src/mind/reflect.ts'
import { systemPrompt, whatISee } from '../../src/mind/prompt.ts'
import { PIP_SHEET } from '../../src/mind/sheet.ts'
import { act, manifest, observe } from '../../src/world/seam.ts'
import { advance, character, createWorld, PIP_ID } from '../../src/world/world.ts'

const ask = async (client: ReturnType<typeof wanderingClient>, w: ReturnType<typeof createWorld>) => {
  const o = observe(w, PIP_ID)
  return client.complete({ model: 'fake', system: systemPrompt(manifest(), o, PIP_SHEET), user: whatISee(o, [], [], []), sessionId: 'pip', maxTokens: 400 })
}

test('the wandering stand-in only picks moves the world accepts, costs nothing, and gets a building built', async () => {
  const client = wanderingClient(); const w = createWorld(1)
  for (let i = 0; i < 40; i++) {
    const p = character(w, PIP_ID)
    if (p.asleep) { advance(w, 60); continue }
    const reply = await ask(client, w)
    expect(reply.usage.allowance).toBe(0)
    const decision = readDecision(reply.text)!
    const result = act(w, PIP_ID, decision.moves[0])
    expect(result.success, `${JSON.stringify(decision.moves[0])}: ${result.message}`).toBe(true)
    advance(w, Math.max(result.minutes, 1))
  }
  expect(w.buildings.some(b => b.workLeft === 0)).toBe(true)
})
test('the wandering stand-in writes a diary line when asked to reflect', async () => {
  const reply = await wanderingClient().complete({ model: 'fake', system: 'You are Pip.\n\nYou keep a diary.', user: '', sessionId: 'pip', maxTokens: 500 })
  expect(readReflection(reply.text)!.diary.length).toBeGreaterThan(0)
})
