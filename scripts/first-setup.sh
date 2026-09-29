#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

MARKER="${GPIO_COMPANION_SETUP_MARKER:-/etc/gpio-companion/first-setup-complete}"

need_root
resolve_gpio_runtime_user
grant_gpio_user_nopasswd_sudo
echo "gpio-companion: runtime user $GPIO_USER (API + OpenCode)"

if [[ -f "$MARKER" && "${GPIO_COMPANION_FORCE_SETUP:-}" != "1" ]]; then
	echo "gpio-companion first-setup already complete ($MARKER)"
	exit 0
fi

prompt() {
	local __var="$1" __msg="$2" __def="${3:-}" __value=""
	if [[ -n "$__def" ]]; then
		read -r -p "$__msg [$__def]: " __value || true
		__value="${__value:-$__def}"
	else
		read -r -p "$__msg: " __value || true
	fi
	printf -v "$__var" '%s' "$__value"
}

prompt_secret() {
	local __var="$1" __msg="$2" __value=""
	if [[ -t 0 ]]; then
		read -r -s -p "$__msg: " __value || true
		echo
	else
		read -r -p "$__msg: " __value || true
	fi
	printf -v "$__var" '%s' "$__value"
}

guess_hardware() {
	local model=""
	if [[ -r /proc/device-tree/model ]]; then
		model="$(tr -d '\0' </proc/device-tree/model)"
	fi
	case "${model,,}" in
	*orange*) echo orangepi ;;
	*raspberry*) echo raspberrypi ;;
	*) echo raspberrypi ;;
	esac
}

if [[ ! -t 0 && -z "${GPIO_COMPANION_HARDWARE:-}" ]]; then
	die "first-setup needs a TTY or GPIO_COMPANION_HARDWARE"
fi

echo "gpio-companion first setup"
echo "OpenCode API key and GitHub token are set from the dashboard, not this prompt."
echo "Open Code runs in the dashboard after you claim this board. No public code hostname."
echo

export GPIO_COMPANION_DASHBOARD_URL="${GPIO_COMPANION_DASHBOARD_URL:-https://gpio-companion.com}"

hardware="${GPIO_COMPANION_HARDWARE:-}"
if [[ -z "$hardware" ]]; then
	local_default="$(guess_hardware)"
	echo "Hardware:"
	echo "  1) raspberrypi"
	echo "  2) orangepi"
	if [[ "$local_default" == "orangepi" ]]; then
		prompt hw_choice "Choice" "2"
	else
		prompt hw_choice "Choice" "1"
	fi
	case "$hw_choice" in
	2 | orangepi) hardware=orangepi ;;
	*) hardware=raspberrypi ;;
	esac
fi
if [[ "$hardware" != "raspberrypi" && "$hardware" != "orangepi" ]]; then
	die "hardware must be raspberrypi or orangepi"
fi

cf_token="${GPIO_COMPANION_CF_API_TOKEN:-}"
cf_account="${GPIO_COMPANION_CF_ACCOUNT_ID:-}"
cf_zone="${GPIO_COMPANION_CF_ZONE_ID:-}"

if [[ -t 0 ]]; then
	[[ -n "$cf_token" ]] || prompt_secret cf_token "Cloudflare API token (Tunnel Edit + Zone DNS Edit)"
	[[ -n "$cf_account" ]] || prompt cf_account "Cloudflare account ID" ""
	[[ -n "$cf_zone" ]] || prompt cf_zone "Cloudflare zone ID (gpio-companion.com)" ""
fi

if [[ -z "$cf_token" || -z "$cf_account" || -z "$cf_zone" ]]; then
	die "Cloudflare API token, account ID, and zone ID are required"
fi

echo "installing $hardware..."
"/bin/bash" "$SCRIPT_DIR/install-${hardware}.sh"
ensure_networkmanager_wifi

write_pairing_env
# shellcheck disable=SC1091
source "$CONFIG_DIR/pairing.env"
if [[ -z "${GPIO_COMPANION_PAIRING_UUID:-}" ]]; then
	die "pairing UUID missing after write_pairing_env"
fi

echo "creating Cloudflare tunnel for this board..."
tunnel_json="$(create_cloudflare_tunnel "$GPIO_COMPANION_PAIRING_UUID" "$cf_token" "$cf_account" "$cf_zone")"
unset cf_token
cf_token=""

tunnel_token="$(TUNNEL_JSON="$tunnel_json" python3 -c 'import json,os; print(json.loads(os.environ["TUNNEL_JSON"])["token"])')"
api_hostname="$(TUNNEL_JSON="$tunnel_json" python3 -c 'import json,os; print(json.loads(os.environ["TUNNEL_JSON"])["apiHostname"])')"
tunnel_id="$(TUNNEL_JSON="$tunnel_json" python3 -c 'import json,os; print(json.loads(os.environ["TUNNEL_JSON"])["tunnelId"])')"

apply_runtime_config "$hardware" "$tunnel_token" "" "$api_hostname" "$tunnel_id"
unset tunnel_token
tunnel_token=""

register_device_public_key

echo "writing OpenCode loopback AI provider..."
write_opencode_ai_provider

openviking_install=0
if [[ -n "${GPIO_COMPANION_OPENVIKING:-}" ]]; then
	case "${GPIO_COMPANION_OPENVIKING,,}" in
	1 | y | yes | true) openviking_install=1 ;;
	*) openviking_install=0 ;;
	esac
elif [[ -t 0 ]]; then
	free_mb="$(df -Pm / | awk 'NR==2 {print $4}')"
	prompt openviking_choice "Install the on-device OpenViking memory server? (~400MB disk, ${free_mb}MB free) [y/N]" "n"
	case "${openviking_choice,,}" in
	y | yes | 1 | true) openviking_install=1 ;;
	*) openviking_install=0 ;;
	esac
fi
if [[ "$openviking_install" -eq 1 ]]; then
	echo "installing the optional OpenViking memory server..."
	if ! "/bin/bash" "$SCRIPT_DIR/setup-openviking.sh" --yes; then
		echo "openviking setup failed; continuing without the memory server" >&2
	fi
else
	set_openviking_flag false
fi

install -d -m 0755 "$CONFIG_DIR"
date -u +"%Y-%m-%dT%H:%M:%SZ" >"$MARKER"
chmod 644 "$MARKER"

echo "first-setup complete"
echo "device API: https://${api_hostname}"
echo "pair this board on the dashboard /pair page with the UUID and key above"
echo "OpenCode uses gpio-companion credits via http://127.0.0.1:4150/v1/ai (default @cf/zai-org/glm-5.3)"
echo "OpenCode server listens on 127.0.0.1:4096; the device API proxies it. No public hostname."
