const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const i18nRoot = path.resolve(__dirname, "../../packages/core/src/i18n");
const coreSrc = path.resolve(__dirname, "../../packages/core/src");
config.watchFolders = [...(config.watchFolders ?? []), i18nRoot, coreSrc];
config.resolver.extraNodeModules = {
	...(config.resolver.extraNodeModules ?? {}),
	"gpio-companion-i18n": i18nRoot,
	"gpio-companion-ui": path.join(coreSrc, "ui.ts"),
	"gpio-companion-embed": path.join(coreSrc, "breadboard-embed.ts"),
	"gpio-companion-model": path.join(coreSrc, "model-view.ts"),
	"gpio-companion-wifi": path.join(coreSrc, "wifi.ts"),
	"gpio-companion-pairing": path.join(coreSrc, "pairing.ts"),
	"gpio-companion-opencode": path.join(coreSrc, "opencode-session.ts"),
	"gpio-companion-files": path.join(coreSrc, "board-files.ts"),
	"gpio-companion-attach": path.join(coreSrc, "code-attach.ts"),
	"gpio-companion-jlcpcb": path.join(coreSrc, "jlcpcb-parts.ts"),
};

module.exports = config;
