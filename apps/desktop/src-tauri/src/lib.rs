mod api;
mod auth;
mod ble;
#[cfg(target_os = "linux")]
mod bluez;
mod config;
mod frames;
mod log;
mod offline_keys;
mod tokens;
mod wifi;

use api::request_value;
use auth::AuthFlow;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Serialize, Deserialize)]
struct DeviceList {
	paired: bool,
	devices: Vec<Device>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Device {
	uuid: String,
	#[serde(rename = "deviceUrl")]
	device_url: String,
	login: String,
	label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Session {
	id: Option<String>,
	email: Option<String>,
	name: Option<String>,
	role: Option<String>,
}

fn emit_status(app: &AppHandle, message: &str) {
	let _ = app.emit("ble-status", message);
}

#[tauri::command]
async fn auth_token() -> Option<String> {
	if tokens::load().is_none() {
		return None;
	}
	if let Err(err) = auth::refresh_access().await {
		log::line(&format!("auth refresh: {err}"));
		match err {
			auth::RefreshError::Rejected(_) => {
				// The issuer rejected the refresh token — a clean sign-out.
				tokens::clear();
				return None;
			}
			auth::RefreshError::Transient(_) => {
				// Offline or flaky network: keep the stored tokens and try
				// the (possibly stale) access token; the 401 path self-heals.
			}
		}
	}
	tokens::load()
		.map(|tokens| tokens.access)
		.filter(|token| !token.is_empty())
}

#[tauri::command]
fn debug_logs() -> Vec<String> {
	log::snapshot()
}

#[tauri::command]
async fn auth_session() -> Result<Session, String> {
	log::line("auth session");
	api::request(Method::GET, "/api/mobile/session", None::<&Value>).await
}

fn enable_talk_microphone(app: &AppHandle) {
	let Some(window) = app.get_webview_window("main") else {
		return;
	};
	let _ = window.with_webview(|webview| {
		#[cfg(target_os = "linux")]
		{
			use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
			let webview = webview.inner();
			if let Some(settings) = webview.settings() {
				settings.set_enable_media_stream(true);
				settings.set_enable_webrtc(true);
			}
			webview.connect_permission_request(|_, request| {
				request.allow();
				true
			});
		}
		#[cfg(not(target_os = "linux"))]
		{
			let _ = webview;
		}
	});
}

fn focus_main(app: &AppHandle) {
	if let Some(window) = app.get_webview_window("main") {
		let _ = window.unminimize();
		let _ = window.show();
		let _ = window.set_focus();
	}
}

fn log_deep_link(href: &str) {
	if let Ok(url) = url::Url::parse(href) {
		log::line(&format!(
			"deep link {}://{}{}",
			url.scheme(),
			url.host_str().unwrap_or(""),
			url.path()
		));
	} else {
		log::line("deep link unparsed");
	}
}

async fn complete_login(
	app: &AppHandle,
	verifier: &str,
	state: &str,
	callback: &str,
	redirect_uri: &str,
) -> Result<(), String> {
	auth::exchange_code(callback, verifier, state, redirect_uri).await?;
	focus_main(app);
	log::line("auth login ok");
	Ok(())
}

#[tauri::command]
async fn auth_login(app: AppHandle, flow: State<'_, AuthFlow>) -> Result<(), String> {
	log::line("auth login start");
	let (verifier, state) = auth::new_pkce();
	match tokio::net::TcpListener::bind("127.0.0.1:0").await {
		Ok(listener) => {
			let port = listener
				.local_addr()
				.map_err(|err| format!("auth loopback addr: {err}"))?
				.port();
			let redirect_uri = auth::loopback_redirect_uri(port);
			log::line(&format!("auth loopback {redirect_uri}"));
			let url = auth::authorize_url(&verifier, &state, &redirect_uri);
			app.opener()
				.open_url(&url, None::<&str>)
				.map_err(|err| err.to_string())?;
			let callback = tokio::time::timeout(Duration::from_secs(180), auth::accept_loopback(listener))
				.await
				.map_err(|_| {
					log::line("login timed out");
					"login timed out".to_string()
				})??;
			complete_login(&app, &verifier, &state, &callback, &redirect_uri).await
		}
		Err(err) => {
			log::line(&format!("auth loopback bind failed: {err}"));
			let url = auth::authorize_url(&verifier, &state, config::AUTH_REDIRECT_URI);
			let rx = flow.wait().map_err(|wait_err| {
				log::line(&wait_err);
				wait_err
			})?;
			app.opener().open_url(&url, None::<&str>).map_err(|open_err| {
				flow.cancel();
				open_err.to_string()
			})?;
			let callback = tokio::time::timeout(Duration::from_secs(180), rx)
				.await
				.map_err(|_| {
					flow.cancel();
					log::line("login timed out");
					"login timed out".to_string()
				})?
				.map_err(|_| {
					log::line("login cancelled");
					"login cancelled".to_string()
				})?;
			complete_login(
				&app,
				&verifier,
				&state,
				&callback,
				config::AUTH_REDIRECT_URI,
			)
			.await
		}
	}
}

#[tauri::command]
fn auth_logout() {
	tokens::clear();
	offline_keys::clear();
}

#[tauri::command]
async fn devices_list() -> Result<DeviceList, String> {
	log::line("devices list");
	api::request(Method::GET, "/api/mobile/devices", None::<&Value>).await
}

#[tauri::command]
async fn devices_unpair(uuid: String) -> Result<Value, String> {
	let path = format!(
		"/api/mobile/devices?uuid={}",
		url::form_urlencoded::byte_serialize(uuid.as_bytes()).collect::<String>()
	);
	api::request(Method::DELETE, &path, None::<&Value>).await
}

fn parse_method(value: &str) -> Result<Method, String> {
	match value.to_ascii_uppercase().as_str() {
		"GET" => Ok(Method::GET),
		"POST" => Ok(Method::POST),
		"PUT" => Ok(Method::PUT),
		"PATCH" => Ok(Method::PATCH),
		"DELETE" => Ok(Method::DELETE),
		_ => Err(format!("unsupported method {value}")),
	}
}

#[tauri::command]
async fn api_request(
	method: String,
	path: String,
	body: Option<Value>,
) -> Result<Value, String> {
	if !path.starts_with("/api/") {
		return Err("path must be an /api/ route".to_string());
	}
	let method = parse_method(&method)?;
	let payload = body.filter(|value| !value.is_null());
	api::request_value(method, &path, payload.as_ref()).await
}

#[tauri::command]
fn ble_last_id() -> String {
	ble::last_connected_id()
}

#[tauri::command]
async fn ble_scan(app: AppHandle) -> Result<Vec<ble::NearbyBoard>, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Scanning…");
	let boards = ble::scan_nearby(ble::SCAN_NEARBY_MS).await?;
	emit_status(&app, "Identifying gpio-companion…");
	let status_app = app.clone();
	let boards = ble::identify_boards(boards, move |message| {
		emit_status(&status_app, message)
	})
	.await?;
	let matched = boards.iter().filter(|board| board.matched).count();
	emit_status(
		&app,
		&if boards.is_empty() {
			"No nearby Bluetooth devices".to_string()
		} else if matched == 0 {
			"No gpio-companion identified. Hold the Pi close and scan again, or pick the strongest nearby signal.".to_string()
		} else {
			format!("Found {matched} gpio-companion board(s). Select a device.")
		},
	);
	Ok(boards)
}

#[tauri::command]
async fn ble_pair(app: AppHandle, id: String) -> Result<Value, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Connecting…");
	let (peripheral, info) = ble::connected_board_info(&id).await?;
	emit_status(&app, "Reading board…");
	let envelope = match request_value(Method::PUT, "/api/mobile/pair", None).await {
		Ok(envelope) => envelope,
		Err(err) => {
			ble::disconnect(&peripheral).await;
			return Err(err);
		}
	};
	emit_status(&app, "Asking board for pairing key…");
	let raw = ble::send_envelope(&peripheral, &envelope).await;
	ble::disconnect(&peripheral).await;
	let raw = raw?;
	let creds: Value =
		serde_json::from_str(&raw).map_err(|_| "device did not return pairing credentials".to_string())?;
	let uuid = creds
		.get("uuid")
		.and_then(Value::as_str)
		.ok_or_else(|| "device did not return pairing credentials".to_string())?;
	let key = creds
		.get("key")
		.and_then(Value::as_str)
		.ok_or_else(|| "device did not return pairing credentials".to_string())?;
	let device_url = creds
		.get("deviceUrl")
		.and_then(Value::as_str)
		.map(str::to_string)
		.filter(|value| !value.is_empty())
		.or(info.device_url);
	emit_status(&app, "Claiming…");
	let claimed = request_value(
		Method::POST,
		"/api/mobile/pair",
		Some(&json!({
			"uuid": uuid,
			"key": key,
			"deviceUrl": device_url,
			"bleMac": id,
		})),
	)
	.await?;
	if !claim_is_notice(&claimed) {
		emit_status(&app, "Paired");
	}
	Ok(claimed)
}

