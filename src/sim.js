// 空間系統動力學模擬引擎：本地引擎（離線可用）＋ Claude API 引擎
import { YEAR_STEP } from "./constants.js";

const ZONE_IDS = ["bstp", "zhoumei", "shezidao", "guandu", "shilin", "beitou"];

// ---------- 本地系統動力學引擎 ----------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function r1(v) { return Math.round(v * 10) / 10; }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 各情境的每輪基礎變化量（3年一輪）
const SCENARIO_DELTAS = {
  bau: {
    zone: (id) => ({
      eui: id === "bstp" || id === "shilin" ? 4 : 2.5,
      lst: 0.35,
      flood: id === "bstp" || id === "shilin" ? 3 : 2,
      green: id === "guandu" ? -2.5 : -1.2,
      risk: 2.5,
    }),
    global: { re: 0.6, carbon: 2.2, pop: 0.8 },
    note: (round) => [
      "開發持續推進，不透水面積增加，熱島與逕流壓力上升",
      "北士科與士林開發趨於飽和，尖峰交通惡化",
      "綠地持續流失，關渡平原開發壓力浮現",
      "無政策干預下各項環境指標緩步惡化",
    ][round - 1],
    chains: [
      { chain: "土地開發→逕流係數↑→淹水", zone: "shezidao" },
      { chain: "綠地流失→熱島↑→空調用電↑", zone: "shilin" },
    ],
  },
  green: {
    zone: (id) => ({
      eui: -7,
      lst: -0.3,
      flood: -1,
      green: 3,
      risk: id === "bstp" || id === "shilin" ? 2 : 1,
    }),
    global: { re: 1.2, carbon: -4.5, pop: 1.1 },
    note: (round) => [
      "綠建築標章普及，空調負載下降、立體綠化擴張",
      "容積獎勵吸引人口移入，交通量同步上升",
      "綠覆率提升開始壓抑熱島效應",
      "建築部門碳排明顯下降，惟交通壓力需配套",
    ][round - 1],
    chains: [
      { chain: "綠建築→EUI↓→廢熱↓→熱島緩解", zone: "shilin" },
      { chain: "容積獎勵→人口↑→交通風險↑", zone: "bstp" },
    ],
  },
  rain: {
    zone: (id, round) => {
      const decay = Math.pow(0.72, round - 1);
      const base = { shezidao: 30, zhoumei: 22, guandu: 16, bstp: 9, shilin: 8, beitou: 6 }[id];
      return {
        eui: 0.5,
        lst: -0.4,
        flood: base * decay - (round > 2 ? 4 : 0),
        green: 0,
        risk: base * decay * 0.35,
      };
    },
    global: { re: -0.5, carbon: 0.4, pop: 0 },
    note: (round) => [
      "極端強降雨超過排水設計標準，低窪地區大範圍積淹",
      "抽水站故障未修復，社子島、洲美再度受災",
      "臨時抽水與排水改善開始發揮效果",
      "防洪調適投資到位，淹水災損趨於受控",
    ][round - 1],
    chains: [
      { chain: "強降雨→抽水站過載→社子島淹水", zone: "shezidao" },
      { chain: "淹水→變電設施受損→供電中斷", zone: "zhoumei" },
    ],
  },
  heat: {
    zone: (id) => ({
      eui: id === "bstp" ? 15 : 6,
      lst: id === "bstp" ? 1.1 : 0.7,
      flood: 0,
      green: -0.5,
      risk: 2,
    }),
    global: { re: 0.8, carbon: 5, pop: 0.4 },
    note: (round) => [
      "熱浪期間AI資料中心進駐北士科，用電需求暴增",
      "資料中心廢熱加劇局部熱島，空調負載連鎖上升",
      "電網尖峰吃緊，跳電風險升高",
      "高耗能與熱島形成正回饋，減緩需結構性對策",
    ][round - 1],
    chains: [
      { chain: "資料中心→廢熱→熱島→空調↑", zone: "bstp" },
      { chain: "尖峰用電↑→電網壓力→跳電風險", zone: "shilin" },
    ],
  },
  grid: {
    zone: (id) => ({
      eui: id === "bstp" ? -6 : -3.5,
      lst: -0.1,
      flood: 0,
      green: 0.5,
      risk: -1.2,
    }),
    global: { re: 6.5, carbon: -6.5, pop: 0.5 },
    note: (round) => [
      "區域微電網上線，分散式光電與儲能開始併網",
      "需量反應調度削峰填谷，尖峰負載下降",
      "再生能源自給率快速攀升，碳排同步下降",
      "能源韌性建立，極端事件下供電維持穩定",
    ][round - 1],
    chains: [
      { chain: "微電網→削峰→EUI↓→碳排↓", zone: "bstp" },
      { chain: "儲能→停電韌性↑→災害風險↓", zone: "shilin" },
    ],
  },
  sponge: {
    zone: (id) => ({
      eui: -1,
      lst: -0.55,
      flood: { shezidao: -14, zhoumei: -11, guandu: -8, bstp: -4, shilin: -5, beitou: -3 }[id],
      green: 4,
      risk: -1,
    }),
    global: { re: 0.5, carbon: -1.5, pop: 0.4 },
    note: (round) => [
      "滯洪空間與透水鋪面啟用，逕流峰值下降",
      "藍綠廊道串聯，樹冠覆蓋率上升",
      "蒸散降溫效果顯現，熱島指標改善",
      "海綿城市系統成形，水患與熱島雙重緩解",
    ][round - 1],
    chains: [
      { chain: "滯洪池→逕流削減→淹水↓", zone: "shezidao" },
      { chain: "樹冠↑→蒸散降溫→地表溫度↓", zone: "guandu" },
    ],
  },
};

