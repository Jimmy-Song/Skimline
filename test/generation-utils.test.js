"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_RECOMMENDATION_PROMPT_VERSION,
  DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
  SUMMARY_PROMPT_VERSION,
  SUMMARY_SCHEMA_VERSION,
  OVERVIEW_PROMPT_VERSION,
  INTENT_MATCH_SYSTEM_PROMPT,
  OVERVIEW_SYSTEM_PROMPT,
  STRUCTURE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  chunkSegments,
  defaultRecommendationCacheKey,
  defaultRecommendationPromptForLanguage,
  dedupePointsByTimestamp,
  formatTimestamp,
  generateDefaultRecommendations,
  generateOverview,
  getCachedDefaultRecommendations,
  getCachedOverview,
  intentPointLines,
  matchVideoIntent,
  parseIntentMatchesJson,
  parseDefaultRecommendationsJson,
  parseOverviewJson,
  parsePointsJson,
  parseStructureJson,
  requestChunk,
  requestDefaultRecommendations,
  requestIntentMatches,
  requestOverview,
  requestStructure,
  summaryCacheKey,
  overviewCacheKey,
  systemPromptForLanguage,
  structurePromptForLanguage,
  overviewPromptForLanguage,
  structurePointLines,
  summarizeVideo,
} = require("../generation-utils.js");

test("多语言摘要启用 promptVersion 9 使旧缓存失效", () => {
  assert.equal(SUMMARY_PROMPT_VERSION, 9);
});

test("多语言缓存启用 schemaVersion 6", () => {
  assert.equal(SUMMARY_SCHEMA_VERSION, 6);
});

test("不同摘要语言使用独立缓存键和提示词", () => {
  assert.equal(summaryCacheKey("video-1", "zh-CN"), "summary:video-1");
  assert.equal(summaryCacheKey("video-1", "en"), "summary:video-1:en");
  assert.equal(systemPromptForLanguage("zh-CN"), SYSTEM_PROMPT);
  assert.match(systemPromptForLanguage("en"), /point 和 detail 都用English/);
  assert.match(overviewPromptForLanguage("ja"), /2–3 句日本語/);
  assert.equal(overviewCacheKey("video-1", "zh-CN"), "overview:video-1:zh-CN:v1");
  assert.equal(overviewCacheKey("video-1", "en"), "overview:video-1:en:v1");
  assert.equal(
    defaultRecommendationCacheKey("video-1", "zh-CN"),
    "default-recommendations:video-1:zh-CN:v1",
  );
  assert.equal(
    defaultRecommendationCacheKey("video-1", "en"),
    "default-recommendations:video-1:en:v1",
  );
  assert.match(defaultRecommendationPromptForLanguage("en"), /使用自然的 English 问题句/);
  assert.match(defaultRecommendationPromptForLanguage("en"), /不要混用其他语言/);
  assert.equal(OVERVIEW_PROMPT_VERSION, 1);
  assert.equal(DEFAULT_RECOMMENDATION_PROMPT_VERSION, 1);
});

const EXPECTED_SYSTEM_PROMPT = `你是视频内容分析助手。用户会给你一段带时间戳的视频字幕。

任务：列出这段字幕里每一个“独立的观点/主张”。判断标准：
【算观点】讲者提出的看法、结论、主张、论断。
【不算观点，不要单独成行】
- 支撑某个观点的故事、举例、轶事、数据、引用、复述——归入它所支撑观点的 detail；
- 纯过场、寒暄、主持性或叙述衔接语句（如“感谢掌声”“时间不多了”“下面讲个故事”）——直接忽略。

覆盖要求：观点层面一个都不能漏；但不要把同一个观点的多个例子拆成多条。多段内容在论证同一观点时，合并成一条，把例子写进它的 detail。

对每个观点输出：
- t：该观点开始的时间，秒，整数。
- point：用一句自然、好懂的话说清楚讲者在这里表达什么，像跟朋友解释一样。要点：
  · 优先“清晰、能自己说明白”，不要为了短而堆砌名词或写成电报体；
  · 多用主谓和动词、说大白话；不要生硬直译，把意思用自然中文说出来；
  · 保留必要的关键术语（尤其专业内容），但不堆砌；
  · 长度顺其自然，通常 15–35 字，不设硬上限。
- detail：面向想深入的人，用大白话把这个观点讲透，同时忠实原意、保留专业细节——术语、数据、前提条件、关键例子都要在，不要为了简单而丢信息，也不要加入字幕里没有的内容。2–4 句；引用了具体故事/例子时可用〔mm:ss〕标注其时间。

无论字幕是什么语言，point 和 detail 都用简体中文。
只输出一个 JSON 数组，形如 [{"t":870,"point":"…","detail":"…"}]，不要任何多余文字或代码块标记。`;
const EXPECTED_STRUCTURE_SYSTEM_PROMPT = `你会收到一个视频按时间排序的观点列表（每条：时间秒 + 一句话观点）。请做两件事：

1. sections：把这些观点按视频的自然结构分成若干段（通常 3–6 段），每段一个标题。标题 6–14 字，完整短语，不要以连词或助词结尾（如“问题 · 主动代理的挑战”“三个设计目标”）。分段必须按时间顺序、不重叠、覆盖全部观点。

2. keyInsights：从全部观点中识别出 2-3 个“核心洞见”——那些最具穿透力、最反直觉、最有方法论价值、或最能改变认知的观点。标准：
   - 它挑战了某个常识或直觉
   - 它提供了可迁移的思维框架或决策方法
   - 它揭示了问题的本质或深层原因
   - 它给出了经过实践验证的反常识结论

   对每个洞见输出：
   - pointT: 该洞见对应观点的时间戳（秒，整数）
   - why: 用 1-2 句话（50-80字）说明为什么这个观点重要。可以从这些角度：它挑战了什么常识？它解决了什么难题？它提供了什么可迁移的方法论？语气要直接、有力，像在跟朋友解释“你一定要记住这个”。

只输出 JSON：
{
  "sections": [{"title": "…", "startT": <秒数>}, …],
  "keyInsights": [{"pointT": <秒数>, "why": "…"}, …]
}

keyInsights 可以为空数组（如果没有特别突出的洞见）。不要输出任何多余文字或代码块标记。`;
const EXPECTED_DEFAULT_RECOMMENDATION_SYSTEM_PROMPT = `你是视频观看导航助手。用户会给你当前视频的完整观点列表。每条观点都包含唯一时间戳、观点和详细说明。

任务：生成最多 4 个“值得看问题”，帮助用户快速判断这条长视频里哪些片段值得自己看。

规则：
- 必须综合 point 和 detail 判断观看价值，不能只看章节名或关键词
- 每个问题都必须有清晰的视频内容支撑，并绑定 1-4 个真实存在的观点时间戳
- 问题要具体、有信息指向，优先选择有新意、反直觉、实用价值或高信息密度的片段
- 使用自然的简体中文问题句，例如“机器人当前真正卡在哪里？”“她从竞赛走向机器人研究的关键转折是什么？”
- 不要输出宽泛分类、用户身份标签或通用目的，例如“了解行业趋势”“学习方法论”“只看核心观点”
- 各问题之间不能只是换一种说法；如果没有足够好的问题，可以少于 4 个，甚至返回空数组
- pointTs 只能从输入列表中选择，并按视频时间升序排列
- 不要解释推荐原因

只输出 JSON：
{
  "recommendations": [
    {"label": "…？", "pointTs": [<秒数>, …]}
  ]
}

不要输出任何多余文字或代码块标记。`;

