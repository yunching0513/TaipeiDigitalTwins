// 3D 數位孿生場景：WebGL 渲染 46,000+ 棟建築、河川、霓虹路網、分區圖層
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ZONES, RIVERS, project, projectRing, ringCentroid } from "./geo.js";
import { generateCity, generateRoads } from "./procgen.js";
import { colorForRGB, METRICS } from "./constants.js";

const BG = 0x0a0e18;
const CONTEXT_COLOR = new THREE.Color(0x2a3752);

export class TwinScene {
  constructor(container, { onZoneClick } = {}) {
    this.container = container;
    this.onZoneClick = onZoneClick;
    this.pulses = new Map(); // zoneId -> start time
    this.selectedZone = null;
    this.disposed = false;
    this.usingOSM = false;
    this.osmChunks = [];

    const w = container.clientWidth, h = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.FogExp2(BG, 0.00006);

    this.camera = new THREE.PerspectiveCamera(52, w / h, 10, 60000);
    this.camera.position.set(-800, 4600, 5900);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-300, 0, 500);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.48;
    this.controls.minDistance = 300;
    this.controls.maxDistance = 20000;

    this.scene.add(new THREE.AmbientLight(0x93a4c9, 0.55));
    const dir = new THREE.DirectionalLight(0xdfe8ff, 1.15);
    dir.position.set(2000, 4500, 1500);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x4fa3c7, 0.35);
    dir2.position.set(-3000, 2000, -2500);
    this.scene.add(dir2);

    this._buildGround();
    this._buildRivers();
    this._buildRoads();
    this._buildZones();
    this._buildProceduralCity();
    this._setupPicking();

    // Bloom 後製：霓虹光暈
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.85, 0.32);
    this.composer.addPass(this.bloom);

    this.resizeObserver = new ResizeObserver(() => this._onResize());
    this.resizeObserver.observe(container);

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  // ---------- 場景元素 ----------

  _buildGround() {
    const geo = new THREE.PlaneGeometry(50000, 50000);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0b101c });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -2;
    this.scene.add(mesh);
  }

  _buildRivers() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1d6a94, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    });
    this.riverMat = mat;
    for (const river of RIVERS) {
      const pts = river.line.map(([lon, lat]) => project(lon, lat));
      const geo = this._ribbonGeometry(pts, river.width);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.5;
      this.scene.add(mesh);
    }
  }

  _ribbonGeometry(pts, width) {
    const half = width / 2;
    const positions = [];
    const index = [];
    const normals = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const [px, pz] = pts[Math.max(0, i - 1)];
      const [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
      let dx = nx - px, dz = nz - pz;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      // 法向量（左手）
      const ox = -dz * half, oz = dx * half;
      positions.push(x + ox, 0, z + oz, x - ox, 0, z - oz);
      normals.push(0, 1, 0, 0, 1, 0);
      if (i > 0) {
        const a = (i - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(index);
    return geo;
  }

  _buildRoads() {
    const flat = generateRoads();
    const positions = new Float32Array((flat.length / 4) * 6);
    for (let i = 0, j = 0; i < flat.length; i += 4) {
      positions[j++] = flat[i];     positions[j++] = 1.2; positions[j++] = flat[i + 1];
      positions[j++] = flat[i + 2]; positions[j++] = 1.2; positions[j++] = flat[i + 3];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x2e86ab, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.scene.add(new THREE.LineSegments(geo, mat));
  }

  _buildZones() {
    this.zoneGrounds = [];
    this.zoneOutlines = [];
    this.zoneLabels = [];

    ZONES.forEach((zone, zi) => {
      const ring2d = projectRing(zone.ring);

      // 分區地面填色（也是點擊目標）
      const shape = new THREE.Shape(ring2d.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x4fa3c7, transparent: true, opacity: 0.1, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.8;
      mesh.userData = { zoneId: zone.id, zoneIndex: zi };
      this.scene.add(mesh);
      this.zoneGrounds.push(mesh);

      // 分區外框線
      const linePts = [...ring2d, ring2d[0]].map(([x, z]) => new THREE.Vector3(x, 2.5, z));
      const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x4fa3c7, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      this.scene.add(line);
      this.zoneOutlines.push(line);

      // 分區標籤
      const [cx, cz] = ringCentroid(ring2d);
      const label = this._makeLabel(zone.name, "");
      label.position.set(cx, zone.id === "bstp" ? 380 : 300, cz);
      this.scene.add(label);
      this.zoneLabels.push(label);
    });
  }

  _makeLabel(name, value) {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, depthTest: false,
    }));
    sprite.scale.set(760, 304, 1);
    sprite.renderOrder = 10;
    sprite.userData = { canvas, texture, name };
    this._drawLabel(sprite, value);
    return sprite;
  }

  _drawLabel(sprite, value, highlight = false) {
    const { canvas, texture, name } = sprite.userData;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = highlight ? "#ffe9c2" : "#edeae2";
    ctx.font = "700 40px 'Noto Sans TC', sans-serif";
    ctx.fillText(name, 160, 56);
    if (value) {
      ctx.fillStyle = "#9fd8ef";
      ctx.font = "500 30px 'IBM Plex Mono', monospace";
      ctx.fillText(value, 160, 100);
    }
    texture.needsUpdate = true;
  }

  _buildProceduralCity() {
    const { buildings, zoneOf, count } = generateCity();
    this.zoneOf = zoneOf;
    this.jitters = new Float32Array(count);

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0); // 底部貼地
    const mat = new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(box, mat, count);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const color = new THREE.Color(0x334463);

    for (let i = 0; i < count; i++) {
      const b = buildings[i];
      q.setFromAxisAngle(up, -b.rot);
      pos.set(b.x, 0, b.z);
      scl.set(b.w, b.h, b.d);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color);
      this.jitters[i] = b.jitter;
    }
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    this.cityMesh = mesh;
    this.buildingCount = count;
  }

  // ---------- 指標著色 ----------

  // metric: 圖層鍵；state: {zones: {...}}
  setMetricState(metric, state) {
    this.metric = metric;
    this.state = state;

    const zoneColors = ZONES.map((z) => {
      const [r, g, b] = colorForRGB(metric, state.zones[z.id][metric]);
      return new THREE.Color(r, g, b);
    });

    // 分區地面與標籤
    const unit = METRICS[metric].unit;
    ZONES.forEach((z, zi) => {
      this.zoneGrounds[zi].material.color.copy(zoneColors[zi]);
      this.zoneGrounds[zi].material.opacity = 0.13;
      this._drawLabel(
        this.zoneLabels[zi],
        `${state.zones[z.id][metric]} ${unit}`,
        this.selectedZone === z.id
      );
    });

    // 建築著色
    const c = new THREE.Color();
    if (!this.usingOSM && this.cityMesh) {
      for (let i = 0; i < this.buildingCount; i++) {
        const zi = this.zoneOf[i];
        if (zi === -1) {
          c.copy(CONTEXT_COLOR).multiplyScalar(this.jitters[i]);
        } else {
          c.copy(zoneColors[zi]).multiplyScalar(this.jitters[i]);
        }
        this.cityMesh.setColorAt(i, c);
      }
      this.cityMesh.instanceColor.needsUpdate = true;
    }
    // OSM 建築著色（頂點色區段）
    for (const chunk of this.osmChunks) {
      const attr = chunk.mesh.geometry.getAttribute("color");
      for (const rec of chunk.ranges) {
        if (rec.zone === -1) c.copy(CONTEXT_COLOR).multiplyScalar(rec.jitter);
        else c.copy(zoneColors[rec.zone]).multiplyScalar(rec.jitter);
        for (let v = rec.start; v < rec.start + rec.count; v++) {
          attr.setXYZ(v, c.r, c.g, c.b);
        }
      }
      attr.needsUpdate = true;
    }
  }

  setSelectedZone(zoneId) {
    this.selectedZone = zoneId;
    ZONES.forEach((z, zi) => {
      const sel = z.id === zoneId;
      this.zoneOutlines[zi].material.color.set(sel ? 0xffe9c2 : 0x4fa3c7);
      this.zoneOutlines[zi].material.opacity = sel ? 0.95 : 0.5;
    });
    if (this.metric && this.state) this.setMetricState(this.metric, this.state);
  }

  pulseZones(zoneIds) {
    const now = performance.now();
    for (const id of zoneIds) this.pulses.set(id, now);
  }

  // 鏡頭飛到指定分區
  flyToZone(zoneId) {
    const zi = ZONES.findIndex((z) => z.id === zoneId);
    if (zi === -1) return;
    const [cx, cz] = ringCentroid(projectRing(ZONES[zi].ring));
    this._flyTarget = { x: cx, z: cz, t: 0 };
  }

  resetCamera() {
    this.camera.position.set(-800, 4600, 5900);
    this.controls.target.set(-300, 0, 500);
  }

  // ---------- OSM 真實建築 ----------

  // list: [{ ring: [[x,z],...], h, zone, jitter }]
  setOSMBuildings(list) {
    if (this.cityMesh) {
      this.cityMesh.visible = false;
    }
    for (const chunk of this.osmChunks) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
    this.osmChunks = [];

    const CHUNK = 2000;
    for (let start = 0; start < list.length; start += CHUNK) {
      const slice = list.slice(start, start + CHUNK);
      const chunk = this._buildOSMChunk(slice);
      if (chunk) {
        this.scene.add(chunk.mesh);
        this.osmChunks.push(chunk);
      }
    }
    this.usingOSM = true;
    this.buildingCount = list.length;
    if (this.metric && this.state) this.setMetricState(this.metric, this.state);
  }

  _buildOSMChunk(buildings) {
    const positions = [];
    const colors = [];
    const index = [];
    const ranges = [];

    for (const b of buildings) {
      const ring = b.ring;
      const n = ring.length;
      if (n < 3) continue;
      const vStart = positions.length / 3;
      const cStart = vStart;

      // 牆面
      for (let i = 0; i < n; i++) {
        const [x1, z1] = ring[i];
        const [x2, z2] = ring[(i + 1) % n];
        const base = positions.length / 3;
        positions.push(x1, 0, z1, x2, 0, z2, x2, b.h, z2, x1, b.h, z1);
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      // 屋頂（三角化）
      const pts2 = ring.map(([x, z]) => new THREE.Vector2(x, -z));
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(pts2, []); } catch { tris = []; }
      const roofBase = positions.length / 3;
      for (const [x, z] of ring) positions.push(x, b.h, z);
      for (const t of tris) index.push(roofBase + t[0], roofBase + t[2], roofBase + t[1]);

      const vCount = positions.length / 3 - cStart;
      for (let v = 0; v < vCount; v++) colors.push(0.2, 0.27, 0.4);
      ranges.push({ start: cStart, count: vCount, zone: b.zone, jitter: b.jitter });
    }

    if (!positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    return { mesh: new THREE.Mesh(geo, mat), ranges };
  }

  // ---------- 互動 ----------

  _setupPicking() {
    this.raycaster = new THREE.Raycaster();
    this._down = null;
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      this._down = [e.clientX, e.clientY];
    });
    el.addEventListener("pointerup", (e) => {
      if (!this._down) return;
      const [dx, dy] = [e.clientX - this._down[0], e.clientY - this._down[1]];
      this._down = null;
      if (Math.hypot(dx, dy) > 6) return; // 拖曳鏡頭時不觸發
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      const hits = this.raycaster.intersectObjects(this.zoneGrounds, false);
      if (hits.length && this.onZoneClick) {
        this.onZoneClick(hits[0].object.userData.zoneId);
      }
    });
  }

  _onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  _tick() {
    if (this.disposed) return;
    const dt = this.clock.getDelta();
    this.controls.update();

    // 鏡頭飛行
    if (this._flyTarget) {
      const f = this._flyTarget;
      f.t += dt * 1.6;
      const k = Math.min(1, f.t);
      const ease = 1 - Math.pow(1 - k, 3);
      this.controls.target.x += (f.x - this.controls.target.x) * ease * 0.12;
      this.controls.target.z += (f.z - this.controls.target.z) * ease * 0.12;
      const want = new THREE.Vector3(f.x + 300, 1600, f.z + 2200);
      this.camera.position.lerp(want, 0.045);
      if (k >= 1 && this.camera.position.distanceTo(want) < 80) this._flyTarget = null;
    }

    // 事件脈衝：分區外框閃爍
    const now = performance.now();
    for (const [zoneId, t0] of this.pulses) {
      const age = (now - t0) / 1000;
      const zi = ZONES.findIndex((z) => z.id === zoneId);
      if (zi === -1) continue;
      if (age > 4) {
        this.pulses.delete(zoneId);
        this.setSelectedZone(this.selectedZone);
        continue;
      }
      const s = 0.5 + 0.5 * Math.sin(age * 10);
      this.zoneOutlines[zi].material.color.setRGB(1, 0.55 + 0.45 * s, 0.3 * s);
      this.zoneOutlines[zi].material.opacity = 0.55 + 0.45 * s;
    }

    this.composer.render();
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
