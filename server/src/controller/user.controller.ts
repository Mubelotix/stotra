import Position from "../models/position.model";
import User, { IUser } from "../models/user.model";
import { Request, Response } from "express";
import { fetchStockData } from "../utils/requests";
import { getLeaderboardTopN } from "./leaderboard.controller";

const getLedger = (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['User Data']
	*/
	User.findById(req.body.userId)
		.then((user) => {
			res.status(200).json({ ledger: user!.ledger });
		})
		.catch((err: { message: any }) => {
			res.status(500).send({ message: err.message });
		});
};

const getHoldings = (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['User Data']
	*/
	User.findById(req.body.userId)
		.then((user) => {
			res.status(200).json({ positions: user!.positions, cash: user!.cash });
		})
		.catch((err: { message: any }) => {
			res.status(500).send({ message: err.message });
		});
};

const getUsername = (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['User Data']
	*/
	User.findById(req.body.userId)
		.then((user) => {
			res.status(200).json({ username: user!.username });
		})
		.catch((err: { message: any }) => {
			res.status(500).send({ message: err.message });
		});
}

const getPortfolio = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['User Data']
	*/
	let user: IUser | null = await User.findById(req.body.userId).lean();
	if (!user) {
		res.status(500).json({ message: "User not found" });
	}
	user = user!;

	let portfolioValue = 0; //user.cash
	let portfolioPrevCloseValue = 0;

	// Create array of how many of each symbol (no duplicates)
	let positionsNoDupes: { [key: string]: number } = {};
	user!.positions.forEach((position) => {
		if (positionsNoDupes[position.symbol]) {
			positionsNoDupes[position.symbol] += position.quantity;
		} else {
			positionsNoDupes[position.symbol] = position.quantity;
		}
	});

	const symbols = Object.keys(positionsNoDupes);
	const quantities = Object.values(positionsNoDupes);

    try {
        const values = await Promise.all(symbols.map((symbol) => fetchStockData(symbol)));

        // Sum up the value of all positions
        values.forEach((value, i) => {
            portfolioValue += value.regularMarketPrice * quantities[i];
            portfolioPrevCloseValue += value.regularMarketPreviousClose * quantities[i];
        });

        // Create list of positions to send to frontend with data from user.positions plus the properties from the fetchStockData response
		let listOfPositions: any[] = [];
        user.positions.forEach((position) => {
            const positionLiveData = values.find(
                (value) => value.symbol === position.symbol,
            );
            if (positionLiveData) {
                listOfPositions.push({
                    ...position,
                    ...positionLiveData,
                });
            }
        });

        // Include user's rank
        const userValues = await getLeaderboardTopN(-1);
        let rank = userValues.findIndex((entry) => entry.username === user.username);
		if (rank !== -1) {
			rank += 1;
		}

        res.status(200).json({
            portfolioValue,
            portfolioPrevCloseValue,
            positions: listOfPositions,
            cash: user.cash,
            rank,
        });
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        res.status(500).send({ message: errorMessage });
    }
};

const getWatchlist = (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['User Watchlist']
	*/
	User.findById(req.body.userId)
		.then((user) => {
			if (req.body.raw === "true") {
				res.status(200).json({ watchlist: user!.watchlist });
			} else {
				// Get the current price of each stock in the watchlist
				Promise.all(user!.watchlist.map((symbol) => fetchStockData(symbol)))
					.then((values) => {
						res.status(200).json({ watchlist: values });
					})
					.catch((err) => {
						res.status(500).send({ message: err.message });
					});
			}
		})
		.catch((err: { message: any }) => {
			res.status(500).send({ message: err.message });
		});
};

const addToWatchlist = (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['User Watchlist']
	*/
	User.findById(req.body.userId)
		.then((user) => {
			if (user!.watchlist.includes(req.params.symbol)) {
				res.status(400).json({ message: "Already in watchlist" });
			} else {
				user!.watchlist.push(req.params.symbol);
				user!.save();
				res.status(200).json({ message: "Added to watchlist" });
			}
		})
		.catch((err: { message: any }) => {
			res.status(500).send({ message: err.message });
		});
};

const removeFromWatchlist = (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['User Watchlist']
	*/
	User.findById(req.body.userId)
		.then((user) => {
			if (user!.watchlist.includes(req.params.symbol)) {
				user!.watchlist = user!.watchlist.filter(
					(symbol) => symbol !== req.params.symbol,
				);
				user!.save();
				res.status(200).json({ message: "Removed from watchlist" });
			} else {
				res.status(400).json({ message: "Not in watchlist" });
			}
		})
		.catch((err: { message: any }) => {
			res.status(500).send({ message: err.message });
		});
};

export default {
	getLedger,
	getHoldings,
	getUsername,
	getPortfolio,
	// Watchlist routes
	getWatchlist,
	addToWatchlist,
	removeFromWatchlist,
};
