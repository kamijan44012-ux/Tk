/* ============================================================
   FIGHTER — the heart of the combat system.

   Responsibilities:
     • Builds a low-poly humanoid rig from primitives (no external
       models needed) with named joints for procedural animation.
     • Runs a frame-data driven state machine:
         idle, walk, jump, punch, kick, special,
         block, dodge, hitstun, knockdown, ko, victory
     • Produces hitboxes (active attack frames) and hurtboxes that
       the Game arbiter tests for collisions.
     • Handles damage, blocking, knockback, combos & super meter.

   Coordinate convention:
     Model is authored facing +X. `facing` (+1/-1) flips the root
     so opponents always face each other. All attacks extend toward
     the fighter's front (+local X).
   ============================================================ */
import * as THREE from 'three';

// ---- Frame data: durations in seconds (startup/active/recovery) ----
const MOVES = {
  punch:   { startup: 0.07, active: 0.08, recovery: 0.16, damage: 6,  knock: 2.2, meterGain: 8,  reach: 1.7, cost: 0, block: 0.18 },
  kick:    { startup: 0.12, active: 0.10, recovery: 0.26, damage: 11, knock: 4.0, meterGain: 11, reach: 2.0, cost: 0, block: 0.30 },
  special: { startup: 0.22, active: 0.18, recovery: 0.40, damage: 24, knock: 7.5, meterGain: 0,  reach: 2.4, cost: 100, block: 0.55 },
};

const GROUND_Y = 0;
const ARENA_LIMIT = 8.4;     // how far fighters can walk from centre
const TMP = new THREE.Vector3();

export class Fighter {
  constructor(charData, startX, facing, isPlayer) {
    this.char = charData;
    this.isPlayer = isPlayer;
    this.facing = facing;            // +1 faces right, -1 faces left
    this.stats = charData.stats;

    // --- vitals ---
    this.maxHp = 100;
    this.hp = 100;
    this.meter = 0;                  // 0..100 super gauge
    this.maxMeter = 100;

    // --- physics ---
    this.vx = 0;
    this.vy = 0;
    this.onGround = true;

    // --- state machine ---
    this.state = 'idle';
    this.stateT = 0;                 // time elapsed in current state
    this.attack = null;              // active move definition
    this.attackName = null;
    this.hasHit = false;             // attack already connected this swing
    this.stun = 0;                   // remaining hitstun/blockstun
    this.invuln = 0;                 // i-frames (dodge)
    this.dodgeDir = 0;
    this.dead = false;
    this.combo = 0;
    this._comboTimer = 0;

    // animation pose state (current + target euler angles per joint)
    this.pose = {};
    this.target = {};
    this._animClock = 0;

    this._buildRig(startX);
  }

