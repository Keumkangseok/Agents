// 구글 앱스 스크립트 — 이 파일은 Node에서 실행되지 않습니다.
// 구글 시트의 "확장 프로그램 → Apps Script" 편집기에 이 내용을 그대로 붙여넣고 웹 앱으로
// 배포하세요 (README "구글 시트 연결 (앱스 스크립트 방식)" 참고).
//
// 구글 클라우드 콘솔, 서비스 계정, API 키 전부 필요 없습니다 — 이 코드를 배포하면 생기는
// 웹 앱 URL 하나로 슬랙 웹훅과 똑같은 방식으로 통신합니다.
//
// 코드를 수정한 뒤에는 "배포 → 배포 관리 → 연필 아이콘 → 새 버전"으로 다시 배포해야
// 반영됩니다 (URL은 그대로 유지됨).

const SHEET_NAME = "이탈위험목록";
const HEADER = ["날짜", "위험도", "회원ID", "회원명", "요약", "메시지초안", "연락완료"];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  return sheet;
}

// 실제 데이터가 있는 마지막 행을 A열(날짜)이 채워진 곳까지 직접 센다.
// sheet.getLastRow()는 체크박스 서식만 미리 입혀놔도 "내용 있음"으로 착각해서
// 엉뚱하게 먼 행(예: 1000번째 근처)에 새 데이터를 써버리는 문제가 있었음 — 그래서 안 씀.
function findLastDataRow_(sheet) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < 2) return 1;
  const colA = sheet.getRange(2, 1, maxRows - 1, 1).getValues();
  let lastRow = 1;
  for (let i = 0; i < colA.length; i++) {
    if (colA[i][0] !== "") lastRow = i + 2;
  }
  return lastRow;
}

// 실제로 데이터가 있는 행에만 체크박스 서식을 입힌다 (미리 넓게 깔지 않음).
function applyCheckboxFormat_(sheet, fromRow, toRow) {
  if (toRow < fromRow) return;
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(fromRow, 7, toRow - fromRow + 1, 1).setDataValidation(rule);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;

  if (action === "append") {
    const sheet = getSheet_();
    const startRow = findLastDataRow_(sheet) + 1;
    const rows = (body.entries || []).map((entry) => [
      body.date,
      entry.risk_level,
      entry.member_id,
      entry.member_name,
      entry.plain_summary,
      entry.message_draft || "",
      false,
    ]);
    if (rows.length > 0) {
      sheet.getRange(startRow, 1, rows.length, HEADER.length).setValues(rows);
      applyCheckboxFormat_(sheet, startRow, startRow + rows.length - 1);
    }
    return jsonResponse_({ ok: true, appended: rows.length, startRow });
  }

  if (action === "getContacted") {
    const sheet = getSheet_();
    const lastDataRow = findLastDataRow_(sheet);
    if (lastDataRow < 2) return jsonResponse_({ ok: true, contactedIds: [] });
    const data = sheet.getRange(2, 1, lastDataRow - 1, HEADER.length).getValues();
    const contactedIds = data.filter((row) => row[6] === true).map((row) => String(row[2]));
    return jsonResponse_({ ok: true, contactedIds });
  }

  return jsonResponse_({ ok: false, error: "알 수 없는 action: " + action });
}
