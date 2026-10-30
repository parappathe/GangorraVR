// Three.js de verdade, com um WebGLRenderer de mentira (para o teste de fumaça rodar no Node).
import * as THREE from '../vendor/three/three.module.js';
export * from '../vendor/three/three.module.js';

class FakeXR extends THREE.EventDispatcher {
  constructor() { super(); this.enabled = false; this.isPresenting = false; this._c = []; this._g = []; this._h = []; }
  setReferenceSpaceType() {}
  setFoveation() {}
  getController(i) { return (this._c[i] ||= new THREE.Group()); }
  getControllerGrip(i) { return (this._g[i] ||= new THREE.Group()); }
  getHand(i) { return (this._h[i] ||= Object.assign(new THREE.Group(), { joints: {} })); }
  getSession() { return null; }
}

export class WebGLRenderer {
  constructor() {
    this.domElement = document.createElement('canvas');
    this.xr = new FakeXR();
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.renders = 0;
    this._loop = null;
  }
  setPixelRatio() {}
  setSize() {}
  setAnimationLoop(f) { this._loop = f; }
  render(scene, camera) { scene.updateMatrixWorld(); camera.updateMatrixWorld(); this.renders++; }
  setRenderTarget() {}
  getRenderTarget() { return null; }
  dispose() {}
}
