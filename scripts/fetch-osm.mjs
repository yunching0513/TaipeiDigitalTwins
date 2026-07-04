// 在 CI（GitHub Actions）上抓取 OSM 建築資料並輸出壓縮 JSON
// 用法：node scripts/fetch-osm.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { OSM_BBOX } from "../src/geo.js";
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
const query =
  `[out:json][timeout:180][maxsize:1073741824];` +
  `(way["building"](${s},${w},${n},${e}););out geom 80000;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let data = null;
let lastErr = null;
outer:
for (let attempt = 1; attempt <= 3; attempt++) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`[第${attempt}回] 查詢 ${endpoint} …`);
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
      data = await res.json();
      break outer;
    } catch (err) {
      console.warn(`${endpoint} 失敗：${err.message}`);
      lastErr = err;
      await sleep(3000);
    }
  }
  if (attempt < 3) {
    console.log("本回全部失敗，等待 30 秒後重試…");
    await sleep(30000);
  }
}
if (!data) {
  console.error("所有 Overpass 端點均失敗", lastErr);
  process.exit(1);
}

console.log(`取得 ${data.elements?.length ?? 0} 筆 way`);
const list = parseElements(data.elements || []);

// 壓縮格式：每列 [高度(0.1m), 分區索引, x1, z1, x2, z2, ...]（公尺整數）
const rows = list.map((b) => {
  const row = [Math.round(b.h * 10) / 10, b.zone];
  for (const [x, z] of b.ring) row.push(Math.round(x), Math.round(z));
  return row;
});

mkdirSync("public/data", { recursive: true });
const json = JSON.stringify(rows);
writeFileSync("public/data/osm-buildings.json", json);

const inZone = rows.filter((r) => r[1] >= 0).length;
console.log(
  `輸出 ${rows.length} 棟（六大分區內 ${inZone} 棟）` +
  `，檔案 ${(json.length / 1048576).toFixed(1)} MB → public/data/osm-buildings.json`
);
