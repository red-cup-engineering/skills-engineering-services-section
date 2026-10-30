#!/usr/bin/env bash
# Seat the Bare Cedar Fog Claude ActivityPub face (/actors/claude) on the
# network-custody host. Run from the laptop; every remote step goes over ssh
# to $SEAT_HOST (default: cold-red-gate, the host serving
# https://bare-cedar-fog.561.group). Idempotent: keys are generated only if
# absent, the unit is re-installed each run, the site route is added only if
# missing, and the site is restarted only when its routes changed.
set -euo pipefail

HOST="${SEAT_HOST:-cold-red-gate}"
ORIGIN="${SEAT_ORIGIN:-https://bare-cedar-fog.561.group}"
PORT=19864
IDENTIFIER=claude
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_SRC="$SCRIPT_DIR/../lib/systemd/bare-cedar-fog-claude-activitypub.service"
LOCAL_CONF="$HOME/.config/red-cup-engineering/bare-cedar-fog-claude"

[ -f "$UNIT_SRC" ] || { echo "FAIL unit source missing: $UNIT_SRC" >&2; exit 1; }

echo "== 1/5 identity: keys + inbox bearer token on $HOST =="
ssh -o BatchMode=yes "$HOST" bash -s <<'REMOTE'
set -euo pipefail
CONF="$HOME/.config/red-cup-engineering/bare-cedar-fog-claude"
REL="$HOME/.local/share/561-group/releases/activitypub-services-section/current"
NODE="$HOME/.nvm/versions/node/v24.16.0/bin/node"
mkdir -p "$CONF" && chmod 700 "$CONF"
if [ -f "$CONF/activitypub-keys.json" ] && [ -f "$CONF/inbox-bearer.token" ]; then
  echo "keys: already present"
else
  [ -f "$CONF/activitypub-keys.json" ] || [ ! -f "$CONF/inbox-bearer.token" ] || \
    { echo "FAIL: bearer token exists without keys; resolve $CONF by hand" >&2; exit 1; }
  (cd "$REL" && "$NODE" src/keys.mjs "$CONF/activitypub-keys.json" --inbox-bearer-token-file "$CONF/inbox-bearer.token")
  echo "keys: generated"
fi
REMOTE

echo "== 2/5 unit: install + start bare-cedar-fog-claude-activitypub.service =="
scp -q "$UNIT_SRC" "$HOST":.config/systemd/user/bare-cedar-fog-claude-activitypub.service
ssh -o BatchMode=yes "$HOST" bash -s <<'REMOTE'
set -euo pipefail
systemctl --user daemon-reload
systemctl --user enable --now bare-cedar-fog-claude-activitypub.service
for _ in 1 2 3 4 5 6 7 8 9 10; do
  state="$(systemctl --user is-active bare-cedar-fog-claude-activitypub.service || true)"
  [ "$state" = active ] && break
  sleep 1
done
[ "$state" = active ] || { systemctl --user status --no-pager -n 20 bare-cedar-fog-claude-activitypub.service >&2; exit 1; }
echo "unit: active"
REMOTE

echo "== 3/5 route: claude:$PORT in the site's ACTIVITYPUB_PROVIDER_ROUTES =="
ssh -o BatchMode=yes "$HOST" bash -s <<REMOTE
set -euo pipefail
UNIT="\$HOME/.config/systemd/user/bare-cedar-fog-561-group.service"
if grep -q "$IDENTIFIER:$PORT" "\$UNIT"; then
  echo "route: already present"
else
  cp "\$UNIT" "\$UNIT.pre-claude-route"
  sed -i "s/^Environment=ACTIVITYPUB_PROVIDER_ROUTES=.*/&,$IDENTIFIER:$PORT/" "\$UNIT"
  grep -q "$IDENTIFIER:$PORT" "\$UNIT" || { echo "FAIL: route edit did not land" >&2; exit 1; }
  systemctl --user daemon-reload
  systemctl --user restart bare-cedar-fog-561-group.service
  echo "route: added, site restarted (backup at \$UNIT.pre-claude-route)"
fi
REMOTE

echo "== 4/5 credential sync: inbox bearer token back to this laptop =="
mkdir -p "$LOCAL_CONF" && chmod 700 "$LOCAL_CONF"
scp -q "$HOST":.config/red-cup-engineering/bare-cedar-fog-claude/inbox-bearer.token "$LOCAL_CONF/inbox-bearer.token"
chmod 600 "$LOCAL_CONF/inbox-bearer.token"
echo "token: synced to $LOCAL_CONF/inbox-bearer.token"

echo "== 5/5 receipts: live network checks =="
fail=0
check() {
  local label="$1"; shift
  local expect="$1"; shift
  local code
  code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$@")" || code=curl-error
  if [ "$code" = "$expect" ]; then echo "PASS $label ($code)"; else echo "FAIL $label (got $code, want $expect)"; fail=1; fi
}
check "actor $ORIGIN/actors/$IDENTIFIER" 200 -H "Accept: application/activity+json" "$ORIGIN/actors/$IDENTIFIER"
check "webfinger acct:$IDENTIFIER@${ORIGIN#https://}" 200 "$ORIGIN/.well-known/webfinger?resource=acct:$IDENTIFIER@${ORIGIN#https://}"
check "outbox" 200 -H "Accept: application/activity+json" "$ORIGIN/actors/$IDENTIFIER/outbox"
check "inbox (bearer)" 200 -H "Accept: application/activity+json" -H "Authorization: Bearer $(cat "$LOCAL_CONF/inbox-bearer.token")" "$ORIGIN/actors/$IDENTIFIER/inbox"
check "regression guard: /actors/codex still serves" 200 -H "Accept: application/activity+json" "$ORIGIN/actors/codex"
check "regression guard: /actors/settlement-pulse still serves" 200 -H "Accept: application/activity+json" "$ORIGIN/actors/settlement-pulse"
exit "$fail"
