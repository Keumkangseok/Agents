// 구글 앱스 스크립트 — 이 파일은 Node에서 실행되지 않습니다.
// 구글 시트의 "확장 프로그램 → Apps Script" 편집기에 이 내용을 그대로 붙여넣고 웹 앱으로
// 배포하세요 (README "구글 시트 연결 (앱스 스크립트 방식)" 참고).
//
// 구글 클라우드 콘솔, 서비스 계정, API 키 전부 필요 없습니다 — 이 코드를 배포하면 생기는
// 웹 앱 URL 하나로 슬랙 웹훅과 똑같은 방식으로 통신합니다.

const SHEET_NAME = "이탈위험목록";
const HEADER = ["날짜", "위험도", "회원ID", "회원명", "요약", "연락완료"];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  ensureSetup_(sheet);
  return sheet;
}

// 헤더가 없으면 만들고, 연락완료(F열)에 체크박스 서식을 입힌다 (여러 번 호출해도 안전).
function ensureSetup_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
  const hasHeader = firstRow.some((v) => v !== "");
  if (!hasHeader) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  }
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(2, 6, 1000, 1).setDataValidation(rule);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;

  if (action === "append") {
    const sheet = getSheet_();
    const rows = (body.entries || []).map((entry) => [
      body.date,
      entry.risk_level,
      entry.member_id,
      entry.member_name,
      entry.plain_summary,
      false,
    ]);
    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
    }
    return jsonResponse_({ ok: true, appended: rows.length });
  }

  if (action === "getContacted") {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonResponse_({ ok: true, contactedIds: [] });
    const data = sheet.getRange(2, 1, lastRow - 1, HEADER.length).getValues();
    const contactedIds = data.filter((row) => row[5] === true).map((row) => String(row[2]));
    return jsonResponse_({ ok: true, contactedIds });
  }

  return jsonResponse_({ ok: false, error: "알 수 없는 action: " + action });
}