export function localSimulate(state, scenario, round) {
  const rng = mulberry32(round * 7919 + scenario.id.length * 104729);
  const cfg = SCENARIO_DELTAS[scenario.id];
  const zones = {};

  for (const id of ZONE_IDS) {
    const v = state.zones[id];
    const d = cfg.zone(id, round);
    const noise = () => 0.85 + rng() * 0.3;

    let eui = v.eui + d.eui * noise();
    let lst = v.lst + d.lst * noise();
    let flood = v.flood + d.flood * noise();
    let green = v.green + d.green * noise();
    let risk = v.risk + d.risk * noise();

    // 跨領域回饋鏈
    eui += (lst - 33) * 0.5;            // 高溫→空調用電
    lst -= (green - 30) * 0.012;        // 綠覆→降溫
    if (flood > 60) { risk += 3; }      // 淹水→交通中斷
    if (eui > 170) { lst += 0.15; }     // 高耗能→廢熱→熱島

    zones[id] = {
      eui: r1(clamp(eui, 40, 260)),
      lst: r1(clamp(lst, 26, 42)),
      flood: r1(clamp(flood, 0, 150)),
      green: r1(clamp(green, 5, 90)),
      risk: r1(clamp(risk, 0, 100)),
    };
  }

  // 全域 KPI（含淹水對能源韌性的抑制）
  const floodPenalty = zones.shezidao.flood > 70 || zones.zhoumei.flood > 60 ? 0.6 : 0;
  const global = {
    re: r1(clamp(state.global.re + cfg.global.re - floodPenalty, 0, 100)),
    carbon: r1(clamp(state.global.carbon + cfg.global.carbon, 30, 180)),
    pop: r1(clamp(state.global.pop + cfg.global.pop, 20, 45)),
  };

  return {
    year: state.year + YEAR_STEP,
    zones,
    global,
    events: cfg.chains,
    note: cfg.note(round) || "",
  };
}

// ---------- Claude API 引擎（瀏覽器直連） ----------

const zoneSchema = {
  type: "object",
  properties: {
    eui: { type: "number" }, lst: { type: "number" }, flood: { type: "number" },
    green: { type: "number" }, risk: { type: "number" },
  },
  required: ["eui", "lst", "flood", "green", "risk"],
  additionalProperties: false,
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    year: { type: "integer" },
    zones: {
      type: "object",
      properties: Object.fromEntries(ZONE_IDS.map((id) => [id, zoneSchema])),
      required: ZONE_IDS,
      additionalProperties: false,
    },
    global: {
      type: "object",
      properties: {
        re: { type: "number" }, carbon: { type: "number" }, pop: { type: "number" },
      },
      required: ["re", "carbon", "pop"],
      additionalProperties: false,
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chain: { type: "string" },
          zone: { type: "string", enum: ZONE_IDS },
        },
        required: ["chain", "zone"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["year", "zones", "global", "events", "note"],
  additionalProperties: false,
};

export async function claudeSimulate({ apiKey, model }, state, scenario, round) {
  const sys =
    `你是大台北都市數位孿生的空間系統動力學引擎。根據當前狀態與情境，推進${YEAR_STEP}年，` +
    `輸出各分區指標的合理演變。必須考慮跨領域回饋鏈：土地利用→逕流係數→淹水；` +
    `綠建築→容積獎勵→人口與交通；綠覆率→地表溫度→空調用電(EUI)；能源效率→廢熱→熱島；` +
    `淹水→供電設施→能源韌性。數值變化須漸進且物理合理，取1位小數。` +
    `events最多2筆，chain為15字內的跨域影響鏈，note為30字內的本輪關鍵動態。`;

  const usr =
    `情境：${scenario.name}（${scenario.desc}）。第${round}輪（共4輪，每輪${YEAR_STEP}年）。\n` +
    `當前狀態：${JSON.stringify(state)}\n` +
    `回傳下一輪狀態（year=${state.year + YEAR_STEP}）。`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: sys,
      messages: [{ role: "user", content: usr }],
      output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("模型拒絕了此請求，請改用本地引擎或重試");
  }
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// 統一入口
export async function simulateRound(engine, state, scenario, round) {
  if (engine.type === "claude") {
    return claudeSimulate(engine, state, scenario, round);
  }
  // 本地引擎稍作延遲，讓推演節奏可見
  await new Promise((r) => setTimeout(r, 500));
  return localSimulate(state, scenario, round);
}
