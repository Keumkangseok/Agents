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
//
// /members는 페이지네이션이 있어서(응답 {total, data}) 한 번 호출로는 일부만 내려온다.
// total을 다 채울 때까지 offset을 늘려가며 반복 조회해서 전체를 모아 반환한다.
async function listNoVisitCandidates(noVisitsPeriodDays) {
  const franchiseId = process.env.RESERVATION_FRANCHISE_ID || "1";
  const limit = 100;
  let offset = 0;
  let all = [];
  let total = null;
  const seenFirstIds = new Set();

  for (let page = 0; page < 50; page += 1) {
    // 안전장치: offset이 무시되고 API가 총 5000명 이상을 준다고 우겨도 50페이지에서 멈춤
    const result = await apiGet("/api/v1/members", {
      franchise: franchiseId,
      noVisitsPeriod: noVisitsPeriodDays,
      offset,
      limit,
    });

    const records = Array.isArray(result.data) ? result.data : [];
    if (total === null) total = typeof result.total === "number" ? result.total : null;
    if (records.length === 0) break;

    // offset이 실제로는 무시되고 매번 같은 첫 페이지가 오는 경우 감지 (무한루프 방지)
    const firstId = records[0]?.id;
    if (firstId !== undefined && seenFirstIds.has(firstId)) break;
    if (firstId !== undefined) seenFirstIds.add(firstId);

    all = all.concat(records);
    offset += records.length;

    if (total !== null && all.length >= total) break;
    if (records.length < limit) break; // 마지막 페이지로 간주
  }

  return { total: total ?? all.length, data: all };
}

// 특정 월(YYYY-MM)의 실제 결제/환불 내역 전체를 조회한다 (읽기 전용).
// 회원별 필터 파라미터가 있는지 확실치 않아 월 단위 전체를 그대로 반환한다 —
// 특정 회원과 대조하려면 응답 안에서 이름/id로 직접 찾아야 한다 (호출하는 쪽에서 처리).
async function getTransactionsByMonth(yearMonth) {
  const franchiseId = process.env.RESERVATION_FRANCHISE_ID || "1";
  return apiGet("/api/v1/transactions", {
    franchise: franchiseId,
    date: yearMonth,
  });
}

module.exports = { listNoVisitCandidates, getTransactionsByMonth };
