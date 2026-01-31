import "../styles/globals.css";

export const metadata = {
	title: "Export xLog Data",
	description: "Export your xLog data",
	icons: {
		icon: "/favicon.ico",
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
