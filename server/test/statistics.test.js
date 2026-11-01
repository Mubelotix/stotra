const assert = require("node:assert/strict");
const { test } = require("node:test");
const { calculateStatistics, calculateBenchmark, getInvestors } = require("../dist/src/utils/statistics");
const { startingCash } = require("../dist/src/utils/config");

const day = 86400000;
const now = Date.UTC(2026, 10, 1);
const trade = (type, symbol, price, quantity, age = 1, fee = 0) => ({ type, symbol, price, quantity, fee, date: now - age * day });
const quote = (symbol, price, type = "EQUITY") => ({ _id: symbol, data: { regularMarketPrice: price, longName: symbol + " name", quoteType: type }, updatedAt: new Date(now - day) });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

test("statistics count unique holders, current value, rolling dollar volume, users and recorded fees", () => {
	const users = [
		{ cash: 50, positions: [{ symbol: "A", quantity: 3 }, { symbol: "A", quantity: 5 }], ledger: [trade("buy", "A", 10, 10, 30, 1), trade("sell", "A", 11, 2, 2, 2), trade("buy", "OLD", 5, 1, 366, 3)] },
		{ cash: 100, positions: [{ symbol: "B", quantity: 2 }], ledger: [trade("buy", "B", 50, 2, 365, 4)] },
		{ cash: 1000, positions: [], ledger: [] },
	];
	const result = calculateStatistics(users, [quote("A", 15), quote("B", 60, "CRYPTOCURRENCY")], [], now);
	assert.equal(result.accounts, 3);
	assert.equal(result.investingUsers, 2);
	assert.equal(result.cash, 1150);
	assert.equal(result.stockValue, 240);
	assert.equal(result.transactions30, 2);
	assert.equal(result.tradingUsers30, 1);
	assert.equal(result.fees30, 3);
	assert.equal(result.feesAllTime, 10);
	assert.deepEqual(result.holdings.map(row => [row.symbol, row.holders, row.value]), [["A", 1, 120], ["B", 1, 120]]);
	assert.deepEqual(result.trending.find(row => row.symbol === "A"), { symbol: "A", name: "A name", bought30: 100, sold30: 22, bought365: 100, sold365: 22 });
	assert.equal(result.trending.find(row => row.symbol === "B").bought365, 100);
	assert.equal(result.trending.some(row => row.symbol === "OLD"), false);
	assert.equal(result.oldestQuoteAt, new Date(now - day).toISOString());
	assert.equal(result.assetClasses[0].holders, 1);
	assert.equal(result.assetClasses[0].value, 120);
	assert.equal(result.assetClasses[0].bought30, 100);
	assert.equal(result.assetClasses[0].sold30, 22);
	assert.equal(result.assetClasses[0].fees30, 3);
	assert.equal(result.assetClasses[1].value, 120);
});

test("returns use fixed starting cash, exclude idle accounts, and retain investors who sold everything", () => {
	const users = [
		{ cash: 50, positions: [{ symbol: "A", quantity: 8 }], ledger: [trade("buy", "A", 10, 10, 10, 1), trade("sell", "A", 11, 2, 2, 2)] },
		{ cash: 100, positions: [{ symbol: "B", quantity: 2 }], ledger: [trade("buy", "B", 50, 2)] },
		{ cash: 110, positions: [], ledger: [trade("buy", "A", 10, 10, 20), trade("sell", "A", 11, 10, 10)] },
		{ cash: 100000, positions: [], ledger: [] },
	];
	const quotes = [quote("A", 15), quote("B", 60)];
	const investors = getInvestors(users, quotes, now);
	assert.equal(investors.length, 3);
	const result = calculateStatistics(users, quotes, [], now);
	assert.equal(result.investingUsers, 3);
	assert.equal(result.returns.capital, 3 * startingCash);
	assert.equal(result.returns.value, 500);
	near(result.returns.median, (170 / startingCash - 1) * 100);
	near(result.returns.average, ((500 / 3) / startingCash - 1) * 100);
	const even = calculateStatistics(users.slice(0, 2), quotes, [], now);
	near(even.returns.median, (195 / startingCash - 1) * 100);
	// Incomplete ledgers must not change the capital or resulting returns.
	users[0].ledger = [trade("buy", "A", 1, 1)];
	assert.deepEqual(calculateStatistics(users, quotes, [], now).returns, result.returns);
});

