#!/usr/bin/env bash
set -euo pipefail
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$script_dir
while [[ ! -d "$repo_root/lib/emsenn/services/561-group" || ! -d "$repo_root/lib/emsenn/services/561-group/services/board-of-directors" ]]; do
  parent=$(dirname -- "$repo_root")
  [[ "$parent" != "$repo_root" ]] || exit 66
  repo_root=$parent
done
context_dir=${1:-}
[[ "$context_dir" == /tmp/* ]] || { echo "usage: $0 /tmp/build-context" >&2; exit 64; }
[[ ! -e "$context_dir" && ! -e "$context_dir.releases" ]] || { echo "build territories must not already exist: $context_dir" >&2; exit 73; }
base=lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services
market=$repo_root/$base/computer-systems-engineering-services-section/services/computer-inference-system-services-section/services/inference-work-lot-service
materializer_service=$repo_root/$base/computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/services/jsnode-packaging-services-section/services/npm-services-section/services/npm-package-services-section/services/npm-package-set-services-section/services/node-runtime-release-materialization-service
materializer=$materializer_service/src/materialize-release.mjs
source_catalog=$materializer_service/src/catalog-node-package-sources.mjs
node "$script_dir/materialize-context.mjs" "$market" "$context_dir" "$materializer" "$source_catalog"
cp "$script_dir/Dockerfile" "$context_dir/Dockerfile"
cp "$script_dir/cloudbuild.yaml" "$context_dir/cloudbuild.yaml"
