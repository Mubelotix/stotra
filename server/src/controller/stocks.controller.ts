import { Request, Response } from "express";
import User from "../models/user.model";

import {
	fetchStockData,
	fetchHistoricalStockData,
	searchStocks,
} from "../utils/requests";
import { ITransaction } from "../models/transaction.model";
import { IPosition } from "../models/position.model";

import dotenv from "dotenv";
dotenv.config();
const cryptoMinimumDailyVolume = parseInt(process.env.STOTRA_CRYPTO_MINIMUM_DAILY_VOLUME || "1000000");
const minimumDailyVolume = parseInt(process.env.STOTRA_MINIMUM_DAILY_VOLUME || "100000");
const tradeFee = parseFloat(process.env.STOTRA_TRADE_FEE || process.env.TRADE_FEE || "0.001"); // default 0.1% = 0.001

const getInfo = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Data']
	*/
	const symbol = req.params.symbol;
	const quote = await fetchStockData(symbol);
	res.status(200).send(quote);
};

const getHistorical = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Data']
	*/
	const symbol = req.params.symbol;
	const period = req.query.period?.toString() as
		| "1d"
		| "5d"
		| "1m"
		| "6m"
		| "YTD"
		| "1y"
		| "all"
		| undefined;

	try {
		const historicalData = await fetchHistoricalStockData(symbol, period);

		res.status(200).send(historicalData);
	} catch (error) {
		console.error("Error fetching " + symbol + " stock data:", error);
		res.status(500).send("Error fetching " + symbol + " stock data:" + error);
	}
};

const buyStock = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Transaction']
	*/
	const symbol = req.params.symbol;
	const quantity = req.body.quantity;
	const amount = req.body.amount as number | undefined; // optional inclusive-amount semantics

	try {
		const data = await fetchStockData(symbol);
		const price = data.regularMarketPrice;
		const quoteType = data.quoteType;
		const averageDailyVolume10Day = data.averageDailyVolume10Day;

		if (quoteType === "CRYPTOCURRENCY" && averageDailyVolume10Day < cryptoMinimumDailyVolume) {
			res.status(400).send({ message: `This cryptocurrency does not have enough liquidity ($${averageDailyVolume10Day} < $${cryptoMinimumDailyVolume}). This restriction is in place to prevent cheating.` });
			return;
		} else if (averageDailyVolume10Day < minimumDailyVolume) {
			res.status(400).send({ message: `This asset does not have enough liquidity ($${averageDailyVolume10Day} < $${minimumDailyVolume}). This restriction is in place to prevent cheating.` });
			return;
		} else if (!averageDailyVolume10Day) {
			res.status(400).send({ message: `This asset does not have enough liquidity. This restriction is in place to prevent cheating.` });
			return;
		}

		let user = await User.findById((req as any).userId);
		user = user!;
		// If amount is provided, use inclusive fee semantics: deduct 'amount' from cash, fee reduces shares obtained
		if (amount && amount > 0) {
			const feeAmount = amount * tradeFee;
			const netForAsset = amount - feeAmount;
			const qtyFromAmount = netForAsset / price;

			if (user.cash! < amount) {
				res.status(400).send({ message: "Not enough cash (insufficient buying power)" });
				return;
			}

			user.cash! -= amount;

			const transaction: ITransaction = {
				symbol,
				price,
				quantity: qtyFromAmount,
				fee: feeAmount,
				type: "buy",
				date: Date.now(),
			} as ITransaction;

			user.ledger.push(transaction);

			const existingPosition = user.positions.find(pos => pos.symbol === symbol);
			if (existingPosition) {
				existingPosition.purchasePrice =
					((existingPosition.purchasePrice * existingPosition.quantity) + (price * qtyFromAmount)) /
					(existingPosition.quantity + qtyFromAmount);
				existingPosition.quantity += qtyFromAmount;
			} else {
				const position: IPosition = {
					symbol,
					quantity: qtyFromAmount,
					purchasePrice: price,
					purchaseDate: Date.now(),
				} as IPosition;
				user.positions.push(position);
			}

			user
				.save()
				.then((user) => {
					if (user) {
						res.status(200).send({ message: "Stock was bought successfully!" });
					}
				})
				.catch((err) => {
					if (err) {
						res.status(500).send({ message: err });
					}
				});
		} else {
			// Default: quantity-based, fee added on top (legacy behavior)
			const buyAmount = price * quantity;
			const feeAmount = buyAmount * tradeFee;

			if (user.cash! < buyAmount + feeAmount) {
				res.status(400).send({ message: "Not enough cash (including trade fee)" });
				return;
			}

			user.cash! -= buyAmount + feeAmount;

			const transaction: ITransaction = {
				symbol,
				price,
				quantity,
				fee: feeAmount,
				type: "buy",
				date: Date.now(),
			} as ITransaction;

			user.ledger.push(transaction);

			const existingPosition = user.positions.find(pos => pos.symbol === symbol);

			if (existingPosition) {
				existingPosition.purchasePrice =
					((existingPosition.purchasePrice * existingPosition.quantity) + (price * quantity)) /
					(existingPosition.quantity + quantity);
				existingPosition.quantity += quantity;
			} else {
				const position: IPosition = {
					symbol,
					quantity,
					purchasePrice: price,
					purchaseDate: Date.now(),
				} as IPosition;

				user.positions.push(position);
			}

			user
				.save()
				.then((user) => {
					if (user) {
						res.status(200).send({ message: "Stock was bought successfully!" });
					}
				})
				.catch((err) => {
					if (err) {
						res.status(500).send({ message: err });
					}
				});
		}
	} catch (error) {
		console.error("Error fetching " + symbol + " stock data:", error);
		res.status(500).send("Error fetching " + symbol + " stock data:" + error);
	}
};

