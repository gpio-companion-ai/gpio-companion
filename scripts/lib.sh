#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GPIO_USER="${GPIO_USER:-${SUDO_USER:-root}}"
CONFIG_DIR="${GPIO_COMPANION_CONFIG_DIR:-/etc/gpio-companion}"
BIN_DIR="${GPIO_COMPANION_BIN_DIR:-/usr/local/bin}"
LIB_DIR="${GPIO_COMPANION_LIB_DIR:-/usr/local/lib/gpio-companion}"
DEFAULT_DASHBOARD_URL="https://gpio-companion.com"

die() {
	echo "gpio-companion install: $*" >&2
	exit 1
}

need_root() {
	if [[ "$(id -u)" -ne 0 ]]; then
		die "run as root (sudo)"
	fi
}

gpio_user_exists() {
	local user="${1:-}"
	if [[ -z "$user" ]]; then
		return 1
	fi
	getent passwd "$user" >/dev/null 2>&1
}

guess_gpio_runtime_user() {
	local login="" guessed=""
	if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]] && gpio_user_exists "$SUDO_USER"; then
		printf '%s\n' "$SUDO_USER"
		return
	fi
	if [[ "$(id -u)" -ne 0 ]]; then
		printf '%s\n' "$(id -un)"
		return
	fi
	login="$(logname 2>/dev/null || true)"
	if [[ -n "$login" && "$login" != "root" ]] && gpio_user_exists "$login"; then
		printf '%s\n' "$login"
		return
	fi
	guessed="$(
		getent passwd 2>/dev/null | awk -F: '$3 >= 1000 && $3 < 60000 && $6 ~ /^\/home\// { print $1; exit }'
	)"
	if [[ -n "$guessed" ]] && gpio_user_exists "$guessed"; then
		printf '%s\n' "$guessed"
		return
	fi
	printf '%s\n' "root"
}

resolve_gpio_runtime_user() {
	if [[ -n "${GPIO_USER:-}" && "$GPIO_USER" != "root" ]]; then
		if gpio_user_exists "$GPIO_USER"; then
			export GPIO_USER
			return 0
		fi
		die "GPIO_USER $GPIO_USER does not exist"
	fi
	GPIO_USER="$(guess_gpio_runtime_user)"
	export GPIO_USER
}

chown_gpio_config() {
	if [[ -z "${GPIO_USER:-}" || "$GPIO_USER" == "root" ]]; then
		return 0
	fi
	if [[ ! -d "$CONFIG_DIR" ]]; then
		return 0
	fi
	chown -R "$GPIO_USER:$GPIO_USER" "$CONFIG_DIR" 2>/dev/null || true
}

ensure_root() {
	if [[ "$(id -u)" -eq 0 ]]; then
		return 0
	fi
	if ! command -v sudo >/dev/null 2>&1; then
		die "run as root (sudo)"
	fi
	local self
	self="$(readlink -f "$0" 2>/dev/null || true)"
	if [[ -z "$self" || ! -e "$self" ]]; then
		self="$0"
	fi
	exec sudo -n -- "$self" "$@"
}

apt_update() {
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -y
}

apt_install() {
	export DEBIAN_FRONTEND=noninteractive
	apt-get install -y --no-install-recommends "$@"
}

apt_install_optional() {
	local pkg
	for pkg in "$@"; do
		if apt-cache show "$pkg" >/dev/null 2>&1; then
			apt_install "$pkg" || true
		fi
	done
}

linux_arch() {
	dpkg --print-architecture
}

cloudflared_deb_arch() {
	case "$(linux_arch)" in
	amd64) echo amd64 ;;
	arm64) echo arm64 ;;
	armhf) echo arm ;;
	*) die "unsupported architecture: $(linux_arch)" ;;
	esac
}

install_apt_base() {
	apt_update
	apt_install \
		ca-certificates \
		curl \
		git \
		zip \
		unzip \
		build-essential \
		python3 \
		python3-dev \
		python3-setuptools \
		python3-pip \
		python3-venv \
		python3-serial \
		pkg-config \
		gpiod \
		libgpiod-dev \
		python3-libgpiod \
		avrdude \
		gcc-avr \
		avr-libc \
		dfu-util \
		libusb-1.0-0-dev \
		picocom \
		usbutils \
		udev \
		dosfstools \
		bluez \
		python3-dbus \
		python3-gi \
		network-manager
	systemctl enable --now NetworkManager.service || true
	ensure_networkmanager_wifi
	apt_install_optional exfatprogs exfat-fuse ntfs-3g libpam-systemd dbus-user-session
}

ensure_networkmanager_wifi() {
	local conf_dir="${GPIO_COMPANION_NM_CONF_D:-/etc/NetworkManager/conf.d}"
	local drop_in="${conf_dir}/90-gpio-companion-wifi.conf"
	local netplan_dir="${GPIO_COMPANION_NETPLAN_DIR:-/etc/netplan}"
	local netplan_bak="${GPIO_COMPANION_NETPLAN_BAK:-/etc/gpio-companion/netplan.bak}"
	local line dev type state rest file base moved=0

	mkdir -p "$conf_dir"
	cat >"$drop_in" <<'EOF'
[ifupdown]
managed=true

[device]
wifi.scan-rand-mac-address=no

[connection]
wifi.powersave=2
EOF
	chmod 0644 "$drop_in"

	if [[ -d "$netplan_dir" && -w "$netplan_dir" ]]; then
		mkdir -p "$netplan_bak"
		shopt -s nullglob
		for file in "$netplan_dir"/*.yaml "$netplan_dir"/*.yml; do
			base="$(basename "$file")"
			[[ "$base" == 90-gpio-companion-wifi.yaml ]] && continue
			if grep -qE '^[[:space:]]*wifis:' "$file" && ! grep -qE '^[[:space:]]*ethernets:' "$file"; then
				mv "$file" "$netplan_bak/$base"
				moved=1
			fi
		done
		shopt -u nullglob
		cat >"$netplan_dir/90-gpio-companion-wifi.yaml" <<'EOF'
network:
  version: 2
  wifis:
    renderer: NetworkManager
EOF
		chmod 0600 "$netplan_dir/90-gpio-companion-wifi.yaml"
		netplan generate >/dev/null 2>&1 || true
		netplan apply >/dev/null 2>&1 || true
	fi
	systemctl stop 'netplan-wpa-wlan0.service' >/dev/null 2>&1 || true
	systemctl disable 'netplan-wpa-wlan0.service' >/dev/null 2>&1 || true

	systemctl enable --now NetworkManager.service 2>/dev/null || true
	if command -v rfkill >/dev/null 2>&1; then
		rfkill unblock wifi 2>/dev/null || true
		rfkill unblock wlan 2>/dev/null || true
	fi
	if ! command -v nmcli >/dev/null 2>&1; then
		echo "gpio-companion: nmcli missing, wifi unmanaged fix skipped"
		return 0
	fi
	nmcli networking on >/dev/null 2>&1 || true
	nmcli radio wifi on >/dev/null 2>&1 || true
	nmcli general reload >/dev/null 2>&1 || true
	claim_nm_wifi_devices
	if [[ "$moved" -eq 1 ]] || nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null | grep -q ':wifi:un\(managed\|available\)'; then
		systemctl restart NetworkManager.service >/dev/null 2>&1 || true
		nmcli networking on >/dev/null 2>&1 || true
		nmcli radio wifi on >/dev/null 2>&1 || true
		claim_nm_wifi_devices
	fi
	persist_nm_wifi_connections
	echo "gpio-companion: NetworkManager wifi managed"
}

claim_nm_wifi_devices() {
	local line dev type state rest
	while IFS= read -r line; do
		[[ -n "$line" ]] || continue
		dev="${line%%:*}"
		rest="${line#*:}"
		type="${rest%%:*}"
		state="${rest#*:}"
		state="${state%%:*}"
		if [[ "$type" == "wifi" && ( "$state" == "unmanaged" || "$state" == "unavailable" ) ]]; then
			nmcli device set "$dev" managed yes >/dev/null 2>&1 || true
		fi
	done < <(nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null || true)
}

persist_nm_wifi_connections() {
	local line name type
	while IFS= read -r line; do
		[[ -n "$line" ]] || continue
		name="${line%%:*}"
		type="${line#*:}"
		type="${type%%:*}"
		if [[ "$type" == "802-11-wireless" ]]; then
			nmcli connection modify "$name" \
				connection.autoconnect yes \
				connection.autoconnect-retries -1 \
				802-11-wireless.powersave 2 >/dev/null 2>&1 || true
		fi
	done < <(nmcli -t -f NAME,TYPE connection show 2>/dev/null || true)
}

install_node() {
	if command -v node >/dev/null 2>&1; then
		return
	fi
	curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
	apt_install nodejs
}

install_bun() {
	if [[ -x "$BIN_DIR/bun" ]]; then
		return
	fi
	curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
	if [[ -x /usr/local/bin/bun ]]; then
		return
	fi
	if [[ -x /usr/local/bun-linux-*/bun ]]; then
		install -m 0755 /usr/local/bun-linux-*/bun "$BIN_DIR/bun"
	fi
	command -v bun >/dev/null || die "bun install failed"
}

