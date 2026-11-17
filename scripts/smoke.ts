/** One real model call, to see that the key works and what a request costs. Run with: npm run smoke */

import { loadConfig } from '../src/config.ts'
import { openAiClient } from '../src/model/client.ts'

const config = loadConfig(process.env)
const client = openAiClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, userAgent: config.userAgent, jsonMode: config.jsonMode })

const reply = await client.complete({
  model: config.pipModel,
  system: 'Reply with JSON only.',
  user: '{"say":"hi"} — repeat this back.',
  sessionId: 'smoke',
  maxTokens: 100,
})

console.log('model:', config.pipModel)
console.log('reply:', reply.text)
console.log('usage:', reply.usage)
if (reply.usage.billingSource === 'balance') {
  console.log('\nWARNING: this request was charged to your balance. Turn Extra Usage off on the Go page before running the town.')
}
