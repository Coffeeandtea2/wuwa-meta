# 명조 메타 · 뽑기 분석기

"신캐든 복각이든, 미래 메타 기준으로 지금 뽑을 가치가 있나?"

정적 사이트(Cloudflare Pages) + 브라우저 내 SQL(DuckDB-WASM). 서버 비용 0원.
ML/SQL 연습 프로젝트라 분석 코드는 골격 + 힌트 주석으로만 제공됨 — 채우는 게 과제.

## 구조

```
site/       Vite + DuckDB-WASM 프론트 (인프라 코드는 완성, 기능은 TODO)
scripts/    raw JSON → parquet 파이프라인 (STEP 1 과제)
sql/        gold 뷰 골격 — 윈도우 함수·JOIN·CASE 연습 (③⑥⑧)
ml/         회귀·수명·분류 골격 (④⑤⑦)
data/       raw(직접 압축 해제) · manual(픽률 수기 수집 CSV)
.github/    주간 데이터 갱신 크론
```

## 로컬 실행 (지금 바로 동작)

```bash
cd site
npm install
npm run dev     # → 티어보드가 뜨면 DuckDB-WASM 파이프라인 정상
```

## 배포 (Cloudflare Pages)

1. 이 레포를 GitHub에 push
2. Cloudflare dash → Workers & Pages → Pages → Connect to Git
3. Root directory `site`, Build command `npm run build`, Output `dist`
4. 이후 push마다 자동 배포. Actions 크론이 주 1회 데이터 커밋 → 자동 재배포

## 작업 순서 (= 계획표 로드맵)

1. `scripts/build_data.py` 완성 → parquet 생성 (v0.1)
2. `sql/03_meta_trends.sql` TODO 채우고 대시보드 렌더 (v0.2)
3. `main.js`의 renderTeamRecs + `scripts/fetch_banners.py` (v0.3)
4. `ml/04, 05` (v0.4) → `ml/07` + simulatePulls (v0.5)
5. `sql/08_verdict_view.sql` + renderVerdict (v1.0)

상세: 명조_메타_뽑기_분석기_계획표_v1.md, 명조_사이트_구축_가이드.md 참조
