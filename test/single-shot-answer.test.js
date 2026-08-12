"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const BaseSummary = require("../generation-utils.js");
const SkimlineCollections = require("../collection-utils.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message = "等待答卷任务超时") {
  const deadline = Date.now() + 1500;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === "string") return { [keys]: data[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, data[key]]));
      }
      return {};
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

function summaryRecord() {
  return {
    videoId: "abcdefghijk",
    targetLanguage: "zh-CN",
    schemaVersion: BaseSummary.SUMMARY_SCHEMA_VERSION,
    promptVersion: BaseSummary.SUMMARY_PROMPT_VERSION,
    generatedAt: 1000,
    overview: "视频讨论如何设计独立评测。",
    sections: [{ startT: 0, title: "评测原则" }],
    points: [
      { t: 10, point: "评测必须独立", detail: "不能让训练反向污染评测。" },
      { t: 20, point: "先固定评测集", detail: "再开始迭代系统。" },
    ],
  };
}

function createHarness({ requestAnswer, local, session } = {}) {
  let messageListener;
  const broadcasts = [];
  const localStorage =
    local ||
    createStorage({
      deepseek_api_key: "test-key",
      "summary:abcdefghijk": summaryRecord(),
    });
  const sessionStorage = session || createStorage();
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    storage: { local: localStorage, session: sessionStorage },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      async sendMessage(message) {
        broadcasts.push(message);
      },
    },
    tabs: { onRemoved: { addListener() {} } },
  };
  const YouTubeSummary = {
    ...BaseSummary,
    requestSingleShotAnswer: requestAnswer,
  };
  const context = vm.createContext({
    AbortController,
    Date,
    Error,
    Map,
    Promise,
    Set,
    String,
    Number,
    Object,
    Array,
    Math,
    console,
    setTimeout,
    clearTimeout,
    chrome,
    YouTubeSummary,
    SkimlineCollections,
    importScripts() {},
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"),
    context,
    { filename: "background.js" },
  );

  function invoke(message) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`消息未响应：${message.type}`)),
        1500,
      );
      const keepOpen = messageListener(message, {}, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      if (keepOpen !== true) {
        clearTimeout(timeout);
        reject(new Error(`消息未异步处理：${message.type}`));
      }
    });
  }

  async function getTask(taskId) {
    const response = await invoke({ type: "GET_ANSWER_TASK", taskId });
    return response.task;
  }

  return {
    broadcasts,
    getTask,
    invoke,
    local: localStorage,
    session: sessionStorage,
  };
}

function initialPayload(overrides = {}) {
  return {
    clientId: "client-1",
    sourceTabId: 11,
    videoId: "abcdefghijk",
    videoTitle: "评测视频",
    targetLanguage: "zh-CN",
    question: "为什么评测要保持独立？",
    operationId: "initial-1",
    ...overrides,
  };
}

const answer = (directAnswer, usedCaptions = false) => ({
  action: "answer",
  scope: "in_scope",
  directAnswer,
  evidenceTs: [10],
  steps: [],
  uncertain: false,
  notice: "",
  usedCaptions,
});

test("首答只使用摘要并落为可恢复的 ready 任务", async () => {
  const calls = [];
  const harness = createHarness({
    requestAnswer: async (input, context) => {
      calls.push({ input, context });
      return answer("评测独立才能避免循环验证。");
    },
  });
  const started = await harness.invoke({
    type: "START_ANSWER",
    payload: initialPayload(),
  });
  assert.equal(started.ok, true);
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.status === "ready");
  const task = await harness.getTask(started.task.taskId);
  assert.equal(task.answer.directAnswer, "评测独立才能避免循环验证。");
  assert.equal(task.turns, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.phase, "initial");
  assert.equal("segments" in calls[0].input, false);
  assert.equal(calls[0].context.captionText, "");
});

test("need_captions 先提交 fallback，Panel 不回传也不会停在中间态", async () => {
  const harness = createHarness({
    requestAnswer: async (input, context) => {
      if (context.phase === "initial") return answer("首答");
      return {
        action: "need_captions",
        scope: "in_scope",
        fallbackAnswer: {
          directAnswer: "摘要能支持的保守回答",
          evidenceTs: [10],
          steps: [],
          uncertain: true,
          notice: "摘要没有展开这一点",
          usedCaptions: false,
        },
        retrieval: { query: "循环工程", anchorTs: [10] },
      };
    },
  });
  const started = await harness.invoke({ type: "START_ANSWER", payload: initialPayload() });
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.status === "ready");
  await harness.invoke({
    type: "ASK_ANSWER_FOLLOWUP",
    payload: {
      taskId: started.task.taskId,
      question: "原字幕具体怎么说？",
      expectedTurn: 0,
      operationId: "followup-1",
    },
  });
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.turns === 1);
  const task = await harness.getTask(started.task.taskId);
  assert.equal(task.status, "ready");
  assert.equal(task.answer.directAnswer, "摘要能支持的保守回答");
  assert.equal(task.answer.uncertain, true);
  assert.equal(task.captionUpgrade.status, "requested");
});

