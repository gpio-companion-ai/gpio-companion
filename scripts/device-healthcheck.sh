#!/usr/bin/env bash
# gpio-companion on-device healthcheck.
#
# Runs directly on the companion Pi (over SSH) with no dashboard, tunnel,
# BLE central, or Ed25519 keys. Checks every component it can reach via
# local files, systemd, and unsigned loopback HTTP on 127.0.0.1:$PORT.
#
# Signed-only routes (/v1/status, /v1/info, /v1/logs, /v1/config, /v1/opencode/*)
# cannot be called unsigned from the Pi (it keeps only the dashboard public
# key, so it cannot mint a dashboard signature). They are healthchecked here
# with a negative gate: unsigned must fail closed with 401/403, which proves
# the route is live. Full signed checks stay covered remotely by
# `bun run test:device` (scripts/device-endpoint-runner.ts).
#
# Safe probes included (never drive hardware, never join wifi, never start a
# job): PUT /v1/gpio physical pin 1 (must refuse power/GND before any drive),
# PUT /v1/config/wifi with the probe SSID gpio-companion-ble-health-probe
# (must answer ssid-not-found), and invalid-JSON POSTs to flash/run/verify
# (must answer invalid json without starting anything).
#
# usage: bash scripts/device-healthcheck.sh [--json] [--port 4150]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

PORT="${GPIO_COMPANION_PORT:-4150}"
JSON=0
ARGS=("$@")
i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
	arg="${ARGS[$i]}"
	case "$arg" in
	--json | -j) JSON=1 ;;
	--port=*) PORT="${arg#--port=}" ;;
	--port)
		i=$((i + 1))
		if [[ $i -ge ${#ARGS[@]} ]]; then
			echo "usage: $0 [--json] [--port 4150]" >&2
			exit 2
		fi
		PORT="${ARGS[$i]}"
		;;
	-h | --help)
		echo "usage: $0 [--json] [--port 4150]"
		exit 0
		;;
	*)
		echo "usage: $0 [--json] [--port 4150]" >&2
		exit 2
		;;
	esac
	i=$((i + 1))
done

BASE="http://127.0.0.1:${PORT}"
PROBE_SSID="gpio-companion-ble-health-probe"
PROBE_PSK="xxxxxxxx"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
JSON_ROWS=""

record() {
	local state="$1" name="$2" log="${3:-}"
	case "$state" in
	PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
	FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
	SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
	esac
	if [[ "$JSON" == "1" ]]; then
		JSON_ROWS+="$(python3 - "$state" "$name" "$log" <<'PY'
import json, sys
state = sys.argv[1].lower()
if state == "skip":
    state = "skipped"
print(json.dumps({"name": sys.argv[2], "state": state, "log": sys.argv[3]}))
PY
)"$'\n'
	else
		local mark="$state"
		printf '%s  %s' "$mark" "$name"
		if [[ -n "$log" ]]; then
			printf '\n  %s' "$log"
		fi
		printf '\n'
	fi
}

pass() { record PASS "$@"; }
fail() { record FAIL "$@"; }
skip() { record SKIP "$@"; }

# curl_api <method> <path> [body] -> prints "<http-code>\n<response-body>"
# Never fails the script (curl exit folded into code 000).
curl_api() {
	local method="$1" path="$2" body="${3:-}"
	local code raw
	if [[ -n "$body" ]]; then
		raw="$(curl -sS --max-time 4 -X "$method" -H 'content-type: application/json' \
			--data "$body" -w '\n%{http_code}' "$BASE$path" 2>&1 || true)"
	else
		raw="$(curl -sS --max-time 4 -X "$method" \
			-w '\n%{http_code}' "$BASE$path" 2>&1 || true)"
	fi
	code="$(printf '%s' "$raw" | tail -n1 | tr -d '[:space:]')"
	raw="$(printf '%s' "$raw" | sed '$d')"
	if ! [[ "$code" =~ ^[0-9]{3}$ ]]; then
		printf '000\n%s' "$raw"
		return 0
	fi
	printf '%s\n%s' "$code" "$raw"
}

