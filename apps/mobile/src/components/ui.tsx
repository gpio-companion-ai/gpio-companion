import type { ReactNode, Ref } from "react";
import {
	ActivityIndicator,
	Pressable,
	type ScrollView,
	Text,
	TextInput,
	View,
	type ViewStyle,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useColors } from "../lib/color-mode.tsx";

export function Screen({
	children,
	scroll = true,
	scrollRef,
}: {
	children: ReactNode;
	scroll?: boolean;
	scrollRef?: Ref<ScrollView>;
}) {
	const colors = useColors();
	if (!scroll) {
		return (
			<View
				style={{
					flex: 1,
					backgroundColor: colors.bg,
					paddingHorizontal: 12,
					paddingTop: 8,
				}}
			>
				{children}
			</View>
		);
	}
	return (
		<KeyboardAwareScrollView
			ref={scrollRef}
			style={{ flex: 1, backgroundColor: colors.bg }}
			contentContainerStyle={{
				paddingHorizontal: 12,
				paddingTop: 8,
				paddingBottom: 16,
				gap: 10,
			}}
			bottomOffset={16}
			keyboardShouldPersistTaps="handled"
		>
			{children}
		</KeyboardAwareScrollView>
	);
}

export function Title({ children }: { children: ReactNode }) {
	const colors = useColors();
	return (
		<Text style={{ fontSize: 22, fontWeight: "600", color: colors.text }}>
			{children}
		</Text>
	);
}

export function Body({ children }: { children: ReactNode }) {
	const colors = useColors();
	return <Text style={{ color: colors.text }}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
	const colors = useColors();
	return <Text style={{ color: colors.muted }}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
	const colors = useColors();
	if (!children) {
		return null;
	}
	return <Text style={{ color: colors.danger }}>{children}</Text>;
}

export function Paper({
	children,
	onPress,
	selected,
}: {
	children: ReactNode;
	onPress?: () => void;
	selected?: boolean;
}) {
	const colors = useColors();
	const style: ViewStyle = {
		backgroundColor: colors.surface,
		borderRadius: 14,
		padding: 12,
		borderWidth: 1,
		borderColor: selected ? colors.primary : colors.border,
		gap: 8,
		...(selected ? { borderLeftWidth: 4, paddingLeft: 9 } : undefined),
	};
	if (onPress) {
		return (
			<Pressable style={style} onPress={onPress}>
				{children}
			</Pressable>
		);
	}
	return <View style={style}>{children}</View>;
}

export function PrimaryButton({
	label,
	onPress,
	disabled,
}: {
	label: string;
	onPress: () => void;
	disabled?: boolean;
}) {
	const colors = useColors();
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			style={{
				backgroundColor: colors.primary,
				padding: 14,
				borderRadius: 999,
				alignItems: "center",
				opacity: disabled ? 0.6 : 1,
			}}
		>
			<Text style={{ color: colors.primaryText, fontWeight: "600" }}>
				{label}
			</Text>
		</Pressable>
	);
}

export function TextButton({
	label,
	onPress,
	disabled,
	danger,
}: {
	label: string;
	onPress: () => void;
	disabled?: boolean;
	danger?: boolean;
}) {
	const colors = useColors();
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			style={{ opacity: disabled ? 0.6 : 1, paddingVertical: 8 }}
		>
			<Text
				style={{
					color: danger ? colors.danger : colors.primary,
					fontWeight: "600",
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

export function Chip({
	label,
	tone = "muted",
	onPress,
	filled,
}: {
	label: string;
	tone?: "muted" | "primary" | "success" | "warning" | "danger";
	onPress?: () => void;
	filled?: boolean;
}) {
	const colors = useColors();
	const map = {
		muted: colors.muted,
		primary: colors.primary,
		success: colors.success,
		warning: colors.warning,
		danger: colors.danger,
	};
	const color = map[tone];
	const inner = (
		<View
			style={{
				borderWidth: 1,
				borderColor: color,
				backgroundColor: filled ? colors.chipBg : "transparent",
				borderRadius: 999,
				paddingHorizontal: 10,
				paddingVertical: 4,
			}}
		>
			<Text style={{ color, fontSize: 12, fontWeight: "600" }}>{label}</Text>
		</View>
	);
	if (onPress) {
		return <Pressable onPress={onPress}>{inner}</Pressable>;
	}
	return inner;
}

export function Field({
	label,
	value,
	onChangeText,
	placeholder,
	secure,
	autoCapitalize = "none",
	multiline,
}: {
	label: string;
	value: string;
	onChangeText: (value: string) => void;
	placeholder?: string;
	secure?: boolean;
	autoCapitalize?: "none" | "sentences";
	multiline?: boolean;
}) {
	const colors = useColors();
	return (
		<View style={{ gap: 6 }}>
			<Text style={{ color: colors.text, fontWeight: "600" }}>{label}</Text>
			<TextInput
				value={value}
				onChangeText={onChangeText}
				placeholder={placeholder}
				placeholderTextColor={colors.placeholder}
				secureTextEntry={secure}
				autoCapitalize={multiline ? "sentences" : autoCapitalize}
				autoCorrect={Boolean(multiline)}
				multiline={multiline}
				textAlignVertical={multiline ? "top" : "center"}
				style={{
					backgroundColor: colors.surface,
					borderRadius: 10,
					padding: 12,
					color: colors.text,
					borderWidth: 1,
					borderColor: colors.border,
					minHeight: multiline ? 96 : undefined,
				}}
			/>
		</View>
	);
}

export function Skeleton({ height = 88 }: { height?: number }) {
	const colors = useColors();
	return (
		<View
			style={{
				height,
				borderRadius: 14,
				backgroundColor: colors.chipBg,
				opacity: 0.8,
			}}
		/>
	);
}

export function Busy({ show }: { show: boolean }) {
	if (!show) {
		return null;
	}
	return <ActivityIndicator />;
}

export function Row({ children }: { children: ReactNode }) {
	return (
		<View
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				gap: 8,
				alignItems: "center",
			}}
		>
			{children}
		</View>
	);
}