test("同一 operationId 的阶段一与字幕升级分别幂等，升级不重复计轮次", async () => {
  const phases = [];
  const harness = createHarness({
    requestAnswer: async (input, context) => {
      phases.push(context.phase);
      if (context.phase === "initial") return answer("首答");
      if (context.phase === "followup") {
        return {
          action: "need_captions",
          scope: "in_scope",
          fallbackAnswer: {
            directAnswer: "fallback",
            evidenceTs: [10],
            steps: [],
            uncertain: true,
            notice: "待核对字幕",
          },
          retrieval: { query: "评测", anchorTs: [10] },
        };
      }
      return answer("结合字幕后的回答", true);
    },
  });
  const started = await harness.invoke({ type: "START_ANSWER", payload: initialPayload() });
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.status === "ready");
  await harness.invoke({
    type: "ASK_ANSWER_FOLLOWUP",
    payload: {
      taskId: started.task.taskId,
      question: "请核对字幕",
      expectedTurn: 0,
      operationId: "shared-op",
    },
  });
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.captionUpgrade?.status === "requested");
  const fallback = await harness.getTask(started.task.taskId);
  await harness.invoke({
    type: "CONTINUE_ANSWER_WITH_CAPTIONS",
    payload: {
      taskId: started.task.taskId,
      operationId: "shared-op",
      taskVersion: fallback.taskVersion,
      segments: [{ tMs: 10000, text: "评测必须与训练隔离" }],
    },
  });
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.answer?.usedCaptions === true);
  const upgraded = await harness.getTask(started.task.taskId);
  assert.equal(upgraded.answer.directAnswer, "结合字幕后的回答");
  assert.equal(upgraded.turns, 1);
  assert.deepEqual(phases, ["initial", "followup", "caption_upgrade"]);
  await harness.invoke({
    type: "CONTINUE_ANSWER_WITH_CAPTIONS",
    payload: {
      taskId: started.task.taskId,
      operationId: "shared-op",
      taskVersion: fallback.taskVersion,
      segments: [{ tMs: 10000, text: "重复" }],
    },
  });
  assert.deepEqual(phases, ["initial", "followup", "caption_upgrade"]);
});

test("字幕模型迟到时提交前再次校验 taskVersion，不覆盖更新的追问", async () => {
  const oldUpgrade = deferred();
  let followupCount = 0;
  const harness = createHarness({
    requestAnswer: async (input, context) => {
      if (context.phase === "initial") return answer("首答");
      if (context.phase === "caption_upgrade") return oldUpgrade.promise;
      followupCount += 1;
      if (followupCount === 1) {
        return {
          action: "need_captions",
          scope: "in_scope",
          fallbackAnswer: {
            directAnswer: "旧轮 fallback",
            evidenceTs: [10],
            steps: [],
            uncertain: true,
            notice: "待升级",
          },
          retrieval: { query: "评测", anchorTs: [10] },
        };
      }
      return answer("第二轮追问的新答案");
    },
  });
  const started = await harness.invoke({ type: "START_ANSWER", payload: initialPayload() });
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.status === "ready");
  await harness.invoke({
    type: "ASK_ANSWER_FOLLOWUP",
    payload: {
      taskId: started.task.taskId,
      question: "第一次追问",
      expectedTurn: 0,
      operationId: "op-old",
    },
  });
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.captionUpgrade?.status === "requested");
  const fallback = await harness.getTask(started.task.taskId);
  await harness.invoke({
    type: "CONTINUE_ANSWER_WITH_CAPTIONS",
    payload: {
      taskId: started.task.taskId,
      operationId: "op-old",
      taskVersion: fallback.taskVersion,
      segments: [{ tMs: 10000, text: "旧字幕" }],
    },
  });
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.captionUpgrade?.status === "running");
  await harness.invoke({
    type: "ASK_ANSWER_FOLLOWUP",
    payload: {
      taskId: started.task.taskId,
      question: "第二次追问",
      expectedTurn: 1,
      operationId: "op-new",
    },
  });
  oldUpgrade.resolve(answer("不应覆盖的新字幕答案", true));
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.turns === 2);
  const finalTask = await harness.getTask(started.task.taskId);
  assert.equal(finalTask.answer.directAnswer, "第二轮追问的新答案");
  assert.equal(finalTask.answer.usedCaptions, false);
});