# curl_ws <path> -> prints http code of an unsigned websocket upgrade attempt.
# Prints 000 when the companion is not reachable.
curl_ws() {
	local path="$1" code
	code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 \
		-H 'Connection: Upgrade' -H 'Upgrade: websocket' \
		-H 'Origin: http://127.0.0.1' \
		"$BASE$path" 2>/dev/null || true)"
	if [[ "$code" =~ ^[0-9]{3}$ ]]; then
		printf '%s' "$code"
	else
		printf '000'
	fi
}

json_has_keys() {
	python3 - "$1" $2 <<'PY'
import json, sys
try:
    body = json.loads(sys.argv[1])
except Exception:
    raise SystemExit(1)
if not isinstance(body, dict) or "error" in body:
    raise SystemExit(1)
missing = [k for k in sys.argv[2:] if k not in body]
if missing:
    print("missing " + ", ".join(missing) + ". body: " + sys.argv[1][:300])
    raise SystemExit(2)
PY
}

have_systemd() { command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; }

unit_check() {
	local name="$1"
	if ! have_systemd; then
		skip "$name" "no systemd (emulator/CI)"
		return
	fi
	local active enabled
	active="$(systemctl is-active "$name" 2>/dev/null || true)"
	enabled="$(systemctl is-enabled "$name" 2>/dev/null || true)"
	if [[ "$active" == "active" ]]; then
		pass "$name" "active, enabled=$enabled"
	else
		fail "$name" "is-active=$active is-enabled=$enabled"
	fi
}

echo "gpio-companion on-device healthcheck (port $PORT)" >&2

# ---------------------------------------------------------------- config files
check_json_file() {
	local label="$1" path="$2"
	if [[ ! -f "$path" ]]; then
		fail "$label" "missing $path"
		return 1
	fi
	if python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$path" 2>/dev/null; then
		pass "$label" "$path parses"
		return 0
	fi
	fail "$label" "$path is not valid json"
	return 1
}

check_json_file "config /etc/gpio-companion/config.json" "$CONFIG_DIR/config.json" || true
if [[ -f "$CONFIG_DIR/config.json" ]]; then
	hw="$(python3 -c 'import json; print(json.load(open("'"$CONFIG_DIR"'/config.json")).get("hardware",""))' 2>/dev/null || true)"
	if [[ "$hw" == "raspberrypi" || "$hw" == "orangepi" ]]; then
		pass "config hardware id" "hardware=$hw"
	else
		fail "config hardware id" "unexpected hardware='$hw' (want raspberrypi|orangepi)"
	fi
	token="$(python3 -c 'import json; print((json.load(open("'"$CONFIG_DIR"'/config.json")).get("tunnel") or {}).get("token",""))' 2>/dev/null || true)"
	if [[ -n "$token" ]]; then
		pass "config tunnel token" "token is set"
	else
		fail "config tunnel token" "tunnel.token is empty (run first-setup)"
	fi
fi
if [[ -f "$CONFIG_DIR/pairing.json" ]]; then
	uuid="$(python3 -c 'import json; print(json.load(open("'"$CONFIG_DIR"'/pairing.json")).get("uuid",""))' 2>/dev/null || true)"
	if [[ -n "$uuid" ]]; then
		pass "config pairing uuid" "uuid=$uuid"
	else
		fail "config pairing uuid" "pairing.json has no uuid"
	fi
else
	fail "config pairing uuid" "missing $CONFIG_DIR/pairing.json"
fi
if [[ -f "$CONFIG_DIR/pairing.env" ]]; then
	if grep -q '^GPIO_COMPANION_PAIRING_UUID=.\+' "$CONFIG_DIR/pairing.env" && \
		grep -q '^GPIO_COMPANION_PAIRING_KEY=.\+' "$CONFIG_DIR/pairing.env"; then
		pass "config pairing.env" "uuid + key present"
	else
		fail "config pairing.env" "uuid or key empty"
	fi
else
	fail "config pairing.env" "missing $CONFIG_DIR/pairing.env"
fi
auth_path="$(device_auth_path)"
if [[ -f "$auth_path" ]] && grep -q 'BEGIN PUBLIC KEY' "$auth_path" && grep -q '"keyId"' "$auth_path"; then
	pass "config device-auth.json" "keyId + public key present"
else
	fail "config device-auth.json" "missing or invalid $auth_path (dashboard public key not registered)"
