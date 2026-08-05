"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");

test("当前版本在 GitHub 版本日志中有独立需求说明", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const changelog = fs.readFileSync(
    path.join(root, "CHANGELOG.md"),
    "utf8",
  );

  assert.match(readme, /\[查看按版本整理的新增功能与重要修复\]\(CHANGELOG\.md\)/);
  const versionHeading = `## Skimline ${manifest.version}`;
  const versionStart = changelog.indexOf(versionHeading);
  assert.notEqual(versionStart, -1, `版本日志缺少 ${versionHeading}`);
  const nextVersionStart = changelog.indexOf("\n## Skimline ", versionStart + 1);
  const currentVersionNotes = changelog.slice(
    versionStart,
    nextVersionStart === -1 ? changelog.length : nextVersionStart,
  );
  assert.match(currentVersionNotes, /### 新增需求/);
  assert.match(currentVersionNotes, /\n- .+/);
});

test("当前版本发布包完整、可解压且不包含旧页面注入脚本", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(packageJson.version, manifest.version);
  const releaseName = `skimline-${manifest.version}`;
  const archive = path.join(
    root,
    "releases",
    `${releaseName}-extension.zip`,
  );
  assert.equal(fs.existsSync(archive), true, `缺少发布包：${archive}`);

  execFileSync("unzip", ["-t", archive], { stdio: "pipe" });
  const entries = execFileSync("unzip", ["-Z1", archive], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  assert.ok(entries.includes(`${releaseName}/manifest.json`));
  assert.ok(entries.includes(`${releaseName}/transcript-utils.js`));
  assert.equal(entries.some((entry) => entry.endsWith("/injected.js")), false);
  assert.equal(
    entries.some((entry) => /(?:^|\/)(?:\.git|node_modules)(?:\/|$)/.test(entry)),
    false,
  );

  const packagedManifest = JSON.parse(
    execFileSync(
      "unzip",
      ["-p", archive, `${releaseName}/manifest.json`],
      { encoding: "utf8" },
    ),
  );
  assert.equal(packagedManifest.version, manifest.version);
  assert.equal(packagedManifest.web_accessible_resources, undefined);
  assert.ok(
    packagedManifest.content_scripts[0].js.includes("transcript-utils.js"),
  );

  for (const runtimeFile of [
    "README.md",
    "background.js",
    "caption-utils.js",
    "collection-utils.js",
    "content.js",
    "generation-utils.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "manifest.json",
    "options.css",
    "options.html",
    "options.js",
    "sidepanel.css",
    "sidepanel.html",
    "sidepanel.js",
    "transcript-utils.js",
    "ui-utils.js",
  ]) {
    const packaged = execFileSync(
      "unzip",
      ["-p", archive, `${releaseName}/${runtimeFile}`],
      { encoding: null },
    );
    const working = fs.readFileSync(path.join(root, runtimeFile));
    assert.deepEqual(
      packaged,
      working,
      `发布包中的 ${runtimeFile} 不是当前源码`,
    );
  }
});