function streamResponse(parts, status = 200) {
  const encoder = new TextEncoder();
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream({
      start(controller) {
        parts.forEach((part) => controller.enqueue(encoder.encode(part)));
        controller.close();
      },
    }),
  };
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get(key, callback) {
      callback({ [key]: data[key] });
    },
    set(values, callback) {
      Object.assign(data, values);
      callback();
    },
  };
}

test("按十分钟或约 3000 字切块且不丢字幕", () => {
  const segments = [
    { tMs: 0, text: "a".repeat(1800) },
    { tMs: 1000, text: "b".repeat(1800) },
    { tMs: 601000, text: "第三段" },
  ];
  const chunks = chunkSegments(segments);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.flat(), segments);
});

test("格式化分钟与小时级时间戳", () => {
  assert.equal(formatTimestamp(135), "02:15");
  assert.equal(formatTimestamp(7100), "1:58:20");
});

test("解析、清洗并排序所需观点字段", () => {
  assert.deepEqual(
    parsePointsJson(
      '```json\n[{"t":870.9,"point":" 创业初期别急着扩张 ","detail":" 论据。例子。 "}]```',
    ),
    [
      {
        t: 870,
        tLabel: "14:30",
        point: "创业初期别急着扩张",
        detail: "论据。例子。",
      },
    ],
  );
  assert.throws(() => parsePointsJson("{}"), /观点数组/);
  const longPoint = "只有把复杂概念放回具体场景并说明因果关系，普通用户才能真正理解这个专业结论";
  assert.equal(
    parsePointsJson(
      JSON.stringify([{ t: 0, point: longPoint, detail: "细节。" }]),
    )[0].point,
    longPoint,
  );
});

test("模型返回带解释文字时仍能提取观点 JSON 数组", () => {
  assert.deepEqual(
    parsePointsJson(
      '好的，以下是 JSON：\n```json\n[{"t":12,"point":"提示词要更短","detail":"例子过多会限制模型发挥。"}]\n```\n补充：以上是本段观点。',
    ),
    [
      {
        t: 12,
        tLabel: "00:12",
        point: "提示词要更短",
        detail: "例子过多会限制模型发挥。",
      },
    ],
  );
});

test("C 好懂且保真的提示词逐字对齐修订版 §5.2", () => {
  assert.equal(SYSTEM_PROMPT, EXPECTED_SYSTEM_PROMPT);
  assert.match(SYSTEM_PROMPT, /纯过场、寒暄、主持性或叙述衔接语句/);
  assert.match(SYSTEM_PROMPT, /归入它所支撑观点的 detail/);
  assert.match(SYSTEM_PROMPT, /同一个观点的多个例子拆成多条/);
  assert.match(SYSTEM_PROMPT, /通常 15–35 字，不设硬上限/);
  assert.match(SYSTEM_PROMPT, /保留专业细节——术语、数据、前提条件、关键例子/);
  assert.doesNotMatch(SYSTEM_PROMPT, /不超过 25 个字/);
  assert.doesNotMatch(SYSTEM_PROMPT, /宁可多列也不要合并/);
});

