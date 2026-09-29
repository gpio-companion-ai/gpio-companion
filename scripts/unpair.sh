#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

need_root

PAIRING_JSON="${GPIO_COMPANION_PAIRING:-$CONFIG_DIR/pairing.json}"
PAIRING_ENV="$CONFIG_DIR/pairing.env"
SECRETS_ENV="${GPIO_COMPANION_SECRETS:-$CONFIG_DIR/secrets.env}"
GIT_CREDENTIALS="$CONFIG_DIR/git-credentials"

uuid="${GPIO_COMPANION_PAIRING_UUID:-}"
key="${GPIO_COMPANION_PAIRING_KEY:-}"
if [[ -f "$PAIRING_ENV" ]]; then
	# shellcheck disable=SC1090
	source "$PAIRING_ENV"
	uuid="${GPIO_COMPANION_PAIRING_UUID:-$uuid}"
	key="${GPIO_COMPANION_PAIRING_KEY:-$key}"
fi

install -d -m 0755 "$CONFIG_DIR"

PAIRING_JSON="$PAIRING_JSON" UUID="$uuid" KEY="$key" python3 - <<'PY'
import json, os
from pathlib import Path

path = Path(os.environ["PAIRING_JSON"])
uuid = os.environ.get("UUID", "").strip()
key = os.environ.get("KEY", "").strip()
state = {}
if path.exists():
	try:
		state = json.loads(path.read_text())
	except json.JSONDecodeError:
		state = {}
uuid = uuid or str(state.get("uuid") or "")
key = key or str(state.get("key") or "")
if not uuid or not key:
	raise SystemExit("gpio-companion unpair: pairing uuid/key missing")
path.write_text(
	json.dumps(
		{
			"uuid": uuid,
			"key": key,
			"claimed": False,
			"userId": "",
			"email": "",
			"login": "",
			"claimedAt": "",
		},
		indent="\t",
	)
	+ "\n"
)
path.chmod(0o600)
print(f"unpaired {uuid}")
PY

if [[ -f "$SECRETS_ENV" ]]; then
	SECRETS_ENV="$SECRETS_ENV" python3 - <<'PY'
import os
from pathlib import Path

path = Path(os.environ["SECRETS_ENV"])
ai = ""
for line in path.read_text().splitlines():
	if line.startswith("GPIO_AI_KEY=") or line.startswith("OPENCODE_API_KEY="):
		ai = line.split("=", 1)[1]
		break
path.write_text(
	f"GPIO_AI_KEY={ai}\nGITHUB_URL=\nGITHUB_USERNAME=\nGITHUB_TOKEN=\n"
)
path.chmod(0o600)
PY
fi

: >"$GIT_CREDENTIALS"
chmod 600 "$GIT_CREDENTIALS" 2>/dev/null || true

rotate_opencode_server_password || true
restart_opencode_service || true

if timeout 5 systemctl cat gpio-companion.service >/dev/null 2>&1; then
	echo "gpio-companion unpair: restarting gpio-companion.service"
	if ! timeout 20 systemctl restart gpio-companion.service; then
		echo "gpio-companion unpair: restart timed out, killing service" >&2
		timeout 5 systemctl kill -s SIGKILL gpio-companion.service >/dev/null 2>&1 || true
	fi
fi

echo "gpio-companion unpair: local claim cleared (UUID/key kept)"
echo "dashboard KV still owns this board until owner/admin unpair"
