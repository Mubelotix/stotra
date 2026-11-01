import { Schema, model } from "mongoose";

const RefreshBudget = model("QuoteRefreshBudget", new Schema({
	_id: String,
	attempts: [Date],
}));

// One shared rolling-hour budget: 100 normally, up to 200 total for trades only.
// Failed requests also consume a slot, including across server restarts.
export async function reserveQuoteRefresh(forTrade = false): Promise<boolean> {
	const now = new Date();
	const recentAttempts = {
		$filter: {
			input: "$attempts",
			as: "attempt",
			cond: { $gt: ["$$attempt", new Date(now.getTime() - 60 * 60 * 1000)] },
		},
	};

	try {
		await RefreshBudget.updateOne(
			{ _id: "yahoo-quotes" },
			{ $setOnInsert: { attempts: [] } },
			{ upsert: true },
		);
	} catch (error: any) {
		// Another server may have initialized the same budget concurrently.
		if (error.code !== 11000) throw error;
	}

	const reservation = await RefreshBudget.findOneAndUpdate(
		{ _id: "yahoo-quotes", $expr: { $lt: [{ $size: recentAttempts }, forTrade ? 200 : 100] } },
		[{ $set: { attempts: { $concatArrays: [recentAttempts, [now]] } } }],
	);
	return reservation !== null;
}