install_node_gyp() {
	npm install -g node-gyp
}

install_cloudflared() {
	if command -v cloudflared >/dev/null 2>&1; then
		return
	fi
	local deb arch
	arch="$(cloudflared_deb_arch)"
	deb="/tmp/cloudflared-linux-${arch}.deb"
	curl -fsSL -o "$deb" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb"
	dpkg -i "$deb"
	rm -f "$deb"
}

install_arduino_cli() {
	if command -v arduino-cli >/dev/null 2>&1; then
		return
	fi
	curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR="$BIN_DIR" sh
}

install_opencode() {
	if [[ "$GPIO_USER" == "root" ]]; then
		curl -fsSL https://opencode.ai/install | bash
	else
		sudo -u "$GPIO_USER" bash -lc 'curl -fsSL https://opencode.ai/install | bash'
	fi
	link_opencode_bin || true
}

opencode_bin() {
	local home bin
	home="$(gpio_user_home)"
	bin="$home/.opencode/bin/opencode"
	if [[ -x "$bin" ]]; then
		printf '%s\n' "$bin"
		return 0
	fi
	command -v opencode 2>/dev/null
}

opencode_version_file() {
	printf '%s\n' "$(gpio_user_home)/.opencode/version"
}

opencode_wrapper_bin() {
	printf '%s\n' "${GPIO_COMPANION_BIN_DIR:-$BIN_DIR}/opencode"
}

cache_opencode_version() {
	local real dest version
	real="$(opencode_bin || true)"
	dest="$(opencode_version_file)"
	if [[ -z "$real" || ! -x "$real" ]]; then
		return 1
	fi
	install -d -m 0755 "$(dirname "$dest")"
	if [[ -s "$dest" && "$dest" -nt "$real" ]]; then
		return 0
	fi
	if command -v timeout >/dev/null 2>&1; then
		version="$(timeout 60 "$real" --version 2>/dev/null | head -n1 || true)"
	else
		version="$("$real" --version 2>/dev/null | head -n1 || true)"
	fi
	version="${version//$'\r'/}"
	if [[ -z "$version" ]]; then
		return 1
	fi
	printf '%s\n' "$version" >"$dest"
	if [[ "$GPIO_USER" != "root" ]]; then
		chown "$GPIO_USER:$GPIO_USER" "$dest" 2>/dev/null || true
	fi
}

link_opencode_bin() {
	local bin dest bindir version_file
	bin="$(opencode_bin || true)"
	if [[ -z "$bin" ]]; then
		return 1
	fi
	bindir="${GPIO_COMPANION_BIN_DIR:-$BIN_DIR}"
	dest="${bindir}/opencode"
	version_file="$(opencode_version_file)"
	if [[ "$bin" == "$dest" ]]; then
		return 0
	fi
	if [[ ! -d "$bindir" ]]; then
		return 1
	fi
	cache_opencode_version || true
	if [[ -L "$dest" ]]; then
		rm -f "$dest"
	fi
	cat >"$dest" <<EOF
#!/bin/sh
REAL='$bin'
VERSION_FILE='$version_file'
case "\${1-}" in
--version|-v|version)
	if [ -s "\$VERSION_FILE" ]; then
		cat "\$VERSION_FILE"
		exit 0
	fi
	;;
esac
exec "\$REAL" "\$@"
EOF
	chmod 0755 "$dest"
}

update_opencode() {
	local bin
	echo "gpio-companion update: opencode upgrade"
	bin="$(opencode_bin || true)"
	if [[ -z "$bin" ]]; then
		echo "gpio-companion update: opencode not found, skipping upgrade" >&2
		return 1
	fi
	if [[ "$GPIO_USER" == "root" || "$(id -u)" -eq "$(gpio_user_uid)" ]]; then
		"$bin" upgrade
	else
		sudo -u "$GPIO_USER" -H "$bin" upgrade
	fi
	link_opencode_bin || true
	if [[ -f "$(opencode_user_unit_path)" ]]; then
		restart_opencode_service || true
		reap_leaked_opencode_servers || true
	fi
}

opencode_server_env_path() {
	printf '%s\n' "${GPIO_COMPANION_OPENCODE_SERVER_ENV:-$CONFIG_DIR/opencode-server.env}"
}

opencode_user_unit_path() {
	printf '%s\n' "$(gpio_user_home)/.config/systemd/user/gpio-opencode.service"
}

ensure_opencode_server_password() {
	local dest existing
	dest="$(opencode_server_env_path)"
	install -d -m 0755 "$(dirname "$dest")"
	if [[ -f "$dest" ]]; then
		existing="$(sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' "$dest" | tail -n1)"
		if [[ -n "$existing" ]]; then
			chmod 600 "$dest"
			if [[ "$GPIO_USER" != "root" ]]; then
				chown "$GPIO_USER:$GPIO_USER" "$dest" 2>/dev/null || true
			fi
			return 0
		fi
	fi
	rotate_opencode_server_password
}

rotate_opencode_server_password() {
	local dest password
	dest="$(opencode_server_env_path)"
	install -d -m 0755 "$(dirname "$dest")"
	if command -v openssl >/dev/null 2>&1; then
		password="$(openssl rand -hex 32)"
	else
		password="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
	fi
	umask 077
	cat >"$dest" <<EOF
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=$password
EOF
	chmod 600 "$dest"
	if [[ "$GPIO_USER" != "root" ]]; then
		chown "$GPIO_USER:$GPIO_USER" "$dest" 2>/dev/null || true
	fi
}

install_opencode_service() {
	local home unit_dir unit bin dest projects
	bin="$(opencode_wrapper_bin)"
	if [[ ! -x "$bin" ]]; then
		bin="$(opencode_bin || true)"
	fi
	if [[ -z "$bin" || ! -x "$bin" ]]; then
		echo "gpio-companion: opencode binary missing, skipping service" >&2
		return 1
	fi
	ensure_opencode_server_password
	if ! ensure_user_systemd; then
		echo "gpio-companion: skipping opencode service install (systemd user manager unreachable)" >&2
		return 1
	fi
	home="$(gpio_user_home)"
	projects="$home/projects"
	install -d -m 0755 "$projects"
	unit_dir="$home/.config/systemd/user"
	unit="$unit_dir/gpio-opencode.service"
	install -d -m 0755 "$unit_dir"
	dest="$(mktemp)"
	sed \
		-e "s|__OPENCODE_BIN__|$bin|g" \
		-e "s|__OPENCODE_SERVER_ENV__|$(opencode_server_env_path)|g" \
		"$SCRIPT_DIR/systemd/gpio-opencode.service" >"$dest"
	install -m 0644 "$dest" "$unit"
	rm -f "$dest"
	if [[ "$GPIO_USER" != "root" ]]; then
		chown -R "$GPIO_USER:$GPIO_USER" "$home/.config" "$projects" 2>/dev/null || true
	fi
	run_as_gpio_user_session systemctl --user daemon-reload
	run_as_gpio_user_session systemctl --user enable --now gpio-opencode.service
}

restart_opencode_service() {
	local unit
	if [[ "${GPIO_COMPANION_OPENCODE_SKIP_RESTART:-}" == "1" ]]; then
		return 0
	fi
	unit="$(opencode_user_unit_path)"
	if [[ ! -f "$unit" ]]; then
		return 0
	fi
	if ! command -v systemctl >/dev/null 2>&1; then
		return 0
	fi
	if ! ensure_user_systemd; then
		echo "gpio-companion: skipping opencode restart (systemd user manager unreachable)" >&2
		return 0
	fi
	run_as_gpio_user_session systemctl --user restart gpio-opencode.service
}

reap_leaked_opencode_servers() {
	local uid main pgid pid this
	if [[ "${GPIO_COMPANION_OPENCODE_SKIP_RESTART:-}" == "1" ]]; then
		return 0
	fi
	uid="$(gpio_user_uid)" || return 0
	if [[ -z "$uid" ]]; then
		return 0
	fi
	main="$(run_as_gpio_user_session systemctl --user show -p MainPID --value gpio-opencode.service 2>/dev/null || true)"
	if [[ -z "$main" || "$main" == "0" ]]; then
		return 0
	fi
	pgid="$(ps -o pgid= -p "$main" 2>/dev/null | tr -d '[:space:]')" || true
	while read -r pid; do
		if [[ -z "$pid" || "$pid" == "$main" ]]; then
			continue
		fi
		if [[ -n "$pgid" ]]; then
			this="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]')" || true
			if [[ "$this" == "$pgid" ]]; then
				continue
			fi
		fi
		echo "gpio-companion update: stopping leaked opencode pid $pid" >&2
		kill "$pid" 2>/dev/null || true
	done < <(pgrep -u "$uid" -f 'opencode serve --hostname 127.0.0.1 --port 4096' || true)
}

gpio_user_home() {
	if [[ -n "${GPIO_COMPANION_HOME:-}" ]]; then
		printf '%s\n' "$GPIO_COMPANION_HOME"
		return
	fi
	if [[ "$GPIO_USER" == "root" ]]; then
		printf '%s\n' "/root"
		return
	fi
	printf '%s\n' "/home/$GPIO_USER"
}

