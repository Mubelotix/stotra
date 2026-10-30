import { Request, Response } from "express";
import User from "../models/user.model";
import Quote from "../models/quote.model";

const getLeaderboard = async (_req: Request, res: Response) => {
	/*
	#swagger.tags = ['Leaderboard']
	*/
	try {
		res.status(200).send({ users: await getLeaderboardTopN(-1) });
	} catch (error: any) {
		res.status(500).send({ message: error.message });
	}
};

export async function getLeaderboardTopN(n: number): Promise<{ username: string; value: number }[]> {
	const users = await User.find({}, { username: 1, positions: 1, cash: 1 });
	const symbols = [...new Set(users.flatMap(user => user.positions.map(position => position.symbol)))];
	// Never contact Yahoo here: ranks use the last known persisted prices, even if stale.
	const quotes = await Quote.find({ _id: { $in: symbols } }).lean();
	const prices = new Map(quotes.map(quote => [quote._id, quote.data?.regularMarketPrice ?? 0]));
	const values = users.map(user => ({
		username: user.username,
		value: user.positions.reduce(
			(total, position) => total + (prices.get(position.symbol) ?? 0) * position.quantity,
			user.cash,
		),
	}));
	values.sort((a, b) => b.value - a.value);
	return n < 0 ? values : values.slice(0, n);
}

export default { getLeaderboard };
