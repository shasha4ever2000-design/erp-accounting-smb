# Red Horizon

A small real-time-strategy game in the spirit of the 90s base-building classics —
build a base, harvest ore, make tanks, and destroy the other guy before he destroys you.

Everything is in one file: `game/index.html`. No build step, no install, no internet needed.

## How to play it

**Just open `game/index.html` in a browser.** Double-click the file, or drag it into a
browser window. That's it.

It runs straight off the filesystem — no server required. (If you'd rather serve it over
http, any static server works, e.g. `npx serve game`.)

## The basics

1. Pick a difficulty. You start with a **Construction Yard**, a **Power Plant**, an
   **Ore Refinery**, one harvester and a few soldiers.
2. Your harvester drives to the yellow ore, fills up, and brings it home. Ore is money.
3. Click something in the **Build** tab. It charges as it builds; when it says
   *READY*, click it again and then click the map to place it.
4. Units come out of the Barracks (infantry) and War Factory (vehicles) — they appear
   automatically, no placing needed.
5. Kill everything the enemy owns to win. Lose everything you own and you lose.

Build order that works: **Power Plant → Refinery → Barracks → War Factory → Tech Lab**,
with a second Refinery and a couple more harvesters as soon as you can afford them.

## Controls

| | |
|---|---|
| Left click / drag | select units |
| Right click | move, or attack what you clicked |
| Right click (with a factory selected) | set its rally point |
| Mouse wheel | zoom in / out |
| WASD or arrows, or push the screen edge | scroll |
| Double click a unit | select every unit of that type on screen |
| Ctrl + 1…5 | save a group · press 1…5 to recall it |
| Shift + A | attack-move to the cursor |
| H | jump back to your base |
| R | repair the selected building (costs credits) |
| X | stop |
| E | select your whole army |
| Space | pause |
| Esc | cancel placement / clear selection |

Right-click an item in the sidebar to cancel it and get your money back.

## What's in it

**Structures** — Construction Yard, Power Plant, Ore Refinery, Barracks, War Factory,
Gun Turret, Missile Tower, Tech Lab.

**Units** — Rifleman, Rocket Soldier, Field Medic, Ore Harvester, Scout Tank, Heavy Tank,
Artillery.

**Things that matter**
- **Power.** Every building except the Power Plant eats power. Go into the red and
  production crawls and your defence turrets stop firing.
- **Armour types.** Bullets shred infantry but bounce off tanks. Rockets and shells do
  the opposite. Mixed armies beat pure ones.
- **Prerequisites.** Heavy Tanks, Artillery and Medics need the Tech Lab.
- **Repair.** Damaged buildings don't heal on their own — select and press **R**.

The enemy AI builds its own base, harvests, repairs, defends when you raid it, and sends
attack waves that get bigger over time. Difficulty changes its income, its army cap and
how soon and how often it attacks.

## Under the hood

Plain JavaScript on a `<canvas>` — no engine, no libraries, no image or audio files.
Every sprite is drawn with canvas paths and the sound effects are synthesised with the
Web Audio API, which is why the whole game is one HTML file.

- Terrain, ore fields, rocks and lakes are generated fresh each match.
- Movement is A* on the tile grid with a request queue, plus soft collision between units.
- `simulate(dt)` is deliberately separate from drawing, so a whole match can be
  fast-forwarded headlessly for testing.

## Fair warning about the name

This is an original game inspired by the base-building RTS games many of us grew up with.
It contains **no assets, art, audio, names or code from any commercial game** — the
factions, units and structures here are generic ones drawn from scratch.

## Things that could come next

- An MCV you can deploy into a Construction Yard, so you can expand to a second base
- Selling buildings for a partial refund
- Naval units and bridges
- Saving a match in progress
- Skirmish options: starting credits, map size, more than two players