fn claim_is_notice(claimed: &Value) -> bool {
	claimed
		.get("alreadyYours")
		.and_then(Value::as_bool)
		.unwrap_or(false)
		|| claimed
			.get("pending")
			.and_then(Value::as_bool)
			.unwrap_or(false)
		|| claimed.get("alreadyPaired").and_then(Value::as_str).is_some()
}

#[tauri::command]
fn offline_keys_get(uuid: String) -> Option<Value> {
	offline_keys::get(&uuid)
}

#[tauri::command]
fn offline_keys_put(record: Value) -> Result<(), String> {
	offline_keys::put(record)
}

#[tauri::command]
async fn ble_write_envelope(
	app: AppHandle,
	id: String,
	uuid: String,
	envelope: Value,
) -> Result<String, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Connecting…");
	let (peripheral, info) = ble::connected_board_info(&id).await?;
	if !uuid.is_empty() && !info.uuid.is_empty() && info.uuid != uuid {
		ble::disconnect(&peripheral).await;
		return Err("this board is not the selected paired device".to_string());
	}
	emit_status(&app, "Writing…");
	let raw = ble::send_envelope(&peripheral, &envelope).await;
	ble::disconnect(&peripheral).await;
	raw
}

#[derive(Debug, Deserialize)]
struct HealthProbe {
	id: String,
	envelope: Option<Value>,
}

