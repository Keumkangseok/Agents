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
//   프롬프트만 다듬어보는 개발 중에는 후보 수를 줄여서 싸고 빠르게 테스트할 수 있습니다:
//     TEST_MEMBER_LIMIT=20 npm run step2
//   최종 확인할 때는 이 값을 빼고(=282명 전체) 돌리세요.
//
// [주의] 이 스크립트는 api-reservation.onemove.co.kr에 직접 접속합니다.
// 클라우드 Claude 세션(Cowork)에서는 이 도메인이 막혀있어서 반드시 로컬(맥)에서 실행해야 합니다.

require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");
const { listNoVisitCandidates, getTransactionsByMonth } = require("./lib/reservationApi");
const { buildSummaryText, sendReport } = require("./lib/slack");
const { getContactedMemberIds, appendFlaggedMembers, sheetUrl } = require("./lib/sheets");

const client = new Anthropic();

// 신고된 회원을 모아뒀다가 실행 끝나면 구글 시트에 기록한다.
// 터미널 로그는 "과정"을 보는 용도고, 실제로 쓸 "결과물"은 시트임.
const flaggedResults = [];
// high 등급 회원의 컨택 메시지 초안 (member_id -> 문구)
const messageDrafts = new Map();

const NO_VISIT_DAYS = 14; // 최근 N일 미방문 기준 (MVP 범위, 나중에 조정 가능)
const TEST_MEMBER_LIMIT = process.env.TEST_MEMBER_LIMIT
  ? parseInt(process.env.TEST_MEMBER_LIMIT, 10)
  : null; // 설정하면 후보를 이 인원수로 잘라서 싸고 빠르게 테스트

