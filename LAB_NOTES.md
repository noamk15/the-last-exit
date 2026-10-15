# LAB NOTES — The Last Exit

Lab 1: build something ambitious with a coding agent, publish on GitHub Pages, demo in 90 s.
Pair: Noam (noamk15) + partner. Agent: Claude Code (Fable 5.1).

## Timeline

- 2026-10-15 ~12:10 — Session start. Empty folder `Lab1`. Agent read the lab skill and started building.
- 2026-10-15 ~12:25 — Full MVP written (maze, player, flashlight, 3 keys, locked door, HUD, start/pause/victory screens, procedural textures and sound).
- 2026-10-15 ~12:30 — First publication on GitHub Pages.

## Surprises (things the agent did without being asked)

- Vendored Three.js with `npm pack` instead of a CDN, and copied `three.core.js` too (the new split build would 404 without it).
- Wrote a node script (`scripts/check-maze.mjs`) that checks 1000 random seeds: maze connected, 3 keys reachable, exit reachable. It also computes the shortest "tour" length to find seeds that give a ~60 s run.
- Added a `?seed=` parameter and listed the shortest seeds (266, 288, 30) for the demo.
- Used headless Chrome from the command line to take screenshots and read the console, since no Playwright was installed, then tuned the lighting from what it saw (first version was over-exposed with pink/green blocks).
- Added `Z Q S D` keys because the lab is done on a French (AZERTY) keyboard.
- Rendered the real 3D maze behind the start menu with the camera gliding through a corridor.
- Wrote an end-to-end test (`scripts/e2e.mjs`) that drives headless Chrome through the DevTools protocol: loads the page, checks for console errors and 404s, presses W, walks into a wall, teleports onto the 3 keys, waits for the door, enters it, and checks the victory screen. It found two real issues before the first user test.

## Mistakes the agent made

- First attempt at the movement math had the sign of the yaw rotation wrong (fixed by re-deriving before any test).
- The first texture pass tinted stone blocks with random RGB; it looked like a toy. Fixed after looking at a screenshot.
- The menu camera initially faced a wall at the start cell; fixed by orienting it along the first corridor.
- `requestPointerLock()` returned a rejecting promise in some cases and the fallback call was not caught either (unhandled rejection). Found by the e2e test, fixed with a small `tryLock` helper.
- The door opening used the clamped physics delta time, so on a slow machine it opened later than 1.2 s. Switched to real time.

## Difficulties

- `python3 -m http.server` bound to IPv6 only on this Mac; `curl localhost` failed until `--bind 127.0.0.1`.
- Pointer lock must be requested from a user gesture, so it is requested on the click *before* the fade-to-black, not after.
- Chrome refuses a new pointer lock for ~1 s after `Esc`; the Resume button waits for `pointerlockchange` instead of assuming success.

## Prompts that worked well

- Describing behaviour, not code: "the door should be visibly locked (red) and slide away when 3/3".
- Asking the agent to verify with a script rather than trusting the generator.

## Candidate story for the 90-second show and tell

(to be chosen at the end)

## User test 1 (2026-10-15, live URL)

- Feedback: "use the arrow keys", "add a way back to the menu", "I can't move forward, it bugs, maybe too wide".
- Fixes: arrow keycaps shown on the start screen, keyboard now matched by key name as well as physical position (works on AZERTY and QWERTY), Menu button in pause and victory, player radius 0.55 -> 0.42 and speed 3.6 -> 4.0, buttons lose focus after a click (Space/Enter could restart the game), automatic drop of the pixel ratio when the frame rate is low.

## User request 2 (2026-10-15): horror ambience, stressful music, death timer, random maze

- Added: 2-minute countdown (red + blinking under 30 s, bigger and frantic under 10 s), red vignette pulsing with a heartbeat, camera tremble, flashlight brownouts with a click, dust motes, dried stains on the walls, game over screen ("Time's up") with Try again / Menu.
- Music is 100% procedural (Web Audio): bass pulse, dissonant detuned pad, eerie whistle, wind bed, random stingers (metal hit, riser, whisper), heartbeat that accelerates as time runs out. Everything is driven by one "tension" value computed from the time left.
- The maze is now random for every game (menu, play again, try again). `?seed=` still pins a layout for the demo.
- Surprise: the agent refactored the whole level into a rebuildable group (dispose + rebuild) so a new maze can be generated without reloading the page.

## User request 3 (2026-10-15): memory minimap, monsters, louder sound, 1:30 timer with reminders

- Minimap (bottom left): cells in line of sight light up, then fade over ~20 s as if forgotten. Keys and the door appear only where remembered. Monsters show as a red pulsing dot when within hearing range.
- Two monsters: black figures with glowing red eyes, patrol between far cells, chase on BFS distance <= 6 cells (a roar + "RUN" message), give up after a while, kill on contact with a jump scare (monster snaps in front of the camera, scream, "Caught" screen).
- Their breathing/growl is spatialised: volume by distance, left/right panning by direction, faster when chasing. The flashlight stutters when one is close.
- Timer now 1:30. Bell at 60 s ("ONE MINUTE"), two bells at 30 s, three at 10 s, then a tick every second (louder in the last 5).
- Everything louder: master gain up, compressor retuned.
- Agent note: monsters move from cell centre to cell centre along BFS paths, so they never clip through walls and never need collision code.

## User request 4 (2026-10-15): monster footsteps instead of growls, no more ticking

- Feedback: "replace the monster sound with spatialised footsteps, Fortnite style; the continuous tick-tick is horrible, remove it".
- Monster breathing/growl removed. Each monster now emits one heavy footstep per stride (thud + stone grit), volume by distance (audible from about 9 cells), panned left/right from where the player looks, faster rhythm when running. The roar at the start of a chase stays as the fair warning.
- Clock ticks in the last 10 s removed; the three bells (60 s, 30 s, 10 s) remain.