test("Worker 重启后按 clientId 重建 active 指针并保留 taskVersion", async () => {
  const first = createHarness({
    requestAnswer: async () => answer("可恢复答卷"),
  });
  const started = await first.invoke({ type: "START_ANSWER", payload: initialPayload() });
  await waitFor(async () => (await first.getTask(started.task.taskId))?.status === "ready");
  const before = await first.getTask(started.task.taskId);
  const restarted = createHarness({
    local: first.local,
    session: first.session,
    requestAnswer: async () => answer("不应重新生成"),
  });
  const response = await restarted.invoke({
    type: "GET_ANSWER_TASK",
    clientId: "client-1",
    videoId: "abcdefghijk",
    sourceTabId: 11,
  });
  assert.equal(response.ok, true);
  assert.equal(response.task.taskId, started.task.taskId);
  assert.equal(response.task.taskVersion, before.taskVersion);
  assert.equal(response.task.answer.directAnswer, "可恢复答卷");
});

test("答卷模型调用使用 Background 全局单并发，多 Panel 依次排队", async () => {
  const firstCall = deferred();
  const secondCall = deferred();
  let calls = 0;
  const harness = createHarness({
    requestAnswer: async () => {
      calls += 1;
      return calls === 1 ? firstCall.promise : secondCall.promise;
    },
  });
  const first = await harness.invoke({
    type: "START_ANSWER",
    payload: initialPayload({ clientId: "client-a", question: "问题 A" }),
  });
  const second = await harness.invoke({
    type: "START_ANSWER",
    payload: initialPayload({ clientId: "client-b", question: "问题 B" }),
  });
  await waitFor(() => calls === 1);
  assert.equal((await harness.getTask(second.task.taskId)).status, "queued");
  firstCall.resolve(answer("回答 A"));
  await waitFor(() => calls === 2);
  secondCall.resolve(answer("回答 B"));
  await waitFor(async () => (await harness.getTask(second.task.taskId))?.status === "ready");
  assert.equal((await harness.getTask(first.task.taskId)).answer.directAnswer, "回答 A");
  assert.equal((await harness.getTask(second.task.taskId)).answer.directAnswer, "回答 B");
});

test("摘要裁剪内容变化后同一问题不会复用旧任务", async () => {
  let calls = 0;
  const harness = createHarness({
    requestAnswer: async () => answer(`第 ${++calls} 次回答`),
  });
  const first = await harness.invoke({ type: "START_ANSWER", payload: initialPayload() });
  await waitFor(async () => (await harness.getTask(first.task.taskId))?.status === "ready");
  harness.local.data["summary:abcdefghijk"] = {
    ...summaryRecord(),
    sections: [{ startT: 0, title: "已经改写的章节标题" }],
  };
  const second = await harness.invoke({
    type: "START_ANSWER",
    payload: initialPayload({ operationId: "initial-2" }),
  });
  assert.notEqual(second.task.taskId, first.task.taskId);
  await waitFor(async () => (await harness.getTask(second.task.taskId))?.status === "ready");
  assert.equal(calls, 2);
});

test("同一摘要与问题重新提交复用首答缓存，追问不会污染缓存基线", async () => {
  let calls = 0;
  const harness = createHarness({
    requestAnswer: async (input, context) => {
      calls += 1;
      return context.phase === "initial" ? answer("首答缓存") : answer("追问版本");
    },
  });
  const first = await harness.invoke({ type: "START_ANSWER", payload: initialPayload() });
  await waitFor(async () => (await harness.getTask(first.task.taskId))?.status === "ready");
  await harness.invoke({
    type: "ASK_ANSWER_FOLLOWUP",
    payload: {
      taskId: first.task.taskId,
      question: "说得更具体",
      expectedTurn: 0,
      operationId: "followup-cache",
    },
  });
  await waitFor(async () => (await harness.getTask(first.task.taskId))?.turns === 1);
  await harness.invoke({ type: "CLEAR_ANSWER", taskId: first.task.taskId });
  const second = await harness.invoke({
    type: "START_ANSWER",
    payload: initialPayload({ operationId: "initial-cache-2" }),
  });
  assert.notEqual(second.task.taskId, first.task.taskId);
  assert.equal(second.task.status, "ready");
  assert.equal(second.task.answer.directAnswer, "首答缓存");
  assert.equal(second.task.turns, 0);
  assert.equal(calls, 2);
});

test("清除只解除恢复指针，不会让正在生成的任务失去终态", async () => {
  const pending = deferred();
  const harness = createHarness({ requestAnswer: async () => pending.promise });
  const started = await harness.invoke({ type: "START_ANSWER", payload: initialPayload() });
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.status === "running");
  await harness.invoke({ type: "CLEAR_ANSWER", taskId: started.task.taskId });
  pending.resolve(answer("清除后仍完成"));
  await waitFor(async () => (await harness.getTask(started.task.taskId))?.status === "ready");
  const finished = await harness.getTask(started.task.taskId);
  assert.equal(finished.dismissed, true);
  assert.equal(finished.answer.directAnswer, "清除后仍完成");
  const active = await harness.invoke({
    type: "GET_ANSWER_TASK",
    clientId: "client-1",
    videoId: "abcdefghijk",
    sourceTabId: 11,
  });
  assert.equal(active.task, null);
});
