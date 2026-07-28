"use strict";

const form = document.querySelector("#key-form");
const input = document.querySelector("#api-key");
const status = document.querySelector("#save-status");

chrome.storage.local.get("deepseek_api_key").then((result) => {
  input.value = result.deepseek_api_key || "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = input.value.trim();
  if (!apiKey) {
    status.textContent = "请输入 API Key";
    return;
  }
  try {
    await chrome.storage.local.set({ deepseek_api_key: apiKey });
    status.textContent = "已保存";
  } catch {
    status.textContent = "保存失败，请重试";
  }
});
