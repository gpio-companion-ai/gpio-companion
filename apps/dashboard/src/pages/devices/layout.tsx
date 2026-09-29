import Box from "@shpaw415/mui-lite/Box";

export default function DevicesLayout({
	children,
}: {
	children: React.JSX.Element;
}) {
	return (
		<Box sx={{ minWidth: 0, width: "100%" }}>
			<Box>{children}</Box>
		</Box>
	);
}
