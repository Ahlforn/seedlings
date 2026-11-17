/** Talking to a model. Any OpenAI-shaped chat endpoint works; OpenCode Go adds what a request cost. */

export type ModelRequest = { model: string; system: string; user: string; sessionId: string; maxTokens: number }
export type ModelUsage = {
  /** Go only: what the request counted toward the plan's limits. Null from other providers. */
  allowance: number | null
  inputTokens: number
  outputTokens: number
  billingSource: string | null
}
export type ModelReply = {
  text: string
  usage: ModelUsage
  /** 'length' means the reply was cut off by the token limit. Null when the provider does not say. */
  finishReason?: string | null
}

export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelReply>
}

export class ModelError extends Error {
  status: number | null
  retryAfterMs: number | null

  constructor(message: string, status: number | null = null, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'ModelError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

type ChatResponse = {
  choices?: { finish_reason?: unknown; message?: { content?: unknown } }[]
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    opencode?: { allowance?: unknown; billing_source?: unknown }
  }
}

/** A usage figure is only trusted when it is a sane number; anything else counts as not reported. */
const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

export function openAiClient(opts: {
  baseUrl: string
  apiKey: string
  userAgent: string
  jsonMode: boolean
  fetch?: typeof fetch
  timeoutMs?: number
}): ModelClient {
  const send = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 60_000

  return {
    async complete(req) {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_tokens: req.maxTokens,
      }
      if (opts.jsonMode) body.response_format = { type: 'json_object' }

      let response: Response
      try {
        response = await send(`${opts.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': opts.userAgent,
            'x-opencode-session': req.sessionId,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        throw new ModelError(`The model could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`)
      }

      if (!response.ok) {
        const seconds = Number(response.headers.get('retry-after'))
        const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
        const detail = (await response.text().catch(() => '')).slice(0, 300)
        throw new ModelError(`The model answered ${response.status}: ${detail}`, response.status, retryAfterMs)
      }

      let data: ChatResponse
      try {
        data = (await response.json()) as ChatResponse
      } catch {
        throw new ModelError('The model answered with something that is not JSON.', response.status)
      }
      const choice = data.choices?.[0]
      if (!choice) throw new ModelError('The model answered with no content.', response.status)
      // A model that reasons first can spend its whole token limit before answering. The content is
      // then empty, but the request was still paid for, so it is returned with its usage, not thrown.
      const content = choice.message?.content

      return {
        text: typeof content === 'string' ? content : '',
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
        usage: {
          allowance: amount(data.usage?.opencode?.allowance),
          inputTokens: amount(data.usage?.prompt_tokens) ?? 0,
          outputTokens: amount(data.usage?.completion_tokens) ?? 0,
          billingSource: typeof data.usage?.opencode?.billing_source === 'string' ? data.usage.opencode.billing_source : null,
        },
      }
    },
  }
}
