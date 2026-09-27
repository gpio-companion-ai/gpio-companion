const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const i18nRoot = path.resolve(__dirname, "../../packages/core/src/i18n");
const coreSrc = path.resolve(__dirname, "../../packages/core/src");
config.watchFolders = [...(config.watchFolders ?? []), i18nRoot, coreSrc];
config.resolver.extraNodeModules = {
	...(config.resolver.extraNodeModules ?? {}),
	"gpio-companion-i18n": i18nRoot,
	"gpio-companion-embed": path.join(coreSrc, "breadboard-embed.ts"),
	"gpio-companion-wifi": path.join(coreSrc, "wifi.ts"),
	"gpio-companion-pairing": path.join(coreSrc, "pairing.ts"),
};

module.exports = config;
