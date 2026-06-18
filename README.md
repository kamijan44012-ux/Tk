# SHADOW STRIKERS — 3D Fighting Game ⚔️

A production-style, browser-based **3D fighting game** (Tekken/Street-Fighter style)
built with **Three.js + WebGL** and tuned for **60 FPS on mobile**. No engine
install, no APK — it runs instantly in any modern browser on **phone and desktop**.

> **اردو:** یہ ایک 3D فائٹنگ گیم ہے جو براؤزر میں چلتی ہے (فون اور کمپیوٹر دونوں پر)۔
> کوئی انسٹال نہیں — صرف لنک کھولیں اور کھیلیں۔ نیچے **HOW TO PLAY / کھیلنے کا طریقہ** دیکھیں۔

## ▶️ Live Demo
After enabling GitHub Pages once (see **Publish** below), the game is live at:

**https://kamijan44012-ux.github.io/Tk/**

### Publish (one-time, ~1 minute)
1. Open **Settings → Pages**: https://github.com/kamijan44012-ux/Tk/settings/pages
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. **Branch:** `claude/aaa-mobile-fighting-game-nei2o1`, folder **`/ (root)`** → **Save**.
4. Wait ~1 minute, then open the live URL above. Done.

## 🎮 How to Play / کھیلنے کا طریقہ

| Action | Touch (mobile) | Keyboard (desktop) |
|--------|----------------|--------------------|
| Move / حرکت | Left joystick | `A` / `D` or arrows |
| Jump / چھلانگ | Push joystick up | `W` / Up |
| Punch / مکا | `P` button | `J` |
| Kick / لات | `K` button | `K` |
| Special / اسپیشل | `S` button (needs full meter) | `L` |
| Block / بچاؤ | `B` button (hold) | `Space` (hold) |
| Dodge / چکمہ | `D` button | `Shift` |

- Land hits quickly to build **combos** (extra style + the combo counter pops up).
- Hitting and getting hit fills the **super meter** — when full, unleash the **Special**.
- Best of 3 rounds. Empty the opponent's health bar or have more HP when the timer ends.

## ✨ Features
- **Real combat system:** frame-data driven moves (startup / active / recovery),
  hitboxes vs hurtboxes, blocking with chip damage & blockstun, i-frame dodges,
  knockback, launchers, hitstop and camera shake for impact weight.
- **Procedurally animated 3D fighters** — a full humanoid rig (torso, head, two-segment
  arms & legs) animated by code for fluid 60fps punches, kicks, specials, hit reactions,
  knockdowns and victory poses. No external model files required.
- **4 fighters** with distinct stats (speed / power / defense): Blaze, Frost, Titan, Viper.
- **AI opponent** that approaches, spaces, blocks and dodges, with meter-aware specials.
- **Full UI:** main menu, character select, animated health bars, super meter,
  round timer, round pips, combo popups and a K.O. result screen.
- **Procedural audio** (Web Audio API): punch/kick impacts, energy-blast specials,
  grunts, K.O. stinger and a looping battle track — all synthesized, zero asset downloads.
- **Mobile-first controls:** on-screen virtual joystick + action buttons, plus full
  keyboard support automatically on desktop.

## 🏎️ Performance / Optimization
Designed to hold 60 FPS on mid-to-high-end Android:
- Device pixel ratio capped at 2 to avoid wasted fill-rate on dense screens.
- Low-poly primitive geometry & a single shadow-casting light (soft PCF shadows).
- Fake contact "blob" shadows instead of extra real shadow casters.
- Fixed-timestep physics (120 Hz) decoupled from rendering for stable, deterministic combat.
- Loop & audio pause automatically when the tab is hidden (battery friendly).

## 📁 Project Structure
```
index.html          # Entry, UI overlays (menu, select, HUD)
styles.css          # Mobile-first UI / HUD styling & touch controls
js/
  main.js           # App bootstrap, screen flow, HUD bindings
  game.js           # Match loop, round logic, hit/hurt collision arbiter
  fighter.js        # Fighter rig, state machine, combat & procedural animation
  ai.js             # CPU opponent behaviour
  input.js          # Touch joystick + buttons + keyboard
  scene.js          # Three.js arena, lights, camera, shake
  audio.js          # Procedural SFX & music (Web Audio API)
  characters.js     # Roster / stats data
.github/workflows/  # GitHub Pages auto-deploy
```

## 🛠️ Run Locally
Any static file server works (ES modules need http, not `file://`):
```bash
# Python
python3 -m http.server 8080
# then open http://localhost:8080
```

---
Built as a complete, playable game — extend it with new fighters in `js/characters.js`
and new moves in the `MOVES` table inside `js/fighter.js`.
