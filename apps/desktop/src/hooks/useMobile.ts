import { useEffect, useState } from "react";

export const MOBILE_QUERY = "(max-width: 899px)";

export default function useMobile() {
	const [mobile, setMobile] = useState(false);

	useEffect(() => {
		const media = window.matchMedia(MOBILE_QUERY);
		const sync = () => {
			setMobile(media.matches);
		};
		sync();
		media.addEventListener("change", sync);
		return () => media.removeEventListener("change", sync);
	}, []);

	return mobile;
}
