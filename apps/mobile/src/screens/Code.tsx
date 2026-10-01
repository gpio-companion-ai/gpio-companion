import {
	type AudioPlayer,
	createAudioPlayer,
	RecordingPresets,
	requestRecordingPermissionsAsync,
	setAudioModeAsync,
	useAudioRecorder,
	useAudioRecorderState,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { router } from "expo-router";
import {
	applyCodeMention,
	CODE_STT_MAX_MS,
	CODE_VOICE_ARM_MS,
	CODE_VOICE_BARGE_DB,
	CODE_VOICE_BARGE_FLOOR_DB,
	CODE_VOICE_FLOOR_MS,
	CODE_VOICE_METER_DB,
	CODE_VOICE_MIN_MS,
	CODE_VOICE_SILENCE_MS,
	type CodeAttachDraft,
	type CodeVoiceProvider,
	codeAppendSpeechDirective,
	codeAttachPrompt,
	codeComposerErrorKey,
	codeHasSpeechDirective,
	codeMentionAt,
	codeSpeechBlocks,
	codeSpokenText,
	codeVoiceProvider,
	codeVoiceUtterance,
	decodeBase64,
	encodeBase64,
	filterCodeMentions,
	removeContextDrafts,
	renameContextDrafts,
	stageBoardContext,
	stageCodeAttach,
} from "gpio-companion-attach";
import {
	activeOpencodeQuestion,
	applyOpencodeEvent,
	CODE_DEFAULT_MODEL,
	codeNavBack,
	codeQuestionAnswer,
	codeQuestionSlideIndex,
	codeRepoLabel,
	codeRepoOwner,
	codeScrollKey,
	codeSessionTitle,
	emptyOpencodeView,
	filterCodeSessions,
	holdOpencodePromptEvent,
	matchCodeRepo,
	matchOpencodeQuestionID,
	mergeOpencodeQuestions,
	noteOpencodePrompt,
	OPENCODE_EFFORT_KEY,
	OPENCODE_MODEL_KEY,
	OPENCODE_PERMISSION_MODE_KEY,
	OPENCODE_PERMISSION_MODES,
	type OpencodeClientCall,
	type OpencodePart,
	type OpencodePermissionMode,
	type OpencodePermissionResponse,
	type OpencodePromptEpoch,
	type OpencodeTurn,
	type OpencodeView,
	opencodeEventResumeUrl,
	opencodeModelChoices,
	opencodePermissionMode,
	opencodePromptFields,
	opencodeQuestions,
	opencodeReplyAccepted,
	opencodeSessionBucket,
	opencodeSessions,
	opencodeStoredEffort,
	opencodeStoredModel,
	opencodeStoredPermissionMode,
	opencodeToolStacks,
	opencodeTurns,
	parseOpencodeEventFrame,
	pendingOpencodeFromMessages,
	pendingOpencodeTurn,
	pruneCodePromptState,
	pushCodeNav,
	type ReasoningEffort,
	readCodeNav,
	readStoredOpencodePrompts,
	recoverOpencodePrompts,
	releaseSettledPromptHolds,
	rememberOpencodePrompt,
	replaceCodeNav,
	seedOpencodePrompts,
	settleOpencodeTurns,
	storeOpencodePrompts,
} from "gpio-companion-opencode";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	Alert,
	BackHandler,
	Modal,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Blocks } from "../components/OcMarkdown.tsx";
import ProjectFiles from "../components/ProjectFiles.tsx";
import {
	getVoiceSettings,
	listBoardFiles,
	listProjects,
	opencodeCall,
	readBoardFile,
	signOpencodeLive,
	speakCode,
	transcribeCode,
	uploadBoardFile,
} from "../lib/api.ts";
import { useUserBoards } from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { useDeviceHub } from "../lib/device-hub.tsx";
import { useLocale, useT } from "../lib/locale.tsx";
import { storageGet, storageSet } from "../lib/storage.ts";

const PROJECT_KEY = "gpio-companion-selected-project";

function boardChipName(item: { uuid: string; label?: string } | undefined) {
	return item?.label?.trim() || item?.uuid || "";
}

function boardChipHint(
	item: { uuid: string; label?: string } | undefined,
	model?: string,
) {
	const named = model?.trim();
	if (named) {
		return named;
	}
	return item?.label?.trim() ? item.uuid.slice(0, 8) : undefined;
}