test("结构化汇总提示词逐字对齐追加指令", () => {
  assert.equal(STRUCTURE_SYSTEM_PROMPT, EXPECTED_STRUCTURE_SYSTEM_PROMPT);
  assert.match(STRUCTURE_SYSTEM_PROMPT, /通常 3–6 段/);
  assert.match(
    STRUCTURE_SYSTEM_PROMPT,
    /标题 6–14 字，完整短语，不要以连词或助词结尾/,
  );
  assert.match(STRUCTURE_SYSTEM_PROMPT, /不重叠、覆盖全部观点/);
  assert.match(STRUCTURE_SYSTEM_PROMPT, /keyInsights/);
  assert.match(STRUCTURE_SYSTEM_PROMPT, /挑战了某个常识或直觉/);
  assert.match(STRUCTURE_SYSTEM_PROMPT, /可迁移的思维框架或决策方法/);
  assert.match(STRUCTURE_SYSTEM_PROMPT, /揭示了问题的本质或深层原因/);
  assert.match(STRUCTURE_SYSTEM_PROMPT, /经过实践验证的反常识结论/);
  assert.match(STRUCTURE_SYSTEM_PROMPT, /2-3 个“核心洞见”/);
  assert.doesNotMatch(STRUCTURE_SYSTEM_PROMPT, /suggestedIntents/);
  assert.doesNotMatch(STRUCTURE_SYSTEM_PROMPT, /观看目的/);
  assert.doesNotMatch(STRUCTURE_SYSTEM_PROMPT, /overview|概览/);
});

test("默认推荐问题提示词逐字对齐并强调具体问题和真实时间戳", () => {
  assert.equal(
    DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
    EXPECTED_DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
  );
  assert.match(DEFAULT_RECOMMENDATION_SYSTEM_PROMPT, /最多 4 个“值得看问题”/);
  assert.match(DEFAULT_RECOMMENDATION_SYSTEM_PROMPT, /综合 point 和 detail/);
  assert.match(DEFAULT_RECOMMENDATION_SYSTEM_PROMPT, /绑定 1-4 个真实存在的观点时间戳/);
  assert.match(DEFAULT_RECOMMENDATION_SYSTEM_PROMPT, /不要输出宽泛分类/);
  assert.match(DEFAULT_RECOMMENDATION_SYSTEM_PROMPT, /少于 4 个，甚至返回空数组/);
  assert.match(DEFAULT_RECOMMENDATION_SYSTEM_PROMPT, /不要解释推荐原因/);
});

test("独立概览提示词延续原有内容要求且支持目标语言", () => {
  assert.match(OVERVIEW_SYSTEM_PROMPT, /2–3 句简体中文/);
  assert.match(OVERVIEW_SYSTEM_PROMPT, /概括这期视频到底讲了什么、按什么脉络展开/);
  assert.match(OVERVIEW_SYSTEM_PROMPT, /忠实覆盖整期视频/);
  assert.match(OVERVIEW_SYSTEM_PROMPT, /不写标题、列表、观看建议或价值评分/);
  assert.match(overviewPromptForLanguage("ko"), /2–3 句한국어/);
  assert.doesNotMatch(overviewPromptForLanguage("ko"), /2–3 句简体中文/);
});

test("解析结构化汇总按 startT 排序去重且保留完整标题", () => {
  assert.deepEqual(
    parseStructureJson(
      '```json\n{"overview":" 这期先讲问题，再讲方案。 ","sections":[{"title":"第二部分的标题非常非常长","startT":120.9},{"title":"开场","startT":0},{"title":"重复","startT":120}]}\n```',
    ),
    {
      overview: "这期先讲问题，再讲方案。",
      sections: [
        { title: "开场", startT: 0 },
        { title: "第二部分的标题非常非常长", startT: 120 },
      ],
      keyInsights: [],
      suggestedIntents: [],
    },
  );
  assert.throws(() => parseStructureJson("[]"), /缺少分区/);
  assert.deepEqual(
    parseStructureJson('{"sections":[{"title":"开场","startT":0}]}'),
    {
      overview: "",
      sections: [{ title: "开场", startT: 0 }],
      keyInsights: [],
      suggestedIntents: [],
    },
  );
});

test("解析概览 JSON，拒绝空内容并容忍模型前后说明", () => {
  assert.equal(
    parseOverviewJson('说明：```json\n{"overview":" 先讲问题，再讲方案。 "}\n```'),
    "先讲问题，再讲方案。",
  );
  assert.throws(() => parseOverviewJson("[]"), /概览内容为空/);
  assert.throws(() => parseOverviewJson("not-json"), /概览不是有效 JSON/);
});

test("parseStructureJson - with keyInsights", () => {
  const result = parseStructureJson(
    JSON.stringify({
      overview: "这是概览",
      sections: [{ title: "第一段", startT: 100 }],
      keyInsights: [
        { pointT: 200, why: "提供了可迁移的方法论" },
        { pointT: 120.9, why: " 这个观点挑战了常识 " },
        { pointT: 120, why: "重复洞见会被去重" },
        { pointT: "bad", why: "无效时间戳被过滤" },
        { pointT: 300, why: "" },
      ],
      suggestedIntents: [
        "了解科研路径",
        " 学习研究方法 ",
        "了解科研路径",
        "关注行业判断",
        "多余标签",
      ],
    }),
  );
  assert.deepEqual(result.keyInsights, [
    { pointT: 120, why: "这个观点挑战了常识" },
    { pointT: 200, why: "提供了可迁移的方法论" },
  ]);
  assert.deepEqual(result.suggestedIntents, [
    "了解科研路径",
    "学习研究方法",
    "关注行业判断",
  ]);
});

test("parseStructureJson - keyInsights optional", () => {
  const result = parseStructureJson(
    JSON.stringify({
      overview: "这是概览",
      sections: [{ title: "第一段", startT: 100 }],
    }),
  );
  assert.deepEqual(result.keyInsights, []);
  assert.deepEqual(result.suggestedIntents, []);
});

