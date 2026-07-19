-- ③ 메타 대시보드 gold 뷰 — 완성본 (toa_usage가 쌓이는 만큼 자동 반영)
CREATE OR REPLACE VIEW gold_meta_trends AS
WITH usage AS (
  SELECT season_id, character_id, pick_rate
  FROM 'site/public/data/toa_usage.parquet'
),
w AS (
  SELECT season_id, character_id, pick_rate,
         pick_rate - LAG(pick_rate) OVER (PARTITION BY character_id ORDER BY season_id) AS delta,
         RANK() OVER (PARTITION BY season_id ORDER BY pick_rate DESC)                   AS season_rank,
         AVG(pick_rate) OVER (PARTITION BY character_id ORDER BY season_id
                              ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)                 AS ma3
  FROM usage
)
SELECT *,
       CASE WHEN delta >  0.05 THEN '급상승'
            WHEN delta >  0.01 THEN '상승'
            WHEN delta < -0.05 THEN '급하락'
            WHEN delta < -0.01 THEN '하락'
            WHEN delta IS NULL THEN '신규'
            ELSE '유지' END AS trend_label
FROM w;
