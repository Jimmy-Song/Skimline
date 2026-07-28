"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "sidepanel.html"), "utf8");
const source = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
const css = fs.readFileSync(path.join(root, "sidepanel.css"), "utf8");

test("顶部常驻 TEXT 数据刻度使用 85%–125% 连续范围并提供一键复位", () => {
  assert.match(html, /class="yvpm-appbar"/);
  assert.match(html, /class="yvpm-text-scale-label"[^>]*>TEXT</);
  assert.match(html, /class="yvpm-text-scale-rail"/);
  assert.match(html, /class="yvpm-text-scale-ticks"/);
  assert.ok(
    html.indexOf('id="yvpm-text-scale"') <
      html.indexOf('id="yvpm-text-scale-reset"'),
  );
  assert.match(
    css,
    /\.yvpm-text-scale-meta\s*\{[\s\S]*?order: -1/,
  );
  assert.match(
    html,
    /id="yvpm-text-scale"[\s\S]*?type="range"[\s\S]*?min="85"[\s\S]*?max="125"[\s\S]*?step="1"[\s\S]*?value="100"/,
  );
  assert.match(html, /aria-label="调整整个侧栏的文字大小"/);
  assert.match(html, /id="yvpm-text-scale-reset"/);
  assert.match(html, /恢复默认文字大小/);
});

test("文字缩放即时应用、只在提交时本地保存且复位不触发摘要生成", () => {
  assert.match(source, /const TEXT_SCALE_SETTING_KEY = "content_text_scale"/);
  assert.match(source, /const TEXT_SCALE_MIN = 85/);
  assert.match(source, /const TEXT_SCALE_MAX = 125/);
  assert.match(source, /const TEXT_SCALE_DEFAULT = 100/);
  assert.match(source, /document\.documentElement\.style\.fontSize = `\$\{scale\}%`/);
  assert.match(
    source,
    /elements\.textScale\.style\.setProperty\([\s\S]*?"--yvpm-text-scale-progress"/,
  );
  assert.match(source, /elements\.textScale\.addEventListener\("input"/);
  assert.match(source, /elements\.textScale\.addEventListener\("change"/);
  assert.match(
    source,
    /chrome\.storage\.local\.set\(\{ \[TEXT_SCALE_SETTING_KEY\]: scale \}\)/,
  );
  assert.match(source, /chrome\.storage\.local\.get\(TEXT_SCALE_SETTING_KEY\)/);
  assert.match(source, /state\.textScaleTouched = true/);
  assert.match(source, /if \(!state\.textScaleTouched\)/);
  assert.match(
    source,
    /textScaleSavePromise = textScaleSavePromise[\s\S]*?chrome\.storage\.local\.set/,
  );

  const saveBlock =
    source.match(/function saveTextScale[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(saveBlock);
  assert.doesNotMatch(
    saveBlock,
    /runtimeMessage|GENERATE_SUMMARY|loadSummary|generateFromCaptions/,
  );
});

test("所有 Side Panel 字体使用 rem 随根字号缩放，布局尺寸仍保持 px", () => {
  const fontDeclarations = [
    ...css.matchAll(/font(?:-size)?:\s*([^;]+);/g),
  ].map((match) => match[1]);
  assert.ok(fontDeclarations.length > 35);
  assert.equal(
    fontDeclarations.some((declaration) => /\d(?:\.\d+)?px/.test(declaration)),
    false,
  );
  assert.ok(
    fontDeclarations.filter((declaration) => /rem/.test(declaration)).length >
      35,
  );
  assert.match(css, /\.yvpm-appbar\s*\{[\s\S]*?height: 52px/);
  assert.match(css, /\.yvpm-text-scale-control\s*\{[\s\S]*?width: 118px/);
  assert.match(
    css,
    /#yvpm-text-scale::-webkit-slider-thumb\s*\{[\s\S]*?clip-path: polygon/,
  );
  assert.match(
    css,
    /#yvpm-text-scale:focus-visible\s*\{[\s\S]*?outline: 1px solid var\(--expand-border\)/,
  );
});

test("放大超过 110% 时观点显示三行，展开后始终显示完整标题", () => {
  assert.match(source, /const TEXT_SCALE_EXPANDED_THRESHOLD = 110/);
  assert.match(
    source,
    /scale > TEXT_SCALE_EXPANDED_THRESHOLD \? "expanded" : "compact"/,
  );
  assert.match(
    css,
    /html\[data-text-scale="expanded"\] \.yvpm-point-toggle \.yvpm-claim\s*\{[\s\S]*?-webkit-line-clamp: 3/,
  );
  assert.match(
    css,
    /html \.yvpm-expanded \.yvpm-point-toggle \.yvpm-claim\s*\{[\s\S]*?display: block;[\s\S]*?overflow: visible;[\s\S]*?-webkit-line-clamp: unset/,
  );
});

test("窄侧栏隐藏品牌文字并压缩数据刻度，避免顶部控件横向溢出", () => {
  assert.match(css, /@media \(max-width: 340px\)/);
  assert.match(
    css,
    /@media \(max-width: 340px\)[\s\S]*?\.yvpm-brand-name\s*\{[\s\S]*?display: none/,
  );
  assert.match(
    css,
    /@media \(max-width: 340px\)[\s\S]*?\.yvpm-text-scale-control\s*\{[\s\S]*?width: 96px/,
  );
  assert.match(
    css,
    /\.yvpm-language-button\s*\{[\s\S]*?#yvpm-language-label\s*\{[\s\S]*?text-overflow: ellipsis/,
  );
});
