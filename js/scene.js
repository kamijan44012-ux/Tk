/* ============================================================
   SCENE — Three.js arena, cinematic lighting, dynamic fighting
   camera and bloom post-processing.
   Tuned for stable 60fps: capped DPR, single shadow-casting light,
   modest bloom resolution on mobile.
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 2 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a16);
    this.scene.fog = new THREE.Fog(0x0a0a16, 16, 44);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    this.camera.position.set(0, 1.9, 8);
    this.camera.lookAt(0, 1.05, 0);

    this._buildLights();
    this._buildArena();

    this._shakeT = 0; this._shakeMag = 0;

    // Post-processing: subtle bloom for energy/neon glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.isMobile ? 0.55 : 0.7, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb2ff, 0x2a1f3a, 1.0));

    const key = new THREE.DirectionalLight(0xfff2e6, 2.3);
    key.position.set(5, 12, 8); key.castShadow = true;
    key.shadow.mapSize.set(this.isMobile ? 1024 : 2048, this.isMobile ? 1024 : 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 40;
    key.shadow.camera.left = -10; key.shadow.camera.right = 10;
    key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
    key.shadow.bias = -0.0006;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x6f8cff, 0.5);
    fill.position.set(-6, 6, 4); this.scene.add(fill);

    const rimA = new THREE.PointLight(0xff3b5c, 60, 30, 2); rimA.position.set(-8, 5, -3); this.scene.add(rimA);
    const rimB = new THREE.PointLight(0x2ee6d6, 60, 30, 2); rimB.position.set(8, 5, -3); this.scene.add(rimB);
  }

  _buildArena() {
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x12142a, roughness: 0.55, metalness: 0.4 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 50), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);

    const ring = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.4, 56),
      new THREE.MeshStandardMaterial({ color: 0x20243f, roughness: 0.5, metalness: 0.5 }));
    ring.position.y = -0.2; ring.receiveShadow = true; this.scene.add(ring);

    const edge = new THREE.Mesh(new THREE.TorusGeometry(9.15, 0.13, 14, 70),
      new THREE.MeshBasicMaterial({ color: 0xff3b5c }));
    edge.rotation.x = Math.PI / 2; edge.position.y = 0.04; this.scene.add(edge);
    const edge2 = new THREE.Mesh(new THREE.TorusGeometry(9.4, 0.06, 12, 70),
      new THREE.MeshBasicMaterial({ color: 0x2ee6d6 }));
    edge2.rotation.x = Math.PI / 2; edge2.position.y = 0.02; this.scene.add(edge2);

    // Pillars
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1b1e36, roughness: 0.6, metalness: 0.3 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 9, 12), pillarMat);
      p.position.set(Math.cos(a) * 13, 4.5, Math.sin(a) * 9 - 3); p.castShadow = true; this.scene.add(p);
    }

    // Crowd / backdrop lights
    const group = new THREE.Group();
    const dotGeo = new THREE.SphereGeometry(0.14, 6, 6);
    for (let i = 0; i < 90; i++) {
      const c = Math.random() > 0.5 ? 0x2ee6d6 : 0xff3b5c;
      const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: c }));
      m.position.set((Math.random() - 0.5) * 48, 3 + Math.random() * 10, -16 - Math.random() * 6);
      group.add(m);
    }
    this.scene.add(group); this._crowd = group;
  }

  shake(mag = 0.25, dur = 0.18) { this._shakeMag = Math.max(this._shakeMag, mag); this._shakeT = Math.max(this._shakeT, dur); }

  update(dt, fighterA, fighterB) {
    let baseX = 0, baseZ = 7.5, baseY = 1.9, lookY = 1.05;
    if (fighterA && fighterB) {
      const mid = (fighterA.root.position.x + fighterB.root.position.x) / 2;
      const spread = Math.abs(fighterA.root.position.x - fighterB.root.position.x);
      // pull back as fighters separate so both stay framed
      baseZ = Math.max(6.2, Math.min(13, 6.0 + spread * 0.9));
      baseX = mid * 0.6;
      const maxY = Math.max(fighterA.root.position.y, fighterB.root.position.y);
      baseY = 1.9 + maxY * 0.45;
      lookY = 1.05 + maxY * 0.25;
    }
    this.camera.position.x += (baseX - this.camera.position.x) * Math.min(1, dt * 4);
    this.camera.position.z += (baseZ - this.camera.position.z) * Math.min(1, dt * 3);
    this.camera.position.y += (baseY - this.camera.position.y) * Math.min(1, dt * 4);
    this._lookY = (this._lookY ?? lookY) + (lookY - (this._lookY ?? lookY)) * Math.min(1, dt * 4);

    let ox = 0, oy = 0;
    if (this._shakeT > 0) {
      this._shakeT -= dt;
      const k = Math.max(0, this._shakeT) * this._shakeMag * 14;
      ox = (Math.random() - 0.5) * k; oy = (Math.random() - 0.5) * k;
      if (this._shakeT <= 0) this._shakeMag = 0;
    }
    this.camera.position.x += ox; this.camera.position.y += oy;
    this.camera.lookAt(this.camera.position.x - ox, this._lookY, 0);

    if (this._crowd) this._crowd.rotation.z = Math.sin(performance.now() * 0.0008) * 0.02;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  render() { this.composer.render(); }
}
