-- ⑧ 복각 가치 판정 최상위 뷰 — 완성본 (궁합·확보확률은 개인 입력이라 사이트에서 실시간 결합)
CREATE OR REPLACE VIEW gold_verdicts AS
SELECT
  c.character_id, c.name, c.rarity, c.element, c.role, c.tier,
  f.lifespan_grade, f.risk_grade, f.role_cluster,
  r.run_count, r.last_run, r.gap_median, r.next_rerun_early, r.next_rerun_late, r.censored,
  CASE
    WHEN f.lifespan_grade = '장수형' AND f.risk_grade = '낮음' THEN '지금 뽑기 후보'
    WHEN f.lifespan_grade IN ('장수형','평균형')
         AND DATEDIFF('day', CURRENT_DATE, r.next_rerun_early) < 60 THEN '다음 복각 대기 후보'
    WHEN f.risk_grade = '높음' THEN '스킵 후보'
    ELSE '조건부 — 계정 궁합으로 판단'
  END AS base_verdict
FROM 'site/public/data/characters.parquet' c
LEFT JOIN 'site/public/data/gold_fit_features.parquet' f USING (character_id)
LEFT JOIN (FROM gold_rerun_gaps) r USING (character_id);
