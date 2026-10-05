#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

CONFIG_DIR="${GPIO_COMPANION_CONFIG_DIR:-/etc/gpio-companion}"
if [[ -f "$CONFIG_DIR/update.env" ]]; then
	# shellcheck disable=SC1091
	source "$CONFIG_DIR/update.env"
fi
if [[ -f "$CONFIG_DIR/repo.path" ]]; then
	REPO_ROOT="$(cat "$CONFIG_DIR/repo.path")"
	SCRIPT_DIR="$REPO_ROOT/scripts"
fi

GPIO_USER="${GPIO_USER:-${SUDO_USER:-root}}"
BIN_DIR="${GPIO_COMPANION_BIN_DIR:-/usr/local/bin}"
LIB_DIR="${GPIO_COMPANION_LIB_DIR:-/usr/local/lib/gpio-companion}"
BIN_REV_FILE="${GPIO_COMPANION_BIN_REV:-$CONFIG_DIR/bin.rev}"
FORCE=0
CF_API_KEY="${GPIO_COMPANION_CF_API_KEY:-}"
if [[ "${GPIO_COMPANION_UPDATE_FORCE:-}" == "1" ]]; then
	FORCE=1
fi
while [[ $# -gt 0 ]]; do
	case "$1" in
	--force)
		FORCE=1
		shift
		;;
	--cf-api-key)
		if [[ -z "${2:-}" || "$2" == --* ]]; then
			echo "gpio-companion update: --cf-api-key needs a Cloudflare API token" >&2
			exit 1
		fi
		CF_API_KEY="$2"
		shift 2
		;;
	--cf-api-key=*)
		CF_API_KEY="${1#*=}"
		if [[ -z "$CF_API_KEY" ]]; then
			echo "gpio-companion update: --cf-api-key is empty" >&2
			exit 1
		fi
		shift
		;;
	*)
		echo "gpio-companion update: unknown argument: $1" >&2
		exit 1
		;;
	esac
done

ensure_root

# one update at a time: concurrent runs race the git checkout and have
# truncated rendered files (0-byte opencode unit, 2026-10-04)
exec 9>/run/gpio-companion-update.lock
if ! flock -n 9; then
	echo "gpio-companion update: another update is already running; skipping"
	exit 0
fi

cd "$REPO_ROOT"

before="$(git_in "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
branch="main"
if [[ -f "$CONFIG_DIR/branch" ]]; then
	branch="$(cat "$CONFIG_DIR/branch")"
fi

if ! sync_managed_checkout "$REPO_ROOT" "$branch"; then
	echo "gpio-companion update: git sync failed" >&2
	exit 1
fi

after="$(git_in "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
echo "gpio-companion update: $before -> $after"

SCRIPT_DIR="$REPO_ROOT/scripts"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

resolve_gpio_runtime_user
grant_gpio_user_nopasswd_sudo
ensure_networkmanager_wifi
sync_opencode_agent

key_changed=0
if refresh_device_public_key; then
	key_changed=1
fi

bin_rev="$(cat "$BIN_REV_FILE" 2>/dev/null || echo none)"

paths_changed() {
	local pattern="$1" from="${2:-$before}"
	if [[ "$FORCE" -eq 1 ]]; then
		return 0
	fi
	if [[ "$from" == "$after" ]]; then
		return 1
	fi
	if [[ "$from" == "unknown" || "$from" == "none" || "$after" == "unknown" ]]; then
		return 0
	fi
	if ! git_in "$REPO_ROOT" cat-file -e "$from" >/dev/null 2>&1 || ! git_in "$REPO_ROOT" cat-file -e "$after" >/dev/null 2>&1; then
		return 0
	fi
	git_in "$REPO_ROOT" diff --name-only "$from" "$after" | grep -Eq "$pattern"
}

server_needs_build() {
	if [[ "$FORCE" -eq 1 ]]; then
		return 0
	fi
	local release_info
	if release_info="$(gpio_companion_release_info)"; then
		if version_newer "${release_info%% *}" "$(gpio_companion_current_version)"; then
			return 0
		fi
	fi
	if [[ "$bin_rev" != "$after" ]]; then
		paths_changed '^(binary/gpio-companion/|packages/core/|native/gpio-pwm/|native/gpio-host/|native/arduino-proxy/|scripts/systemd/gpio-companion\.service|package\.json|bun\.lock)' "$bin_rev"
		return
	fi
	return 1
}

rollback_gpio_companion_bin() {
	local backup="$BIN_DIR/gpio-companion.bak-previous"
	echo "gpio-companion update: gpio-companion.service not active after install; rolling back binary" >&2
	if ! gpio_companion_bin_healthy "$backup"; then
		echo "gpio-companion update: no healthy backup binary at $backup; manual recovery required" >&2
		return 1
	fi
	local staged="$BIN_DIR/.gpio-companion.rollback.$$"
	if ! cp -p "$backup" "$staged"; then
		rm -f "$staged"
		return 1
	fi
	if ! mv -f "$staged" "$BIN_DIR/gpio-companion"; then
		rm -f "$staged"
		return 1
	fi
	rm -f "$BIN_REV_FILE"
	if systemctl restart gpio-companion.service && wait_gpio_companion_active 20; then
		echo "gpio-companion update: rolled back to previous binary; next update will rebuild"
		return 0
	fi
	echo "gpio-companion update: rollback restart failed" >&2
	return 1
}

