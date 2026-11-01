const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const User = require("../dist/src/models/user.model").default;
const Quote = require("../dist/src/models/quote.model").default;
const { StatisticsCache, BenchmarkHistory } = require("../dist/src/models/statistics.model");
const { yahooFinance } = require("../dist/src/utils/requests");

test("MongoDB persists public statistics, atomically claims hourly work, and reuses benchmarks under the normal cap", {
	skip: !process.env.STOTRA_TEST_MONGODB_URI,
}, async t => {
	const dbName = "stotra_statistics_test_" + process.pid;
	await mongoose.connect(process.env.STOTRA_TEST_MONGODB_URI, { dbName });
	try {
		const now = Date.now();
		await User.create({ username: "private-name-not-in-aggregates", cash: 500, positions: [{ symbol: "A", quantity: 10, purchasePrice: 50, purchaseDate: now - 86400000 }], ledger: [{ symbol: "A", type: "buy", price: 50, quantity: 10, fee: 1, date: now - 86400000 }] });
		await Quote.create({ _id: "A", data: { symbol: "A", regularMarketPrice: 60, quoteType: "EQUITY" }, updatedAt: new Date(now) });
		const yahoo = t.mock.method(yahooFinance, "chart", async () => ({ quotes: [{ date: new Date(now - 86400000), close: 10 }, { date: new Date(now), close: 12 }] }));
		t.mock.method(yahooFinance, "quoteCombine", async () => assert.fail("No per-stock refreshes"));
		// Separate module instances emulate independent server processes, not just single-flight.
		const firstWorker = require("../dist/src/utils/publicStatistics");
		delete require.cache[require.resolve("../dist/src/utils/publicStatistics")];
		const secondWorker = require("../dist/src/utils/publicStatistics");
		await Promise.all([firstWorker.getPublicStatistics(), secondWorker.getPublicStatistics()]);
		const result = await firstWorker.getPublicStatistics();
		assert.equal(result.stockValue, 600);
		assert.equal(result.investingUsers, 1);
		assert.equal(JSON.stringify(result).includes("private-name"), false);
		assert.equal(yahoo.mock.callCount(), 2);
		assert.equal(await BenchmarkHistory.countDocuments(), 2);
		assert.equal((await mongoose.model("QuoteRefreshBudget").findById("yahoo-quotes")).attempts.length, 2);
		assert.ok((await StatisticsCache.findById("public")).snapshot.generatedAt);
		await mongoose.disconnect();
		await mongoose.connect(process.env.STOTRA_TEST_MONGODB_URI, { dbName });
		assert.deepEqual(await secondWorker.getPublicStatistics(), result);
		assert.equal(yahoo.mock.callCount(), 2);
		// Force the next hourly cycle, now with all normal slots used. Cached histories survive.
		await mongoose.model("QuoteRefreshBudget").updateOne({ _id: "yahoo-quotes" }, { $set: { attempts: Array.from({ length: 100 }, () => new Date()) } });
		await StatisticsCache.updateOne({ _id: "public" }, { $unset: { snapshot: 1 }, $set: { attemptedAt: new Date(now - 3600001) } });
		const capped = await secondWorker.getPublicStatistics();
		assert.equal(capped.benchmarks[0].value, result.benchmarks[0].value);
		assert.equal(yahoo.mock.callCount(), 2);
		assert.equal((await mongoose.model("QuoteRefreshBudget").findById("yahoo-quotes")).attempts.length, 100);
	} finally {
		await mongoose.connection.dropDatabase();
		await mongoose.disconnect();
	}
});
