/** The art place: anyone may make a picture from a title, a mood and a few words; the place paints it. */

import { MOODS, paint } from '../../shared/picture.ts'
import { same } from '../../shared/names.ts'
import { cleanText } from '../../shared/recipe.ts'
import type { Picture, World } from '../../shared/types.ts'
import { countUse, usesToday } from '../contract.ts'
import type { Facility } from '../contract.ts'

const TITLE_MAX = 40
const DESCRIPTION_MAX = 200
const MEMORY_DESCRIPTION_MAX = 100
const HANGING = 12

const hangingAt = (world: World, placeId: string) => world.pictures.filter((p) => p.placeId === placeId)
const useKey = (characterId: string) => `art:${characterId}`

export const ART: Facility = {
  kind: 'art',
  name: 'an art place',
  about: 'somewhere to make pictures and look at them',
  look: { footprint: 2, floors: 1, wall: 'white', roof: 'pyramid', roofColour: 'blue', door: true, windows: 2, sign: 'ART', extras: ['lantern'] },
  hours: null,
  moves: [
    {
      spec: {
        name: 'make_a_picture', label: 'making a picture', tier: 'inhabitant',
        description: 'Make a picture. You give it a title, a mood and, if you like, a few words about it; the art place paints it and hangs it on the wall.',
        params: {
          title: { hint: 'a few words' },
          mood: { values: MOODS },
          description: { hint: 'a sentence about it in your own words, or leave it out', optional: true },
        },
      },
      offer: ({ world, c }) => (usesToday(world, useKey(c.id)) >= 1 ? 'you have already made a picture today' : { mood: MOODS }),
      perform({ world, c, building, services }, params) {
        const title = cleanText(params.title ?? '', TITLE_MAX)
        if (title === '') return { ok: false, reason: 'A picture needs a title.' }
        // Stored as the place names it: the model may have written "Restless".
        const mood = MOODS.find((m) => same(m, params.mood ?? ''))!
        const description = cleanText(params.description ?? '', DESCRIPTION_MAX)
        const picture: Picture = {
          id: `p${world.nextId++}`, placeId: building.id, by: c.id, byName: c.name, title, mood, description,
          minute: world.minutes, shapes: paint(title, mood, description),
        }
        services.store.addPicture(picture)
        world.pictures.push(picture)
        const hanging = hangingAt(world, building.id)
        if (hanging.length > HANGING) {
          const down = new Set(hanging.slice(0, hanging.length - HANGING).map((p) => p.id))
          world.pictures = world.pictures.filter((p) => !down.has(p.id))
        }
        countUse(world, useKey(c.id))
        return {
          ok: true, message: `You make a picture called "${title}". It hangs on the wall now.`, minutes: 60, moodDelta: 0.1,
          label: 'making a picture', event: `${c.name} made a picture called "${title}"`,
          leaves: [{ characterId: c.id, text: `I made a picture called ${title}.`, kind: 'moment' }],
        }
      },
    },
    {
      spec: {
        name: 'look_at_picture', label: 'looking at a picture', tier: 'inhabitant',
        description: 'Look closely at one of the pictures hanging here.',
        params: { picture: { hint: 'the title of a picture here' } },
      },
      offer({ world, building }) {
        const titles = hangingAt(world, building.id).map((p) => p.title)
        return titles.length === 0 ? 'there are no pictures here yet' : { picture: titles }
      },
      perform({ world, c, building }, params) {
        const picture = [...hangingAt(world, building.id)].reverse().find((p) => same(p.title, params.picture ?? ''))!
        const label = 'looking at a picture'
        const event = `${c.name} looked at "${picture.title}"`
        if (picture.by === c.id) {
          return { ok: true, message: `"${picture.title}", which you made, ${picture.mood}.`, minutes: 10, moodDelta: 0, label, event }
        }
        const about = picture.description ? ` ${picture.description}` : ''
        const gist = picture.description ? `: ${cleanText(picture.description, MEMORY_DESCRIPTION_MAX)}` : ''
        return {
          ok: true, message: `"${picture.title}" by ${picture.byName}, ${picture.mood}.${about}`, minutes: 10, moodDelta: 0, label, event,
          leaves: [{ characterId: c.id, text: `${picture.byName} made a picture called ${picture.title}, ${picture.mood}${gist}`, kind: 'person' }],
        }
      },
    },
  ],
  observe(world, building) {
    const hanging = hangingAt(world, building.id)
    if (hanging.length === 0) return []
    return [`Pictures on the wall: ${hanging.map((p) => `"${p.title}" by ${p.byName} (${p.mood})`).join('; ')}`]
  },
}