#[derive(Debug, Serialize)]
struct HealthHit {
	id: String,
	body: Option<Value>,
	raw: Option<String>,
	error: Option<String>,
}

#[tauri::command]
async fn ble_health_run(
	app: AppHandle,
	uuid: String,
	id: String,
	probes: Vec<HealthProbe>,
) -> Result<Vec<HealthHit>, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Connecting…");
	let (peripheral, info) = ble::connected_board_info(&id).await?;
	if !uuid.is_empty() && !info.uuid.is_empty() && info.uuid != uuid {
		ble::disconnect(&peripheral).await;
		return Err("this board is not the selected paired device".to_string());
	}
	let mut hits = Vec::new();
	for probe in probes {
		emit_status(&app, &format!("Testing {}…", probe.id));
		if probe.id == "gatt-info" {
			hits.push(HealthHit {
				id: probe.id,
				body: Some(json!({
					"uuid": info.uuid,
					"hardware": info.hardware,
					"name": info.name,
				})),
				raw: None,
				error: None,
			});
			continue;
		}
		let Some(envelope) = probe.envelope else {
			hits.push(HealthHit {
				id: probe.id,
				body: None,
				raw: None,
				error: Some("missing signed envelope".to_string()),
			});
			continue;
		};
		match ble::send_envelope(&peripheral, &envelope).await {
			Ok(raw) => {
				let body = serde_json::from_str(&raw).ok();
				hits.push(HealthHit {
					id: probe.id,
					body,
					raw: Some(raw),
					error: None,
				});
			}
			Err(error) => {
				hits.push(HealthHit {
					id: probe.id,
					body: None,
					raw: None,
					error: Some(error),
				});
			}
		}
	}
	ble::disconnect(&peripheral).await;
	Ok(hits)
}

#[tauri::command]
async fn ble_gatt_info(app: AppHandle, id: String) -> Result<Value, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Connecting…");
	let (peripheral, info) = ble::connected_board_info(&id).await?;
	ble::disconnect(&peripheral).await;
	Ok(json!({
		"uuid": info.uuid,
		"hardware": info.hardware,
		"name": info.name,
	}))
}

#[tauri::command]
async fn ble_wifi(
	app: AppHandle,
	uuid: String,
	ssid: String,
	psk: String,
	id: String,
) -> Result<String, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Connecting…");
	let (peripheral, _info) = ble::connected_board_info(&id).await?;
	emit_status(&app, "Signing WiFi…");
	// Sign AFTER connecting: a fresh envelope survives the Pi's clock skew,
	// and a scan+connect can eat 20s of the envelope's validity window.
	let envelope = match request_value(
		Method::POST,
		"/api/mobile/wifi",
		Some(&json!({ "uuid": uuid, "ssid": ssid, "psk": psk })),
	)
	.await
	{
		Ok(envelope) => envelope,
		Err(err) => {
			ble::disconnect(&peripheral).await;
			return Err(err);
		}
	};
	emit_status(&app, "Writing…");
	let raw = ble::send_envelope(&peripheral, &envelope).await;
	ble::disconnect(&peripheral).await;
	raw
}

