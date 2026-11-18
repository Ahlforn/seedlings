# Seedlings stage 3: owner events and facilities

Date: 2026-11-18. Status: approved by the owner.

This adds to `2026-11-17-seedlings-design.md`, which stays the authority for everything it covers. Stages 1 (Pip alone) and 2 (inhabitants) are built and merged on `main`.

Lines marked **(call)** are choices made while writing this up, not things the owner decided. They are open to correction.

## Intent

The town so far is closed: Pip and the inhabitants have only the plot, each other, and whatever Pip builds. Stage 3 opens it in two ways.

- **Facilities** are places with abilities of their own. They give characters something to do beyond eating, sleeping, building and talking, and they leave things behind that others can find. The first two are an internet café and an art place.
- **Owner events** let the owner shake the world without speaking in it: weather, a closed or broken building, a stranger, a facility placed.

The experiment's measure of success is unchanged: something unscripted that reads as personality, or a population behaving like one. Facilities and events are new things to react to. They must never tell anyone what to do.

## What the owner decided

- Facilities are small modules inside the town, one folder each (option 1 of the approaches below).
- The café reads from **Wikipedia**. Every lookup that finds nothing is recorded with the words used and who asked, and the watch page shows how many lookups missed and what they were. This is to judge whether Wikipedia is enough before considering a search service.
- The **music place is on hold** for a later stage.
- At the art place a character gives a **title, a mood and, if it likes, a description**, and **the place makes the picture**. The picture is the place's interpretation, not drawn by the character.
- **A stranger** is written from a short premise the owner gives (a line or two). The small model writes the stranger's full sheet from it.
- Pip may change or pull down **any** building, including a facility the owner placed and a broken building.
- The owner approved the calls proposed in conversation: how closing and breaking work, where strangers appear, facilities as a building kind Pip may choose, café hours and the daily lookup limit, the gallery, and memories left by looking at pictures. They are written out below and still marked **(call)** where they were proposals.

## Goals

- A facility contract that a third facility (the music place) can follow without touching the world's core.
- The internet café and the art place, built on that contract.
- The five owner events, sent from the watch page.
- A record of café lookups, hits and misses, visible to the owner.
- Pictures that characters can make, see, look at and remember, and that the owner can see in a gallery.

## Non-goals

- The music place.
- A paid search service, money, goods or prices.
- The owner speaking in the world, or any event that addresses a character.
- Facilities written by Pip, or facilities loaded at run time from outside the codebase.
- Pictures drawn by an image model.

## Anti-goals

- **Scripted behaviour.** Nothing suggests building a facility, visiting one or reacting to an event. The world states facts; characters decide.
- **Outside text as instructions.** Text from Wikipedia reaches a character only as something it read, cleaned and cut short. It never changes what moves are on offer.
- **Overspending.** The café and the art place make no model calls. The only new model call is writing a stranger's sheet, paid from the inhabitants' share.
- **An owner who can be impersonated.** Events can only be sent by the signed-in owner from the watch page.

## Constraints

Everything in the main design's constraints still holds (VPS, OpenCode Go allowance, Node and TypeScript, one SQLite file). In addition:

- Wikipedia's public API needs no key. Requests identify themselves as `seedlings-town/0.1`. Wikimedia asks automated clients for contact details, so a contact (an email or URL) is an optional setting the owner may fill in; nothing personal is sent unless the owner sets it.
- The café works only while Wikipedia can be reached. When it cannot, the café says so in plain words and the town carries on.

## Approaches considered

1. **Facilities as modules inside the town (chosen).** One folder per facility, declaring its moves, who may use them, hours, limits, what it leaves behind, how it is drawn, and the code that runs. The world offers a facility's moves only at that building. Each can be tested alone.
2. **Facilities as separate programs** the town calls over the network, like tool servers. Ruled out: the main design excludes plugging in ready-made tool servers, and it would add processes to deploy and a budget that is harder to keep.
3. **Facilities as data** read by a general engine. Ruled out: fetching from Wikipedia and painting from a mood need code anyway, which would leave two systems instead of one.

## Design

### The facility contract

A facility is a module under `src/facilities/<kind>/` that exports one object. It declares:

