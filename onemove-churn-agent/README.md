# onemove-churn-agent

원무브 회원 이탈 위험 감지 & 대응 에이전트. 설계 배경은 `naver-rank-tracker` 저장소의
`docs/churn-risk-agent-design.md` 참고.

## 진행 단계

- [x] 1단계 — 장난감 예제 (`01-toy-example.js`): 가짜 회원 데이터로 "도구함 + 목표 → AI가 스스로
  판단"하는 에이전트 루프를 확인
- [ ] 2단계 — 읽기 전용 도구를 진짜 원무브 데이터(ONEMOVE 예약 API)에 연결
- [ ] 3단계 — 메시지 초안 생성 도구 추가
- [ ] 4단계 — Slack 승인 워크플로 연결
- [ ] 5단계 — 스케줄링 (로컬 launchd 또는 GitHub Actions)

## 실행 방법 (로컬, 맥)

```bash
cd onemove-churn-agent
npm install
cp .env.example .env   # .env에 본인 ANTHROPIC_API_KEY 채워넣기
npm run toy
```

## 참고

- 이 저장소는 원무브 예약 API(`api-reservation.onemove.co.kr`)에 접근하지 않는 단계까지만
  다룹니다. 2단계부터는 로컬 Claude Code(맥)에서 진행 — Cowork/클라우드 세션은 해당 도메인이
  allowlist에 없어 직접 호출이 막혀 있습니다 (`onemove-reservation-api` 스킬 참고).