fi
if [[ -f "$CONFIG_DIR/repo.path" && -s "$CONFIG_DIR/repo.path" ]]; then
	pass "config repo.path" "$(cat "$CONFIG_DIR/repo.path")"
else
	fail "config repo.path" "missing or empty $CONFIG_DIR/repo.path"
fi

# ------------------------------------------------------------------- services
unit_check "gpio-companion.service"
unit_check "cloudflared-gpio.service"
unit_check "gpio-companion-update.timer"
unit_check "gpio-companion-cleanup.timer"
unit_check "gpio-companion-wifi.timer"
unit_check "gpio-companion-ble-adapter.service"
unit_check "gpio-companion-openviking.service"
if have_systemd; then
	if run_as_gpio_user_session systemctl --user is-active gpio-opencode.service >/dev/null 2>&1; then
		pass "gpio-opencode.service (user)" "active"
	else
		fail "gpio-opencode.service (user)" "not active for $GPIO_USER"
	fi
else
	skip "gpio-opencode.service (user)" "no systemd (emulator/CI)"
fi
if command -v ss >/dev/null 2>&1; then
	listen="$(ss -ltn 2>/dev/null | awk '$4 ~ /:'"$PORT"'$/ {print $4; exit}')"
	if [[ -n "$listen" ]]; then
		pass "port $PORT listening" "$listen"
	else
		fail "port $PORT listening" "nothing listening on $PORT"
	fi
else
	skip "port $PORT listening" "ss not installed"
fi

# ------------------------------------------------- device API loopback (GETs)
check_get_keys() {
	local name="$1" path="$2"
	shift 2
	local out code body
	out="$(curl_api GET "$path")"
	code="$(printf '%s' "$out" | head -n1)"
	body="$(printf '%s' "$out" | tail -n +2)"
	if [[ "$code" == "000" ]]; then
		fail "$name" "connection refused ($body)"
		return
	fi
	if [[ "$code" != "200" ]]; then
		fail "$name" "HTTP $code: ${body:0:300}"
		return
	fi
	if err="$(json_has_keys "$body" "$@")"; then
		pass "$name" "JSON ok"
	elif [[ -n "$err" ]]; then
		fail "$name" "$err"
	else
		fail "$name" "unexpected body: ${body:0:200}"
	fi
}

check_get_keys "GET /health" "/health" ok version
check_get_keys "GET /v1/gpio" "/v1/gpio" pins
check_get_keys "GET /v1/arduino-proxy" "/v1/arduino-proxy" connected
check_get_keys "GET /v1/flash" "/v1/flash" running
check_get_keys "GET /v1/flash/ports" "/v1/flash/ports" ports
check_get_keys "GET /v1/flash/sketches" "/v1/flash/sketches" sketches
check_get_keys "GET /v1/run" "/v1/run" running
check_get_keys "GET /v1/run/sketches" "/v1/run/sketches" sketches
check_get_keys "GET /v1/verify" "/v1/verify" running
check_get_keys "GET /v1/console" "/v1/console" host usb
check_get_keys "GET /v1/agent" "/v1/agent" running

# run/verify busy flags are informational, never failures
for job in run verify; do
	body="$(curl_api GET "/v1/$job" | tail -n +2)"
	if printf '%s' "$body" | grep -q '"running"[[:space:]]*:[[:space:]]*true'; then
		skip "$job busy flag" "$job is running (live state, not a failure)"
	fi
done

# signed-only routes: unsigned must 401/403 -> route live; anything else is news
check_signed_gate() {
	local name="$1" path="$2"
	local code
	code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$BASE$path" 2>/dev/null || true)"
	[[ "$code" =~ ^[0-9]{3}$ ]] || code="000"
	case "$code" in
	401 | 403) pass "$name" "HTTP $code signature required (route live; signed check stays in test:device)" ;;
	000) fail "$name" "connection refused (companion down)" ;;
	404) fail "$name" "HTTP 404 route missing (regression)" ;;
	*) fail "$name" "unexpected HTTP $code (want 401/403 unsigned)" ;;
	esac
}

