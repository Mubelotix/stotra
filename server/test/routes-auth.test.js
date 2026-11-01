const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const User = require("../dist/src/models/user.model").default;

test("API data routes require proxy authentication before invoking controllers", async t => {
	process.env.STOTRA_LOGIN_URL = "https://auth.example/login";
	process.env.STOTRA_LOGOUT_URL = "https://auth.example/logout";
	const routes = [
		["GET", "/api/user/ledger", "user", "getLedger"],
		["GET", "/api/user/holdings", "user", "getHoldings"],
		["GET", "/api/user/username", "user", "getUsername"],
		["GET", "/api/user/portfolio", "user", "getPortfolio"],
		["GET", "/api/user/watchlist", "user", "getWatchlist"],
		["POST", "/api/user/watchlist/add/AAPL", "user", "addToWatchlist"],
		["POST", "/api/user/watchlist/remove/AAPL", "user", "removeFromWatchlist"],
		["GET", "/api/stocks/search/apple", "stocks", "search"],
		["GET", "/api/stocks/AAPL/info", "stocks", "getInfo"],
		["GET", "/api/stocks/AAPL/historical", "stocks", "getHistorical"],
		["POST", "/api/stocks/AAPL/buy", "stocks", "buyStock"],
		["POST", "/api/stocks/AAPL/sell", "stocks", "sellStock"],
		["GET", "/api/news", "news", "getNews"],
		["GET", "/api/news/AAPL", "news", "getNews"],
	];
	const controllers = Object.fromEntries(["user", "leaderboard", "stocks", "news"].map(name => [
		name, require(`../dist/src/controller/${name}.controller`).default,
	]));
	let calls = 0;
	for (const [, , controller, handler] of routes) {
		if (controllers[controller][handler].mock) continue;
		t.mock.method(controllers[controller], handler, (req, res) => {
			calls++;
			assert.equal(req.userId, "test-user-id");
			res.sendStatus(204);
		});
	}
	const lookup = t.mock.method(User, "findOne", async () => ({ _id: "test-user-id" }));
	t.mock.method(User, "find", async () => [{ username: "investor", positions: [], cash: 100 }]);
	const Quote = require("../dist/src/models/quote.model").default;
	t.mock.method(Quote, "find", () => ({ lean: async () => [] }));
	const statisticsController = require("../dist/src/controller/statistics.controller").default;
	t.mock.method(statisticsController, "getStatistics", (_req, res) => res.json({ aggregate: true }));
	const app = express();
	app.use(require("../dist/src/routes"));
	const server = app.listen(0, "127.0.0.1");
	await new Promise(resolve => server.once("listening", resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	const base = `http://127.0.0.1:${server.address().port}`;
	for (const [method, path] of [...routes, ["GET", "/api/config/trade-fee"]]) {
		const response = await fetch(base + path, { method });
		assert.equal(response.status, 401, `${method} ${path}`);
		await response.text();
	}
	assert.equal(calls, 0);
	assert.equal(lookup.mock.callCount(), 0);
	const leaderboard = await fetch(base + "/api/user/leaderboard");
	assert.equal(leaderboard.status, 200);
	assert.deepEqual(await leaderboard.json(), { users: [{ username: "investor", value: 100 }] });
	assert.equal(lookup.mock.callCount(), 0);
	const statistics = await fetch(base + "/api/statistics");
	assert.equal(statistics.status, 200);
	assert.deepEqual(await statistics.json(), { aggregate: true });
	assert.equal(lookup.mock.callCount(), 0);
	for (const [method, path] of routes) {
		const response = await fetch(base + path, {
			method,
			headers: { [process.env.STOTRA_USERNAME_HEADER || "x-username"]: "test-user" },
		});
		assert.equal(response.status, 204, `${method} ${path}`);
	}
	assert.equal(calls, routes.length);
	for (const action of ["login", "logout"]) {
		const response = await fetch(`${base}/api/${action}`, { redirect: "manual" });
		assert.equal(response.status, 302);
		assert.equal(response.headers.get("location"), `https://auth.example/${action}`);
		await response.text();
	}
});
