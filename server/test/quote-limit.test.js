const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const { reserveQuoteRefresh } = require("../dist/src/utils/quoteRefreshLimit");
const Quote = require("../dist/src/models/quote.model").default;

// Optional integration test: use a dedicated test database, never a production URI.
test("MongoDB enforces a persistent, atomic 100-attempt rolling-hour budget", {
	skip: !process.env.STOTRA_TEST_MONGODB_URI,
}, async () => {
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
		assert.equal((await Quote.findById("AAPL")).data.regularMarketPrice, 123.45);

		// Expired attempts free slots, but recent attempts remain charged.
		await budget.updateOne({ _id: "yahoo-quotes" }, { $set: {
			attempts: [new Date(Date.now() - 3600001), ...Array.from({ length: 99 }, () => new Date())],
		} });
		assert.equal(await reserveQuoteRefresh(), true);
		assert.equal(await reserveQuoteRefresh(), false);
	} finally {
		await mongoose.connection.dropDatabase();
		await mongoose.disconnect();
	}
});
