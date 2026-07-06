import { useEffect, useRef, useState } from "react";
import { TwinScene } from "./scene.js";
import { simulateRound } from "./sim.js";
import { loadOSMBuildings, loadBundledRoads, loadBundledLanduse } from "./osm.js";
import { ZONES } from "./geo.js";
import {
  INIT_STATE, METRICS, SCENARIOS, ROUNDS, YEAR_STEP,
  CLAUDE_MODELS, colorFor,
} from "./constants.js";

export default function App() {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const stopRef = useRef(false);

  const [state, setState] = useState(INIT_STATE);
  const [metric, setMetric] = useState("lst");
  const [scenId, setScenId] = useState("bau");
  const [selZone, setSelZone] = useState("bstp");
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(0);
  const [err, setErr] = useState(null);
  const [buildingCount, setBuildingCount] = useState(0);

  const [engineType, setEngineType] = useState("local");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("anthropic_api_key") || "");
  const [model, setModel] = useState(CLAUDE_MODELS[0].id);

  const [osmStatus, setOsmStatus] = useState(null);
  const [osmLoading, setOsmLoading] = useState(false);

  // 初始化 3D 場景
  useEffect(() => {
    const scene = new TwinScene(canvasRef.current, {
      onZoneClick: (zoneId) => setSelZone(zoneId),
    });
    sceneRef.current = scene;
    setBuildingCount(scene.buildingCount);
    scene.setMetricState("lst", INIT_STATE);
    scene.setSelectedZone("bstp");
    return () => scene.dispose();
  }, []);

  useEffect(() => {
    sceneRef.current?.setMetricState(metric, state);
  }, [metric, state]);

  useEffect(() => {
    sceneRef.current?.setSelectedZone(selZone);
  }, [selZone]);

  const scenario = SCENARIOS.find((s) => s.id === scenId);
  const zd = state.zones[selZone];
  const zName = ZONES.find((z) => z.id === selZone)?.name;

  async function runLoop() {
    if (engineType === "claude" && !apiKey.trim()) {
      setErr("請先輸入 Anthropic API Key，或改用本地引擎");
      return;
    }
    setRunning(true); setErr(null); stopRef.current = false;
    setLog([]); setRound(0);
    let cur = JSON.parse(JSON.stringify(INIT_STATE));
    setState(cur);

    const engine = engineType === "claude"
      ? { type: "claude", apiKey: apiKey.trim(), model }
      : { type: "local" };

    for (let r = 1; r <= ROUNDS; r++) {
      if (stopRef.current) break;
      setRound(r);
      try {
        const next = await simulateRound(engine, cur, scenario, r);
        cur = { year: next.year, zones: next.zones, global: next.global };
        setState(cur);
        setLog((l) => [...l, { round: r, year: next.year, events: next.events || [], note: next.note || "" }]);
        sceneRef.current?.pulseZones((next.events || []).map((e) => e.zone));
      } catch (e) {
        setErr(`第${r}輪模擬失敗：${e.message}。可再次執行重試。`);
        break;
      }
    }
    setRunning(false);
  }

  async function loadOSM() {
    setOsmLoading(true);
    setOsmStatus("連線 Overpass API…");
    try {
      const list = await loadOSMBuildings((msg) => setOsmStatus(msg));
      setOsmStatus(`建立 ${list.length.toLocaleString()} 棟真實建築的3D模型…`);
      await new Promise((r) => setTimeout(r, 30)); // 讓狀態先渲染
      sceneRef.current?.setOSMBuildings(list);
      setBuildingCount(list.length);

      // 真實路網與土地使用（若網站已烘入資料）
      let extras = "";
      try {
        const roads = await loadBundledRoads();
        sceneRef.current?.setRealRoads(roads);
        extras += `、${roads.length.toLocaleString()} 條路段`;
      } catch { /* 無路網資料 */ }
      try {
        const landuse = await loadBundledLanduse();
        sceneRef.current?.setLanduse(landuse);
        extras += `、${landuse.length.toLocaleString()} 塊土地使用`;
      } catch { /* 無土地使用資料 */ }

      setOsmStatus(`已載入 ${list.length.toLocaleString()} 棟真實建築${extras} ✓`);
    } catch (e) {
      setOsmStatus(`載入失敗：${e.message}`);
    }
    setOsmLoading(false);
  }

  function saveKey(v) {
    setApiKey(v);
    localStorage.setItem("anthropic_api_key", v);
  }

  const m = METRICS[metric];

  return (
    <div className="app">
      <div className="canvas-wrap" ref={canvasRef}>
        <div className="hud">
          <div className="kicker">TAIPEI URBAN DIGITAL TWIN · AI LOOP</div>
          <h1>台北數位孿生沙盤</h1>
          <div className="sub">
            {buildingCount.toLocaleString()} 棟建築｜空間系統動力學 × AI 推演迴圈｜北士科示範場域
          </div>
        </div>
        <div className="hud-year">
          <div className="y">{state.year}</div>
          <div className="b">{running ? `第 ${round}/${ROUNDS} 輪推演中` : "YEAR"}</div>
        </div>
        <div className="hud-hint">拖曳旋轉．滾輪縮放．點擊分區檢視指標</div>
        <div className="legend">
          <div className="row">
            <span>{m.invert ? "高風險" : "低"}</span>
            <span className="mono">{m.label}（{m.unit}）</span>
            <span>{m.invert ? "良好" : "高"}</span>
          </div>
          <div className="bar" />
        </div>
      </div>

      <div className="panel">
        <div className="sec">
          <div className="sec-title">一、模擬情境</div>
          <div className="btn-row">
            {SCENARIOS.map((s) => (
              <button key={s.id} className={`btn ${scenId === s.id ? "on" : ""}`}
                disabled={running} onClick={() => setScenId(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
          <div className="desc">{scenario.desc}</div>
        </div>

        <div className="sec">
          <div className="sec-title">二、推演引擎</div>
          <div className="radio-row">
            <label>
              <input type="radio" checked={engineType === "local"} disabled={running}
                onChange={() => setEngineType("local")} />
              本地系統動力學
            </label>
            <label>
              <input type="radio" checked={engineType === "claude"} disabled={running}
                onChange={() => setEngineType("claude")} />
              Claude AI 引擎
            </label>
          </div>
          {engineType === "claude" && (
            <>
              <div className="field">
                <input type="password" placeholder="Anthropic API Key（僅存於瀏覽器）"
                  value={apiKey} onChange={(e) => saveKey(e.target.value)} disabled={running} />
              </div>
              <div className="field">
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running}>
                  {CLAUDE_MODELS.map((mo) => (
                    <option key={mo.id} value={mo.id}>{mo.label}</option>
                  ))}
                </select>
              </div>
              <div className="desc">由 Claude 作為空間系統動力學引擎逐輪推演跨領域影響鏈。Key 只保存在您的瀏覽器 localStorage，直連 Anthropic API。</div>
            </>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            {!running ? (
              <button className="btn on big" onClick={runLoop}>
                執行推演（{ROUNDS}輪 × {YEAR_STEP}年）
              </button>
            ) : (
              <button className="btn danger big" onClick={() => { stopRef.current = true; }}>
                停止
              </button>
            )}
            <button className="btn" disabled={running}
              onClick={() => { setState(INIT_STATE); setLog([]); setErr(null); setRound(0); }}>
              重設 2026
            </button>
          </div>
          {running && <div className="status run">第 {round}/{ROUNDS} 輪推演中…（{engineType === "claude" ? "Claude AI" : "本地引擎"}）</div>}
          {err && <div className="status err">{err}</div>}
        </div>

        <div className="sec">
          <div className="sec-title">三、沙盤圖層</div>
          <div className="btn-row">
            {Object.entries(METRICS).map(([k, v]) => (
              <button key={k} className={`btn ${metric === k ? "on" : ""}`} onClick={() => setMetric(k)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sec card">
          <div className="sec-title" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>分區指標：{zName}</span>
            <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }}
              onClick={() => sceneRef.current?.flyToZone(selZone)}>
              飛往
            </button>
          </div>
          {Object.entries(METRICS).map(([k, v]) => (
            <div key={k} className="kv">
              <span className="k">{v.label}</span>
              <span className="mono" style={{ color: colorFor(k, zd[k]) }}>
                {zd[k]} {v.unit}
              </span>
            </div>
          ))}
        </div>

        <div className="sec card" style={{ marginTop: 12 }}>
          <div className="sec-title">全域 KPI</div>
          {[
            ["再生能源自給率", state.global.re, "%"],
            ["碳排指數（2026=100）", state.global.carbon, ""],
            ["人口", state.global.pop, " 萬人"],
          ].map(([label, val, unit]) => (
            <div key={label} className="kv">
              <span className="k">{label}</span>
              <span className="mono">{val}{unit}</span>
            </div>
          ))}
        </div>

        <div className="sec" style={{ marginTop: 16 }}>
          <div className="sec-title">四、推演紀錄</div>
          {log.length === 0 && (
            <div className="desc">選擇情境後執行推演，引擎將逐輪演算跨領域影響鏈並更新沙盤（受影響分區會閃爍標示）。</div>
          )}
          {log.map((entry) => (
            <div key={entry.round} className="log-entry">
              <div className="r">ROUND {entry.round} → {entry.year}</div>
              <div className="n">{entry.note}</div>
              {entry.events.map((ev, i) => (
                <div key={i} className="e">
                  ↳ 影響鏈：{ev.chain}（{ZONES.find((z) => z.id === ev.zone)?.name || ev.zone}）
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="sec">
          <div className="sec-title">五、真實建築資料</div>
          <button className="btn" disabled={osmLoading} onClick={loadOSM}>
            {osmLoading ? "載入中…" : "載入 OSM 真實城市資料"}
          </button>
          <div className="desc">
            載入士林北投一帶的 OSM 真實資料：建築輪廓與高度、分級路網
            （快速道路→巷弄）、土地使用（綠地／農地／水域／工業區）。
            若網站已烘入預抓資料（GitHub Actions「Fetch OSM building data」）則秒開；
            否則即時向 Overpass API 抓取建築（路網與土地使用僅來自預抓資料）。
          </div>
          {osmStatus && (
            <div className={`status ${osmStatus.includes("失敗") ? "err" : osmStatus.includes("✓") ? "ok" : "run"}`}>
              {osmStatus}
            </div>
          )}
        </div>

        <div className="footer">
          概念原型：分區與指標取自北士科專家工作坊預填單六大領域（土地生態、建築、都市微氣候、防洪排水、交通、能源）。
          數值為系統動力學／AI 推演之示意結果，非物理模型輸出；正式模擬仍需接入 SWMM、ENVI-met、EnergyPlus
          等領域引擎與實測資料。建築幾何預設為程序化生成，可切換為 OSM 真實足跡。
        </div>
      </div>
    </div>
  );
}
