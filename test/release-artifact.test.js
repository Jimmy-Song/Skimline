"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const githubDirectory = "skimline-extension";
const expectedExtensionId = "dcgckommjpeabnlkonmkmhlcaoafolfi";
const runtimeFiles = [
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
];

function archiveEntries(archive) {
  return execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((entry) => entry && !entry.endsWith("/"));
}

function archiveFile(archive, entry) {
  return execFileSync("unzip", ["-p", archive, entry], { encoding: null });
}

function assertNoPrivateReleaseFiles(entries) {
  for (const entry of entries) {
    assert.doesNotMatch(
      entry,
      /(?:^|\/)(?:\.git|node_modules|test|scripts)(?:\/|$)|(?:^|\/)(?:\.env|config\.local\.js|key\.pem)$|\.pem$/i,
    );
  }
}

function assertNoPackagedSecrets(archive, entries) {
  const textFile = /\.(?:css|html|js|json|md)$/i;
  const secretPattern =
    /sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|Bearer [A-Za-z0-9._-]{20,}/;
  for (const entry of entries.filter((candidate) => textFile.test(candidate))) {
    assert.doesNotMatch(
      archiveFile(archive, entry).toString("utf8"),
      secretPattern,
      `${entry} 疑似包含不应发布的凭据`,
    );
  }
}

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

test("manifest 公钥固定为正式 Chrome Web Store 扩展 ID", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  assert.match(manifest.key, /^[A-Za-z0-9+/]+={0,2}$/);

  const digest = crypto
    .createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest()
    .subarray(0, 16);
  const extensionId = [...digest.toString("hex")]
    .map((hex) => String.fromCharCode(97 + Number.parseInt(hex, 16)))
    .join("");
  assert.equal(extensionId, expectedExtensionId);
});

test("GitHub 发布包使用固定目录、保留源码 manifest 且不夹带私密文件", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(packageJson.version, manifest.version);
  const archive = path.join(
    root,
    "releases",
    `skimline-${manifest.version}-extension.zip`,
  );
  if (!manifest.key) {
    assert.equal(
      fs.existsSync(archive),
      false,
      "没有商店公钥时不应留下看似正式的 GitHub 发布包",
    );
    return;
  }
  assert.equal(fs.existsSync(archive), true, `缺少发布包：${archive}`);

  execFileSync("unzip", ["-t", archive], { stdio: "pipe" });
  const entries = archiveEntries(archive);
  const expectedFiles = [
    ...runtimeFiles,
    "CHANGELOG.md",
    "README.md",
    "UPGRADING.md",
  ]
    .map((file) => `${githubDirectory}/${file}`)
    .sort();
  assert.deepEqual([...entries].sort(), expectedFiles);
  assertNoPrivateReleaseFiles(entries);
  assertNoPackagedSecrets(archive, entries);
  assert.equal(
    entries.some((entry) => /^skimline-\d/.test(entry)),
    false,
    "GitHub 包不应继续使用带版本号的内层目录",
  );

  const packagedManifest = JSON.parse(
    archiveFile(archive, `${githubDirectory}/manifest.json`).toString("utf8"),
  );
  assert.deepEqual(packagedManifest, manifest);

  for (const releaseFile of [
    ...runtimeFiles,
    "CHANGELOG.md",
    "README.md",
    "UPGRADING.md",
  ]) {
    if (releaseFile === "manifest.json") continue;
    assert.deepEqual(
      archiveFile(archive, `${githubDirectory}/${releaseFile}`),
      fs.readFileSync(path.join(root, releaseFile)),
      `GitHub 发布包中的 ${releaseFile} 不是当前源码`,
    );
  }
});

test("Chrome Web Store 包以 manifest 为根、移除 key 且仅包含运行文件", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const archive = path.join(
    root,
    "releases",
    `skimline-${manifest.version}-cws.zip`,
  );
  assert.equal(fs.existsSync(archive), true, `缺少商店包：${archive}`);

  execFileSync("unzip", ["-t", archive], { stdio: "pipe" });
  const entries = archiveEntries(archive);
  assert.deepEqual([...entries].sort(), [...runtimeFiles].sort());
  assertNoPrivateReleaseFiles(entries);
  assertNoPackagedSecrets(archive, entries);
  assert.ok(entries.includes("manifest.json"));
  assert.equal(entries.some((entry) => entry.startsWith(`${githubDirectory}/`)), false);
  assert.equal(entries.includes("README.md"), false);
  assert.equal(entries.includes("UPGRADING.md"), false);

  const packagedManifest = JSON.parse(
    archiveFile(archive, "manifest.json").toString("utf8"),
  );
  assert.equal(packagedManifest.key, undefined);
  const expectedManifest = { ...manifest };
  delete expectedManifest.key;
  assert.deepEqual(packagedManifest, expectedManifest);

  for (const releaseFile of runtimeFiles) {
    if (releaseFile === "manifest.json") continue;
    assert.deepEqual(
      archiveFile(archive, releaseFile),
      fs.readFileSync(path.join(root, releaseFile)),
      `商店包中的 ${releaseFile} 不是当前源码`,
    );
  }
});

test("缺少商店公钥时完整发布 fail closed，但仍可单独构建 CWS 包", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  if (manifest.key) return;

  const script = path.join(root, "scripts", "build-release.sh");
  assert.throws(
    () => execFileSync("sh", [script], { encoding: "utf8", stdio: "pipe" }),
    /Chrome Web Store public key/,
  );
  execFileSync("sh", [script, "--cws-only"], { stdio: "pipe" });
  assert.equal(
    fs.existsSync(
      path.join(root, "releases", `skimline-${manifest.version}-cws.zip`),
    ),
    true,
  );
});

test("CWS 构建可复现，非法参数不会覆盖已有产物", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const archive = path.join(
    root,
    "releases",
    `skimline-${manifest.version}-cws.zip`,
  );
  const script = path.join(root, "scripts", "build-release.sh");
  const before = fs.readFileSync(archive);

  execFileSync("sh", [script, "--cws-only"], { stdio: "pipe" });
  assert.deepEqual(fs.readFileSync(archive), before);

  assert.throws(
    () => execFileSync("sh", [script, "--unknown"], { stdio: "pipe" }),
    /Usage:/,
  );
  assert.deepEqual(fs.readFileSync(archive), before);
});

test("manifest 构建器只对 CWS 目标删除公开 key", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skimline-manifest-"));
  try {
    const source = path.join(temp, "source.json");
    const github = path.join(temp, "github.json");
    const cws = path.join(temp, "cws.json");
    const fixture = {
      manifest_version: 3,
      name: "Skimline",
      version: "1.0.0",
      key: "PUBLIC_KEY_FIXTURE",
    };
    fs.writeFileSync(source, JSON.stringify(fixture));
    const helper = path.join(root, "scripts", "write-release-manifest.js");
    execFileSync("node", [helper, "github", source, github]);
    execFileSync("node", [helper, "cws", source, cws]);

    assert.deepEqual(JSON.parse(fs.readFileSync(github, "utf8")), fixture);
    assert.deepEqual(JSON.parse(fs.readFileSync(cws, "utf8")), {
      manifest_version: 3,
      name: "Skimline",
      version: "1.0.0",
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")), fixture);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
