import { Position } from "../App";
import api from "./api.service";

function makeTransaction(
	symbol: string,
	quantity: number,
	type: "buy" | "sell",
): Promise<string> {
	return api
		.post("/stocks/" + symbol + "/" + type, {
			quantity,
		})
		.then((res) => {
			return res.data.message;
		})
		.catch((err) => {
			console.log(err.response.data.message);
			throw new Error(err.response.data.message);
		});
}

function makeBuyByAmount(symbol: string, amount: number): Promise<string> {
	return api
		.post("/stocks/" + symbol + "/buy", {
			amount,
		})
		.then((res) => res.data.message)
		.catch((err) => {
			if (err.response?.data?.message) {
				throw new Error(err.response.data.message);
			}
			throw new Error("Failed to place buy order by amount");
		});
}

function getPositions(): Promise<Position[]> {
	return api
		.get("/user/holdings")
		.then((res) => {
			return res.data.positions;
		})
		.catch((err) => {
			console.log(err);
			if (err.response) {
				throw new Error(err.response.data.message);
			} else {
				throw new Error(err as string);
			}
		});
}

function getWatchlist(raw: boolean): Promise<any[]> {
	return api
		.get("/user/watchlist", {
			data: { raw },
		})
		.then((res) => {
			return res.data.watchlist;
		});
}

function getUsername(): Promise<string> {
	return api
		.get("/user/username")
		.then((res) => {
			return res.data.username;
		})
		.catch((err) => {
			if (err.response) {
				throw new Error(err.response.data.message);
			} else {
				throw new Error(err as string);
			}
		});
}

function editWatchlist(
	symbol: string,
	operation: "add" | "remove",
): Promise<string> {
	return api
		.post("/user/watchlist/" + operation + "/" + symbol, {})
		.then((res) => {
			return res.data.message;
		})
		.catch((err) => {
			if (err.response) {
				throw new Error(err.response.data.message);
			} else {
				throw new Error(err as string);
			}
		});
}

function getPortfolio(): Promise<{
	portfolioValue: number;
	portfolioPrevCloseValue: number;
	positions: Position[];
	cash: number;
	rank: number;
}> {
	return api.get("/user/portfolio").then((res) => {
		return {
			portfolioValue: res.data.portfolioValue,
			portfolioPrevCloseValue: res.data.portfolioPrevCloseValue,
			positions: res.data.positions,
			cash: res.data.cash,
			rank: res.data.rank,
		};
	});
}

function getBuyingPower(): Promise<number> {
	return api
		.get("/user/holdings")
		.then((res) => {
			return res.data.cash;
		})
		.catch((err) => {
			if (err.response) {
				throw new Error(err.response.data.message);
			} else {
				throw new Error(err as string);
			}
		});
}

function getAvailableShares(symbol: string): Promise<number> {
	return api
		.get("/user/holdings")
		.then((res) => {
			let positions = res.data.positions;
			// Sum up all the shares of the given symbol
			return positions.reduce((sum: number, stock: Position) => {
				if (stock.symbol === symbol) {
					return sum + stock.quantity;
				}
				return sum;
			}, 0);
		})
		.catch((err) => {
			if (err.response) {
				throw new Error(err.response.data.message);
			} else {
				throw new Error(err as string);
			}
		});
}

function getTradeFee(): Promise<number> {
	return api
		.get("/config/trade-fee")
		.then((res) => res.data.fee as number)
		.catch((err) => {
			// If backend doesn't support fee endpoint, default to 0 for UI continuity
			console.warn("Unable to fetch trade fee, defaulting to 0", err);
			return 0;
		});
}

export default {
	makeTransaction,
	makeBuyByAmount,
	getPositions,
	getWatchlist,
	getUsername,
	editWatchlist,
	getPortfolio,
	getBuyingPower,
	getAvailableShares,
	getTradeFee,
};
