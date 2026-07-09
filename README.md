# Skimline

> Skim any long video.

Skimline 是一个 Manifest V3 Chrome 扩展：在浏览器原生 Side Panel 中，把 YouTube 长访谈、播客和演讲整理成可展开、可跳转的简体中文观点地图。原生 JavaScript、无后端，DeepSeek API Key 只保存在用户本机的 `chrome.storage.local`。

## 下载与安装

### 方式 A：直接下载可安装版本

1. 打开仓库中的 `releases/skimline-0.1.0-extension.zip`。
2. 点击 `Download raw file` 下载 ZIP。
3. 解压 ZIP。
4. 打开 Chrome，在地址栏输入 `chrome://extensions`。
5. 打开右上角“开发者模式”。
6. 点击“加载已解压的扩展程序”，选择解压后的扩展目录。
7. 在扩展卡片中点击“详细信息”→“扩展程序选项”，填入自己的 DeepSeek API Key 并保存。
8. 打开一个带字幕的 `youtube.com/watch?v=...` 视频，点击 Chrome 工具栏中的“Skimline”图标，浏览器右侧会打开专属 Side Panel。

### 方式 B：从源码运行

1. 点击 GitHub 页面右上角 `Code` → `Download ZIP`。
2. 解压 ZIP。
3. 打开 Chrome，在地址栏输入 `chrome://extensions`。
4. 打开右上角“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择解压后的项目目录。
6. 在扩展卡片中点击“详细信息”→“扩展程序选项”，填入自己的 DeepSeek API Key 并保存。
7. 打开一个带字幕的 `youtube.com/watch?v=...` 视频，点击 Chrome 工具栏中的“Skimline”图标，浏览器右侧会打开专属 Side Panel。

Side Panel 不会覆盖视频或 YouTube 推荐栏。长视频生成时，观点块即使乱序返回也会始终按时间升序排列；底部用灰色进度和 shimmer 表示后面还有内容。全部观点完成后，整期概览才会淡入顶部，并显示默认折叠的自然分区。

分区使用中性灰底章节栏；单点分区只显示一个时间，多点分区显示时间范围。超长分区标题和观点只在界面上显示省略号，原始内容不会被截断。点击分区标题展开，点击右侧时间跳到该段开头；播放时当前分区和当前观点会同时高亮，只有分区已展开时才自动跟随观点。

观点层用自然、好懂的中文讲清大意，不再为了短而截断；展开详情会继续保留专业术语、数据、前提条件和关键例子。

修改代码后，在 `chrome://extensions` 的扩展卡片上点击刷新按钮，再刷新 YouTube 页面。

## 测试

要求 Node.js 20 或更高版本：

```bash
npm test
```

测试覆盖 Side Panel 声明与渲染、侧栏↔内容脚本消息桥、字幕轨道选择、json3 与官方文字记录 fallback、分块、乱序流式合并、生成进度、概览时机、观点与结构化汇总提示词、完整标题与 CSS 省略、缓存版本、折叠与跳转、双层播放跟随和关键视觉 token。`config.local.js` 仅供本地烟测，已被 Git 忽略，严禁提交或记录其中内容。

## 隐私与范围

- 仓库不会包含任何作者或用户的 DeepSeek API Key。
- 每个使用者都需要在扩展选项页填写自己的 DeepSeek API Key。
- API Key 只写入当前浏览器本机的 `chrome.storage.local`，不会提交到 GitHub，也不会进入缓存摘要。
- 字幕只发送到用户配置的 DeepSeek API，不经过项目自有服务器。
- 不展示逐字稿，不提供问答、笔记、导出、语音转文字或模型切换。
- 没有字幕的视频会明确提示暂不支持。

## 发布前检查

发布公开仓库前建议执行：

```bash
npm test
git ls-files -z | xargs -0 rg -n "(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|Bearer [A-Za-z0-9._-]{20,})" -S
```

第二条命令没有输出时，表示已跟踪文件里没有匹配到常见 API Key / Bearer Token 形态。

## 当前版本

- Version: `0.1.0`
- Install ZIP: `releases/skimline-0.1.0-extension.zip`
- SHA-256: `f3daab651731978fab119d835e0e6fda5e7008ca8b320978a508272f17928a73`
