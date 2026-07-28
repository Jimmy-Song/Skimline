#!/bin/sh
set -eu

release_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
release_version=$(node -p "require('${release_root}/manifest.json').version")
release_name="skimline-${release_version}"
release_output="${release_root}/releases/${release_name}-extension.zip"
release_tmp=$(mktemp -d)

cleanup_release_tmp() {
  rm -rf -- "${release_tmp}"
}
trap cleanup_release_tmp EXIT INT TERM

mkdir -p "${release_tmp}/${release_name}" "${release_root}/releases"

for release_file in \
  README.md \
  background.js \
  caption-utils.js \
  content.js \
  generation-utils.js \
  manifest.json \
  options.css \
  options.html \
  options.js \
  sidepanel.css \
  sidepanel.html \
  sidepanel.js \
  transcript-utils.js \
  ui-utils.js
do
  cp "${release_root}/${release_file}" "${release_tmp}/${release_name}/${release_file}"
done

(
  cd "${release_tmp}"
  zip -qr "${release_name}-extension.zip" "${release_name}"
)
mv "${release_tmp}/${release_name}-extension.zip" "${release_output}"

unzip -t "${release_output}" >/dev/null
shasum -a 256 "${release_output}"