gpio_user_uid() {
	id -u "$GPIO_USER" 2>/dev/null || true
}

gpio_user_runtime_dir() {
	local uid
	uid="$(gpio_user_uid)"
	if [[ -z "$uid" ]]; then
		return 1
	fi
	printf '%s\n' "/run/user/${uid}"
}

ensure_user_systemd() {
	local uid runtime attempts n=0
	if [[ "${GPIO_COMPANION_T3_SKIP_RESTART:-}" == "1" ]]; then
		return 0
	fi
	uid="$(gpio_user_uid)"
	if [[ -z "$uid" ]]; then
		echo "gpio-companion: cannot resolve uid for $GPIO_USER" >&2
		return 1
	fi
	runtime="/run/user/${uid}"
	if command -v loginctl >/dev/null 2>&1; then
		loginctl enable-linger "$GPIO_USER" || true
	fi
	if command -v systemctl >/dev/null 2>&1; then
		systemctl start "user@${uid}.service" || true
	fi
	attempts="${GPIO_COMPANION_T3_USER_WAIT_ATTEMPTS:-20}"
	if [[ "$attempts" -le 0 ]]; then
		return 0
	fi
	while [[ "$n" -lt "$attempts" ]]; do
		if [[ -S "${runtime}/bus" || -S "${runtime}/systemd/private" ]]; then
			return 0
		fi
		sleep 0.25
		n=$((n + 1))
	done
	echo "gpio-companion: systemd user manager unavailable for $GPIO_USER (no ${runtime}/bus)" >&2
	return 1
}

run_as_gpio_user_session() {
	local uid runtime home workdir
	uid="$(gpio_user_uid)"
	if [[ -z "$uid" ]]; then
		return 1
	fi
	runtime="/run/user/${uid}"
	home="$(gpio_user_home)"
	if [[ ! -d "$home" ]]; then
		home="/tmp"
	fi
	if [[ "$GPIO_USER" == "root" || "$(id -u)" -eq "$uid" ]]; then
		workdir="."
		if [[ ! -w . ]]; then
			if [[ -w "$home" ]]; then
				workdir="$home"
			else
				workdir="/tmp"
			fi
		fi
		(
			cd "$workdir"
			XDG_RUNTIME_DIR="$runtime" \
				DBUS_SESSION_BUS_ADDRESS="unix:path=${runtime}/bus" \
				"$@"
		)
		return
	fi
	sudo -u "$GPIO_USER" -H env \
		-u SUDO_USER -u SUDO_UID -u SUDO_GID -u SUDO_COMMAND \
		"XDG_RUNTIME_DIR=${runtime}" \
		"DBUS_SESSION_BUS_ADDRESS=unix:path=${runtime}/bus" \
		bash -c 'cd "$1" && shift && exec "$@"' bash "$home" "$@"
}

install_arduino_udev() {
	cat >/etc/udev/rules.d/99-gpio-companion-arduino.rules <<'EOF'
SUBSYSTEM=="tty", ATTRS{idVendor}=="2341", GROUP="dialout", MODE="0660"
SUBSYSTEM=="usb", ATTRS{idVendor}=="2341", GROUP="dialout", MODE="0660"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", GROUP="dialout", MODE="0660"
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", GROUP="dialout", MODE="0660"
EOF
	udevadm control --reload-rules || true
}

ensure_gpio_group() {
	if getent group gpio >/dev/null 2>&1; then
		return 0
	fi
	groupadd --system gpio || true
}

install_gpiochip_udev() {
	local udev_dir="${GPIO_COMPANION_UDEV_DIR:-/etc/udev/rules.d}"
	ensure_gpio_group
	install -d -m 0755 "$udev_dir"
	install -m 0644 "$SCRIPT_DIR/udev/99-gpio-companion-gpiochip.rules" "$udev_dir/99-gpio-companion-gpiochip.rules"
	if [[ "${GPIO_COMPANION_SKIP_UDEV:-}" == "1" ]]; then
		return 0
	fi
	udevadm control --reload-rules || true
	udevadm trigger --subsystem-match=gpio --action=change || true
	chgrp gpio /dev/gpiochip* 2>/dev/null || true
	chmod 0660 /dev/gpiochip* 2>/dev/null || true
}

install_storage_link() {
	install -d -m 0755 "$LIB_DIR"
	install -m 0755 "$SCRIPT_DIR/storage-link.sh" "$LIB_DIR/storage-link.sh"
	install -d -m 0755 /etc/udev/rules.d
	install -m 0644 "$SCRIPT_DIR/udev/99-gpio-companion-storage.rules" /etc/udev/rules.d/99-gpio-companion-storage.rules
	install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-storage@.service" /etc/systemd/system/gpio-companion-storage@.service
	udevadm control --reload-rules || true
	udevadm trigger --subsystem-match=block --action=add || true
	systemctl daemon-reload || true
}

add_user_groups() {
	local group
	if [[ "$GPIO_USER" == "root" ]]; then
		return
	fi
	for group in dialout plugdev gpio i2c spi bluetooth netdev adm systemd-journal; do
		if getent group "$group" >/dev/null; then
			usermod -aG "$group" "$GPIO_USER" || true
		fi
	done
}

