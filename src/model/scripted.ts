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
        finishReason: 'stop',
      }
    },
  }
}

type Offered = Map<string, Map<string, string[]>>

/** Reads the moves on offer, and their choices, back out of a system prompt. */
function movesOnOffer(system: string): Offered {
  const offered: Offered = new Map()
  const section = system.split('WHAT YOU CAN DO:')[1]?.split('RESPOND WITH JSON ONLY:')[0] ?? ''
  let current: Map<string, string[]> | null = null
  for (const row of section.split('\n')) {
    const move = /^- (\w+):/.exec(row)
    if (move) {
      current = new Map()
      offered.set(move[1], current)
      continue
    }
    const setting = /^ {4}(\w+): one of (.+)$/.exec(row)
    if (setting && current) {
      const choices = setting[2].split(' | ')
      choices[choices.length - 1] = choices[choices.length - 1].split('. ')[0]
      current.set(setting[1], choices)
    }
  }
  return offered
}

/**
 * A stand-in that reads the moves listed in the prompt and picks a plausible one, so a fake run
 * shows Pip eating, sleeping, building and bringing inhabitants to life, and the inhabitants
 * talking and leaving notes. It reports an allowance of 0, so a fake town never runs out of budget.
 */
export function wanderingClient(): ModelClient {
  const walls = ['cream', 'blue', 'sand', 'white', 'yellow', 'brick']
  const roofs = ['pitched', 'pyramid', 'flat', 'dome']
  const purposes = ['home', 'food', 'other']
  const names = ['Mo', 'Fen', 'Dot', 'Ash', 'Bree', 'Kit', 'Lu', 'Nim', 'Oz', 'Pell', 'Rue', 'Tam']
  let turn = 0
  let built = 0
  let made = 0

  function decide(req: ModelRequest): { consider: string; move: { action: string; params: Record<string, string> } } {
    const offered = movesOnOffer(req.system)
    const body = /YOUR BODY: (.*)/.exec(req.user)?.[1] ?? ''
    const night = /THE TIME: [^\n]*Night/.test(req.user)
    const first = (move: string, setting: string) => offered.get(move)?.get(setting)?.[0]
    turn += 1

    const bed = first('sleep', 'target')
    if (bed && (night || /rest (strong|urgent)/.test(body))) return { consider: 'I can hardly keep my leaves up.', move: { action: 'sleep', params: { target: bed } } }
    const food = first('eat', 'target')
    if (food && /hunger/.test(body)) return { consider: 'Something to eat first.', move: { action: 'eat', params: { target: food } } }
    const home = first('create_inhabitant', 'home')
    if (home && turn % 4 === 0 && made < names.length) {
      const pick = (setting: string) => {
        const choices = offered.get('create_inhabitant')?.get(setting) ?? []
        return choices[made % Math.max(1, choices.length)] ?? ''
      }
      const name = names[made]
      const params = {
        name, kind: 'a small creature', who: `${name} is new here and curious about everything.`, traits: 'curious, quiet',
        cares_about: 'company', fears: 'the dark', colour: pick('colour'), mark: pick('mark'), home,
      }
      made += 1
      return { consider: 'Someone should live here.', move: { action: 'create_inhabitant', params } }
    }
    const site = first('work_on', 'target')
    if (site) return { consider: 'It will not build itself.', move: { action: 'work_on', params: { target: site } } }
    const plot = first('start_building', 'site')
    if (plot && turn % 2 === 0) {
      built += 1
      return {
        consider: 'This spot wants something on it.',
        move: {
          action: 'start_building',
          params: {
            site: plot,
            purpose: purposes[(built - 1) % purposes.length],
            name: `House ${built}`,
            about: 'somewhere to be',
            floors: String(1 + (built % 2)),
            wall: walls[built % walls.length],
            roof: roofs[built % roofs.length],
            roof_colour: built % 2 ? 'red' : 'grey',
            windows: String(1 + (built % 2)),
            sign: built % 3 === 0 ? 'PIP' : '',
          },
        },
      }
    }
    const things = (offered.get('look_at')?.get('target') ?? [])
    if (things.length && turn % 3 === 0) return { consider: 'What is that, again?', move: { action: 'look_at', params: { target: things[turn % things.length] } } }
    const someone = offered.get('speak')?.get('to')?.find((name) => name !== 'anyone')
    if (someone && turn % 3 === 0) return { consider: 'I should say hello.', move: { action: 'speak', params: { to: someone, text: `Hello, ${someone}.` } } }
    if (offered.has('leave_note') && turn % 7 === 0) return { consider: 'Someone might come by.', move: { action: 'leave_note', params: { text: 'Was here.' } } }
    if (offered.has('speak') && turn % 5 === 0) return { consider: 'It is quiet here.', move: { action: 'speak', params: { text: 'This will be a town one day.' } } }
    return { consider: 'I wonder what is over there.', move: { action: 'move_to', params: { target: 'wander' } } }
  }

  return {
    async complete(req) {
      const usage = { allowance: 0, inputTokens: 0, outputTokens: 0, billingSource: 'fake' }
      if (req.system.includes('You keep a diary')) {
        return { text: JSON.stringify({ diary: 'Another stretch of the day. I got some things done and I am pleased with them.', memories: [], mind: [], done: [] }), usage }
      }
      const { consider, move } = decide(req)
      return { text: JSON.stringify({ consider, do: [move], because: 'it felt right' }), usage }
    },
  }
}