test("结构化汇总带前后说明文字时仍能提取 JSON 对象", () => {
  const result = parseStructureJson(
    '结构如下：\n{"overview":"先讲问题，再讲方案。","sections":[{"title":"问题","startT":10}],"keyInsights":[{"pointT":10,"why":"它揭示了问题本质。"}]}\n请查收。',
  );
  assert.deepEqual(result, {
    overview: "先讲问题，再讲方案。",
    sections: [{ title: "问题", startT: 10 }],
    keyInsights: [{ pointT: 10, why: "它揭示了问题本质。" }],
    suggestedIntents: [],
  });
});

test("结构化汇总只发送排序后的短观点列表且只调用一次", async () => {
  let request;
  let calls = 0;
  const result = await requestStructure(
    [
      { t: 90, point: "方案落地" },
      { t: 10, point: "问题出现" },
    ],
    {
      apiKey: "test-key",
      fetchImpl: async (url, options) => {
        calls += 1;
        request = { url, options };
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"{\\"sections\\":[{\\"title\\":\\"问题\\",\\"startT\\":10},{\\"title\\":\\"方案\\",\\"startT\\":90}],\\"keyInsights\\":[{\\"pointT\\":90,\\"why\\":\\"方案提供了可迁移的方法。\\"}]}"} } ]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    },
  );
  const body = JSON.parse(request.options.body);
  assert.equal(calls, 1);
  assert.equal(body.messages[0].content, STRUCTURE_SYSTEM_PROMPT);
  assert.equal(body.messages[1].content, "[10] 问题出现\n[90] 方案落地");
  assert.equal(
    structurePointLines([{ t: 3, point: "短观点" }]),
    "[3] 短观点",
  );
  assert.equal(result.sections.length, 2);
  assert.deepEqual(result.keyInsights, [
    { pointT: 90, why: "方案提供了可迁移的方法。" },
  ]);
  assert.deepEqual(result.suggestedIntents, []);
});

test("独立概览请求发送完整字幕、目标语言且只调用一次", async () => {
  let request;
  let calls = 0;
  const overview = await requestOverview(
    [
      { tMs: 0, text: "第一段字幕" },
      { tMs: 700000, text: "最后一段字幕" },
    ],
    {
      apiKey: "test-key",
      targetLanguage: "en",
      fetchImpl: async (url, options) => {
        calls += 1;
        request = { url, options };
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"{\\"overview\\":\\"The video moves from the problem to the solution.\\"}"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    },
  );
  const body = JSON.parse(request.options.body);
  assert.equal(calls, 1);
  assert.equal(body.messages[0].content, overviewPromptForLanguage("en"));
  assert.equal(body.messages[1].content, "[0] 第一段字幕\n[700] 最后一段字幕");
  assert.equal(body.stream, true);
  assert.equal(body.temperature, 0.2);
  assert.equal(overview, "The video moves from the problem to the solution.");
});

test("概览成功后立即独立缓存，不同语言互不覆盖", async () => {
  const storage = memoryStorage();
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    const language = JSON.parse(options.body).messages[0].content.includes("English")
      ? "English overview."
      : "中文概览。";
    return streamResponse([
      `data: {"choices":[{"delta":{"content":"${JSON.stringify({ overview: language }).replaceAll('"', '\\"')}"}}]}\n\n`,
      "data: [DONE]\n\n",
    ]);
  };
  const input = {
    videoId: "overview-language",
    segments: [{ tMs: 0, text: "完整字幕" }],
  };
  const zh = await generateOverview(
    { ...input, targetLanguage: "zh-CN" },
    { apiKey: "test-key", fetchImpl, storage, now: () => 100 },
  );
  const en = await generateOverview(
    { ...input, targetLanguage: "en" },
    { apiKey: "test-key", fetchImpl, storage, now: () => 200 },
  );
  assert.equal(zh.overview, "中文概览。");
  assert.equal(en.overview, "English overview.");
  assert.equal(calls, 2);
  assert.equal(storage.data[overviewCacheKey("overview-language", "zh-CN")].overview, "中文概览。");
  assert.equal(storage.data[overviewCacheKey("overview-language", "en")].overview, "English overview.");
  assert.equal((await getCachedOverview("overview-language", "zh-CN", storage)).overview, "中文概览。");
});

test("升级前当前版本摘要中的概览直接复用且不调用模型", async () => {
  const storage = memoryStorage({
    "summary:legacy-overview": {
      videoId: "legacy-overview",
      targetLanguage: "zh-CN",
      schemaVersion: SUMMARY_SCHEMA_VERSION,
      promptVersion: SUMMARY_PROMPT_VERSION,
      generatedAt: 99,
      overview: "旧摘要中仍然有效的概览。",
      points: [{ t: 0, point: "观点", detail: "详情" }],
    },
  });
  let calls = 0;
  const result = await generateOverview(
    {
      videoId: "legacy-overview",
      targetLanguage: "zh-CN",
      segments: [{ tMs: 0, text: "字幕" }],
    },
    {
      apiKey: "test-key",
      storage,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("不应调用模型");
      },
    },
  );
  assert.equal(result.cached, true);
  assert.equal(result.source, "legacy-summary");
  assert.equal(result.overview, "旧摘要中仍然有效的概览。");
  assert.equal(calls, 0);
});

