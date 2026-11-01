const assert = require("node:assert/strict");
const { test, beforeEach, afterEach, mock } = require("node:test");
const Quote = require("../dist/src/models/quote.model").default;
const User = require("../dist/src/models/user.model").default;
const limiter = require("../dist/src/utils/quoteRefreshLimit");
const stocks = require("../dist/src/controller/stocks.controller").default;
const { getLeaderboardTopN } = require("../dist/src/controller/leaderboard.controller");
const { fetchStockData, getCachedStockPrices, yahooFinance } = require("../dist/src/utils/requests");

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
	mock.method(Quote, "find", filter => ({
		lean: async () => filter._id.$in.map(symbol => records.get(symbol)).filter(Boolean),
	}));
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

test("only trades can request the doubled budget, and fresh prices still reuse the cache", async () => {
	reservations.mock.mockImplementation(async forTrade => forTrade);
	records.set("OLD", stored("OLD", 42, 60000));
	assert.equal((await fetchStockData("OLD")).regularMarketPrice, 42);
	assert.equal((await fetchStockData("OLD", true)).regularMarketPrice, 123.45);
	assert.deepEqual(reservations.mock.calls.map(call => call.arguments[0]), [false, true]);
	assert.equal(yahoo.mock.callCount(), 1);
	await fetchStockData("OLD", true);
	assert.equal(reservations.mock.callCount(), 2);
});

test("concurrent trades can use extra budget after joining a refused background refresh", async () => {
	let refuseBackground;
	const refused = new Promise(resolve => { refuseBackground = resolve; });
	reservations.mock.mockImplementation(async forTrade => forTrade ? true : refused);
	const background = fetchStockData("AAPL");
	const trades = Array.from({ length: 20 }, () => fetchStockData("AAPL", true));
	refuseBackground(false);
	assert.equal((await background).regularMarketPrice, 0);
	assert.ok((await Promise.all(trades)).every(quote => quote.regularMarketPrice === 123.45));
	assert.deepEqual(reservations.mock.calls.map(call => call.arguments[0]), [false, true]);
	assert.equal(yahoo.mock.callCount(), 1);
});

test("failed trade refreshes preserve old data but cannot authorize a stale-price trade", async () => {
	reservations.mock.mockImplementation(async forTrade => forTrade);
	records.set("OLD", stored("OLD", 42, 3600000));
	yahoo.mock.mockImplementation(async () => { throw new Error("Yahoo unavailable"); });
	await assert.rejects(fetchStockData("OLD", true), /fresh price/);
	await assert.rejects(fetchStockData("OLD", true), /fresh price/);
	assert.equal(records.get("OLD").data.regularMarketPrice, 42);
	assert.equal(reservations.mock.callCount(), 1);
	assert.equal(yahoo.mock.callCount(), 1);
});

test("600-ticker leaderboard responds without waiting for at most 10 background refreshes", async () => {
	const positions = Array.from({ length: 600 }, (_, index) => ({ symbol: "S" + index, quantity: 2 }));
	mock.method(User, "find", async () => [
		{ username: "investor", cash: 100, positions },
		{ username: "cash", cash: 150, positions: [] },
	]);
	records.set("S0", stored("S0", 50, 86400000));
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	yahoo.mock.mockImplementation(async symbol => {
		await gate;
		return { symbol, regularMarketPrice: 123.45 };
	});
	assert.deepEqual(await getLeaderboardTopN(-1), [
		{ username: "investor", value: 200 }, { username: "cash", value: 150 },
	]);
	release();
	await Promise.all(Array.from({ length: 10 }, (_, index) => fetchStockData("S" + (index + 1))));
	assert.equal(yahoo.mock.callCount(), 10);
	assert.equal(reservations.mock.callCount(), 10);
	assert.equal(records.get("S1").data.regularMarketPrice, 123.45);
});

test("leaderboard refreshes rotate across missing prices, failures, and oldest attempts", async () => {
	const symbols = Array.from({ length: 25 }, (_, index) => "S" + index);
	const refreshPage = async selected => {
		const prices = await getCachedStockPrices(symbols);
		// Join only the refreshes started by this page, without scheduling extra work.
		await Promise.all(selected.map(symbol => fetchStockData(symbol)));
		return prices;
	};
	assert.equal((await refreshPage(symbols.slice(0, 10))).get("S0"), 0);
	assert.equal((await refreshPage(symbols.slice(10, 20))).get("S0"), 123.45);
	assert.equal(yahoo.mock.callCount(), 20);
	assert.equal(new Set(yahoo.mock.calls.map(call => call.arguments[0])).size, 20);

	// A failed symbol must not block the remaining unseen symbols on the next page.
	mock.timers.tick(60000);
	yahoo.mock.mockImplementation(async () => { throw new Error("Delisted"); });
	await refreshPage([...symbols.slice(20), ...symbols.slice(0, 5)]);
	const attempted = yahoo.mock.calls.map(call => call.arguments[0]);
	assert.ok(symbols.every(symbol => attempted.includes(symbol)));
	assert.equal(records.get("S20").data, undefined);
	assert.ok(records.get("S20").attemptedAt);
	await refreshPage(symbols.slice(5, 15));
	assert.equal(yahoo.mock.callCount(), 40);
	assert.equal(yahoo.mock.calls.filter(call => call.arguments[0] === "S20").length, 1);
});

test("leaderboard uses stale prices or zero when the shared refresh budget is exhausted", async () => {
	reservations.mock.mockImplementation(async () => false);
	records.set("OLD", stored("OLD", 42, 3600000));
	const prices = await getCachedStockPrices(["OLD", "UNKNOWN"]);
	assert.equal(prices.get("OLD"), 42);
	assert.equal(prices.get("UNKNOWN"), 0);
	await Promise.all([fetchStockData("OLD"), fetchStockData("UNKNOWN")]);
	assert.equal(yahoo.mock.callCount(), 0);
});

test("public leaderboard returns cached prices and triggers normal background refreshes", async () => {
	records.set("OLD", stored("OLD", 42, 3600000));
	mock.method(User, "find", async () => [{
		username: "investor", cash: 100,
		positions: [{ symbol: "OLD", quantity: 2 }, { symbol: "UNKNOWN", quantity: 5 }],
	}]);
	const leaderboard = require("../dist/src/controller/leaderboard.controller").default;
	let body;
	const res = { status(code) { assert.equal(code, 200); return this; }, send(value) { body = value; } };
	await leaderboard.getLeaderboard({}, res);
	assert.deepEqual(body, { users: [{ username: "investor", value: 184 }] });
	await new Promise(setImmediate);
	assert.equal(reservations.mock.callCount(), 2);
	assert.equal(yahoo.mock.callCount(), 2);
});

test("fresh leaderboard quotes do not consume refresh slots", async () => {
	records.set("AAPL", stored("AAPL", 130));
	assert.equal((await getCachedStockPrices(["AAPL", "AAPL"])).get("AAPL"), 130);
	assert.equal(reservations.mock.callCount(), 0);
	assert.equal(yahoo.mock.callCount(), 0);
});

test("background database errors do not fail the cached leaderboard response", async () => {
	reservations.mock.mockImplementation(async () => { throw new Error("Budget database unavailable"); });
	const prices = await getCachedStockPrices(["UNKNOWN"]);
	assert.equal(prices.get("UNKNOWN"), 0);
	await new Promise(setImmediate);
	assert.equal(yahoo.mock.callCount(), 0);
	const errors = console.error.mock.calls.filter(call => call.arguments[0] === "Error refreshing UNKNOWN:");
	assert.equal(errors.length, 1);
});
