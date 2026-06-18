/* ============================================================
   ASSETS — preloads the rigged 3D character (glTF/GLB) once and
   provides skeleton-cloned instances for each fighter.
   The model is a real Mixamo-rigged human ("Vanguard" soldier)
   with genuine motion-capture Idle / Walk / Run clips.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = 'assets/models/Soldier.glb';

class AssetManager {
  constructor() {
    this.gltf = null;
    this.clips = {};       // name -> AnimationClip
    this.ready = false;
  }

  /* Load once. onProgress(0..1) drives the loading bar. */
  load(onProgress) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        MODEL_URL,
        (gltf) => {
          this.gltf = gltf;
          for (const clip of gltf.animations) this.clips[clip.name] = clip;
          // Normalise materials for nicer lighting & allow per-fighter tint.
          gltf.scene.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
              o.frustumCulled = false; // characters are always near camera
              if (o.material) {
                o.material = o.material.clone();
                o.material.roughness = 0.65;
                o.material.metalness = 0.05;
              }
            }
          });
          this.ready = true;
          resolve(this);
        },
        (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); },
        (err) => reject(err)
      );
    });
  }

  /* Returns { root, bones, mixer, actions } for a new fighter instance.
     Uses SkeletonUtils.clone so each instance has an independent skeleton. */
  createInstance(tint) {
    const model = skeletonClone(this.gltf.scene);

    // Tint the body so the two fighters read differently (palette swap).
    model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        if (tint !== undefined) o.material.color.lerp(new THREE.Color(tint), 0.55);
      }
    });

    // The model is authored at a good human height (~1.6 units) and
    // already stands on the floor, so we keep native scale and only
    // nudge the feet flush to y=0. (Box3.setFromObject is unreliable
    // for SkinnedMesh, so we use this measured constant instead.)
    const scale = 1.0;
    model.position.y -= 0.12;

    // Collect the Mixamo bones we drive procedurally.
    // Three.js sanitises node names and strips the ':' so bones arrive
    // as "mixamorigHips" — normalise to "Hips", "RightHand", etc.
    const bones = {};
    model.traverse((o) => {
      if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o;
    });

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const name of ['Idle', 'Walk', 'Run']) {
      if (this.clips[name]) {
        actions[name] = mixer.clipAction(this.clips[name]);
        actions[name].play();
        actions[name].setEffectiveWeight(name === 'Idle' ? 1 : 0);
      }
    }
    return { model, bones, mixer, actions, scale };
  }
}

export const assets = new AssetManager();