test("独立概览不会被后续结构化响应覆盖，并补写已完成摘要", async () => {
  const summaryKey = summaryCacheKey("overview-patch", "zh-CN");
  const storage = memoryStorage({
    [summaryKey]: {
      videoId: "overview-patch",
      targetLanguage: "zh-CN",
      schemaVersion: SUMMARY_SCHEMA_VERSION,
      promptVersion: SUMMARY_PROMPT_VERSION,
      generatedAt: 1,
      overview: "",
      sections: [],
      points: [{ t: 0, point: "观点", detail: "详情" }],
    },
  });
  const result = await generateOverview(
    {
      videoId: "overview-patch",
      targetLanguage: "zh-CN",
      segments: [{ tMs: 0, text: "字幕" }],
    },
    {
      apiKey: "test-key",
      storage,
      fetchImpl: async () =>
        streamResponse([
          'data: {"choices":[{"delta":{"content":"{\\"overview\\":\\"独立生成的概览。\\"}"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
    },
  );
  assert.equal(result.overview, "独立生成的概览。");
  assert.equal(storage.data[summaryKey].overview, "独立生成的概览。");
});

test("个性化匹配只保留存在的时间戳、去重并且最多四条", () => {
  const points = [10, 20, 30, 40, 50].map((t) => ({
    t,
    point: `观点${t}`,
    detail: `详情${t}`,
  }));
  assert.deepEqual(
    parseIntentMatchesJson(
      '说明：{"pointTs":[30,999,10,30,20,40,50]}',
      points,
    ),
    [30, 10, 20, 40],
  );
  assert.throws(() => parseIntentMatchesJson("{}", points), /时间戳数组/);
});

test("个性化匹配向模型发送全部 point 和 detail，不生成推荐理由", async () => {
  let request;
  const points = [
    { t: 20, point: "行业进入智能体阶段", detail: "环境反馈会成为关键。" },
    { t: 10, point: "模型能力持续提升", detail: "推理成本正在下降。" },
  ];
  const pointTs = await requestIntentMatches("了解行业趋势", points, {
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return streamResponse([
        'data: {"choices":[{"delta":{"content":"{\\"pointTs\\":[20]}"} } ]}\n\n',
        "data: [DONE]\n\n",
      ]);
    },
  });
  const body = JSON.parse(request.options.body);
  assert.equal(body.messages[0].content, INTENT_MATCH_SYSTEM_PROMPT);
  assert.match(body.messages[1].content, /用户的观看目的：了解行业趋势/);
  assert.match(body.messages[1].content, /\[10\][\s\S]*模型能力持续提升[\s\S]*推理成本正在下降/);
  assert.match(body.messages[1].content, /\[20\][\s\S]*行业进入智能体阶段[\s\S]*环境反馈会成为关键/);
  assert.equal(body.temperature, 0.1);
  assert.deepEqual(pointTs, [20]);
  assert.equal(intentPointLines(points).startsWith("[10]"), true);
});

test("默认推荐问题只保留具体问题、真实时间戳且最多四条", () => {
  const points = [10, 20, 30, 40, 50].map((t) => ({
    t,
    point: `观点${t}`,
    detail: `详情${t}`,
  }));
  const result = parseDefaultRecommendationsJson(
    JSON.stringify({
      recommendations: [
        {
          label: "机器人当前真正卡在哪里？",
          pointTs: [30, "10", 999, 30, 20, 50, 40],
        },
        { label: "了解行业趋势？", pointTs: [10] },
        { label: "机器人当前真正卡在哪里？", pointTs: [20] },
        { label: "开源模型为什么仍难泛化？", pointTs: [40] },
        { label: "哪些技术最接近商业化？", pointTs: [50] },
        { label: "她的关键转折是什么？", pointTs: [20] },
        { label: "第五条为什么会被截掉？", pointTs: [10] },
      ],
    }),
    points,
  );
  assert.deepEqual(result, [
    { label: "机器人当前真正卡在哪里？", pointTs: [10, 20, 30, 40] },
    { label: "开源模型为什么仍难泛化？", pointTs: [40] },
    { label: "哪些技术最接近商业化？", pointTs: [50] },
    { label: "她的关键转折是什么？", pointTs: [20] },
  ]);
  assert.deepEqual(
    parseDefaultRecommendationsJson(
      '{"recommendations":[{"label":"学习方法论","pointTs":[10]},{"label":"普通标签","pointTs":[20]},{"label":"时间不存在为什么？","pointTs":[999]}]}',
      points,
    ),
    [],
  );
  assert.throws(
    () => parseDefaultRecommendationsJson("{}", points),
    /recommendations 数组/,
  );
});

test("默认推荐问题请求发送全部 point 和 detail，点击阶段无需理由", async () => {
  let request;
  const points = [
    { t: 20, point: "机器人泛化仍然困难", detail: "训练环境和真实场景差异很大。" },
    { t: 10, point: "开源模型降低入门门槛", detail: "研究者可以先复现实验再改进。" },
  ];
  const recommendations = await requestDefaultRecommendations(points, {
    apiKey: "test-key",
    targetLanguage: "zh-CN",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return streamResponse([
        'data: {"choices":[{"delta":{"content":"{\\"recommendations\\":[{\\"label\\":\\"机器人泛化为什么仍然困难？\\",\\"pointTs\\":[20]}]}"} } ]}\n\n',
        "data: [DONE]\n\n",
      ]);
    },
  });
  const body = JSON.parse(request.options.body);
  assert.equal(body.messages[0].content, DEFAULT_RECOMMENDATION_SYSTEM_PROMPT);
  assert.match(body.messages[1].content, /\[10\][\s\S]*开源模型降低入门门槛[\s\S]*研究者可以先复现实验再改进/);
  assert.match(body.messages[1].content, /\[20\][\s\S]*机器人泛化仍然困难[\s\S]*训练环境和真实场景差异很大/);
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(recommendations, [
    { label: "机器人泛化为什么仍然困难？", pointTs: [20] },
  ]);
});