function formatSessionTime(updated: number): string {
	if (!updated) {
		return "";
	}
	return new Date(updated).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

type Repo = { owner: string; name: string };
type Mode = "home" | "draft" | "session";
type SpeechItem = {
	text: string;
	gen: number;
	state: "queued" | "fetching" | "ready" | "failed";
	promise: Promise<void>;
	audio: string;
};

export default function Code() {
	const t = useT();
	const { locale } = useLocale();
	const recorder = useAudioRecorder({
		...RecordingPresets.HIGH_QUALITY,
		isMeteringEnabled: true,
	});
	const recState = useAudioRecorderState(recorder, 200);
	const heardUri = useRef("");
	const voiceSpeaking = useRef<AudioPlayer | null>(null);
	const voiceSpeechResolve = useRef<(() => void) | null>(null);
	const speechSpoken = useRef(new Map<string, number>());
	const speechPrefetch = useRef<SpeechItem[]>([]);
	const speechPlaying = useRef(false);
	const speechFetching = useRef(false);
	const speechFileIndex = useRef(0);
	const speechGen = useRef(0);
	const voiceSpoken = useRef(new Set<string>());
	const voiceQueue = useRef<string[]>([]);
	const voiceBarge = useRef(0);
	const voiceArmAt = useRef(0);
	const voiceFloor = useRef(-160);
	const voiceFloorAt = useRef(0);
	const voiceSource = useRef<"auto" | "ptt">("auto");
	const pttRef = useRef(false);
	const pttParts = useRef(new Map<number, string>());
	const pttSeq = useRef(0);
	const pttPending = useRef(0);
	const beginPttRef = useRef<() => void>(() => {});
	const endPttRef = useRef<() => void>(() => {});
	const voiceLastVoice = useRef(0);
	const voiceSpeech = useRef(false);
	const voiceHandling = useRef(false);
	const voicePreparing = useRef(false);
	const voiceUri = useRef("");
	const voiceModeRef = useRef(false);
	const voiceReplyRef = useRef(false);
	const speechDirectiveSentRef = useRef<string | null>(null);
	const finishVoiceRef = useRef<(uri: string) => void>(() => {});
	const startVoiceCaptureRef = useRef<() => void>(() => {});
	const stopVoiceEngineRef = useRef<() => void>(() => {});
	const voiceTickRef = useRef<() => void>(() => {});
	const recStateRef = useRef(recState);
	recStateRef.current = recState;
	const colors = useColors();
	const insets = useSafeAreaInsets();
	const auth = useAuth();
	const { setTab } = useDeviceHub();
	const { uuid, setUuid } = useBoardSelection();
	const { devices, boards } = useUserBoards();
	const token = auth.token ?? "";
	const selected = uuid || devices[0]?.uuid || "";
	const [repos, setRepos] = useState<Repo[]>([]);
	const [repo, setRepo] = useState("");
	const [view, setView] = useState<OpencodeView>(() => {
		if (typeof window === "undefined") {
			return emptyOpencodeView();
		}
		return seedOpencodePrompts(
			emptyOpencodeView(),
			readCodeNav(window.location.search).sessionID,
		);
	});
	const [mode, setMode] = useState<Mode>(() =>
		typeof window === "undefined"
			? "home"
			: readCodeNav(window.location.search).mode,
	);
	const [prompt, setPrompt] = useState("");
	const [files, setFiles] = useState<CodeAttachDraft[]>([]);
	const [boardPaths, setBoardPaths] = useState<string[]>([]);
	const [caret, setCaret] = useState(0);
	const [mentionOff, setMentionOff] = useState("");
	const [recording, setRecording] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [voiceMode, setVoiceMode] = useState(false);
	const [voiceProvider, setVoiceProvider] =
		useState<CodeVoiceProvider>("workers-ai");
	const [pttHeld, setPttHeld] = useState(false);
	const [voiceLevel, setVoiceLevel] = useState(0);
	const [voiceListening, setVoiceListening] = useState(false);
	const [voiceSpeakingNow, setVoiceSpeakingNow] = useState(false);
	const [voiceQueued, setVoiceQueued] = useState(0);
	const [voiceTranscribing, setVoiceTranscribing] = useState(false);
	const [voiceReply, setVoiceReply] = useState(false);
	const [voicePulse, setVoicePulse] = useState(0);
	const [query, setQuery] = useState("");
	const [error, setError] = useState("");
	const [reconnecting, setReconnecting] = useState(false);
	const [sessionsLoading, setSessionsLoading] = useState(false);
	const [slide, setSlide] = useState(0);
	const [picks, setPicks] = useState<Record<string, string>>({});
	const [custom, setCustom] = useState<Record<string, string>>({});
	const [showCustom, setShowCustom] = useState(false);
	const [composerFocused, setComposerFocused] = useState(false);
	const [model, setModel] = useState(CODE_DEFAULT_MODEL);
	const [effort, setEffort] = useState<ReasoningEffort>("medium");
	const [permissionMode, setPermissionMode] =
		useState<OpencodePermissionMode>("ask");
	const [picker, setPicker] = useState<
		"" | "model" | "effort" | "permission" | "project" | "board"
	>("");
	const [replyBusy, setReplyBusy] = useState(false);
	const [pane, setPane] = useState<"chat" | "files">("chat");
	const [filesDirty, setFilesDirty] = useState(false);
	const [filesStale, setFilesStale] = useState(false);
	const transcript = useRef<ScrollView>(null);
	const prompts = useRef<OpencodePromptEpoch>({
		epoch: 0,
		dropped: new Set(),
	});
	const held = useRef(new Set<string>());
	const replying = useRef(false);

	const modelChoices = useMemo(() => opencodeModelChoices(), []);
	const chosenModel = modelChoices.find((item) => item.id === model);
	const reasoning = chosenModel?.reasoning === true;
	const scrollKey = codeScrollKey(view.turns, view.permissions, view.questions);

	useEffect(() => {
		if (mode !== "session" || !view.sessionID || scrollKey < 0) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			transcript.current?.scrollToEnd({ animated: false });
		});
		return () => cancelAnimationFrame(frame);
	}, [mode, view.sessionID, scrollKey]);

	useEffect(() => {
		if (!token) {
			return;
		}
		setSessionsLoading(true);
		void listProjects(token)
			.then(async (result) => {
				const next = result.repos.map((item) => ({
					owner: item.owner,
					name: item.name,
				}));
				setRepos(next);
				const stored = (await storageGet(PROJECT_KEY)) ?? "";
				setRepo(matchCodeRepo(next, stored));
			})
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "request failed");
			});
	}, [token]);

	useEffect(() => {
		void storageGet(OPENCODE_MODEL_KEY).then((value) => {
			setModel(opencodeStoredModel(value));
		});
		void storageGet(OPENCODE_EFFORT_KEY).then((value) => {
			setEffort(opencodeStoredEffort(value));
		});
		void storageGet(OPENCODE_PERMISSION_MODE_KEY).then((value) => {
			setPermissionMode(opencodeStoredPermissionMode(value));
		});
	}, []);

	useEffect(() => {
		if (!token || !selected || !repo) {
			return;
		}
		let cancelled = false;
		void opencodeCall(token, {
			uuid: selected,
			repo,
			op: "permission-mode",
		})
			.then((result) => {
				if (cancelled) {
					return;
				}
				const record = result as { mode?: unknown } | null;
				const mode = opencodePermissionMode(record?.mode);
				setPermissionMode(mode);
				void storageSet(OPENCODE_PERMISSION_MODE_KEY, mode);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [token, selected, repo]);

	useEffect(() => {
		if (mode !== "session" || !view.sessionID) {
			return;
		}
		if (view.questions.length === 0 && view.permissions.length === 0) {
			return;
		}
		storeOpencodePrompts(view.sessionID, view.questions, view.permissions);
	}, [mode, view.sessionID, view.questions, view.permissions]);

	const askedId = useRef("");
	useEffect(() => {
		const active = view.questions.find(
			(item) => item.sessionID === view.sessionID,
		);
		const pending = active?.prompts ?? [];
		const id = active?.id ?? "";
		setPicks((current) => pruneCodePromptState(current, pending));
		setCustom((current) => pruneCodePromptState(current, pending));
		if (askedId.current !== id) {
			askedId.current = id;
			setSlide(0);
			setShowCustom(false);
			return;
		}
		setSlide((current) =>
			codeQuestionSlideIndex(current, Math.max(pending.length, 1), 0),
		);
	}, [view.questions, view.sessionID]);

	function clearQuestionDraft() {
		setSlide(0);
		setPicks({});
		setCustom({});
		setShowCustom(false);
	}

	function promptAnswer(item: { question: string }) {
		return codeQuestionAnswer(
			picks[item.question],
			custom[item.question] ?? "",
		);
	}

	function pickChoice(prompt: string, option: string) {
		setPicks((current) => ({ ...current, [prompt]: option }));
		setCustom((current) => ({ ...current, [prompt]: "" }));
		setShowCustom(false);
	}

	function moveQuestion(delta: number) {
		const current = activeOpencodeQuestion(view.questions, view.sessionID);
		if (!current || current.prompts.length === 0) {
			return;
		}
		const count = current.prompts.length;
		const index = codeQuestionSlideIndex(slide, count, 0);
		const prompt = current.prompts[index];
		if (delta > 0 && (!prompt || !promptAnswer(prompt))) {
			return;
		}
		setSlide(codeQuestionSlideIndex(index, count, delta));
	}

	function openSession(sessionID: string) {
		setQuery("");
		clearQuestionDraft();
		setView((current) =>
			seedOpencodePrompts(
				{
					...current,
					sessionID,
					turns: current.sessionID === sessionID ? current.turns : [],
				},
				sessionID,
			),
		);
		setMode("session");
		pushCodeNav({ mode: "session", sessionID });
	}

	function askDelete(sessionID: string) {
		Alert.alert(t("code.deleteSession"), t("code.deleteConfirm"), [
			{ text: t("code.dismiss"), style: "cancel" },
			{
				text: t("code.delete"),
				style: "destructive",
				onPress: () => void removeSession(sessionID),
			},
		]);
	}

	async function removeSession(sessionID: string) {
		const removed = await run({ repo, op: "delete", sessionID });
		if (!removed) {
			return;
		}
		setView((current) => ({
			...current,
			sessions: current.sessions.filter((item) => item.id !== sessionID),
			sessionID: current.sessionID === sessionID ? "" : current.sessionID,
			turns: current.sessionID === sessionID ? [] : current.turns,
		}));
		if (mode === "session" && view.sessionID === sessionID) {
			setMode("home");
			replaceCodeNav({ mode: "home", sessionID: "" });
		}
	}

	function openDraft() {
		setPrompt("");
		clearQuestionDraft();
		setMode("draft");
		pushCodeNav({ mode: "draft", sessionID: "" });
	}

	function leaveChat() {
		if (codeNavBack()) {
			return;
		}
		setMode("home");
		replaceCodeNav({ mode: "home", sessionID: "" });
	}

	function selectRepo(name: string) {
		setRepo(name);
		setQuery("");
		clearQuestionDraft();
		const match = repos.find((item) => item.name === name);
		if (match) {
			void storageSet(PROJECT_KEY, `${match.owner}/${match.name}`);
		}
	}

	const boardRef = useRef(selected);
	useEffect(() => {
		if (boardRef.current === selected) {
			return;
		}
		boardRef.current = selected;
		setMode("home");
		replaceCodeNav({ mode: "home", sessionID: "" });
	}, [selected]);

	const leaveRef = useRef(leaveChat);
	leaveRef.current = leaveChat;

	useEffect(() => {
		if (
			typeof window === "undefined" ||
			typeof window.addEventListener !== "function" ||
			!window.location
		) {
			return;
		}
		function applyNav() {
			const next = readCodeNav(window.location.search);
			setMode(next.mode);
			if (next.sessionID) {
				const stored = readStoredOpencodePrompts(next.sessionID);
				setView((current) => ({
					...current,
					sessionID: next.sessionID,
					questions: current.questions.length
						? current.questions
						: stored.questions,
					permissions: current.permissions.length
						? current.permissions
						: stored.permissions,
					turns: current.sessionID === next.sessionID ? current.turns : [],
				}));
			}
		}
		applyNav();
		window.addEventListener("popstate", applyNav);
		return () => window.removeEventListener("popstate", applyNav);
	}, []);

	useEffect(() => {
		if (mode === "home") {
			return;
		}
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			leaveRef.current();
			return true;
		});
		return () => sub.remove();
	}, [mode]);

	useEffect(() => {
		if (!token || !selected || !repo) {
			setSessionsLoading(false);
			return;
		}
		let cancelled = false;
		const sessionID =
			readCodeNav(window.location.search).mode === "session"
				? readCodeNav(window.location.search).sessionID
				: "";
		if (sessionID) {
			setMode("session");
		}
		setView((current) => seedOpencodePrompts(current, sessionID));
		setSessionsLoading(true);
		void opencodeCall(token, { uuid: selected, repo, op: "sessions" })
			.then((data) => {
				if (cancelled) {
					return;
				}
				setSessionsLoading(false);
				const sessions = opencodeSessions(data);
				setView((current) => ({ ...current, sessions }));
			})
			.catch((caught) => {
				if (!cancelled) {
					setSessionsLoading(false);
					setError(caught instanceof Error ? caught.message : "request failed");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [token, selected, repo]);

	useEffect(() => {
		if (!token || !selected || !repo) {
			setBoardPaths([]);
			return;
		}
		let closed = false;
		void listBoardFiles(token, selected, repo)
			.then((data) => {
				if (closed) {
					return;
				}
				setBoardPaths(
					data.entries
						.filter((item) => item.type === "file")
						.map((item) => item.path),
				);
			})
			.catch(() => {
				if (!closed) {
					setBoardPaths([]);
				}
			});
		return () => {
			closed = true;
		};
	}, [token, selected, repo]);

	useEffect(() => {
		if (!token || !selected || !repo || mode !== "session" || !view.sessionID) {
			return;
		}
		let cancelled = false;
		const sessionID = view.sessionID;
		void opencodeCall(token, {
			uuid: selected,
			repo,
			op: "messages",
			sessionID,
		})
			.then((data) => {
				if (cancelled) {
					return;
				}
				setView((current) => {
					if (current.sessionID !== sessionID) {
						return current;
					}
					const pending = pendingOpencodeFromMessages(
						data,
						sessionID,
						readStoredOpencodePrompts(sessionID),
					);
					storeOpencodePrompts(
						sessionID,
						pending.questions,
						pending.permissions,
					);
					const turns = settleOpencodeTurns(current.turns, opencodeTurns(data));
					if (
						turns.some(
							(turn) =>
								turn.role === "user" && codeHasSpeechDirective(turn.text),
						)
					) {
						speechDirectiveSentRef.current = sessionID;
					}
					return {
						...current,
						turns,
						questions: mergeOpencodeQuestions(
							current.questions,
							pending.questions,
							sessionID,
						),
						permissions: [
							...current.permissions.filter(
								(item) => item.sessionID !== sessionID,
							),
							...pending.permissions,
						],
					};
				});
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [token, selected, repo, mode, view.sessionID]);

	useEffect(() => {
		if (!token || !selected || !repo) {
			return;
		}
		let socket: WebSocket | null = null;
		let lastEventId = "";
		let stopped = false;
		async function loop() {
			while (!stopped) {
				let opened = false;
				try {
					const signed = await signOpencodeLive(token, selected, repo);
					if (stopped) {
						return;
					}
					const url = opencodeEventResumeUrl(signed.wsUrl, lastEventId);
					await new Promise<void>((resolve) => {
						const next = new WebSocket(url);
						socket = next;
						next.addEventListener("open", () => {
							opened = true;
							if (!stopped) {
								setReconnecting(false);
							}
						});
						next.addEventListener("message", (event) => {
							if (socket !== next) {
								return;
							}
							const frame = parseOpencodeEventFrame(String(event.data ?? ""));
							if (!frame) {
								return;
							}
							if (frame.id) {
								lastEventId = frame.id;
							}
							if (holdOpencodePromptEvent(frame.data, held.current)) {
								return;
							}
							rememberOpencodePrompt(frame.data);
							noteOpencodePrompt(frame.data, prompts.current);
							setView((current) => applyOpencodeEvent(current, frame.data));
						});
						next.addEventListener("close", () => {
							if (socket === next) {
								resolve();
							}
						});
						next.addEventListener("error", () => {
							if (!opened) {
								setError("opencode event stream unavailable");
							}
							next.close();
						});
					});
				} catch (caught) {
					if (stopped) {
						return;
					}
					setReconnecting(true);
					if (caught instanceof Error) {
						setError(caught.message);
					}
				}
				if (stopped) {
					return;
				}
				setReconnecting(true);
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
		}
		void loop();
		return () => {
			stopped = true;
			socket?.close();
		};
	}, [token, selected, repo]);

	async function run(call: Omit<OpencodeClientCall, "uuid">) {
		setError("");
		try {
			return await opencodeCall(token, { ...call, uuid: selected });
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
			return null;
		}
	}

	function permissionModeLabel(value: OpencodePermissionMode) {
		return value === "full"
			? t("code.permissionFull")
			: t("code.permissionAsk");
	}

	function selectPermissionMode(id: string) {
		const next = opencodeStoredPermissionMode(id);
		if (next === permissionMode) {
			return;
		}
		const previous = permissionMode;
		setPermissionMode(next);
		void storageSet(OPENCODE_PERMISSION_MODE_KEY, next);
		void run({ repo, op: "permission-mode", mode: next }).then((data) => {
			const record = data as { mode?: unknown } | null;
			if (!record || opencodePermissionMode(record.mode) !== next) {
				setPermissionMode(previous);
				return;
			}
			setPermissionMode(next);
		});
	}

	function shownError(message: string): string {
		const key = codeComposerErrorKey(message);
		if (key === "fileTooLarge") {
			return t("code.fileTooLarge");
		}
		if (key === "fileType") {
			return t("code.fileType");
		}
		if (key === "updateCompanion") {
			return t("code.updateCompanion");
		}
		if (key === "creditsEmpty") {
			return t("code.creditsEmpty");
		}
		if (key === "contextText") {
			return t("code.contextText");
		}
		return message;
	}

	function addBoardContext(path: string, text: string) {
		const staged = stageBoardContext({ path, text });
		setFiles((current) =>
			current.some(
				(item) => item.source === "board" && item.path === staged.path,
			)
				? current
				: [...current, staged],
		);
		setError("");
	}

	async function pickMention(path: string) {
		const current = codeMentionAt(prompt, caret);
		if (current) {
			setPrompt(applyCodeMention(prompt, current));
			setCaret(current.start);
		}
		setMentionOff("picked");
		try {
			const data = await readBoardFile(token, selected, repo, path);
			if (data.kind !== "text" || typeof data.text !== "string") {
				throw new Error("context file must be text");
			}
			addBoardContext(path, data.text);
		} catch (caught) {
			if (current) {
				setPrompt(prompt);
				setCaret(caret);
			}
			setError(shownError(caught instanceof Error ? caught.message : ""));
		}
	}

	async function addPicked() {
		const picked = await DocumentPicker.getDocumentAsync({
			multiple: true,
			copyToCacheDirectory: true,
		});
		if (picked.canceled) {
			return;
		}
		const next = [...files];
		const taken = next.map((item) => item.path);
		for (const asset of picked.assets) {
			try {
				const staged = stageCodeAttach({
					filename: asset.name,
					bytes: new Uint8Array(await new File(asset.uri).arrayBuffer()),
					taken,
				});
				taken.push(staged.path);
				next.push(staged);
			} catch (caught) {
				setError(
					shownError(caught instanceof Error ? caught.message : "file type"),
				);
				break;
			}
		}
		setFiles(next);
	}

	async function finishDictation(uri: string) {
		try {
			const heard = (
				await transcribeCode(
					token,
					encodeBase64(new Uint8Array(await new File(uri).arrayBuffer())),
					locale,
				)
			).text.trim();
			if (!heard) {
				return;
			}
			setPrompt((current) =>
				current.trim() ? `${current.trim()} ${heard}` : heard,
			);
		} catch (caught) {
			setError(shownError(caught instanceof Error ? caught.message : ""));
		}
	}

	async function dictate() {
		if (recording) {
			setRecording(false);
			await recorder.stop();
			const uri = recorder.uri;
			if (uri && heardUri.current !== uri) {
				heardUri.current = uri;
				await finishDictation(uri);
			}
			return;
		}
		const perm = await requestRecordingPermissionsAsync();
		if (!perm.granted) {
			setError(t("code.micDenied"));
			return;
		}
		await setAudioModeAsync({
			allowsRecording: true,
			playsInSilentMode: true,
		});
		await recorder.prepareToRecordAsync();
		recorder.record({ forDuration: CODE_STT_MAX_MS / 1000 });
		setRecording(true);
	}

	useEffect(() => {
		if (!recording) {
			return;
		}
		const timer = setInterval(() => {
			if (recorder.isRecording) {
				return;
			}
			const uri = recorder.uri;
			if (!uri || heardUri.current === uri) {
				return;
			}
			heardUri.current = uri;
			setRecording(false);
			void finishDictation(uri);
		}, 400);
		return () => clearInterval(timer);
	}, [recording, recorder]);

	function startVoiceCapture() {
		if (
			(!voiceModeRef.current && !pttRef.current) ||
			voiceHandling.current ||
			voicePreparing.current
		) {
			return;
		}
		try {
			if (recorder.isRecording) {
				return;
			}
			voicePreparing.current = true;
			voiceSource.current = pttRef.current ? "ptt" : "auto";
			void recorder
				.prepareToRecordAsync()
				.then(() => {
					if (
						(!voiceModeRef.current && !pttRef.current) ||
						voiceHandling.current ||
						!recStateRef.current.canRecord
					) {
						return;
					}
					voiceSpeech.current = false;
					voiceLastVoice.current = Date.now();
					voiceArmAt.current = 0;
					recorder.record({ forDuration: CODE_STT_MAX_MS / 1000 });
					setVoiceListening(false);
				})
				.catch(() => {})
				.finally(() => {
					voicePreparing.current = false;
				});
		} catch {
			voicePreparing.current = false;
		}
	}

	function stopVoiceSpeech() {
		const player = voiceSpeaking.current;
		voiceSpeaking.current = null;
		if (player) {
			try {
				player.pause();
				player.remove();
			} catch {
				// already released
			}
		}
		setVoiceSpeakingNow(false);
		const resolve = voiceSpeechResolve.current;
		voiceSpeechResolve.current = null;
		resolve?.();
	}

	function clearSpeechQueue() {
		speechGen.current += 1;
		speechPrefetch.current = [];
		const resolve = voiceSpeechResolve.current;
		voiceSpeechResolve.current = null;
		resolve?.();
		stopVoiceSpeech();
	}

	function stopVoiceEngine() {
		try {
			if (recorder.isRecording) {
				void recorder.stop();
			}
		} catch {
			// ignore
		}
		stopVoiceSpeech();
		setVoiceListening(false);
		setVoiceLevel(0);
	}

	function pttSortedParts(): string[] {
		return [...pttParts.current.entries()]
			.sort((a, b) => a[0] - b[0])
			.map((entry) => entry[1])
			.filter(Boolean);
	}

	async function flushPttParts() {
		const parts = pttSortedParts();
		pttParts.current.clear();
		const combined = parts.join(" ").trim();
		if (combined) {
			await send(combined);
		}
	}

	async function settlePtt(heard: string, seq: number) {
		if (heard) {
			pttParts.current.set(seq, heard);
		}
		if (pttRef.current) {
			pttPending.current -= 1;
			return;
		}
		pttPending.current -= 1;
		if (pttPending.current > 0) {
			return;
		}
		await flushPttParts();
	}

	async function finishVoice(uri: string) {
		clearSpeechQueue();
		setVoiceTranscribing(true);
		const source = voiceSource.current === "ptt" ? "ptt" : "auto";
		const seq = source === "ptt" ? pttSeq.current++ : 0;
		if (source === "ptt") {
			pttPending.current += 1;
		}
		try {
			const heard = codeVoiceUtterance(
				(
					await transcribeCode(
						token,
						encodeBase64(new Uint8Array(await new File(uri).arrayBuffer())),
						locale,
					)
				).text,
			);
			if (source === "ptt") {
				await settlePtt(heard, seq);
				return;
			}
			if (heard) {
				if (view.busy || uploading) {
					voiceQueue.current.push(heard);
					setVoiceQueued(voiceQueue.current.length);
				} else {
					await send(heard);
				}
			}
		} catch (caught) {
			setError(shownError(caught instanceof Error ? caught.message : ""));
			if (source === "ptt") {
				await settlePtt("", seq);
			}
		} finally {
			setVoiceTranscribing(false);
			voiceHandling.current = false;
			if (voiceModeRef.current || pttRef.current) {
				startVoiceCapture();
			} else if (!voiceModeRef.current) {
				stopVoiceEngineRef.current();
			}
		}
	}

	finishVoiceRef.current = finishVoice;
	startVoiceCaptureRef.current = startVoiceCapture;
	stopVoiceEngineRef.current = stopVoiceEngine;

	function beginPtt() {
		if (voiceHandling.current || pttRef.current) {
			return;
		}
		pttRef.current = true;
		pttParts.current.clear();
		setPttHeld(true);
		voiceArmAt.current = 0;
		if (recorder.isRecording) {
			return;
		}
		void (async () => {
			const perm = await requestRecordingPermissionsAsync();
			if (!pttRef.current) {
				return;
			}
			if (!perm.granted) {
				pttRef.current = false;
				setPttHeld(false);
				setError(t("code.micDenied"));
				return;
			}
			await setAudioModeAsync({
				allowsRecording: true,
				playsInSilentMode: true,
			}).catch(() => {});
			if (!pttRef.current) {
				return;
			}
			startVoiceCaptureRef.current();
		})();
	}

	function endPtt() {
		pttRef.current = false;
		setPttHeld(false);
		voiceArmAt.current = 0;
		void (async () => {
			try {
				if (recorder.isRecording) {
					await recorder.stop();
				}
			} catch {
				// ignore
			}
			const uri = recorder.uri;
			if (
				voiceSource.current === "ptt" &&
				voiceSpeech.current &&
				uri &&
				voiceUri.current !== uri
			) {
				voiceUri.current = uri;
				voiceHandling.current = true;
				voiceSpeech.current = false;
				void finishVoiceRef.current(uri);
				return;
			}
			if (pttPending.current > 0) {
				return;
			}
			if (pttParts.current.size > 0) {
				await flushPttParts();
				return;
			}
			if (!voiceModeRef.current) {
				stopVoiceEngineRef.current();
			}
		})();
	}

	beginPttRef.current = beginPtt;
	endPttRef.current = endPtt;

	function makeSpeechItem(text: string, gen: number): SpeechItem {
		return {
			text,
			gen,
			state: "queued",
			promise: Promise.resolve(),
			audio: "",
		};
	}

	async function fetchSpeech(item: SpeechItem): Promise<void> {
		if (item.state !== "queued") {
			return;
		}
		let settle = () => {};
		item.promise = new Promise<void>((resolve) => {
			settle = resolve;
		});
		item.state = "fetching";
		try {
			const audio = (await speakCode(token, item.text, locale)).audio;
			if (!audio) {
				item.state = "failed";
				return;
			}
			if (item.gen !== speechGen.current) {
				item.state = "failed";
				return;
			}
			item.audio = audio;
			item.state = "ready";
		} catch (caught) {
			setError(shownError(caught instanceof Error ? caught.message : ""));
			item.state = "failed";
		} finally {
			settle();
		}
	}

	async function prefetchSpeechQueue(): Promise<void> {
		if (speechFetching.current) {
			return;
		}
		speechFetching.current = true;
		try {
			while (speechPrefetch.current.length > 0) {
				const item = speechPrefetch.current.find(
					(entry) => entry.state === "queued",
				);
				if (!item) {
					return;
				}
				await fetchSpeech(item);
			}
		} finally {
			speechFetching.current = false;
		}
	}

	function playSpeech(item: SpeechItem): Promise<void> {
		return new Promise<void>((resolve) => {
			try {
				stopVoiceSpeech();
				speechFileIndex.current += 1;
				let replyPath = "";
				let file: File | null = null;
				try {
					const target = new File(
						Paths.cache,
						`code-reply-${speechFileIndex.current}.mp3`,
					);
					try {
						target.delete();
					} catch {
						// absent
					}
					target.write(decodeBase64(item.audio));
					replyPath = target.uri;
					file = target;
				} catch {
					replyPath = "";
					file = null;
				}
				const player = createAudioPlayer(
					{ uri: replyPath || `data:audio/mpeg;base64,${item.audio}` },
					{ updateInterval: 200 },
				);
				const done = () => {
					const settle = voiceSpeechResolve.current;
					voiceSpeechResolve.current = null;
					if (voiceSpeaking.current === player) {
						voiceSpeaking.current = null;
						try {
							player.remove();
						} catch {
							// released
						}
						if (file) {
							try {
								file.delete();
							} catch {
								// absent
							}
						}
						setVoiceSpeakingNow(false);
					}
					settle?.();
					resolve();
				};
				voiceSpeaking.current = player;
				voiceSpeechResolve.current = done;
				setVoiceSpeakingNow(true);
				voiceFloor.current = -160;
				voiceFloorAt.current = Date.now();
				voiceBarge.current = 0;
				const sub = player.addListener("playbackStatusUpdate", (status) => {
					if (!status.didJustFinish) {
						return;
					}
					sub.remove();
					done();
				});
				player.play();
			} catch (caught) {
				setError(shownError(caught instanceof Error ? caught.message : ""));
				resolve();
			}
		});
	}

	function dropSpeechItem(item: SpeechItem) {
		const index = speechPrefetch.current.indexOf(item);
		if (index !== -1) {
			speechPrefetch.current.splice(index, 1);
		}
	}

	function pumpSpeech() {
		if (speechPlaying.current) {
			void prefetchSpeechQueue();
			return;
		}
		if (speechPrefetch.current.length === 0) {
			return;
		}
		speechPlaying.current = true;
		void (async () => {
			try {
				while (speechPrefetch.current.length > 0) {
					const item = speechPrefetch.current[0];
					if (!item) {
						break;
					}
					if (
						item.gen !== speechGen.current ||
						item.state === "failed" ||
						(!voiceModeRef.current && !voiceReplyRef.current)
					) {
						dropSpeechItem(item);
						continue;
					}
					if (item.state === "queued") {
						await fetchSpeech(item);
					} else if (item.state === "fetching") {
						await item.promise;
					}
					if (
						item.gen !== speechGen.current ||
						item.state !== "ready" ||
						(!voiceModeRef.current && !voiceReplyRef.current)
					) {
						dropSpeechItem(item);
						continue;
					}
					void prefetchSpeechQueue();
					await playSpeech(item);
					dropSpeechItem(item);
				}
			} finally {
				speechPlaying.current = false;
			}
		})();
	}

	function enqueueSpeech(text: string) {
		const clean = codeSpokenText(text).trim();
		if (!clean) {
			return;
		}
		speechPrefetch.current.push(makeSpeechItem(clean, speechGen.current));
		pumpSpeech();
	}

	function voiceTick() {
		if (!voiceModeRef.current && !pttRef.current) {
			return;
		}
		if (voiceHandling.current) {
			return;
		}
		const state = recStateRef.current;
		const metering = state.metering ?? -160;
		const loud = metering >= CODE_VOICE_METER_DB;
		setVoiceLevel(loud ? Math.max(0, Math.min(1, (metering + 60) / 45)) : 0.04);
		if (voiceSpeaking.current) {
			const now = Date.now();
			if (now - voiceFloorAt.current < CODE_VOICE_FLOOR_MS) {
				if (metering > voiceFloor.current) {
					voiceFloor.current = metering;
				}
				voiceBarge.current = 0;
			} else {
				const gate = Math.max(
					CODE_VOICE_BARGE_DB,
					voiceFloor.current + CODE_VOICE_BARGE_FLOOR_DB,
				);
				if (metering >= gate) {
					voiceBarge.current += 1;
					if (voiceBarge.current >= 2) {
						voiceBarge.current = 0;
						clearSpeechQueue();
					}
				} else {
					voiceBarge.current = 0;
				}
			}
			return;
		}
		const now = Date.now();
		if (loud) {
			if (!voiceArmAt.current) {
				voiceArmAt.current = now;
			} else if (now - voiceArmAt.current >= CODE_VOICE_ARM_MS) {
				voiceSpeech.current = true;
				voiceLastVoice.current = now;
				setVoiceListening(true);
			}
		} else {
			voiceArmAt.current = 0;
		}
		if (!state.isRecording) {
			if (voiceSpeech.current) {
				const uri = recorder.uri;
				if (uri && voiceUri.current !== uri) {
					voiceUri.current = uri;
					voiceHandling.current = true;
					voiceSpeech.current = false;
					void finishVoiceRef.current(uri);
					return;
				}
			} else if (voiceModeRef.current || pttRef.current) {
				startVoiceCaptureRef.current();
			}
			return;
		}
		if (
			voiceSpeech.current &&
			state.durationMillis > CODE_VOICE_MIN_MS &&
			voiceSource.current !== "ptt" &&
			now - voiceLastVoice.current > CODE_VOICE_SILENCE_MS
		) {
			void recorder.stop().catch(() => {});
		}
	}

	voiceTickRef.current = voiceTick;

	// biome-ignore lint/correctness/useExhaustiveDependencies: voice engine is ref-driven and reads the latest render through refs
	useEffect(() => {
		voiceModeRef.current = voiceMode;
		if (!voiceMode || mode === "home") {
			if (!pttRef.current) {
				stopVoiceEngineRef.current();
			}
			return;
		}
		for (const turn of view.turns) {
			if (turn.role === "assistant") {
				voiceSpoken.current.add(turn.id);
				speechSpoken.current.set(turn.id, codeSpeechBlocks(turn.text).length);
			}
		}
		let cancelled = false;
		void (async () => {
			const perm = await requestRecordingPermissionsAsync();
			if (cancelled) {
				return;
			}
			if (!perm.granted) {
				setError(t("code.micDenied"));
				setVoiceMode(false);
				return;
			}
			await setAudioModeAsync({
				allowsRecording: true,
				playsInSilentMode: true,
			}).catch(() => {});
			if (cancelled) {
				return;
			}
			startVoiceCaptureRef.current();
		})();
		return () => {
			cancelled = true;
			if (!pttRef.current) {
				stopVoiceEngineRef.current();
			}
		};
	}, [voiceMode, mode]);

	useEffect(() => {
		if ((!voiceMode && !pttHeld) || mode === "home") {
			return;
		}
		const timer = setInterval(() => voiceTickRef.current(), 200);
		return () => clearInterval(timer);
	}, [voiceMode, pttHeld, mode]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: drains the voice queue through refs and send()
	useEffect(() => {
		if (view.busy || uploading) {
			return;
		}
		if (voiceQueue.current.length === 0) {
			return;
		}
		const next = voiceQueue.current.shift();
		setVoiceQueued(voiceQueue.current.length);
		if (!next) {
			return;
		}
		const timer = setTimeout(() => {
			void send(next);
		}, 200);
		return () => clearTimeout(timer);
	}, [view.busy, uploading, view.sessionID]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: streams <speech> blocks through refs and enqueueSpeech()
	useEffect(() => {
		if (!voiceMode && !voiceReply) {
			return;
		}
		if (voiceHandling.current) {
			return;
		}
		for (const turn of view.turns) {
			if (turn.role !== "assistant") {
				continue;
			}
			const blocks = codeSpeechBlocks(turn.text);
			const spoken = speechSpoken.current.get(turn.id) ?? 0;
			if (blocks.length <= spoken) {
				continue;
			}
			speechSpoken.current.set(turn.id, blocks.length);
			for (let index = spoken; index < blocks.length; index += 1) {
				enqueueSpeech(blocks[index] ?? "");
			}
		}
	}, [voiceMode, view.turns]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: speaks settled turns through refs and enqueueSpeech()
	useEffect(() => {
		if (!voiceMode && !voiceReply) {
			clearSpeechQueue();
			return;
		}
		if (voiceSpeaking.current || voiceHandling.current) {
			return;
		}
		if (view.busy || uploading) {
			return;
		}
		if (
			view.questions.some((item) => item.sessionID === view.sessionID) ||
			view.permissions.some((item) => item.sessionID === view.sessionID)
		) {
			return;
		}
		const turn = [...view.turns]
			.reverse()
			.find(
				(item) =>
					item.role === "assistant" &&
					!item.pending &&
					!voiceSpoken.current.has(item.id),
			);
		if (!turn) {
			return;
		}
		voiceSpoken.current.add(turn.id);
		const blocks = codeSpeechBlocks(turn.text);
		if (blocks.length > 0) {
			const spoken = speechSpoken.current.get(turn.id) ?? 0;
			for (let index = spoken; index < blocks.length; index += 1) {
				enqueueSpeech(blocks[index] ?? "");
			}
			speechSpoken.current.set(turn.id, blocks.length);
			return;
		}
		enqueueSpeech(turn.text);
	}, [
		voiceMode,
		view.busy,
		uploading,
		view.turns,
		view.questions,
		view.permissions,
		view.sessionID,
	]);

	useEffect(() => {
		if (!token) {
			return;
		}
		void getVoiceSettings(token)
			.then((result) => {
				setVoiceProvider(codeVoiceProvider(result.provider));
			})
			.catch(() => setVoiceProvider("workers-ai"));
	}, [token]);

	useEffect(() => {
		const waiting =
			(voiceMode || voiceTranscribing) &&
			!voiceListening &&
			!voiceSpeakingNow &&
			!pttHeld &&
			(view.busy || uploading || voiceTranscribing);
		if (!waiting) {
			return;
		}
		const timer = setInterval(() => setVoicePulse((n) => n + 1), 150);
		return () => clearInterval(timer);
	}, [
		voiceMode,
		pttHeld,
		voiceListening,
		voiceSpeakingNow,
		voiceTranscribing,
		view.busy,
		uploading,
	]);

	async function send(override?: string) {
		const typed = (override ?? prompt).trim();
		const staged = files;
		if (!typed && staged.length === 0) {
			return;
		}
		if (!repo) {
			return;
		}
		if (view.busy || uploading) {
			if (override) {
				voiceQueue.current.push(override);
				setVoiceQueued(voiceQueue.current.length);
			}
			return;
		}
		setUploading(true);
		if (!override) {
			setPrompt("");
		}
		setFiles([]);
		let text = "";
		// Speech directive is injected once per session: the first voice-directed
		// message carries it, later turns keep it from the transcript.
		const wantsSpeech = Boolean(override) || voiceModeRef.current;
		const existingSessionID = mode === "session" ? view.sessionID : "";
		const injectSpeechDirective =
			wantsSpeech &&
			(!existingSessionID ||
				speechDirectiveSentRef.current !== existingSessionID);
		try {
			text = codeAttachPrompt(typed, staged);
			text = codeAppendSpeechDirective(
				text,
				injectSpeechDirective,
				voiceProvider,
			);
			if (override && !voiceModeRef.current) {
				voiceReplyRef.current = true;
				setVoiceReply(true);
				for (const turn of view.turns) {
					if (turn.role === "assistant") {
						voiceSpoken.current.add(turn.id);
						speechSpoken.current.set(
							turn.id,
							codeSpeechBlocks(turn.text).length,
						);
					}
				}
			} else if (!override && !voiceModeRef.current) {
				voiceReplyRef.current = false;
				setVoiceReply(false);
			}
		} catch (caught) {
			setPrompt(typed);
			setFiles(staged);
			setUploading(false);
			setError(shownError(caught instanceof Error ? caught.message : ""));
			return;
		}
		try {
			for (const file of staged.filter((item) => item.use !== "context")) {
				await uploadBoardFile(token, selected, repo, file.path, {
					...(file.base64
						? { base64: file.base64 }
						: { text: file.text ?? "" }),
				});
			}
		} catch (caught) {
			setPrompt(typed);
			setFiles(staged);
			setUploading(false);
			setError(shownError(caught instanceof Error ? caught.message : ""));
			return;
		}
		setUploading(false);
		let sessionID = mode === "session" ? view.sessionID : "";
		if (!sessionID) {
			const data = await run({ repo, op: "create" });
			const created = opencodeSessions(data ? [data] : [])[0];
			if (!created) {
				setPrompt(text);
				return;
			}
			sessionID = created.id;
			setView((current) => ({
				...current,
				sessions: [
					created,
					...current.sessions.filter((item) => item.id !== created.id),
				],
				sessionID: created.id,
				turns: [],
			}));
			setMode("session");
			replaceCodeNav({ mode: "session", sessionID });
		}
		setView((current) => ({
			...current,
			busy: true,
			turns: [...current.turns, pendingOpencodeTurn(text)],
		}));
		const sent = await run({
			repo,
			op: "prompt",
			sessionID,
			text,
			...opencodePromptFields(model, effort),
		});
		if (!sent) {
			setView((current) => ({ ...current, busy: false }));
		}
		if (sent && injectSpeechDirective) {
			speechDirectiveSentRef.current = sessionID;
		}
	}

	async function abort() {
		if (!view.sessionID) {
			return;
		}
		await run({ repo, op: "abort", sessionID: view.sessionID });
		setView((current) => ({ ...current, busy: false }));
	}

	function beginReply() {
		if (replying.current) {
			return false;
		}
		replying.current = true;
		setReplyBusy(true);
		return true;
	}

	function endReply() {
		replying.current = false;
		setReplyBusy(false);
	}

	async function quietOpencode(call: Omit<OpencodeClientCall, "uuid">) {
		try {
			return await opencodeCall(token, { ...call, uuid: selected });
		} catch {
			return undefined;
		}
	}

	async function recoverPrompts(sessionID: string) {
		if (!token || !selected || !repo || !sessionID) {
			return;
		}
		const [questions, permissions, messages] = await Promise.all([
			quietOpencode({ repo, op: "questions" }),
			quietOpencode({ repo, op: "permissions" }),
			quietOpencode({ repo, op: "messages", sessionID }),
		]);
		setView((current) => {
			if (current.sessionID !== sessionID) {
				return current;
			}
			const next = recoverOpencodePrompts(current, sessionID, {
				...(questions === undefined ? {} : { questions }),
				...(permissions === undefined ? {} : { permissions }),
				...(messages === undefined ? {} : { messages }),
			});
			storeOpencodePrompts(sessionID, next.questions, next.permissions);
			for (const item of [...next.questions, ...next.permissions]) {
				if (item.sessionID !== sessionID) {
					continue;
				}
				held.current.add(item.id);
				if (item.callID) {
					held.current.add(item.callID);
				}
			}
			releaseSettledPromptHolds(held.current, next, sessionID);
			return next;
		});
	}

	async function replyPermission(
		permissionID: string,
		response: OpencodePermissionResponse,
	) {
		if (!beginReply()) {
			return;
		}
		const sessionID = view.sessionID;
		held.current.add(permissionID);
		try {
			const sent = await run({
				repo,
				op: "permission",
				sessionID,
				permissionID,
				response,
			});
			if (!opencodeReplyAccepted(sent)) {
				await recoverPrompts(sessionID);
				return;
			}
			held.current.delete(permissionID);
			setView((current) => ({
				...current,
				permissions: current.permissions.filter(
					(item) => item.id !== permissionID,
				),
			}));
		} finally {
			endReply();
		}
	}

	async function questionRequestID(current: {
		id: string;
		sessionID: string;
		callID?: string;
		prompts: { question: string }[];
	}) {
		if (current.id.startsWith("que")) {
			return current.id;
		}
		const listed = await run({ repo, op: "questions" });
		if (!listed) {
			return "";
		}
		const requestID = matchOpencodeQuestionID(
			current,
			opencodeQuestions(listed) ?? [],
		);
		if (!requestID) {
			setError(t("code.questionNotReady"));
		}
		return requestID;
	}

	function answerQuestion(reject: boolean) {
		const current = activeOpencodeQuestion(view.questions, view.sessionID);
		if (!current || replying.current) {
			return;
		}
		if (!reject && current.prompts.some((item) => !promptAnswer(item))) {
			return;
		}
		if (!beginReply()) {
			return;
		}
		const sessionID = current.sessionID;
		held.current.add(current.id);
		void questionRequestID(current)
			.then(async (requestID) => {
				if (!requestID) {
					held.current.delete(current.id);
					await recoverPrompts(sessionID);
					return;
				}
				held.current.add(requestID);
				const sent = await run({
					repo,
					op: "question",
					requestID,
					...(reject
						? { reject: true }
						: {
								answers: current.prompts.map((item) => [promptAnswer(item)]),
							}),
				});
				if (!opencodeReplyAccepted(sent)) {
					await recoverPrompts(sessionID);
					return;
				}
				held.current.delete(current.id);
				held.current.delete(requestID);
				clearQuestionDraft();
				setView((viewCurrent) => ({
					...viewCurrent,
					questions: viewCurrent.questions.filter(
						(item) => item.id !== current.id && item.id !== requestID,
					),
				}));
			})
			.finally(() => {
				endReply();
			});
	}

	const ink = { color: colors.text };
	const muted = { color: colors.muted };
	const row = {
		height: 40,
		justifyContent: "center" as const,
		paddingHorizontal: 12,
		borderRadius: 6,
	};
	const needle = query.trim().toLowerCase();
	const visible = filterCodeSessions(view.sessions, query);
	const bucketTitle = {
		today: t("code.today"),
		yesterday: t("code.yesterday"),
		earlier: t("code.earlier"),
	};
	const grouped = (["today", "yesterday", "earlier"] as const)
		.map((id) => ({
			id,
			title: bucketTitle[id],
			sessions: visible.filter(
				(item) => opencodeSessionBucket(item.updated) === id,
			),
		}))
		.filter((group) => group.sessions.length > 0);
	const title = codeSessionTitle(
		view.sessions,
		view.sessionID,
		t("code.sessions"),
	);
	const owner = codeRepoOwner(repos, repo);
	const permission = view.permissions.find(
		(item) => item.sessionID === view.sessionID,
	);
	const question = activeOpencodeQuestion(view.questions, view.sessionID);
	const blocked = Boolean(permission || question);

	function composer(disabled: boolean, composerBlocked = false) {
		const sendDisabled =
			!view.busy &&
			((!prompt.trim() && files.length === 0) ||
				disabled ||
				composerBlocked ||
				uploading);
		const toolsDisabled = disabled || composerBlocked || uploading;
		const mention = codeMentionAt(prompt, caret);
		const mentionKey = mention ? `${mention.start}:${mention.query}` : "";
		const mentionLive =
			Boolean(mention) && mentionOff !== mentionKey && !toolsDisabled;
		const matches =
			mentionLive && mention
				? filterCodeMentions(boardPaths, mention.query)
				: [];
		const voicePhase =
			pttHeld || voiceListening
				? "listening"
				: voiceTranscribing
					? "processing"
					: voiceSpeakingNow
						? "speaking"
						: view.busy || uploading
							? "waiting"
							: "idle";
		const voiceLabel = voiceTranscribing
			? t("code.voiceTranscribing")
			: voiceSpeakingNow
				? t("code.voiceSpeaking")
				: voiceListening || voicePhase === "idle"
					? t("code.voiceListening")
					: t("code.voiceThinking");
		const bars = [0, 1, 2, 3, 4, 5, 6];
		return (
			<View style={{ margin: 12, gap: 8 }}>
				{voiceMode || voiceTranscribing || pttHeld ? (
					<View
						accessibilityLiveRegion="polite"
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: 10,
							borderWidth: 1,
							borderRadius: 10,
							paddingHorizontal: 10,
							paddingVertical: 5,
							borderColor: colors.primary,
							backgroundColor: colors.chipBg,
						}}
					>
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: 3,
								height: 22,
							}}
							aria-hidden
						>
							{bars.map((bar) => {
								const gain = 1 - Math.abs(bar - 3) / 4;
								const pulsing =
									voicePhase === "waiting" || voicePhase === "processing";
								const scale = pulsing
									? 0.25 + 0.55 * Math.abs(Math.sin(voicePulse / 2))
									: 0.2 + voiceLevel * gain * 0.8;
								return (
									<View
										key={bar}
										style={{
											width: 3,
											height: 22,
											borderRadius: 2,
											backgroundColor:
												voicePhase === "idle" ? colors.muted : colors.primary,
											transform: [{ scaleY: scale }],
											opacity: pulsing ? 0.7 : 1,
										}}
									/>
								);
							})}
						</View>
						<Text
							numberOfLines={1}
							style={{
								flex: 1,
								color: colors.text,
								fontSize: 12,
								opacity: 0.8,
							}}
						>
							{voiceQueued > 0
								? `${t("code.voiceQueued", { n: voiceQueued })} · ${voiceLabel}`
								: voiceLabel}
						</Text>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t("code.voiceStop")}
							onPress={() => setVoiceMode(false)}
							hitSlop={8}
							style={{ padding: 4 }}
						>
							<Text style={{ color: colors.text, fontSize: 13 }}>×</Text>
						</Pressable>
					</View>
				) : null}
				{mentionLive ? (
					<View
						style={{
							maxHeight: 180,
							borderRadius: 10,
							borderWidth: 1,
							borderColor: colors.border,
							backgroundColor: colors.surface,
							overflow: "hidden",
						}}
					>
						{matches.length === 0 ? (
							<Text style={{ color: colors.muted, padding: 10 }}>
								{t("code.mentionEmpty")}
							</Text>
						) : (
							matches.map((path) => (
								<Pressable
									key={path}
									accessibilityRole="button"
									onPress={() => void pickMention(path)}
									style={{ paddingHorizontal: 10, paddingVertical: 8 }}
								>
									<Text style={{ color: colors.text }} numberOfLines={1}>
										{path.split("/").pop()}
									</Text>
									<Text
										style={{ color: colors.muted, fontSize: 11 }}
										numberOfLines={1}
									>
										{path}
									</Text>
								</Pressable>
							))
						)}
					</View>
				) : null}
				{files.length > 0 ? (
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
						{files.map((file) => (
							<View
								key={file.id}
								style={{
									flexDirection: "row",
									alignItems: "center",
									maxWidth: 220,
									borderRadius: 999,
									paddingLeft: 8,
									backgroundColor: colors.chipBg,
								}}
							>
								<Text
									numberOfLines={1}
									style={{ color: colors.text, fontSize: 12, flexShrink: 1 }}
								>
									{file.source === "board" ? file.path : file.name}
								</Text>
								{file.source === "board" ? null : (
									<Pressable
										accessibilityRole="button"
										accessibilityLabel={
											file.use === "context"
												? t("code.attachUseBoard", { name: file.name })
												: t("code.attachUseContext", { name: file.name })
										}
										disabled={uploading}
										onPress={() =>
											setFiles((current) =>
												current.map((item) =>
													item.id === file.id
														? {
																...item,
																use:
																	item.use === "context"
																		? "project"
																		: "context",
															}
														: item,
												),
											)
										}
										style={{ paddingHorizontal: 6, paddingVertical: 4 }}
									>
										<Text style={{ color: colors.primary, fontSize: 11 }}>
											{file.use === "context"
												? t("code.attachContext")
												: t("code.attachBoard")}
										</Text>
									</Pressable>
								)}
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={t("code.removeFile", { name: file.name })}
									disabled={uploading}
									onPress={() =>
										setFiles((current) =>
											current.filter((item) => item.id !== file.id),
										)
									}
									style={{ padding: 6 }}
								>
									<Text style={{ color: colors.text, fontSize: 12 }}>×</Text>
								</Pressable>
							</View>
						))}
					</View>
				) : null}
				<View
					style={{
						flexDirection: "column",
						alignItems: "stretch",
						gap: 8,
						borderRadius: 12,
						padding: 8,
						backgroundColor: colors.chipBg,
						borderWidth: 1,
						borderColor: composerFocused ? colors.text : colors.border,
					}}
				>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: 4,
						}}
					>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t("code.attach")}
							disabled={toolsDisabled}
							onPress={() => void addPicked()}
							style={{
								width: 40,
								height: 40,
								alignItems: "center",
								justifyContent: "center",
								borderRadius: 8,
								opacity: toolsDisabled ? 0.35 : 1,
							}}
						>
							<Text style={{ color: colors.text, fontSize: 20 }}>+</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={
								recording ? t("code.dictating") : t("code.dictate")
							}
							disabled={toolsDisabled}
							onPress={() => void dictate()}
							style={{
								width: 40,
								height: 40,
								alignItems: "center",
								justifyContent: "center",
								borderRadius: 8,
								backgroundColor: recording ? colors.text : "transparent",
								opacity: toolsDisabled ? 0.35 : 1,
							}}
						>
							<Text
								style={{
									color: recording ? colors.surface : colors.text,
									fontSize: 13,
								}}
							>
								{recording ? "●" : "M"}
							</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={
								voiceMode ? t("code.voiceStop") : t("code.voiceMode")
							}
							accessibilityState={{ selected: voiceMode }}
							disabled={toolsDisabled}
							onPress={() => setVoiceMode((current) => !current)}
							style={{
								width: 40,
								height: 40,
								alignItems: "center",
								justifyContent: "center",
								borderRadius: 8,
								backgroundColor: voiceMode ? colors.text : "transparent",
								opacity: toolsDisabled ? 0.35 : 1,
							}}
						>
							<Text
								style={{
									color: voiceMode ? colors.surface : colors.text,
									fontSize: 13,
								}}
							>
								∿
							</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t("code.ptt")}
							accessibilityState={{ selected: pttHeld }}
							disabled={toolsDisabled}
							onPressIn={() => beginPttRef.current()}
							onPressOut={() => endPttRef.current()}
							style={{
								width: 40,
								height: 40,
								alignItems: "center",
								justifyContent: "center",
								borderRadius: 8,
								backgroundColor: pttHeld ? colors.text : "transparent",
								opacity: toolsDisabled ? 0.35 : 1,
							}}
						>
							<Text
								style={{
									color: pttHeld ? colors.surface : colors.text,
									fontSize: 15,
								}}
							>
								●
							</Text>
						</Pressable>
					</View>
					<View
						style={{
							flexDirection: "row",
							alignItems: "flex-end",
							gap: 8,
						}}
					>
						<TextInput
							value={prompt}
							placeholder={t("code.placeholder")}
							placeholderTextColor={colors.placeholder}
							editable={!disabled}
							multiline
							onChangeText={(value) => {
								setPrompt(value);
								setCaret(value.length);
							}}
							onSelectionChange={(event) =>
								setCaret(event.nativeEvent.selection.start)
							}
							onFocus={() => setComposerFocused(true)}
							onBlur={() => setComposerFocused(false)}
							style={{
								flex: 1,
								color: colors.text,
								maxHeight: 120,
								minHeight: 44,
								paddingVertical: 10,
								fontSize: 15,
							}}
						/>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={view.busy ? t("code.stop") : t("code.send")}
							disabled={sendDisabled}
							onPress={() => void (view.busy ? abort() : send())}
							style={{
								width: 44,
								height: 44,
								borderRadius: 10,
								alignItems: "center",
								justifyContent: "center",
								backgroundColor: view.busy ? "transparent" : colors.text,
								borderWidth: view.busy ? 1.5 : 0,
								borderColor: colors.text,
								opacity: sendDisabled ? 0.35 : 1,
							}}
						>
							<Text
								style={{
									color: view.busy ? colors.text : colors.surface,
									fontSize: 16,
								}}
							>
								{view.busy ? "■" : "↑"}
							</Text>
						</Pressable>
					</View>
				</View>
			</View>
		);
	}

	if (!selected) {
		return (
			<View
				style={{
					flex: 1,
					alignItems: "center",
					justifyContent: "center",
					gap: 8,
				}}
			>
				<Text style={muted}>{t("code.pickBoard")}</Text>
				<Pressable onPress={() => setTab("pair")}>
					<Text style={{ color: colors.text, fontWeight: "600" }}>
						{t("code.pairBoard")}
					</Text>
				</Pressable>
			</View>
		);
	}

	const selectedDevice = devices.find((item) => item.uuid === selected);
	const selectedModel = boards.find((item) => item.device.uuid === selected)
		?.status?.model;

	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			{devices.length > 1 ? (
				<View style={{ paddingHorizontal: 8, paddingTop: 8 }}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t("code.board")}
						onPress={() => setPicker("board")}
						style={({ pressed }) => ({
							alignSelf: "flex-start",
							flexDirection: "row",
							alignItems: "center",
							gap: 6,
							maxWidth: "100%",
							borderRadius: 8,
							borderWidth: 1,
							borderColor:
								pressed || picker === "board" ? colors.text : colors.border,
							paddingHorizontal: 10,
							paddingVertical: 6,
							backgroundColor: pressed ? colors.border : colors.chipBg,
						})}
					>
						<Text style={{ color: colors.muted, fontSize: 12 }}>
							{t("code.board")}
						</Text>
						<Text
							style={{ color: colors.text, fontSize: 12, flexShrink: 1 }}
							numberOfLines={1}
						>
							{boardChipName(selectedDevice)}
						</Text>
						{boardChipHint(selectedDevice, selectedModel) ? (
							<Text style={{ color: colors.muted, fontSize: 11 }}>
								{boardChipHint(selectedDevice, selectedModel)}
							</Text>
						) : null}
						<Text style={{ color: colors.text, fontSize: 10 }}>▾</Text>
					</Pressable>
				</View>
			) : null}
			<View
				style={{
					flex: 1,
					margin: 8,
					borderRadius: 10,
					backgroundColor: colors.surface,
					overflow: "hidden",
				}}
			>
				<View
					style={{
						flexDirection: "row",
						borderBottomWidth: 1,
						borderBottomColor: colors.chipBg,
					}}
				>
					{(["files", "chat"] as const).map((item) => (
						<Pressable
							key={item}
							onPress={() => setPane(item)}
							style={{
								paddingHorizontal: 14,
								paddingVertical: 12,
								minHeight: 44,
								justifyContent: "center",
								borderBottomWidth: 2,
								borderBottomColor:
									pane === item ? colors.primary : "transparent",
							}}
						>
							<Text
								style={{
									color: pane === item ? colors.text : colors.muted,
									fontWeight: "600",
								}}
							>
								{item === "files"
									? `${t("code.files")}${filesDirty || filesStale ? " ●" : ""}`
									: t("code.chat")}
							</Text>
						</Pressable>
					))}
				</View>
				{pane === "files" ? (
					<ProjectFiles
						token={token}
						uuid={selected}
						owner={owner}
						name={repo}
						onFileStateChange={({ dirty, stale }) => {
							setFilesDirty(dirty);
							setFilesStale(stale);
						}}
						onEntries={(entries) =>
							setBoardPaths(
								entries
									.filter((item) => item.type === "file")
									.map((item) => item.path),
							)
						}
						onAddContext={addBoardContext}
						onContextRenamed={(from, to) =>
							setFiles((current) => renameContextDrafts(current, from, to))
						}
						onContextRemoved={(path) =>
							setFiles((current) => removeContextDrafts(current, path))
						}
					/>
				) : mode === "home" ? (
					<ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
						<View
							style={{
								marginHorizontal: 8,
								marginTop: 8,
								borderRadius: 8,
								paddingVertical: 4,
								backgroundColor: colors.chipBg,
							}}
						>
							<Text style={[muted, { padding: 12, fontSize: 13 }]}>
								{t("code.projects")}
							</Text>
							{repos.length === 0 ? (
								<View style={{ alignItems: "center", gap: 8, padding: 16 }}>
									<Text style={muted}>{t("code.noProjects")}</Text>
									<Pressable onPress={() => router.push("/project")}>
										<Text style={{ color: colors.text, fontWeight: "600" }}>
											{t("code.openProject")}
										</Text>
									</Pressable>
								</View>
							) : (
								repos.map((item) => (
									<Pressable
										key={`${item.owner}/${item.name}`}
										onPress={() => {
											selectRepo(item.name);
											setMode("home");
										}}
										style={[
											row,
											item.name === repo
												? {
														borderLeftWidth: 2,
														borderLeftColor: colors.text,
													}
												: null,
										]}
									>
										<View style={{ flex: 1 }}>
											<Text style={ink} numberOfLines={1}>
												{item.name}
											</Text>
											{item.owner ? (
												<Text
													style={[muted, { fontSize: 11 }]}
													numberOfLines={1}
												>
													{item.owner}
												</Text>
											) : null}
										</View>
									</Pressable>
								))
							)}
						</View>
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: 8,
								padding: 12,
							}}
						>
							<TextInput
								value={query}
								placeholder={t("code.search")}
								placeholderTextColor={colors.placeholder}
								onChangeText={setQuery}
								style={{
									flex: 1,
									height: 36,
									borderRadius: 6,
									paddingHorizontal: 10,
									color: colors.text,
									backgroundColor: colors.chipBg,
								}}
							/>
							{query ? (
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={t("code.clear")}
									onPress={() => setQuery("")}
								>
									<Text style={{ color: colors.muted, fontWeight: "600" }}>
										{t("code.clear")}
									</Text>
								</Pressable>
							) : null}
							<Pressable disabled={!repo} onPress={openDraft}>
								<Text style={{ color: colors.muted, fontWeight: "600" }}>
									{t("code.newSession")}
								</Text>
							</Pressable>
						</View>
						<Text style={[muted, { paddingHorizontal: 12, fontSize: 12 }]}>
							{reconnecting ? t("code.reconnecting") : t("code.live")}
							{needle
								? `  ${t("code.resultCount", { n: visible.length })}`
								: ""}
						</Text>
						{error ? (
							<Text style={{ color: colors.danger, padding: 12 }}>{error}</Text>
						) : null}
						{sessionsLoading ? (
							<View
								style={{ gap: 8, padding: 16 }}
								accessibilityState={{ busy: true }}
							>
								<Text style={muted}>{t("code.sessionLoading")}</Text>
								<View
									style={{
										height: 40,
										borderRadius: 6,
										backgroundColor: colors.chipBg,
									}}
								/>
								<View
									style={{
										height: 40,
										borderRadius: 6,
										backgroundColor: colors.chipBg,
									}}
								/>
							</View>
						) : view.sessions.length === 0 && !needle ? (
							<View style={{ alignItems: "center", gap: 8, padding: 32 }}>
								<Text style={{ color: colors.text, fontWeight: "600" }}>
									{t("code.emptyTitle")}
								</Text>
								<Text style={[muted, { textAlign: "center" }]}>
									{t("code.emptyBody")}
								</Text>
								<Pressable disabled={!repo} onPress={openDraft}>
									<Text style={{ color: colors.text, fontWeight: "600" }}>
										{t("code.newSession")}
									</Text>
								</Pressable>
							</View>
						) : visible.length === 0 ? (
							<View style={{ alignItems: "center", gap: 8, padding: 32 }}>
								<Text style={{ color: colors.text, fontWeight: "600" }}>
									{t("code.searchEmpty")}
								</Text>
							</View>
						) : (
							grouped.map((group) => (
								<View key={group.id}>
									<Text
										style={[muted, { paddingHorizontal: 12, paddingTop: 12 }]}
									>
										{group.title}
									</Text>
									{group.sessions.map((session) => (
										<View
											key={session.id}
											style={[
												row,
												{
													flexDirection: "row",
													alignItems: "center",
													gap: 8,
												},
											]}
										>
											<Pressable
												onPress={() => openSession(session.id)}
												style={{
													flex: 1,
													flexDirection: "row",
													alignItems: "center",
													gap: 8,
												}}
											>
												<Text style={[ink, { flex: 1 }]} numberOfLines={1}>
													{session.title}
												</Text>
												{session.updated ? (
													<Text style={[muted, { fontSize: 11 }]}>
														{formatSessionTime(session.updated)}
													</Text>
												) : null}
											</Pressable>
											<Pressable
												accessibilityRole="button"
												accessibilityLabel={t("code.deleteSession")}
												onPress={() => askDelete(session.id)}
											>
												<Text style={{ color: colors.danger, fontSize: 12 }}>
													{t("code.delete")}
												</Text>
											</Pressable>
										</View>
									))}
								</View>
							))
						)}
					</ScrollView>
				) : null}
				{mode !== "home" ? (
					<View style={{ flex: 1 }}>
						<View
							style={{
								height: 44,
								flexDirection: "row",
								alignItems: "center",
								paddingHorizontal: 8,
								borderBottomWidth: 1,
								borderBottomColor: colors.border,
							}}
						>
							<Pressable
								onPress={leaveChat}
								style={{ minHeight: 44, justifyContent: "center" }}
							>
								<Text style={{ color: colors.muted, fontWeight: "600" }}>
									{t("code.back")}
								</Text>
							</Pressable>
							<Text
								style={[ink, { flex: 1, marginLeft: 8, fontWeight: "600" }]}
								numberOfLines={1}
							>
								{mode === "session" ? title : ""}
							</Text>
							<Text style={[muted, { fontSize: 12 }]}>
								{reconnecting ? t("code.reconnecting") : t("code.live")}
							</Text>
						</View>
						<ScrollView
							ref={transcript}
							style={{ flex: 1 }}
							onContentSizeChange={() => {
								if (mode === "session") {
									transcript.current?.scrollToEnd({ animated: false });
								}
							}}
							contentContainerStyle={{
								padding: 16,
								gap: 12,
								width: "100%",
								maxWidth: 780,
								alignSelf: "center",
							}}
						>
							{mode === "session"
								? view.turns.map((turn) => (
										<Turn
											key={turn.id}
											turn={turn}
											color={colors.text}
											muted={colors.muted}
											bubble={colors.chipBg}
										/>
									))
								: null}
						</ScrollView>
						{error ? (
							<Pressable
								onPress={() => setError("")}
								style={{ paddingHorizontal: 16 }}
							>
								<Text style={{ color: colors.danger }}>{error}</Text>
							</Pressable>
						) : null}
						{permission ? (
							<View
								style={{
									margin: 12,
									padding: 12,
									borderRadius: 10,
									backgroundColor: colors.chipBg,
								}}
							>
								<Text style={ink}>
									{t("code.permission")}: {permission.title}
								</Text>
								{permission.detail ? (
									<Text style={muted}>{permission.detail}</Text>
								) : null}
								<Pressable
									disabled={replyBusy}
									onPress={() => void replyPermission(permission.id, "once")}
									style={{ minHeight: 44, justifyContent: "center" }}
								>
									<Text style={ink}>{t("code.allowOnce")}</Text>
								</Pressable>
								<Pressable
									disabled={replyBusy}
									onPress={() => void replyPermission(permission.id, "always")}
									style={{ minHeight: 44, justifyContent: "center" }}
								>
									<Text style={ink}>{t("code.allowAlways")}</Text>
								</Pressable>
								<Pressable
									disabled={replyBusy}
									onPress={() => void replyPermission(permission.id, "reject")}
									style={{ minHeight: 44, justifyContent: "center" }}
								>
									<Text style={{ color: colors.danger }}>{t("code.deny")}</Text>
								</Pressable>
							</View>
						) : null}
						{!permission && question ? (
							<View
								style={{
									margin: 12,
									padding: 12,
									borderRadius: 10,
									backgroundColor: colors.chipBg,
								}}
							>
								{(() => {
									const count = question.prompts.length;
									const index = codeQuestionSlideIndex(slide, count, 0);
									const item = question.prompts[index];
									if (!item) {
										return null;
									}
									const typed = custom[item.question] ?? "";
									const picked = picks[item.question] ?? "";
									const ready = Boolean(promptAnswer(item));
									const answered = question.prompts.filter((entry) =>
										promptAnswer(entry),
									).length;
									const allReady = question.prompts.every((entry) =>
										promptAnswer(entry),
									);
									return (
										<View style={{ gap: 10 }}>
											<View
												style={{
													flexDirection: "row",
													alignItems: "center",
													gap: 8,
												}}
											>
												<Text
													style={[muted, { fontSize: 12, fontWeight: "700" }]}
												>
													{t("code.questionOf", {
														current: index + 1,
														total: count,
													})}
												</Text>
												<View style={{ flex: 1, flexDirection: "row", gap: 6 }}>
													{question.prompts.map((entry) => (
														<View
															key={entry.question}
															style={{
																flex: 1,
																height: 4,
																borderRadius: 99,
																backgroundColor: promptAnswer(entry)
																	? colors.text
																	: colors.border,
															}}
														/>
													))}
												</View>
												<Text style={[muted, { fontSize: 12 }]}>
													{t("code.questionsAnswered", {
														done: answered,
														total: count,
													})}
												</Text>
											</View>
											<Text style={[ink, { fontWeight: "600" }]}>
												{item.header ? `${item.header}: ` : ""}
												{item.question}
											</Text>
											{item.options.length > 0 ? (
												<View
													style={{
														flexDirection: "row",
														flexWrap: "wrap",
														gap: 8,
													}}
												>
													{item.options.map((option, optionIndex) => {
														const on = !typed.trim() && picked === option;
														return (
															<Pressable
																key={option}
																accessibilityRole="button"
																onPress={() =>
																	pickChoice(item.question, option)
																}
																style={{
																	flexBasis: "100%",
																	flexGrow: 1,
																	flexDirection: "row",
																	alignItems: "center",
																	gap: 8,
																	minHeight: 48,
																	borderWidth: 1,
																	borderColor: on ? colors.text : colors.border,
																	borderRadius: 8,
																	paddingHorizontal: 10,
																	paddingVertical: 10,
																	backgroundColor: on
																		? colors.text
																		: colors.surface,
																}}
															>
																<View
																	style={{
																		minWidth: 24,
																		height: 24,
																		borderRadius: 6,
																		alignItems: "center",
																		justifyContent: "center",
																		backgroundColor: on
																			? colors.surface
																			: colors.chipBg,
																	}}
																>
																	<Text
																		style={{
																			fontSize: 12,
																			fontWeight: "700",
																			color: on ? colors.text : colors.muted,
																		}}
																	>
																		{optionIndex + 1}
																	</Text>
																</View>
																<Text
																	style={{
																		flex: 1,
																		flexShrink: 1,
																		color: on ? colors.surface : colors.text,
																	}}
																>
																	{option}
																</Text>
															</Pressable>
														);
													})}
												</View>
											) : null}
											<Pressable
												accessibilityRole="button"
												onPress={() => setShowCustom((current) => !current)}
											>
												<Text
													style={{ color: colors.primary, paddingVertical: 2 }}
												>
													{showCustom
														? t("code.hideCustomResponse")
														: typed.trim()
															? t("code.customResponseSet")
															: t("code.customResponseToggle")}
												</Text>
											</Pressable>
											{showCustom ? (
												<TextInput
													value={typed}
													placeholder={t("code.customResponse")}
													placeholderTextColor={colors.placeholder}
													accessibilityLabel={t("code.customResponse")}
													autoComplete="off"
													enterKeyHint={index < count - 1 ? "next" : "send"}
													onChangeText={(text) =>
														setCustom((current) => ({
															...current,
															[item.question]: text,
														}))
													}
													onSubmitEditing={() => {
														if (!ready) {
															return;
														}
														if (index < count - 1) {
															moveQuestion(1);
															return;
														}
														answerQuestion(false);
													}}
													style={{
														borderWidth: 1,
														borderColor: colors.border,
														borderRadius: 6,
														paddingHorizontal: 10,
														paddingVertical: 8,
														color: colors.text,
													}}
												/>
											) : null}
											<View
												style={{
													flexDirection: "row",
													flexWrap: "wrap",
													gap: 8,
												}}
											>
												<Pressable
													accessibilityRole="button"
													accessibilityLabel={t("code.previousQuestion")}
													disabled={index === 0}
													onPress={() => moveQuestion(-1)}
													style={{
														flex: 1,
														flexBasis: "45%",
														alignItems: "center",
														justifyContent: "center",
														minHeight: 44,
														paddingVertical: 10,
														borderRadius: 8,
														backgroundColor: colors.chipBg,
														opacity: index === 0 ? 0.35 : 1,
													}}
												>
													<Text style={ink}>‹ {t("code.stepBack")}</Text>
												</Pressable>
												<Pressable
													accessibilityRole="button"
													accessibilityLabel={t("code.nextQuestion")}
													disabled={index >= count - 1 || !ready}
													onPress={() => moveQuestion(1)}
													style={{
														flex: 1,
														flexBasis: "45%",
														alignItems: "center",
														justifyContent: "center",
														minHeight: 44,
														paddingVertical: 10,
														borderRadius: 8,
														backgroundColor: colors.chipBg,
														opacity: index >= count - 1 || !ready ? 0.35 : 1,
													}}
												>
													<Text style={ink}>{t("code.stepNext")} ›</Text>
												</Pressable>
												<Pressable
													accessibilityRole="button"
													accessibilityLabel={t("code.reply")}
													disabled={replyBusy || !allReady}
													onPress={() => answerQuestion(false)}
													style={{
														flex: 1,
														flexBasis: "45%",
														alignItems: "center",
														justifyContent: "center",
														minHeight: 44,
														paddingVertical: 10,
														borderRadius: 8,
														backgroundColor: colors.text,
														opacity: !replyBusy && allReady ? 1 : 0.35,
													}}
												>
													<Text style={{ color: colors.surface }}>
														{t("code.reply")}
													</Text>
												</Pressable>
												<Pressable
													accessibilityRole="button"
													accessibilityLabel={t("code.reject")}
													disabled={replyBusy}
													onPress={() => answerQuestion(true)}
													style={{
														flex: 1,
														flexBasis: "45%",
														alignItems: "center",
														justifyContent: "center",
														minHeight: 44,
														paddingVertical: 10,
														borderRadius: 8,
														backgroundColor: colors.chipBg,
														opacity: replyBusy ? 0.35 : 1,
													}}
												>
													<Text style={{ color: colors.danger }}>
														{t("code.reject")}
													</Text>
												</Pressable>
											</View>
										</View>
									);
								})()}
							</View>
						) : null}
						{mode === "draft" ? (
							<Text style={[muted, { paddingHorizontal: 16 }]}>
								{t("code.draftHint")}
							</Text>
						) : null}
						<View
							style={{
								flexDirection: "row",
								flexWrap: "wrap",
								gap: 8,
								paddingHorizontal: 16,
								paddingBottom: 4,
							}}
						>
							{mode === "draft" ? (
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={t("code.project")}
									onPress={() => setPicker("project")}
									style={({ pressed }) => ({
										flexDirection: "row",
										alignItems: "center",
										gap: 6,
										borderRadius: 8,
										borderWidth: 1,
										borderColor:
											pressed || picker === "project"
												? colors.text
												: colors.border,
										paddingHorizontal: 10,
										paddingVertical: 6,
										backgroundColor: pressed ? colors.border : colors.chipBg,
									})}
								>
									<Text
										style={{ color: colors.text, fontSize: 12, flexShrink: 1 }}
										numberOfLines={1}
									>
										{codeRepoLabel(
											repos.find((item) => item.name === repo) ?? {
												owner,
												name: repo,
											},
										)}
									</Text>
									<Text style={{ color: colors.text, fontSize: 10 }}>▾</Text>
								</Pressable>
							) : null}
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={t("code.permissionMode")}
								onPress={() => setPicker("permission")}
								style={({ pressed }) => ({
									flexDirection: "row",
									alignItems: "center",
									gap: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor:
										pressed || picker === "permission"
											? colors.text
											: colors.border,
									paddingHorizontal: 10,
									paddingVertical: 6,
									backgroundColor: pressed ? colors.border : colors.chipBg,
								})}
							>
								<Text style={{ color: colors.text, fontSize: 12 }}>
									{permissionModeLabel(permissionMode)}
								</Text>
								<Text style={{ color: colors.text, fontSize: 10 }}>▾</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={t("code.model")}
								onPress={() => setPicker("model")}
								style={({ pressed }) => ({
									flexDirection: "row",
									alignItems: "center",
									gap: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor:
										pressed || picker === "model" ? colors.text : colors.border,
									paddingHorizontal: 10,
									paddingVertical: 6,
									backgroundColor: pressed ? colors.border : colors.chipBg,
								})}
							>
								<Text
									style={{ color: colors.text, fontSize: 12, flexShrink: 1 }}
								>
									{chosenModel?.name ?? model}
								</Text>
								<Text style={{ color: colors.muted, fontSize: 11 }}>
									{chosenModel?.provider}
								</Text>
								<Text style={{ color: colors.text, fontSize: 10 }}>▾</Text>
							</Pressable>
							{reasoning ? (
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={t("code.effort")}
									onPress={() => setPicker("effort")}
									style={({ pressed }) => ({
										flexDirection: "row",
										alignItems: "center",
										gap: 6,
										borderRadius: 8,
										borderWidth: 1,
										borderColor:
											pressed || picker === "effort"
												? colors.text
												: colors.border,
										paddingHorizontal: 10,
										paddingVertical: 6,
										backgroundColor: pressed ? colors.border : colors.chipBg,
									})}
								>
									<Text style={{ color: colors.text, fontSize: 12 }}>
										{effort === "low"
											? t("code.effortLow")
											: effort === "high"
												? t("code.effortHigh")
												: t("code.effortMedium")}
									</Text>
									<Text style={{ color: colors.text, fontSize: 10 }}>▾</Text>
								</Pressable>
							) : null}
						</View>
						<Modal
							visible={
								picker === "model" ||
								picker === "effort" ||
								picker === "permission" ||
								picker === "project"
							}
							transparent
							animationType="fade"
							onRequestClose={() => setPicker("")}
						>
							<Pressable
								onPress={() => setPicker("")}
								style={{
									flex: 1,
									justifyContent: "flex-end",
									backgroundColor: "rgba(0,0,0,0.4)",
									paddingBottom: 56 + Math.max(insets.bottom, 8),
								}}
							>
								<Pressable
									onPress={() => undefined}
									style={{
										maxHeight: "70%",
										borderTopLeftRadius: 12,
										borderTopRightRadius: 12,
										backgroundColor: colors.surface,
										padding: 12,
									}}
								>
									<Text style={[ink, { fontWeight: "600", marginBottom: 8 }]}>
										{picker === "effort"
											? t("code.effort")
											: picker === "permission"
												? t("code.permissionMode")
												: picker === "project"
													? t("code.project")
													: t("code.model")}
									</Text>
									<ScrollView
										style={{ maxHeight: 360 }}
										contentContainerStyle={{ paddingBottom: 12 }}
									>
										{picker === "project"
											? repos.map((item) => (
													<Pressable
														key={`${item.owner}/${item.name}`}
														onPress={() => {
															selectRepo(item.name);
															setPicker("");
														}}
														style={({ pressed }) => ({
															flexDirection: "row",
															alignItems: "center",
															gap: 12,
															paddingVertical: 12,
															paddingHorizontal: 8,
															borderRadius: 8,
															backgroundColor: pressed
																? colors.chipBg
																: "transparent",
														})}
													>
														<Text style={[ink, { flex: 1 }]} numberOfLines={1}>
															{item.name}
														</Text>
														{item.owner ? (
															<Text style={[muted, { fontSize: 12 }]}>
																{item.owner}
															</Text>
														) : null}
													</Pressable>
												))
											: picker === "effort"
												? (["low", "medium", "high"] as const).map((item) => (
														<Pressable
															key={item}
															onPress={() => {
																setEffort(item);
																void storageSet(OPENCODE_EFFORT_KEY, item);
																setPicker("");
															}}
															style={{ paddingVertical: 12 }}
														>
															<Text style={ink}>
																{item === "low"
																	? t("code.effortLow")
																	: item === "high"
																		? t("code.effortHigh")
																		: t("code.effortMedium")}
															</Text>
														</Pressable>
													))
												: picker === "permission"
													? OPENCODE_PERMISSION_MODES.map((item) => (
															<Pressable
																key={item}
																onPress={() => {
																	selectPermissionMode(item);
																	setPicker("");
																}}
																style={{ paddingVertical: 12 }}
															>
																<Text style={ink}>
																	{permissionModeLabel(item)}
																</Text>
																{item === "full" ? (
																	<Text style={[muted, { fontSize: 12 }]}>
																		{t("code.permissionFullHint")}
																	</Text>
																) : null}
															</Pressable>
														))
													: modelChoices.map((item) => (
															<Pressable
																key={item.id}
																onPress={() => {
																	const next = opencodeStoredModel(item.id);
																	setModel(next);
																	void storageSet(OPENCODE_MODEL_KEY, next);
																	setPicker("");
																}}
																style={({ pressed }) => ({
																	flexDirection: "row",
																	alignItems: "center",
																	gap: 12,
																	paddingVertical: 12,
																	paddingHorizontal: 8,
																	borderRadius: 8,
																	backgroundColor: pressed
																		? colors.chipBg
																		: "transparent",
																})}
															>
																<Text
																	style={[ink, { flex: 1 }]}
																	numberOfLines={1}
																>
																	{item.name}
																</Text>
																<Text style={[muted, { fontSize: 12 }]}>
																	{item.provider}
																</Text>
															</Pressable>
														))}
									</ScrollView>
								</Pressable>
							</Pressable>
						</Modal>
						{blocked ? (
							<Text style={[muted, { paddingHorizontal: 16 }]}>
								{t("code.blockedComposer")}
							</Text>
						) : null}
						{composer(!repo, blocked)}
					</View>
				) : null}
			</View>
			<Modal
				visible={picker === "board"}
				transparent
				animationType="fade"
				onRequestClose={() => setPicker("")}
			>
				<Pressable
					onPress={() => setPicker("")}
					style={{
						flex: 1,
						justifyContent: "flex-end",
						backgroundColor: "rgba(0,0,0,0.4)",
						paddingBottom: 56 + Math.max(insets.bottom, 8),
					}}
				>
					<Pressable
						onPress={() => undefined}
						style={{
							maxHeight: "70%",
							borderTopLeftRadius: 12,
							borderTopRightRadius: 12,
							backgroundColor: colors.surface,
							padding: 12,
						}}
					>
						<Text style={[ink, { fontWeight: "600", marginBottom: 8 }]}>
							{t("code.board")}
						</Text>
						<ScrollView
							style={{ maxHeight: 360 }}
							contentContainerStyle={{ paddingBottom: 12 }}
						>
							{devices.map((item) => {
								const model = boards.find(
									(board) => board.device.uuid === item.uuid,
								)?.status?.model;
								return (
									<Pressable
										key={item.uuid}
										onPress={() => {
											setUuid(item.uuid);
											setPicker("");
										}}
										style={({ pressed }) => ({
											flexDirection: "row",
											alignItems: "center",
											gap: 12,
											paddingVertical: 12,
											paddingHorizontal: 8,
											borderRadius: 8,
											backgroundColor:
												pressed || item.uuid === selected
													? colors.chipBg
													: "transparent",
										})}
									>
										<Text style={[ink, { flex: 1 }]} numberOfLines={1}>
											{boardChipName(item)}
										</Text>
										{boardChipHint(item, model) ? (
											<Text style={[muted, { fontSize: 12 }]}>
												{boardChipHint(item, model)}
											</Text>
										) : null}
									</Pressable>
								);
							})}
						</ScrollView>
					</Pressable>
				</Pressable>
			</Modal>
		</View>
	);
}

