/** Stand-in models. They cost nothing and let the town run in tests and fake runs. */

import { ModelError } from './client.ts'
import type { ModelClient, ModelRequest } from './client.ts'

export type Scripted = string | Error | ((req: ModelRequest) => string)

/** Replays a list of replies in order. Throws when an entry is an Error, or when the script runs out. */
export function scriptedClient(replies: Scripted[], loop = false): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = []
  let next = 0
  return {
    requests,
    async complete(req) {
      requests.push(req)
      if (next >= replies.length) {
        if (!loop || replies.length === 0) throw new ModelError('The script has run out of replies.')
        next = 0
      }
      const reply = replies[next++]
      if (reply instanceof Error) throw reply
      return {
        text: typeof reply === 'function' ? reply(req) : reply,
        usage: { allowance: 0.01, inputTokens: 100, outputTokens: 20, billingSource: 'go' },
      }
    },
  }
}
