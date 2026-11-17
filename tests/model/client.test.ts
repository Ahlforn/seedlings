import { openAiClient, ModelError } from '../../src/model/client.ts'
import { scriptedClient } from '../../src/model/scripted.ts'

const req = { model: 'glm-5.2', system: 'sys', user: 'usr', sessionId: 'pip', maxTokens: 300 }
const ok = (body: unknown, init: ResponseInit = {}) =>
  (async () => new Response(JSON.stringify(body), { status: 200, ...init })) as unknown as typeof fetch

test('sends the right request and identifies itself', async () => {
  let seen: { url: string; init: RequestInit } | undefined
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"do":[]}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, opencode: { allowance: 0.004, billing_source: 'go' } } }))
  }) as unknown as typeof fetch
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'seedlings-town/0.1', jsonMode: true, fetch: f })
  const r = await c.complete(req)
  expect(seen!.url).toBe('https://x/v1/chat/completions')
  const h = new Headers(seen!.init.headers)
  expect(h.get('authorization')).toBe('Bearer K')
  expect(h.get('user-agent')).toBe('seedlings-town/0.1')
  expect(h.get('x-opencode-session')).toBe('pip')
  const body = JSON.parse(seen!.init.body as string)
  expect(body).toMatchObject({ model: 'glm-5.2', max_tokens: 300, response_format: { type: 'json_object' } })
  expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user'])
  expect(r).toEqual({ text: '{"do":[]}', finishReason: null, usage: { allowance: 0.004, inputTokens: 12, outputTokens: 3, billingSource: 'go' } })
})
test('another provider without the opencode block still works', async () => {
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: false,
    fetch: ok({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) })
  expect((await c.complete(req)).usage).toMatchObject({ allowance: null, billingSource: null })
})
test('errors carry status and retry-after', async () => {
  const f = (async () => new Response('slow down', { status: 429, headers: { 'retry-after': '30' } })) as unknown as typeof fetch
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: true, fetch: f })
  await expect(c.complete(req)).rejects.toMatchObject({ status: 429, retryAfterMs: 30000 })
})
test('a reply with no content is an error, not an empty string', async () => {
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: true, fetch: ok({ choices: [] }) })
  await expect(c.complete(req)).rejects.toBeInstanceOf(ModelError)
})
test('a hung request times out', async () => {
  const f = ((_: string, init: RequestInit) => new Promise((_, rej) =>
    init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: true, fetch: f, timeoutMs: 20 })
  await expect(c.complete(req)).rejects.toBeInstanceOf(ModelError)
})
test('the stand-in replays its script and remembers requests', async () => {
  const c = scriptedClient(['a', new ModelError('down'), (r) => r.sessionId])
  expect((await c.complete(req)).text).toBe('a')
  await expect(c.complete(req)).rejects.toBeInstanceOf(ModelError)
  expect((await c.complete(req)).text).toBe('pip')
  await expect(c.complete(req)).rejects.toBeInstanceOf(ModelError)
  expect(c.requests).toHaveLength(4)
})

// Final review: usage figures that are not sane numbers must not reach the ledger.
test.each([[Number.NaN], [-1], ['12'], [Infinity]])('an allowance of %s is treated as not reported', async (allowance) => {
  const body = JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 'x', completion_tokens: -5, opencode: { allowance: 0, billing_source: 'go' } } })
    .replace('"allowance":0', `"allowance":${typeof allowance === 'string' ? JSON.stringify(allowance) : Number.isFinite(allowance) ? allowance : '1e999'}`)
  const f = (async () => new Response(body)) as unknown as typeof fetch
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: false, fetch: f })
  expect((await c.complete(req)).usage).toEqual({ allowance: null, inputTokens: 0, outputTokens: 0, billingSource: 'go' })
})

// Found on the first live run: glm-5.2 reasons before it answers, and the reasoning counts against max_tokens.
test('a reply cut off by the token limit comes back with what it cost, and says it was cut off', async () => {
  const f = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: null, reasoning_content: 'thinking…' } }],
    usage: { prompt_tokens: 1043, completion_tokens: 400, opencode: { allowance: 0.0032, billing_source: 'go' } } }))) as unknown as typeof fetch
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: true, fetch: f })
  expect(await c.complete(req)).toEqual({ text: '', finishReason: 'length',
    usage: { allowance: 0.0032, inputTokens: 1043, outputTokens: 400, billingSource: 'go' } })
})

// Found on a long live run: glm-5.2's reasoning varied from 2,500 to 4,600 tokens on the same prompt.
test('a reasoning effort is sent when one is set, and left out when not', async () => {
  const bodies: Record<string, unknown>[] = []
  const f = (async (_: string, init: RequestInit) => { bodies.push(JSON.parse(init.body as string))
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })) }) as unknown as typeof fetch
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: true, fetch: f })
  await c.complete({ ...req, reasoningEffort: 'low' })
  await c.complete({ ...req, reasoningEffort: '' })
  await c.complete(req)
  expect(bodies[0].reasoning_effort).toBe('low')
  expect('reasoning_effort' in bodies[1]).toBe(false)
  expect('reasoning_effort' in bodies[2]).toBe(false)
})