test("默认推荐问题按视频、语言、推荐 prompt 版本和摘要生成时间缓存", async () => {
  const summary = {
    videoId: "video-default",
    targetLanguage: "zh-CN",
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    promptVersion: SUMMARY_PROMPT_VERSION,
    generatedAt: 111,
    points: [
      { t: 10, point: "机器人泛化困难", detail: "真实世界变化太多。" },
      { t: 20, point: "开源加快研究", detail: "更多团队能复现和比较。" },
    ],
  };
  const summaryKey = summaryCacheKey("video-default", "zh-CN");
  const cacheKey = defaultRecommendationCacheKey("video-default", "zh-CN");
  const storage = memoryStorage({ [summaryKey]: summary });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return streamResponse([
      'data: {"choices":[{"delta":{"content":"{\\"recommendations\\":[{\\"label\\":\\"机器人泛化为什么困难？\\",\\"pointTs\\":[10]}]}"} } ]}\n\n',
      "data: [DONE]\n\n",
    ]);
  };
  const first = await generateDefaultRecommendations(
    { videoId: "video-default", targetLanguage: "zh-CN" },
    { apiKey: "test-key", storage, fetchImpl, now: () => 999 },
  );
  const cached = await getCachedDefaultRecommendations(
    "video-default",
    "zh-CN",
    summary,
    storage,
  );
  const second = await generateDefaultRecommendations(
    { videoId: "video-default", targetLanguage: "zh-CN" },
    { apiKey: "test-key", storage, fetchImpl },
  );
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(cached.recommendations, first.recommendations);
  assert.equal(storage.data[cacheKey].videoId, "video-default");
  assert.equal(storage.data[cacheKey].targetLanguage, "zh-CN");
  assert.equal(storage.data[cacheKey].promptVersion, DEFAULT_RECOMMENDATION_PROMPT_VERSION);
  assert.equal(storage.data[cacheKey].summaryGeneratedAt, 111);

  storage.data[summaryKey] = { ...summary, generatedAt: 222 };
  const third = await generateDefaultRecommendations(
    { videoId: "video-default", targetLanguage: "zh-CN" },
    { apiKey: "test-key", storage, fetchImpl },
  );
  assert.equal(third.cached, false);
  assert.equal(calls, 2);
});

test("相同视频与需求复用本地推荐缓存，摘要更新后自动失效", async () => {
  const summary = {
    videoId: "video-intent",
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    promptVersion: SUMMARY_PROMPT_VERSION,
    generatedAt: 1234,
    points: [
      { t: 10, point: "行业判断", detail: "智能体会改变软件形态。" },
      { t: 20, point: "研究方法", detail: "先验证问题再扩大实验。" },
    ],
  };
  const storage = memoryStorage({ "summary:video-intent": summary });
  let calls = 0;
  const options = {
    apiKey: "test-key",
    storage,
    now: () => 5678,
    fetchImpl: async () => {
      calls += 1;
      return streamResponse([
        'data: {"choices":[{"delta":{"content":"{\\"pointTs\\":[10]}"} } ]}\n\n',
        "data: [DONE]\n\n",
      ]);
    },
  };
  const first = await matchVideoIntent(
    { videoId: "video-intent", intent: "了解行业趋势" },
    options,
  );
  const second = await matchVideoIntent(
    { videoId: "video-intent", intent: "  了解行业趋势  " },
    options,
  );
  assert.deepEqual(first, { pointTs: [10], cached: false });
  assert.deepEqual(second, { pointTs: [10], cached: true });
  assert.equal(calls, 1);
  assert.equal(storage.data["recommendations:video-intent"].entries.length, 1);

  storage.data["summary:video-intent"] = { ...summary, generatedAt: 9999 };
  const third = await matchVideoIntent(
    { videoId: "video-intent", intent: "了解行业趋势" },
    options,
  );
  assert.equal(third.cached, false);
  assert.equal(calls, 2);
});

test("F2 结构化汇总只在全部观点块完成后开始", async () => {
  const storage = memoryStorage();
  const events = [];
  let requestIndex = 0;
  const result = await summarizeVideo(
    {
      videoId: "video-structure-order",
      segments: [
        { tMs: 0, text: "第一块观点" },
        { tMs: 700000, text: "第二块观点" },
      ],
    },
    {
      apiKey: "test-key",
      storage,
      onChunk: ({ index }) => events.push(`chunk:${index}`),
      onStructureStart: ({ pointCount }) =>
        events.push(`structure:${pointCount}`),
      fetchImpl: async () => {
        requestIndex += 1;
        if (requestIndex <= 2) {
          const t = requestIndex === 1 ? 10 : 710;
          return streamResponse([
            `data: {"choices":[{"delta":{"content":"[{\\"t\\":${t},\\"point\\":\\"观点${requestIndex}\\",\\"detail\\":\\"详情${requestIndex}。\\"}]"} } ]}\n\n`,
            "data: [DONE]\n\n",
          ]);
        }
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"{\\"sections\\":[{\\"title\\":\\"第一部分\\",\\"startT\\":10},{\\"title\\":\\"第二部分\\",\\"startT\\":710}],\\"keyInsights\\":[{\\"pointT\\":710,\\"why\\":\\"第二点揭示了问题的深层原因。\\"}]}"} } ]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    },
  );
  assert.deepEqual(events, ["chunk:0", "chunk:1", "structure:2"]);
  assert.equal(result.summary.points.length, 2);
  assert.equal(result.summary.overview, "");
  assert.deepEqual(result.summary.keyInsights, [
    { pointT: 710, why: "第二点揭示了问题的深层原因。" },
  ]);
});

