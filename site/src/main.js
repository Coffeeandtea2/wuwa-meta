// main.js — 전체 기능 완성본
import { q } from "./db.js";
import "./style.css";

const app = document.querySelector("#app");
const fmt = (d) => {
  if (d == null) return "—";
  if (typeof d === "number" || typeof d === "bigint") {
    const n = Number(d);
    return new Date(n < 1e11 ? n * 1000 : n).toISOString().slice(0, 10);
  }
  return String(d).slice(0, 10);
};
const toMs = (d) => (typeof d === "number" || typeof d === "bigint")
  ? (Number(d) < 1e11 ? Number(d) * 1000 : Number(d)) : new Date(d).getTime();
const CUTE = {
  "장수형": "🐢 롱런 타입", "평균형": "🙂 무난 타입", "단명형": "⚡ 반짝 타입", "관측중": "👀 지켜보는 중",
  "높음": "😰 많음", "중간": "🤔 조금", "낮음": "😌 거의 없음",
  "지금 뽑기 후보": "💖 지금이 기회!", "다음 복각 대기 후보": "⏳ 다음에 만나요",
  "스킵 후보": "🙅 참는 게 이득", "조건부 — 계정 궁합으로 판단": "🎲 네 계정 보고 결정!",
};
const cute = (v) => CUTE[v] ?? v ?? "—";

/* ── 인벤토리 (localStorage) ── */
const INV_KEY = "inventory";
const loadInv = () => JSON.parse(localStorage.getItem(INV_KEY) ?? "{}");
const saveInv = (inv) => localStorage.setItem(INV_KEY, JSON.stringify(inv));

/* ── 페이지: 메타 대시보드 ── */
async function pageMeta() {
  app.innerHTML = "<h2>요즘 메타 날씨 ☀️</h2>";
  const seasons = await q(`SELECT COUNT(DISTINCT season_id) AS n FROM 'data/toa_usage.parquet'`);
  if (Number(seasons[0].n) < 3) {
    app.insertAdjacentHTML("beforeend",
      `<p class="notice">픽률 데이터가 아직 ${seasons[0].n}시즌뿐이라 추이 그래프는 잠자는 중 💤 시즌 CSV가 쌓이면 스스로 깨어나요. 아래는 배너 기록으로 아는 것들!</p>`);
  } else {
    const trends = await q(`
      WITH w AS (
        SELECT season_id, character_id, pick_rate,
               pick_rate - LAG(pick_rate) OVER (PARTITION BY character_id ORDER BY season_id) AS delta
        FROM 'data/toa_usage.parquet')
      SELECT c.name, w.season_id, w.pick_rate, w.delta,
             RANK() OVER (PARTITION BY w.season_id ORDER BY w.pick_rate DESC) AS rnk
      FROM w JOIN 'data/characters.parquet' c USING (character_id)
      WHERE w.season_id = (SELECT MAX(season_id) FROM w)
      ORDER BY rnk LIMIT 15`);
    renderTable("이번 시즌 인기쟁이 TOP 15", trends, ["rnk", "name", "pick_rate", "delta"],
      "커뮤니티에서 집계한 잔향의 탑 시즌별 픽률이에요. delta는 직전 시즌과의 차이(SQL LAG 함수로 계산).");
  }
  const gaps = await q(`
    SELECT c.name, g.run_count, g.gap_median, g.last_run, g.next_rerun_early, g.next_rerun_late
    FROM 'data/gold_rerun_gaps.parquet' g JOIN 'data/characters.parquet' c USING (character_id)
    ORDER BY g.next_rerun_early LIMIT 15`);
  renderTable("곧 돌아올 것 같은 애들 🔮 (지금까지 패턴 기준)",
    gaps.map((r) => ({ 캐릭터: r.name, "지금까지 등장": Number(r.run_count) + "번", "보통 텀": Number(r.gap_median) + "일",
      "마지막 등장": fmt(r.last_run), "돌아올 예감": `${fmt(r.next_rerun_early)} ~ ${fmt(r.next_rerun_late)}` })));
  const creep = await q(`
    SELECT c.name, p.residual, p.risk_grade
    FROM 'data/gold_powercreep.parquet' p JOIN 'data/characters.parquet' c USING (character_id)
    WHERE p.rarity = 5 ORDER BY p.residual DESC LIMIT 10`);
  renderTable("스펙 깡패 TOP 10 💪 (또래보다 센 5성)",
    creep.map((r) => ({ 캐릭터: r.name, "얼마나 센지": "+" + Number(r.residual).toFixed(1), "밀려날 걱정": cute(r.risk_grade) })),
    null,
    "궁극기 최대 레벨의 % 배율을 전부 더해서, 출시 시기가 비슷한 5성끼리 회귀선(또래 평균)을 긋고 그보다 얼마나 위인지를 본 거예요. 주의: 순수 스펙 숫자만 본 거라 다단히트로 배율 항목이 많은 캐릭터가 과대평가될 수 있고, 실전 사이클·시너지는 반영 안 됨. 픽률 데이터가 쌓이면 '스펙 대비 픽률이 이상한 캐릭터'(진짜 오버튜닝/벽캐) 탐지로 업그레이드될 지표예요.");
}

