// 在 CI（GitHub Actions）上抓取 OSM 城市資料（建築、路網、土地使用）並輸出壓縮 JSON
// 用法：node scripts/fetch-osm.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { OSM_BBOX, project } from "../src/geo.js";
import { parseElements } from "../src/osm.js";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const USER_AGENT =
  "TaipeiDigitalTwins/1.0 (+https://github.com/yunching0513/TaipeiDigitalTwins; urban digital twin research)";

const [s, w, n, e] = OSM_BBOX;
const BBOX = `${s},${w},${n},${e}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass(label, query) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        console.log(`[${label}] 第${attempt}回 查詢 ${endpoint} …`);
        const res = await fetch(endpoint, {
          method: "POST",
          body: "data=" + encodeURIComponent(query),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(`[${label}] 取得 ${data.elements?.length ?? 0} 筆`);
        return data.elements || [];
      } catch (err) {
        console.warn(`[${label}] ${endpoint} 失敗：${err.message}`);
        lastErr = err;
        await sleep(3000);
      }
    }
    if (attempt < 3) { console.log("本回全部失敗，等待 30 秒後重試…"); await sleep(30000); }
  }
  throw new Error(`[${label}] 所有 Overpass 端點均失敗：${lastErr?.message}`);
}

// 投影 + 簡化（略過與前一點距離 < minDist 公尺的點）
function projectLine(geometry, minDist) {
  const pts = [];
  let px = Infinity, pz = Infinity;
  for (const g of geometry) {
    const [x, z] = project(g.lon, g.lat);
    if (Math.hypot(x - px, z - pz) < minDist) continue;
    pts.push(Math.round(x), Math.round(z));
    px = x; pz = z;
  }
  return pts;
}

mkdirSync("public/data", { recursive: true });
function writeOut(name, rows) {
  const json = JSON.stringify(rows);
  writeFileSync(`public/data/${name}.json`, json);
  console.log(`→ public/data/${name}.json：${rows.length} 筆，${(json.length / 1048576).toFixed(1)} MB`);
}

// ---------- 1. 建築 ----------
{
  const elements = await fetchOverpass(
    "建築",
    `[out:json][timeout:180][maxsize:1073741824];(way["building"](${BBOX}););out geom 80000;`
  );
  const list = parseElements(elements);
  const rows = list.map((b) => {
    const row = [Math.round(b.h * 10) / 10, b.zone];
    for (const [x, z] of b.ring) row.push(Math.round(x), Math.round(z));
    return row;
  });
  writeOut("osm-buildings", rows);
  const inZone = rows.filter((r) => r[1] >= 0).length;
  console.log(`  （六大分區內 ${inZone} 棟）`);
}

// ---------- 2. 路網（分級） ----------
{
  const CLS = {
    motorway: 0, trunk: 0, motorway_link: 0, trunk_link: 0,
    primary: 1, primary_link: 1,
    secondary: 2, secondary_link: 2,
    tertiary: 3, tertiary_link: 3,
    residential: 4, unclassified: 4, living_street: 4,
  };
  const pattern = Object.keys(CLS).join("|");
  const elements = await fetchOverpass(
    "路網",
    `[out:json][timeout:180][maxsize:1073741824];(way["highway"~"^(${pattern})$"](${BBOX}););out geom 120000;`
  );
  const rows = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const cls = CLS[el.tags?.highway];
    if (cls === undefined) continue;
    const pts = projectLine(el.geometry, cls <= 1 ? 12 : 8);
    if (pts.length < 4) continue;
    rows.push([cls, ...pts]);
  }
  writeOut("osm-roads", rows);
}

// ---------- 3. 土地使用（0=綠地 1=農地 2=水域 3=工業） ----------
{
  const elements = await fetchOverpass(
    "土地使用",
    `[out:json][timeout:180][maxsize:1073741824];(` +
      `way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|farmland|orchard|industrial|reservoir|basin)$"](${BBOX});` +
      `way["leisure"~"^(park|garden)$"](${BBOX});` +
      `way["natural"~"^(wood|water|scrub|grassland|wetland)$"](${BBOX});` +
      `way["waterway"="riverbank"](${BBOX});` +
    `);out geom 60000;`
  );
  function classify(tags = {}) {
    if (tags.landuse === "farmland" || tags.landuse === "orchard") return 1;
    if (tags.landuse === "industrial") return 3;
    if (tags.landuse === "reservoir" || tags.landuse === "basin") return 2;
    if (tags.landuse) return 0;
    if (tags.leisure) return 0;
    if (tags.natural === "water" || tags.natural === "wetland") return 2;
    if (tags.natural) return 0;
    if (tags.waterway === "riverbank") return 2;
    return -1;
  }
  const rows = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 4) continue;
    const g = el.geometry;
    // 僅取閉合環（多邊形）
    if (g[0].lon !== g[g.length - 1].lon || g[0].lat !== g[g.length - 1].lat) continue;
    const type = classify(el.tags);
    if (type === -1) continue;
    const pts = projectLine(g.slice(0, -1), 6);
    if (pts.length < 6) continue;
    rows.push([type, ...pts]);
  }
  writeOut("osm-landuse", rows);
}

console.log("完成");