test("分层后的单条观点保留合并例子与关键时间标记", () => {
  const points = parsePointsJson(
    '[{"t":120,"point":"团队合并是必要选择","detail":"分散算力会削弱模型能力。团队合并虽有争议，但能集中资源〔06:26〕。"}]',
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].point, "团队合并是必要选择");
  assert.match(points[0].detail, /集中资源〔06:26〕/);
});

test("同一秒的近义观点只保留信息更完整的一条", () => {
  const points = parsePointsJson(
    JSON.stringify([
      {
        t: 103,
        point: "编码代理不应等待用户",
        detail: "代理应主动开始工作。",
      },
      {
        t: 103,
        point: "编码代理不应等待用户按回车",
        detail: "代理应主动读取任务，并在满足触发条件时开始工作。",
      },
      {
        t: 131,
        point: "目标是成为工具变好友",
        detail: "这是下一条独立观点。",
      },
    ]),
  );
  assert.deepEqual(points.map((point) => point.t), [103, 131]);
  assert.equal(points[0].point, "编码代理不应等待用户按回车");
  assert.match(points[0].detail, /触发条件/);

  assert.deepEqual(
    dedupePointsByTimestamp([
      { t: 55, point: "短", detail: "短。" },
      { t: 55.9, point: "更完整", detail: "更完整的论据与例子。" },
    ]),
    [{ t: 55, point: "更完整", detail: "更完整的论据与例子。" }],
  );
});

test("DeepSeek 请求使用规定模型、提示词、流式响应和温度", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return streamResponse([
      'data: {"choices":[{"delta":{"content":"[{\\"t\\":0,\\"point\\":\\"观点\\","}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"\\"detail\\":\\"论据与例子。\\"}]"} } ]}\n\n',
      "data: [DONE]\n\n",
    ]);
  };
  const points = await requestChunk([{ tMs: 0, text: "原字幕" }], {
    apiKey: "test-key",
    fetchImpl,
  });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.equal(body.model, "deepseek-chat");
  assert.equal(body.stream, true);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.messages[0].content, SYSTEM_PROMPT);
  assert.equal(body.messages[1].content, "[0] 原字幕");
  assert.equal(points[0].point, "观点");
});

test("单个分块 JSON 截断时自动重试一次", async () => {
  let calls = 0;
  const points = await requestChunk([{ tMs: 0, text: "原字幕" }], {
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"[{\\"t\\":0,\\"point\\":\\"截断\\""}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      return streamResponse([
        'data: {"choices":[{"delta":{"content":"[{\\"t\\":0,\\"point\\":\\"重试成功\\",\\"detail\\":\\"第二次返回完整 JSON。\\"}]"} } ]}\n\n',
        "data: [DONE]\n\n",
      ]);
    },
  });
  assert.equal(calls, 2);
  assert.equal(points[0].point, "重试成功");
});

test("分块 JSON 持续无效时只按配置重试并暴露格式错误", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      requestChunk([{ tMs: 0, text: "原字幕" }], {
        apiKey: "test-key",
        maxJsonRetries: 1,
        fetchImpl: async () => {
          calls += 1;
          return streamResponse([
            'data: {"choices":[{"delta":{"content":"not-json"} } ]}\n\n',
            "data: [DONE]\n\n",
          ]);
        },
      }),
    /模型返回内容不是有效 JSON/,
  );
  assert.equal(calls, 2);
});

test("HTTP 错误不做 JSON 重试", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      requestChunk([{ tMs: 0, text: "字幕" }], {
        apiKey: "test-key",
        fetchImpl: async () => {
          calls += 1;
          return streamResponse([], 429);
        },
      }),
    /HTTP 429/,
  );
  assert.equal(calls, 1);
});

test("逐块生成、按时间排序并以 summary:<videoId> 落缓存", async () => {
  const storage = memoryStorage();
  let calls = 0;
  const chunksSeen = [];
  const fetchImpl = async () => {
    calls += 1;
    const t = calls === 1 ? 20 : 10;
    return streamResponse([
      `data: {"choices":[{"delta":{"content":"[{\\"t\\":${t},\\"point\\":\\"观点${calls}\\",\\"detail\\":\\"细节${calls}。\\"}]"} } ]}\n\n`,
      "data: [DONE]\n\n",
    ]);
  };
  const input = {
    videoId: "video-1",
    duration: 1000,
    sourceLang: "en",
    segments: [
      { tMs: 0, text: "第一段" },
      { tMs: 700000, text: "第二段" },
    ],
  };
  const first = await summarizeVideo(input, {
    apiKey: "test-key",
    fetchImpl,
    storage,
    now: () => 1234,
    onChunk: (chunk) => chunksSeen.push(chunk),
  });
  assert.equal(first.cached, false);
  assert.deepEqual(first.summary.points.map((point) => point.t), [10, 20]);
  assert.equal(first.summary.generatedAt, 1234);
  assert.equal(first.summary.schemaVersion, SUMMARY_SCHEMA_VERSION);
  assert.equal(first.summary.promptVersion, SUMMARY_PROMPT_VERSION);
  assert.equal(first.summary.overview, "");
  assert.deepEqual(first.summary.sections, []);
  assert.deepEqual(first.summary.keyInsights, []);
  assert.deepEqual(first.summary.suggestedIntents, []);
  assert.equal(storage.data["summary:video-1"].videoId, "video-1");
  assert.equal(chunksSeen.length, 2);

  const second = await summarizeVideo(input, {
    apiKey: "test-key",
    fetchImpl,
    storage,
  });
  assert.equal(second.cached, true);
  assert.equal(calls, 3, "命中缓存后不应再次调用 API");
});

