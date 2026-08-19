// 구글 시트 연동 — 앱스 스크립트 웹 앱 방식 (슬랙 웹훅과 완전히 동일한 패턴).
// 구글 클라우드 콘솔/서비스 계정 불필요 — apps-script/Code.gs를 시트에 배포하고 생긴
// 웹 앱 URL(.env의 GOOGLE_APPS_SCRIPT_URL)로 그냥 fetch POST만 하면 된다.

function scriptUrl() {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!url) {
    throw new Error("GOOGLE_APPS_SCRIPT_URL이 설정되지 않았습니다 (.env 확인)");
  }
  return url;
}

async function callScript(body) {
  const res = await fetch(scriptUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`구글 시트 통신 실패: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`구글 시트 오류: ${data.error}`);
  }
  return data;
}

// 연락완료(체크박스 체크됨)로 표시된 회원ID 목록을 가져온다.
async function getContactedMemberIds() {
  const data = await callScript({ action: "getContacted" });
  return new Set(data.contactedIds || []);
}

async function appendFlaggedMembers(entries) {
  if (entries.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  await callScript({ action: "append", date: today, entries });
}

// 슬랙 메시지에 넣을, 사람이 실제로 열어보는 시트 링크 (앱스 스크립트 URL과는 다른 값).
function sheetUrl() {
  return process.env.GOOGLE_SHEET_VIEW_URL || null;
}

module.exports = { getContactedMemberIds, appendFlaggedMembers, sheetUrl };