/* ── 페이지: 연구소 실시간 티어 (역할별 × 체인 기준) ── */
async function pageLabTier() {
  const rows = await q(`
    SELECT f.character_id, f.name, f.rarity, f.element, f.tier AS ext_tier,
           f.lifespan_grade, f.risk_grade, p.ref_multiplier, p.residual, p.release_date,
           r.role_full, r.role_section
    FROM 'data/gold_fit_features.parquet' f
    JOIN 'data/gold_powercreep.parquet' p USING (character_id)
    LEFT JOIN 'data/roles.parquet' r USING (character_id)`);
  const extRows = await q(`SELECT * FROM 'data/external_tiers.parquet'`).catch(() => []);
  const extBy = {};
  for (const e of extRows) (extBy[e.character_id] ??= []).push(e);
  const chainSum = Object.fromEntries((await q(`
    SELECT character_id, SUM(pct_sum) AS total FROM 'data/chains.parquet' GROUP BY character_id`))
    .map((r) => [r.character_id, Number(r.total)]));

  for (const rar of [5, 4]) {
    const g = rows.filter((r) => Number(r.rarity) === rar).sort((a, b) => Number(a.ref_multiplier) - Number(b.ref_multiplier));
    g.forEach((r, i) => (r.specPct = Math.round((i / Math.max(1, g.length - 1)) * 100)));
  }
  const EXT = { S: 100, A: 75, B: 50, C: 25, D: 0 };
  const EXT2 = { SS: 100, S: 85, A: 70, B: 50, C: 30, D: 10 };
  const now = Date.now();
  const scored = rows.map((r) => {
    const pts = [], srcLabels = [];
    if (r.ext_tier) { pts.push(EXT[r.ext_tier]); srcLabels.push(`wuthering.gg: ${r.ext_tier}`); }
    for (const e of (extBy[r.character_id] ?? [])) { pts.push(EXT2[e.tier] ?? 50); srcLabels.push(`${e.source}: ${e.tier}`); }
    const ext = pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : 60;
    const fresh = (now - toMs(r.release_date)) / 864e5 < 120;
    const reasons = [];
    const isBuffer = ["서포트", "힐러"].includes(r.role_section);   // 버퍼·힐러는 딜 배율이 실력이 아님
    const wSpec = isBuffer ? 0.15 : 0.5;
    const wExt = isBuffer ? 0.75 : 0.4;
    let score = wSpec * r.specPct + wExt * ext;
    reasons.push(isBuffer
      ? `외부 평가 중심 채점 (버프형이라 배율 비중 15%로 축소)`
      : `스펙 상위 ${100 - r.specPct}% (같은 성급 내)`);
    reasons.push(srcLabels.length ? `외부 평가 ${srcLabels.length}곳 — ${srcLabels.join(" · ")}` : "외부 평가 아직 없음(신상)");
    if (fresh) { score += 8; reasons.push("출시 120일 이내 신상 보정 +"); }
    if (r.risk_grade === "높음") { score -= 10; reasons.push("파워크리프 위험 −"); }
    if (r.lifespan_grade === "장수형") { score += 5; reasons.push("롱런 이력 +"); }
    const chainBoost = Math.min((chainSum[r.character_id] ?? 0) / 60, 12);
    return { ...r, score, reasons, chainBoost };
  });
  const grade = (v) => (v >= 82 ? "S" : v >= 66 ? "A" : v >= 50 ? "B" : v >= 35 ? "C" : "D");

  const SECTIONS = ["메인 딜러", "서브 딜러", "힐러", "서포트"];
  let mode = "0";
  const render = () => {
    for (const r of scored) r.labTier = grade(r.score + (mode === "6" ? r.chainBoost : 0));
    document.getElementById("tierboards").innerHTML = SECTIONS.map((sec) => {
      const grp = scored.filter((r) => (r.role_section ?? "서포트") === sec);
      if (!grp.length) return "";
      return `<h3>${sec} <span class="notice">(${grp.length}명 · 역할: Fandom 위키 인포박스)</span></h3>
        <div class="tierboard">${["S", "A", "B", "C", "D"].map((t) => {
          const list = grp.filter((r) => r.labTier === t).sort((a, b) => b.score - a.score);
          return list.length ? `<div class="tier-row tier-${t}"><span class="tier-label">${t}</span>
            ${list.map((r) => `<span class="chip r${r.rarity} clickable" data-cid="${r.character_id}">${r.name}</span>`).join("")}</div>` : "";
        }).join("")}</div>`;
    }).join("");
    document.querySelectorAll(".chip.clickable").forEach((el) =>
      el.addEventListener("click", () => {
        const r = scored.find((x) => String(x.character_id) === el.dataset.cid);
        const extra = mode === "6" ? [`6체인 보정 +${r.chainBoost.toFixed(0)} (체인 수치 누적 ${(chainSum[r.character_id] ?? 0).toFixed(0)}%p)`] : [];
        document.getElementById("tierwhy").innerHTML =
          `<p><b>${r.name}</b> — ${mode === "6" ? "6체인" : "체인0"} 기준 티어 <b>${r.labTier}</b>
             (점수 ${(r.score + (mode === "6" ? r.chainBoost : 0)).toFixed(0)})</p>
           <p class="notice">역할: ${r.role_full ?? "미확인"}</p>
           <p>${[...r.reasons, ...extra].map((x) => `<span class="chip">${x}</span>`).join(" ")}</p>`;
      }));
  };

  app.innerHTML = `<h2>연구소 티어 🏷️ <span class="notice">(데이터가 갱신되면 자동 재계산)</span></h2>
    <div class="simform">기준:
      <label><input type="radio" name="chainmode" value="0" checked> 체인0 (무돌)</label>
      <label><input type="radio" name="chainmode" value="6"> 6체인 (완돌)</label>
    </div>
    <details class="why"><summary>왜 이렇게 나왔어? (계산식 공개)</summary><p>
      점수(딜러) = 스펙 백분위 50% + 외부 평가 평균 40% + 보정(신상 +8 / 파워크리프 위험 −10 / 롱런 +5).
      점수(서포트·힐러) = 스펙 15% + 외부 평가 75% + 같은 보정 — 버프·힐 키트는 딜 배율이 낮은 게 정상이라서요.
      역할 구분은 Fandom 위키 인포박스의 role 필드(53명 자동 수집 + 방랑자 4형태 수기 지정).
      6체인 기준은 공명 체인 설명문의 % 수치 누적을 보정으로 더한 자체 산출이에요(60%p당 +1, 최대 +12) —
      외부 완돌 티어(Game8·gamewith)는 봇 차단·파싱 불가로 아직 미수집.
      캐릭터를 클릭하면 개별 근거가 떠요!</p></details>
    <div id="tierboards"></div>
    <div id="tierwhy" class="verdict" style="margin-top:12px"><p class="notice">캐릭터를 클릭하면 왜 그 티어인지 알려줘요 👆</p></div>`;
  document.querySelectorAll("input[name=chainmode]").forEach((el) =>
    el.addEventListener("change", () => { mode = el.value; render(); }));
  render();
}

