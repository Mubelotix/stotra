import express from "express";
const router = express.Router();
import { authProxy } from "./middleware";
import userController from "./controller/user.controller";
import stocksController from "./controller/stocks.controller";
import newsController from "./controller/news.controller";
import leaderboardController from "./controller/leaderboard.controller";

// Proxy-managed login and logout routes

const loginUrl = process.env.STOTRA_LOGIN_URL;
const logoutUrl = process.env.STOTRA_LOGOUT_URL;

if (!loginUrl) {
	throw new Error("STOTRA_LOGIN_URL is not defined");
}

if (!logoutUrl) {
	throw new Error("STOTRA_LOGOUT_URL is not defined");
}

router.get("/api/login", (req, res) => {
	res.redirect(loginUrl);
});

router.get("/api/logout", (req, res) => {
	res.redirect(logoutUrl);
});

// User data routes
router.get("/api/user/ledger", [authProxy.verifyToken], userController.getLedger);
router.get(
	"/api/user/holdings",
	[authProxy.verifyToken],
	userController.getHoldings,
);
router.get(
	"/api/user/username",
	[authProxy.verifyToken],
	userController.getUsername,
);
router.get(
	"/api/user/portfolio",
	[authProxy.verifyToken],
	userController.getPortfolio,
);
router.get("/api/user/leaderboard", leaderboardController.getLeaderboard);

// User watchlist routes
router.get(
	"/api/user/watchlist",
	[authProxy.verifyToken],
	userController.getWatchlist,
);
router.post(
	"/api/user/watchlist/add/:symbol",
	[authProxy.verifyToken],
	userController.addToWatchlist,
);
router.post(
	"/api/user/watchlist/remove/:symbol",
	[authProxy.verifyToken],
	userController.removeFromWatchlist,
);

// Stocks routes
router.get("/api/stocks/search/:query", stocksController.search);
router.get("/api/stocks/:symbol/info", stocksController.getInfo);
router.get("/api/stocks/:symbol/historical", stocksController.getHistorical);

router.post(
	"/api/stocks/:symbol/buy",
	[authProxy.verifyToken],
	stocksController.buyStock,
);

router.post(
	"/api/stocks/:symbol/sell",
	[authProxy.verifyToken],
	stocksController.sellStock,
);

// News routes
router.get("/api/news", newsController.getNews);
router.get("/api/news/:symbol", newsController.getNews);

module.exports = router;
