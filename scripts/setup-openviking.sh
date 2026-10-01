#!/usr/bin/env bash
set -euo pipefail

# Canonical installer for the on-device OpenViking memory server.
# first-setup.sh always runs this. update-script.sh runs it when the
# server is missing. Idempotent.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

need_root

ASSUME_YES=0
if [[ "${1:-}" == "--yes" || "${GPIO_COMPANION_OPENVIKING_YES:-}" == "1" ]]; then
	ASSUME_YES=1
fi

OPENVIKING_VERSION="$(openviking_pinned_version)"
OPENVIKING_VENV="${GPIO_COMPANION_OPENVIKING_VENV:-$LIB_DIR/openviking}"
OPENVIKING_MIN_FREE_MB="${GPIO_COMPANION_OPENVIKING_MIN_FREE_MB:-1536}"
OPENVIKING_PORT="${GPIO_COMPANION_OPENVIKING_PORT:-1933}"
EMBEDDING_MODEL="${GPIO_COMPANION_OPENVIKING_EMBEDDING_MODEL:-@cf/qwen/qwen3-embedding-0.6b}"
EMBEDDING_DIMENSION="${GPIO_COMPANION_OPENVIKING_EMBEDDING_DIMENSION:-1024}"
VLM_MODEL="${GPIO_COMPANION_OPENVIKING_VLM_MODEL:-@cf/zai-org/glm-5.3-flash}"
AI_BASE_URL="$(gpio_ai_loopback_url)"

gpio_user_home() {
	if [[ "$GPIO_USER" == "root" ]]; then
		echo "/root"
	else
		echo "/home/$GPIO_USER"
	fi
}

run_as_gpio_user() {
	if [[ "$GPIO_USER" == "root" ]]; then
		"$@"
	else
		sudo -H -u "$GPIO_USER" "$@"
	fi
}

free_mb_root() {
	df -Pm / | awk 'NR==2 {print $4}'
}

echo "gpio-companion openviking setup"
echo "  user:    $GPIO_USER"
echo "  venv:    $OPENVIKING_VENV"
echo "  version: $OPENVIKING_VERSION"
echo "  free:    $(free_mb_root)MB on /"

available="$(free_mb_root)"
if [[ "$available" -lt "$OPENVIKING_MIN_FREE_MB" ]]; then
	if [[ "$ASSUME_YES" -eq 1 ]]; then
		die "not enough free storage: ${available}MB on / (need ${OPENVIKING_MIN_FREE_MB}MB); refusing to install OpenViking"
	fi
	die "not enough free storage: ${available}MB on / (need ${OPENVIKING_MIN_FREE_MB}MB)"
fi

installed_version="$(openviking_installed_version || true)"
if [[ "$installed_version" == "$OPENVIKING_VERSION" && -x "$OPENVIKING_VENV/bin/openviking-server" ]]; then
	echo "openviking ${OPENVIKING_VERSION} already installed; skipping pip install"
else
	echo "creating python venv..."
	install -d -m 0755 "$(dirname "$OPENVIKING_VENV")"
	if [[ ! -x "$OPENVIKING_VENV/bin/python3" ]]; then
		python3 -m venv "$OPENVIKING_VENV"
	fi

	echo "installing openviking==${OPENVIKING_VERSION} (pinned, no cache)..."
	"$OPENVIKING_VENV/bin/pip" install --no-cache-dir --quiet "openviking==$OPENVIKING_VERSION"
	if [[ ! -x "$OPENVIKING_VENV/bin/openviking-server" ]]; then
		die "openviking-server not present in venv after install"
	fi
fi

OV_HOME="$(gpio_user_home)/.openviking"
OV_CONF="$OV_HOME/ov.conf"
run_as_gpio_user install -d -m 0700 "$OV_HOME"

echo "writing $OV_CONF..."
HOME_DIR="$(gpio_user_home)" AI_KEY="local" AI_BASE_URL="$AI_BASE_URL" \
	EMBEDDING_MODEL="$EMBEDDING_MODEL" EMBEDDING_DIMENSION="$EMBEDDING_DIMENSION" \
	VLM_MODEL="$VLM_MODEL" WORKSPACE="$OV_HOME/data" HOME_DIR="$HOME_DIR" \
	PORT="$OPENVIKING_PORT" CONF_PATH="$OV_CONF" python3 - <<'PY'
