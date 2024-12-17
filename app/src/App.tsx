import React, { lazy, Suspense } from "react";
import Navbar from "./components/Navbar";
import { Container, Box, Spacer, Text, Link, Spinner } from "@chakra-ui/react";
import { Navigate, Route, Routes } from "react-router-dom";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const StockView = lazy(() => import("./pages/StockView"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
import NotFound from "./pages/NotFound";
import Redirect from "./components/Redirect";

export type Transaction = {
	symbol: string;
	purchasePrice: number;
	quantity: number;
	date: Date;
	type: "buy" | "sell";
};

export type Position = {
	symbol: string;
	longName: string;
	purchasePrice: number;
	purchaseDate: Date;
	quantity: number;
	regularMarketPrice: number;
	regularMarketPreviousClose: number;
	regularMarketChangePercent: number;
};

function App() {
	// Stock format: {symbol, count, price}
	// const [selectedAction, setSelectedAction] = useState("buy");
	// const [selelectedStock, setSelectedStock] = useState({
	// 	symbol: "",
	// 	price: 0,
	// });

	// const [selectedPrice, setSelectedPrice] = useState(0);

	return (
		<>
			<Navbar />
			<Container maxW="container.xl">
				<Spacer h="10" />
				<Box>
					<Suspense fallback={<Spinner />}>
						<Routes>
							<Route path="/" element={<Dashboard />}></Route>

							<Route path="/login" element={<Redirect to="/api/login" />}></Route>
							<Route path="/logout" element={<Redirect to="/api/logout" />}></Route>

							<Route path="/leaderboard" element={<Leaderboard />}></Route>

							<Route path="/stocks/:symbol" element={<StockView />}></Route>

							{/* Add 404*/}
							<Route path="*" element={<NotFound />}></Route>
						</Routes>
					</Suspense>
				</Box>
			</Container>
			<Box textAlign="center" py="10">
				<Text fontSize="sm" color="gray.500">
					Built by{" "}
					<Link href="https://spike.codes" fontWeight="bold">
						Spike
					</Link>{" "}
					and{" "}
					<Link href="https://github.com/Mubelotix" fontWeight="bold">
						Mubelotix
					</Link>{" "}
					on{" "}
					<Link href="https://github.com/Mubelotix/stotra" fontWeight="bold">
						GitHub
					</Link>
				</Text>
			</Box>
		</>
	);
}

export default App;
