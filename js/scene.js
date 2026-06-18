/* ============================================================
   SCENE — night-time fighting arena (Tekken-style), cinematic
   lighting, dynamic camera and bloom.

   Built procedurally (canvas textures, no external images):
     • night sky gradient + stars + moon
     • large tiled stone ground
     • raised octagonal stage platform with glowing trim
     • flickering torch lanterns (warm light + bloom glow)
     • distant city/temple silhouette backdrop
   ============================================================ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Arena {
  constructor(canvas) {
    this.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.isMobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.scene = new THREE.Scene();
    this.scene.background = this._makeSky();
    this.scene.fog = new THREE.Fog(0x0a1020, 18, 60);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, 1.8, 7);
    this.camera.lookAt(0, 1.0, 0);

    this._torches = [];
    this._buildLights();
    this._buildArena();

    this._shakeT = 0; this._shakeMag = 0; this._lookY = 1.0;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.isMobile ? 0.7 : 0.9, 0.7, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /* ---------- procedural textures ---------- */
  _makeSky() {
    const c = document.createElement('canvas'); c.width = 16; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, '#05060f');
    g.addColorStop(0.55, '#0b1228');
    g.addColorStop(0.8, '#1a2046');
    g.addColorStop(1.0, '#2a2740');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _makeStoneTexture(repeat) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#23262f'; ctx.fillRect(0, 0, 512, 512);
    // subtle noise
    for (let i = 0; i < 9000; i++) {
      const v = 20 + Math.random() * 50;
      ctx.fillStyle = `rgba(${v},${v + 4},${v + 12},${Math.random() * 0.4})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    // tile grid
    ctx.strokeStyle = 'rgba(8,9,14,0.9)'; ctx.lineWidth = 4;
    const step = 128;
    for (let x = 0; x <= 512; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
    for (let y = 0; y <= 512; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
    // bevel highlights
    ctx.strokeStyle = 'rgba(120,130,160,0.12)'; ctx.lineWidth = 1;
    for (let x = 0; x <= 512; x += step) { ctx.beginPath(); ctx.moveTo(x + 2, 0); ctx.lineTo(x + 2, 512); ctx.stroke(); }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _buildLights() {
    // Cool moonlight ambience
    this.scene.add(new THREE.HemisphereLight(0x5870b0, 0x12101c, 0.7));

    // Moon key light (cool, casts shadows)
    const moon = new THREE.DirectionalLight(0xbcd0ff, 1.5);
    moon.position.set(-6, 14, 6); moon.castShadow = true;
    moon.shadow.mapSize.set(this.isMobile ? 1024 : 2048, this.isMobile ? 1024 : 2048);
    moon.shadow.camera.near = 1; moon.shadow.camera.far = 50;
    moon.shadow.camera.left = -12; moon.shadow.camera.right = 12;
    moon.shadow.camera.top = 12; moon.shadow.camera.bottom = -12;
    moon.shadow.bias = -0.0006;
    this.scene.add(moon);

    // Warm fill so characters don't go fully blue
    const warm = new THREE.DirectionalLight(0xffb066, 0.95);
    warm.position.set(7, 5, 5); this.scene.add(warm);
  }

  _buildArena() {
    // --- Ground (large tiled stone) ---
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ map: this._makeStoneTexture(28), roughness: 0.9, metalness: 0.1, color: 0x9aa0b0 })
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true;
    this.scene.add(ground);

    // --- Raised octagonal stage platform ---
    const platMat = new THREE.MeshStandardMaterial({ map: this._makeStoneTexture(6), roughness: 0.8, metalness: 0.15, color: 0xb0b6c6 });
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.4, 0.5, 8), platMat);
    plat.position.y = -0.25; plat.rotation.y = Math.PI / 8; plat.receiveShadow = true; this.scene.add(plat);

    // glowing trim ring
    const trim = new THREE.Mesh(new THREE.TorusGeometry(9.6, 0.10, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffaa33 }));
    trim.rotation.x = Math.PI / 2; trim.rotation.z = Math.PI / 8; trim.position.y = 0.02; this.scene.add(trim);

    // --- Low surrounding wall / railing ---
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1d2c, roughness: 0.8, metalness: 0.2 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.1, 0.4), wallMat);
      seg.position.set(Math.cos(a) * 10.2, 0.3, Math.sin(a) * 10.2);
      seg.lookAt(0, 0.3, 0); seg.castShadow = true; seg.receiveShadow = true; this.scene.add(seg);
    }

    // --- Torch lanterns (warm flicker + bloom glow) ---
    const postMat = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.7 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = Math.cos(a) * 11.2, pz = Math.sin(a) * 11.2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.2, 8), postMat);
      post.position.set(px, 1.6, pz); post.castShadow = true; this.scene.add(post);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffb24d }));
      flame.position.set(px, 3.4, pz); this.scene.add(flame);
      const light = new THREE.PointLight(0xff8a2a, 14, 22, 2);
      light.position.set(px, 3.4, pz); this.scene.add(light);
      this._torches.push({ light, flame, base: 14, phase: Math.random() * 10 });
    }

    // --- Moon disc with glow ---
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(3.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff }));
    moonDisc.position.set(15, 11, -32); this.scene.add(moonDisc);
    const moonGlow = new THREE.Mesh(new THREE.CircleGeometry(4.8, 32),
      new THREE.MeshBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.25 }));
    moonGlow.position.set(15, 11, -32.1); this.scene.add(moonGlow);

    // --- Distant temple/city silhouette backdrop ---
    const sil = new THREE.Group();
    const silMat = new THREE.MeshBasicMaterial({ color: 0x070a16 });
    for (let i = 0; i < 26; i++) {
      const w = 1.2 + Math.random() * 3, h = 3 + Math.random() * 12;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1), silMat);
      b.position.set(-34 + i * 2.7, h / 2, -34 - Math.random() * 5);
      sil.add(b);
    }
    this.scene.add(sil);

    // --- Stars ---
    const starGeo = new THREE.BufferGeometry();
    const N = 220, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = 14 + Math.random() * 40;
      pos[i * 3 + 2] = -30 - Math.random() * 30;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.22, sizeAttenuation: true }));
    this.scene.add(stars);
  }

  shake(mag = 0.25, dur = 0.18) { this._shakeMag = Math.max(this._shakeMag, mag); this._shakeT = Math.max(this._shakeT, dur); }

  update(dt, fighterA, fighterB) {
    // flicker torches
    const t = performance.now() * 0.001;
    for (const tr of this._torches) {
      const f = 0.75 + Math.sin(t * 11 + tr.phase) * 0.15 + Math.sin(t * 23 + tr.phase) * 0.1;
      tr.light.intensity = tr.base * f;
      const s = 0.85 + f * 0.3; tr.flame.scale.set(s, s + Math.sin(t * 30 + tr.phase) * 0.1, s);
    }

    let baseX = 0, baseZ = 7, baseY = 1.8, lookY = 1.0;
    if (fighterA && fighterB) {
      const mid = (fighterA.root.position.x + fighterB.root.position.x) / 2;
      const spread = Math.abs(fighterA.root.position.x - fighterB.root.position.x);
      baseZ = Math.max(5.6, Math.min(12, 5.4 + spread * 0.85));
      baseX = mid * 0.6;
      const maxY = Math.max(fighterA.root.position.y, fighterB.root.position.y);
      baseY = 1.75 + maxY * 0.45;
      lookY = 1.0 + maxY * 0.25;
    }
    this.camera.position.x += (baseX - this.camera.position.x) * Math.min(1, dt * 4);
    this.camera.position.z += (baseZ - this.camera.position.z) * Math.min(1, dt * 3);
    this.camera.position.y += (baseY - this.camera.position.y) * Math.min(1, dt * 4);
    this._lookY += (lookY - this._lookY) * Math.min(1, dt * 4);

    let ox = 0, oy = 0;
    if (this._shakeT > 0) {
      this._shakeT -= dt;
      const k = Math.max(0, this._shakeT) * this._shakeMag * 14;
      ox = (Math.random() - 0.5) * k; oy = (Math.random() - 0.5) * k;
      if (this._shakeT <= 0) this._shakeMag = 0;
    }
    this.camera.position.x += ox; this.camera.position.y += oy;
    this.camera.lookAt(this.camera.position.x - ox, this._lookY, 0);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  render() { this.composer.render(); }
}
