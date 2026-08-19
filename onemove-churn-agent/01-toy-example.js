// 01-toy-example.js
//
// [1단계] "자동화 vs 에이전트" 개념을 직접 눈으로 확인해보는 아주 작은 연습용 예제입니다.
// 진짜 원무브 회원 데이터는 전혀 쓰지 않습니다 — 아래 FAKE_MEMBERS는 전부 가짜(연습용)입니다.
//
// [실행 전 준비]
//   1) 터미널에서: npm install
//   2) .env.example을 .env로 복사하고, ANTHROPIC_API_KEY에 본인 키를 채워넣기
//   3) 터미널에서: npm run toy   (또는 node 01-toy-example.js)
//
// [무슨 일이 일어나는지]
// AI한테 "회원 목록 조회" 도구와 "위험 회원 신고" 도구, 이렇게 딱 2개만 쥐여주고
// "이탈 위험 있는 회원 찾아서 신고해줘"라는 목표만 줍니다.
// 누구를 볼지, 언제 신고할지, 언제 끝낼지 — 전부 AI가 스스로 정합니다.
// 콘솔에 AI가 매 순간 무슨 생각으로 뭘 하는지 전부 출력되니 그걸 눈으로 따라가보세요.

require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수를 자동으로 읽어옵니다

// ── 1. 가짜 회원 데이터 ────────────────────────────────────────────
// 일부러 "최근 방문 0회"인 사람을 두 명 넣었는데, 평소 패턴이 서로 다릅니다.
// m2, m3: 원래 자주 오던 사람인데 최근 뚝 끊김 -> 진짜 위험 신호
// m5: 원래도 어쩌다 한 번씩 오던 사람 -> 0회여도 딱히 이상하지 않음
// 이렇게 만들어둔 이유: AI가 "최근 방문 0회"라는 숫자 하나만 보고 기계적으로
// 판단하는지, 아니면 그 사람의 평소 패턴과 비교해서 맥락으로 판단하는지 확인하기 위함
const FAKE_MEMBERS = [
  { id: "m1", name: "김지훈", recentVisits2Weeks: 4, avgVisitsPerTwoWeeks: 4 },
  { id: "m2", name: "이서연", recentVisits2Weeks: 0, avgVisitsPerTwoWeeks: 5 },
  { id: "m3", name: "박민수", recentVisits2Weeks: 1, avgVisitsPerTwoWeeks: 6 },
  { id: "m4", name: "최유진", recentVisits2Weeks: 3, avgVisitsPerTwoWeeks: 3 },
  { id: "m5", name: "정하늘", recentVisits2Weeks: 0, avgVisitsPerTwoWeeks: 1 },
];

// ── 2. AI가 쓸 수 있는 "도구함" 정의 ────────────────────────────────
// 도구 1: 회원 목록 조회 (읽기 전용이라 완전히 안전)
// 도구 2: 위험 회원 "신고" (실제로는 화면에 출력만 함, 아무 데도 실제로 안 나감)
//
// description(설명)이 이 도구를 쓰는 유일한 안내서라는 걸 기억하세요.
// AI는 아래 executeTool 함수의 실제 코드를 못 봅니다 — 오직 이 설명만 보고 판단합니다.
const tools = [
  {
    name: "list_members",
    description:
      "전체 회원 목록과 최근 2주간 방문 횟수, 평소(평균) 방문 횟수를 조회한다. " +
      "누가 이탈 위험이 있는지 확인하려면 이 도구로 먼저 전체 목록을 봐야 한다.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "flag_risky_member",
    description:
      "이탈 위험이 있다고 판단한 회원 한 명을 신고 목록에 올린다. " +
      "위험하지 않다고 판단한 회원은 이 도구를 호출하지 않고 그냥 넘어가면 된다.",
    input_schema: {
      type: "object",
      properties: {
        member_id: { type: "string", description: "위험하다고 판단한 회원의 id" },
        reason: { type: "string", description: "왜 위험하다고 판단했는지, 데이터에 근거해서 설명" },
      },
      required: ["member_id", "reason"],
    },
  },
];

// ── 3. AI가 도구를 호출했을 때 실제로 실행되는 코드 ──────────────────
// "함수로 노출한다"는 게 바로 이겁니다: 도구 이름이 오면 진짜 동작을 실행해서 결과를 돌려줌.
function executeTool(toolName, input) {
  if (toolName === "list_members") {
    console.log("  📋 [실행] 회원 목록 조회 중...");
    return JSON.stringify(FAKE_MEMBERS);
  }

  if (toolName === "flag_risky_member") {
    console.log(`  🚩 [실행] 위험 회원 신고: ${input.member_id} — ${input.reason}`);
    return `${input.member_id} 신고 접수됨`;
  }

  return `알 수 없는 도구: ${toolName}`;
}

// ── 4. 에이전트 루프 (여기가 핵심) ───────────────────────────────
// "순서"를 코드가 정하지 않는다는 걸 눈으로 확인하는 부분입니다.
// 코드는 그냥 "AI가 도구를 부르면 실행해서 결과를 돌려주는" 역할만 하고,
// "다음에 뭘 할지"는 매번 AI가 스스로 정합니다.
async function runAgent() {
  const messages = [
    {
      role: "user",
      content:
        "너의 역할은 헬스장 회원 중 이탈 위험이 있는 사람을 찾는 거야. " +
        "도구를 이용해서 회원 목록을 확인하고, 위험하다고 판단되는 사람만 신고해줘. " +
        "다 확인했으면 마지막에 누구를 신고했는지, 왜 그런지 한글로 요약해서 알려줘.",
    },
  ];

  let turn = 1;

  while (true) {
    console.log(`\n─── ${turn}번째 AI 호출 ───`);

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      tools,
      messages,
    });

    // AI가 이번 턴에 뭘 했는지 그대로 보여줌 (생각 과정 구경하기)
    for (const block of response.content) {
      if (block.type === "text") {
        console.log(`  💬 [AI 응답] ${block.text}`);
      } else if (block.type === "tool_use") {
        console.log(
          `  🔧 [AI 판단] "${block.name}" 도구를 호출하기로 결정 (입력: ${JSON.stringify(block.input)})`
        );
      }
    }

    // AI의 응답을 대화 기록에 추가 (다음 호출에서 문맥으로 이어짐)
    messages.push({ role: "assistant", content: response.content });

    // AI가 더 이상 도구를 안 부르고 텍스트로만 답했다면 -> 끝
    if (response.stop_reason !== "tool_use") {
      console.log("\n✅ AI가 스스로 '더 이상 할 일 없음'이라고 판단하고 종료했습니다.");
      break;
    }

    // AI가 요청한 도구 호출들을 실제로 실행하고, 결과를 모아서 다시 AI에게 전달
    const toolResults = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = executeTool(block.name, block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
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
