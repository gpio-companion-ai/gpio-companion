#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

json=0
for arg in "$@"; do
	case "$arg" in
	--json | -j) json=1 ;;
	-h | --help)
		echo "usage: $0 [--json]"
		exit 0
		;;
	*)
		echo "usage: $0 [--json]" >&2
		exit 2
		;;
	esac
done

export GPIO_INFO_JSON="$json"
export GPIO_INFO_CONFIG_DIR="$CONFIG_DIR"
export GPIO_INFO_BIN_DIR="$BIN_DIR"
export GPIO_INFO_LIB_DIR="$LIB_DIR"
export GPIO_INFO_USER="$GPIO_USER"
export GPIO_INFO_DASHBOARD="$(dashboard_url)"
export GPIO_INFO_PAIRING_JSON="${GPIO_COMPANION_PAIRING:-$CONFIG_DIR/pairing.json}"
export GPIO_INFO_PAIRING_ENV="$CONFIG_DIR/pairing.env"
export GPIO_INFO_SECRETS="${GPIO_COMPANION_SECRETS:-$CONFIG_DIR/secrets.env}"
export GPIO_INFO_CONFIG="${GPIO_COMPANION_CONFIG:-$CONFIG_DIR/config.json}"
export GPIO_INFO_TUNNEL_ENV="${GPIO_COMPANION_TUNNEL_ENV:-$CONFIG_DIR/cloudflared.env}"
export GPIO_INFO_DEVICE_AUTH="$(device_auth_path)"
export GPIO_INFO_CLOCK="${GPIO_COMPANION_CLOCK_STAMP:-$CONFIG_DIR/last-device-timestamp}"
export GPIO_INFO_NONCES="${GPIO_COMPANION_NONCES:-$CONFIG_DIR/device-nonces.json}"
export GPIO_INFO_BLE="${GPIO_COMPANION_BLE_SCRIPT:-$LIB_DIR/ble-gatt-server.py}"
export GPIO_INFO_PORT="${GPIO_COMPANION_PORT:-4150}"

python3 - <<'PY'
import json, os, socket, subprocess, time
from pathlib import Path

def sh(cmd, timeout=4):
	try:
		out = subprocess.run(
			cmd,
			shell=True,
			check=False,
			capture_output=True,
			text=True,
			timeout=timeout,
		)
		return (out.stdout or out.stderr or "").strip()
	except Exception as err:
		return str(err)

def read_json(path):
	p = Path(path)
	if not p.is_file():
		return None
	try:
		return json.loads(p.read_text())
	except Exception:
		return {"error": "unreadable"}

def read_text(path):
	p = Path(path)
	if not p.is_file():
		return None
	try:
		return p.read_text()
	except PermissionError:
		return "unreadable"
	except Exception:
		return "unreadable"

def env_file(path):
	text = read_text(path)
	if not text or text == "unreadable":
		return {}
	out = {}
	for line in text.splitlines():
		if not line or line.startswith("#") or "=" not in line:
			continue
		key, value = line.split("=", 1)
		out[key.strip()] = value.strip().strip('"').strip("'")
	return out

def present(value):
	if value is None:
		return False
	if isinstance(value, str):
		return bool(value.strip()) and value != "unreadable"
	return bool(value)

def unit(name):
	active = sh(f"systemctl is-active {name} 2>/dev/null") or "unknown"
	enabled = sh(f"systemctl is-enabled {name} 2>/dev/null") or "unknown"
	return {"active": active, "enabled": enabled}

def http_json(url):
	raw = sh(f"curl -fsS --max-time 2 {url} 2>/dev/null")
	if not raw:
		return None
	try:
		return json.loads(raw)
	except json.JSONDecodeError:
		return {"raw": raw}

