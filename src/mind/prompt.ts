/** Turns the world's data into words for the model. The model never sees raw JSON or ids. */

import type { Belief, Memory, MindItem } from '../store/store.ts'
import type { Manifest, Observation } from '../world/seam.ts'
import type { Sheet } from './sheet.ts'

const BELIEFS_SHOWN = 5

export function whoYouAre(sheet: Sheet): string {
  return `You are ${sheet.name}, ${sheet.you}.

WHO YOU ARE:
${sheet.core}
You are: ${sheet.traits.join('; ')}.
You care about: ${sheet.values.join('; ')}.
You fear: ${sheet.fears.join('; ')}.`
}

/** The system message: who you are, where you are, and only the moves that are on offer right now. */
export function systemPrompt(m: Manifest, o: Observation, sheet: Sheet): string {
  const moves = o.available.map((offer) => {
    const spec = m.moves.find((move) => move.name === offer.name)
    if (!spec) return `- ${offer.name}`
    const settings = Object.entries(spec.params).map(([name, param]) => {
      const choices = offer.params[name] ?? param.values
      const parts = [choices ? `one of ${choices.join(' | ')}` : '', param.hint ?? ''].filter(Boolean)
      return `    ${name}: ${parts.join('. ')}`
    })
    return [`- ${spec.name}: ${spec.description}`, ...settings].join('\n')
  })

  return `${whoYouAre(sheet)}

WHERE YOU ARE: ${m.description}
${m.glossary.map((line) => `- ${line}`).join('\n')}

${m.stance} What you do comes from how you feel, what's on your mind and what's in front of you. You can only do the things listed below.

HOW YOU WORK:
- Decide one to three moves at a time, in order. They happen one after another.
- If a move does not work, the rest are dropped and you get to think again.

WHAT YOU CAN DO:
${moves.join('\n')}

RESPOND WITH JSON ONLY:
{"consider": "one short line to yourself before you choose, fifteen words at most", "do": [{"action": "<name>", "params": {...}}], "because": "your reason, in a few plain words", "remember": {"text": "one thing from just now worth keeping, in your own words", "kind": "person|work|fact|moment"}}
"do" holds one to three moves from the list above, never none. "remember" is optional: leave it out unless something is worth keeping.`
}

function moodWords(mood: number): string {
  if (mood <= -0.4) return 'low'
  if (mood <= -0.1) return 'a little flat'
  if (mood < 0.1) return 'even'
  if (mood < 0.4) return 'good'
  return 'bright'
}

const list = (lines: string[]) => lines.map((line) => `- ${line}`).join('\n')

/** The user message: what is in front of the character, and what comes to mind. Empty sections are left out. */
export function whatISee(o: Observation, recalled: Memory[], beliefs: Belief[], loudest: MindItem[]): string {
  const sections = [`THE TIME: ${o.clock}. ${o.environment}`, `THE PLACE: ${o.room}`]
  if (o.here.length) sections.push(`HERE:\n${list(o.here)}`)
  if (o.home) sections.push(`YOUR HOME: ${o.home}`)
  if (o.people.length) sections.push(`WHO IS AROUND:\n${list(o.people)}`)
  if (o.heard.length) sections.push(`YOU HEARD:\n${list(o.heard)}`)
  if (o.notes.length) sections.push(`NOTES HERE:\n${list(o.notes)}`)
  if (o.recentEvents.length) sections.push(`EARLIER:\n${list(o.recentEvents)}`)
  if (recalled.length) sections.push(`YOU REMEMBER:\n${list(recalled.map((memory) => memory.text))}`)
  if (beliefs.length) sections.push(`YOU HAVE LEARNED:\n${list(beliefs.slice(0, BELIEFS_SHOWN).map((belief) => belief.text))}`)
  if (loudest.length) sections.push(`ON YOUR MIND:\n${list(loudest.map((item) => `${item.kind}: ${item.text}`))}`)
  sections.push(`YOUR BODY: ${o.body}. Your mood is ${moodWords(o.self.mood)}.`)
  sections.push("What do you do? It's your call. JSON only.")
  return sections.join('\n\n')
}
