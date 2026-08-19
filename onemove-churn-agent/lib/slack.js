// Slack Incoming Webhook으로 결과 요약 전송 (naver-rank-tracker/reporter/slack.js와 동일 패턴)

function buildSummaryText(flaggedResults, sheetUrl) {
  const order = { high: 0, medium: 1, low: 2 };
  const byLevel = { high: [], medium: [], low: [] };
  flaggedResults.forEach((r) => byLevel[r.risk_level].push(r));

  const lines = [];
  lines.push(`*🚨 원무브 이탈 위험 점검 (${new Date().toISOString().slice(0, 10)})*`);
  lines.push(`high ${byLevel.high.length}명 / medium ${byLevel.medium.length}명 / low ${byLevel.low.length}명`);
  lines.push("");

  lines.push(`*🔴 지금 컨택 필요 (high) — ${byLevel.high.length}명*`);
  if (byLevel.high.length === 0) {
    lines.push("_없음_");
  } else {
    byLevel.high.forEach((r) => {
      lines.push(`• ${r.plain_summary}`);
    });
  }
  lines.push("");
  lines.push(
    sheetUrl
      ? `medium/low 전체 명단과 연락완료 체크는 구글 시트에서: ${sheetUrl}`
      : "medium/low 전체 명단은 구글 시트에서 확인하세요."
  );
  lines.push("_연락하셨으면 시트의 '연락완료' 칸에 체크해주세요 — 다음 리포트부터 자동으로 빠집니다._");

  return lines.join("\n").trim();
}

async function sendReport(text) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL이 설정되지 않았습니다 (.env 확인)");
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack 전송 실패: ${res.status} ${body}`);
  }
}

module.exports = { buildSummaryText, sendReport };
