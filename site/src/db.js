// db.js — DuckDB-WASM 초기화 (인프라: 완성 코드, 수정 불필요)
import * as duckdb from "@duckdb/duckdb-wasm";

let db = null;
let conn = null;

export async function initDB() {
  if (conn) return conn;

  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  conn = await db.connect();

  // 정적 데이터 파일 등록 — 새 parquet/json을 추가하면 여기에 한 줄씩
  const base = window.location.origin + import.meta.env.BASE_URL;
  const files = [
    "characters_master.json",
    "tier-list.json",
    "tier_summary.json",
    "characters.parquet",
    "banner_history.parquet",
    "seasons.parquet",
    "toa_usage.parquet",
    "skills_long.parquet",
    "gold_powercreep.parquet",
    "gold_lifespan.parquet",
    "gold_fit_features.parquet",
    "gold_rerun_gaps.parquet",
    "gold_verdicts.parquet",
    "external_tiers.parquet",
    "skill_tags.parquet",
    "chains.parquet",
    "roles.parquet",
  ];
  for (const f of files) {
    await db.registerFileURL(`data/${f}`, `${base}data/${f}`, duckdb.DuckDBDataProtocol.HTTP, false);
  }

  // JSON → 뷰 생성 (parquet은 등록만 하면 FROM 'data/x.parquet'로 바로 조회 가능)
  await conn.query(`CREATE VIEW characters AS SELECT * FROM read_json_auto('data/characters_master.json')`);

  return conn;
}

export async function q(sql) {
  const c = await initDB();
  const result = await c.query(sql);
  return result.toArray().map((row) => row.toJSON());
}
