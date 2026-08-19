// 02-real-data-readonly.js
//
// [2단계] 읽기 전용으로 진짜 원무브 데이터에 연결
//
// 1단계(01-toy-example.js)와 구조는 똑같습니다 — 도구함 + 목표만 주고 AI가 스스로 판단.
// 달라진 건 list_members가 이제 가짜 데이터가 아니라 진짜 원무브 API를 호출한다는 것뿐입니다.
// flag_risky_member는 여전히 화면 출력만 합니다 — 이 단계에서 AI가 뭘 판단하든 실제로는
// 아무 일도 안 일어나니 안심하고 돌려보셔도 됩니다.
//
// [실행 전 준비]
//   .env에 아래 값 채워넣기 (기존 onemove-crm-agent/.env 또는 onemove-daily-report/.env에서
//   같은 값을 이미 쓰고 있으니 그대로 복사해와도 됩니다):
//     RESERVATION_API_USERNAME=...
//     RESERVATION_API_PASSWORD=...
//   실행: npm run step2  (또는 node 02-real-data-readonly.js)
//
// [주의] 이 스크립트는 api-reservation.onemove.co.kr에 직접 접속합니다.
// 클라우드 Claude 세션(Cowork)에서는 이 도메인이 막혀있어서 반드시 로컬(맥)에서 실행해야 합니다.

require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");
const { listNoVisitCandidates } = require("./lib/reservationApi");

const client = new Anthropic();

const NO_VISIT_DAYS = 14; // 최근 N일 미방문 기준 (MVP 범위, 나중에 조정 가능)

const tools = [
  {
    name: "list_members",
    description:
      `최근 ${NO_VISIT_DAYS}일간 미방문한 회원 후보 목록을 실제 원무브 시스템에서 조회한다. ` +
      "이탈 위험을 확인하려면 먼저 이 도구로 후보를 봐야 한다. 실제로 내려온 데이터 필드를 보고 " +
      "해석해서 판단할 것 — 필드에 없는 내용을 추측해서 판단하지 말 것.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "flag_risky_member",
    description:
      "이탈 위험이 있다고 판단한 회원 한 명을 신고 목록에 올린다 (아직 실제 발송/기록 아님, 화면 출력만). " +
      "위험하지 않다고 판단한 회원은 호출하지 않는다.",
    input_schema: {
      type: "object",
      properties: {
        member_label: { type: "string", description: "회원을 식별할 수 있는 이름 또는 id" },
        reason: {
          type: "string",
          description: "왜 위험하다고 판단했는지, 조회된 데이터 필드에 근거해서 설명",
        },
      },
      required: ["member_label", "reason"],
    },
  },
];

async function executeTool(toolName, input) {
  if (toolName === "list_members") {
    console.log(`  📋 [실행] 최근 ${NO_VISIT_DAYS}일 미방문 회원 조회 중 (실제 API 호출)...`);
    const data = await listNoVisitCandidates(NO_VISIT_DAYS);
    return JSON.stringify(data);
  }

  if (toolName === "flag_risky_member") {
    console.log(`  🚩 [실행] 위험 회원 신고: ${input.member_label} — ${input.reason}`);
    return "신고 접수됨 (화면 출력만, 실제 발송 아님)";
  }

  return `알 수 없는 도구: ${toolName}`;
}

async function runAgent() {
  const messages = [
    {
      role: "user",
      content:
        "너의 역할은 원무브 헬스장 회원 중 이탈 위험이 있는 사람을 찾는 거야. " +
        "도구로 실제 회원 후보 목록을 조회하고, 위험하다고 판단되는 사람만 신고해줘. " +
        "판단 근거는 반드시 조회된 데이터 필드에 있는 내용만 사용하고, 데이터에 없는 사실은 추측하지 마. " +
        "다 확인했으면 마지막에 누구를 신고했는지, 왜 그런지 한글로 요약해줘.",
    },
  ];

  let turn = 1;
  while (true) {
    console.log(`\n─── ${turn}번째 AI 호출 ───`);

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      tools,
      messages,
    });

    for (const block of response.content) {
      if (block.type === "text") {
        console.log(`  💬 [AI 응답] ${block.text}`);
      } else if (block.type === "tool_use") {
        console.log(`  🔧 [AI 판단] "${block.name}" 호출 (입력: ${JSON.stringify(block.input)})`);
      }
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      console.log("\n✅ AI가 종료했습니다.");
      break;
    }

    const toolResults = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        try {
          const result = await executeTool(block.name, block.input);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        } catch (err) {
          console.log(`  ⚠️ [에러] ${block.name} 호출 실패: ${err.message}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `에러: ${err.message}`,
            is_error: true,
          });
        }
      }
    }
    messages.push({ role: "user", content: toolResults });

    turn += 1;
  }
}

runAgent().catch((err) => {
  console.error("에러 발생:", err);
  process.exit(1);
});
