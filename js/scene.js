/* ============================================================
   SCENE — Three.js arena, lighting, camera & post niceties.
   Kept lightweight (primitive geometry, baked-feel lighting,
   capped pixel ratio) for stable 60fps on mid-range Android.
   ============================================================ */
import * as THREE from 'three';

export class Arena {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance'
    });
    // Cap DPR: huge perf win on high-density phone screens.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0a16, 14, 40);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 3.2, 11);
    this.camera.lookAt(0, 1.6, 0);

    this._buildLights();
    this._buildArena();
    this._shakeT = 0;
    this._shakeMag = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x9fb4ff, 0x20102a, 0.8);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(5, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1; key.shadow.camera.far = 40;
    key.shadow.camera.left = -12; key.shadow.camera.right = 12;
    key.shadow.camera.top = 12; key.shadow.camera.bottom = -12;
    key.shadow.bias = -0.0008;
    this.scene.add(key);

    // Coloured rim lights for that "arena" stylized look
    const rimA = new THREE.PointLight(0xff3b5c, 0.9, 30); rimA.position.set(-9, 4, -2); this.scene.add(rimA);
    const rimB = new THREE.PointLight(0x2ee6d6, 0.9, 30); rimB.position.set(9, 4, -2); this.scene.add(rimB);
  }

  _buildArena() {
    // Floor
    const floorGeo = new THREE.PlaneGeometry(60, 30);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x16182b, roughness: 0.85, metalness: 0.1 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Fight ring (stylized platform disc)
    const ringGeo = new THREE.CylinderGeometry(9, 9.4, 0.4, 48);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x23263f, roughness: 0.7, metalness: 0.25 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = -0.2; ring.receiveShadow = true;
    this.scene.add(ring);

    // Glowing edge accent
    const edgeGeo = new THREE.TorusGeometry(9.1, 0.12, 12, 60);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xff3b5c });
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.rotation.x = Math.PI / 2; edge.position.y = 0.02;
    this.scene.add(edge);

    // Back wall grid of "crowd lights"
    const group = new THREE.Group();
    const dotGeo = new THREE.SphereGeometry(0.12, 6, 6);
    for (let i = 0; i < 60; i++) {
      const c = Math.random() > 0.5 ? 0x2ee6d6 : 0xff3b5c;
      const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: c }));
      m.position.set((Math.random() - 0.5) * 40, 3 + Math.random() * 8, -14 - Math.random() * 4);
      group.add(m);
    }
    this.scene.add(group);
    this._crowd = group;
  }

  /* Camera shake on heavy hits */
  shake(mag = 0.25, dur = 0.18) { this._shakeMag = mag; this._shakeT = dur; }

  update(dt, fighterA, fighterB) {
    // Dynamic camera: frame both fighters, ease toward midpoint & spread
    if (fighterA && fighterB) {
      const mid = (fighterA.root.position.x + fighterB.root.position.x) / 2;
      const spread = Math.abs(fighterA.root.position.x - fighterB.root.position.x);
      const targetZ = 9.5 + spread * 0.55;
      const targetX = mid * 0.5;
      this.camera.position.x += (targetX - this.camera.position.x) * Math.min(1, dt * 4);
      this.camera.position.z += (targetZ - this.camera.position.z) * Math.min(1, dt * 3);
    }
    // Apply shake offset
    let ox = 0, oy = 0;
    if (this._shakeT > 0) {
      this._shakeT -= dt;
      const k = Math.max(0, this._shakeT) * this._shakeMag * 12;
      ox = (Math.random() - 0.5) * k; oy = (Math.random() - 0.5) * k;
    }
    this.camera.position.y = 3.2 + oy;
    this.camera.lookAt(this.camera.position.x - ox * 0.3, 1.6, 0);

    // gentle crowd shimmer
    if (this._crowd) this._crowd.rotation.z = Math.sin(performance.now() * 0.0008) * 0.02;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
