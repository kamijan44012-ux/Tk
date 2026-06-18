/* ============================================================
   AI CONTROLLER — drives the CPU fighter.
   A lightweight utility/behaviour system: it reads distance,
   the player's current action, and its own meter to decide
   between approach, attack, block, dodge and spacing.
   Difficulty scales reaction time and aggression.
   ============================================================ */
export class AIController {
  constructor(fighter, difficulty = 0.6) {
    this.f = fighter;
    this.diff = difficulty;          // 0 (easy) .. 1 (hard)
    this._think = 0;                 // cooldown before next decision
    this._action = 'neutral';
    this._actionT = 0;
  }

  update(dt, player) {
    const f = this.f, p = player;
    if (f.dead || f.state === 'ko' || f.state === 'victory') return;

    this._think -= dt;
    this._actionT -= dt;

    const dx = p.root.position.x - f.root.position.x;
    const dist = Math.abs(dx);
    const dir = Math.sign(dx) || 1;
    const playerAttacking = p.state === 'attack' && p._attackPhase !== 'recovery';

    // Reactive defense: block/dodge incoming attacks (reaction gated by difficulty)
    if (playerAttacking && dist < 2.6 && f.canAct()) {
      const react = Math.random() < (0.35 + this.diff * 0.5);
      if (react) {
        if (Math.random() < 0.35 && f.onGround) { f.tryDodge(); this._think = 0.4; return; }
        f.tryBlock(true); this._block = 0.35; this._think = 0.25; return;
      }
    }

    // Release block once threat passes
    if (f.isBlocking()) {
      this._block -= dt;
      if (this._block <= 0 || !playerAttacking) f.tryBlock(false);
      else return;
    }

    if (this._think > 0) {
      // keep executing current movement intent
      if (this._action === 'approach') f.tryMove(dir);
      else if (this._action === 'retreat') f.tryMove(-dir);
      return;
    }

    // ----- Decide a new action -----
    this._think = 0.12 + (1 - this.diff) * 0.4 + Math.random() * 0.2;

    // Use special when meter is full and in range
    if (f.meter >= 100 && dist < 2.8 && Math.random() < 0.6) {
      f.tryAttack('special'); return;
    }

    if (dist > 3.2) {
      // approach (occasionally jump-in)
      this._action = 'approach';
      if (Math.random() < 0.12 && f.onGround) f.tryJump();
      f.tryMove(dir);
    } else if (dist < 1.4) {
      // too close: attack or create space
      if (Math.random() < 0.2) { this._action = 'retreat'; f.tryMove(-dir); }
      else { this._action = 'attack'; f.tryAttack(Math.random() < 0.6 ? 'punch' : 'kick'); }
    } else {
      // strike range
      const r = Math.random();
      if (r < 0.5 + this.diff * 0.2) { this._action = 'attack'; f.tryAttack(r < 0.3 ? 'kick' : 'punch'); }
      else if (r < 0.8) { this._action = 'approach'; f.tryMove(dir); }
      else { this._action = 'neutral'; }
    }
  }
}
