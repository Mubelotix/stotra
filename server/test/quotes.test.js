const assert = require("node:assert/strict");
const { test, beforeEach, afterEach, mock } = require("node:test");
const Quote = require("../dist/src/models/quote.model").default;
const User = require("../dist/src/models/user.model").default;
const limiter = require("../dist/src/utils/quoteRefreshLimit");
const stocks = require("../dist/src/controller/stocks.controller").default;
const { getLeaderboardTopN } = require("../dist/src/controller/leaderboard.controller");
const { fetchStockData, yahooFinance } = require("../dist/src/utils/requests");

const now = Date.now();
let records;
let reservations;
let yahoo;

function stored(symbol, price, age = 0) {
	return {
		_id: symbol,
		data: { symbol, regularMarketPrice: price },
		updatedAt: new Date(now - age),
		attemptedAt: new Date(now - age),
	};
}

beforeEach(() => {
	mock.timers.enable({ apis: ["Date"], now });
	records = new Map();
	reservations = mock.method(limiter, "reserveQuoteRefresh", async () => true);
	yahoo = mock.method(yahooFinance, "quoteCombine", async symbol => ({
		symbol, regularMarketPrice: 123.45, regularMarketPreviousClose: 120,
		averageDailyVolume10Day: 1000000, quoteType: "EQUITY",
	}));
	mock.method(Quote, "findById", symbol => ({ lean: async () => records.get(symbol) ?? null }));
	mock.method(Quote, "updateOne", async (filter, update) => {
		records.set(filter._id, { _id: filter._id, ...records.get(filter._id), ...update.$set });
	});
	mock.method(console, "error", () => {});
});

afterEach(() => {
	mock.restoreAll();
	mock.timers.reset();
});

test("loading the quote module does not request tickers", () => {
	assert.equal(yahoo.mock.callCount(), 0);
	assert.equal(reservations.mock.callCount(), 0);
});

test("on-demand quotes are persisted and concurrent requests share one refresh", async () => {
	const values = await Promise.all(Array.from({ length: 30 }, () => fetchStockData("AAPL")));
	assert.ok(values.every(value => value.regularMarketPrice === 123.45));
	assert.equal(yahoo.mock.callCount(), 1);
	assert.equal(reservations.mock.callCount(), 1);
	assert.equal(records.get("AAPL").data.regularMarketPrice, 123.45);
	await fetchStockData("AAPL");
	assert.equal(yahoo.mock.callCount(), 1);
});

test("fresh database quotes are reused after a module restart", async () => {
	records.set("AAPL", stored("AAPL", 130));
	const path = require.resolve("../dist/src/utils/requests");
	delete require.cache[path];
	const restarted = require(path);
	const restartedYahoo = mock.method(restarted.yahooFinance, "quoteCombine", async () => assert.fail("No Yahoo requests after restart"));
	assert.equal((await restarted.fetchStockData("AAPL")).regularMarketPrice, 130);
	assert.equal(restartedYahoo.mock.callCount(), 0);
	assert.equal(reservations.mock.callCount(), 0);
});

test("exhausted budget returns stale or zero prices without requesting Yahoo", async () => {
	reservations.mock.mockImplementation(async () => false);
	records.set("OLD", stored("OLD", 42, 3600000));
	assert.equal((await fetchStockData("OLD")).regularMarketPrice, 42);
	const unknown = await fetchStockData("UNKNOWN");
	assert.equal(unknown.symbol, "UNKNOWN");
	assert.equal(unknown.regularMarketPrice, 0);
	assert.equal(unknown.regularMarketPreviousClose, 0);
	assert.equal(yahoo.mock.callCount(), 0);
});

test("failed refreshes consume budget, preserve good data, and do not immediately retry", async () => {
	records.set("OLD", stored("OLD", 42, 3600000));
	yahoo.mock.mockImplementation(async () => { throw new Error("Yahoo unavailable"); });
	assert.equal((await fetchStockData("OLD")).regularMarketPrice, 42);
	assert.equal((await fetchStockData("NEW")).regularMarketPrice, 0);
	await fetchStockData("OLD");
	await fetchStockData("NEW");
	assert.equal(yahoo.mock.callCount(), 2);
	assert.equal(reservations.mock.callCount(), 2);
	assert.equal(records.get("OLD").data.regularMarketPrice, 42);
});

test("wrong-symbol or invalid prices never replace stored values", async () => {
	for (const invalid of [0, -1, NaN, undefined]) {
		yahoo.mock.mockImplementation(async symbol => ({ symbol, regularMarketPrice: invalid }));
		assert.equal((await fetchStockData("INVALID" + invalid)).regularMarketPrice, 0);
	}
	yahoo.mock.mockImplementation(async () => ({ symbol: "OTHER", regularMarketPrice: 50 }));
	assert.equal((await fetchStockData("MISMATCH")).regularMarketPrice, 0);
});

test("a quote is refreshed at the one-minute freshness boundary", async () => {
	records.set("AAPL", stored("AAPL", 130, 59999));
	assert.equal((await fetchStockData("AAPL")).regularMarketPrice, 130);
	mock.timers.tick(1);
	assert.equal((await fetchStockData("AAPL")).regularMarketPrice, 123.45);
	assert.equal(yahoo.mock.callCount(), 1);
});

test("trades cannot use unknown or stale fallback prices", async () => {
	reservations.mock.mockImplementation(async () => false);
	records.set("OLD", stored("OLD", 42, 60000));
	await assert.rejects(fetchStockData("UNKNOWN", true), /fresh price/);
	await assert.rejects(fetchStockData("OLD", true), /fresh price/);
	records.set("FRESH", stored("FRESH", 123.45));
	assert.equal((await fetchStockData("FRESH", true)).regularMarketPrice, 123.45);
	for (const action of [stocks.buyStock, stocks.sellStock]) {
		let status;
		const response = { status(code) { status = code; return this; }, send() {} };
		await action({ params: { symbol: "UNKNOWN" }, body: { quantity: 1 } }, response);
		assert.equal(status, 500);
	}
});

test("600-ticker leaderboard uses persisted prices and zero for unknowns, never Yahoo", async () => {
	const positions = Array.from({ length: 600 }, (_, index) => ({ symbol: "S" + index, quantity: 2 }));
	mock.method(User, "find", async () => [
		{ username: "investor", cash: 100, positions },
		{ username: "cash", cash: 150, positions: [] },
	]);
	mock.method(Quote, "find", () => ({ lean: async () => [stored("S0", 50, 86400000)] }));
	assert.deepEqual(await getLeaderboardTopN(-1), [
		{ username: "investor", value: 200 }, { username: "cash", value: 150 },
	]);
	assert.equal((await getLeaderboardTopN(1)).length, 1);
	assert.equal((await getLeaderboardTopN(0)).length, 0);
	assert.equal(yahoo.mock.callCount(), 0);
	assert.equal(reservations.mock.callCount(), 0);
});
