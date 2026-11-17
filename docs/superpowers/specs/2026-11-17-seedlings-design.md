# Seedlings: design

Date: 2026-11-17. Status: awaiting approval.

Lines marked **(call)** are choices made while writing this up, not things the owner decided. They are open to correction.

## Intent

Seedlings is a personal experiment: a small town that lives on its own, populated by AI characters, to see what such characters do when the world around them keeps changing. It is inspired by [Pino's World](https://pinos.world), where one AI bird decides his own day.

The difference is that the first character, **Pip**, also builds the town and creates the other characters who live in it. All characters are the same kind of thing. Pip is "number zero": it runs on a stronger model and has more moves, including building.

There are no product plans. The owner watches; nobody else does.

## What success looks like

Either of these, a few weeks in:

- Pip does something unexpected that reads as personality.
- The town as a whole does something a real population would do.

Both must be unscripted to count.

## Goals

- Pip and the inhabitants each run the same loop: see, decide, act.
- Pip builds houses, shops and facilities, and creates inhabitants for them.
- Inhabitants think, talk to each other and to Pip, on small cheap models with fewer moves.
- Every character keeps a diary the owner can read.
- The town lives day and night on the owner's VPS, inside a fixed model allowance.
- The owner can cause events in the world and add new kinds of facility.
- Any surprising behaviour can be traced back to what the character saw and thought.

## Non-goals

- A public site, visitors, or anyone leaving messages for Pip.
- A game with a player character.
- Polished art, or art made by image models.
- Pip writing its own tools or code.
- Plugging in ready-made tool servers.

## Anti-goals

- **Scripted behaviour.** The world offers moves and consequences only. No rule says "hold a festival".
- **Seeded interests.** Pip's character sheet gives temperament and values, never hobbies.
- **Overspending.** The town must never exhaust the allowance early or run up extra charges.
- **Opaque decisions.** A behaviour nobody can explain afterwards is a failed observation.
- **A copy of Pino.** Different creature, different town, own content. Only the loop's shape is borrowed.

## Constraints

- **Machine:** a VPS with 5 cores and 6 GB of RAM. It cannot run models itself.
- **Models:** an OpenCode Go subscription, $10 plan, used only for this town.
  - Limits are a monthly allowance, with at most 50% in a week and 20% in five hours.
  - Each model burns the allowance at its own rate. Each reply reports its usage as `opencode.allowance`.
  - OpenCode's estimates for the whole allowance: about 7,200 requests a day on DeepSeek V4.1 Flash, about 140 a day on GLM-5.2.
- **Risk:** Go's docs say it is meant for coding agents and that traffic is monitored. The town could be throttled or cut off. So the model provider is a setting, and the town identifies itself honestly (own user agent, one stable session ID per character).

## Approaches considered

1. **One program with a clean seam inside (chosen).** One service holds the world, the minds, the budget, the database and the watch page. World and minds talk only through three messages. Simplest to run and to trace. A restart pauses the whole town briefly.
2. **World and minds as separate programs.** Pino's real layout. Minds can be restarted alone or moved elsewhere. More to deploy and watch, and a shared budget is harder to enforce. Option 1 keeps the same seam, so this split stays possible.
3. **Start from an existing AI-town project.** Fastest to something on screen, but those are built around conversation, with no builder character, tiered minds or budget pacing. Ruled out.

The owner chose option 1.

## Design

### Shape

One TypeScript service on the VPS, with one SQLite database file. **(call: TypeScript and SQLite)** It has these parts:

- **World:** the map, clock, weather, buildings, things, and each character's body and position.
- **Minds:** one per character. Holds its character sheet and memory, builds the prompt, calls the model, reads the decision.
- **Scheduler:** decides whose turn it is to think, paced by the budget.
- **Budget keeper:** tracks the allowance and sets the pace.
- **Record:** stores every turn in full.
- **Watch page:** the isometric view and diaries, served by the same service.
- **Facilities:** plug-ins that add places with their own moves.

### The seam

World and minds exchange only these, the same shapes Pino uses:

- **Manifest:** what this world is and every move it has.
- **Observation:** what is true for this character right now, including which moves are on offer.
- **Act and result:** the character's chosen move, and the world's answer in plain words. The world may refuse and say why.

Moves not on offer are left out of the prompt entirely, not forbidden in words.

### One turn

1. The world composes the observation: time, weather, the place, who is near, what was said, recent events, body, moves on offer.
2. The mind adds a few relevant memories and whatever is loudest on its mind.
3. The model answers in JSON: a short thought, one to three moves, and a reason.
4. The world carries out the moves, or refuses.
5. The turn is recorded, and anything notable becomes a memory.

A reply that cannot be read is asked for once more, then treated as "wait".

### Two tiers of mind

| | Pip | Inhabitants |
|---|---|---|
| Model (a setting) | mid-sized, e.g. GLM-5.2 | small, e.g. DeepSeek V4.1 Flash |
| Moves | everything, including build and create inhabitant | move, talk, eat, rest, use a facility, leave a note, wait |
| Memory | full | lighter: fewer memories kept |
| Diary | several entries a day | one entry per in-world day |

Everything else is identical.

### Memory, following Pino

- **Character sheet:** who they are, plus traits, values and fears. Written once. This is the only authored part.
- **Long memories:** one line each in the character's own words, tagged person, work, fact or moment, with a strength and a recall count.
- **Beliefs:** learned from outcomes, with an evidence count, e.g. "Sitting by the well settles me."
- **Mind:** open wants, worries, questions and promises, with the loudest few on top.

Pip starts with no memories, arriving at an empty plot on day one. Pip writes each inhabitant's sheet when creating them.

At the end of each in-world day every character makes one extra model call that writes its diary entry and tidies its memories. Pip also writes an entry every few in-world hours and after anything notable. **(call: that cadence)**

### What travels between characters

- **Speech:** heard by whoever is near, and remembered.
- **Notes:** left at a place for others to find.
- **Memories of each other:** who did what, who is liked.

Rumour and reputation are not built in. They can only arise from characters repeating what they remember.

### Body and clock

- Each character has hunger and rest, as Pino does, which gives days a rhythm. **(call)**
- Each character has a mood that moves with how its moves turn out. Beliefs are learned from those shifts. **(call)**
- Sleeping characters do not think, which saves allowance.
- Four in-world days pass per real day. **(call: a setting)**
- A character who is spoken to gets its next turn sooner, so conversations do not stall between minds that think at different speeds. **(call)**

### The empty plot

On day one the land holds only natural features: something to eat from, somewhere sheltered to sleep, water. **(call)** Pip can live there before anything is built.

### Building

Pip designs a building as a recipe and the world draws it from a kit of parts:

- footprint and number of floors
- wall colour, roof shape and colour
- door, windows, sign text
- extras such as a chimney, awning or garden

A building also has a purpose: a home, a shop, a facility from the catalogue, or something Pip names. Building takes several turns, shown as a building site. Land is a fixed grid. **(call: sizes and build times left to the builder)**

The purpose decides which basic moves the building offers: rest at a home, eat at a food place, visit or sit anywhere else. Richer moves come only from facilities. There is no money and no goods in this version. **(call)**

Pip can change or pull down its own buildings. **(call)**

### Creating inhabitants

Pip gives a name, a short character sheet, a look (colour and one feature) and a home. The budget keeper sets how many inhabitants the town can support. Beyond that the world refuses in plain words.

Pip cannot remove an inhabitant once created. **(call)** While Pip is alone in stage 1, it gets the whole day's share of the allowance.

### Budget keeper

- Each day's share is the allowance left this month divided by the days left.
- The share is split between Pip and the inhabitants, half each by default. **(call)**
- Thinking intervals stretch as the share runs low. When it is gone, the town sleeps until the next day.
- Usage is read from each reply. For other providers it is estimated from token counts.
- The five-hour and weekly limits are also respected.

### Facilities

A facility is a self-contained plug-in declaring:

- the moves it adds, each with a few fixed-choice settings
- the smallest mind allowed to use each move
- the code that runs, which always answers in plain words and may refuse
- what it leaves behind in the world (a drawing, a tune, a note)
- what each use costs, and any opening hours
- how it is drawn, as a kit recipe

Rules: the facility does the hard part, anything from outside is summarised before it reaches a character, and each facility can be run alone against a stand-in character.

A new plug-in appears as a blueprint Pip may choose to build. The owner can also place it directly as an event.

### Owner events

Only the owner can cause them, from the watch page. First set: change the weather, close or break a building, have a stranger arrive, place a facility. **(call: this first set)** The owner has no voice in the world.

### Watch page

As mocked up and agreed:

- **Top bar:** in-world day, time, weather, town size, thinking budget left today.
- **Town:** live isometric view. Click a character or building to select it.
- **Side panel:** Pip by default, with current activity, what is on its mind and today's diary. Tabs for the whole town's happenings and for every inhabitant.
- **Trace:** opening a diary line shows what the character saw and thought.
- **Cause an event:** a button, owner only.

The page is private behind a password. **(call)** Pip is drawn as a seedling: a cream seed with two leaves sprouting from its head. Inhabitants are smaller, simpler creatures in the same style.

### Record

Every turn stores who, when, the observation, the full prompt, the raw reply, the decision, the world's answer and the allowance used. On restart the town resumes from the database.

## Pip's character sheet (draft for the owner to edit)

> Pip is a seedling who arrived on an empty plot and decided it should be a town. Pip is curious before it is careful, and would rather try a thing than wonder about it. It gets attached quickly, to places and to people, and takes it personally when something it made is ignored.
>
> Pip likes things to feel finished but changes its mind about what finished means. It is stubborn about small matters and easygoing about large ones. It is warm, a little bossy, and bad at hiding either.

- **Traits:** curious, quick to attach, stubborn in small things, proud of what it makes, easily sidetracked.
- **Values:** that everyone has somewhere to be; that a place should feel like someone meant it; trying before deciding.
- **Fears:** an empty town; being the only one who cares; finishing and having nothing left to make.

Nobody tells Pip what to do with its day. Building the town is something it wants, not its whole self.

## Build order

**(call)** Three stages, each usable on its own:

1. **Pip alone.** World, clock, weather, body, the loop, memory, diary, budget keeper, record, watch page, and building from the kit.
2. **Inhabitants.** Creation, small minds, talk and notes, memories of each other, their diaries, the population limit.
3. **Events and facilities.** Owner events, the plug-in contract, and the first facilities: an internet café, an art place, a music place.

## Left to the builder

- Libraries for the server, the isometric drawing and the database.
- The exact Go endpoint and request shape, from the Endpoints section of [the Go docs](https://opencode.ai/docs/go/).
- Prompt wording, and how memories are chosen for recall.
- Map size, build times, and the parts in the kit.
- How the service is deployed and kept running on the VPS.
- A stand-in model for tests, so the loop can be tested without spending allowance.

## Known risks

- OpenCode may object to this use of Go. Mitigation: swappable provider.
- Small models may answer badly formed JSON or act blandly. Mitigation: short move lists, retries, and model choice as a setting.
- Interesting behaviour is not guaranteed. That is the experiment.
