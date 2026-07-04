// 從 OpenStreetMap（Overpass API）載入真實建築足跡
// 註：在瀏覽器端直接呼叫，資料量約數十MB，載入需時間
import { ZONES, OSM_BBOX, project, projectRing, pointInRing } from "./geo.js";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const MAX_BUILDINGS = 80000;

function parseHeight(tags) {
  if (tags?.height) {
    const h = parseFloat(tags.height);
    if (!isNaN(h) && h > 0) return Math.min(h, 250);
  }
  if (tags?.["building:levels"]) {
    const l = parseFloat(tags["building:levels"]);
    if (!isNaN(l) && l > 0) return Math.min(l * 3.1, 250);
  }
  return 9; // 台北常見3層街屋
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function loadOSMBuildings(onProgress) {
  const [s, w, n, e] = OSM_BBOX;
  const query =
    `[out:json][timeout:120][maxsize:536870912];` +
    `(way["building"](${s},${w},${n},${e}););out geom ${MAX_BUILDINGS};`;

  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      onProgress?.(`向 ${new URL(endpoint).host} 請求建築資料…`);
      const res = await fetch(endpoint, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onProgress?.("下載中（資料量較大，請稍候）…");
      const data = await res.json();
      onProgress?.(`解析 ${data.elements?.length ?? 0} 筆建築足跡…`);
      return parseElements(data.elements || []);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Overpass API 無法連線：${lastErr?.message || "未知錯誤"}`);
}

function parseElements(elements) {
  const zoneRings = ZONES.map((z) => projectRing(z.ring));
  const rng = mulberry32(42);
  const out = [];

  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 4) continue;
    // 去掉閉合重複點
    const raw = el.geometry;
    const nPts = raw.length - 1;
    if (nPts < 3 || nPts > 80) continue;

    const ring = new Array(nPts);
    let cx = 0, cz = 0;
    for (let i = 0; i < nPts; i++) {
      const p = project(raw[i].lon, raw[i].lat);
      ring[i] = p;
      cx += p[0]; cz += p[1];
    }
    cx /= nPts; cz /= nPts;

    let zone = -1;
    for (let zi = 0; zi < zoneRings.length; zi++) {
      if (pointInRing(cx, cz, zoneRings[zi])) { zone = zi; break; }
    }

    out.push({
      ring,
      h: parseHeight(el.tags),
      zone,
      jitter: 0.72 + rng() * 0.56,
    });
    if (out.length >= MAX_BUILDINGS) break;
  }
  return out;
}
