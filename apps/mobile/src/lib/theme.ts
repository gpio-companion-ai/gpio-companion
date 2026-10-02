export type ColorMode = "light" | "dark";

export type Colors = {
	bg: string;
	surface: string;
	text: string;
	muted: string;
	placeholder: string;
	border: string;
	primary: string;
	voiceAgent: string;
	primaryText: string;
	danger: string;
	success: string;
	warning: string;
	chipBg: string;
};

export const palettes: Record<ColorMode, Colors> = {
	light: {
		bg: "#edf3f1",
		surface: "#f9fbfa",
		text: "#17211f",
		muted: "#5a6966",
		placeholder: "#5a6966",
		border: "#c5d0cd",
		primary: "#006b60",
		voiceAgent: "#7651b0",
		primaryText: "#ffffff",
		danger: "#c5221f",
		success: "#176b45",
		warning: "#b4540a",
		chipBg: "#e0ebe8",
	},
	dark: {
		bg: "#090b10",
		surface: "#0d1118",
		text: "#e9eef4",
		muted: "#8595a8",
		placeholder: "#8595a8",
		border: "#1e2836",
		primary: "#00d4ff",
		voiceAgent: "#c7a2ff",
		primaryText: "#04121a",
		danger: "#f85149",
		success: "#3fb950",
		warning: "#d29922",
		chipBg: "#0a0e15",
	},
};

export const colors = palettes.light;
