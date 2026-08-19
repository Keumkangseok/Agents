// ONEMOVE 예약 API 클라이언트 (읽기 전용 — 회원 조회만 사용)
//
// 인증/엔드포인트는 onemove-reservation-api 스킬 문서에서 실측 검증된 내용을 따릅니다.
// 참고: 기존 onemove-daily-report/onemove-crm-agent 프로젝트가 이미 이 API를 정상적으로
// 호출하고 있으니, 이 파일 실행 후 문제가 생기면 그 프로젝트의 api client 코드와 비교해보세요.

const BASE_URL = process.env.RESERVATION_API_BASE_URL || "https://api-reservation.onemove.co.kr";
// WAF가 User-Agent 없는 요청을 403으로 막기 때문에 반드시 넣어야 함
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) onemove-churn-agent/0.1";

let cachedToken = null;

async function signIn() {
  const res = await fetch(`${BASE_URL}/api/v1/auth/sign-in`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      username: process.env.RESERVATION_API_USERNAME,
      password: process.env.RESERVATION_API_PASSWORD,
    }),
  });

  if (!res.ok) {
    throw new Error(`로그인 실패: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // 토큰이 응답의 어느 필드에 들어있는지 확실치 않아 후보를 순서대로 확인
  // (Laravel Sanctum 스타일 "{id}|{random_hash}" 형태, 로그인마다 값이 바뀜 — 하드코딩 금지)
  const token = data.token || data.body?.token || data.accessToken || data.access_token;
  if (!token) {
    throw new Error(`응답에서 토큰을 찾을 수 없음, 실제 응답 형태를 확인해야 함: ${JSON.stringify(data)}`);
  }
  return token;
}

async function getToken() {
  if (!cachedToken) {
    cachedToken = await signIn();
  }
  return cachedToken;
}

async function apiGet(path, params = {}) {
  const token = await getToken();
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    throw new Error(`API 호출 실패 (${path}): ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// 최근 N일간 미방문 회원 후보 조회 (읽기 전용)
// MVP 범위: noVisitsPeriod 필터만 사용 (만료 임박 등 다른 신호는 다음 단계에서 추가)
async function listNoVisitCandidates(noVisitsPeriodDays) {
  const franchiseId = process.env.RESERVATION_FRANCHISE_ID || "1";
  return apiGet("/api/v1/members", {
    franchise: franchiseId,
    noVisitsPeriod: noVisitsPeriodDays,
  });
}

module.exports = { listNoVisitCandidates };
