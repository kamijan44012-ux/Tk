/* ============================================================
   FIGHTER — real rigged 3D human (Mixamo skeleton) combatant.

   Animation strategy (this is what gives it the "real" feel):
     • BASE layer  : genuine motion-capture clips (Idle / Walk / Run)
                     played through an AnimationMixer.
     • COMBAT layer: procedural, but driven by CCD INVERSE KINEMATICS
                     on the actual bones — so a punch literally reaches
                     toward the opponent and the elbow/shoulder bend
                     naturally. This is axis-agnostic (works in world
                     space) so it looks correct on the real skeleton.

   The fighting state machine, hitboxes/hurtboxes, damage, blocking,
   dodging, combos and super-meter live here too.
   ============================================================ */
import * as THREE from 'three';
import { assets } from './assets.js';

// ---- Frame data: durations in seconds (startup / active / recovery) ----
const MOVES = {
  punch:   { startup: 0.08, active: 0.09, recovery: 0.18, damage: 6,  knock: 2.2, meterGain: 8,  cost: 0,   limb: 'armR' },
  kick:    { startup: 0.14, active: 0.11, recovery: 0.30, damage: 11, knock: 4.2, meterGain: 11, cost: 0,   limb: 'legR' },
  special: { startup: 0.24, active: 0.20, recovery: 0.42, damage: 24, knock: 7.8, meterGain: 0,  cost: 100, limb: 'armR' },
};

const GROUND_Y = 0;
const ARENA_LIMIT = 8.4;

// Soft radial glow texture (generated once) used for the attack sprite.
let _glowTex = null;
function _glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

// scratch objects (avoid per-frame allocations)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

export class Fighter {
  constructor(charData, startX, facing, isPlayer) {
    this.char = charData;
    this.isPlayer = isPlayer;
    this.facing = facing;
    this.stats = charData.stats;

    // vitals
    this.maxHp = 100; this.hp = 100;
    this.meter = 0; this.maxMeter = 100;

    // physics
    this.vx = 0; this.vy = 0; this.onGround = true;

    // state machine
    this.state = 'idle'; this.stateT = 0;
    this.attack = null; this.attackName = null; this._attackPhase = 'startup';
    this.hasHit = false; this.stun = 0; this.invuln = 0; this.dodgeDir = 0;
    this.dead = false; this.combo = 0; this._comboTimer = 0;

    // smoothed lean (body english)
    this._lean = { x: 0, z: 0 };
    this._leanT = { x: 0, z: 0 };
    this._locoIdle = 1; this._locoWalk = 0; this._locoRun = 0;
    this._auraFlash = 0;

    this._build(startX);
  }

