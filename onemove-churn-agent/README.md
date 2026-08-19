# onemove-churn-agent

원무브 회원 이탈 위험 감지 & 대응 에이전트. 설계 배경은 `naver-rank-tracker` 저장소의
`docs/churn-risk-agent-design.md` 참고.

## 진행 단계

- [x] 1단계 — 장난감 예제 (`01-toy-example.js`): 가짜 회원 데이터로 "도구함 + 목표 → AI가 스스로
  판단"하는 에이전트 루프를 확인
- [x] 2단계 — 읽기 전용 도구를 진짜 원무브 데이터에 연결 (`02-real-data-readonly.js`): 구조는
  1단계와 동일하고 `list_members`만 실제 API 호출로 교체. `flag_risky_member`는 여전히 화면
  출력만 함 (안전). **로컬(맥)에서 실행 후 결과 확인 필요 — 실제 API 응답 필드가 코드에서
  가정한 것과 다를 수 있음, 실행 결과 보고 다듬을 것**
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
