import User from "../models/user.model";
import Quote from "../models/quote.model";
import { BenchmarkHistory, StatisticsCache } from "../models/statistics.model";
import { BenchmarkPrices, calculateStatistics, getInvestors } from "./statistics";
import { reserveQuoteRefresh } from "./quoteRefreshLimit";
import { refreshStockPrices, yahooFinance } from "./requests";

const hour = 3600000;
let pending: Promise<ReturnType<typeof calculateStatistics> | undefined> | undefined;

async function loadBenchmark(symbol: string, firstTrade?: number): Promise<BenchmarkPrices> {
	const cached = await BenchmarkHistory.findById(symbol).lean();
	if (firstTrade === undefined || !await reserveQuoteRefresh()) return cached ?? { symbol, prices: [] };
	try {
		// Only two history requests per hourly computation, both charged to the NORMAL budget.
		const history = await yahooFinance.chart(symbol, {
			period1: new Date(Math.floor(firstTrade / 86400000) * 86400000),
			period2: new Date(),
			interval: "1d",
			return: "array",
		});
		const prices = history.quotes.flatMap(point => typeof point.close === "number" && point.close > 0
			? [{ date: point.date.getTime(), close: point.close }] : []);
		if (!prices.length) throw new Error("Empty benchmark history for " + symbol);
		const result = { symbol, prices, updatedAt: new Date() };
		await BenchmarkHistory.updateOne({ _id: symbol }, { $set: result }, { upsert: true });
		return result;
	} catch (error) {
		console.error("Error refreshing benchmark " + symbol + ":", error);
		return cached ?? { symbol, prices: [] };
	}
}

async function recompute() {
	try {
		await StatisticsCache.updateOne({ _id: "public" }, { $setOnInsert: { attemptedAt: new Date(0) } }, { upsert: true });
	} catch (error: any) {
		if (error.code !== 11000) throw error;
	}
	// Persistent claim prevents failures, restarts, or multiple processes
	// from multiplying computation or Yahoo requests within the hour.
	const claimed = await StatisticsCache.findOneAndUpdate({
		_id: "public", attemptedAt: { $lte: new Date(Date.now() - hour) },
	}, { $set: { attemptedAt: new Date() } });
	if (!claimed) return (await StatisticsCache.findById("public").lean())?.snapshot;
	const users = await User.find({}, { cash: 1, positions: 1, ledger: 1 }).lean();
	const symbols = [...new Set(users.flatMap(user => [
		...user.positions.map(position => position.symbol), ...user.ledger.map(trade => trade.symbol),
	]))];
	const investors = getInvestors(users, [], Date.now());
	const firstTrade = investors.length ? Math.min(...investors.map(investor => investor.firstTrade)) : undefined;
	const histories = [];
	for (const symbol of ["BTC-USD", "^GSPC"]) histories.push(await loadBenchmark(symbol, firstTrade));
	// Benchmarks and held assets share the normal budget; never use the trade reserve.
	await refreshStockPrices(users.flatMap(user => user.positions.filter(position => position.quantity > 0).map(position => position.symbol)));
	const quotes = await Quote.find({ _id: { $in: symbols } }).lean();
	const snapshot = calculateStatistics(users, quotes, histories);
	await StatisticsCache.updateOne({ _id: "public" }, { $set: { snapshot } });
	return snapshot;
}

export function refreshPublicStatistics() {
	if (!pending) pending = recompute().finally(() => { pending = undefined; });
	return pending;
}

// Public requests are cache-only, even if the snapshot is stale or still being prepared.
export async function getPublicStatistics() {
	return (await StatisticsCache.findById("public").lean())?.snapshot;
}

export function startStatisticsRefresh() {
	const tick = () => { void refreshPublicStatistics().catch(error => console.error("Error refreshing public statistics:", error)); };
	tick();
	// Check the persisted hourly deadline, including after a server restart.
	const timer = setInterval(tick, 60000);
	timer.unref();
	return timer;
}
