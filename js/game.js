/* ============================================================
   GAME — the match arbiter & main loop.
   • Owns the two fighters, the Arena, input & AI.
   • Resolves hitbox/hurtbox collisions every frame.
   • Manages rounds, timer, win conditions and HUD updates.
   • Runs a fixed-timestep update for deterministic combat with a
     decoupled render for smooth 60fps.
   ============================================================ */
import * as THREE from 'three';
import { Arena } from './scene.js';
import { Fighter } from './fighter.js';
import { AIController } from './ai.js';
import { audio } from './audio.js';

const ROUND_TIME = 60;          // seconds per round
const ROUNDS_TO_WIN = 2;        // best of 3
const FIXED_DT = 1 / 120;       // physics step

export class Game {
  constructor(canvas, input, ui) {
    this.arena = new Arena(canvas);
    this.input = input;
    this.ui = ui;                 // HUD/screen controller callbacks
    this.p1 = null;
    this.p2 = null;
    this.ai = null;
    this.running = false;
    this.paused = true;
    this._acc = 0;
    this._last = 0;
    this.timer = ROUND_TIME;
    this.round = 1;
    this.wins = { p1: 0, p2: 0 };
    this.roundState = 'idle';     // idle | intro | fight | over
    this._roundLockT = 0;
    this._hitStop = 0;            // brief freeze on impact for "weight"

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /* ---------------- Match setup ---------------- */
  startMatch(playerChar, enemyChar) {
    // Clean previous fighters
    if (this.p1) this.arena.scene.remove(this.p1.root);
    if (this.p2) this.arena.scene.remove(this.p2.root);

    this.p1 = new Fighter(playerChar, -3.5, 1, true);
    this.p2 = new Fighter(enemyChar, 3.5, -1, false);
    this.arena.scene.add(this.p1.root, this.p2.root);
    this.ai = new AIController(this.p2, 0.6);

    this.wins = { p1: 0, p2: 0 };
    this.round = 1;
    this.ui.setNames(playerChar.name, enemyChar.name);
    this.ui.setRounds(this.wins);
    this.running = true;
    this._startRound();
  }

  _startRound() {
    this.timer = ROUND_TIME;
    this.p1.hp = this.p1.maxHp; this.p2.hp = this.p2.maxHp;
    this.p1.root.position.set(-3.5, 0, 0); this.p2.root.position.set(3.5, 0, 0);
    this.p1.facing = 1; this.p1.root.rotation.y = 0;
    this.p2.facing = -1; this.p2.root.rotation.y = Math.PI;
    this.p1.state = 'idle'; this.p2.state = 'idle';
    this.p1.dead = this.p2.dead = false;
    this.p1.stun = this.p2.stun = 0;
    this.input.enable(false);

    this.roundState = 'intro';
    this._roundLockT = 1.6;
    this.ui.banner(`ROUND ${this.round}`);
    this.ui.updateHP(this.p1, this.p2);
    this.ui.updateMeter(this.p1, this.p2);
    setTimeout(() => {
      if (this.roundState !== 'intro') return;
      this.ui.banner('FIGHT!');
      audio.bell();
      this.roundState = 'fight';
      this.input.enable(true);
    }, 1100);
  }

  pause(on) { this.paused = on; }

  /* ---------------- Main loop (fixed update + render) ---------------- */
  _loop(now) {
    requestAnimationFrame(this._loop);
    if (!this._last) this._last = now;
    let frameDt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;

    if (this.running && !this.paused) {
      // hit-stop freeze for impact weight
      if (this._hitStop > 0) {
        this._hitStop -= frameDt;
      } else {
        this._acc += frameDt;
        while (this._acc >= FIXED_DT) {
          this._update(FIXED_DT);
          this._acc -= FIXED_DT;
        }
      }
    }

    // Camera & render every animation frame for smoothness
    this.arena.update(frameDt, this.p1, this.p2);
    this.arena.render();
  }

  _update(dt) {
    if (this.roundState === 'intro') {
      this._roundLockT -= dt;
      this.p1.update(dt, this.p2);
      this.p2.update(dt, this.p1);
      return;
    }

    if (this.roundState === 'fight') {
      // Timer countdown
      this.timer -= dt;
      if (this.timer <= 0) { this.timer = 0; this._timeOut(); }
      this.ui.setTimer(Math.ceil(this.timer));

      // --- Player input -> intents ---
      const inp = this.input;
      this.p1.tryMove(inp.axisX);
      if (inp.up) this.p1.tryJump();
      this.p1.tryBlock(inp.held.block);
      for (const act of inp.consume()) {
        if (act === 'punch') { if (this.p1.tryAttack('punch')) audio.whiff(); }
        else if (act === 'kick') { if (this.p1.tryAttack('kick')) audio.whiff(); }
        else if (act === 'special') { if (this.p1.tryAttack('special')) audio.special(); }
        else if (act === 'dodge') this.p1.tryDodge();
      }

      // --- AI ---
      this.ai.update(dt, this.p1);

      // --- Advance fighters ---
      this.p1.update(dt, this.p2);
      this.p2.update(dt, this.p1);

      // --- Combat resolution ---
      this._resolveCombat(this.p1, this.p2);
      this._resolveCombat(this.p2, this.p1);

      // --- HUD ---
      this.ui.updateHP(this.p1, this.p2);
      this.ui.updateMeter(this.p1, this.p2);

      // --- Win check ---
      if (this.p1.hp <= 0 || this.p2.hp <= 0) this._endRound();
    } else if (this.roundState === 'over') {
      this._roundLockT -= dt;
      this.p1.update(dt, this.p2);
      this.p2.update(dt, this.p1);
      if (this._roundLockT <= 0) this._afterRound();
    }
  }

  /* Test attacker's active hitbox against defender's hurtboxes */
  _resolveCombat(attacker, defender) {
    const hb = attacker.getHitbox();
    if (!hb) return;
    const hurts = defender.getHurtboxes();
    for (const hu of hurts) {
      const dx = hb.x - hu.x, dy = hb.y - hu.y, dz = hb.z - hu.z;
      const rr = (hb.r + hu.r);
      if (dx * dx + dy * dy + dz * dz <= rr * rr) {
        // Connected!
        attacker.registerHit();
        const result = defender.receiveHit(hb.move, attacker);

        if (result === 'block') {
          audio.block();
          this._hitStop = 0.04;
          attacker.combo = 0;
        } else if (result === 'dodge') {
          // whiffed into i-frames, nothing
        } else if (result === 'ko') {
          audio.ko(); audio.grunt(defender.isPlayer ? 1.1 : 0.85);
          this.arena.shake(0.5, 0.4);
          this._hitStop = 0.12;
          this._spawnImpact(hb.x, hb.y, hb.z, 0xffcf4d, 1.4);
        } else { // hit
          const isHeavy = hb.move.knock >= 4;
          if (attacker.attackName === 'kick') audio.kick();
          else if (attacker.attackName === 'special') { /* special sound already played */ }
          else audio.punch();
          audio.grunt(defender.isPlayer ? 1.05 : 0.9);
          this.arena.shake(isHeavy ? 0.35 : 0.18, 0.18);
          this._hitStop = isHeavy ? 0.08 : 0.05;
          this._spawnImpact(hb.x, hb.y, hb.z, attacker.attackName === 'special' ? 0x2ee6d6 : 0xffffff, isHeavy ? 1 : 0.6);

          // Combo tracking belongs to the attacker
          const combo = attacker.registerCombo();
          if (combo >= 2) this.ui.combo(combo);
        }
        return; // one hit per swing
      }
    }
  }

  /* Cheap particle burst at impact point */
  _spawnImpact(x, y, z, color, scale) {
    const geo = new THREE.SphereGeometry(0.18, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const group = new THREE.Group();
    const parts = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      const a = (i / 8) * Math.PI * 2;
      m.userData.v = new THREE.Vector3(Math.cos(a) * 4, Math.sin(a) * 4 + 1, (Math.random() - 0.5) * 2);
      group.add(m); parts.push(m);
    }
    // central flash
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5 * scale, 12, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    group.add(flash);
    group.position.set(x, y, z);
    group.scale.setScalar(scale);
    this.arena.scene.add(group);

    let life = 0.35;
    const tick = () => {
      life -= 0.016;
      const f = Math.max(0, life / 0.35);
      flash.scale.setScalar(1 + (1 - f) * 2);
      flash.material.opacity = f * 0.9;
      for (const p of parts) {
        p.position.addScaledVector(p.userData.v, 0.016);
        p.material.opacity = f;
        p.scale.setScalar(f);
      }
      if (life > 0) requestAnimationFrame(tick);
      else this.arena.scene.remove(group);
    };
    requestAnimationFrame(tick);
  }

  /* ---------------- Round flow ---------------- */
  _timeOut() {
    // higher HP wins the round on timeout
    if (this.p1.hp > this.p2.hp) this.p2.hp = 0;
    else if (this.p2.hp > this.p1.hp) this.p1.hp = 0;
    else { this.p1.hp = this.p2.hp = 0; } // double KO
    this._endRound();
  }

  _endRound() {
    if (this.roundState !== 'fight') return;
    this.roundState = 'over';
    this._roundLockT = 3.0;
    this.input.enable(false);

    const p1Down = this.p1.hp <= 0, p2Down = this.p2.hp <= 0;
    if (p1Down && !p2Down) { this.wins.p2++; this.p1._knockout(-1); this.p2.victory(); this.ui.banner('K.O.'); }
    else if (p2Down && !p1Down) { this.wins.p1++; this.p2._knockout(1); this.p1.victory(); this.ui.banner('K.O.'); }
    else { this.wins.p1++; this.wins.p2++; this.ui.banner('DOUBLE K.O.'); }

    this.ui.setRounds(this.wins);
    this.ui.updateHP(this.p1, this.p2);
  }

  _afterRound() {
    if (this.wins.p1 >= ROUNDS_TO_WIN || this.wins.p2 >= ROUNDS_TO_WIN) {
      this.running = false;
      const playerWon = this.wins.p1 > this.wins.p2;
      this.ui.matchOver(playerWon);
    } else {
      this.round++;
      this._startRound();
    }
  }
}
