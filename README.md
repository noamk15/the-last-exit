# THE LAST EXIT

A first-person horror maze that runs entirely in the browser.
Three glowing keys are hidden in a dark maze. Find them, unlock the exit, get out.

**Play:** https://noamk15.github.io/the-last-exit/

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows (`Z Q S D` also work) | move |
| mouse | look (click "Enter the maze" to lock the pointer) |
| `Esc` / `P` | pause |
| `M` | mute / unmute |

## Run locally

Module imports do not work from `file://`, so serve the folder:

```
python3 -m http.server 8000
```

then open http://localhost:8000/

## Useful URL parameters

- `?seed=266` : fixed maze layout (any number or word). Good short layouts for a demo: `266`, `288`, `30`.
- `?autostart=1` : skip the menu (used for automated screenshots).

## Tech

- Plain HTML / CSS / JavaScript modules, no build step, no backend.
- [Three.js](https://threejs.org/) 0.186, vendored in `vendor/` (works offline).
- Maze: recursive backtracker on a 13x13 grid with a few extra loops, seeded PRNG, BFS to guarantee keys and exit are reachable.
- Textures and sounds are generated procedurally (canvas + Web Audio API). No external assets.

## Before each deploy

```
node scripts/bump.mjs      # stamps ?v= on imports so browsers do not serve stale JS
node scripts/e2e.mjs       # end-to-end smoke test in headless Chrome
```

## Verify the maze generator

```
node scripts/check-maze.mjs 1000
```

## Layout

```
index.html         overlays (start / HUD / pause / victory) + import map
css/style.css      cinematic UI
js/main.js         Three.js scene, game loop, state machine
js/maze.js         generation, BFS, key / exit placement
js/player.js       movement + circle-vs-grid collisions
js/ui.js           DOM helpers, timer, best time (localStorage)
js/audio.js        procedural drone, footsteps, chimes
vendor/            three.module.js + three.core.js (MIT)
```
