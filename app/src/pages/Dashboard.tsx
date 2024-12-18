import {
	Box,
	Flex,
	Spacer,
	Heading,
	useBreakpointValue,
	Text,
	Button,
	useTheme,
} from "@chakra-ui/react";
import PortfolioPreview from "../components/PortfolioPreview";
import React, { useEffect, useState } from "react";
import PositionsList from "../components/PositionsList";
import Newsfeed from "../components/Newsfeed";
import Watchlist from "../components/Watchlist";
import { Link } from "react-router-dom";

export default function Dashboard() {
	const isOnMobile = useBreakpointValue({ base: true, md: false });
	const [showPopup, setShowPopup] = useState(false);

	let accentColor = useTheme()["components"]["Link"]["baseStyle"]["color"].split(".")[0];

	useEffect(() => {
		const popupClosed = localStorage.getItem("popupClosed");
		if (!popupClosed) {
			setShowPopup(true);
		}
	}, []);
	
	const handleClosePopup = () => {
		setShowPopup(false);
		localStorage.setItem("popupClosed", "true");
	};

	return (
		<Box className="Dashboard">
			{/* Popup Section */}
			{showPopup && (
				<Flex
					bg={accentColor + ".500"}
					color="white"
					p="4"
					borderRadius="base"
					marginBottom="45"
					alignItems="center"
					justifyContent="space-between"
					fontWeight="500"
				>
					<Text>
						Bienvenue sur notre simulateur de trading ! Vous partez avec un capital de $10k, essayez de vous hisser sur le{" "}
						<Box as="span" textDecoration="underline" fontWeight="600">
							<Link to="/leaderboard">leaderboard</Link>
						</Box>.
					</Text>
					<Button colorScheme="white" variant="outline" onClick={handleClosePopup}>
						Close
					</Button>
				</Flex>
			)}

			<Flex direction={{ base: "column", md: "row" }} gap={5}>
				<Box flex="0.75">
					<PortfolioPreview />
					{!isOnMobile && (
						<>
							<Spacer height={10} />
							<Heading size="md">Stock Market News</Heading>
							<Spacer height={2} />
							<Newsfeed symbol={""} />
						</>
					)}
				</Box>
				<Box
					flex="0.25"
					borderWidth={{ base: 0, md: 1 }}
					borderRadius="md"
					p={{ base: 0, md: 3 }}
					height={"fit-content"}
				>
					<>
						<PositionsList />
						<Spacer h="3" />
						<Watchlist />
					</>
				</Box>
			</Flex>
			{isOnMobile && (
				<>
					<Spacer height={10} />
					<Heading size="md">Stock Market News</Heading>
					<Spacer height={2} />
					<Newsfeed symbol={""} />
				</>
			)}
		</Box>
	);
}