  _build(startX) {
    const inst = assets.createInstance(this.char.colors.suit);
    this.bones = inst.bones;
    this.mixer = inst.mixer;
    this.actions = inst.actions;

    // root (world position) -> lean (facing + body english) -> model
    this.root = new THREE.Group();
    this.root.position.set(startX, GROUND_Y, 0);
    this.root.scale.setScalar(this.char.bodyScale || 1);

    this.lean = new THREE.Group();
    this.lean.rotation.y = this.facing * Math.PI / 2;
    this.lean.add(inst.model);
    this.root.add(this.lean);
    this.model = inst.model;

    // Energy aura for specials
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 16, 16),
      new THREE.MeshBasicMaterial({ color: this.char.colors.trim, transparent: true, opacity: 0, depthWrite: false })
    );
    this.aura.position.y = 1.1; this.root.add(this.aura);

    // Contact shadow blob
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
    );
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.02; this.root.add(this.blob);

    // Attack glow: a soft additive sprite that follows the active weapon.
    this.trail = new THREE.Sprite(new THREE.SpriteMaterial({
      map: _glowTexture(), color: this.char.colors.trim,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.trail.visible = false; this.root.add(this.trail);
  }

  /* ---------------- combat intents ---------------- */
  canAct() {
    return !this.dead && this.stun <= 0 &&
      (this.state === 'idle' || this.state === 'walk' || this.state === 'jump');
  }
  tryMove(dir) { if (this.canAct()) this.vx = dir * this.stats.speed; }
  tryJump() { if (this.canAct() && this.onGround) { this.vy = this.stats.jump; this.onGround = false; this._enter('jump'); } }
  tryBlock(on) {
    if (this.dead) return;
    if (on && this.canAct() && this.onGround) { this._enter('block'); this._blendW = 0; }
    else if (!on && this.state === 'block') this._enter('idle');
  }
  tryDodge() {
    if (!this.canAct() || !this.onGround) return;
    this._enter('dodge'); this.invuln = 0.34; this.dodgeDir = -this.facing;
    this.vx = this.dodgeDir * this.stats.speed * 1.7;
  }
  tryAttack(name) {
    if (!this.canAct()) return false;
    const move = MOVES[name]; if (!move) return false;
    if (move.cost > 0 && this.meter < move.cost) return false;
    if (move.cost > 0) this.meter = Math.max(0, this.meter - move.cost);
    this.attack = move; this.attackName = name; this.hasHit = false;
    this.vx = 0; this._enter('attack'); this._attackPhase = 'startup';
    if (name === 'special') this._auraFlash = 0.7;
    return true;
  }
  _enter(state) { this.state = state; this.stateT = 0; }

  /* ---------------- defense / damage ---------------- */
  isBlocking() { return this.state === 'block'; }

  receiveHit(move, attacker) {
    if (this.dead || this.invuln > 0) return 'dodge';
    const facingAttacker = Math.sign(attacker.root.position.x - this.root.position.x) === this.facing;
    if (this.isBlocking() && facingAttacker) {
      this.hp = Math.max(0, this.hp - move.damage * 0.12);
      this.stun = 0.18 + move.damage * 0.01;
      this.vx = Math.sign(this.root.position.x - attacker.root.position.x) * move.knock * 0.5;
      this.meter = Math.min(this.maxMeter, this.meter + 4);
      return 'block';
    }
    const dmg = move.damage / this.stats.defense;
    this.hp = Math.max(0, this.hp - dmg);
    this.meter = Math.min(this.maxMeter, this.meter + 6);
    const dir = Math.sign(this.root.position.x - attacker.root.position.x) || -this.facing;
    this.vx = dir * move.knock;
    if (this.hp <= 0) { this._knockout(dir); return 'ko'; }
    if (move.knock >= 6) { this.vy = 4.6; this.onGround = false; this.stun = 0.5; this._enter('knockdown'); }
    else { this.stun = 0.2 + move.damage * 0.012; this._enter('hitstun'); }
    return 'hit';
  }
  _knockout(dir) {
    this.dead = true; this.vx = dir * 5.5; this.vy = 6; this.onGround = false;
    this._enter('ko'); this.stun = 999;
  }
  victory() { if (!this.dead) this._enter('victory'); }
  addMeter(v) { this.meter = Math.min(this.maxMeter, this.meter + v); }

  /* ---------------- hit / hurt queries (world-space spheres) ---------------- */
  _weaponBone() {
    if (this.attackName === 'kick') return this.bones.RightFoot;
    return this.bones.RightHand;
  }
  getHitbox() {
    if (this.state !== 'attack' || this._attackPhase !== 'active' || this.hasHit) return null;
    const node = this._weaponBone(); if (!node) return null;
    node.getWorldPosition(_v1);
    const r = this.attackName === 'special' ? 1.0 : 0.5;
    return { x: _v1.x, y: _v1.y, z: _v1.z, r, move: this.attack };
  }
  getHurtboxes() {
    if (this.invuln > 0 || this.dead) return [];
    const out = [];
    if (this.bones.Spine1) { this.bones.Spine1.getWorldPosition(_v1); out.push({ x: _v1.x, y: _v1.y, z: _v1.z, r: 0.58 }); }
    if (this.bones.Head) { this.bones.Head.getWorldPosition(_v1); out.push({ x: _v1.x, y: _v1.y, z: _v1.z, r: 0.34 }); }
    return out;
  }
  registerHit() { this.hasHit = true; this.addMeter(this.attack.meterGain); }
  registerCombo() { this.combo++; this._comboTimer = 1.2; return this.combo; }

  /* ---------------- per-frame update ---------------- */
  update(dt, opponent) {
    this.stateT += dt;
    if (this.stun > 0 && this.state !== 'ko') this.stun -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this._comboTimer > 0) { this._comboTimer -= dt; if (this._comboTimer <= 0) this.combo = 0; }
    if (this._auraFlash > 0) this._auraFlash -= dt;

    if (opponent && this.canAct()) {
      const want = opponent.root.position.x >= this.root.position.x ? 1 : -1;
      if (want !== this.facing) this.facing = want;
    }

    this._tickState();
    this._physics(dt, opponent);
    this._animate(dt);
  }

  _tickState() {
    switch (this.state) {
      case 'attack': {
        const m = this.attack, t = this.stateT;
        if (t < m.startup) this._attackPhase = 'startup';
        else if (t < m.startup + m.active) this._attackPhase = 'active';
        else if (t < m.startup + m.active + m.recovery) this._attackPhase = 'recovery';
        else { this.attack = null; this.attackName = null; this._enter('idle'); }
        break;
      }
      case 'jump': if (this.onGround) this._enter('idle'); break;
      case 'hitstun': if (this.stun <= 0) this._enter('idle'); break;
      case 'knockdown': if (this.onGround && this.stun <= 0) this._enter('idle'); break;
      case 'dodge': if (this.stateT > 0.34) { this.vx = 0; this._enter('idle'); } break;
      case 'idle': case 'walk':
        this.state = (Math.abs(this.vx) > 0.4 && this.onGround) ? 'walk' : 'idle';
        break;
    }
  }

  _physics(dt, opponent) {
    if (!this.onGround) this.vy -= 22 * dt;
    if (this.onGround && this.state !== 'walk' && this.state !== 'dodge') {
      this.vx *= Math.pow(0.0001, dt);
      if (Math.abs(this.vx) < 0.05) this.vx = 0;
    }
    this.root.position.x += this.vx * dt;
    this.root.position.y += this.vy * dt;

    if (this.root.position.y <= GROUND_Y) {
      this.root.position.y = GROUND_Y; this.vy = 0;
      if (!this.onGround) { this.onGround = true; if (this.state === 'knockdown') this.stun = Math.max(this.stun, 0.4); }
    }
    this.root.position.x = Math.max(-ARENA_LIMIT, Math.min(ARENA_LIMIT, this.root.position.x));

    if (opponent) {
      const dx = this.root.position.x - opponent.root.position.x;
      const minDist = 1.45;
      if (Math.abs(dx) < minDist && Math.abs(this.root.position.y - opponent.root.position.y) < 1.8) {
        const push = (minDist - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
        this.root.position.x += push; opponent.root.position.x -= push;
      }
    }

    const h = this.root.position.y;
    this.blob.position.y = 0.02 - h;
    const s = Math.max(0.4, 1 - h * 0.12);
    this.blob.scale.set(s, s, s); this.blob.material.opacity = 0.34 * s;
  }

  /* ---------------- animation ---------------- */
  _animate(dt) {
    // 1) Facing
    this.lean.rotation.y = this.facing * Math.PI / 2;

    // 2) Locomotion crossfade (real mocap base layer)
    let tIdle = 1, tWalk = 0, tRun = 0;
    if (this.state === 'walk') {
      const fast = Math.abs(this.vx) > this.stats.speed * 0.9;
      tIdle = 0; tWalk = fast ? 0 : 1; tRun = fast ? 1 : 0;
    } else if (this.state === 'dodge') { tIdle = 0; tRun = 1; }
    const rate = 1 - Math.exp(-dt / 0.12);
    this._locoIdle += (tIdle - this._locoIdle) * rate;
    this._locoWalk += (tWalk - this._locoWalk) * rate;
    this._locoRun += (tRun - this._locoRun) * rate;
    if (this.actions.Idle) this.actions.Idle.setEffectiveWeight(this._locoIdle);
    if (this.actions.Walk) this.actions.Walk.setEffectiveWeight(this._locoWalk);
    if (this.actions.Run) this.actions.Run.setEffectiveWeight(this._locoRun);
    // Walk forward toward the foe, but reverse the cycle when backing away
    // (so retreating reads as a back-step instead of a moonwalk).
    const dirSign = Math.abs(this.vx) > 0.05 ? (Math.sign(this.vx) === this.facing ? 1 : -1) : 1;
    if (this.actions.Walk) this.actions.Walk.timeScale = dirSign;
    if (this.actions.Run) this.actions.Run.timeScale = dirSign;

    // 3) Advance mocap clips (writes base pose into bones)
    this.mixer.update(dt);

    // 4) Refresh world matrices so IK reads the posed skeleton
    this.root.updateWorldMatrix(true, true);

    // 5) Combat override layer (IK) + lean targets
    this._leanT.x = 0; this._leanT.z = 0;
    this.trail.visible = false;
    switch (this.state) {
      case 'attack': this._animAttack(); break;
      case 'block': this._animBlock(); break;
      case 'hitstun': this._leanT.x = 0.34; break;
      case 'knockdown': case 'ko': this._leanT.x = Math.min(1.45, this.stateT * 4.5); break;
      case 'dodge': this._leanT.z = this.dodgeDir * this.facing * 0.32; break;
      case 'jump': this._animJump(); break;
    }

    // 6) Smooth & apply lean (body english) — composed with facing
    const lr = 1 - Math.exp(-dt / 0.05);
    this._lean.x += (this._leanT.x - this._lean.x) * lr;
    this._lean.z += (this._leanT.z - this._lean.z) * lr;
    this.lean.rotation.x = this._lean.x;
    this.lean.rotation.z = this._lean.z;

    // 7) Aura + trail visuals
    const auraOn = (this.attackName === 'special') || this._auraFlash > 0;
    this.aura.material.opacity += ((auraOn ? 0.3 : 0) - this.aura.material.opacity) * Math.min(1, dt * 10);
    const k = performance.now() * 0.001;
    const as = 1 + Math.sin(k * 12) * 0.06; this.aura.scale.set(as, as, as);
  }

  _attackProgress() {
    const m = this.attack, t = this.stateT;
    const extendEnd = m.startup + m.active;
    let ext = t < extendEnd ? t / extendEnd : 1 - (t - extendEnd) / m.recovery;
    ext = Math.max(0, Math.min(1, ext));
    return ext * ext * (3 - 2 * ext); // smoothstep
  }

  _animAttack() {
    const e = this._attackProgress();
    const fwd = _v3.set(this.facing, 0, 0); // world forward
    const name = this.attackName;

    if (name === 'kick') {
      this._leanT.x = -0.18 * e; this._leanT.z = this.facing * 0.12 * e;
      // target out in front at shin height
      this.bones.Hips.getWorldPosition(_v1);
      const reach = 0.5 + e * 1.5;
      _v2.copy(_v1).addScaledVector(fwd, reach); _v2.y = _v1.y - 0.1 + e * 0.6;
      this._ik(['RightUpLeg', 'RightLeg'], 'RightFoot', _v2, e * 0.95);
      this._showTrail(this.bones.RightFoot, e);
    } else {
      // punch / special: straight arm strike(s)
      this._leanT.x = -0.12 * e;
      this.bones.Spine2.getWorldPosition(_v1);
      const reach = 0.4 + e * 1.35;
      _v2.copy(_v1).addScaledVector(fwd, reach); _v2.y = _v1.y + 0.05;
      this._ik(['RightArm', 'RightForeArm'], 'RightHand', _v2, e * 0.96);
      if (name === 'special') {
        // second arm thrusts too
        _v2.copy(_v1).addScaledVector(fwd, reach); _v2.y = _v1.y - 0.05;
        this._ik(['LeftArm', 'LeftForeArm'], 'LeftHand', _v2, e * 0.96);
      }
      this._showTrail(this.bones.RightHand, e);
    }
  }

  _animBlock() {
    // ease the guard in
    this._blendW = Math.min(0.9, (this._blendW || 0) + 0.18);
    this._leanT.x = 0.06;
    this.bones.Spine2.getWorldPosition(_v1);
    const fwd = _v3.set(this.facing, 0, 0);
    // both forearms up in front of the face
    _v2.copy(_v1).addScaledVector(fwd, 0.42); _v2.y = _v1.y + 0.35;
    this._ik(['RightArm', 'RightForeArm'], 'RightHand', _v2, this._blendW);
    _v2.copy(_v1).addScaledVector(fwd, 0.42); _v2.y = _v1.y + 0.2;
    this._ik(['LeftArm', 'LeftForeArm'], 'LeftHand', _v2, this._blendW);
  }
  _animJump() {
    // tuck legs up toward the hips
    this.bones.Hips.getWorldPosition(_v1);
    _v2.copy(_v1); _v2.y -= 0.35; _v2.addScaledVector(_v3.set(this.facing, 0, 0), 0.25);
    this._ik(['RightUpLeg', 'RightLeg'], 'RightFoot', _v2, 0.7);
    this._ik(['LeftUpLeg', 'LeftLeg'], 'LeftFoot', _v2, 0.6);
  }

  _showTrail(bone, e) {
    if (!bone || e < 0.3) { this.trail.visible = false; return; }
    bone.getWorldPosition(_v1);
    this.root.worldToLocal(_v1);
    this.trail.visible = true;
    this.trail.position.copy(_v1);
    const s = 0.9 + e * 0.7;
    this.trail.scale.set(s, s, s);
    this.trail.material.opacity = (e - 0.3) * 1.1;
  }

  /* ---------------- CCD inverse kinematics ----------------
     Bends `chain` (root→tip bones) so `endBone` reaches `target`
     (world space). Axis-agnostic: each step rotates a bone by the
     world-space delta that swings the effector toward the target.
     `weight` blends the IK result against the mocap base pose. */
  _ik(chainNames, endName, target, weight) {
    if (weight <= 0.001) return;
    const chain = chainNames.map(n => this.bones[n]);
    const endBone = this.bones[endName];
    if (!endBone || chain.some(b => !b)) return;

    const base = chain.map(b => b.quaternion.clone());
    const ITER = 2;
    for (let it = 0; it < ITER; it++) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const bone = chain[i];
        bone.getWorldPosition(_v1);
        endBone.getWorldPosition(_v2);
        _v2.sub(_v1).normalize();              // current effector dir
        _v3.copy(target).sub(_v1).normalize(); // desired dir
        _q1.setFromUnitVectors(_v2, _v3);       // world delta
        bone.getWorldQuaternion(_q2);
        _q3.copy(_q1).multiply(_q2);            // new world quat
        bone.parent.getWorldQuaternion(_q2);
        bone.quaternion.copy(_q2.invert().multiply(_q3));
        bone.updateWorldMatrix(false, true);
      }
    }
    // blend toward solved pose by weight
    for (let i = 0; i < chain.length; i++) {
      const solved = chain[i].quaternion.clone();
      chain[i].quaternion.copy(base[i]).slerp(solved, Math.min(1, weight));
    }
    chain[0].updateWorldMatrix(false, true);
  }
}