function stackStatus(parts: OpencodePart[]): "running" | "error" | "done" {
	if (parts.some((part) => part.status === "running")) {
		return "running";
	}
	if (parts.some((part) => part.status === "error")) {
		return "error";
	}
	return "done";
}

function toolInfo(
	part: OpencodePart,
	inputLabel: string,
	outputLabel: string,
): string {
	const chunks: string[] = [];
	if (part.input) {
		chunks.push(`${inputLabel}\n${part.input}`);
	}
	if (part.output) {
		chunks.push(`${outputLabel}\n${part.output}`);
	}
	return chunks.join("\n\n");
}

function ToolStack({
	parts,
	color,
	muted,
}: {
	parts: OpencodePart[];
	color: string;
	muted: string;
}) {
	const t = useT();
	const colors = useColors();
	const running = parts.some((part) => part.status === "running");
	const touched = useRef(false);
	const [open, setOpen] = useState(running);
	const [info, setInfo] = useState("");
	useEffect(() => {
		if (!touched.current) {
			setOpen(running);
		}
	}, [running]);
	const names = [
		...new Set(parts.map((part) => part.tool).filter(Boolean)),
	].join(", ");
	const label =
		parts.length === 1
			? names
			: t("code.toolStack", { n: parts.length, names });
	const status = stackStatus(parts);
	return (
		<View style={{ gap: 4 }}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				onPress={() => {
					touched.current = true;
					setOpen((value) => !value);
				}}
			>
				<Text style={{ color: status === "error" ? colors.warning : muted }}>
					{open ? "▾" : "▸"} {label}
				</Text>
			</Pressable>
			{open
				? parts.map((part) => {
						const body = toolInfo(
							part,
							t("code.toolInput"),
							t("code.toolOutput"),
						);
						return (
							<View key={part.id} style={{ paddingLeft: 12, gap: 4 }}>
								<Pressable
									accessibilityRole="button"
									accessibilityState={{ expanded: info === part.id }}
									onPress={() =>
										setInfo((current) => (current === part.id ? "" : part.id))
									}
								>
									<Text style={{ color: muted }}>
										{part.tool}
										{part.text ? `  ${part.text}` : ""}
									</Text>
								</Pressable>
								{info === part.id && body ? (
									<ScrollView horizontal nestedScrollEnabled>
										<Text
											style={{
												color,
												fontFamily: "monospace",
												fontSize: 12,
												backgroundColor: colors.chipBg,
												padding: 8,
												borderRadius: 8,
											}}
										>
											{body}
										</Text>
									</ScrollView>
								) : null}
							</View>
						);
					})
				: null}
		</View>
	);
}

function Turn({
	turn,
	color,
	muted,
	bubble,
}: {
	turn: OpencodeTurn;
	color: string;
	muted: string;
	bubble: string;
}) {
	return (
		<View style={{ gap: 6 }}>
			{turn.role === "user" ? (
				<View
					style={{
						backgroundColor: bubble,
						borderRadius: 8,
						paddingHorizontal: 12,
						paddingVertical: 8,
					}}
				>
					<Text style={{ color, fontWeight: "600" }}>{turn.text}</Text>
				</View>
			) : (
				opencodeToolStacks(turn.parts).map((block) =>
					block.type === "text" ? (
						<Blocks key={block.id} text={block.text} color={color} />
					) : (
						<ToolStack
							key={block.id}
							parts={block.parts}
							color={color}
							muted={muted}
						/>
					),
				)
			)}
		</View>
	);
}
