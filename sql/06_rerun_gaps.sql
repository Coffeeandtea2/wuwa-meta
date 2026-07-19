-- ⑥ 복각 간격 gold 뷰 — 완성본
CREATE OR REPLACE VIEW gold_rerun_gaps AS
WITH runs AS (
  SELECT character_id, name_en, banner_start,
         LAG(banner_start) OVER (PARTITION BY character_id ORDER BY banner_start) AS prev_start
  FROM 'site/public/data/banner_history.parquet'
  WHERE kind = 'resonator' AND featured_rarity = 5 AND character_id IS NOT NULL
),
gaps AS (
  SELECT *, DATEDIFF('day', prev_start, banner_start) AS gap_days
  FROM runs
),
stats AS (
  SELECT character_id,
         COUNT(*)                                   AS run_count,
         MAX(banner_start)                          AS last_run,
         MEDIAN(gap_days)                           AS gap_median,
         QUANTILE_CONT(gap_days, 0.25)              AS gap_q1,
         QUANTILE_CONT(gap_days, 0.75)              AS gap_q3
  FROM gaps GROUP BY character_id
),
overall AS (SELECT MEDIAN(gap_days) AS m, QUANTILE_CONT(gap_days,0.25) q1, QUANTILE_CONT(gap_days,0.75) q3 FROM gaps WHERE gap_days IS NOT NULL)
SELECT s.character_id, s.run_count, s.last_run,
       COALESCE(s.gap_median, o.m)  AS gap_median,
       COALESCE(s.gap_q1, o.q1)     AS gap_q1,
       COALESCE(s.gap_q3, o.q3)     AS gap_q3,
       s.gap_median IS NULL         AS censored,   -- 복각 0회 → 전체 분포로 대체
       s.last_run + INTERVAL (COALESCE(s.gap_q1, o.q1)::INT) DAY AS next_rerun_early,
       s.last_run + INTERVAL (COALESCE(s.gap_q3, o.q3)::INT) DAY AS next_rerun_late
FROM stats s CROSS JOIN overall o;
