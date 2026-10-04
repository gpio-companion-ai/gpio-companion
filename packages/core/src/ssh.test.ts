import { describe, expect, test } from "bun:test";
import {
	asSshWsError,
	isSshChunk,
	isSshPath,
	isSshStatusMessage,
	parseSshWsCommand,
	SSH_MAX_INPUT,
	SshError,
	sshWsConnectUrl,
	sshWsUrl,
} from "./ssh.ts";

describe("ssh paths", () => {
	test("matches ssh route", () => {
		expect(isSshPath("/v1/ssh")).toBe(true);
		expect(isSshPath("/v1/console")).toBe(false);
		expect(isSshPath("/v1/run")).toBe(false);
	});

	test("builds companion websocket urls", () => {
		expect(sshWsUrl("https://api-abc.gpio-companion.com")).toBe(
			"wss://api-abc.gpio-companion.com/v1/ssh",
		);
		expect(sshWsUrl("http://192.168.1.20:4150")).toBe(
			"ws://192.168.1.20:4150/v1/ssh",
		);
		expect(sshWsUrl("api-abc.gpio-companion.com")).toBe(
			"wss://api-abc.gpio-companion.com/v1/ssh",
		);
		expect(
			sshWsConnectUrl("https://api-abc.gpio-companion.com", {
				"X-Gpio-Key-Id": "k",
				"X-Gpio-Timestamp": "1",
				"X-Gpio-Nonce": "n",
				"X-Gpio-Signature": "s",
			}),
		).toContain("/v1/ssh?x-gpio-key-id=k");
	});
});

describe("parseSshWsCommand", () => {
	test("accepts open and close", () => {
		expect(parseSshWsCommand({ op: "open" })).toEqual({ op: "open" });
		expect(parseSshWsCommand({ op: "close" })).toEqual({ op: "close" });
	});

	test("accepts input within the size cap", () => {
		expect(parseSshWsCommand({ op: "input", data: "ls\n" })).toEqual({
			op: "input",
			data: "ls\n",
		});
		expect(() =>
			parseSshWsCommand({ op: "input", data: "x".repeat(SSH_MAX_INPUT + 1) }),
		).toThrow(SshError);
		expect(() => parseSshWsCommand({ op: "input", data: 5 })).toThrow(SshError);
	});

	test("accepts bounded resize dimensions", () => {
		expect(parseSshWsCommand({ op: "resize", cols: 120, rows: 40 })).toEqual({
			op: "resize",
			cols: 120,
			rows: 40,
		});
		expect(() =>
			parseSshWsCommand({ op: "resize", cols: 1, rows: 40 }),
		).toThrow(SshError);
		expect(() =>
			parseSshWsCommand({ op: "resize", cols: 80, rows: 201 }),
		).toThrow(SshError);
		expect(() =>
			parseSshWsCommand({ op: "resize", cols: 80.5, rows: 24 }),
		).toThrow(SshError);
	});

	test("rejects unknown commands", () => {
		expect(() => parseSshWsCommand({ op: "shell" })).toThrow(SshError);
		expect(() => parseSshWsCommand("open")).toThrow(SshError);
		expect(() => parseSshWsCommand(null)).toThrow(SshError);
	});
});

describe("ssh frames", () => {
	test("detects chunks and status messages", () => {
		expect(isSshChunk({ chunk: "$ " })).toBe(true);
		expect(isSshChunk({ status: "auth" })).toBe(false);
		expect(isSshStatusMessage({ status: "auth" })).toBe(true);
		expect(isSshStatusMessage({ status: "connected" })).toBe(true);
		expect(isSshStatusMessage({ status: "closed" })).toBe(true);
		expect(isSshStatusMessage({ chunk: "$ " })).toBe(false);
	});

	test("surfaces only error frames", () => {
		expect(asSshWsError({ error: "ssh failed" })).toBe("ssh failed");
		expect(asSshWsError({ chunk: "$ " })).toBe(null);
		expect(asSshWsError({ status: "auth" })).toBe(null);
		expect(asSshWsError("boom")).toBe(null);
		expect(asSshWsError({ error: "  " })).toBe(null);
	});
});