grant_gpio_user_nopasswd_sudo() {
	local user="${GPIO_USER:-}"
	local dest_dir="${GPIO_COMPANION_SUDOERS_D:-/etc/sudoers.d}"
	local dest tmp

	if [[ -z "$user" || "$user" == "root" ]]; then
		return 0
	fi
	if [[ ! "$user" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
		die "invalid GPIO_USER for sudoers: $user"
	fi
	if ! getent passwd "$user" >/dev/null 2>&1; then
		die "GPIO_USER $user does not exist"
	fi
	if ! command -v visudo >/dev/null 2>&1; then
		die "visudo is required to grant passwordless sudo"
	fi

	install -d -m 0755 "$dest_dir"
	dest="${dest_dir}/gpio-companion"
	tmp="$(mktemp)"
	cat >"$tmp" <<EOF
Defaults:${user} !requiretty
${user} ALL=(ALL:ALL) NOPASSWD: ALL
EOF
	chmod 0440 "$tmp"
	if ! visudo -c -f "$tmp" >/dev/null 2>&1; then
		rm -f "$tmp"
		die "sudoers fragment failed visudo for $user"
	fi
	install -m 0440 "$tmp" "$dest"
	rm -f "$tmp"
	if [[ "$dest_dir" == "/etc/sudoers.d" ]] && ! visudo -c >/dev/null 2>&1; then
		rm -f "$dest"
		die "sudoers invalid after writing $dest"
	fi
	echo "gpio-companion: passwordless sudo granted to $user"
}

git_in() {
	local root="$1"
	shift
	git -c "safe.directory=${root}" -C "$root" "$@"
}

chown_managed_checkout() {
	local root="${1:-$REPO_ROOT}"
	if [[ -z "${GPIO_USER:-}" || "$GPIO_USER" == "root" ]]; then
		return 0
	fi
	if [[ ! -d "$root" ]]; then
		return 0
	fi
	chown -R "$GPIO_USER:$GPIO_USER" "$root" 2>/dev/null || true
}

write_repo_metadata() {
	install -d -m 0755 "$CONFIG_DIR"
	printf "%s\n" "$REPO_ROOT" >"$CONFIG_DIR/repo.path"
	local branch
	branch="$(git_in "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
	if [[ -z "$branch" || "$branch" == "HEAD" ]]; then
		branch="main"
	fi
	printf "%s\n" "$branch" >"$CONFIG_DIR/branch"
	cat >"$CONFIG_DIR/update.env" <<EOF
GPIO_USER=$GPIO_USER
GPIO_COMPANION_CONFIG_DIR=$CONFIG_DIR
GPIO_COMPANION_BIN_DIR=$BIN_DIR
GPIO_COMPANION_DASHBOARD_URL=$(dashboard_url)
EOF
	chown_gpio_config
}

git_dir_for() {
	local root="${1:-$REPO_ROOT}" gitdir
	gitdir="$(git_in "$root" rev-parse --git-dir 2>/dev/null || true)"
	if [[ -z "$gitdir" && -d "$root/.git" ]]; then
		gitdir="$root/.git"
	fi
	if [[ -z "$gitdir" ]]; then
		return 1
	fi
	if [[ "$gitdir" != /* ]]; then
		gitdir="$root/$gitdir"
	fi
	printf '%s' "$gitdir"
}

origin_url_for() {
	local root="${1:-$REPO_ROOT}" gitdir
	git_in "$root" remote get-url origin 2>/dev/null && return 0
	gitdir="$(git_dir_for "$root")" || return 1
	git config --file "$gitdir/config" --get remote.origin.url
}

prune_empty_git_objects() {
	local root="${1:-$REPO_ROOT}" gitdir objects f base
	gitdir="$(git_dir_for "$root")" || return 0
	objects="$gitdir/objects"
	if [[ ! -d "$objects" ]]; then
		mkdir -p "$objects/info" "$objects/pack"
		return 0
	fi
	while IFS= read -r -d '' f; do
		rm -f "$f"
		if [[ "$f" == *.pack || "$f" == *.idx ]]; then
			base="${f%.pack}"
			base="${base%.idx}"
			rm -f "${base}.pack" "${base}.idx"
		fi
	done < <(find "$objects" -type f -empty -print0 2>/dev/null || true)
}

git_checkout_corrupt() {
	local root="${1:-$REPO_ROOT}" gitdir objects
	gitdir="$(git_dir_for "$root")" || return 0
	objects="$gitdir/objects"
	if [[ ! -d "$objects" ]]; then
		return 0
	fi
	if [[ -n "$(find "$objects" -type f -empty -print -quit 2>/dev/null)" ]]; then
		return 0
	fi
	if ! git_in "$root" rev-parse --verify HEAD >/dev/null 2>&1; then
		return 0
	fi
	if ! git_in "$root" cat-file -e HEAD^{commit} >/dev/null 2>&1; then
		return 0
	fi
	return 1
}

configure_lowmem_git() {
	local root="${1:-$REPO_ROOT}"
	git_in "$root" config --local pack.windowMemory 32m 2>/dev/null || true
	git_in "$root" config --local pack.threads 1 2>/dev/null || true
	git_in "$root" config --local pack.deltaCacheSize 16m 2>/dev/null || true
}

fetch_managed_checkout() {
	local root="$1" branch="$2"
	configure_lowmem_git "$root"
	git_in "$root" fetch --depth 1 origin "$branch"
}

reset_managed_checkout() {
	local root="$1" branch="$2"
	if git_in "$root" rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
		git_in "$root" reset --hard "origin/$branch"
	elif git_in "$root" rev-parse --verify FETCH_HEAD >/dev/null 2>&1; then
		git_in "$root" reset --hard FETCH_HEAD
	else
		return 1
	fi
}

reclone_managed_checkout() {
	local root="$1" branch="$2" url parent tmp
	url="$(origin_url_for "$root")"
	parent="$(dirname "$root")"
	tmp="$(mktemp -d "$parent/.gpio-companion-reclone.XXXXXX")"
	if ! git clone --depth 1 --branch "$branch" "$url" "$tmp/repo"; then
		rm -rf "$tmp"
		return 1
	fi
	rm -rf "$root/.git"
	mv "$tmp/repo/.git" "$root/.git"
	rm -rf "$tmp"
	chown_managed_checkout "$root"
	configure_lowmem_git "$root"
	reset_managed_checkout "$root" "$branch"
	chown_managed_checkout "$root"
}

sync_managed_checkout() {
	local root="${1:-$REPO_ROOT}" branch="${2:-main}" attempt
	if [[ -z "$(origin_url_for "$root" 2>/dev/null || true)" ]]; then
		echo "gpio-companion update: no origin remote, skipping pull" >&2
		return 0
	fi
	if git_checkout_corrupt "$root"; then
		echo "gpio-companion update: git corruption detected, repairing" >&2
	fi
	prune_empty_git_objects "$root"
	configure_lowmem_git "$root"
	attempt=0
	while [[ "$attempt" -lt 2 ]]; do
		attempt=$((attempt + 1))
		if fetch_managed_checkout "$root" "$branch" && reset_managed_checkout "$root" "$branch"; then
			chown_managed_checkout "$root"
			return 0
		fi
		echo "gpio-companion update: fetch failed, repairing git objects" >&2
		prune_empty_git_objects "$root"
	done
	echo "gpio-companion update: fetch failed after repair, recloning" >&2
	if reclone_managed_checkout "$root" "$branch"; then
		return 0
	fi
	echo "gpio-companion update: fetch failed, using current tree" >&2
	if git_checkout_corrupt "$root"; then
		echo "gpio-companion update: git still corrupt" >&2
		return 1
	fi
	chown_managed_checkout "$root"
	return 0
}

dashboard_url() {
	local origin="${GPIO_COMPANION_DASHBOARD_URL:-$DEFAULT_DASHBOARD_URL}"
	origin="${origin%/}"
	printf '%s' "$origin"
}

pairing_uuid() {
	local uuid="${GPIO_COMPANION_PAIRING_UUID:-}"
	if [[ -f "$CONFIG_DIR/pairing.env" ]]; then
		# shellcheck disable=SC1091
		source "$CONFIG_DIR/pairing.env"
		uuid="${GPIO_COMPANION_PAIRING_UUID:-$uuid}"
	fi
	if [[ -z "$uuid" && -f "${GPIO_COMPANION_PAIRING:-$CONFIG_DIR/pairing.json}" ]]; then
		uuid="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("uuid") or "")' "${GPIO_COMPANION_PAIRING:-$CONFIG_DIR/pairing.json}" 2>/dev/null || true)"
	fi
	printf '%s' "$uuid"
}

local_pairing_claimed() {
	local path="${GPIO_COMPANION_PAIRING:-$CONFIG_DIR/pairing.json}"
	if [[ ! -f "$path" ]]; then
		return 1
	fi
	python3 -c 'import json,sys; raise SystemExit(0 if json.load(open(sys.argv[1])).get("claimed") else 1)' "$path" 2>/dev/null
}

sync_local_pairing_with_dashboard() {
	local uuid raw paired
	uuid="$(pairing_uuid)"
	if [[ -z "$uuid" ]]; then
		return 0
	fi
	raw="$(
		curl -fsS --max-time 15 "$(dashboard_url)/api/device/paired?uuid=$(
			UUID="$uuid" python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.environ["UUID"]))'
		)" 2>/dev/null
	)" || {
		echo "gpio-companion update: dashboard pairing check failed" >&2
		return 0
	}
	paired="$(
		raw="$raw" python3 -c 'import json, os; print("1" if json.loads(os.environ["raw"]).get("paired") else "0")' 2>/dev/null || echo x
	)"
	if [[ "$paired" != "0" ]]; then
		return 0
	fi
	if ! local_pairing_claimed; then
		echo "gpio-companion update: dashboard unpaired"
		return 0
	fi
	echo "gpio-companion update: dashboard has no claim, unpairing locally"
	if [[ -x "$SCRIPT_DIR/unpair.sh" ]]; then
		"$SCRIPT_DIR/unpair.sh"
	else
		echo "gpio-companion update: unpair.sh missing" >&2
	fi
}

device_auth_path() {
	printf '%s' "${GPIO_COMPANION_DEVICE_AUTH:-$CONFIG_DIR/device-auth.json}"
}

write_device_auth_json() {
	local src="$1" dest="$2"
	python3 - "$src" "$dest" <<'PY'
import json, os, sys
src, dest = sys.argv[1], sys.argv[2]
with open(src, encoding="utf-8") as handle:
    data = json.load(handle)
key_id = data.get("keyId")
pem = data.get("publicKeyPem")
if not isinstance(key_id, str) or not key_id.strip():
    raise SystemExit(2)
if not isinstance(pem, str) or "BEGIN PUBLIC KEY" not in pem:
    raise SystemExit(2)
pem = pem.strip() + "\n"
out = {"keyId": key_id.strip(), "publicKeyPem": pem}
tmp = f"{dest}.tmp"
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(out, handle, indent="\t")
    handle.write("\n")
os.replace(tmp, dest)
PY
}

fetch_device_public_key() {
	local url dest tmp
	url="$(dashboard_url)/api/device-public-key"
	dest="$(device_auth_path)"
	install -d -m 0755 "$CONFIG_DIR"
	tmp="$(mktemp)"
	if ! curl -fsS --max-time 30 "$url" -o "$tmp"; then
		rm -f "$tmp"
		return 1
	fi
	if ! write_device_auth_json "$tmp" "$dest"; then
		rm -f "$tmp"
		return 2
	fi
	rm -f "$tmp"
	chmod 644 "$dest"
	chown_gpio_config
	return 0
}

register_device_public_key() {
	local url
	url="$(dashboard_url)/api/device-public-key"
	echo "fetching device public key from $url"
	if ! fetch_device_public_key; then
		die "failed to fetch device public key from $url"
	fi
	if command -v systemctl >/dev/null; then
		systemctl restart gpio-companion.service || true
	fi
}

refresh_device_public_key() {
	local dest before after url
	url="$(dashboard_url)/api/device-public-key"
	dest="$(device_auth_path)"
	before=""
	if [[ -f "$dest" ]]; then
		before="$(cat "$dest")"
	fi
	if ! fetch_device_public_key; then
		echo "gpio-companion update: device public key fetch failed, keeping current" >&2
		return 1
	fi
	after="$(cat "$dest")"
	if [[ "$before" == "$after" ]]; then
		echo "gpio-companion update: device public key unchanged"
		return 1
	fi
	echo "gpio-companion update: device public key updated from $url"
	return 0
}

opencode_home() {
	if [[ -n "${GPIO_COMPANION_OPENCODE_HOME:-}" ]]; then
		printf '%s\n' "$GPIO_COMPANION_OPENCODE_HOME"
		return
	fi
	if [[ "$GPIO_USER" == "root" ]]; then
		echo "/root/.config/opencode"
	else
		echo "/home/$GPIO_USER/.config/opencode"
	fi
}

sync_opencode_agent() {
	local dest
	dest="$(opencode_home)"
	install -d -m 0755 "$dest"
	rm -rf "$dest/skills" "$dest/preferences"
	cp -a "$REPO_ROOT/opencode/skills" "$dest/skills"
	cp -a "$REPO_ROOT/opencode/preferences" "$dest/preferences"
	if [[ "$GPIO_USER" != "root" ]]; then
		chown -R "$GPIO_USER:$GPIO_USER" "$dest"
	fi
}

read_hardware() {
	if [[ -f "$CONFIG_DIR/config.json" ]] && command -v python3 >/dev/null; then
		python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("hardware","raspberrypi"))' "$CONFIG_DIR/config.json"
	else
		echo raspberrypi
	fi
}

write_device_config() {
	local hardware="$1"
	install -d -m 0755 "$CONFIG_DIR"
	if [[ ! -f "$CONFIG_DIR/config.json" ]]; then
		cat >"$CONFIG_DIR/config.json" <<EOF
{
	"hardware": "$hardware",
	"tunnel": {
		"token": "",
		"hostname": "",
		"apiHostname": "",
		"tunnelId": ""
	}
}
EOF
	fi
	if [[ ! -f "$CONFIG_DIR/cloudflared.env" ]]; then
		printf "TUNNEL_TOKEN=''\nTUNNEL_HOSTNAME=''\nTUNNEL_API_HOSTNAME=''\nTUNNEL_ID=''\n" >"$CONFIG_DIR/cloudflared.env"
		chmod 600 "$CONFIG_DIR/cloudflared.env"
	fi
	chown_gpio_config
}

write_pairing_env() {
	install -d -m 0755 "$CONFIG_DIR"
	if [[ -f "$CONFIG_DIR/pairing.env" ]]; then
		# shellcheck disable=SC1091
		source "$CONFIG_DIR/pairing.env"
		chown_gpio_config
		echo "pairing UUID: ${GPIO_COMPANION_PAIRING_UUID:-}"
		echo "pairing key:  ${GPIO_COMPANION_PAIRING_KEY:-}"
		return
	fi
	local uuid key
	uuid="${GPIO_COMPANION_PAIRING_UUID:-}"
	key="${GPIO_COMPANION_PAIRING_KEY:-}"
	if [[ -z "$uuid" || -z "$key" ]]; then
		eval "$(python3 - <<'PY'
import secrets, uuid
print(f"uuid={uuid.uuid4()}")
print(f"key={secrets.token_urlsafe(24)}")
PY
)"
	fi
	umask 077
	cat >"$CONFIG_DIR/pairing.env" <<EOF
GPIO_COMPANION_PAIRING_UUID=$uuid
GPIO_COMPANION_PAIRING_KEY=$key
EOF
	chmod 600 "$CONFIG_DIR/pairing.env"
	chown_gpio_config
	echo "pairing UUID: $uuid"
	echo "pairing key:  $key"
	echo "enter these on the dashboard /pair page to bind this board to your account"
}

apply_runtime_config() {
	local hardware="$1" token="$2" hostname="$3" api_hostname="${4:-}" tunnel_id="${5:-}"
	install -d -m 0755 "$CONFIG_DIR"
	GPIO_COMPANION_CONFIG_DIR="$CONFIG_DIR" HARDWARE="$hardware" TUNNEL_TOKEN="$token" TUNNEL_HOSTNAME="$hostname" TUNNEL_API_HOSTNAME="$api_hostname" TUNNEL_ID="$tunnel_id" python3 - <<'PY'
import json, os
from pathlib import Path
config_dir = Path(os.environ.get("GPIO_COMPANION_CONFIG_DIR", "/etc/gpio-companion"))
config = {
	"hardware": os.environ["HARDWARE"],
	"tunnel": {
		"token": os.environ.get("TUNNEL_TOKEN", ""),
		"hostname": os.environ.get("TUNNEL_HOSTNAME", ""),
		"apiHostname": os.environ.get("TUNNEL_API_HOSTNAME", ""),
		"tunnelId": os.environ.get("TUNNEL_ID", ""),
	},
}
(config_dir / "config.json").write_text(json.dumps(config, indent="\t") + "\n")
def env_value(value: str) -> str:
	return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
(config_dir / "cloudflared.env").write_text(
	f"TUNNEL_TOKEN={env_value(config['tunnel']['token'])}\n"
	f"TUNNEL_HOSTNAME={env_value(config['tunnel']['hostname'])}\n"
	f"TUNNEL_API_HOSTNAME={env_value(config['tunnel']['apiHostname'])}\n"
	f"TUNNEL_ID={env_value(config['tunnel']['tunnelId'])}\n"
)
PY
	chmod 600 "$CONFIG_DIR/cloudflared.env"
	chown_gpio_config
	if [[ -n "$token" ]] && command -v systemctl >/dev/null; then
		systemctl enable --now cloudflared-gpio.service || true
		systemctl restart cloudflared-gpio.service || true
	fi
}

create_cloudflare_tunnel() {
	local uuid="$1" api_token="$2" account_id="$3" zone_id="$4"
	local output
	output="$(
		CLOUDFLARE_API_TOKEN="$api_token" python3 "$SCRIPT_DIR/create-cloudflare-tunnel.py" \
			--account-id "$account_id" \
			--zone-id "$zone_id" \
			--uuid "$uuid"
	)"
	printf '%s\n' "$output"
}

write_secrets_file() {
	local ai_key="$1" github_user="$2" github_token="$3"
	install -d -m 0755 "$CONFIG_DIR"
	umask 077
	cat >"$CONFIG_DIR/secrets.env" <<EOF
GPIO_AI_KEY=$ai_key
GITHUB_URL=https://github.com
GITHUB_USERNAME=$github_user
GITHUB_TOKEN=$github_token
EOF
	chmod 600 "$CONFIG_DIR/secrets.env"
	chown_gpio_config
}

ensure_gpio_ai_key() {
	install -d -m 0755 "$CONFIG_DIR"
	local existing=""
	if [[ -f "$CONFIG_DIR/secrets.env" ]]; then
		existing="$(sed -n 's/^GPIO_AI_KEY=//p' "$CONFIG_DIR/secrets.env" | tail -n1)"
	fi
	if [[ -n "$existing" ]]; then
		printf '%s' "$existing"
		return
	fi
	local key
	key="$(openssl rand -hex 32)"
	if [[ -f "$CONFIG_DIR/secrets.env" ]]; then
		if grep -q '^GPIO_AI_KEY=' "$CONFIG_DIR/secrets.env"; then
			sed -i "s/^GPIO_AI_KEY=.*/GPIO_AI_KEY=$key/" "$CONFIG_DIR/secrets.env"
		else
			printf 'GPIO_AI_KEY=%s\n' "$key" >>"$CONFIG_DIR/secrets.env"
		fi
	else
		write_secrets_file "$key" "" ""
	fi
	chmod 600 "$CONFIG_DIR/secrets.env"
	chown_gpio_config
	printf '%s' "$key"
}

gpio_ai_loopback_url() {
	local port="${GPIO_COMPANION_PORT:-4150}"
	echo "${GPIO_COMPANION_AI_LOOPBACK:-http://127.0.0.1:${port}/v1/ai}"
}

write_opencode_ai_provider() {
	local dest base catalog result
	dest="$(opencode_home)"
	base="$(gpio_ai_loopback_url)"
	install -d -m 0755 "$dest"
	command -v bun >/dev/null 2>&1 || die "bun is required to write OpenCode AI models"
	catalog="$(
		cd "$REPO_ROOT" && bun -e 'import { DEFAULT_AI_MODEL, opencodeProviderModels } from "./packages/core/src/ai-pricing.ts";
process.stdout.write(JSON.stringify({ defaultModel: DEFAULT_AI_MODEL, models: opencodeProviderModels() }))'
	)" || die "failed to load OpenCode AI models"
	result="$(
		GPIO_AI_URL="$base" GPIO_OPENCODE_JSON="$dest/opencode.json" GPIO_OPENCODE_CATALOG="$catalog" python3 - <<'PY'
import json, os
from pathlib import Path
path = Path(os.environ["GPIO_OPENCODE_JSON"])
catalog = json.loads(os.environ["GPIO_OPENCODE_CATALOG"])
data = {}
if path.exists():
    try:
        loaded = json.loads(path.read_text())
        if isinstance(loaded, dict):
            data = loaded
    except json.JSONDecodeError:
        data = {}
provider = data.get("provider")
if not isinstance(provider, dict):
    provider = {}
    data["provider"] = provider
provider["gpio-companion"] = {
    "npm": "@ai-sdk/openai-compatible",
    "name": "gpio-companion",
    "options": {
        "baseURL": os.environ["GPIO_AI_URL"],
        "apiKey": "local",
    },
    "models": catalog["models"],
}
default_model = f"gpio-companion/{catalog['defaultModel']}"
if not data.get("model"):
    data["model"] = default_model
text = json.dumps(data, indent="\t") + "\n"
if path.exists() and path.read_text() == text:
    print("unchanged")
else:
    path.write_text(text)
    print("changed")
PY
	)"
	if [[ "$GPIO_USER" != "root" ]]; then
		chown -R "$GPIO_USER:$GPIO_USER" "$dest"
	fi
	if [[ "$result" == "changed" ]]; then
		echo "gpio-companion: OpenCode gpio-companion models refreshed"
		restart_opencode_service || true
	fi
}

write_openviking_ai_loopback() {
	local home conf
	if [[ "$GPIO_USER" == "root" ]]; then
		home="/root"
	else
		home="/home/$GPIO_USER"
	fi
	conf="$home/.openviking/ov.conf"
	[[ -f "$conf" ]] || return 0
	GPIO_AI_URL="$(gpio_ai_loopback_url)" GPIO_OV_CONF="$conf" python3 - <<'PY'
import json, os
from pathlib import Path
path = Path(os.environ["GPIO_OV_CONF"])
try:
	data = json.loads(path.read_text())
except (json.JSONDecodeError, OSError):
	raise SystemExit(0)
if not isinstance(data, dict):
	raise SystemExit(0)
base = os.environ["GPIO_AI_URL"]
changed = False
for section in ("embedding", "vlm"):
	block = data.get(section)
	if not isinstance(block, dict):
		continue
	targets = [block]
	dense = block.get("dense")
	if isinstance(dense, dict):
		targets.append(dense)
	for target in targets:
		if "api_base" not in target and "api_key" not in target:
			continue
		if target.get("api_base") != base or target.get("api_key") != "local":
			target["api_base"] = base
			target["api_key"] = "local"
			changed = True
if changed:
	path.write_text(json.dumps(data, indent="\t") + "\n")
	path.chmod(0o600)
	print("changed")
else:
	print("unchanged")
PY
	if [[ "$GPIO_USER" != "root" ]]; then
		chown "$GPIO_USER:$GPIO_USER" "$conf" 2>/dev/null || true
	fi
}

GPIO_COMPANION_OPENVIKING_DEFAULT_VERSION="0.4.21"

openviking_pinned_version() {
	echo "${GPIO_COMPANION_OPENVIKING_VERSION:-$GPIO_COMPANION_OPENVIKING_DEFAULT_VERSION}"
}

openviking_installed_version() {
	local venv
	venv="$(openviking_venv_dir)"
	[[ -x "$venv/bin/pip" ]] || return 1
	"$venv/bin/pip" show openviking 2>/dev/null | awk '/^Version:/ {print $2}'
}

openviking_venv_dir() {
	echo "${GPIO_COMPANION_OPENVIKING_VENV:-$LIB_DIR/openviking}"
}

set_openviking_flag() {
	local value="$1"
	[[ -f "$CONFIG_DIR/config.json" ]] || return 0
	CONFIG_DIR="$CONFIG_DIR" VALUE="$value" python3 - <<'PY'
import json, os
from pathlib import Path
config_dir = Path(os.environ["CONFIG_DIR"])
path = config_dir / "config.json"
try:
    data = json.loads(path.read_text())
except (json.JSONDecodeError, OSError):
    data = {}
if not isinstance(data, dict):
    data = {}
data["openviking"] = os.environ["VALUE"] == "true"
path.write_text(json.dumps(data, indent="\t") + "\n")
PY
}

openviking_enabled() {
	[[ -x "$(openviking_venv_dir)/bin/openviking-server" ]] || return 1
	[[ -f "$CONFIG_DIR/config.json" ]] || return 1
	python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("openviking") is True else 1)' "$CONFIG_DIR/config.json"
}

run_as_gpio_user() {
	if [[ "$GPIO_USER" == "root" ]]; then
		"$@"
	else
		sudo -H -u "$GPIO_USER" "$@"
	fi
}

run_openviking_seed() {
	local venv_bin
	venv_bin="$(openviking_venv_dir)/bin"
	if [[ ! -x "$venv_bin/ov" ]]; then
		echo "gpio-companion openviking: ov CLI missing, skipping seed" >&2
		return 1
	fi
	if ! command -v bun >/dev/null 2>&1; then
		echo "gpio-companion openviking: bun missing, skipping seed" >&2
		return 1
	fi
	run_as_gpio_user env \
		OPENVIKING_OV_BIN="$venv_bin/ov" \
		OPENVIKING_SEED_SKIP_EMBED_CHECK="${OPENVIKING_SEED_SKIP_EMBED_CHECK:-}" \
		bun "$SCRIPT_DIR/openviking-seed.ts"
}

openviking_conf_path() {
	printf '%s\n' "$(gpio_user_home)/.openviking/ov.conf"
}

wait_openviking_healthy() {
	local port="${GPIO_COMPANION_OPENVIKING_PORT:-1933}" i
	for i in $(seq 1 120); do
		if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
	done
	return 1
}

cf_account_id_for_token() {
	local key="$1" account body
	account="${GPIO_COMPANION_CF_ACCOUNT_ID:-}"
	if [[ -n "$account" ]]; then
		printf '%s\n' "$account"
		return 0
	fi
	body="$(
		curl -fsS --max-time 20 \
			-H "Authorization: Bearer ${key}" \
			-H "content-type: application/json" \
			"https://api.cloudflare.com/client/v4/accounts" 2>/dev/null
	)" || {
		echo "gpio-companion openviking: Cloudflare account list failed; set GPIO_COMPANION_CF_ACCOUNT_ID" >&2
		return 1
	}
	account="$(
		BODY="$body" python3 - <<'PY'
