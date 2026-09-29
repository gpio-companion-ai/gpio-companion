import Box from "@shpaw415/mui-lite/Box";

export default function DevicesLayout({
	children,
}: {
	children: React.JSX.Element;
}) {
	return (
		<Box className="b6-device-scope" sx={{ minWidth: 0, width: "100%" }}>
			<Box className="b6-device-body">{children}</Box>
		</Box>
	);
}
