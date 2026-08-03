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
base=lib/emsenn/services/561-group/services
market=$repo_root/$base/red-cup-engineering/services/software-services-section/services/inference-services-section/services/inference-work-lot-service
trc=$repo_root/$base/red-cup-engineering/services/software-services-section/services/software-development-services-section/services/typed-resource-catalog-service/src/index.mjs
materializer=$repo_root/$base/red-cup-engineering/services/software-services-section/services/software-development-services-section/services/node-runtime-release-materialization-service/src/materialize-release.mjs
node "$script_dir/materialize-context.mjs" "$market" "$context_dir" "$trc" "$materializer"
cp "$script_dir/Dockerfile" "$context_dir/Dockerfile"
cp "$script_dir/cloudbuild.yaml" "$context_dir/cloudbuild.yaml"