import json, os, sys
data = json.loads(os.environ["BODY"])
rows = data.get("result") or []
ids = [row.get("id") for row in rows if row.get("id")]
if len(ids) == 1:
    print(ids[0])
    raise SystemExit(0)
print("gpio-companion openviking: Cloudflare token sees %s accounts; set GPIO_COMPANION_CF_ACCOUNT_ID" % len(ids), file=sys.stderr)
raise SystemExit(1)
PY
	)" || return 1
	printf '%s\n' "$account"
}

openviking_embedding_model() {
	local conf
	conf="$(openviking_conf_path)"
	python3 - "$conf" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
dense = (data.get("embedding") or {}).get("dense") or {}
print(dense.get("model") or "@cf/qwen/qwen3-embedding-0.6b")
PY
}

apply_openviking_cf_embed() {
	local base="$1" key="$2" conf
	conf="$(openviking_conf_path)"
	GPIO_OV_CONF="$conf" GPIO_AI_URL="$base" GPIO_AI_KEY="$key" python3 - <<'PY'
import json, os
from pathlib import Path
path = Path(os.environ["GPIO_OV_CONF"])
data = json.loads(path.read_text())
base = os.environ["GPIO_AI_URL"]
key = os.environ["GPIO_AI_KEY"]
for section in ("embedding", "vlm"):
    block = data.get(section)
    if not isinstance(block, dict):
        continue
    targets = [block]
    dense = block.get("dense")
    if isinstance(dense, dict):
        targets.append(dense)
    for target in targets:
        if "api_base" not in target and "api_key" not in target:
            continue
        target["api_base"] = base
        target["api_key"] = key
path.write_text(json.dumps(data, indent="\t") + "\n")
path.chmod(0o600)
PY
	if [[ "$GPIO_USER" != "root" ]]; then
		chown "$GPIO_USER:$GPIO_USER" "$conf"
	fi
}

