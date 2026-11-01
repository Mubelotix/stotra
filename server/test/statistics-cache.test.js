const assert = require("node:assert/strict");
const { test, beforeEach, afterEach, mock } = require("node:test");
const User = require("../dist/src/models/user.model").default;
const Quote = require("../dist/src/models/quote.model").default;
const { StatisticsCache, BenchmarkHistory } = require("../dist/src/models/statistics.model");
const limiter = require("../dist/src/utils/quoteRefreshLimit");
const { yahooFinance } = require("../dist/src/utils/requests");
const { getPublicStatistics } = require("../dist/src/utils/publicStatistics");

const now = Date.now();
let record, histories, yahoo, reserve, reads;
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
	mock.method(yahooFinance, "quoteCombine", async () => assert.fail("Statistics must not refresh individual holdings"));
	mock.method(console, "error", () => {});
});
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

test("concurrent public stats reads compute once, persist the snapshot, and charge only two normal-budget calls", async () => {
	const values = await Promise.all(Array.from({ length: 30 }, () => getPublicStatistics()));
	assert.equal(reads.mock.callCount(), 1);
	assert.equal(yahoo.mock.callCount(), 2);
	assert.equal(reserve.mock.callCount(), 2);
	assert.ok(reserve.mock.calls.every(call => call.arguments.length === 0));
	assert.ok(values.every(value => value.stockValue === 60));
	assert.equal(record.snapshot.returns.value, 110);
	assert.equal(record.snapshot.benchmarks[0].value, 120);
	// A fresh module represents restarting the server; it still uses the Mongo snapshot.
	delete require.cache[require.resolve("../dist/src/utils/publicStatistics")];
	const restarted = require("../dist/src/utils/publicStatistics");
	assert.deepEqual(await restarted.getPublicStatistics(), values[0]);
	assert.equal(reads.mock.callCount(), 1);
	assert.equal(yahoo.mock.callCount(), 2);
});

test("hourly refresh returns stale data immediately, then replaces it without request amplification", async () => {
	const first = await getPublicStatistics();
	mock.timers.tick(3600000);
	const stale = await getPublicStatistics();
	assert.equal(stale.generatedAt, first.generatedAt);
	// Join the pending refresh by removing only the snapshot from our in-memory DB stub.
	delete record.snapshot;
	const next = await getPublicStatistics();
	assert.equal(new Date(next.generatedAt).getTime(), now + 3600000);
	assert.equal(reads.mock.callCount(), 2);
	assert.equal(yahoo.mock.callCount(), 4);
});

test("exhausted budget preserves saved benchmark prices and never calls Yahoo", async () => {
	reserve.mock.mockImplementation(async () => false);
	for (const symbol of ["BTC-USD", "^GSPC"]) histories.set(symbol, { symbol, updatedAt: new Date(now - 86400000), prices: [{ date: now - 86400000, close: 10 }] });
	const result = await getPublicStatistics();
	assert.equal(yahoo.mock.callCount(), 0);
	assert.equal(result.benchmarks[0].value, 100);
	assert.equal(result.benchmarks[0].updatedAt, new Date(now - 86400000).toISOString());
});

test("failed benchmark requests still consume slots, cache unavailable results and do not retry on page loads", async () => {
	yahoo.mock.mockImplementation(async () => { throw new Error("Yahoo unavailable"); });
	const result = await getPublicStatistics();
	assert.equal(result.benchmarks[0].value, null);
	assert.equal(result.benchmarks[1].value, null);
	for (let index = 0; index < 10; index++) await getPublicStatistics();
	assert.equal(yahoo.mock.callCount(), 2);
	assert.equal(reserve.mock.callCount(), 2);
});

test("persisted hourly claim prevents another process or a failed computation from retrying", async () => {
	record = { _id: "public", attemptedAt: new Date(now) };
	assert.equal(await getPublicStatistics(), undefined);
	assert.equal(reads.mock.callCount(), 0);
	assert.equal(yahoo.mock.callCount(), 0);
});

test("accounts without investing activity make no benchmark requests", async () => {
	reads.mock.mockImplementation(() => ({ lean: async () => [{ cash: 100000, positions: [], ledger: [] }] }));
	const result = await getPublicStatistics();
	assert.equal(result.investingUsers, 0);
	assert.equal(reserve.mock.callCount(), 0);
	assert.equal(yahoo.mock.callCount(), 0);
});
