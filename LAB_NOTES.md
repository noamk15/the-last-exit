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