restore_openviking_loopback() {
	write_openviking_ai_loopback >/dev/null
	systemctl restart gpio-companion-openviking.service || true
}

openviking_seed_with_cf_api_key() {
	local key="$1" account base model status=0 body code
	account="$(cf_account_id_for_token "$key")" || return 1
	base="https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1"
	model="$(openviking_embedding_model)" || return 1
	body="$(mktemp)"
	code="$(
		curl -sS --max-time 30 -o "$body" -w "%{http_code}" \
			-H "Authorization: Bearer ${key}" \
			-H "content-type: application/json" \
			-d "$(MODEL="$model" python3 -c 'import json,os; print(json.dumps({"model": os.environ["MODEL"], "input": "ping"}))')" \
			"${base}/embeddings" || true
	)"
	if [[ "$code" != "200" ]]; then
		echo "gpio-companion openviking: Cloudflare embeddings rejected (HTTP ${code})" >&2
		python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text()[:400])' "$body" >&2 || true
		rm -f "$body"
		return 1
	fi
	rm -f "$body"
	apply_openviking_cf_embed "$base" "$key"
	if ! systemctl restart gpio-companion-openviking.service; then
		restore_openviking_loopback
		return 1
	fi
	if ! wait_openviking_healthy; then
		echo "gpio-companion openviking: server did not become healthy with Cloudflare embeddings" >&2
		journalctl -u gpio-companion-openviking.service -n 40 --no-pager >&2 || true
		restore_openviking_loopback
		return 1
	fi
	OPENVIKING_SEED_SKIP_EMBED_CHECK=1 run_openviking_seed || status=$?
	restore_openviking_loopback
	wait_openviking_healthy || true
	return "$status"
}