check_signed_gate "gate GET /v1/status" "/v1/status"
check_signed_gate "gate GET /v1/info" "/v1/info"
check_signed_gate "gate GET /v1/logs" "/v1/logs"
check_signed_gate "gate GET /v1/config" "/v1/config"
check_signed_gate "gate GET /v1/opencode/global/health" "/v1/opencode/global/health"

# --------------------------------------------------------------- safe probes
gpio_probe="$(curl_api PUT "/v1/gpio" '{"physical":1,"dir":"out","value":1}')"
gpio_code="$(printf '%s' "$gpio_probe" | head -n1)"
gpio_body="$(printf '%s' "$gpio_probe" | tail -n +2)"
if printf '%s %s' "$gpio_body" | grep -qiE 'power|gnd|not gpio'; then
	pass "PUT /v1/gpio pin-1 refusal" "board refused power pin (${gpio_body:0:160})"
elif [[ -z "$gpio_body" && "$gpio_code" == "200" ]]; then
	fail "PUT /v1/gpio pin-1 refusal" "board ACCEPTED a write to physical pin 1 (power) — must refuse"
else
	fail "PUT /v1/gpio pin-1 refusal" "HTTP $gpio_code: ${gpio_body:0:200}"
fi

pair_uuid="$(pairing_uuid)"
if [[ -z "$pair_uuid" ]]; then
	fail "PUT /v1/config/wifi probe" "no pairing uuid, cannot build probe body"
else
	wifi_body="$(python3 -c 'import json; print(json.dumps({"ssid":"'"$PROBE_SSID"'","psk":"'"$PROBE_PSK"'","uuid":"'"$pair_uuid"'"}))')"
	wifi_out="$(curl_api PUT "/v1/config/wifi" "$wifi_body")"
	wifi_code="$(printf '%s' "$wifi_out" | head -n1)"
	wifi_raw="$(printf '%s' "$wifi_out" | tail -n +2)"
	if printf '%s' "$wifi_raw" | grep -qiE 'ssid-not-found|wifi network not found'; then
		pass "PUT /v1/config/wifi probe" "handler ran, rejected probe SSID (${wifi_raw:0:160})"
	elif printf '%s' "$wifi_raw" | grep -q '"connected"[[:space:]]*:[[:space:]]*true'; then
		fail "PUT /v1/config/wifi probe" "probe SSID CONNECTED — healthcheck must never join a real network"
	else
		fail "PUT /v1/config/wifi probe" "HTTP $wifi_code: ${wifi_raw:0:200}"
	fi
fi