/* ── 페이지: 인플레 연구실 ── */
async function pageInflation() {
  const pc = await q(`
    SELECT p.character_id, c.name, c.element, c.role, p.ref_multiplier, p.predicted, p.residual,
           p.release_date, p.inflation_slope_per_100d
    FROM 'data/gold_powercreep.parquet' p JOIN 'data/characters.parquet' c USING (character_id)
    WHERE p.rarity = 5 ORDER BY p.release_date`);
  const ms = (d) => toMs(d);
  const launch = Math.min(...pc.map((r) => ms(r.release_date)));
  const baseAvg = avg(pc.filter((r) => ms(r.release_date) - launch < 90 * 864e5).map((r) => Number(r.ref_multiplier)));
  const slope = Number(pc[0].inflation_slope_per_100d);

  app.innerHTML = `<h2>인플레 연구실 📈</h2>
    <p class="notice">전부 궁극기 배율 숫자 기준(스펙 추정)이에요 — 실전 성능·시너지는 픽률 데이터가 쌓여야 반영돼요.</p>`;

  // 1) 인플레 현황 미터
  const cohorts = {};
  for (const r of pc) {
    const t = new Date(ms(r.release_date));
    const key = `${t.getFullYear()}.${t.getMonth() < 6 ? "상반기" : "하반기"}`;
    (cohorts[key] ??= []).push(Number(r.ref_multiplier));
  }
  const keys = Object.keys(cohorts);
  const maxAvg = Math.max(...keys.map((k) => avg(cohorts[k])));
  app.insertAdjacentHTML("beforeend", `
    <h3>출시 시기별 평균 배율 — 인플레가 이만큼 진행됐어요</h3>
    <details class="why"><summary>왜 이렇게 나왔어?</summary><p>
      5성 캐릭터를 출시 반기별로 묶어 궁극기 최대 배율 합의 평균을 냈어요.
      회귀 기준 100일마다 약 +${slope.toFixed(0)}%p씩 오르는 중 — 초기 5성 대비 최신 5성이 얼마나 세졌는지의 지표예요.</p></details>
    <div class="bars">${keys.map((k) => {
      const v = avg(cohorts[k]);
      return `<div class="barrow"><span class="barlabel">${k} (${cohorts[k].length}명)</span>
        <div class="bar" style="width:${(v / maxAvg * 100).toFixed(0)}%"></div>
        <span class="barval">${v.toFixed(0)}%p · 초기의 ${(v / baseAvg).toFixed(1)}배</span></div>`;
    }).join("")}</div>`);

  // 3) 캐릭터끼리 인플레 비교기
  app.insertAdjacentHTML("beforeend", `
    <h3>1:1 인플레 비교기</h3>
    <div class="simform">
      <select id="cmpA">${pc.map((r, i) => `<option value="${i}">${r.name}</option>`).join("")}</select>
      vs
      <select id="cmpB">${pc.map((r, i) => `<option value="${i}" ${i === pc.length - 1 ? "selected" : ""}>${r.name}</option>`).join("")}</select>
    </div><div id="cmpout"></div>`);
  const cmp = () => {
    const a = pc[document.getElementById("cmpA").value];
    const b = pc[document.getElementById("cmpB").value];
    const [oldC, newC] = ms(a.release_date) <= ms(b.release_date) ? [a, b] : [b, a];
    const days = Math.round((ms(newC.release_date) - ms(oldC.release_date)) / 864e5);
    const expected = slope * days / 100;
    const actual = Number(newC.ref_multiplier) - Number(oldC.ref_multiplier);
    const ratio = Number(newC.ref_multiplier) / Number(oldC.ref_multiplier);
    document.getElementById("cmpout").innerHTML = `<div class="verdict">
      <p><b>${oldC.name}</b> (${fmt(oldC.release_date)}, ${Number(oldC.ref_multiplier).toFixed(0)}%p)
         → <b>${newC.name}</b> (${fmt(newC.release_date)}, ${Number(newC.ref_multiplier).toFixed(0)}%p)</p>
      <p>출시 차이 <b>${days}일</b> · 그 기간 인플레 기대 상승 <b>${expected >= 0 ? "+" : ""}${expected.toFixed(0)}%p</b></p>
      <p>실제 차이 <b>${actual >= 0 ? "+" : ""}${actual.toFixed(0)}%p</b> (${newC.name}가 ${oldC.name}의 ${ratio.toFixed(2)}배)</p>
      <p class="big">${actual > expected + 200 ? `${newC.name}, 인플레 감안해도 확실히 세게 나왔어요 💪`
        : actual < expected - 200 ? `${newC.name}, 신상인데 인플레 기대보다 배율은 얌전해요 🤔`
        : `딱 인플레 추세만큼의 차이 — 세대 차이가 곧 스펙 차이인 케이스예요 📏`}</p>
      <p class="notice">배율 합 비교라 역할이 다르면(딜러 vs 서포터) 직접 비교 의미가 약해요.</p></div>`;
  };
  document.getElementById("cmpA").onchange = cmp;
  document.getElementById("cmpB").onchange = cmp;
  cmp();
}
const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

