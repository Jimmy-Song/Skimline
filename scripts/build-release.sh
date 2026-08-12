#!/bin/sh
set -eu

release_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
release_version=$(node -p "require('${release_root}/manifest.json').version")
release_prefix="skimline-${release_version}"
github_directory="skimline-extension"
expected_extension_id="dcgckommjpeabnlkonmkmhlcaoafolfi"
github_output="${release_root}/releases/${release_prefix}-extension.zip"
cws_output="${release_root}/releases/${release_prefix}-cws.zip"
release_tmp=$(mktemp -d)
build_github=true

if [ "${1:-}" = "--cws-only" ]; then
  build_github=false
elif [ "$#" -gt 0 ]; then
  echo "Usage: $0 [--cws-only]" >&2
  exit 2
fi

package_version=$(node -p "require('${release_root}/package.json').version")
if [ "${package_version}" != "${release_version}" ]; then
  echo "package.json and manifest.json versions must match" >&2
  exit 1
fi

if [ "${build_github}" = true ]; then
  manifest_extension_id=$(node -e '
    const crypto = require("node:crypto");
    const key = require(process.argv[1]).key;
    if (typeof key !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(key)) process.exit(1);
    const digest = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
    const id = [...digest.toString("hex")].map((hex) => String.fromCharCode(97 + Number.parseInt(hex, 16))).join("");
    process.stdout.write(id);
  ' "${release_root}/manifest.json" 2>/dev/null || true)
  if [ "${manifest_extension_id}" != "${expected_extension_id}" ]; then
    echo "Refusing to build the GitHub release before manifest.json has the Chrome Web Store public key. Run with --cws-only for the first store upload." >&2
    exit 1
  fi
fi

cleanup_release_tmp() {
  rm -rf -- "${release_tmp}"
}
trap cleanup_release_tmp EXIT INT TERM

runtime_files="
background.js
caption-utils.js
collection-utils.js
content.js
generation-utils.js
manifest.json
options.css
options.html
options.js
sidepanel.css
sidepanel.html
sidepanel.js
transcript-utils.js
ui-utils.js
"

icon_files="
icon16.png
icon32.png
icon48.png
icon128.png
"

require_regular_file() {
  source_file=$1
  if [ ! -f "${source_file}" ] || [ -L "${source_file}" ]; then
    echo "Release input must be a regular, non-symlink file: ${source_file}" >&2
    exit 1
  fi
}

copy_release_file() {
  source_file=$1
  target_file=$2
  require_regular_file "${source_file}"
  cp -p "${source_file}" "${target_file}"
}

copy_runtime_files() {
  target=$1
  mkdir -p "${target}/icons"
  for release_file in ${runtime_files}; do
    if [ "${release_file}" != "manifest.json" ]; then
      copy_release_file \
        "${release_root}/${release_file}" "${target}/${release_file}"
    fi
  done
  for release_icon in ${icon_files}; do
    copy_release_file \
      "${release_root}/icons/${release_icon}" "${target}/icons/${release_icon}"
  done
}

mkdir -p "${release_root}/releases"
require_regular_file "${release_root}/manifest.json"

if [ "${build_github}" = true ]; then
  github_root="${release_tmp}/github/${github_directory}"
  copy_runtime_files "${github_root}"
  node "${release_root}/scripts/write-release-manifest.js" \
    github "${release_root}/manifest.json" "${github_root}/manifest.json"
  copy_release_file "${release_root}/README.md" "${github_root}/README.md"
  copy_release_file \
    "${release_root}/UPGRADING.md" "${github_root}/UPGRADING.md"
  (
    cd "${release_tmp}/github"
    zip -qXrD \
      "${release_tmp}/${release_prefix}-extension.zip" "${github_directory}"
  )
  unzip -t "${release_tmp}/${release_prefix}-extension.zip" >/dev/null
fi

cws_root="${release_tmp}/cws"
copy_runtime_files "${cws_root}"
node "${release_root}/scripts/write-release-manifest.js" \
  cws "${release_root}/manifest.json" "${cws_root}/manifest.json"
(
  cd "${cws_root}"
  zip -qXrD "${release_tmp}/${release_prefix}-cws.zip" .
)
unzip -t "${release_tmp}/${release_prefix}-cws.zip" >/dev/null

if [ "${build_github}" = true ]; then
  mv "${release_tmp}/${release_prefix}-extension.zip" "${github_output}"
fi
mv "${release_tmp}/${release_prefix}-cws.zip" "${cws_output}"

if [ "${build_github}" = true ]; then
  shasum -a 256 "${github_output}"
fi
shasum -a 256 "${cws_output}"
