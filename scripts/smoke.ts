/**
 * One real model call, to see that the key works and what a request costs.
 * Run with: npm run smoke (Pip's model) or npm run smoke -- inhabitant (the inhabitants' model)
 */

import { loadConfig } from '../src/config.ts'
import { openAiClient } from '../src/model/client.ts'

const config = loadConfig(process.env)
const model = process.argv[2] === 'inhabitant' ? config.inhabitantModel : config.pipModel
const client = openAiClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, userAgent: config.userAgent, jsonMode: config.jsonMode })

const reply = await client.complete({
  model,
  system: 'Reply with JSON only.',
  user: '{"say":"hi"} — repeat this back.',
  sessionId: 'smoke',
  maxTokens: config.maxTokens,
  reasoningEffort: config.reasoningEffort,
})

console.log('model:', model)
console.log('reply:', reply.text)
console.log('usage:', reply.usage)
if (reply.finishReason === 'length') {
  console.log('\nWARNING: the reply was cut off by the token limit. Raise SEEDLINGS_MAX_TOKENS.')
}
if (reply.usage.billingSource === 'balance') {
  console.log('\nWARNING: this request was charged to your balance. Turn Extra Usage off on the Go page before running the town.')
}