import json, os
from pathlib import Path

conf = {
	"server": {"host": "127.0.0.1", "port": int(os.environ["PORT"])},
	"storage": {
		"workspace": os.environ["WORKSPACE"],
		"vectordb": {"name": "context", "backend": "local"},
		"agfs": {"backend": "local"},
	},
	"embedding": {
		"dense": {
			"provider": "openai",
			"api_key": os.environ["AI_KEY"],
			"api_base": os.environ["AI_BASE_URL"],
			"model": os.environ["EMBEDDING_MODEL"],
			"dimension": int(os.environ["EMBEDDING_DIMENSION"]),
			"input": "text",
		}
	},
	"vlm": {
		"provider": "openai",
		"api_key": os.environ["AI_KEY"],
		"api_base": os.environ["AI_BASE_URL"],
		"model": os.environ["VLM_MODEL"],
		"max_retries": 2,
	},
	"encryption": {
		"enabled": True,
		"provider": "local",
		"local": {"key_file": os.path.join(os.environ["HOME_DIR"], ".openviking", "master.key")},
	},
}
path = Path(os.environ["CONF_PATH"])
path.write_text(json.dumps(conf, indent="\t") + "\n")
path.chmod(0o600)
PY
if [[ "$GPIO_USER" != "root" ]]; then
	chown "$GPIO_USER:$GPIO_USER" "$OV_CONF"
fi

echo "installing systemd unit..."
install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-openviking.service" /etc/systemd/system/gpio-companion-openviking.service
sed -i "s|__GPIO_USER__|$GPIO_USER|" /etc/systemd/system/gpio-companion-openviking.service
sed -i "s|__OPENVIKING_CONF__|$OV_CONF|" /etc/systemd/system/gpio-companion-openviking.service
systemctl daemon-reload
systemctl enable gpio-companion-openviking.service
if ! systemctl restart gpio-companion-openviking.service; then
	journalctl -u gpio-companion-openviking.service -n 80 --no-pager >&2 || true
	die "openviking server failed to start; check journalctl -u gpio-companion-openviking"
fi

echo "waiting for the server on 127.0.0.1:${OPENVIKING_PORT}..."
healthy=0
for _ in $(seq 1 120); do
	if curl -fsS "http://127.0.0.1:${OPENVIKING_PORT}/health" >/dev/null 2>&1; then
		healthy=1
		break
	fi
	sleep 1
done
if [[ "$healthy" -ne 1 ]]; then
	journalctl -u gpio-companion-openviking.service -n 80 --no-pager >&2 || true
	die "openviking server did not become healthy; check journalctl -u gpio-companion-openviking"
fi

echo "configuring ov CLI for the gpio user..."
run_as_gpio_user "$OPENVIKING_VENV/bin/ov" language en >/dev/null 2>&1 || true
run_as_gpio_user "$OPENVIKING_VENV/bin/ov" config add custom \
	--name gpio-companion --url "http://127.0.0.1:${OPENVIKING_PORT}" --activate --force
run_as_gpio_user python3 - <<'PY'
import json
from pathlib import Path

home = Path.home() / ".openviking"
for name in ("ovcli.conf", "ovcli.conf.gpio-companion"):
    path = home / name
    if not path.exists():
        continue
    data = json.loads(path.read_text())
    data["timeout"] = 600
    path.write_text(json.dumps(data, indent="\t") + "\n")
    path.chmod(0o600)
PY

write_opencode_openviking_plugin

echo "seeding board memory..."
run_openviking_seed

set_openviking_flag true

echo "openviking setup complete"
echo "  server:  http://127.0.0.1:${OPENVIKING_PORT} (localhost only)"
echo "  config:  $OV_CONF"
echo "  data:    $OV_HOME/data"
echo "OpenCode restarts with the openviking plugin on its next launch"
