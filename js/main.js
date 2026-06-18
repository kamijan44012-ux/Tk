/* ============================================================
   MAIN — bootstraps the app: screen flow, character select,
   HUD bindings, and hands control to the Game.
   ============================================================ */
import { Game } from './game.js';
import { InputManager } from './input.js';
import { audio } from './audio.js';
import { assets } from './assets.js';
import { ROSTER, getCharacter } from './characters.js';

/* ---------------- Screen manager ---------------- */
const screens = {
  menu:   document.getElementById('screen-menu'),
  howto:  document.getElementById('screen-howto'),
  select: document.getElementById('screen-select'),
  result: document.getElementById('screen-result'),
  hud:    document.getElementById('hud'),
};
function show(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
}

/* ---------------- HUD / UI controller ---------------- */
const ui = {
  _comboT: null,
  setNames(p1, p2) {
    document.getElementById('p1-name').textContent = p1;
    document.getElementById('p2-name').textContent = p2;
  },
  updateHP(p1, p2) {
    this._hp('p1', p1); this._hp('p2', p2);
  },
  _hp(id, f) {
    const pct = Math.max(0, (f.hp / f.maxHp) * 100);
    const fill = document.getElementById(`${id}-hp`);
    const dmg = document.getElementById(`${id}-hp-dmg`);
    fill.style.width = pct + '%';
    dmg.style.width = pct + '%';
    fill.classList.toggle('low', pct < 30);
  },
  updateMeter(p1, p2) {
    this._meter('p1', p1); this._meter('p2', p2);
  },
  _meter(id, f) {
    const m = document.getElementById(`${id}-meter`);
    const pct = (f.meter / f.maxMeter) * 100;
    m.style.width = pct + '%';
    m.classList.toggle('full', pct >= 100);
  },
  setTimer(v) { document.getElementById('timer').textContent = String(v).padStart(2, '0'); },
  setRounds(wins) {
    document.getElementById('p1-r1').classList.toggle('win', wins.p1 >= 1);
    document.getElementById('p1-r2').classList.toggle('win', wins.p1 >= 2);
    document.getElementById('p2-r1').classList.toggle('win', wins.p2 >= 1);
    document.getElementById('p2-r2').classList.toggle('win', wins.p2 >= 2);
  },
  banner(text) {
    const b = document.getElementById('round-banner');
    b.textContent = text;
    b.classList.remove('show'); void b.offsetWidth; // restart animation
    b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), 1400);
  },
  combo(n) {
    const pop = document.getElementById('combo-pop');
    document.getElementById('combo-num').textContent = n;
    pop.classList.remove('show'); void pop.offsetWidth;
    pop.classList.add('show');
    clearTimeout(this._comboT);
    this._comboT = setTimeout(() => pop.classList.remove('show'), 900);
  },
  matchOver(playerWon) {
    document.getElementById('result-title').textContent = playerWon ? 'YOU WIN!' : 'YOU LOSE';
    document.getElementById('result-sub').textContent = playerWon
      ? 'Flawless? Try a tougher rematch.'
      : 'Shake it off — run it back.';
    show('result');
  },
};

/* ---------------- Bootstrap ---------------- */
const canvas = document.getElementById('game-canvas');
const input = new InputManager();
input.init();
const game = new Game(canvas, input, ui);

let selectedChar = null;
let assetsReady = false;

/* Preload the rigged 3D fighter model before play is allowed. */
(function preload() {
  const fill = document.getElementById('loading-fill');
  const text = document.getElementById('loading-text');
  const overlay = document.getElementById('loading');
  assets.load((p) => { fill.style.width = Math.round(p * 100) + '%'; })
    .then(() => {
      fill.style.width = '100%';
      assetsReady = true;
      setTimeout(() => overlay.classList.add('hidden'), 250);
    })
    .catch((err) => {
      console.error(err);
      text.textContent = 'Failed to load fighters. Please refresh.';
    });
})();

/* Build character select cards */
function buildSelect() {
  const grid = document.getElementById('char-grid');
  grid.innerHTML = '';
  ROSTER.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.dataset.id = c.id;
    const hex = '#' + c.colors.suit.toString(16).padStart(6, '0');
    card.innerHTML =
      `<div class="char-avatar" style="background:radial-gradient(circle at 35% 30%, ${hex}, #11111f)"></div>
       <div class="cname">${c.name}</div>
       <div class="cstyle">${c.style}</div>`;
    card.addEventListener('click', () => {
      audio.uiClick();
      document.querySelectorAll('.char-card').forEach(x => x.classList.remove('selected'));
      card.classList.add('selected');
      selectedChar = c.id;
      document.getElementById('select-hint').textContent = `${c.name} — ${c.style}`;
      document.getElementById('confirm-fighter').disabled = false;
    });
    grid.appendChild(card);
  });
}
buildSelect();

/* Pick a random opponent different from the player */
function randomEnemy(excludeId) {
  const pool = ROSTER.filter(c => c.id !== excludeId);
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------------- Menu button wiring ---------------- */
function unlockAudio() {
  audio.unlock();
  document.getElementById('tap-to-start').classList.remove('show');
}

document.body.addEventListener('pointerdown', unlockAudio, { once: true });
// show the sound hint on first load (mobile autoplay needs a tap)
window.addEventListener('load', () => {
  setTimeout(() => document.getElementById('tap-to-start').classList.add('show'), 600);
});

document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', () => {
    unlockAudio();
    audio.uiClick();
    const a = el.dataset.action;
    if (a === 'play') { show('select'); }
    else if (a === 'howto') { show('howto'); }
    else if (a === 'back-menu') { show('menu'); audio.stopMusic(); game.running = false; game.paused = true; }
    else if (a === 'rematch') { startFight(); }
  });
});

document.getElementById('confirm-fighter').addEventListener('click', () => {
  if (!selectedChar) return;
  audio.uiClick();
  startFight();
});

function startFight() {
  if (!assetsReady) return;
  unlockAudio();
  const player = getCharacter(selectedChar || ROSTER[0].id);
  const enemy = randomEnemy(player.id);
  show('hud');
  game.paused = false;
  audio.startMusic();
  game.startMatch(player, enemy);
}

/* Pause music & loop when tab hidden (battery friendly) */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { game.paused = true; }
  else if (game.running) { game.paused = false; }
});

// expose for debugging
window.__game = game;