write_opencode_openviking_plugin() {
	local dest
	dest="$(opencode_home)"
	install -d -m 0755 "$dest"
	GPIO_OPENCODE_JSON="$dest/opencode.json" python3 - <<'PY'
import json, os
from pathlib import Path
path = Path(os.environ["GPIO_OPENCODE_JSON"])
data = {}
if path.exists():
    try:
        loaded = json.loads(path.read_text())
        if isinstance(loaded, dict):
            data = loaded
    except json.JSONDecodeError:
        data = {}
plugins = data.get("plugin")
if not isinstance(plugins, list):
    plugins = []
if "@openviking/opencode-plugin" not in plugins:
    plugins.append("@openviking/opencode-plugin")
data["plugin"] = plugins
path.write_text(json.dumps(data, indent="\t") + "\n")
PY
	# autoRecall stays off: the plugin still injects its once-per-session
	# session-start block (profile + archive); per-turn recall blocks are
	# unwanted noise on the Code page console.
	local behavior="$dest/openviking-config.json"
	GPIO_OPENVIKING_CONFIG="$behavior" python3 - <<'PY'
import json, os
from pathlib import Path
path = Path(os.environ["GPIO_OPENVIKING_CONFIG"])
data = {
	"enabled": True,
	"timeoutMs": 30000,
	"repoContext": {"enabled": True, "cacheTtlMs": 60000},
	"autoRecall": {"enabled": False},
	"commitTokenThreshold": 20000,
	"commitKeepRecentCount": 10,
	"profileTokenBudget": 10000,
	"resumeContextBudget": 32000,
}
if path.exists():
	try:
		loaded = json.loads(path.read_text())
		if isinstance(loaded, dict):
			data = loaded
	except json.JSONDecodeError:
		pass
data["autoRecall"] = {"enabled": False}
path.write_text(json.dumps(data, indent="\t") + "\n")
PY
	if [[ "$GPIO_USER" != "root" ]]; then
		chown -R "$GPIO_USER:$GPIO_USER" "$dest"
	fi
}

gpio_companion_bin_healthy() {
	local bin="$1"
	if [[ -x "$bin" ]] && "$bin" --version >/dev/null 2>&1; then
		return 0
	fi
	return 1
}

gpio_build_mem_available() {
	local min_kb="${GPIO_COMPANION_BUILD_MIN_MEM_KB:-921600}"
	local avail_kb="0"
	avail_kb="$(awk '/^MemAvailable:/{print $2; exit}' /proc/meminfo 2>/dev/null || echo 0)"
	if [[ "${avail_kb:-0}" -ge "$min_kb" ]]; then
		return 0
	fi
	return 1
}

swap_gpio_companion_bin() {
	local src="$1"
	local staged="$BIN_DIR/.gpio-companion.new.$$"
	local backup="$BIN_DIR/gpio-companion.bak-previous"
	local backup_staged="$BIN_DIR/.gpio-companion.bak.$$"
	rm -f "$staged" "$backup_staged"
	if ! install -m 0755 "$src" "$staged"; then
		rm -f "$staged"
		die "gpio-companion update: staging new binary failed"
	fi
	if ! "$staged" --version >/dev/null 2>&1; then
		rm -f "$staged"
		die "gpio-companion update: new binary failed --version smoke test; refusing to install"
	fi
	if gpio_companion_bin_healthy "$BIN_DIR/gpio-companion"; then
		if ! cp -p "$BIN_DIR/gpio-companion" "$backup_staged"; then
			rm -f "$staged" "$backup_staged"
			die "gpio-companion update: could not back up the current binary"
		fi
		mv -f "$backup_staged" "$backup"
	fi
	if ! mv -f "$staged" "$BIN_DIR/gpio-companion"; then
		rm -f "$staged"
		die "gpio-companion update: atomic binary swap failed"
	fi
	echo "gpio-companion update: installed $(stat -c %s "$BIN_DIR/gpio-companion") bytes (backup: $backup)"
}

wait_gpio_companion_active() {
	local tries="${1:-20}"
	local i
	for ((i = 0; i < tries; i++)); do
		if [[ "$(systemctl is-active gpio-companion.service 2>/dev/null || true)" == "active" ]]; then
			return 0
		fi
		sleep 1
	done
	return 1
}

install_gpio_companion_bin() {
	local src=""
	local can_build=0
	if command -v bun >/dev/null 2>&1; then
		if gpio_build_mem_available; then
			can_build=1
		else
			echo "gpio-companion update: low MemAvailable, skipping on-device compile (GPIO_COMPANION_BUILD_MIN_MEM_KB to override)" >&2
		fi
	fi
	if [[ "$can_build" -eq 1 ]]; then
		echo "gpio-companion update: compiling serve binary"
		(cd "$REPO_ROOT" && bun install)
		(cd "$REPO_ROOT/binary/gpio-companion" && bun run compile)
		src="$REPO_ROOT/binary/gpio-companion/dist/gpio-companion"
	elif [[ -x "$REPO_ROOT/binary/gpio-companion/dist/gpio-companion-linux-arm64" ]]; then
		src="$REPO_ROOT/binary/gpio-companion/dist/gpio-companion-linux-arm64"
	elif [[ -x "$REPO_ROOT/binary/gpio-companion/dist/gpio-companion" ]]; then
		src="$REPO_ROOT/binary/gpio-companion/dist/gpio-companion"
	else
		die "gpio-companion binary missing and bun is not installed"
	fi
	if [[ ! -x "$src" ]]; then
		die "gpio-companion binary was not built"
	fi
	swap_gpio_companion_bin "$src"
	install_ble_gatt_script
	install_gpio_pwm
	install_gpio_host
	install_arduino_proxy
	install_github_git_helper
	install_gpio_jlcpcb
}

install_gpio_jlcpcb() {
	cat >"$BIN_DIR/gpio-jlcpcb" <<'EOF'
#!/bin/sh
set -eu
CONFIG_DIR="${GPIO_COMPANION_CONFIG_DIR:-/etc/gpio-companion}"
REPO="$(cat "$CONFIG_DIR/repo.path")"
exec bun "$REPO/binary/gpio-jlcpcb/src/index.ts" "$@"
EOF
	chmod 0755 "$BIN_DIR/gpio-jlcpcb"
}

install_gpio_3d_wrapper() {
	local venv="${GPIO_COMPANION_GPIO_3D_VENV:-$LIB_DIR/gpio-3d}"
	cat >"$BIN_DIR/gpio-3d" <<EOF
#!/bin/sh
set -eu
CONFIG_DIR="\${GPIO_COMPANION_CONFIG_DIR:-/etc/gpio-companion}"
VENV="\${GPIO_COMPANION_GPIO_3D_VENV:-$venv}"
REPO="\$(cat "\$CONFIG_DIR/repo.path")"
export PYTHONPATH="\$REPO/native/gpio-3d\${PYTHONPATH:+:\$PYTHONPATH}"
exec "\$VENV/bin/python" -m gpio_3d "\$@"
EOF
	chmod 0755 "$BIN_DIR/gpio-3d"
}

install_gpio_3d() {
	local req="$REPO_ROOT/native/gpio-3d/requirements.txt"
	local venv="${GPIO_COMPANION_GPIO_3D_VENV:-$LIB_DIR/gpio-3d}"
	local stamp="$venv/.requirements.sha256"
	local arch free need=200 hash
	if [[ ! -f "$req" ]]; then
		echo "gpio-3d: requirements missing, skipping" >&2
		return 0
	fi
	arch="$(dpkg --print-architecture 2>/dev/null || uname -m)"
	case "$arch" in
	armhf|armv7l|armv6l)
		echo "gpio-3d: skipping on $arch (no wheel; will not compile)" >&2
		return 0
		;;
	esac
	hash="$(sha256sum "$req" | awk '{print $1}')"
	if [[ -x "$venv/bin/python" && -f "$stamp" && "$(cat "$stamp")" == "$hash" ]]; then
		if "$venv/bin/python" -c "import trimesh, numpy, manifold3d" >/dev/null 2>&1; then
			echo "gpio-3d: wheels unchanged"
			install_gpio_3d_wrapper
			return 0
		fi
	fi
	free="$(df -Pm / | awk 'NR==2 {print $4}')"
	if [[ "$free" -lt "$need" ]]; then
		if [[ -x "$venv/bin/python" ]] && "$venv/bin/python" -c "import trimesh, numpy, manifold3d" >/dev/null 2>&1; then
			echo "gpio-3d: refusing upgrade, ${free}MB free on / (need ${need}MB)" >&2
			install_gpio_3d_wrapper
			return 0
		fi
		echo "gpio-3d: refusing install, ${free}MB free on / (need ${need}MB)" >&2
		return 1
	fi
	if ! command -v python3 >/dev/null 2>&1; then
		echo "gpio-3d: python3 missing" >&2
		return 1
	fi
	install -d -m 0755 "$(dirname "$venv")"
	if [[ ! -x "$venv/bin/python" ]]; then
		if ! python3 -m venv "$venv"; then
			echo "gpio-3d: venv failed" >&2
			return 1
		fi
	fi
	echo "gpio-3d: installing wheels"
	if ! "$venv/bin/pip" install --no-cache-dir --only-binary=:all: -r "$req"; then
		echo "gpio-3d: wheel install failed" >&2
		return 1
	fi
	if ! "$venv/bin/python" -c "import trimesh, numpy, manifold3d"; then
		echo "gpio-3d: import failed after install" >&2
		return 1
	fi
	printf '%s\n' "$hash" >"$stamp"
	install_gpio_3d_wrapper
}

