import { useEffect } from "react";

interface RedirectProps {
	to: string;
}

const Redirect = ({ to }: RedirectProps) => {
	useEffect(() => {
		window.location.href = to; // Perform a full page reload to the given URL
	}, [to]);

	// Optionally render a fallback spinner or message
	return null;
};

export default Redirect;