/* ── 페이지: 파티 추천 ── */
async function pageTeams() {
  const chars = await q(`
    SELECT f.character_id, f.name, f.rarity, f.element, f.role, f.tier, f.role_cluster
    FROM 'data/gold_fit_features.parquet' f ORDER BY f.rarity DESC, f.name`);
  const inv = loadInv();
  const nowBanner = await q(`
    SELECT b.character_id, b.banner_name, b.banner_start, b.banner_end
    FROM 'data/banner_history.parquet' b
    WHERE b.kind = 'resonator' AND b.featured_rarity = 5
    ORDER BY b.banner_start DESC LIMIT 3`);
  app.innerHTML = `<h2>누구랑 짝꿍 해줄까? 🤝</h2>
    <p class="notice">갖고 있는 캐릭터에 체크하면 파티를 짜줄게! (이 브라우저에만 기억해 둠)</p>
    <div class="invgrid">${chars.map((c) => `
      <label class="invitem r${c.rarity}">
        <input type="checkbox" data-id="${c.character_id}" ${inv[c.character_id] !== undefined ? "checked" : ""}>
        ${c.name}
        <select class="chainsel" data-id="${c.character_id}" ${inv[c.character_id] === undefined ? "disabled" : ""}>
          ${[0,1,2,3,4,5,6].map((n) => `<option value="${n}" ${Number(inv[c.character_id]) === n ? "selected" : ""}>${n}체인</option>`).join("")}
        </select></label>`).join("")}</div>
    <button id="recbtn">파티 짜줘!</button><div id="recs"></div>
    <h3>지금 픽업 중인 애들과 내 궁합 💫</h3>
    <p class="notice">배너 데이터가 매주 자동 수집돼서, 새 픽업이 열리면 이 섹션도 알아서 바뀌어요.</p>
    <div id="pickupfit"></div>`;
  const renderPickupFit = () => {
    const owned = chars.filter((c) => loadInv()[c.character_id] !== undefined);
    const box = document.getElementById("pickupfit");
    box.innerHTML = nowBanner.map((b) => {
      const cand = chars.find((c) => Number(c.character_id) === Number(b.character_id));
      if (!cand) return "";
      if (!owned.length) return `<div class="verdict"><p><b>${cand.name}</b> (${b.banner_name})</p>
        <p class="notice">보유 캐릭터를 체크하면 궁합을 계산해줘요</p></div>`;
      const before = topCombos(owned, 999).length;
      const after = topCombos([...owned.filter((c) => c.character_id !== cand.character_id), cand], 999).length;
      const newTeamsRaw = Math.max(0, after - before);
      const dupes = owned.filter((c) => c.role_cluster === cand.role_cluster && c.character_id !== cand.character_id).length;
      const fit = Math.max(0, Math.min(100, 40 + Math.min(newTeamsRaw, 5) * 8 - dupes * 15 + (cand.tier === "S" ? 15 : cand.tier === "A" ? 8 : 0)));
      return `<div class="verdict"><p><b>${cand.name}</b> · ${cand.element} ${cand.role} — ${b.banner_name} (${fmt(b.banner_start)}~)</p>
        <p>궁합 <b>${fit}점</b> · 새 파티 ${newTeamsRaw > 5 ? "5+개" : newTeamsRaw + "개"} · 역할 겹침 ${dupes}명</p></div>`;
    }).join("");
  };
  renderPickupFit();
  app.querySelectorAll("input[type=checkbox]").forEach((el) =>
    el.addEventListener("change", () => {
      const cur = loadInv();
      const sel = app.querySelector(`select.chainsel[data-id="${el.dataset.id}"]`);
      if (el.checked) { cur[el.dataset.id] = Number(sel?.value ?? 0); sel && (sel.disabled = false); }
      else { delete cur[el.dataset.id]; sel && (sel.disabled = true); }
      saveInv(cur);
      renderPickupFit();
    }));
  app.querySelectorAll("select.chainsel").forEach((el) =>
    el.addEventListener("change", () => {
      const cur = loadInv();
      if (cur[el.dataset.id] !== undefined) { cur[el.dataset.id] = Number(el.value); saveInv(cur); renderPickupFit(); }
    }));
  document.getElementById("recbtn").onclick = () => {
    const owned = chars.filter((c) => loadInv()[c.character_id] !== undefined);
    const recs = recommend(owned);
    const box = document.getElementById("recs");
    box.innerHTML = "";
    for (const [label, list] of recs) {
      box.insertAdjacentHTML("beforeend", `<h3>${label}</h3>` + (list.length
        ? list.map((t) => `<div class="team"><b>${t.score}</b> ${t.members.map((m) =>
            `<span class="chip r${m.rarity}">${m.name}<i>${m.role}</i></span>`).join("")}</div>`).join("")
        : `<p class="notice">이 조건으론 파티가 안 나와요 😢 체크를 더 해볼까?</p>`));
    }
  };
}

