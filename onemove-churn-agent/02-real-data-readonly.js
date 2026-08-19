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
      `최근 ${NO_VISIT_DAYS}일간 미방문한 회원 후보 전체 목록을 실제 원무브 시스템에서 조회한다 ` +
      "(페이지네이션은 자동으로 끝까지 처리해서 반환하므로 이 도구를 여러 번 부를 필요는 없다). " +
      "이탈 위험을 확인하려면 먼저 이 도구로 후보를 봐야 한다. 실제로 내려온 데이터 필드를 보고 " +
      "해석해서 판단할 것 — 필드에 없는 내용을 추측해서 판단하지 말 것. " +
      "주의: 이 목록에는 체험권(이름에 '체험권'이 들어간 패스)만 받아본 회원도 섞여 있을 수 있는데, " +
      "그런 회원은 flag_risky_member 대상이 아니다 (아래 설명 참고). " +
      "'레뷰체험단' 패스는 이름만으로 판단하지 말고 기간을 볼 것 — 2주 정도면 체험용, 3개월처럼 " +
      "길면 정식 계약. " +
      "'코치수강권'은 코치(직원)에게 부여하는 패스라 실제 회원이 아니므로 후보에서 완전히 " +
      "제외할 것(신고 대상 자체가 아님). '엠버서더 전용'/'양도' 같은 특수 이름 패스는 이름만 보고 " +
      "일반 유료 회원과 자동으로 동일하게 취급하지 말고, 진짜 유료 고객 관계인지 신중히 판단할 것.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "flag_risky_member",
    description:
      "이탈 위험이 있다고 판단한 회원 한 명을 신고 목록에 올린다 (아직 실제 발송/기록 아님, 화면 출력만). " +
      "정식(비체험) 계약을 맺어본 적 있는 회원(재등록 회원)만 대상으로 한다 — " +
      "체험권(일주일 체험권/1회 체험권/다이어트챌린지 지인 체험권 등, 이름에 '체험권'이 들어간 패스)만 " +
      "받아보고 정식 계약 이력이 없는 회원은 '이탈'이 아니라 '체험 미전환'이므로 호출하지 않는다. " +
      "'코치수강권' 보유자는 코치(직원)이지 회원이 아니므로 절대 호출하지 않는다. " +
      "'엠버서더 전용'/'양도' 등 특수 패스 보유자는 신고해도 되지만, 진짜 유료 고객 관계인지 " +
      "확신이 낮으면 reason에 그 불확실성을 명시한다. " +
      "위험하지 않다고 판단한 회원도 호출하지 않는다.",
    input_schema: {
      type: "object",
      properties: {
        member_label: { type: "string", description: "회원을 식별할 수 있는 이름 또는 id" },
        reason: {
          type: "string",
          description: "왜 위험하다고 판단했는지, 조회된 데이터 필드에 근거해서 설명",
        },
        risk_level: {
          type: "string",
          enum: ["high", "medium", "low"],
          description:
            "high: 패스가 아직 유효한데(state 1/2, endedAt 안 지남) 장기 미방문 — 지금 컨택하면 " +
            "살릴 수 있는 사람. medium: 패스 만료된 지 얼마 안 됐는데(대략 한 달 이내) 재등록 없음. " +
            "low: 패스 만료된 지 오래(몇 달 이상)됐고 재등록도 없음 — 사실상 이미 떠난 사람이라 " +
            "긴급 리텐션보다는 나중에 별도 윈백 캠페인 대상.",
        },
      },
      required: ["member_label", "reason", "risk_level"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function executeTool(toolName, input) {
  if (toolName === "list_members") {
    console.log(`  📋 [실행] 최근 ${NO_VISIT_DAYS}일 미방문 회원 조회 중 (실제 API 호출, 페이지네이션 자동 처리)...`);
    const data = await listNoVisitCandidates(NO_VISIT_DAYS);
    console.log(`  📋 [실행] 총 ${data.data.length}명 수집 완료 (API total: ${data.total})`);
    return JSON.stringify(data);
  }

  if (toolName === "flag_risky_member") {
    console.log(
      `  🚩 [실행] 위험 회원 신고 [${input.risk_level}] ${input.member_label} — ${input.reason}`
    );
    return "신고 접수됨 (화면 출력만, 실제 발송 아님)";
  }

  return `알 수 없는 도구: ${toolName}`;
}

async function runAgent() {
  const messages = [
    {
      role: "user",
      content:
        "너의 역할은 원무브 헬스장의 '정식 회원'(재등록 이력이 있는, 즉 체험권이 아닌 정식 계약을 " +
        "맺어본 적 있는 회원) 중 이탈 위험이 있는 사람을 찾는 거야. " +
        "도구로 실제 회원 후보 목록을 조회하고, 그 중 정식 회원만 골라서 위험하다고 판단되는 사람을 신고해줘. " +
        "체험권만 받아보고 정식 계약 이력이 없는 회원(체험 미전환자)은 이탈이 아니라 별개의 문제니까 " +
        "신고하지 말고 건너뛰어. " +
        "'레뷰체험단' 패스는 주의해서 봐: 기간이 2주 정도로 짧으면 최초 신청 시 발급되는 체험용이라 " +
        "체험 미전환으로 분류(건너뛰기). 하지만 이름에 '레뷰'가 들어가도 3개월권처럼 기간이 긴 " +
        "패스라면 실제 유료 정식 회원이니 이탈 위험 판단 대상에 포함해. " +
        "'코치수강권'은 코치(직원)에게 부여하는 패스라 회원이 아니야 — 이런 사람은 후보에서 " +
        "완전히 빼고, 아예 신고하지 마. " +
        "'엠버서더 전용'이나 '양도' 같은 이름이 특이한 패스는 일반 유료 회원과 똑같이 자동 취급하지 " +
        "말고, 진짜 돈 내고 다니는 고객 관계로 보이는지 스스로 따져봐 — 확신이 안 서면 신고하되 " +
        "reason에 왜 애매한지 적어. " +
        "판단 근거는 반드시 조회된 데이터 필드에 있는 내용만 사용하고, 데이터에 없는 사실은 추측하지 마. " +
        "다 확인했으면 마지막에 (1) 위험도별(high/medium/low)로 몇 명씩 신고했는지와 각 등급의 대표 " +
        "사례, (2) 체험 미전환이나 코치수강권이라 건너뛴 사람이 각각 몇 명인지, (3) 엠버서더/양도처럼 " +
        "판단이 애매했던 케이스가 있으면 몇 명이고 어떻게 처리했는지 한글로 요약해줘.",
    },
  ];

  let turn = 1;
  while (true) {
    console.log(`\n─── ${turn}번째 AI 호출 ───`);

    // 282명치 데이터를 검토하면서 "생각"에 토큰을 많이 쓸 수 있어서,
    // max_tokens을 넉넉히 주고 스트리밍으로 호출한다 (스트리밍 안 하면 큰 요청은 타임아웃 위험).
    // effort: "medium"으로 생각을 적당히 줄여서 답변까지 도달하게 함 (기본값 high는 생각이 너무 길어짐).
    const stream = client.messages.stream({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      tools,
      messages,
    });
    const response = await stream.finalMessage();
    console.log(`  (종료 사유: ${response.stop_reason})`); // 디버깅용 — max_tokens에서 끊기면 여기 찍힘

    for (const block of response.content) {
      if (block.type === "text") {
        console.log(`  💬 [AI 응답] ${block.text}`);
      } else if (block.type === "tool_use") {
        console.log(`  🔧 [AI 판단] "${block.name}" 호출 (입력: ${JSON.stringify(block.input)})`);
      }
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "max_tokens") {
      console.log(
        "\n⚠️ max_tokens에 걸려서 중간에 끊겼습니다 (생각하는 데 토큰을 다 써버렸을 가능성). " +
          "02-real-data-readonly.js의 max_tokens 값을 더 늘리거나 effort를 낮춰보세요."
      );
      break;
    }

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