const sellStock = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Transaction']
	*/
	const symbol = req.params.symbol;
	var quantity = req.body.quantity;

	try {
		const data = await fetchStockData(symbol);
		const price = data.regularMarketPrice;

		let user = await User.findById((req as any).userId);
		user = user!;

		// Check if user has enough shares to sell across all positions
		let quantityOwned = 0;
		user.positions.forEach((position) => {
			if (position.symbol === symbol) {
				quantityOwned += position.quantity;
			}
		});

		if (quantityOwned < quantity) {
			res.status(400).send({ message: "Not enough shares" });
			return;
		}

		const sellAmount = price * quantity;
		const sellFee = sellAmount * tradeFee;

		user.cash! += sellAmount - sellFee;

		// Add sell transaction to ledger (record fee)
		const transaction: ITransaction = {
			symbol,
			price,
			quantity,
			fee: sellFee,
			type: "sell",
			date: Date.now(),
		} as ITransaction;

		user.ledger.push(transaction);

		// Sell quantity of shares (decrement for each iteration of the loop) split between all positions of the same symbol
		for (let i = 0; i < user.positions.length; i++) {
			if (user.positions[i].symbol === symbol) {
				if (user.positions[i].quantity > quantity) {
					user.positions[i].quantity -= quantity;
					break;
				} else {
					quantity -= user.positions[i].quantity;
					user.positions.splice(i, 1);
					i--;
				}
			}
		}

		user
			.save()
			.then((user) => {
				if (user) {
					res.send({ message: "Stock was sold successfully!" });
				}
			})
			.catch((err) => {
				if (err) {
					res.status(500).send({ message: err });
				}
			});
	} catch (error) {
		console.error("Error fetching " + symbol + " stock data:", error);
		res.status(500).send("Error fetching " + symbol + " stock data:" + error);
	}
};

const search = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Data']
	*/
	const { query } = req.params;

	if (!query) res.status(400).send({ message: "No query provided" });

	searchStocks(query)
		.then((quotes) => {
			let stocksAndCurrencies = quotes.filter(
				(quote: { quoteType: string }) => {
					return (
						quote.quoteType &&
						quote.quoteType !== "FUTURE" &&
						quote.quoteType !== "Option"
					);
				},
			);
			res.status(200).send(stocksAndCurrencies);
		})
		.catch((err) => {
			console.log(err);
			res.status(500).send({ message: err });
		});
};

export default { getInfo, getHistorical, buyStock, sellStock, search };

// Export fee for routes to use
export const getTradeFee = async (_req: Request, res: Response) => {
	res.status(200).send({ fee: tradeFee });
};
