/** The building kit: what a building can be made of, and how a recipe is checked. */

import type { Colour, Extra, Mark, Purpose, Recipe, RoofShape } from './types.ts'

export const COLOURS: Colour[] = ['cream', 'white', 'sand', 'brick', 'red', 'blue', 'green', 'yellow', 'grey', 'brown']
export const ROOFS: RoofShape[] = ['flat', 'pitched', 'pyramid', 'dome']
export const EXTRAS: Extra[] = ['chimney', 'awning', 'garden', 'lantern']
export const PURPOSES: Purpose[] = ['home', 'food', 'other']
/** The one feature that sets an inhabitant apart. */
export const MARKS: Mark[] = ['ears', 'antennae', 'tail', 'hat', 'scarf', 'spots']

export const SIGN_MAX = 16

/** Replaces control characters with spaces, collapses whitespace, trims, and cuts to max. */
export function cleanText(text: string, max: number): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trimEnd()
}

type Result = { ok: true; recipe: Recipe } | { ok: false; reason: string }
type Picked<T> = { ok: true; value: T } | { ok: false; reason: string }

function pick<T extends string | number>(input: Record<string, string>, key: string, choices: readonly T[], fallback: T): Picked<T> {
  const raw = input[key]
  if (raw === undefined || raw.trim() === '') return { ok: true, value: fallback }
  const wanted = raw.trim().toLowerCase()
  const found = choices.find((choice) => String(choice) === wanted)
  if (found === undefined) {
    return { ok: false, reason: `"${cleanText(raw, 30)}" is not a ${key.replace('_', ' ')} you can use. Choose one of: ${choices.join(', ')}.` }
  }
  return { ok: true, value: found }
}

/** Reads a recipe from a move's settings. Anything left out takes a default. */
export function validateRecipe(input: Record<string, string>, base?: Recipe): Result {
  const footprint = pick(input, 'footprint', [1, 2, 3] as const, base?.footprint ?? 1)
  if (!footprint.ok) return footprint
  const floors = pick(input, 'floors', [1, 2, 3] as const, base?.floors ?? 1)
  if (!floors.ok) return floors
  const wall = pick(input, 'wall', COLOURS, base?.wall ?? 'cream')
  if (!wall.ok) return wall
  const roof = pick(input, 'roof', ROOFS, base?.roof ?? 'pitched')
  if (!roof.ok) return roof
  const roofColour = pick(input, 'roof_colour', COLOURS, base?.roofColour ?? 'red')
  if (!roofColour.ok) return roofColour
  const windows = pick(input, 'windows', [0, 1, 2, 3] as const, base?.windows ?? 1)
  if (!windows.ok) return windows

  let extras: Extra[] = base?.extras ?? []
  if (input.extras !== undefined && input.extras.trim() !== '') {
    extras = []
    for (const raw of input.extras.split(',')) {
      const wanted = raw.trim().toLowerCase()
      if (wanted === '' || wanted === 'none') continue
      const found = EXTRAS.find((extra) => extra === wanted)
      if (!found) return { ok: false, reason: `"${cleanText(raw, 30)}" is not an extra you can add. Choose from: ${EXTRAS.join(', ')}.` }
      if (!extras.includes(found)) extras.push(found)
    }
  }

  return {
    ok: true,
    recipe: {
      footprint: footprint.value,
      floors: floors.value,
      wall: wall.value,
      roof: roof.value,
      roofColour: roofColour.value,
      door: true,
      windows: windows.value,
      sign: input.sign === undefined ? (base?.sign ?? '') : cleanText(input.sign, SIGN_MAX),
      extras,
    },
  }
}

/** How many hours of work a building takes. */
export function workUnits(recipe: Recipe): number {
  return recipe.footprint * recipe.floors + 1
}