for p in "/v1/flash" "/v1/run" "/v1/verify" "/v1/console/usb"; do
	out="$(curl_api POST "$p" "{")"
	code="$(printf '%s' "$out" | head -n1)"
	body="$(printf '%s' "$out" | tail -n +2)"
	if printf '%s' "$body" | grep -qi 'invalid json'; then
		pass "POST $p invalid-json" "handler wired (invalid json, nothing started)"
	else
		fail "POST $p invalid-json" "HTTP $code: ${body:0:160}"
	fi
done

# -------------------------------------------------------------- GPIO hardware
if ls /dev/gpiochip* >/dev/null 2>&1; then
	pass "gpio /dev/gpiochip*" "$(ls /dev/gpiochip* 2>/dev/null | tr '\n' ' ')"
else
	fail "gpio /dev/gpiochip*" "no /dev/gpiochip* (gpio group/udev or hardware missing)"
fi
if getent group gpio >/dev/null 2>&1; then
	if [[ "$GPIO_USER" == "root" ]] || id -nG "$GPIO_USER" 2>/dev/null | grep -qw gpio; then
		pass "gpio group" "$GPIO_USER in gpio group"
	else
		fail "gpio group" "$GPIO_USER not in gpio group (Live GPIO opens /dev/gpiochip* as GPIO user)"
	fi
else
	fail "gpio group" "no gpio group (install_gpiochip_udev not applied)"
fi
if command -v gpioinfo >/dev/null 2>&1; then
	if gpioinfo 2>/dev/null | head -n2 | grep -qi 'gpiochip'; then
		pass "gpio libgpiod" "gpioinfo lists chips"
	else
		fail "gpio libgpiod" "gpioinfo found no chips"
	fi
else
	fail "gpio libgpiod" "gpioinfo not installed (gpiod package missing)"
fi
if [[ -f /proc/device-tree/model ]]; then
	model="$(tr -d '\0' </proc/device-tree/model)"
	pass "gpio board model" "$model"
else
	skip "gpio board model" "no /proc/device-tree/model (not a Pi/VM)"
fi

# ------------------------------------------------------------------------ BLE
ble_script="${GPIO_COMPANION_BLE_SCRIPT:-$LIB_DIR/ble-gatt-server.py}"
if [[ -f "$ble_script" ]]; then
	if python3 -m py_compile "$ble_script" 2>/dev/null; then
		pass "ble gatt script" "$ble_script compiles"
	else
		fail "ble gatt script" "$ble_script has python syntax errors"
	fi
else
	fail "ble gatt script" "missing $ble_script"
fi
if [[ -f /etc/bluetooth/main.conf ]]; then
	if grep -qE '^ControllerMode[[:space:]]*=[[:space:]]*le' /etc/bluetooth/main.conf; then
		pass "ble ControllerMode" "le (desktop GATT leftover fix)"
	else
		fail "ble ControllerMode" "not 'le' in /etc/bluetooth/main.conf"
	fi
else
	skip "ble ControllerMode" "no /etc/bluetooth/main.conf (bluez not installed?)"
fi
if command -v hciconfig >/dev/null 2>&1; then
	adapter="$(hciconfig 2>/dev/null | awk '/^hci/{name=$1} /UP RUNNING/{print name; exit}')"
	adapter="${adapter%:}"
	if [[ -n "$adapter" ]]; then
		pass "ble adapter" "$adapter UP RUNNING"
	else
		fail "ble adapter" "no hci UP RUNNING (bluetooth down or UART HCI missing)"
	fi
elif command -v bluetoothctl >/dev/null 2>&1; then
	if bluetoothctl show 2>/dev/null | grep -q 'Powered: yes'; then
		pass "ble adapter" "controller powered (bluetoothctl)"
	else
		fail "ble adapter" "controller not powered (bluetoothctl)"
	fi
else
	skip "ble adapter" "neither hciconfig nor bluetoothctl installed"
fi
if [[ -f "$LIB_DIR/ble-adapter.sh" ]]; then
	pass "ble adapter script" "$LIB_DIR/ble-adapter.sh present"
else
	fail "ble adapter script" "missing $LIB_DIR/ble-adapter.sh"
fi

# ----------------------------------------------------------- network + tunnel
if command -v nmcli >/dev/null 2>&1; then
	ssid="$(nmcli -t -f active,ssid dev wifi 2>/dev/null | awk -F: '$1=="yes"{print $2; exit}')"
	primary="$(nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null | grep ':connected' | head -n1 || true)"
	if [[ -n "$primary" ]]; then
		pass "network link" "$primary ssid=${ssid:-none}"
	else
		fail "network link" "no connected device (nmcli)"
	fi
else
	skip "network link" "nmcli not installed"
fi
if curl -fsS --max-time 5 "$(dashboard_url)/api/device-public-key" -o /dev/null 2>/dev/null; then
	pass "dashboard reachability" "$(dashboard_url)/api/device-public-key reachable"
else
	fail "dashboard reachability" "$(dashboard_url) unreachable (tunnel/egress down?)"
fi

# ------------------------------------------------------------------ toolchain
for tool in "bun --version" "node --version" "git --version" "gcc --version" "arduino-cli version" "python3 --version"; do
	bin="${tool%% *}"
	if out="$($tool 2>/dev/null | head -n1)"; then
		pass "tool $bin" "$out"
	else
		fail "tool $bin" "$bin not installed"
	fi
done
if [[ -x "$LIB_DIR/gpio-pwm" ]]; then
	pass "tool gpio-pwm" "$LIB_DIR/gpio-pwm executable"
else
	fail "tool gpio-pwm" "missing $LIB_DIR/gpio-pwm (native/gpio-pwm not compiled)"
fi
if [[ -f "$LIB_DIR/gpio-host/Arduino.h" && -f "$LIB_DIR/gpio-host/arduino.c" && -f "$LIB_DIR/gpio-host/main.c" ]]; then
	pass "tool gpio-host" "headers + sources present"
else
	fail "tool gpio-host" "missing $LIB_DIR/gpio-host/* (native/gpio-host not installed)"
fi
if [[ -f "$LIB_DIR/arduino-proxy/arduino-proxy.ino" ]]; then
	pass "tool arduino-proxy firmware" "arduino-proxy.ino present"
else
	fail "tool arduino-proxy firmware" "missing $LIB_DIR/arduino-proxy/arduino-proxy.ino"
fi
if ls /dev/ttyACM* /dev/ttyUSB* >/dev/null 2>&1; then
	pass "tool usb serial" "$(ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | tr '\n' ' ')"
else
	skip "tool usb serial" "no /dev/ttyACM* or /dev/ttyUSB* (no Arduino plugged in)"
fi

# ------------------------------------------------------------------- opencode
opencode_env="${GPIO_COMPANION_OPENCODE_SERVER_ENV:-$CONFIG_DIR/opencode-server.env}"
if command -v opencode >/dev/null 2>&1 || [[ -x "$BIN_DIR/opencode" ]]; then
	pass "opencode binary" "$(command -v opencode 2>/dev/null || echo "$BIN_DIR/opencode")"
else
	fail "opencode binary" "opencode not on PATH nor $BIN_DIR"
fi
if [[ -f "$opencode_env" ]]; then
	mode="$(stat -c %a "$opencode_env" 2>/dev/null || true)"
	pw="$(sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' "$opencode_env" | tail -n1)"
	user="$(sed -n 's/^OPENCODE_SERVER_USERNAME=//p' "$opencode_env" | tail -n1)"
	user="${user:-opencode}"
	if [[ -n "$pw" && "$mode" == "600" ]]; then
		pass "opencode server env" "$opencode_env mode 600, password set"
	else
		fail "opencode server env" "$opencode_env mode=$mode password_set=$([ -n "$pw" ] && echo yes || echo no)"
	fi
else
	fail "opencode server env" "missing $opencode_env"
	pw=""
	user="opencode"
fi
if [[ -n "${pw:-}" ]]; then
	oc_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 -u "$user:$pw" \
		http://127.0.0.1:4096/global/health 2>/dev/null || true)"
	[[ "$oc_code" =~ ^[0-9]{3}$ ]] || oc_code="000"
	oc_body="$(curl -s --max-time 4 -u "$user:$pw" \
		http://127.0.0.1:4096/global/health 2>/dev/null || true)"
	if [[ "$oc_code" == "200" ]]; then
		pass "opencode upstream /global/health" "HTTP 200 (${oc_body:0:120})"
	else
		fail "opencode upstream /global/health" "HTTP $oc_code (opencode serve down or bad password)"
	fi
	unset pw
else
	fail "opencode upstream /global/health" "no password, cannot probe upstream"
fi
if [[ -n "${user:-}" ]]; then unset user; fi

# ------------------------------------------------------------------ openviking
ov_venv="${GPIO_COMPANION_OPENVIKING_VENV:-$LIB_DIR/openviking}"
ov_port="${GPIO_COMPANION_OPENVIKING_PORT:-1933}"
if [[ -x "$ov_venv/bin/openviking-server" ]]; then
	pass "openviking venv" "$ov_venv/bin/openviking-server executable"
else
	fail "openviking venv" "missing $ov_venv/bin/openviking-server"
fi
if curl -fsS --max-time 3 "http://127.0.0.1:${ov_port}/health" -o /dev/null 2>/dev/null; then
	pass "openviking server" "http://127.0.0.1:${ov_port}/health ok"
else
	fail "openviking server" "http://127.0.0.1:${ov_port}/health unreachable"
fi

# ---------------------------------------------------------- storage/disk/logs
if command -v df >/dev/null 2>&1; then
	avail="$(df -Pm / 2>/dev/null | awk 'NR==2 {print $4}')"
	if [[ -n "$avail" ]]; then
		if [[ "$avail" -ge 512 ]]; then
			pass "disk / free" "${avail}MB free"
		else
			fail "disk / free" "only ${avail}MB free on / (openviking needs 1536MB at install)"
		fi
	fi
fi
if have_systemd && command -v journalctl >/dev/null 2>&1; then
	if journalctl --disk-usage 2>/dev/null | head -n1 | grep -q .; then
		pass "journald" "$(journalctl --disk-usage 2>/dev/null | head -n1)"
	else
		skip "journald" "journalctl --disk-usage empty"
	fi
else
	skip "journald" "no systemd/journalctl"
fi

# ------------------------------------------------------------------- projects
projects_root() {
	if [[ -n "${GPIO_COMPANION_PROJECTS_DIR:-}" ]]; then
		printf '%s' "$GPIO_COMPANION_PROJECTS_DIR"
	elif [[ "$GPIO_USER" == "root" ]]; then
		printf '%s' "${HOME:-/root}/projects"
	else
		printf '%s' "/home/$GPIO_USER/projects"
	fi
}
PROOT="$(projects_root)"
if [[ -d "$PROOT" ]]; then
	count="$(find "$PROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
	pass "projects dir" "$PROOT ($count repos)"
else
	fail "projects dir" "missing $PROOT"
	count=0
fi
FIRST_REPO=""
if [[ -d "$PROOT" ]]; then
	FIRST_REPO="$(find "$PROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort | head -n1 || true)"
	if [[ -z "$FIRST_REPO" ]]; then
		FIRST_REPO="$(ls "$PROOT" 2>/dev/null | head -n1 || true)"
	fi