// 오늘 날짜(KST)를 AI에게 직접 알려주기 위한 함수.
// 이게 없으면 AI가 데이터 안의 최근 attendedAt을 "오늘"로 착각해서 판단이 실행마다 달라짐 —
// noVisitsPeriod=14는 서버가 진짜 오늘 기준으로 계산한 거라, AI도 진짜 오늘을 알아야 일관되게 판단함.
function todayStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

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
        member_id: { type: "string", description: "회원의 실제 id (숫자, 데이터의 id 필드 그대로)" },
        member_name: { type: "string", description: "회원 이름" },
        plain_summary: {
          type: "string",
          description:
            "전문 용어 없이 일반인이 바로 이해할 수 있는 한 문장 요약. " +
            "예: '박세미님 — 1개월 기간권 보유 중, 20일째 미방문'. " +
            "state/endedAt/pass id 같은 내부 필드명은 쓰지 말고, 이름·보유 패스 종류(기간권/횟수권 " +
            "등)·미방문 일수 정도만 담을 것. 슬랙 메시지에 그대로 노출됨.",
        },
        reason: {
          type: "string",
          description:
            "왜 위험하다고 판단했는지, 조회된 데이터 필드에 근거한 상세 설명(기록/감사용, " +
            "구글 시트에 저장되지만 슬랙에는 안 보임 — plain_summary와 달리 기술적으로 써도 됨)",
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
      required: ["member_id", "member_name", "plain_summary", "reason", "risk_level"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_transactions_by_month",
    description:
      "특정 월(YYYY-MM 형식)의 실제 결제/환불 내역 전체를 조회한다. 회원이 이 패스를 진짜 " +
      "돈 내고 산 건지, 환불된 건 아닌지 확인하고 싶을 때 사용한다. 이 도구는 회원별 필터가 " +
      "없어 그 달 전체 내역이 내려오니, 이름이나 id로 직접 찾아서 대조할 것. " +
      "호출할 때마다 실제 API를 부르므로, 모든 후보에 대해 부르지 말고 확신이 필요한 " +
      "애매한 케이스(엠버서더/양도 등)나 high 등급처럼 중요한 판단에만 선택적으로 사용할 것.",
    input_schema: {
      type: "object",
      properties: {
        year_month: { type: "string", description: "조회할 연월, 'YYYY-MM' 형식 (예: '2026-07')" },
      },
      required: ["year_month"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "draft_outreach_message",
    description:
      "risk_level이 high인 회원에게 실제로 보낼 수 있는 컨택 메시지 초안을 작성한다. " +
      "high 등급으로 flag_risky_member를 호출한 회원에 대해서만 이 도구를 쓸 것 " +
      "(medium/low는 지금 단계에서 초안을 안 만든다). " +
      "직원이 그대로 복사해서 카카오톡/문자로 보낼 수 있는 짧고 다정한 한두 문장으로 쓸 것. " +
      "지켜야 할 것: (1) 데이터에 없는 개인 사정(부상, 여행, 이사 등)을 추측해서 절대 넣지 말 것 " +
      "— 대신 '요즘 어떻게 지내세요' 같은 열린 톤을 쓸 것. (2) 사무적이거나 광고 문구처럼 " +
      "쓰지 말 것 — 진짜 직원이 안부 묻듯이 자연스럽게. (3) 보유 패스나 미방문 기간 같은, " +
      "이미 확인된 사실은 자연스럽게 언급해도 됨(예: '얼마 만이에요' 같은 톤으로).",
    input_schema: {
      type: "object",
      properties: {
        member_id: { type: "string", description: "flag_risky_member에서 쓴 것과 같은 회원 id" },
        message_draft: { type: "string", description: "직원이 그대로 복사해서 보낼 수 있는 메시지 초안" },
      },
      required: ["member_id", "message_draft"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function executeTool(toolName, input) {
  if (toolName === "list_members") {
    console.log(`  📋 [실행] 최근 ${NO_VISIT_DAYS}일 미방문 회원 조회 중 (실제 API 호출, 페이지네이션 자동 처리)...`);
    const data = await listNoVisitCandidates(NO_VISIT_DAYS);
    if (TEST_MEMBER_LIMIT) {
      data.data = data.data.slice(0, TEST_MEMBER_LIMIT);
      console.log(
        `  ⚠️ [테스트 모드] TEST_MEMBER_LIMIT=${TEST_MEMBER_LIMIT}으로 ${data.data.length}명만 사용 (전체 ${data.total}명 중 일부, 최종 확인 시엔 빼고 돌릴 것)`
      );
    }
    console.log(`  📋 [실행] 총 ${data.data.length}명 수집 완료 (API total: ${data.total})`);
    return JSON.stringify(data);
  }

  if (toolName === "get_transactions_by_month") {
    console.log(`  💳 [실행] ${input.year_month} 결제내역 조회 중 (실제 API 호출)...`);
    const data = await getTransactionsByMonth(input.year_month);
    return JSON.stringify(data);
  }

  if (toolName === "flag_risky_member") {
    console.log(
      `  🚩 [실행] 위험 회원 신고 [${input.risk_level}] ${input.member_name} (id ${input.member_id}) — ${input.plain_summary}`
    );
    flaggedResults.push(input);
    return "신고 접수됨 (화면 출력만, 실제 발송 아님)";
  }

  if (toolName === "draft_outreach_message") {
    console.log(`  ✏️ [실행] 컨택 메시지 초안 (id ${input.member_id}) — "${input.message_draft}"`);
    messageDrafts.set(String(input.member_id), input.message_draft);
    return "초안 저장됨 (화면 출력만, 실제 발송 아님)";
  }

  return `알 수 없는 도구: ${toolName}`;
}

async function runAgent() {
  // 구글 시트에서 "연락완료" 체크된 회원ID를 미리 가져온다 — AI 판단에 맡기지 않고
  // 코드에서 확실하게 걸러낸다 (더 신뢰할 수 있고, 매번 프롬프트에 긴 제외 목록을 안 넣어도 됨).
  let contactedIds = new Set();
  try {
    contactedIds = await getContactedMemberIds();
    console.log(`📋 구글 시트에서 연락완료 회원 ${contactedIds.size}명 확인 (이번 신고에서 자동 제외됨)`);
  } catch (err) {
    console.log(`⚠️ 구글 시트 연결 실패, 연락완료 필터링 없이 진행합니다: ${err.message}`);
  }

  const messages = [
    {
      role: "user",
      content:
        `오늘 날짜는 ${todayStr()}야. 미방문 기간, 만료 경과 기간 같은 걸 계산할 때 이 날짜를 ` +
        "기준으로 써 — 데이터 안에서 가장 최근 attendedAt을 '오늘'로 착각하지 마, 그건 그냥 " +
        "그 사람의 마지막 방문일일 뿐이고 실제 오늘은 그것보다 나중이야. " +
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
        "get_transactions_by_month로 결제내역을 볼 때 어떤 후보의 이름/id가 trainer(직원 처리자)로도 " +
        "등장하는 걸 발견하면, 그 사람도 코치수강권과 똑같이 취급해 — 직원이니까 완전히 제외하고 " +
        "아예 신고하지 마 (단순히 애매하다고 표시만 하고 넘어가지 말 것, 이 경우는 확실한 제외 규칙임). " +
        "'엠버서더 전용'이나 '양도' 같은 이름이 특이한 패스는 일반 유료 회원과 똑같이 자동 취급하지 " +
        "말고, 진짜 돈 내고 다니는 고객 관계로 보이는지 스스로 따져봐 — 확신이 안 서면 신고하되 " +
        "reason에 왜 애매한지 적어. 확신을 높이고 싶으면 get_transactions_by_month로 그 회원의 " +
        "실제 결제 기록이 있는지 대조해봐도 돼(단, 후보 전원한테 쓰지 말고 필요한 경우에만). " +
        "또 하나 확인해줄 게 있어: 회원/패스 데이터 안에 '홀딩'(휴회, 일시정지) 관련 필드가 있는지 " +
        "찾아봐. 만약 있다면, 현재 정당하게 휴회 중인 회원은 이탈 위험이 아니라 정상적인 일시정지 " +
        "상태니까 신고 대상에서 빼줘. 그런 필드를 못 찾겠으면 추측하지 말고, 마지막 요약에 " +
        "\"홀딩 여부를 판단할 수 있는 필드를 데이터에서 못 찾았다\"고 솔직하게 알려줘. " +
        "판단 근거는 반드시 조회된 데이터 필드에 있는 내용만 사용하고, 데이터에 없는 사실은 추측하지 마. " +
        "모든 후보를 다 확인해서 신고를 끝냈으면, 그 다음 risk_level이 high인 회원 각각에 대해 " +
        "draft_outreach_message로 컨택 메시지 초안을 하나씩 써줘 (medium/low는 초안 안 씀 — 지금 " +
        "단계에서는 high만). " +
        "다 끝났으면 마지막에 (1) 위험도별(high/medium/low)로 몇 명씩 신고했는지와 각 등급의 대표 " +
        "사례, (2) 체험 미전환이나 코치수강권(결제내역에서 발견한 직원 포함)이라 건너뛴 사람이 각각 " +
        "몇 명인지, (3) 엠버서더/양도처럼 판단이 애매했던 케이스가 있으면 몇 명이고 어떻게 처리했는지, " +
        "(4) 홀딩 관련 필드를 찾았는지 여부와 찾았다면 몇 명을 홀딩으로 제외했는지, (5) 컨택 메시지 " +
        "초안을 몇 명분 작성했는지 한글로 요약해줘.",
    },
  ];

  let turn = 1;
  while (true) {
    console.log(`\n─── ${turn}번째 AI 호출 ───`);

    // 282명치 데이터를 검토하면서 "생각"에 토큰을 많이 쓸 수 있어서,
    // max_tokens을 넉넉히 주고 스트리밍으로 호출한다 (스트리밍 안 하면 큰 요청은 타임아웃 위험).
    // effort: "medium"으로 생각을 적당히 줄여서 답변까지 도달하게 함 (기본값 high는 생각이 너무 길어짐).
    // cache_control: 매 턴마다 전체 대화(282명 데이터 포함)를 통째로 다시 보내는 구조라,
    // 캐싱을 켜두면 이전 턴에서 이미 보낸 부분은 훨씬 싼 값(약 10%)으로 처리됨 -- 비용 절감 핵심.
    const stream = client.messages.stream({
      model: "claude-sonnet-5", // 개발/테스트 단계라 opus 대비 저렴한 모델 사용 (강석 확인)
      max_tokens: 64000,
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      tools,
      messages,
    });
    const response = await stream.finalMessage();
    console.log(`  (종료 사유: ${response.stop_reason})`); // 디버깅용 — max_tokens에서 끊기면 여기 찍힘

    const u = response.usage;
    console.log(
      `  (토큰: 입력 ${u.input_tokens} / 출력 ${u.output_tokens} / 캐시로 읽음 ${u.cache_read_input_tokens ?? 0} / 캐시에 새로 씀 ${u.cache_creation_input_tokens ?? 0})`
    );

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

  const newResults = flaggedResults
    .filter((r) => !contactedIds.has(String(r.member_id)))
    .map((r) => ({ ...r, message_draft: messageDrafts.get(String(r.member_id)) || "" }));
  const alreadyContactedCount = flaggedResults.length - newResults.length;
  if (alreadyContactedCount > 0) {
    console.log(`\n📋 이미 연락완료로 표시된 ${alreadyContactedCount}명은 이번 신고에서 제외했습니다.`);
  }

  if (newResults.length > 0) {
    try {
      await appendFlaggedMembers(newResults);
      console.log(`\n📄 구글 시트에 ${newResults.length}명 기록 완료: ${sheetUrl()}`);
    } catch (err) {
      console.log(`⚠️ 구글 시트 기록 실패: ${err.message}`);
    }

    try {
      const summaryText = buildSummaryText(newResults, sheetUrl());
      await sendReport(summaryText);
      console.log("📣 슬랙으로 요약 전송 완료");
    } catch (err) {
      console.log(`⚠️ 슬랙 전송 실패: ${err.message}`);
    }
  } else {
    console.log("\n신고할 신규 위험 회원이 없습니다 (전부 이미 연락완료 처리됐거나, 위험 회원 자체가 없음).");
  }
}

runAgent().catch((err) => {
  console.error("에러 발생:", err);
  process.exit(1);
});