#[tauri::command]
async fn ble_info(app: AppHandle, uuid: String, id: String) -> Result<Value, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Connecting…");
	let (peripheral, info) = ble::connected_board_info(&id).await?;
	if !uuid.is_empty() && !info.uuid.is_empty() && info.uuid != uuid {
		ble::disconnect(&peripheral).await;
		return Err("this board is not the selected paired device".to_string());
	}
	emit_status(&app, "Signing companion info…");
	let envelope = match request_value(
		Method::POST,
		"/api/mobile/info",
		Some(&json!({ "uuid": uuid })),
	)
	.await
	{
		Ok(envelope) => envelope,
		Err(err) => {
			ble::disconnect(&peripheral).await;
			return Err(err);
		}
	};
	emit_status(&app, "Reading…");
	let raw = ble::send_envelope(&peripheral, &envelope).await;
	ble::disconnect(&peripheral).await;
	let raw = raw?;
	let parsed: Value = serde_json::from_str(&raw)
		.map_err(|_| "board did not return companion info".to_string())?;
	if let Some(error) = parsed.get("error").and_then(Value::as_str) {
		return Err(error.to_string());
	}
	Ok(parsed)
}

#[tauri::command]
async fn ble_gpio(
	app: AppHandle,
	uuid: String,
	id: String,
	physical: Option<u32>,
	dir: String,
	value: Option<u8>,
) -> Result<Value, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Connecting…");
	let (peripheral, info) = ble::connected_board_info(&id).await?;
	if !uuid.is_empty() && !info.uuid.is_empty() && info.uuid != uuid {
		ble::disconnect(&peripheral).await;
		return Err("this board is not the selected paired device".to_string());
	}
	emit_status(&app, "Signing GPIO…");
	let mut body = json!({ "uuid": uuid });
	if let Some(pin) = physical {
		body["physical"] = json!(pin);
		if !dir.is_empty() {
			body["dir"] = json!(dir);
		}
		if let Some(level) = value {
			body["value"] = json!(level);
		}
	}
	let envelope = match request_value(Method::POST, "/api/mobile/gpio", Some(&body)).await
	{
		Ok(envelope) => envelope,
		Err(err) => {
			ble::disconnect(&peripheral).await;
			return Err(err);
		}
	};
	emit_status(&app, "Reading…");
	let raw = ble::send_envelope(&peripheral, &envelope).await;
	ble::disconnect(&peripheral).await;
	let raw = raw?;
	let parsed: Value = serde_json::from_str(&raw)
		.map_err(|_| "board did not return gpio".to_string())?;
	if let Some(error) = parsed.get("error").and_then(Value::as_str) {
		return Err(error.to_string());
	}
	Ok(parsed)
}

#[tauri::command]
async fn ble_flash(
	app: AppHandle,
	uuid: String,
	id: String,
	fqbn: String,
	dir: String,
	port: String,
	ports: bool,
) -> Result<Value, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Connecting…");
	let (peripheral, info) = ble::connected_board_info(&id).await?;
	if !uuid.is_empty() && !info.uuid.is_empty() && info.uuid != uuid {
		ble::disconnect(&peripheral).await;
		return Err("this board is not the selected paired device".to_string());
	}
	emit_status(&app, "Signing flash…");
	let mut body = json!({ "uuid": uuid });
	if ports {
		body["ports"] = json!(true);
	} else if !fqbn.is_empty() {
		body["fqbn"] = json!(fqbn);
		body["dir"] = json!(dir);
		body["sign"] = json!(true);
		if !port.is_empty() {
			body["port"] = json!(port);
		}
	}
	let envelope =
		match request_value(Method::POST, "/api/mobile/flash", Some(&body)).await {
			Ok(envelope) => envelope,
			Err(err) => {
				ble::disconnect(&peripheral).await;
				return Err(err);
			}
		};
	emit_status(&app, "Writing…");
	let raw = ble::send_envelope(&peripheral, &envelope).await;
	ble::disconnect(&peripheral).await;
	let raw = raw?;
	let parsed: Value = serde_json::from_str(&raw)
		.map_err(|_| "board did not return flash".to_string())?;
	if let Some(error) = parsed.get("error").and_then(Value::as_str) {
		return Err(error.to_string());
	}
	Ok(parsed)
}

