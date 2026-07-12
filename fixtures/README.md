# fixtures 说明（给 Codex 看）

这些是样本数据，用于在**没有浏览器**的环境下开发并单元测试字幕相关逻辑（对应开发文档 M1）。

- `sample_player_response_captions.json`：`ytInitialPlayerResponse` 里字幕轨道部分的样本。用它测试“选轨道”逻辑（优先非翻译的原语言/英文，含 asr；排除 YouTube 翻译轨道）。
- `sample_timedtext_json3.json`：字幕 `&fmt=json3` 返回样本。用它测试“解析为 `[{ tMs, text }]`”的逻辑。

对这两个夹具的解析单元测试全部通过，即视为 M1 在无浏览器环境下达成。真实浏览器里的最终验证由用户早上手动完成（在 Chrome 加载扩展、打开一个真实有字幕的视频核对）。

> 若真实 YouTube 返回结构与样本有差异，以真实结构为准，并在 BUILD_LOG.md 记录差异点。