test("恢复任务时保留已完成分段并从下一个分段继续", async () => {
  const storage = memoryStorage();
  const requestBodies = [];
  const fetchImpl = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    if (requestBodies.length === 1) {
      return streamResponse([
        'data: {"choices":[{"delta":{"content":"[{\\"t\\":700,\\"point\\":\\"第二段观点\\",\\"detail\\":\\"第二段细节。\\"}]"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    }
    return streamResponse([
      'data: {"choices":[{"delta":{"content":"{\\"overview\\":\\"概览\\",\\"sections\\":[{\\"title\\":\\"全文\\",\\"startT\\":0}]}"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
  };
  const result = await summarizeVideo(
    {
      videoId: "resumed-video",
      segments: [
        { tMs: 0, text: "第一段字幕" },
        { tMs: 700000, text: "第二段字幕" },
      ],
      resume: {
        nextChunkIndex: 1,
        points: [{ t: 0, tLabel: "00:00", point: "第一段观点", detail: "第一段细节。" }],
      },
    },
    { apiKey: "test-key", fetchImpl, storage },
  );
  assert.match(requestBodies[0].messages[1].content, /第二段字幕/);
  assert.doesNotMatch(requestBodies[0].messages[1].content, /第一段字幕/);
  assert.deepEqual(result.summary.points.map((point) => point.t), [0, 700]);
});

test("旧 schema 缓存自动失效且不增加用户侧缓存控制", async () => {
  const storage = memoryStorage({
    "summary:video-old": {
      videoId: "video-old",
      schemaVersion: SUMMARY_SCHEMA_VERSION - 1,
      promptVersion: SUMMARY_PROMPT_VERSION,
      points: [{ t: 0, point: "旧观点", detail: "旧详情" }],
    },
  });
  let calls = 0;
  const result = await summarizeVideo(
    {
      videoId: "video-old",
      segments: [{ tMs: 0, text: "模型应该集中资源。" }],
    },
    {
      apiKey: "test-key",
      storage,
      fetchImpl: async () => {
        calls += 1;
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"[{\\"t\\":0,\\"point\\":\\"集中资源提升模型能力\\",\\"detail\\":\\"分散资源会削弱能力。\\"}]"} } ]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    },
  );
  assert.equal(result.cached, false);
  assert.equal(calls, 2);
  assert.equal(result.summary.schemaVersion, SUMMARY_SCHEMA_VERSION);
  assert.equal(result.summary.promptVersion, SUMMARY_PROMPT_VERSION);
});

test("C promptVersion 升级使旧措辞缓存自动失效", async () => {
  const storage = memoryStorage({
    "summary:video-old-prompt": {
      videoId: "video-old-prompt",
      schemaVersion: SUMMARY_SCHEMA_VERSION,
      promptVersion: SUMMARY_PROMPT_VERSION - 1,
      points: [{ t: 0, point: "术语堆砌旧文案", detail: "旧详情" }],
    },
  });
  let calls = 0;
  const result = await summarizeVideo(
    {
      videoId: "video-old-prompt",
      segments: [{ tMs: 0, text: "复杂内容应该用自然语言解释，同时保留关键条件。" }],
    },
    {
      apiKey: "test-key",
      storage,
      fetchImpl: async () => {
        calls += 1;
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"[{\\"t\\":0,\\"point\\":\\"复杂内容要说得好懂，也不能丢掉关键条件\\",\\"detail\\":\\"表达应使用自然语言，同时保留决定结论是否成立的前提条件。\\"}]"} } ]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    },
  );
  assert.equal(result.cached, false);
  assert.equal(calls, 2);
  assert.equal(result.summary.promptVersion, SUMMARY_PROMPT_VERSION);
  assert.match(result.summary.points[0].point, /好懂/);
});

test("结构化汇总失败时仍缓存完整观点并降级为平铺数据", async () => {
  const storage = memoryStorage();
  let calls = 0;
  const result = await summarizeVideo(
    {
      videoId: "video-flat",
      segments: [{ tMs: 0, text: "观点字幕" }],
    },
    {
      apiKey: "test-key",
      storage,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return streamResponse([
            'data: {"choices":[{"delta":{"content":"[{\\"t\\":0,\\"point\\":\\"核心观点\\",\\"detail\\":\\"完整细节。\\"}]"} } ]}\n\n',
            "data: [DONE]\n\n",
          ]);
        }
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"not-json"} } ]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    },
  );
  assert.equal(result.summary.points.length, 1);
  assert.equal(result.summary.overview, "");
  assert.deepEqual(result.summary.sections, []);
  assert.equal(storage.data["summary:video-flat"].points.length, 1);
});

test("API 错误不会吞掉", async () => {
  await assert.rejects(
    () =>
      requestChunk([{ tMs: 0, text: "字幕" }], {
        apiKey: "test-key",
        fetchImpl: async () => streamResponse([], 429),
      }),
    /HTTP 429/,
  );
  await assert.rejects(
    () => requestChunk([{ tMs: 0, text: "字幕" }], { apiKey: "" }),
    /API Key/,
  );
});

test("超时覆盖完整 SSE 读取过程", async () => {
  await assert.rejects(
    () =>
      requestChunk([{ tMs: 0, text: "字幕" }], {
        apiKey: "test-key",
        timeoutMs: 5,
        fetchImpl: async (_url, options) => ({
          ok: true,
          status: 200,
          body: {
            getReader() {
              return {
                read() {
                  return new Promise((_resolve, reject) => {
                    options.signal.addEventListener(
                      "abort",
                      () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                      { once: true },
                    );
                  });
                },
              };
            },
          },
        }),
      }),
    /请求超时/,
  );
});