  /* ---------------- RIG CONSTRUCTION ---------------- */
  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: opts.r ?? 0.6, metalness: opts.m ?? 0.1 });
  }

  _joint(name, parent, pos) {
    const g = new THREE.Group();
    g.position.set(pos[0], pos[1], pos[2]);
    parent.add(g);
    this.pose[name] = { x: 0, y: 0, z: 0 };
    this.target[name] = { x: 0, y: 0, z: 0 };
    this[name] = g;
    return g;
  }

  _limb(parent, len, thick, mat) {
    // a limb segment hanging down along -Y from the joint
    const geo = new THREE.CapsuleGeometry(thick, len, 4, 8);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = -len / 2 - thick;
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  _buildRig(startX) {
    const c = this.char.colors;
    const skin = this._mat(c.skin, { r: 0.7 });
    const suit = this._mat(c.suit, { r: 0.5, m: 0.2 });
    const trim = this._mat(c.trim, { r: 0.4, m: 0.3 });
    const hair = this._mat(c.hair, { r: 0.8 });

    // Root group: positioned in world, rotated to face opponent.
    this.root = new THREE.Group();
    this.root.position.set(startX, GROUND_Y, 0);
    this.root.rotation.y = this.facing === 1 ? 0 : Math.PI;

    // Body (a vertical group we bob/lean)
    this.body = this._joint('body', this.root, [0, 0, 0]);

    // Torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.7, 4, 10), suit);
    torso.position.y = 1.45; torso.castShadow = true;
    this.body.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.45), trim);
    chest.position.y = 1.7; chest.castShadow = true; this.body.add(chest);

    // Hips
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.5), suit);
    hips.position.y = 0.95; hips.castShadow = true; this.body.add(hips);

    // Head + hair
    this._joint('neck', this.body, [0, 1.95, 0]);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), skin);
    head.castShadow = true; this.neck.add(head);
    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hair);
    hairMesh.position.y = 0.06; this.neck.add(hairMesh);
    // a little forward "face" marker so orientation is readable
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.05), trim);
    brow.position.set(0.0, 0.04, 0.28); this.neck.add(brow);

    // Arms (shoulder -> elbow -> fist). Shoulders on +/-Z.
    this._joint('armUpR', this.body, [0, 1.78, -0.5]);   // right arm = back side (-Z)
    this._limb(this.armUpR, 0.42, 0.13, suit);
    this._joint('armLoR', this.armUpR, [0, -0.62, 0]);
    this._limb(this.armLoR, 0.4, 0.11, skin);
    this.fistR = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), trim);
    this.fistR.position.y = -0.62; this.fistR.castShadow = true; this.armLoR.add(this.fistR);

    this._joint('armUpL', this.body, [0, 1.78, 0.5]);    // left arm = front side (+Z)
    this._limb(this.armUpL, 0.42, 0.13, suit);
    this._joint('armLoL', this.armUpL, [0, -0.62, 0]);
    this._limb(this.armLoL, 0.4, 0.11, skin);
    this.fistL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), trim);
    this.fistL.position.y = -0.62; this.fistL.castShadow = true; this.armLoL.add(this.fistL);

    // Legs (hip -> knee -> foot)
    this._joint('legUpR', this.body, [0, 0.9, -0.22]);
    this._limb(this.legUpR, 0.5, 0.16, suit);
    this._joint('legLoR', this.legUpR, [0, -0.74, 0]);
    this._limb(this.legLoR, 0.46, 0.13, skin);
    this.footR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.42), trim);
    this.footR.position.set(0, -0.72, 0.08); this.footR.castShadow = true; this.legLoR.add(this.footR);

    this._joint('legUpL', this.body, [0, 0.9, 0.22]);
    this._limb(this.legUpL, 0.5, 0.16, suit);
    this._joint('legLoL', this.legUpL, [0, -0.74, 0]);
    this._limb(this.legLoL, 0.46, 0.13, skin);
    this.footL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.42), trim);
    this.footL.position.set(0, -0.72, 0.08); this.footL.castShadow = true; this.legLoL.add(this.footL);

    // Energy aura for specials (hidden by default)
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 16, 16),
      new THREE.MeshBasicMaterial({ color: c.trim, transparent: true, opacity: 0 })
    );
    this.aura.position.y = 1.3; this.root.add(this.aura);

    // Shadow blob (cheap contact shadow)
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    );
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.02; this.root.add(this.blob);

    this._setRestPose();
  }

  /* ---------------- POSE HELPERS ---------------- */
  _setTarget(joint, x, y, z) { const t = this.target[joint]; t.x = x; t.y = y; t.z = z; }

  _setRestPose() {
    this._setTarget('body', 0, 0, 0);
    this._setTarget('neck', 0, 0, 0);
    // slight fighting stance: arms up guarding
    this._setTarget('armUpR', 0, 0, 0.5);
    this._setTarget('armLoR', 0, 0, 1.0);
    this._setTarget('armUpL', 0, 0, -0.5);
    this._setTarget('armLoL', 0, 0, -1.0);
    this._setTarget('legUpR', 0, 0, 0.12);
    this._setTarget('legLoR', 0, 0, -0.2);
    this._setTarget('legUpL', 0, 0, -0.12);
    this._setTarget('legLoL', 0, 0, -0.2);
  }

  /* ---------------- PUBLIC: combat intents ---------------- */
  canAct() {
    return !this.dead && this.stun <= 0 &&
      (this.state === 'idle' || this.state === 'walk' || this.state === 'jump');
  }

  tryMove(dir) {
    if (!this.canAct()) return;
    const sp = this.stats.speed;
    this.vx = dir * sp;
  }

  tryJump() {
    if (!this.canAct() || !this.onGround) return;
    this.vy = this.stats.jump;
    this.onGround = false;
    this._enter('jump');
  }

  tryBlock(on) {
    if (this.dead) return;
    if (on && this.canAct() && this.onGround) {
      this._enter('block');
    } else if (!on && this.state === 'block') {
      this._enter('idle');
    }
  }

  tryDodge() {
    if (!this.canAct() || !this.onGround) return;
    this._enter('dodge');
    this.invuln = 0.32;
    this.dodgeDir = -this.facing;      // hop backward
    this.vx = this.dodgeDir * this.stats.speed * 1.6;
  }

  tryAttack(name) {
    if (!this.canAct()) return false;
    const move = MOVES[name];
    if (!move) return false;
    if (move.cost > 0 && this.meter < move.cost) return false; // not enough meter
    if (move.cost > 0) this.meter = Math.max(0, this.meter - move.cost);
    this.attack = move;
    this.attackName = name;
    this.hasHit = false;
    this.vx = 0;
    this._enter('attack');
    this._attackPhase = 'startup';
    if (name === 'special') this._auraFlash = 0.6;
    return true;
  }

  _enter(state) {
    this.state = state;
    this.stateT = 0;
  }

  /* ---------------- DAMAGE / DEFENSE ---------------- */
  isBlocking() { return this.state === 'block'; }

  /* Called by Game when an opponent hitbox overlaps a hurtbox.
     Returns the outcome string for SFX/FX selection. */
  receiveHit(move, attacker) {
    if (this.dead || this.invuln > 0) return 'dodge';

    const facingAttacker = Math.sign(attacker.root.position.x - this.root.position.x) === this.facing;
    if (this.isBlocking() && facingAttacker) {
      // Chip damage + blockstun + pushback
      const chip = move.damage * 0.12;
      this.hp = Math.max(0, this.hp - chip);
      this.stun = move.block;
      this.vx = Math.sign(this.root.position.x - attacker.root.position.x) * move.knock * 0.5;
      this.meter = Math.min(this.maxMeter, this.meter + 4);
      return 'block';
    }

    // Clean hit
    const dmg = move.damage / this.stats.defense;
    this.hp = Math.max(0, this.hp - dmg);
    this.meter = Math.min(this.maxMeter, this.meter + 6);
    const dir = Math.sign(this.root.position.x - attacker.root.position.x) || -this.facing;
    this.vx = dir * move.knock;

    if (this.hp <= 0) {
      this._knockout(dir);
      return 'ko';
    }

    // Heavy hits cause knockdown / launch
    if (move.knock >= 6) {
      this.vy = 4.5; this.onGround = false;
      this.stun = 0.5;
      this._enter('knockdown');
    } else {
      this.stun = 0.18 + move.damage * 0.012;
      this._enter('hitstun');
    }
    return 'hit';
  }

  _knockout(dir) {
    this.dead = true;
    this.vx = dir * 6; this.vy = 6;
    this.onGround = false;
    this._enter('ko');
    this.stun = 999;
  }

  victory() { if (!this.dead) this._enter('victory'); }

  addMeter(v) { this.meter = Math.min(this.maxMeter, this.meter + v); }

  /* ---------------- HITBOX / HURTBOX QUERIES ----------------
     Returned as world-space spheres {x,y,z,r}. */
  getHitbox() {
    if (this.state !== 'attack' || this._attackPhase !== 'active' || this.hasHit) return null;
    // hitbox sits at the active weapon (fist or foot)
    const node = (this.attackName === 'kick') ? this.footR : this.fistR;
    node.getWorldPosition(TMP);
    const r = this.attackName === 'special' ? 1.1 : 0.55;
    return { x: TMP.x, y: TMP.y, z: TMP.z, r, move: this.attack };
  }

  getHurtboxes() {
    if (this.invuln > 0 || this.dead) return [];
    const boxes = [];
    this.body.getWorldPosition(TMP);
    boxes.push({ x: TMP.x, y: TMP.y + 1.45, z: TMP.z, r: 0.6 }); // torso
    this.neck.getWorldPosition(TMP);
    boxes.push({ x: TMP.x, y: TMP.y, z: TMP.z, r: 0.4 });        // head
    return boxes;
  }

  registerHit() { this.hasHit = true; this.addMeter(this.attack.meterGain); }

  /* ---------------- PER-FRAME UPDATE ---------------- */
  update(dt, opponent) {
    this.stateT += dt;
    this._animClock += dt;
    if (this.stun > 0 && this.state !== 'ko') this.stun -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this._comboTimer > 0) { this._comboTimer -= dt; if (this._comboTimer <= 0) this.combo = 0; }
    if (this._auraFlash > 0) this._auraFlash -= dt;

    // Always face the opponent when grounded & actionable
    if (opponent && this.canAct()) {
      const want = opponent.root.position.x >= this.root.position.x ? 1 : -1;
      if (want !== this.facing) {
        this.facing = want;
        this.root.rotation.y = this.facing === 1 ? 0 : Math.PI;
      }
    }

    this._tickState(dt);
    this._physics(dt, opponent);
    this._animate(dt);
  }

  _tickState(dt) {
    switch (this.state) {
      case 'attack': this._tickAttack(); break;
      case 'jump':
        if (this.onGround) this._enter('idle');
        break;
      case 'hitstun':
        if (this.stun <= 0) this._enter('idle');
        break;
      case 'knockdown':
        if (this.onGround && this.stun <= 0) this._enter('idle');
        break;
      case 'dodge':
        if (this.stateT > 0.32) { this.vx = 0; this._enter('idle'); }
        break;
      case 'idle':
      case 'walk':
        this.state = Math.abs(this.vx) > 0.5 && this.onGround ? 'walk' : 'idle';
        break;
    }
  }

  _tickAttack() {
    const m = this.attack;
    const t = this.stateT;
    if (t < m.startup) this._attackPhase = 'startup';
    else if (t < m.startup + m.active) this._attackPhase = 'active';
    else if (t < m.startup + m.active + m.recovery) this._attackPhase = 'recovery';
    else { this.attack = null; this.attackName = null; this._enter('idle'); }
  }

  _physics(dt, opponent) {
    // Gravity
    if (!this.onGround) {
      this.vy -= 22 * dt;
    }
    // Horizontal friction when not actively driven
    if (this.onGround && this.state !== 'walk' && this.state !== 'dodge') {
      this.vx *= Math.pow(0.0001, dt); // strong damping
      if (Math.abs(this.vx) < 0.05) this.vx = 0;
    }

    this.root.position.x += this.vx * dt;
    this.root.position.y += this.vy * dt;

    // Ground collision
    if (this.root.position.y <= GROUND_Y) {
      this.root.position.y = GROUND_Y;
      this.vy = 0;
      if (!this.onGround) {
        this.onGround = true;
        if (this.state === 'knockdown') this.stun = Math.max(this.stun, 0.35);
      }
    }

    // Arena bounds
    this.root.position.x = Math.max(-ARENA_LIMIT, Math.min(ARENA_LIMIT, this.root.position.x));

    // Soft body collision so fighters don't overlap
    if (opponent) {
      const dx = this.root.position.x - opponent.root.position.x;
      const minDist = 1.5;
      if (Math.abs(dx) < minDist && Math.abs(this.root.position.y - opponent.root.position.y) < 1.8) {
        const push = (minDist - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
        this.root.position.x += push;
        opponent.root.position.x -= push;
      }
    }

    // keep shadow blob on the floor & scale with height (fake AO)
    const h = this.root.position.y;
    this.blob.position.y = 0.02 - h;
    const s = Math.max(0.4, 1 - h * 0.12);
    this.blob.scale.set(s, s, s);
    this.blob.material.opacity = 0.35 * s;
  }

  registerCombo() {
    this.combo++;
    this._comboTimer = 1.2;
    return this.combo;
  }

  /* ---------------- PROCEDURAL ANIMATION ----------------
     Sets joint targets based on state, then critically-damped
     lerps current pose toward target for buttery 60fps motion. */
  _animate(dt) {
    const k = this._animClock;
    // Reset to stance, then layer state-specific motion.
    this._setRestPose();

    switch (this.state) {
      case 'idle': {
        const b = Math.sin(k * 2.2) * 0.04;
        this._setTarget('body', b, 0, 0);
        this._setTarget('neck', -b, 0, 0);
        this._setTarget('armLoR', 0, 0, 1.0 + Math.sin(k * 2.2) * 0.05);
        this._setTarget('armLoL', 0, 0, -1.0 - Math.sin(k * 2.2) * 0.05);
        break;
      }
      case 'walk': {
        const sw = Math.sin(k * 9) * 0.5;
        this._setTarget('legUpR', sw, 0, 0.1);
        this._setTarget('legUpL', -sw, 0, -0.1);
        this._setTarget('legLoR', Math.max(0, -sw) * 0.7, 0, 0);
        this._setTarget('legLoL', Math.max(0, sw) * 0.7, 0, 0);
        this._setTarget('armUpR', -sw * 0.5, 0, 0.4);
        this._setTarget('armUpL', sw * 0.5, 0, -0.4);
        this._setTarget('body', 0, 0, this.vx * 0.02);
        break;
      }
      case 'jump': {
        this._setTarget('legUpR', -0.5, 0, 0.2);
        this._setTarget('legUpL', -0.4, 0, -0.2);
        this._setTarget('legLoR', 0.8, 0, 0);
        this._setTarget('legLoL', 0.7, 0, 0);
        this._setTarget('armUpR', -1.4, 0, 0.4);
        this._setTarget('armUpL', -1.4, 0, -0.4);
        break;
      }
      case 'block': {
        this._setTarget('armUpR', -0.3, 0, 1.1);
        this._setTarget('armLoR', 0, 0, 1.9);
        this._setTarget('armUpL', -0.3, 0, -1.1);
        this._setTarget('armLoL', 0, 0, -1.9);
        this._setTarget('body', 0.1, 0, 0);
        this._setTarget('legUpR', 0.2, 0, 0.15);
        break;
      }
      case 'dodge': {
        const p = this.stateT / 0.32;
        this._setTarget('body', 0, this.dodgeDir * 0.5, 0.2 * Math.sin(p * Math.PI));
        this._setTarget('legUpR', 0.6, 0, 0.2);
        this._setTarget('legUpL', 0.4, 0, -0.2);
        break;
      }
      case 'hitstun': {
        this._setTarget('body', -0.25, 0, 0);
        this._setTarget('neck', -0.3, 0, 0);
        this._setTarget('armUpR', 0.5, 0, 0.6);
        this._setTarget('armUpL', 0.5, 0, -0.6);
        break;
      }
      case 'knockdown':
      case 'ko': {
        // tumble backward
        const spin = Math.min(Math.PI * 0.5, this.stateT * 4);
        this._setTarget('body', -spin, 0, 0);
        this._setTarget('armUpR', 1.2, 0, 0.8);
        this._setTarget('armUpL', 1.2, 0, -0.8);
        this._setTarget('legUpR', -0.6, 0, 0.2);
        this._setTarget('legUpL', -0.5, 0, -0.2);
        break;
      }
      case 'victory': {
        const b = Math.sin(k * 4) * 0.2;
        this._setTarget('armUpR', -2.4 + b, 0, 0.3);
        this._setTarget('armUpL', -2.4 - b, 0, -0.3);
        this._setTarget('body', 0, 0, 0);
        break;
      }
      case 'attack':
        this._animateAttack();
        break;
    }

    // Exponential smoothing toward targets (frame-rate independent).
    // tau ~25ms gives responsive yet fluid limb motion.
    const rate = 1 - Math.exp(-dt / 0.025);
    for (const name in this.pose) {
      const p = this.pose[name], t = this.target[name];
      p.x += (t.x - p.x) * rate;
      p.y += (t.y - p.y) * rate;
      p.z += (t.z - p.z) * rate;
      this[name].rotation.set(p.x, p.y, p.z);
    }

    // Aura visual during special
    const auraOn = (this.attackName === 'special') || this._auraFlash > 0;
    const tgtOpacity = auraOn ? 0.28 : 0;
    this.aura.material.opacity += (tgtOpacity - this.aura.material.opacity) * Math.min(1, dt * 10);
    const as = 1 + Math.sin(k * 12) * 0.06;
    this.aura.scale.set(as, as, as);
  }

  _animateAttack() {
    const name = this.attackName;
    const m = this.attack;
    const total = m.startup + m.active + m.recovery;
    const t = this.stateT;
    // progress 0..1 with a fast extend during startup+active, slow retract in recovery
    const extendEnd = m.startup + m.active;
    let ext;
    if (t < extendEnd) ext = t / extendEnd;            // 0 -> 1 windup & strike
    else ext = 1 - (t - extendEnd) / m.recovery;       // 1 -> 0 retract
    ext = Math.max(0, Math.min(1, ext));
    const e = ext * ext * (3 - 2 * ext);               // smoothstep

    if (name === 'punch') {
      // straight right cross
      this._setTarget('armUpR', 0, 0, 1.55 * e);
      this._setTarget('armLoR', 0, 0, (1 - e) * 1.0);   // straighten on extend
      this._setTarget('armUpL', -0.2 * e, 0, -0.7);
      this._setTarget('body', 0, -0.35 * e, 0);
      this._setTarget('neck', 0, -0.2 * e, 0);
    } else if (name === 'kick') {
      // roundhouse with right leg
      this._setTarget('legUpR', 0, 0, 1.7 * e);
      this._setTarget('legLoR', 0, 0, -(1 - e) * 1.0);
      this._setTarget('body', -0.1 * e, -0.4 * e, 0);
      this._setTarget('armUpL', -0.6 * e, 0, -0.9);
      this._setTarget('armUpR', 0.4 * e, 0, 0.6);
    } else if (name === 'special') {
      // double palm energy blast (both arms thrust forward)
      this._setTarget('armUpR', 0, 0, 1.5 * e);
      this._setTarget('armLoR', 0, 0, (1 - e) * 0.8);
      this._setTarget('armUpL', 0, 0, -1.5 * e);
      this._setTarget('armLoL', 0, 0, -(1 - e) * 0.8);
      this._setTarget('body', 0.15 - 0.3 * e, 0, 0);
      this._setTarget('legUpR', 0.3, 0, 0.2);
      this._setTarget('legUpL', -0.2, 0, -0.15);
    }
  }
}
