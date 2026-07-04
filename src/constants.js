// 六大分區指標與情境定義（源自北士科專家工作坊預填單六大領域）

export const INIT_STATE = {
  year: 2026,
  zones: {
    bstp:     { eui: 155, lst: 34.5, flood: 12, green: 22, risk: 48 },
    zhoumei:  { eui: 120, lst: 33.0, flood: 30, green: 35, risk: 40 },
    shezidao: { eui: 105, lst: 32.0, flood: 55, green: 42, risk: 55 },
    guandu:   { eui: 60,  lst: 30.5, flood: 40, green: 78, risk: 25 },
    shilin:   { eui: 140, lst: 35.0, flood: 18, green: 18, risk: 62 },
    beitou:   { eui: 118, lst: 33.5, flood: 10, green: 38, risk: 45 },
  },
  global: { re: 6, carbon: 100, pop: 31.5 },
};

export const METRICS = {
  eui:   { label: "EUI",      unit: "kWh/m²·yr", lo: 50, hi: 200, invert: true },
  lst:   { label: "地表溫度", unit: "°C",        lo: 28, hi: 40,  invert: true },
  flood: { label: "淹水深度", unit: "cm",        lo: 0,  hi: 120, invert: true },
  green: { label: "綠覆率",   unit: "%",         lo: 0,  hi: 80,  invert: false },
  risk:  { label: "交通風險", unit: "idx",       lo: 0,  hi: 100, invert: true },
};

export const SCENARIOS = [
  { id: "bau",    name: "基礎情境（BAU）",      desc: "依現行都市計畫開發至飽和，無額外政策干預" },
  { id: "green",  name: "綠建築容積獎勵",       desc: "私有建築全面取得綠建築標章，容積獎勵＋立體綠化全滿足" },
  { id: "rain",   name: "極端降雨100mm/hr",     desc: "超過台北市排水設計標準之極端強降雨，抽水站部分故障" },
  { id: "heat",   name: "熱浪＋AI資料中心進駐", desc: "極端熱浪期間高密度AI運算負載進駐，用電需求暴增" },
  { id: "grid",   name: "智慧微電網＋儲能",     desc: "導入區域微電網、分散式再生能源、儲能與需求反應" },
  { id: "sponge", name: "海綿城市藍綠基盤",     desc: "提高滯蓄洪空間、透水鋪面、樹冠覆蓋與生態廊道" },
];

export const ROUNDS = 4;
export const YEAR_STEP = 3;

export const CLAUDE_MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8（預設）" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

// 指標值 → 顏色。差:磚紅 → 中:琥珀 → 好:河青
export function colorFor(metric, val) {
  const m = METRICS[metric];
  let t = Math.max(0, Math.min(1, (val - m.lo) / (m.hi - m.lo)));
  if (m.invert) t = 1 - t; // t=1 良好
  const stops = [ [214, 74, 60], [232, 163, 61], [79, 163, 199] ];
  const seg = t < 0.5 ? 0 : 1;
  const f = (t - seg * 0.5) / 0.5;
  const c = stops[seg].map((a, i) => Math.round(a + (stops[seg + 1][i] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function colorForRGB(metric, val) {
  const m = METRICS[metric];
  let t = Math.max(0, Math.min(1, (val - m.lo) / (m.hi - m.lo)));
  if (m.invert) t = 1 - t;
  const stops = [ [214, 74, 60], [232, 163, 61], [79, 163, 199] ];
  const seg = t < 0.5 ? 0 : 1;
  const f = (t - seg * 0.5) / 0.5;
  return stops[seg].map((a, i) => (a + (stops[seg + 1][i] - a) * f) / 255);
}