config_dir = os.environ["GPIO_INFO_CONFIG_DIR"]
pairing = read_json(os.environ["GPIO_INFO_PAIRING_JSON"]) or {}
pairing_env = env_file(os.environ["GPIO_INFO_PAIRING_ENV"])
config = read_json(os.environ["GPIO_INFO_CONFIG"]) or {}
secrets = env_file(os.environ["GPIO_INFO_SECRETS"])
tunnel_env = env_file(os.environ["GPIO_INFO_TUNNEL_ENV"])
auth = read_json(os.environ["GPIO_INFO_DEVICE_AUTH"]) or {}
clock = read_text(os.environ["GPIO_INFO_CLOCK"])
repo = read_text(f"{config_dir}/repo.path")
branch = read_text(f"{config_dir}/branch")
setup = Path(f"{config_dir}/first-setup-complete").is_file()
tunnel = config.get("tunnel") if isinstance(config, dict) else {}
if not isinstance(tunnel, dict):
	tunnel = {}
uuid = pairing_env.get("GPIO_COMPANION_PAIRING_UUID") or pairing.get("uuid") or ""
api_host = tunnel.get("apiHostname") or tunnel_env.get("TUNNEL_API_HOSTNAME") or ""
t3_host = tunnel.get("hostname") or tunnel_env.get("TUNNEL_HOSTNAME") or ""
health = http_json(f"http://127.0.0.1:{os.environ['GPIO_INFO_PORT']}/health")
ssid = sh("nmcli -t -f active,ssid dev wifi 2>/dev/null | awk -F: '$1==\"yes\"{print $2; exit}'")
ntp = sh("timedatectl show -p NTPSynchronized --value 2>/dev/null")

def split_nmcli(line):
	parts = []
	buf = []
	esc = False
	for ch in line:
		if esc:
			buf.append(ch)
			esc = False
		elif ch == "\\":
			esc = True
		elif ch == ":":
			parts.append("".join(buf))
			buf = []
		else:
			buf.append(ch)
	parts.append("".join(buf))
	return parts

def network_type(raw):
	kind = (raw or "").lower()
	if kind in ("ethernet", "802-3-ethernet"):
		return "ethernet"
	if kind in ("wifi", "802-11-wireless", "wireless"):
		return "wifi"
	return "unknown"

def collect_network(wifi_ssid):
	devices = []
	for line in (sh("nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device status 2>/dev/null") or "").splitlines():
		parts = split_nmcli(line)
		if len(parts) < 3:
			continue
		device, kind, state = parts[0], parts[1], parts[2]
		connection = parts[3] if len(parts) > 3 else ""
		if state != "connected" or kind == "loopback":
			continue
		devices.append({"device": device, "type": kind, "connection": connection})
	routes = []
	for line in (sh("ip -4 route show default 2>/dev/null") or "").splitlines():
		bits = line.split()
		dev = bits[bits.index("dev") + 1] if "dev" in bits and bits.index("dev") + 1 < len(bits) else ""
		metric = 10000
		if "metric" in bits and bits.index("metric") + 1 < len(bits):
			try:
				metric = int(bits[bits.index("metric") + 1])
			except Exception:
				pass
		if dev:
			routes.append({"device": dev, "metric": metric})
	routes.sort(key=lambda item: item["metric"])
	primary = None
	for route in routes:
		match = next((item for item in devices if item["device"] == route["device"]), None)
		if match:
			primary = match
			break
	if primary is None and devices:
		wired = next((item for item in devices if network_type(item["type"]) == "ethernet"), None)
		primary = wired or devices[0]
	if primary is None:
		return {"type": "unknown", "ssid": wifi_ssid, "interface": "", "connection": ""}
	kind = network_type(primary["type"])
	shown = wifi_ssid if kind == "wifi" else ""
	if kind == "wifi" and not shown:
		shown = primary["connection"]
	return {
		"type": kind,
		"ssid": shown,
		"interface": primary["device"],
		"connection": primary["connection"],
	}

network = collect_network(ssid)

