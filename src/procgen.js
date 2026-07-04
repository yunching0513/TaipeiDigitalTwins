// 程序化城市生成：依各分區的都市紋理密度／高度分布，生成約 46,000 棟建築
import { ZONES, CONTEXT_AREAS, projectRing, pointInRing, ringBBox } from "./geo.js";

// 可重現的偽隨機數（mulberry32）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 各分區都市紋理參數：cell=街廓網格(公尺)、cover=建蔽機率、高度(公尺)
const ZONE_PARAMS = {
  shilin:   { cell: 17, cover: 0.72, hMin: 9,  hMax: 22, tower: 0.04, tMin: 30, tMax: 75, fill: 0.62 },
  beitou:   { cell: 21, cover: 0.52, hMin: 8,  hMax: 24, tower: 0.03, tMin: 28, tMax: 60, fill: 0.6 },
  shezidao: { cell: 24, cover: 0.46, hMin: 4,  hMax: 12, tower: 0.002, tMin: 15, tMax: 24, fill: 0.55 },
  zhoumei:  { cell: 24, cover: 0.44, hMin: 6,  hMax: 15, tower: 0.01, tMin: 20, tMax: 35, fill: 0.55 },
  bstp:     { cell: 55, cover: 0.55, hMin: 18, hMax: 55, tower: 0.12, tMin: 60, tMax: 95, fill: 0.62 },
  guandu:   { cell: 75, cover: 0.13, hMin: 4,  hMax: 9,  tower: 0,    tMin: 0,  tMax: 0,  fill: 0.28 },
};

const CONTEXT_PARAMS = { cell: 23, cover: 0.43, hMin: 8, hMax: 26, tower: 0.035, tMin: 30, tMax: 80, fill: 0.6 };

// 產生單一多邊形內的建築。回傳 {x,z,w,d,h,rot,jitter}[]
function fillArea(ring2d, params, gridAngle, rng) {
  const out = [];
  const { minX, maxX, minZ, maxZ } = ringBBox(ring2d);
  const cos = Math.cos(gridAngle);
  const sin = Math.sin(gridAngle);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const halfW = Math.max(maxX - minX, maxZ - minZ) * 0.72;
  const cell = params.cell;

  for (let gu = -halfW; gu <= halfW; gu += cell) {
    for (let gv = -halfW; gv <= halfW; gv += cell) {
      if (rng() > params.cover) continue;
      // 旋轉網格 → 世界座標，加上格內抖動
      const ju = (rng() - 0.5) * cell * 0.3;
      const jv = (rng() - 0.5) * cell * 0.3;
      const u = gu + ju, v = gv + jv;
      const x = cx + u * cos - v * sin;
      const z = cz + u * sin + v * cos;
      if (!pointInRing(x, z, ring2d)) continue;

      const isTower = rng() < params.tower;
      const h = isTower
        ? params.tMin + rng() * (params.tMax - params.tMin)
        : params.hMin + rng() * (params.hMax - params.hMin);
      const base = cell * params.fill;
      const w = base * (0.7 + rng() * 0.6);
      const d = base * (0.7 + rng() * 0.6);
      out.push({
        x, z, w, d, h,
        rot: gridAngle + (rng() - 0.5) * 0.06,
        jitter: 0.72 + rng() * 0.56, // 顏色亮度變化
      });
    }
  }
  return out;
}

// 產生全城建築。回傳 { buildings, zoneOf, count }
// buildings: 扁平陣列；zoneOf[i] = 分區索引（-1 為周邊城區）
export function generateCity(seed = 20260704) {
  const rng = mulberry32(seed);
  const buildings = [];
  const zoneOf = [];

  ZONES.forEach((zone, zi) => {
    const ring2d = projectRing(zone.ring);
    const list = fillArea(ring2d, ZONE_PARAMS[zone.id], zone.gridAngle, rng);
    for (const b of list) { buildings.push(b); zoneOf.push(zi); }
  });

  for (const area of CONTEXT_AREAS) {
    const ring2d = projectRing(area.ring);
    const list = fillArea(ring2d, CONTEXT_PARAMS, area.gridAngle, rng);
    for (const b of list) { buildings.push(b); zoneOf.push(-1); }
  }

  return { buildings, zoneOf, count: buildings.length };
}

// 產生分區內的霓虹路網線段（依生成網格）。回傳扁平頂點座標 [x1,z1,x2,z2,...]
export function generateRoads() {
  const segs = [];
  const areas = [
    ...ZONES.map((z) => ({ ring: z.ring, angle: z.gridAngle, step: ZONE_PARAMS[z.id].cell * 3 })),
    ...CONTEXT_AREAS.map((a) => ({ ring: a.ring, angle: a.gridAngle, step: CONTEXT_PARAMS.cell * 3.5 })),
  ];
  for (const area of areas) {
    const ring2d = projectRing(area.ring);
    const { minX, maxX, minZ, maxZ } = ringBBox(ring2d);
    const cos = Math.cos(area.angle);
    const sin = Math.sin(area.angle);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const halfW = Math.max(maxX - minX, maxZ - minZ) * 0.72;
    const sample = 30;

    for (let dir = 0; dir < 2; dir++) {
      for (let g = -halfW; g <= halfW; g += area.step) {
        let prevIn = false, sx = 0, sz = 0, px = 0, pz = 0;
        for (let t = -halfW; t <= halfW + sample; t += sample) {
          const u = dir === 0 ? g : t;
          const v = dir === 0 ? t : g;
          const x = cx + u * cos - v * sin;
          const z = cz + u * sin + v * cos;
          const inside = t <= halfW && pointInRing(x, z, ring2d);
          if (inside && !prevIn) { sx = x; sz = z; }
          if (!inside && prevIn) { segs.push(sx, sz, px, pz); }
          prevIn = inside; px = x; pz = z;
        }
      }
    }
  }
  return segs;
}