const TIER_PT = { S: 5, A: 4, B: 3, C: 2, D: 1 };
function scoreTeam(t) {
  const inv = loadInv();
  let s = t.reduce((a, m) => a + (TIER_PT[m.tier] ?? 2), 0) * 10;         // 티어 기본점
  s += t.reduce((a, m) => a + Number(inv[m.character_id] ?? 0), 0) * 2;   // 보유 체인 보정 (+2/체인)
  if (new Set(t.map((m) => m.element)).size === 1) s += 8;                 // 단일 속성 시너지(아웃트로 딜증 가정)
  if (new Set(t.map((m) => m.role_cluster)).size === 3) s += 6;           // 스탯 클러스터 다양성
  return s;
}
function validTeam(t) {
  const roles = t.map((m) => m.role);
  return roles.filter((r) => r === "메인 DPS").length === 1 && roles.includes("서포트");
}
function topCombos(pool, n = 5) {
  const out = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++)
      for (let k = j + 1; k < pool.length; k++) {
        const t = [pool[i], pool[j], pool[k]];
        if (validTeam(t)) out.push({ members: t, score: scoreTeam(t) });
      }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}
function recommend(owned) {
  return [
    ["✨ 올스타 조합 (풀 5성)", topCombos(owned.filter((c) => c.rarity === 5))],
    ["🏠 현실 조합 (4성도 함께)", topCombos(owned)],
    ["🌱 무과금 조합 (4성만으로)", topCombos(owned.filter((c) => c.rarity === 4))],
  ];
}

