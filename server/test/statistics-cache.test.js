const assert = require("node:assert/strict");
const { test, beforeEach, afterEach, mock } = require("node:test");
const User = require("../dist/src/models/user.model").default;
const Quote = require("../dist/src/models/quote.model").default;
const { StatisticsCache, BenchmarkHistory } = require("../dist/src/models/statistics.model");
const limiter = require("../dist/src/utils/quoteRefreshLimit");
const requests = require("../dist/src/utils/requests");
const { yahooFinance } = requests;
const { getPublicStatistics, refreshPublicStatistics, startStatisticsRefresh } = require("../dist/src/utils/publicStatistics");
const { startingCash } = require("../dist/src/utils/config");

const now = Date.now();
let record, histories, yahoo, reserve, reads, warm;
beforeEach(() => {
	mock.timers.enable({ apis: ["Date"], now });
	record = null;
	histories = new Map();
	mock.method(StatisticsCache, "findById", () => ({ lean: async () => record }));
	mock.method(StatisticsCache, "updateOne", async (_filter, update) => {
		if (!record) record = { _id: "public", ...update.$setOnInsert };
		if (update.$set) Object.assign(record, update.$set);
	});
	mock.method(StatisticsCache, "findOneAndUpdate", async (filter, update) => {
		if (record.attemptedAt > filter.attemptedAt.$lte) return null;
		const previous = { ...record };
		Object.assign(record, update.$set);
		return previous;
	});
	reads = mock.method(User, "find", () => ({ lean: async () => [{ cash: 50, positions: [{ symbol: "A", quantity: 1 }], ledger: [{ symbol: "A", price: 50, quantity: 1, type: "buy", date: now - 86400000 }] }] }));
	mock.method(Quote, "find", () => ({ lean: async () => [{ _id: "A", data: { regularMarketPrice: 60, quoteType: "EQUITY" }, updatedAt: new Date(now) }] }));
	mock.method(BenchmarkHistory, "findById", symbol => ({ lean: async () => histories.get(symbol) ?? null }));
	mock.method(BenchmarkHistory, "updateOne", async (filter, update) => { histories.set(filter._id, update.$set); });
	reserve = mock.method(limiter, "reserveQuoteRefresh", async () => true);
	yahoo = mock.method(yahooFinance, "chart", async () => ({ quotes: [{ date: new Date(now - 86400000), close: 10 }, { date: new Date(now), close: 12 }] }));
	warm = mock.method(requests, "refreshStockPrices", async () => {});
	mock.method(console, "error", () => {});
});
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

test("concurrent worker ticks compute once, warming held quotes after benchmarks and before saving statistics", async () => {
	warm.mock.mockImplementation(async symbols => {
		assert.deepEqual(symbols, ["A"]);
		assert.equal(yahoo.mock.callCount(), 2);
		assert.equal(record.snapshot, undefined);
	});
	const values = await Promise.all(Array.from({ length: 30 }, () => refreshPublicStatistics()));
	assert.equal(reads.mock.callCount(), 1);
	assert.equal(yahoo.mock.callCount(), 2);
	assert.equal(reserve.mock.callCount(), 2);
	assert.ok(reserve.mock.calls.every(call => call.arguments.length === 0));
	assert.ok(values.every(value => value.stockValue === 60));
	assert.equal(record.snapshot.returns.value, 110);
	assert.equal(record.snapshot.benchmarks[0].value, startingCash * 1.2);
	assert.equal(warm.mock.callCount(), 1);
	// A fresh module represents restarting the server; it still uses the Mongo snapshot.
	delete require.cache[require.resolve("../dist/src/utils/publicStatistics")];
	const restarted = require("../dist/src/utils/publicStatistics");
	assert.deepEqual(await restarted.getPublicStatistics(), values[0]);
	assert.equal(reads.mock.callCount(), 1);
	assert.equal(yahoo.mock.callCount(), 2);
});

test("worker refreshes hourly without page visits; public reads never schedule work, even for missing or stale snapshots", async () => {
	assert.equal(await getPublicStatistics(), undefined);
	assert.equal(reads.mock.callCount(), 0);
	const first = await refreshPublicStatistics();
	mock.timers.tick(3600000);
	for (let page = 0; page < 20; page++) assert.equal((await getPublicStatistics()).generatedAt, first.generatedAt);
	assert.equal(reads.mock.callCount(), 1);
	const next = await refreshPublicStatistics();
	assert.equal(new Date(next.generatedAt).getTime(), now + 3600000);
	assert.equal(reads.mock.callCount(), 2);
	assert.equal(yahoo.mock.callCount(), 4);
});

test("background timer starts immediately and recomputes on the hourly deadline without visitors", async t => {
	mock.timers.reset();
	mock.timers.enable({ apis: ["Date", "setInterval"], now });
	const timer = startStatisticsRefresh();
	t.after(() => clearInterval(timer));
	await refreshPublicStatistics();
	assert.equal(reads.mock.callCount(), 1);
	mock.timers.tick(3600000);
	await refreshPublicStatistics();
	assert.equal(reads.mock.callCount(), 2);
	assert.equal((await getPublicStatistics()).generatedAt, new Date(now + 3600000).toISOString());
});

test("exhausted budget preserves saved benchmark prices and never calls Yahoo", async () => {
	reserve.mock.mockImplementation(async () => false);
	for (const symbol of ["BTC-USD", "^GSPC"]) histories.set(symbol, { symbol, updatedAt: new Date(now - 86400000), prices: [{ date: now - 86400000, close: 10 }] });
	const result = await refreshPublicStatistics();
	assert.equal(yahoo.mock.callCount(), 0);
	assert.equal(result.benchmarks[0].value, startingCash);
	assert.equal(result.benchmarks[0].updatedAt, new Date(now - 86400000).toISOString());
});

test("failed benchmark requests still consume slots, cache unavailable results and do not retry on page loads", async () => {
	yahoo.mock.mockImplementation(async () => { throw new Error("Yahoo unavailable"); });
	const result = await refreshPublicStatistics();
	assert.equal(result.benchmarks[0].value, null);
	assert.equal(result.benchmarks[1].value, null);
	for (let index = 0; index < 10; index++) await getPublicStatistics();
	assert.equal(yahoo.mock.callCount(), 2);
	assert.equal(reserve.mock.callCount(), 2);
});

test("persisted hourly claim prevents another process or a failed computation from retrying", async () => {
	record = { _id: "public", attemptedAt: new Date(now) };
	assert.equal(await refreshPublicStatistics(), undefined);
	assert.equal(reads.mock.callCount(), 0);
	assert.equal(yahoo.mock.callCount(), 0);
});

test("accounts without investing activity make no benchmark requests", async () => {
	reads.mock.mockImplementation(() => ({ lean: async () => [{ cash: 100000, positions: [], ledger: [] }] }));
	const result = await refreshPublicStatistics();
	assert.equal(result.investingUsers, 0);
	assert.equal(reserve.mock.callCount(), 0);
	assert.equal(yahoo.mock.callCount(), 0);
});