info = {
	"host": {
		"hostname": socket.gethostname(),
		"user": os.environ.get("GPIO_INFO_USER") or "",
		"kernel": sh("uname -sr"),
		"arch": sh("uname -m"),
		"uptime": sh("uptime -p 2>/dev/null || uptime"),
		"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
		"wifiSsid": ssid,
		"ntpSynchronized": ntp == "yes",
	},
	"network": network,
	"versions": {
		"gpioCompanion": sh("gpio-companion version 2>/dev/null"),
		"bun": sh("bun --version 2>/dev/null"),
		"node": sh("node --version 2>/dev/null"),
		"git": sh("git --version 2>/dev/null"),
		"health": health,
	},
	"paths": {
		"configDir": config_dir,
		"repo": (repo or "").strip() or None,
		"branch": (branch or "").strip() or None,
		"firstSetupComplete": setup,
	},
	"pairing": {
		"uuid": uuid,
		"claimed": bool(pairing.get("claimed")),
		"userId": pairing.get("userId") or "",
		"email": pairing.get("email") or "",
		"login": pairing.get("login") or "",
		"claimedAt": pairing.get("claimedAt") or "",
		"keySet": present(pairing_env.get("GPIO_COMPANION_PAIRING_KEY") or pairing.get("key")),
	},
	"hardware": (config.get("hardware") if isinstance(config, dict) else None)
	or os.environ.get("GPIO_COMPANION_HARDWARE")
	or "",
	"tunnel": {
		"tokenSet": present(tunnel.get("token") or tunnel_env.get("TUNNEL_TOKEN")),
		"hostname": t3_host,
		"apiHostname": api_host,
		"tunnelId": tunnel.get("tunnelId") or tunnel_env.get("TUNNEL_ID") or "",
		"deviceUrl": f"https://{api_host}" if api_host and "://" not in str(api_host) else api_host,
	},
	"dashboardUrl": os.environ.get("GPIO_INFO_DASHBOARD") or "",
	"secrets": {
		"gpioAiKeySet": present(secrets.get("GPIO_AI_KEY") or secrets.get("OPENCODE_API_KEY")),
		"githubUsername": secrets.get("GITHUB_USERNAME") or "",
		"githubTokenSet": present(secrets.get("GITHUB_TOKEN")),
		"githubUrl": secrets.get("GITHUB_URL") or "",
		"gitCredentialsSet": present(read_text(f"{config_dir}/git-credentials")),
	},
	"deviceAuth": {
		"keyId": auth.get("keyId") or "",
		"publicKeySet": present(auth.get("publicKeyPem")),
		"clockStamp": (clock or "").strip() or None,
		"nonceFile": Path(os.environ["GPIO_INFO_NONCES"]).is_file(),
	},
	"ble": {
		"script": os.environ["GPIO_INFO_BLE"],
		"scriptPresent": Path(os.environ["GPIO_INFO_BLE"]).is_file(),
		"adapter": sh("hciconfig 2>/dev/null | awk '/^hci/{name=$1} /UP RUNNING/{print name; exit}'").rstrip(":"),
	},
	"services": {
		"gpio-companion": unit("gpio-companion.service"),
		"cloudflared-gpio": unit("cloudflared-gpio.service"),
		"gpio-companion-update.timer": unit("gpio-companion-update.timer"),
		"gpio-companion-cleanup.timer": unit("gpio-companion-cleanup.timer"),
		"gpio-companion-wifi.timer": unit("gpio-companion-wifi.timer"),
		"port": int(os.environ["GPIO_INFO_PORT"]),
		"listen": sh(f"ss -ltn 2>/dev/null | awk '$4 ~ /:{os.environ['GPIO_INFO_PORT']}$/{{print $4; exit}}'"),
	},
}

def emit(obj, prefix=""):
	if isinstance(obj, dict):
		for key, value in obj.items():
			label = f"{prefix}{key}"
			if isinstance(value, (dict, list)):
				print(f"{label}:")
				emit(value, prefix + "  ")
			else:
				if value is None or value == "":
					shown = "-"
				elif isinstance(value, bool):
					shown = "yes" if value else "no"
				else:
					shown = value
				print(f"{label}: {shown}")
		return
	if isinstance(obj, list):
		for item in obj:
			emit(item, prefix)
		return
	print(f"{prefix}{obj}")

if os.environ.get("GPIO_INFO_JSON") == "1":
	print(json.dumps(info, indent=2, sort_keys=True))
else:
	print("gpio-companion device info")
	print("=" * 24)
	emit(info)
PY
