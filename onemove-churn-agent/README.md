# onemove-churn-agent

원무브 회원 이탈 위험 감지 & 대응 에이전트. 설계 배경은 `naver-rank-tracker` 저장소의
`docs/churn-risk-agent-design.md` 참고.

## 진행 단계

- [x] 1단계 — 장난감 예제 (`01-toy-example.js`): 가짜 회원 데이터로 "도구함 + 목표 → AI가 스스로
  판단"하는 에이전트 루프를 확인
- [x] 2단계 — 읽기 전용 도구를 진짜 원무브 데이터에 연결 (`02-real-data-readonly.js`): 실제
  API로 첫 실행 성공 (2026-08-19). `recentVisits`/`avgVisits` 같은 단순 필드가 실제 API엔 없어서,
  AI가 `joinedAt`/`attendedAt`/패스 유효기간(`startedAt`~`endedAt`)을 스스로 비교하는 방식으로
  판단 기준을 즉석에서 만들어냄 — 하드코딩된 로직이 아니라는 걸 실데이터로 확인.

  **실행 노트**: 첫 실행에서 `noVisitsPeriod=14` 후보가 전부 "체험권만 받고 정식 등록 안 한
  사람"이었음 (일주일 체험권 등). 이건 "이탈"이 아니라 "체험 미전환"이라 성격이 다름 → 시스템
  프롬프트/도구 설명에 "정식(비체험) 계약 이력이 있는 회원만 대상"으로 필터링 지시 추가함.
  체험 미전환자 팔로업은 추후 별도 과제로 분리 고려. 또한 `flag_risky_member`에 `reason` 필드가
  누락된 채 호출된 사례가 있어 `strict: true`로 필수값 강제 처리함.

  `/members` 응답이 페이지네이션되어 있어(total 282, 페이지당 15) 처음엔 첫 페이지만 보고 있었음
  → `reservationApi.js`에서 offset을 늘려가며 끝까지 모아오도록 수정. 282명 전체를 검토하면서
  생각(thinking)에 토큰을 많이 써서 `max_tokens` 8000에서 응답 없이 끊기는 문제 발생 →
  스트리밍 + `max_tokens: 16000` + `effort: "medium"`으로 해결.

  282명 전체 실행 결과: 158명 체험 미전환(제외), 80명 신고, 20명은 "레뷰 체험단" 패스라 AI가
  스스로 판단 보류(강석 확인 요청) — **데이터에 없는 걸 추측하지 않고 사람에게 물어본 좋은 사례**.
  확인 결과: 레뷰체험단은 기간이 2주면 최초 신청 시 발급되는 체험용(제외), 3개월권처럼 길면
  정식 유료 회원(포함)이라는 규칙 확인 → 프롬프트에 반영. 또한 80명이 "패스 유효기간 남았는데
  안 옴(지금 잡아야 함)"부터 "10개월 전에 이미 떠남(사실상 이탈 완료)"까지 긴급도가 섞여 있어
  실무에서 우선순위 판단이 안 됨 → `flag_risky_member`에 `risk_level`(high/medium/low) 필드
  추가해서 긴급도별로 구분되게 함.
- [ ] 3단계 — 메시지 초안 생성 도구 추가
- [ ] 4단계 — Slack 승인 워크플로 연결
- [ ] 5단계 — 스케줄링 (로컬 launchd 또는 GitHub Actions)

## 실행 방법 (로컬, 맥)

```bash
cd onemove-churn-agent
npm install
cp .env.example .env   # .env에 본인 ANTHROPIC_API_KEY 채워넣기 (2단계부터는 RESERVATION_* 값도)
npm run toy      # 1단계: 가짜 데이터
npm run step2    # 2단계: 진짜 원무브 데이터 (읽기 전용, 반드시 맥에서 실행)
```

## 참고

- 1단계는 어디서든 실행 가능하지만, 2단계부터는 원무브 예약 API(`api-reservation.onemove.co.kr`)에
  접속해야 해서 반드시 로컬 Claude Code(맥)에서 실행 — Cowork/클라우드 세션은 해당 도메인이
  allowlist에 없어 직접 호출이 막혀 있습니다 (`onemove-reservation-api` 스킬 참고).
- `RESERVATION_API_USERNAME`/`PASSWORD` 값은 기존 `onemove-crm-agent/.env` 또는
  `onemove-daily-report/.env`에 이미 있는 값을 그대로 복사해서 씁니다.