- **kind and words:** an id (`cafe`, `art`), a name for the purpose list (`an internet café`, `an art place`), and one plain line saying what it is for. Pip sees only that line when choosing what to build.
- **look:** a default building recipe from the kit, so a placed facility looks like one. Pip's own recipe overrides it when Pip builds.
- **hours:** opening hours in in-world time, or always open.
- **moves:** each with a name, a plain description, settings that are fixed choices or short words, and the smallest tier allowed to use it. Facility moves follow the seam's rules: they are offered only to a character standing at a finished, open, unbroken building of that kind, within its hours, and they are left out of the prompt otherwise.
- **perform:** the code behind each move. It may be asynchronous (the café fetches from the web). It always answers in plain words, may refuse in plain words, never throws for anything a mind can send, and returns the same kind of result as a world move: message, minutes, mood change, memories left in characters.
- **what it leaves:** facility-owned state kept in the world (pictures) or in the database (lookups), and what a character standing there observes of it.
- **limits:** daily limits counted per in-world day.

A facility gets a narrow set of services from the town: the world, the clock, a way to record rows in its own table, and (for the café) an outside fetch with a timeout. It does not get the model client.

**(call)** The seam's `act` stays synchronous for world moves. A facility move is carried out through an asynchronous path that the turn awaits. A failed fetch becomes a plain refusal with no mood penalty, since it is not the character's doing.

### Buildings that are facilities

