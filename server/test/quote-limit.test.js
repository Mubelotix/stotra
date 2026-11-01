const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const { reserveQuoteRefresh } = require("../dist/src/utils/quoteRefreshLimit");
const Quote = require("../dist/src/models/quote.model").default;

// Optional integration test: use a dedicated test database, never a production URI.
test("MongoDB persists quotes and enforces the shared budget for concurrent requests and leaderboard warming", {
	skip: !process.env.STOTRA_TEST_MONGODB_URI,
}, async t => {
	await mongoose.connect(process.env.STOTRA_TEST_MONGODB_URI, {
		dbName: "stotra_quote_test_" + process.pid,
	});
	try {
		const budget = mongoose.model("QuoteRefreshBudget");
		const outcomes = await Promise.all(Array.from({ length: 150 }, () => reserveQuoteRefresh()));
		assert.equal(outcomes.filter(Boolean).length, 100);
		assert.equal((await budget.findById("yahoo-quotes")).attempts.length, 100);

		await Quote.create({ _id: "AAPL", data: { symbol: "AAPL", regularMarketPrice: 123.45 }, updatedAt: new Date() });
		await mongoose.disconnect();
		await mongoose.connect(process.env.STOTRA_TEST_MONGODB_URI, { dbName: "stotra_quote_test_" + process.pid });
		assert.equal(await reserveQuoteRefresh(), false);
		// Trades may use the second half of the same budget, never 200 additional slots.
		const tradeOutcomes = await Promise.all(Array.from({ length: 150 }, () => reserveQuoteRefresh(true)));
		assert.equal(tradeOutcomes.filter(Boolean).length, 100);
		assert.equal((await budget.findById("yahoo-quotes")).attempts.length, 200);
		assert.equal(await reserveQuoteRefresh(true), false);
		await mongoose.disconnect();
		await mongoose.connect(process.env.STOTRA_TEST_MONGODB_URI, { dbName: "stotra_quote_test_" + process.pid });
		assert.equal(await reserveQuoteRefresh(), false);
		assert.equal(await reserveQuoteRefresh(true), false);
		assert.equal((await Quote.findById("AAPL")).data.regularMarketPrice, 123.45);

		// Expired attempts free slots, but recent attempts remain charged.
		await budget.updateOne({ _id: "yahoo-quotes" }, { $set: {
			attempts: [new Date(Date.now() - 3600001), ...Array.from({ length: 99 }, () => new Date())],
		} });
		assert.equal(await reserveQuoteRefresh(), true);
		assert.equal(await reserveQuoteRefresh(), false);
		await budget.updateOne({ _id: "yahoo-quotes" }, { $set: {
			attempts: [new Date(Date.now() - 3600001), ...Array.from({ length: 199 }, () => new Date())],
		} });
		assert.equal(await reserveQuoteRefresh(), false);
		assert.equal(await reserveQuoteRefresh(true), true);
		assert.equal(await reserveQuoteRefresh(true), false);

		// Exercise the actual leaderboard -> cache -> refresh -> budget path without Yahoo.
		await budget.updateOne({ _id: "yahoo-quotes" }, { $set: { attempts: [] } });
		const { yahooFinance, fetchStockData } = require("../dist/src/utils/requests");
		const { getLeaderboardTopN } = require("../dist/src/controller/leaderboard.controller");
		const yahoo = t.mock.method(yahooFinance, "quoteCombine", async symbol => ({
			symbol, regularMarketPrice: 123.45,
		}));
		const symbols = Array.from({ length: 600 }, (_, index) => "S" + index);
		await mongoose.connection.db.collection("users").insertOne({
			username: "investor", cash: 100,
			positions: symbols.map(symbol => ({ symbol, quantity: 2 })),
		});
		for (let page = 0; page < 11; page++) {
			const values = await getLeaderboardTopN(-1);
			assert.ok(Math.abs(values[0].value - (100 + Math.min(page, 10) * 10 * 2 * 123.45)) < 0.000001);
			await Promise.all(symbols.slice(page * 10, page * 10 + 10).map(symbol => fetchStockData(symbol)));
		}
		assert.equal(yahoo.mock.callCount(), 100);
		assert.equal(await Quote.countDocuments({ data: { $exists: true }, _id: { $in: symbols } }), 100);
		assert.equal(await reserveQuoteRefresh(), false);
		const trades = await Promise.allSettled(symbols.slice(100, 250).map(symbol => fetchStockData(symbol, true)));
		assert.equal(trades.filter(result => result.status === "fulfilled").length, 100);
		assert.equal(trades.filter(result => result.status === "rejected").length, 50);
		assert.equal(yahoo.mock.callCount(), 200);
		assert.equal((await fetchStockData("S599")).regularMarketPrice, 0);
		assert.equal(await reserveQuoteRefresh(true), false);
	} finally {
		await mongoose.connection.dropDatabase();
		await mongoose.disconnect();
	}
});