fi

# ----------------------------------------------------------------- websockets
# All companion sockets require a signed upgrade (serve.ts acceptSignedUpgrade),
# so an unsigned curl must fail closed: 401/403 = route live + gate working.
ws_check() {
	local name="$1" path="$2"
	local code
	code="$(curl_ws "$path")"
	case "$code" in
	401 | 403) pass "$name" "HTTP $code signature required (socket live)" ;;
	400 | 426)
		pass "$name" "HTTP $code upgrade handling alive"
		;;
	000) fail "$name" "connection refused (companion down)" ;;
	404) fail "$name" "HTTP 404 route missing (regression)" ;;
	503) fail "$name" "HTTP 503 dependency missing" ;;
	*) fail "$name" "unexpected HTTP $code (want 401/403 unsigned)" ;;
	esac
}

ws_plain="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$BASE/v1/debug" 2>/dev/null || true)"
[[ "$ws_plain" =~ ^[0-9]{3}$ ]] || ws_plain="000"
if [[ "$ws_plain" == "400" ]]; then
	pass "WS GET /v1/debug plain" "HTTP 400 upgrade failed (debug-http probe ready)"
elif [[ "$ws_plain" == "000" ]]; then
	fail "WS GET /v1/debug plain" "connection refused (companion down)"
else
	fail "WS GET /v1/debug plain" "unexpected HTTP $ws_plain (want 400 upgrade failed)"