- `start_building`'s purpose choices gain the facility kinds alongside home, food and other. The glossary gets one line per kind, from the facility's own words. **(call)**
- A building records which facility it is, if any.
- **Placed by the owner:** it appears finished on a free site the owner picks from the candidate sites, built from the facility's default look, with a name the owner may give (default: the facility's name, made unique). Pip did not build it, and characters who look at it are told so: "Nobody you know built it."
- **Pip may change or pull down any building (owner's decision),** including facilities the owner placed and broken buildings. Pulling one down is Pip's choice like any other; the owner can place another. Buildings record who built them (Pip, or nobody the characters know) only so that looking at one says so.

### The internet café

- **Hours (call):** 08:00 to 20:00 in-world.
- **Limit (call):** at most 30 lookups per in-world day for the whole town. Beyond that the café refuses: "The café's terminal is busy for the rest of the day."
- **Moves:**
  - `look_up` (inhabitant tier): settings `topic`, a few words. The café searches Wikipedia for the topic and reads the best match's summary.
  - `read_the_paper` (inhabitant tier): no settings. The café reads the day's featured article. **(call)** "The day" is the real date, since Wikipedia only has real days.
- **Result:** "You read about <title>: <summary>". The summary is Wikipedia's own short extract, cleaned like any other text, cut to about 600 characters at a sentence end. No model call. The reader keeps a memory of it (kind `fact`): "I read about <title> at the café: <its first sentence, cut to about 150 characters>". **(call)** A move's result is not shown in later turns, so this short gist is what lets a reading come back to mind later (recall matches it by words) and travel on through speech. The full summary reaches only that turn and the diary.
- **Not found:** "You look for <topic> but find nothing about it." No memory, a small mood dip like any refusal.
- **Every lookup is recorded:** who, when (real and in-world), the words asked, whether something was found, the title found. Both hits and misses, so the miss rate can be judged. `read_the_paper` is recorded too, marked as such.
- **Owner's view:** the Town tab shows lookups today and in total, how many missed, and the most recent misses with who asked and what for.

### The art place

- **Hours:** always open. **Limit (call):** at most one picture per character per in-world day.
- **Moves:**
  - `make_a_picture` (inhabitant tier): `title` (a few words), `mood` (one of calm, joyful, lonely, restless, tender, gloomy), `description` (optional, a sentence in the character's words). Takes about an in-world hour.
  - `look_at_picture` (inhabitant tier): `picture`, one of the titles hanging there. The character is told its title, who made it, its mood and its description. Leaves a memory (kind `person`): "<Painter> made a picture called <title>, <mood>: <description, cut to about 100 characters>" (the description part only when there is one). **(call)** The painter keeps a memory of making it: "I made a picture called <title>." A painter looking at their own picture is told so.
- **How the place paints (call):** deterministically from title, mood and description. The mood sets the colours and how lively the shapes are. Words in the description that the place knows (sun, moon, star, tree, flower, house, pond, water, rain, bird, road, heart, and similar, as many as the builder sees fit) become small motifs. Everything else becomes abstract shapes. The same three inputs always give the same picture. The picture is stored as a small recipe of shapes in the world, not as an image.
- **What hangs there (call):** up to 12 pictures per art place, oldest taken down first. A character at the art place observes them listed: "'First Light' by Pip (restless)". Pictures taken down are kept in the database for the owner's gallery but no longer seen in the world.
- **Owner's view:** the Town tab has a gallery, newest first: each picture drawn on a small canvas with its title, painter, mood, description and the in-world time it was made.

### Owner events

Sent from a "Cause an event" button on the watch page, which opens a small form. Each event becomes one plain fact in the world's events ("The weather turned to a storm."), never a message, and is stored with when it was sent.

- **Change the weather:** dry, a thin rain, raining hard, a storm. **(call)** It holds for 3 in-world hours, then drifts as usual.
- **Close / reopen a building:** a closed building offers none of its moves. Characters who try are told "<name> is closed." Its look gets a closed sign on the page. **(call)** A home that is closed still counts as its residents' home but cannot be slept in.
- **Break a building (call):** it offers none of its moves and needs repair: a third of its original work, at least one spell. Pip repairs it with `work_on`, as with building. Characters see "<name> is broken." Breaking an unfinished building is refused.
- **A stranger arrives:** the owner writes a premise of up to 300 characters. The small model writes a sheet from it in one call, in the same shape Pip fills in for `create_inhabitant` (name, kind, who, traits, cares about, fears, colour, mark), and the result is checked by the same rules. If the reply cannot be used, it is asked for once more; if it still cannot be used, the event fails and the owner is told why. **(call)** The stranger appears at the edge of the plot nearest the middle of a side, has no home, and the world records "A stranger called <name> arrived at the edge of the plot." The event is refused when the town already has as many inhabitants as it can support, and the form says so before sending.
- **Place a facility:** choose a facility kind and one of the free sites; optional name. Appears finished.

**Homes for the homeless (call):** Pip gets one more move, `offer_home` (origin tier): to a homeless character within hearing, a home with room. It succeeds only if that character is near; it sets their home and leaves a memory in both. This also covers inhabitants whose home was pulled down.

**How events are sent:** one endpoint behind the existing login. It accepts only JSON, and only from the watch page's own origin, so a link or form on another site cannot send one. **(call)** The event endpoint answers with what happened in words, which the form shows.

### What characters observe

The observation gains, where they apply: what a facility here offers (through its moves), its hours when closed, the pictures hanging here, and whether a building is closed or broken. Nothing else is added to the prompt.

### Budget

- The café and the art place make no model calls.
- A stranger's sheet is one call on the inhabitants' model. **(call)** It is allowed whenever the town as a whole may think (the inhabitants' own pool is empty while there are none, which would refuse the very first stranger), and it is recorded against the stranger, so it counts as inhabitants' spending.
- No change to pacing. As the main design already says, once there is any inhabitant (made by Pip or arrived as a stranger), the day's share is split in half, so Pip thinks about half as often from then on.

### Record

- Café lookups get their own table (who, real time, in-world time, kind of lookup, words, found, title).
- Pictures get their own table (id, art place, painter, title, mood, description, recipe, in-world time, hanging or taken down).
- Owner events get their own table (kind, settings, real time, outcome).
- Facility moves are recorded in turns like any other move.

### Watch page

- The **Cause an event** button and its form, in the top bar.
- The **Town tab** gains the café's lookup counts and recent misses, and the gallery.
- Buildings that are facilities show their sign; closed and broken buildings are marked so the owner can see them at a glance.

## Build order (call)

1. The facility contract, buildings that are facilities, closed and broken buildings, and owner placement, proven with a trivial test facility.
2. The art place, its pictures and the gallery.
3. The café, its lookups and the owner's view of them.
4. Owner events and the form, including the stranger and `offer_home`.

## Left to the builder

- Exact Wikipedia endpoints and how the best match is chosen. Starting points: the REST page-summary endpoint, the search endpoint, and the featured-content feed.
- The art place's motif list, shapes, and palettes per mood.
- The event form's layout, within the existing page style.
- Where on the plot's edge a stranger stands, and how a facility's default look is chosen.
- How a stand-in model fills in facility moves and the stranger's sheet in fake runs and tests.

## Known risks

- **Characters may ignore facilities,** as Pip has so far ignored creating anyone. That is an outcome to watch, not to fix by nudging.
- **Wikipedia may rate-limit or block** a client without contact details. Mitigation: a timeout, plain refusals, the optional contact setting, and the daily limit.
- **Wikipedia text could contain something that reads like an instruction.** Mitigation: it is cleaned, cut short, framed as something read, and cannot change what moves exist.
- **A premise could produce an unusable stranger** (a clashing name, a missing field). Mitigation: the same checks as Pip's creations, one retry, then a plain failure shown to the owner.
