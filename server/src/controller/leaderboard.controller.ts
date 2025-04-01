import { Request, Response } from "express";
import User from "../models/user.model";
import { fetchStockData } from "../utils/requests";

import dotenv from "dotenv";
dotenv.config();
const leaderboardCacheTTL = parseInt(process.env.STOTRA_LEADERBOARD_CACHE_TTL || "600");

import NodeCache from "node-cache";
const cache = new NodeCache({ stdTTL: leaderboardCacheTTL });

const getLeaderboard = (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Leaderboard']
	*/
	if (cache.has("leaderboard")) {
		const leaderboard = cache.get("leaderboard");
		res.status(200).send({ users: leaderboard });
		return;
	}

	getLeaderboardTopN(-1)
		.then((users) => {
			cache.set("leaderboard", users);
			res.status(200).send({ users });
		})
		.catch((err: { message: any }) => {
			res.status(500).send({ message: err.message });
		});
};

export async function getLeaderboardTopN(
	n: number,
): Promise<{ username: string; value: number }[]> {
	// 1. Collate all unique stock symbols from users' positions using Aggregation
	const symbolsAggregation = await User.aggregate([
		{ $unwind: "$positions" },
		{ $group: { _id: "$positions.symbol" } },
	]);
	const uniqueSymbols: string[] = symbolsAggregation.map((entry) => entry._id);

	// 2. Fetch stock prices in batches of 100 with 55ms delay between them
	const stockPrices: { [key: string]: number } = {};
	async function fetchStockPricesInBatches() {
		for (let i = 0; i < uniqueSymbols.length; i += 100) {
			const batch = uniqueSymbols.slice(i, i + 100);
			const results = await Promise.allSettled(batch.map((symbol) => fetchStockData(symbol)));

			results.forEach((result, index) => {
				if (result.status === "fulfilled") {
					stockPrices[batch[index]] = result.value.regularMarketPrice;
				} else {
					stockPrices[batch[index]] = 0; // Could not load this stock
				}
			});
	
			// Wait 55ms before fetching the next batch, except for the last batch
			if (i + 100 < uniqueSymbols.length) {
				await new Promise((resolve) => setTimeout(resolve, 55));
			}
		}
	}
	await fetchStockPricesInBatches();

	// 3. Compute portfolio values for each user using projection
	const usersWithPositions = await User.find(
		{},
		{ username: 1, positions: 1, cash: 1 },
	);

	const userValues: { username: string; value: number }[] = [];
	usersWithPositions.forEach((user) => {
		let totalValue = user.cash;
		user.positions.forEach((position) => {
			const currentPrice = stockPrices[position.symbol];
			totalValue += currentPrice * position.quantity;
		});
		userValues.push({ username: user.username, value: totalValue });
	});

	// 5. Sort and pick top N users
	userValues.sort((a, b) => b.value - a.value);

	return userValues;
}

export default { getLeaderboard };
