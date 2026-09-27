# gpio-companion desktop

BLE-first companion for Windows, Linux, and macOS (Tauri 2). GitHub login uses the OpenAuthster public client with PKCE. The authorize redirect is a loopback `http://127.0.0.1:<port>/callback` (RFC 8252) so the browser does not hand the code to another desktop app. `gpio-companion-desktop://auth/callback` remains registered as a fallback if loopback bind fails. Pair and WiFi talk to `https://gpio-companion.com/api/mobile/*` with a Bearer token; the dashboard still signs Pi envelopes. Native GATT uses CoreBluetooth / WinRT / BlueZ.

Project, GitHub App Keys, and credits stay on the web dashboard.

```sh
cd apps/desktop
bun install
bun run typecheck
bun run tauri:dev
bun run tauri:build
```

Linux build deps:

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf libssl-dev libdbus-1-dev pkg-config
```

Without sudo, unpack GTK/WebKit/DBus `-dev` debs into `~/.local/opt/linux-dev`. AppImage also needs GTK/pixbuf **runtime** files there (`libgtk-3-0t64`, `libgtk-3-common`, `libgdk-pixbuf-2.0-0`). `bun run tauri:dev` / `tauri:build` add that pkg-config path automatically.

Add the signed-in user to the `bluetooth` group. Quit `bluetoothctl` while scanning.

OpenAuthster already allows `http://127.0.0.1` / `http://localhost` redirects for this public client. Keep `gpio-companion-desktop://auth/callback` on the client allowlist as fallback (GitHub already enabled). Same issuer as mobile: `https://auth.gpio-companion.com`.

## GitHub Release

Bump **both** `package.json` and `src-tauri/tauri.conf.json` to the same version (not `0.0.0`) on `main`. `.github/workflows/release-desktop.yml` then builds Windows / Linux / macOS and publishes [GitHub Releases](https://github.com/shpaw415/gpio-companion/releases) as `desktop-v<version>`. Reruns skip a version that already has a release. `workflow_dispatch` is available; unsigned macOS downloads may be quarantined until Apple signing is added. A non-empty `release-notes/v<version>.md` is the release body. A hyphen in the version marks a prerelease.
