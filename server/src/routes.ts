import express from "express";
const router = express.Router();
import { authProxy } from "./middleware";
import userController from "./controller/user.controller";
import stocksController, { getTradeFee } from "./controller/stocks.controller";
import newsController from "./controller/news.controller";
import leaderboardController from "./controller/leaderboard.controller";
import statisticsController from "./controller/statistics.controller";

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

// Aggregate statistics and the leaderboard are public; personal/market APIs are protected.
router.get("/api/user/leaderboard", leaderboardController.getLeaderboard);
router.get("/api/statistics", statisticsController.getStatistics);

// Other data routes require the identity supplied by the trusted authentication proxy.
router.use("/api", authProxy.verifyToken);

// User data routes
router.get("/api/user/ledger", userController.getLedger);
router.get(
	"/api/user/holdings",
	userController.getHoldings,
);
router.get(
	"/api/user/username",
	userController.getUsername,
);
router.get(
	"/api/user/portfolio",
	userController.getPortfolio,
);

// User watchlist routes
router.get(
	"/api/user/watchlist",
	userController.getWatchlist,
);
router.post(
	"/api/user/watchlist/add/:symbol",
	userController.addToWatchlist,
);
router.post(
	"/api/user/watchlist/remove/:symbol",
	userController.removeFromWatchlist,
);

// Stocks routes
router.get("/api/stocks/search/:query", stocksController.search);
router.get("/api/stocks/:symbol/info", stocksController.getInfo);
router.get("/api/stocks/:symbol/historical", stocksController.getHistorical);
router.get("/api/config/trade-fee", getTradeFee);

router.post(
	"/api/stocks/:symbol/buy",
	stocksController.buyStock,
);

router.post(
	"/api/stocks/:symbol/sell",
	stocksController.sellStock,
);

// News routes
router.get("/api/news", newsController.getNews);
router.get("/api/news/:symbol", newsController.getNews);

module.exports = router;