test("positive return share counts profitable investors, not break-even, losing, idle or future-only accounts", () => {
	const users = [
		{ cash: startingCash, positions: [{ symbol: "A", quantity: 1 }], ledger: [trade("buy", "A", 10, 1)] },
		{ cash: startingCash + 10, positions: [], ledger: [trade("sell", "A", 10, 1)] },
		{ cash: startingCash, positions: [], ledger: [trade("sell", "A", 10, 1)] },
		{ cash: startingCash - 10, positions: [], ledger: [trade("buy", "A", 10, 1)] },
		{ cash: startingCash + 100, positions: [], ledger: [] },
		{ cash: startingCash + 100, positions: [], ledger: [trade("buy", "A", 10, 1, -1)] },
	];
	const result = calculateStatistics(users, [quote("A", 10)], [], now);
	assert.equal(result.returns.positiveShare, 50);
	assert.equal(result.returns.capital, 4 * startingCash);
	assert.equal(calculateStatistics(users.slice(2, 4), [], [], now).returns.positiveShare, 0);
	assert.equal(calculateStatistics(users.slice(0, 2), [quote("A", 10)], [], now).returns.positiveShare, 100);
	assert.equal(calculateStatistics(users.slice(4), [], [], now).returns.positiveShare, null);
});

test("unknown prices count as zero, unknown types are not guessed, and mixed holders count once per class", () => {
	const user = { cash: 10, positions: [{ symbol: "A", quantity: 1 }, { symbol: "F", quantity: 2 }, { symbol: "BTC-USD", quantity: 1 }, { symbol: "MISSING", quantity: 3 }, { symbol: "ZERO", quantity: 0 }], ledger: [trade("buy", "MISSING", 10, 3)] };
	const result = calculateStatistics([user], [quote("A", 10), quote("F", 20, "ETF"), quote("BTC-USD", 100, "")], [], now);
	assert.deepEqual(result.missingPrices, ["MISSING"]);
	assert.equal(result.stockValue, 150);
	assert.equal(result.assetClasses[0].holders, 1);
	assert.equal(result.assetClasses[0].value, 50);
	assert.equal(result.assetClasses[1].holders, 0);
	assert.equal(result.assetClasses[2].holders, 1);
	assert.equal(result.assetClasses[2].value, 100);
	assert.equal(result.assetClasses[2].bought30, 30);
	assert.equal(result.assetClasses.reduce((sum, row) => sum + row.value, 0), result.stockValue);
});

test("benchmark invests the same starting cash on each investor's first-trade date or the next session", () => {
	const investors = [{ value: 150, firstTrade: now - 10 * day + 12 * 3600000 }, { value: 220, firstTrade: now - 5 * day }];
	const prices = [{ date: now - 10 * day, close: 10 }, { date: now - 3 * day, close: 20 }, { date: now, close: 30 }];
	const result = calculateBenchmark(investors, { symbol: "BTC-USD", prices, updatedAt: new Date(now) });
	assert.equal(result.value, startingCash * 4.5);
	assert.equal(result.returnPercent, 125);
	assert.equal(result.coveredInvestors, 2);
	assert.equal(result.priceDate, new Date(now).toISOString());
	const incomplete = calculateBenchmark(investors, { symbol: "^GSPC", prices: prices.slice(1) });
	assert.equal(incomplete.coveredInvestors, 1);
	assert.equal(incomplete.value, null);
	assert.equal(incomplete.returnPercent, null);
});

test("empty data, sold-out accounts, old fee-less trades and future transactions are safe", () => {
	const empty = calculateStatistics([], [], [{ symbol: "BTC-USD", prices: [] }], now);
	assert.equal(empty.returns.median, null);
	assert.equal(empty.returns.average, null);
	assert.equal(empty.returns.positiveShare, null);
	assert.equal(empty.returns.capital, 0);
	assert.equal(empty.benchmarks[0].value, null);
	assert.equal(empty.stockValue, 0);
	const result = calculateStatistics([
		{ cash: 0, positions: [], ledger: [trade("sell", "A", 10, 1)] },
		{ cash: 100, positions: [], ledger: [trade("buy", "A", 10, 1, -1)] },
		{ cash: 100, positions: [], ledger: [{ ...trade("buy", "A", 10, 1), fee: undefined }] },
	], [], [], now);
	assert.equal(result.investingUsers, 2);
	assert.equal(result.transactions30, 2);
	assert.equal(result.tradingUsers30, 2);
	assert.equal(result.feesAllTime, 0);
});
