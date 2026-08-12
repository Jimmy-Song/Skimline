"use strict";

const fs = require("node:fs");

const [target, sourcePath, outputPath] = process.argv.slice(2);
if (!new Set(["github", "cws"]).has(target) || !sourcePath || !outputPath) {
  console.error(
    "Usage: node scripts/write-release-manifest.js <github|cws> <source> <output>",
  );
  process.exit(2);
}

const sourceStats = fs.statSync(sourcePath);
const manifest = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
if (target === "cws") delete manifest.key;
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.chmodSync(outputPath, sourceStats.mode & 0o777);
fs.utimesSync(outputPath, sourceStats.atime, sourceStats.mtime);