install_ble_gatt_script
adapter_script_before=""
adapter_unit_before=""
if [[ -f "$LIB_DIR/ble-adapter.sh" ]]; then
	adapter_script_before="$(cat "$LIB_DIR/ble-adapter.sh")"
fi
if [[ -f /etc/systemd/system/gpio-companion-ble-adapter.service ]]; then
	adapter_unit_before="$(cat /etc/systemd/system/gpio-companion-ble-adapter.service)"
fi
install_ble_adapter
adapter_changed=0
if [[ "$adapter_script_before" != "$(cat "$LIB_DIR/ble-adapter.sh")" ]]; then
	adapter_changed=1
fi
if [[ "$adapter_unit_before" != "$(cat /etc/systemd/system/gpio-companion-ble-adapter.service)" ]]; then
	adapter_changed=1
fi
install_gpio_host
install_arduino_proxy
install_gpiochip_udev
add_user_groups
install_storage_link
install_cleanup_units
install_wifi_keep_units
install_update_wrapper
write_repo_metadata
install_gpio_3d || echo "gpio-companion update: gpio-3d install failed" >&2
unit_before=""
if [[ -f /etc/systemd/system/gpio-companion.service ]]; then
	unit_before="$(cat /etc/systemd/system/gpio-companion.service)"
fi
write_gpio_companion_service "$(read_hardware)"
chown_gpio_config
unit_changed=0
if [[ "$unit_before" != "$(cat /etc/systemd/system/gpio-companion.service)" ]]; then
	unit_changed=1
fi

if server_needs_build; then
	if [[ "$FORCE" -eq 1 ]]; then
		echo "gpio-companion update: force rebuild"
	else
		echo "gpio-companion update: server changed, rebuilding ($bin_rev -> $after)"
	fi
	install_gpio_companion_bin
	if [[ -f "$SCRIPT_DIR/systemd/gpio-companion-update.service" ]]; then
		install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-update.service" /etc/systemd/system/gpio-companion-update.service
		install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-update.timer" /etc/systemd/system/gpio-companion-update.timer
	fi
	printf '%s\n' "$after" >"$BIN_REV_FILE"
	systemctl daemon-reload
	if [[ "$adapter_changed" -eq 1 ]]; then
		systemctl try-restart bluetooth.service || true
		systemctl restart gpio-companion-ble-adapter.service || true
	fi
	if systemctl restart gpio-companion.service && wait_gpio_companion_active 20; then
		echo "gpio-companion update: service active on new binary"
	else
		rollback_gpio_companion_bin || echo "gpio-companion update: rollback failed; board needs manual recovery" >&2
	fi
elif [[ "$unit_changed" -eq 1 || "$adapter_changed" -eq 1 ]]; then
	echo "gpio-companion update: gpio-companion.service user/unit changed, restarting"
	systemctl daemon-reload
	if [[ "$adapter_changed" -eq 1 ]]; then
		systemctl try-restart bluetooth.service || true
		systemctl restart gpio-companion-ble-adapter.service || true
	fi
	systemctl restart gpio-companion.service
elif paths_changed '^scripts/ble-gatt-server\.py$'; then
	echo "gpio-companion update: BLE GATT script changed, restarting"
	systemctl restart gpio-companion.service
elif [[ "$key_changed" -eq 1 ]]; then
	echo "gpio-companion update: restarting server for new device public key"
	systemctl restart gpio-companion.service
else
	echo "gpio-companion update: serve binary already at $after"
fi

if ! install_opencode_service; then
	echo "gpio-companion update: opencode service install skipped" >&2
fi

if ! update_opencode; then
	echo "gpio-companion update: opencode upgrade skipped" >&2
fi

write_opencode_ai_provider

sync_local_pairing_with_dashboard

OPENVIKING_VERSION="$(openviking_pinned_version)"
openviking_install_needed=1
if openviking_enabled && [[ "$(openviking_installed_version || true)" == "$OPENVIKING_VERSION" ]]; then
	openviking_install_needed=0
fi
if [[ "$openviking_install_needed" -eq 1 ]]; then
	echo "gpio-companion update: installing OpenViking memory server"
	if ! "/bin/bash" "$SCRIPT_DIR/setup-openviking.sh" --yes; then
		echo "gpio-companion update: openviking install failed; will retry next update" >&2
	fi
fi

if openviking_enabled; then
	write_openviking_ai_loopback
	write_opencode_openviking_plugin
	if paths_changed '^(opencode/memory/|scripts/openviking-seed)'; then
		if [[ -n "$CF_API_KEY" ]]; then
			echo "gpio-companion update: openviking reseed via Cloudflare API token"
			openviking_seed_with_cf_api_key "$CF_API_KEY" || echo "gpio-companion update: openviking reseed failed" >&2
		elif ! local_pairing_claimed; then
			echo "gpio-companion update: openviking reseed skipped (board is not paired; pass --cf-api-key to seed anyway)" >&2
		else
			echo "gpio-companion update: openviking seed data changed, reseeding"
			run_openviking_seed || echo "gpio-companion update: openviking reseed failed" >&2
		fi
	fi
fi

echo "gpio-companion update: done"