#[tauri::command]
async fn ble_run(
	app: AppHandle,
	uuid: String,
	id: String,
	dir: String,
	stop: bool,
) -> Result<Value, String> {
	let _ble = ble::acquire().await;
	emit_status(&app, "Connecting…");
	let (peripheral, info) = ble::connected_board_info(&id).await?;
	if !uuid.is_empty() && !info.uuid.is_empty() && info.uuid != uuid {
		ble::disconnect(&peripheral).await;
		return Err("this board is not the selected paired device".to_string());
	}
	emit_status(&app, "Signing run…");
	let mut body = json!({ "uuid": uuid });
	if stop {
		body["stop"] = json!(true);
		body["sign"] = json!(true);
	} else if !dir.is_empty() {
		body["dir"] = json!(dir);
		body["sign"] = json!(true);
	}
	let envelope =
		match request_value(Method::POST, "/api/mobile/run", Some(&body)).await {
			Ok(envelope) => envelope,
			Err(err) => {
				ble::disconnect(&peripheral).await;
				return Err(err);
			}
		};
	emit_status(&app, "Writing…");
	let raw = ble::send_envelope(&peripheral, &envelope).await;
	ble::disconnect(&peripheral).await;
	let raw = raw?;
	let parsed: Value = serde_json::from_str(&raw)
		.map_err(|_| "board did not return run".to_string())?;
	if let Some(error) = parsed.get("error").and_then(Value::as_str) {
		return Err(error.to_string());
	}
	Ok(parsed)
}

#[tauri::command]
async fn wifi_known_networks() -> Vec<wifi::KnownNetwork> {
	tokio::task::spawn_blocking(wifi::known_networks)
		.await
		.unwrap_or_default()
}

#[tauri::command]
async fn wifi_network_psk(ssid: String) -> String {
	tokio::task::spawn_blocking(move || wifi::network_psk(&ssid))
		.await
		.unwrap_or_default()
}

#[tauri::command]
async fn wifi_remember_network(ssid: String, psk: String) -> Result<(), String> {
	tokio::task::spawn_blocking(move || wifi::remember_network(&ssid, &psk))
		.await
		.map_err(|_| "wifi remember failed".to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let mut builder = tauri::Builder::default();

	#[cfg(desktop)]
	{
		builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}));
	}

	builder
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_deep_link::init())
		.manage(AuthFlow::default())
		.setup(|app| {
			#[cfg(any(windows, target_os = "linux"))]
			{
				// Registration failing (sandboxed home, policy) must not stop
				// the app from starting — the existing OS mapping still works.
				if let Err(err) = app.deep_link().register_all() {
					log::line(&format!("deep link register: {err}"));
				}
			}
			let handle = app.handle().clone();
			app.deep_link().on_open_url(move |event| {
				for url in event.urls() {
					let href = url.as_str();
					log_deep_link(href);
					if auth::is_github_app_oauth_callback(href) {
						let _ = handle.emit("github-app-callback", href);
					} else {
						handle.state::<AuthFlow>().complete(href);
					}
				}
			});
			if let Ok(Some(urls)) = app.deep_link().get_current() {
				for url in urls {
					let href = url.as_str();
					log_deep_link(href);
					if auth::is_github_app_oauth_callback(href) {
						let _ = app.emit("github-app-callback", href);
					} else {
						app.state::<AuthFlow>().complete(href);
					}
				}
			}
			enable_talk_microphone(app.handle());
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			auth_token,
			auth_login,
			auth_logout,
			auth_session,
			debug_logs,
			devices_list,
			devices_unpair,
			api_request,
			ble_scan,
			ble_last_id,
			ble_pair,
			ble_gatt_info,
			ble_health_run,
			ble_wifi,
			ble_info,
			ble_gpio,
			ble_flash,
			ble_run,
			wifi_known_networks,
			wifi_network_psk,
			wifi_remember_network,
			offline_keys_get,
			offline_keys_put,
			ble_write_envelope
		])
		.run(tauri::generate_context!())
		.expect("error while running gpio-companion desktop");
}
