// 구글 시트로 이탈 위험 결과를 기록하고, "연락완료" 체크된 회원은 다음 실행부터 제외한다.
//
// 컬럼 구성 (A~F): 날짜 | 위험도 | 회원ID | 회원명 | 요약 | 연락완료(체크박스)
// 연락완료 체크박스는 직원이 직접 연락한 뒤 체크하면 됨 — 다음 실행부터 그 회원ID는
// 자동으로 신고 대상에서 빠진다 (코드에서 필터링, AI 판단에 맡기지 않음 — 더 확실함).

const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_TAB_NAME || "이탈위험목록";
const HEADER = ["날짜", "위험도", "회원ID", "회원명", "요약", "연락완료"];

let sheetsClientPromise = null;

function getSheetsClient() {
  if (!sheetsClientPromise) {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_FILE이 설정되지 않았습니다 (.env 확인)");
    }
    if (!SPREADSHEET_ID) {
      throw new Error("GOOGLE_SHEET_ID가 설정되지 않았습니다 (.env 확인)");
    }
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClientPromise = auth.getClient().then((client) => google.sheets({ version: "v4", auth: client }));
  }
  return sheetsClientPromise;
}

// 시트가 비어있으면 헤더를 쓰고, 연락완료 열에 체크박스 서식을 입혀준다 (최초 1회만 필요, 매번 불러도 안전).
async function ensureSheetSetup() {
  const sheets = await getSheetsClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const targetSheet = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  if (!targetSheet) {
    throw new Error(
      `구글 시트에 "${SHEET_NAME}" 탭이 없습니다. 시트 하단에 그 이름으로 탭을 먼저 만들어주세요.`
    );
  }
  const sheetId = targetSheet.properties.sheetId;

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:F1`,
  });
  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:F1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [HEADER] },
    });
  }

  // F열(연락완료)에 체크박스 서식 적용 (이미 되어 있어도 다시 적용해서 문제 없음)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 },
            rule: { condition: { type: "BOOLEAN" }, strict: true },
          },
        },
      ],
    },
  });
}

// 연락완료(F열 TRUE)로 표시된 회원ID 목록을 가져온다.
async function getContactedMemberIds() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:F`,
  });
  const rows = res.data.values || [];
  const contacted = new Set();
  rows.forEach((row) => {
    const memberId = row[2];
    const contactedFlag = row[5];
    if (memberId && String(contactedFlag).toUpperCase() === "TRUE") {
      contacted.add(String(memberId));
    }
  });
  return contacted;
}

async function appendFlaggedMembers(entries) {
  if (entries.length === 0) return;
  const sheets = await getSheetsClient();
  const today = new Date().toISOString().slice(0, 10);
  const values = entries.map((e) => [
    today,
    e.risk_level,
    e.member_id,
    e.member_name,
    e.plain_summary,
    false,
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:F`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

function sheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
}

module.exports = { ensureSheetSetup, getContactedMemberIds, appendFlaggedMembers, sheetUrl };
