#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

API = "https://api.cloudflare.com/client/v4"


def request(method: str, path: str, token: str, body: Optional[dict] = None) -> Any:
	data = None if body is None else json.dumps(body).encode()
	req = urllib.request.Request(
		API + path,
		data=data,
		method=method,
		headers={
			"Authorization": f"Bearer {token}",
			"Content-Type": "application/json",
		},
	)
	try:
		with urllib.request.urlopen(req, timeout=60) as resp:
			return json.load(resp)
	except urllib.error.HTTPError as error:
		detail = error.read().decode("utf-8", errors="replace")
		raise SystemExit(f"cloudflare {method} {path} failed: {error.code} {detail}") from error


def result_token(payload: dict) -> str:
	value = payload.get("result")
	if isinstance(value, str):
		return value
	if isinstance(value, dict):
		token = value.get("token")
		if isinstance(token, str):
			return token
	raise SystemExit("cloudflare tunnel token missing from API response")


def ensure_cname(zone_id: str, token: str, name: str, tunnel_id: str) -> None:
	query = urllib.parse.urlencode({"type": "CNAME", "name": name})
	existing = request("GET", f"/zones/{zone_id}/dns_records?{query}", token)
	content = f"{tunnel_id}.cfargotunnel.com"
	body = {"type": "CNAME", "proxied": True, "name": name, "content": content}
	records = existing.get("result") or []
	if records:
		record_id = records[0]["id"]
		request("PUT", f"/zones/{zone_id}/dns_records/{record_id}", token, body)
		return
	request("POST", f"/zones/{zone_id}/dns_records", token, body)


def main() -> None:
	parser = argparse.ArgumentParser(description="Create a per-Pi Cloudflare tunnel")
	parser.add_argument("--account-id", required=True)
	parser.add_argument("--zone-id", required=True)
	parser.add_argument("--uuid", required=True)
	args = parser.parse_args()
	token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
	if not token:
		raise SystemExit("CLOUDFLARE_API_TOKEN is required")
	uuid = args.uuid.strip()
	slug = uuid.replace("-", "").lower()
	zone = request("GET", f"/zones/{args.zone_id}", token)
	zone_name = zone["result"]["name"]
	api_host = f"api-{slug}.{zone_name}"
	name = f"gpio-{uuid}"
	query = urllib.parse.urlencode({"name": name, "is_deleted": "false"})
	listed = request("GET", f"/accounts/{args.account_id}/cfd_tunnel?{query}", token)
	tunnels = listed.get("result") or []
	if tunnels:
		tunnel_id = tunnels[0]["id"]
		token_res = request(
			"GET",
			f"/accounts/{args.account_id}/cfd_tunnel/{tunnel_id}/token",
			token,
		)
		tunnel_token = result_token(token_res)
	else:
		created = request(
			"POST",
			f"/accounts/{args.account_id}/cfd_tunnel",
			token,
			{"name": name, "config_src": "cloudflare"},
		)
		tunnel_id = created["result"]["id"]
		tunnel_token = result_token(created)
	ingress = [
		{"hostname": api_host, "service": "http://127.0.0.1:4150", "originRequest": {}},
		{"service": "http_status:404"},
	]
	request(
		"PUT",
		f"/accounts/{args.account_id}/cfd_tunnel/{tunnel_id}/configurations",
		token,
		{"config": {"ingress": ingress}},
	)
	ensure_cname(args.zone_id, token, api_host, tunnel_id)
	json.dump(
		{
			"tunnelId": tunnel_id,
			"token": tunnel_token,
			"hostname": "",
			"apiHostname": api_host,
			"zone": zone_name,
		},
		sys.stdout,
	)
	sys.stdout.write("\n")


if __name__ == "__main__":
	main()