/* ── 페이지: 캐릭터 분석 (내 계정 궁합 중심) ── */
async function pageVerdict() {
  const rows = await q(`SELECT * FROM 'data/gold_verdicts.parquet' WHERE rarity = 5 ORDER BY name`);
  const feats = await q(`SELECT * FROM 'data/gold_fit_features.parquet'`);
  const extRows = await q(`SELECT * FROM 'data/external_tiers.parquet'`).catch(() => []);
  const extBy = {};
  for (const e of extRows) (extBy[e.character_id] ??= []).push(e);
  const tags = await q(`SELECT * FROM 'data/skill_tags.parquet'`);
  const tagBy = Object.fromEntries(tags.map((t) => [t.character_id, t]));
  const chains = await q(`SELECT * FROM 'data/chains.parquet' ORDER BY character_id, chain_no`);
  app.innerHTML = `<h2>뽑아? 말아? 🤔</h2>
    <p class="notice">내 캐릭터 목록(짝꿍 탭에서 체크)과의 궁합으로 판단해요.</p>
    <select id="vsel">${rows.map((r, i) => `<option value="${i}">${r.name}</option>`).join("")}</select>
    몇 체인까지 뽑을 생각? <select id="chainsel">${[0,1,2,3,4,5,6].map((n) => `<option value="${n}">${n}체인</option>`).join("")}</select>
    <div id="vout"></div><div id="chainpreview"></div>`;
  const show = (i) => {
    const r = rows[i];
    const inv = loadInv();
    const owned = feats.filter((c) => inv[c.character_id] !== undefined);
    const cand = feats.find((c) => Number(c.character_id) === Number(r.character_id));

    const before = topCombos(owned, 999).length;
    const after = topCombos([...owned.filter((c) => c.character_id !== cand.character_id), cand], 999).length;
    const newTeamsRaw = Math.max(0, after - before);
    const newTeams = Math.min(newTeamsRaw, 5);
    const dupes = owned.filter((c) => c.role_cluster === cand.role_cluster && c.character_id !== cand.character_id).length;

    // 스킬(아웃트로) 궁합: 버프 대상 속성과 상대 속성 일치 검사 (양방향)
    const candTag = tagBy[cand.character_id] ?? {};
    const skillPairs = [];
    for (const o of owned) {
      if (o.character_id === cand.character_id) continue;
      const oTag = tagBy[o.character_id] ?? {};
      const oBuffs = (oTag.outro_buff_elements || "").split(",").filter(Boolean);
      const cBuffs = (candTag.outro_buff_elements || "").split(",").filter(Boolean);
      if (o.role !== "메인 DPS" && cand.role === "메인 DPS" && (oBuffs.includes(cand.element) || oBuffs.includes("전체")))
        skillPairs.push(`${o.name} 아웃트로 → ${cand.name}의 ${cand.element} 딜 직결`);
      if (cand.role !== "메인 DPS" && o.role === "메인 DPS" && (cBuffs.includes(o.element) || cBuffs.includes("전체")))
        skillPairs.push(`${cand.name} 아웃트로 → 보유 ${o.name}(${o.element}) 딜 직결`);
    }
    const skillBonus = Math.min(skillPairs.length * 6, 12);

    // 체인 시나리오: 실제 체인 설명의 % 수치 누적
    const candChains = chains.filter((c) => Number(c.character_id) === Number(cand.character_id));
    const targetChain = Number(document.getElementById("chainsel")?.value ?? 0);
    const chainGain = candChains.filter((c) => c.chain_no <= targetChain)
      .reduce((a, c) => a + Number(c.pct_sum), 0);
    const chainBonus = Math.min(Math.round(chainGain / 50), 8);   // 체인 수치 50%p당 +1, 상한 8

    const fit = Math.max(0, Math.min(100,
      40 + newTeams * 8 - dupes * 15 + (cand.tier === "S" ? 15 : cand.tier === "A" ? 8 : 0)
      + skillBonus + chainBonus));
    const newTeamsLabel = newTeamsRaw > 5 ? "5+개" : newTeamsRaw + "개";

    const freshButStrong = r.lifespan_grade === "관측중" && ["S", "A"].includes(r.tier) && r.risk_grade !== "높음";
    const lifeOK = ["장수형", "평균형"].includes(r.lifespan_grade) || freshButStrong;

    let verdict, reason;
    if (owned.length === 0) {
      verdict = "🎒 먼저 짝꿍 탭에서 보유 캐릭터를 체크해줘!";
      reason = "궁합 계산엔 네 캐릭터 목록이 필요해요";
    } else if (lifeOK && fit >= 60) {
      verdict = "💖 지금이 기회!";
      reason = freshButStrong
        ? `아직 신상이라 기록은 없지만 티어·스펙 신호가 좋고, 네 계정과 궁합 ${fit}점 (새 파티 ${newTeamsLabel})`
        : `오래갈 타입이고 네 계정과 궁합 ${fit}점 (새 파티 ${newTeamsLabel})`;
    } else if (r.risk_grade === "높음" && dupes >= 1) {
      verdict = "🙅 참는 게 이득";
      reason = `밀려날 걱정이 많은데 비슷한 역할을 이미 ${dupes}명 갖고 있어요`;
    } else if (!lifeOK && fit >= 80) {
      verdict = "🎲 조건부 — 네 마음이 답!";
      reason = `메타 체력은 애매한데 네 계정과는 궁합 ${fit}점으로 찰떡 (새 파티 ${newTeamsLabel})`;
    } else if (fit >= 50) {
      verdict = "🤔 나쁘지 않아요";
      reason = `궁합 ${fit}점 · 새 파티 ${newTeamsLabel} · 역할 겹침 ${dupes}명`;
    } else {
      verdict = "🙅 참는 게 이득";
      reason = `궁합 ${fit}점 — 새 파티 ${newTeamsLabel}, 역할 겹침 ${dupes}명이라 급하지 않아요`;
    }

    document.getElementById("vout").innerHTML = `<div class="verdict">
      <p><b>${r.name}</b> · ${r.element} ${r.role}</p>
      <p>외부 평가: ${[r.tier ? `wuthering.gg ${r.tier}` : null,
          ...(extBy[r.character_id] ?? []).map((e) => `${e.source} ${e.tier}`)]
          .filter(Boolean).join(" · ") || "아직 없음 (신상)"}</p>
      <p>메타 체력: ${cute(r.lifespan_grade)} · 밀려날 걱정: ${cute(r.risk_grade)}</p>
      <p>내 계정 궁합: <b>${owned.length ? fit + "점" : "—"}</b> · 새로 생기는 파티 ${owned.length ? newTeamsLabel : "—"} · 역할 겹침 ${owned.length ? dupes + "명" : "—"}</p>
      <p>스킬 궁합: ${skillPairs.length ? `+${skillBonus}점 — ${skillPairs.slice(0, 2).join(" / ")}` : "아웃트로 직결 조합 없음 (0점)"}</p>
      <p>체인 반영: ${targetChain}체인 기준 스킬 수치 누적 +${chainGain.toFixed(0)}%p → 궁합 +${chainBonus}점</p>
      <p class="big">${verdict}</p>
      <p class="notice">${reason}</p></div>`;
  };
  const renderChainPreview = (i) => {
    const r = rows[i];
    const cc = chains.filter((c) => Number(c.character_id) === Number(r.character_id));
    let cum = 0;
    document.getElementById("chainpreview").innerHTML = cc.length
      ? `<h3>체인별로 뭐가 얼마나 좋아져? 🔗</h3>
         <details class="why"><summary>왜 이렇게 나왔어?</summary><p>
           게임 데이터의 공명 체인 설명문에서 % 수치를 그대로 뽑아 누적한 거예요.
           크리·딜증·배율이 섞여 있어서 단순 합이 곧 딜 상승은 아니지만, 투자 대비 변화의 크기를 비교하기엔 충분해요.</p></details>
         <table><thead><tr><th>체인</th><th>이름</th><th>이번 체인 수치</th><th>누적</th></tr></thead><tbody>
         ${cc.map((c) => { cum += Number(c.pct_sum);
           return `<tr><td>${c.chain_no}</td><td>${c.chain_name}</td><td>+${Number(c.pct_sum).toFixed(0)}%p</td><td>+${cum.toFixed(0)}%p</td></tr>`; }).join("")}
         </tbody></table>`
      : "";
  };
  document.getElementById("vsel").onchange = (e) => { show(e.target.value); renderChainPreview(e.target.value); };
  document.getElementById("chainsel").onchange = () => show(document.getElementById("vsel").value);
  show(0); renderChainPreview(0);
}

