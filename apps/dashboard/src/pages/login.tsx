import Redirect from "@components/Redirect";

// Backward-compatible stub: sign-in is a blocking modal now, not a page.
export default function LoginPage() {
	return <Redirect to="/project" />;
}