install_gpio_pwm() {
	local src="$REPO_ROOT/native/gpio-pwm"
	if [[ ! -f "$src/gpio-pwm.c" ]]; then
		return 0
	fi
	if ! command -v gcc >/dev/null 2>&1; then
		echo "gpio-companion update: gcc missing, skipping gpio-pwm" >&2
		return 0
	fi
	echo "gpio-companion update: compiling gpio-pwm"
	make -C "$src" clean all
	install -d -m 0755 "$LIB_DIR"
	install -m 0755 "$src/gpio-pwm" "$LIB_DIR/gpio-pwm"
}

install_gpio_host() {
	local src="$REPO_ROOT/native/gpio-host"
	if [[ ! -f "$src/arduino.c" ]]; then
		return 0
	fi
	echo "gpio-companion update: installing gpio-host"
	install -d -m 0755 "$LIB_DIR/gpio-host"
	install -m 0644 "$src/Arduino.h" "$LIB_DIR/gpio-host/Arduino.h"
	install -m 0644 "$src/gpio-host.h" "$LIB_DIR/gpio-host/gpio-host.h"
	install -m 0644 "$src/arduino.c" "$LIB_DIR/gpio-host/arduino.c"
	if [[ -f "$src/arduino-proxy.c" ]]; then
		install -m 0644 "$src/arduino-proxy.c" "$LIB_DIR/gpio-host/arduino-proxy.c"
	fi
	install -m 0644 "$src/main.c" "$LIB_DIR/gpio-host/main.c"
}

install_arduino_proxy() {
	local src="$REPO_ROOT/native/arduino-proxy"
	if [[ ! -f "$src/arduino-proxy.ino" ]]; then
		return 0
	fi
	echo "gpio-companion update: installing arduino-proxy firmware"
	install -d -m 0755 "$LIB_DIR/arduino-proxy"
	install -m 0644 "$src/arduino-proxy.ino" "$LIB_DIR/arduino-proxy/arduino-proxy.ino"
}

install_ble_gatt_script() {
	install -d -m 0755 "$LIB_DIR"
	install -m 0755 "$REPO_ROOT/scripts/ble-gatt-server.py" "$LIB_DIR/ble-gatt-server.py"
}

install_bluetooth_controller_mode() {
	local conf="${GPIO_COMPANION_BLUETOOTH_CONF:-/etc/bluetooth/main.conf}"
	if [[ ! -f "$conf" ]]; then
		return 0
	fi
	if grep -qE '^ControllerMode[[:space:]]*=' "$conf"; then
		sed -i 's/^ControllerMode[[:space:]]*=.*/ControllerMode = le/' "$conf"
	elif grep -qE '^#ControllerMode[[:space:]]*=' "$conf"; then
		sed -i 's/^#ControllerMode[[:space:]]*=.*/ControllerMode = le/' "$conf"
	else
		printf '\nControllerMode = le\n' >>"$conf"
	fi
}

install_ble_adapter() {
	install -d -m 0755 "$LIB_DIR"
	install -m 0755 "$REPO_ROOT/scripts/ble-adapter.sh" "$LIB_DIR/ble-adapter.sh"
	install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-ble-adapter.service" /etc/systemd/system/gpio-companion-ble-adapter.service
	install_bluetooth_controller_mode
}

install_github_git_helper() {
	cat >/etc/gitconfig <<EOF
[credential "https://github.com"]
	helper = !/usr/local/bin/gpio-companion git-credential
EOF
	chmod 644 /etc/gitconfig
}

write_update_wrapper() {
	local dest="$1"
	local extra="${2:-}"
	cat >"$dest" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [[ "\$(id -u)" -ne 0 ]]; then
	exec sudo -n -- "\$0" "\$@"
fi
CONFIG_DIR="\${GPIO_COMPANION_CONFIG_DIR:-/etc/gpio-companion}"
REPO="\$(cat "\$CONFIG_DIR/repo.path")"
exec /bin/bash "\$REPO/scripts/update-script.sh"${extra:+ $extra} "\$@"
EOF
	chmod 0755 "$dest"
}

install_update_wrapper() {
	local sbin="${GPIO_COMPANION_SBIN_DIR:-/usr/local/sbin}"
	local bin="${GPIO_COMPANION_BIN_DIR:-/usr/local/bin}"
	install -d -m 0755 "$sbin" "$bin"
	write_update_wrapper "$sbin/gpio-companion-update"
	write_update_wrapper "$sbin/gpio-companion-force-update" "--force"
	ln -sfn "$sbin/gpio-companion-update" "$bin/gpio-companion-update"
	ln -sfn "$sbin/gpio-companion-force-update" "$bin/gpio-companion-force-update"
}

install_cleanup_wrapper() {
	install -d -m 0755 /usr/local/sbin
	cat >/usr/local/sbin/gpio-companion-cleanup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
CONFIG_DIR="${GPIO_COMPANION_CONFIG_DIR:-/etc/gpio-companion}"
REPO="$(cat "$CONFIG_DIR/repo.path")"
exec /bin/bash "$REPO/scripts/cleanup-script.sh" "$@"
EOF
	chmod 0755 /usr/local/sbin/gpio-companion-cleanup
}

install_journald_retention() {
	local dest_dir="${GPIO_COMPANION_JOURNALD_DIR:-/etc/systemd/journald.conf.d}"
	local dest="$dest_dir/zz-gpio-companion.conf"
	local previous=""
	install -d -m 0755 "$dest_dir"
	rm -f "$dest_dir/gpio-companion.conf" "$dest_dir/99-gpio-companion.conf"
	if [[ -f "$dest" ]]; then
		previous="$(cat "$dest")"
	fi
	cat >"$dest" <<'EOF'
[Journal]
MaxRetentionSec=1day
SystemMaxUse=64M
RuntimeMaxUse=32M
ForwardToSyslog=no
RateLimitIntervalSec=30s
RateLimitBurst=1000
EOF
	chmod 0644 "$dest"
	if [[ "$dest_dir" != "/etc/systemd/journald.conf.d" ]]; then
		return 0
	fi
	if [[ "$previous" != "$(cat "$dest")" ]]; then
		systemctl restart systemd-journald.service || true
	fi
}

install_cleanup_units() {
	install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-cleanup.service" /etc/systemd/system/gpio-companion-cleanup.service
	install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-cleanup.timer" /etc/systemd/system/gpio-companion-cleanup.timer
	install_cleanup_wrapper
	install_journald_retention
	systemctl daemon-reload
	systemctl enable --now gpio-companion-cleanup.timer
}

install_wifi_keep_units() {
	install -d -m 0755 "$LIB_DIR"
	install -m 0755 "$SCRIPT_DIR/wifi-keep.sh" "$LIB_DIR/wifi-keep.sh"
	install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-wifi.service" /etc/systemd/system/gpio-companion-wifi.service
	install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-wifi.timer" /etc/systemd/system/gpio-companion-wifi.timer
	systemctl daemon-reload
	systemctl enable --now gpio-companion-wifi.timer
}

write_gpio_companion_service() {
	local hardware="$1"
	local dest="${GPIO_COMPANION_SERVICE_UNIT:-/etc/systemd/system/gpio-companion.service}"
	local tmp
	if [[ -z "$hardware" ]]; then
		hardware="$(read_hardware)"
	fi
	tmp="$(mktemp)"
	install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion.service" "$tmp"
	sed -i "s/^Environment=GPIO_COMPANION_HARDWARE=.*/Environment=GPIO_COMPANION_HARDWARE=$hardware/" "$tmp"
	sed -i "s|__GPIO_USER__|$GPIO_USER|g" "$tmp"
	install -d -m 0755 "$(dirname "$dest")"
	install -m 0644 "$tmp" "$dest"
	rm -f "$tmp"
}

install_systemd_units() {
	local hardware="$1"
	write_gpio_companion_service "$hardware"
	install_ble_adapter
	install -m 0644 "$SCRIPT_DIR/systemd/cloudflared-gpio.service" /etc/systemd/system/cloudflared-gpio.service
	install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-update.service" /etc/systemd/system/gpio-companion-update.service
	install -m 0644 "$SCRIPT_DIR/systemd/gpio-companion-update.timer" /etc/systemd/system/gpio-companion-update.timer
	install_update_wrapper
	install_cleanup_units
	install_wifi_keep_units
	chown_gpio_config
	systemctl daemon-reload
	systemctl enable --now gpio-companion.service
	systemctl enable --now gpio-companion-update.timer
	systemctl disable cloudflared-gpio.service || true
}

install_common() {
	local hardware="$1"
	need_root
	resolve_gpio_runtime_user
	install_apt_base
	install_node
	install_bun
	install_node_gyp
	install_cloudflared
	install_arduino_cli
	install_arduino_udev
	install_gpiochip_udev
	install_storage_link
	add_user_groups
	grant_gpio_user_nopasswd_sudo
	install_opencode
	install_opencode_service
	write_device_config "$hardware"
	write_pairing_env
	write_repo_metadata
	install_gpio_companion_bin
	install_gpio_3d
	sync_opencode_agent
	install_systemd_units "$hardware"
	echo "gpio-companion $hardware install complete"
	echo "OpenCode server is a GPIO user unit on 127.0.0.1:4096"
}