/* ── 페이지: 어떻게 계산해? ── */
async function pageAbout() {
  app.innerHTML = `<h2>어떻게 계산해? 📚</h2>
  <div class="about">
  <h3>데이터는 어디서?</h3>
  <p>· 캐릭터 스탯·스킬 배율·아웃트로 텍스트·공명 체인: 게임 데이터 사이트에서 추출한 원본 JSON<br>
     · 배너 역사 138개: Wuthering Waves 위키 API (복각 예측 재료)<br>
     · 외부 평가: wuthering.gg 스냅샷 + PocketTactics (주간 자동 수집)<br>
     · 잔향의 탑 픽률: 커뮤니티 집계를 시즌별 CSV로 수집 중 — 쌓일수록 똑똑해져요</p>

  <h3>🏷️ 연구소 티어</h3>
  <p>점수 = 스펙 백분위 50% + 외부 평가 평균 40% + 보정(신상 +8 / 파워크리프 위험 −10 / 롱런 +5).
     캐릭터를 클릭하면 개별 근거가 떠요.</p>

  <h3>🔮 복각 예측</h3>
  <p>과거 등장일 간격의 중앙값과 25~75% 구간으로 다음 등장을 짐작해요 (전체 중앙값 약 140일).
     복각이 없던 캐릭터는 전체 평균으로 대신하고 그 사실을 표시해요.</p>

  <h3>💪 스펙 회귀 · 인플레</h3>
  <p>궁극기 최대 배율 합을 출시일에 회귀 — 100일마다 약 +79%p씩 오르는 중.
     표의 "얼마나 센지"는 또래 추세선 대비 잔차예요. 배율 숫자만 보므로 실전과 다를 수 있어요.</p>

  <h3>🐢 메타 체력</h3>
  <p>원래는 픽률 반감 시즌 수인데 데이터가 부족해 지금은 출시 경과 × 현재 평가로 임시 추정(proxy).
     3시즌 이상 쌓이면 자동으로 진짜 계산으로 전환. 신캐의 "👀 지켜보는 중"은 나쁘다는 뜻이 아니에요.</p>

  <h3>🤝 궁합 점수</h3>
  <p>기본 40 + 새 파티(개당 +8, 최대 5) − 역할 겹침(명당 −15) + 티어 보너스(S +15 / A +8)
     + 스킬 궁합(아웃트로 버프 속성이 상대 딜과 직결되면 쌍당 +6, 최대 +12)
     + 체인 반영(체인 설명문의 % 수치 누적 50%p당 +1, 최대 +8).
     역할 겹침은 기초 스탯 KMeans 군집(5그룹)으로 판단해요.</p>

  <h3>🤔 판정 규칙 (우선순위 순)</h3>
  <p>1. 수명 OK + 궁합 60↑ → 💖 지금이 기회!<br>
     2. 밀려날 걱정 많음 + 역할 겹침 → 🙅 참는 게 이득<br>
     3. 수명 애매 + 궁합 80↑ → 🎲 조건부<br>
     4. 나머지는 궁합 50점 기준으로 🤔/🙅 — 저울질 내역을 그대로 보여줘요</p>

  <h3>한계 고백 🙈</h3>
  <p>픽률 시계열이 얇아 메타 체력이 임시 추정이고, 스펙 회귀는 배율 숫자만 봐요.
     스킬 궁합 태그는 텍스트 파싱이라 33/57명만 잡혔고, Prydwen·Game8은 봇 차단으로 미수집.
     그래서 모든 지표는 점 하나가 아니라 구간·등급·근거와 함께 말해요.</p>
  </div>`;
}

/* ── 공용 ── */
function renderTable(title, rows, cols, why) {
  if (!rows.length) return;
  cols = cols ?? Object.keys(rows[0]);
  app.insertAdjacentHTML("beforeend",
    `<h3>${title}</h3>${why ? `<details class="why"><summary>왜 이렇게 나왔어?</summary><p>${why}</p></details>` : ""}<table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
     <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${r[c] ?? "—"}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
}

/* ── 라우팅 ── */
const pages = { meta: pageMeta, labtier: pageLabTier, inflation: pageInflation, teams: pageTeams, verdict: pageVerdict, about: pageAbout };
document.querySelectorAll("nav a").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll("nav a").forEach((x) => x.classList.remove("on"));
    a.classList.add("on");
    app.innerHTML = `<p class="loading">계산하는 중… ✍️</p>`;
    pages[a.dataset.page]().catch((err) => (app.innerHTML = `<p class="notice">앗, 뭔가 꼬였어요 🙈 ${err.message}</p>`));
  }));
pageMeta().catch((err) => (app.innerHTML = `<p class="notice">앗, 뭔가 꼬였어요 🙈 ${err.message}</p>`));
