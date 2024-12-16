import {
	Box,
	Flex,
	Spacer,
	Heading,
	useBreakpointValue,
} from "@chakra-ui/react";
import PortfolioPreview from "../components/PortfolioPreview";
import React from "react";
import PositionsList from "../components/PositionsList";
import Newsfeed from "../components/Newsfeed";
import Watchlist from "../components/Watchlist";

export default function Dashboard() {
	const isOnMobile = useBreakpointValue({ base: true, md: false });

	return (
		<Box className="Dashboard">
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