fi
ws_check "WS /v1/debug upgrade" "/v1/debug"
ws_check "WS /v1/gpio" "/v1/gpio"
ws_check "WS /v1/console" "/v1/console"
ws_check "WS /v1/ui" "/v1/ui"
if [[ -n "$FIRST_REPO" ]]; then
	ws_check "WS /v1/opencode/event/$FIRST_REPO" "/v1/opencode/event/$FIRST_REPO"
	ws_check "WS /v1/files/watch/$FIRST_REPO" "/v1/files/watch/$FIRST_REPO"
else
	skip "WS /v1/opencode/event/<repo>" "no repo in $PROOT for scoped socket"
	skip "WS /v1/files/watch/<repo>" "no repo in $PROOT for scoped socket"
fi
if [[ -n "${FIRST_REPO:-}" ]]; then unset FIRST_REPO; fi

# -------------------------------------------------------------------- summary
if [[ "$JSON" == "1" ]]; then
	python3 - "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT" "$JSON_ROWS" <<'PY'
import json, sys
passed, failed, skipped = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
rows = [json.loads(line.strip().rstrip(",")) for line in sys.argv[4].splitlines() if line.strip().rstrip(",")]
print(json.dumps({"passed": passed, "failed": failed, "skipped": skipped, "rows": rows}, indent=2))
PY
else
	echo ""
	echo "$PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped" >&2
fi
if [[ "$FAIL_COUNT" -gt 0 ]]; then
	exit 1
fi
