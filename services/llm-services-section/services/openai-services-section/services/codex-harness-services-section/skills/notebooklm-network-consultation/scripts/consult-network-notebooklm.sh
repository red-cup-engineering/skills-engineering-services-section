#!/usr/bin/env bash
set -euo pipefail

if (( $# < 2 )); then
  echo "usage: $0 <matching-string> <question> [--artifact data-table|json|code|report] [--schema emsenn/schema/...] [--limit N] [--session transcript.jsonl]" >&2
  exit 2
fi

match=$1
question=$2
shift 2
limit=300
session=""
artifact="data-table"
result_schema=""
while (( $# )); do
  case $1 in
    --limit) limit=${2:?--limit requires a number}; shift 2 ;;
    --session) session=${2:?--session requires a path}; shift 2 ;;
    --artifact) artifact=${2:?--artifact requires a type}; shift 2 ;;
    --schema) result_schema=${2:?--schema requires an identifier}; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ $limit =~ ^[1-9][0-9]*$ ]] || { echo "--limit must be a positive integer" >&2; exit 2; }
[[ -z $session || -f $session ]] || { echo "session does not exist: $session" >&2; exit 2; }
[[ $artifact =~ ^(data-table|json|code|report)$ ]] || { echo "unsupported --artifact: $artifact" >&2; exit 2; }
[[ $artifact != json || $result_schema =~ ^emsenn/schema/ ]] || { echo "--artifact json requires --schema emsenn/schema/..." >&2; exit 2; }
[[ $artifact = json || -z $result_schema ]] || { echo "--schema is valid only with --artifact json" >&2; exit 2; }

repo=${EMSENN_REPOSITORY_ROOT:-/home/emsenn/info}
runner="$repo/lib/emsenn/services/561-group/services/red-cup-engineering/services/software-services-section/services/inference-services-section/services/notebooklm-services-section/run-one-exchange.py"
[[ -f $runner ]] || { echo "NotebookLM exchange harness unavailable: $runner" >&2; exit 1; }

packet_dir=$(mktemp -d "${TMPDIR:-/tmp}/notebooklm-network-consult.XXXXXX")
trap 'rm -rf "$packet_dir"' EXIT
mapfile -t sources < <(
  rg -l -i --hidden \
    --glob '!node_modules/**' --glob '!*.lock' \
    --glob '!**/data/advisory-corpus/**' --glob '!**/data/workspace-market/**' \
    --glob '!**/content/exchanges/**' --glob '!**/data/advisory-exchanges/**' \
    -- "$match" "$repo"
)
sources=("${sources[@]:0:limit}")
if [[ -n $session ]]; then sources+=("$session"); fi
(( ${#sources[@]} > 0 )) || { echo "no repository sources matched: $match" >&2; exit 1; }

printf '%s\n' "${sources[@]}" > "$packet_dir/sources.txt"
node - "$packet_dir/packet.json" "$packet_dir/sources.txt" "$question" "$artifact" "$result_schema" <<'NODE'
const fs = require('fs');
const [out, sourceList, prompt, artifact, resultSchema] = process.argv.slice(2);
const sources = fs.readFileSync(sourceList, 'utf8').split('\n').filter(Boolean);
const packet = {
  sources,
  prompt,
  'artifact-type': artifact
};
if (artifact === 'json') packet['result-schema'] = resultSchema;
fs.writeFileSync(out, JSON.stringify(packet, null, 2) + '\n');
NODE

python3 "$runner" "$packet_dir/packet.json"
