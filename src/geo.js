// 台北市北區地理資料：分區多邊形（經緯度近似）、河川、平面投影

// 投影原點（士林／北士科一帶中心）
const LON0 = 121.5;
const LAT0 = 25.105;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const M_PER_DEG_LAT = 110540;

// 經緯度 → 場景座標（公尺）。x 向東、z 向南（配合 three.js 慣例）
export function project(lon, lat) {
  return [
    (lon - LON0) * M_PER_DEG_LON,
    -(lat - LAT0) * M_PER_DEG_LAT,
  ];
}

// 六大分區（近似真實地理形狀，逆時針經緯度環）
export const ZONES = [
  {
    id: "bstp", name: "北士科園區", gridAngle: 0.28,
    ring: [
      [121.503, 25.112], [121.509, 25.122], [121.517, 25.124],
      [121.524, 25.118], [121.521, 25.106], [121.513, 25.108],
    ],
  },
  {
    id: "zhoumei", name: "洲美", gridAngle: 0.28,
    ring: [
      [121.496, 25.099], [121.5, 25.11], [121.503, 25.112],
      [121.513, 25.108], [121.514, 25.096], [121.504, 25.091],
    ],
  },
  {
    id: "shezidao", name: "社子島", gridAngle: -0.55,
    ring: [
      [121.464, 25.109], [121.478, 25.105], [121.492, 25.096],
      [121.498, 25.084], [121.489, 25.078], [121.475, 25.086],
      [121.466, 25.098],
    ],
  },
  {
    id: "guandu", name: "關渡平原", gridAngle: 0.1,
    ring: [
      [121.462, 25.124], [121.468, 25.143], [121.484, 25.15],
      [121.499, 25.145], [121.503, 25.13], [121.494, 25.12],
      [121.475, 25.116],
    ],
  },
  {
    id: "shilin", name: "士林市街", gridAngle: 0.12,
    ring: [
      [121.51, 25.09], [121.514, 25.096], [121.524, 25.101],
      [121.534, 25.097], [121.536, 25.084], [121.525, 25.075],
      [121.512, 25.079],
    ],
  },
  {
    id: "beitou", name: "北投", gridAngle: 0.35,
    ring: [
      [121.494, 25.148], [121.5, 25.16], [121.514, 25.163],
      [121.525, 25.152], [121.521, 25.136], [121.507, 25.132],
      [121.499, 25.137],
    ],
  },
];

// 周邊城區（提供城市脈絡的中性建築，不參與模擬指標）
export const CONTEXT_AREAS = [
  { // 天母
    id: "tianmu", gridAngle: 0.05,
    ring: [
      [121.522, 25.106], [121.524, 25.13], [121.537, 25.136],
      [121.548, 25.124], [121.546, 25.104], [121.536, 25.098],
    ],
  },
  { // 士林南側／大同・圓山一帶
    id: "south", gridAngle: 0.1,
    ring: [
      [121.5, 25.056], [121.5, 25.074], [121.512, 25.078],
      [121.526, 25.073], [121.544, 25.075], [121.548, 25.058],
      [121.522, 25.052],
    ],
  },
  { // 石牌・榮總一帶（北投與北士科之間）
    id: "shipai", gridAngle: 0.3,
    ring: [
      [121.509, 25.122], [121.512, 25.13], [121.521, 25.136],
      [121.523, 25.124], [121.517, 25.124],
    ],
  },
];

// 河川（中心線經緯度 + 寬度公尺）
export const RIVERS = [
  {
    name: "淡水河", width: 480,
    line: [
      [121.452, 25.148], [121.456, 25.132], [121.459, 25.118],
      [121.462, 25.106], [121.466, 25.09], [121.468, 25.074],
      [121.47, 25.056],
    ],
  },
  {
    name: "基隆河", width: 190,
    line: [
      [121.552, 25.066], [121.534, 25.069], [121.516, 25.073],
      [121.503, 25.078], [121.496, 25.087], [121.494, 25.098],
      [121.492, 25.108], [121.485, 25.116], [121.474, 25.119],
      [121.465, 25.117], [121.461, 25.112],
    ],
  },
  {
    name: "雙溪", width: 70,
    line: [
      [121.546, 25.1], [121.532, 25.099], [121.52, 25.098],
      [121.51, 25.094], [121.501, 25.092], [121.495, 25.092],
    ],
  },
  {
    name: "磺港溪", width: 40,
    line: [
      [121.508, 25.14], [121.505, 25.13], [121.505, 25.121],
      [121.506, 25.114],
    ],
  },
];

export function projectRing(ring) {
  return ring.map(([lon, lat]) => project(lon, lat));
}

export function pointInRing(x, z, ring) {
  // ring: 已投影的 [x, z] 陣列
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function ringBBox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

export function ringCentroid(ring) {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}

// OSM 載入用的邊界框（south, west, north, east）
export const OSM_BBOX = [25.05, 121.45, 25.168, 121.555];
