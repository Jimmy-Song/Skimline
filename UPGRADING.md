# Skimline 安全升级指南

Skimline 0.5.1 开始使用固定的 Chrome 扩展 ID。升级前的版本可能因解压目录变化而被 Chrome 识别成另一份扩展，因此从旧版迁移到 0.5.1 需要做最后一次数据转移。

## 从 0.5.0 或更早版本迁移

每台电脑分别执行以下步骤：

1. 在旧版 Skimline 的洞见库中点击“导出”，把 JSON 备份保存到安全位置。
2. 确认自己仍持有 DeepSeek API Key。洞见备份不会包含 API Key。
3. 在 `chrome://extensions` 记录旧版 Skimline 的扩展 ID，然后关闭已打开的 YouTube 页面。
4. 关闭旧版 Skimline 卡片上的开关。这里只能“禁用”，不要点击“移除”；禁用会保留 `chrome.storage.local` 中的数据。
5. 下载新的 GitHub 发布包并解压，选择其中固定名称的 `skimline-extension` 目录，通过“加载已解压的扩展程序”加载新版。新版扩展 ID 应显示为 `dcgckommjpeabnlkonmkmhlcaoafolfi`；若不一致，立即停止迁移并保留旧版。
6. 打开新版设置页，填入自己的 DeepSeek API Key。
7. 打开新版洞见库，导入第 1 步的 JSON 备份，核对视频数和收藏数。
8. 收藏一条测试观点，重启 Chrome 后确认新旧收藏都还存在。
9. 保留禁用状态的旧版几天作为回退。确认新版稳定后，才可以在 `chrome://extensions` 移除旧版并删除旧目录。

如果任何一步核对失败，立即禁用新版、重新启用旧版。不要在数据确认前移除旧扩展。

## 以后从 GitHub 手动升级

固定 ID 只解决扩展身份和数据延续，不会让 GitHub 安装版自动更新。以后升级 GitHub 版时：

1. 先导出一次洞见库备份。
2. 下载并解压新版发布包。
3. 用新版 `skimline-extension` 中的文件替换 Chrome 当前加载目录中的文件，保持原目录路径不变。
4. 在 `chrome://extensions` 的 Skimline 卡片点击“重新加载”。不要移除扩展，也不要再次点击“加载已解压的扩展程序”。
5. 刷新已打开的 YouTube 页面，并检查 API Key 与洞见库是否仍然存在。

## Chrome 应用商店版本

从 Chrome 应用商店安装后，新版本由 Chrome 原地更新，不再需要下载 GitHub ZIP。API Key、洞见库和摘要缓存仍保存在每台设备自己的 `chrome.storage.local` 中；卸载扩展会清除这些本地数据，因此卸载前仍应导出洞见库。

## 发布包约定

- `skimline-<版本>-extension.zip`：GitHub 手动安装包，内部目录固定为 `skimline-extension/`，发布用 manifest 保留公开 `key`。
- `skimline-<版本>-cws.zip`：Chrome Web Store 上传包，文件直接位于 ZIP 根目录，构建时总会移除 manifest 的 `key`。
- `.pem` 私钥、API Key、令牌和本机配置永远不会进入任何发布包。
