import YahooFinance from "yahoo-finance2";
import Cache from "node-cache";
import axios from "axios";
import Quote, { CachedQuote, StockData } from "../models/quote.model";
import { reserveQuoteRefresh } from "./quoteRefreshLimit";
const stockCache = new Cache({ stdTTL: 60 }); // 1 minute

import dotenv from "dotenv";
dotenv.config();
export const yahooFinance = new YahooFinance({
	validation: { logErrors: false },
	queue: { concurrency: 1, interval: 1000 },
});

const quoteTTL = 60 * 1000;
const pendingQuotes = new Map<string, Promise<CachedQuote | null>>();

function lastQuoteActivity(quote?: CachedQuote | null): number {
	return Math.max(quote?.attemptedAt?.getTime() ?? 0, quote?.updatedAt?.getTime() ?? 0);
}

// Rankings return cached values and reuse the normal refresh path in the background.
export async function getCachedStockPrices(symbols: string[]): Promise<Map<string, number>> {
	const quotes = await Quote.find({ _id: { $in: symbols } }).lean();
	const bySymbol = new Map(quotes.map(quote => [quote._id, quote]));
	const prices = new Map(symbols.map(symbol => [symbol, bySymbol.get(symbol)?.data?.regularMarketPrice ?? 0]));
	const staleSymbols = [...new Set(symbols)]
		.filter(symbol => Date.now() - lastQuoteActivity(bySymbol.get(symbol)) >= quoteTTL)
		.sort((a, b) => lastQuoteActivity(bySymbol.get(a)) - lastQuoteActivity(bySymbol.get(b)));

	// Keep each page load small. Persisted attempt times rotate failures to the back too.
	for (const symbol of staleSymbols.slice(0, 10)) {
		void fetchStockData(symbol).catch(error => console.error("Error refreshing " + symbol + ":", error));
	}
	return prices;
}

export function unknownStockData(symbol: string): StockData {
	return {
		symbol,
		longName: symbol,
		regularMarketPrice: 0,
		regularMarketPreviousClose: 0,
		regularMarketChangePercent: 0,
		quoteType: "",
		averageDailyVolume10Day: 0,
	};
}

async function loadQuote(symbol: string): Promise<CachedQuote | null> {
	const cached = await Quote.findById(symbol).lean();
	if (Date.now() - lastQuoteActivity(cached) < quoteTTL) {
		return cached;
	}
	if (!await reserveQuoteRefresh()) return cached;

	// Persist the attempt before contacting Yahoo, so failures/restarts cannot retry freely.
	await Quote.updateOne({ _id: symbol }, { $set: { attemptedAt: new Date() } }, { upsert: true });
	try {
		const quote = await yahooFinance.quoteCombine(symbol);
		const price = quote.regularMarketPrice;
		if (quote.symbol !== symbol || typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
			throw new Error("Missing or invalid price for " + symbol);
		}
		const data: StockData = {
			symbol,
			longName: quote.longName ?? quote.shortName ?? symbol,
			regularMarketPrice: price,
			regularMarketPreviousClose: quote.regularMarketPreviousClose ?? 0,
			regularMarketChangePercent: quote.regularMarketChangePercent ?? 0,
			quoteType: quote.quoteType ?? "",
			averageDailyVolume10Day: quote.averageDailyVolume10Day ?? 0,
		};
		const updatedAt = new Date();
		await Quote.updateOne({ _id: symbol }, { $set: { data, updatedAt } });
		return { _id: symbol, data, updatedAt };
	} catch (error) {
		console.error("Error refreshing " + symbol + ":", error);
		return cached;
	}
}

export async function fetchStockData(symbol: string, requireFresh = false): Promise<StockData> {
	let pending = pendingQuotes.get(symbol);
	if (!pending) {
		pending = loadQuote(symbol).finally(() => pendingQuotes.delete(symbol));
		pendingQuotes.set(symbol, pending);
	}
	const quote = await pending;
	if (requireFresh && (!quote?.updatedAt || Date.now() - quote.updatedAt.getTime() >= quoteTTL || (quote.data?.regularMarketPrice ?? 0) <= 0)) {
		throw new Error("A fresh price is unavailable. Please try trading again later.");
	}
	return quote?.data ?? unknownStockData(symbol);
}

export const fetchHistoricalStockData = async (
	symbol: string,
	period: "1d" | "5d" | "1m" | "6m" | "YTD" | "1y" | "all" = "1d",
): Promise<any> => {
	const periodTerm =
		period === "1d" || period === "5d" || period === "1m" ? "short" : "long";
	const cacheKey = symbol + "-historical-" + periodTerm;

	try {
		if (stockCache.has(cacheKey)) {
			return stockCache.get(cacheKey);
		} else {
			let formattedData: number[][] = [];

			if (periodTerm == "short") {
				// If the period is less than 1 month, use intraday data from Alpha Vantage
				let res = await axios.get(
					"https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=" +
						symbol +
						"&interval=15min&extended_hours=true&outputsize=full&apikey=" +
						process.env.STOTRA_ALPHAVANTAGE_API,
				);
				const alphaData = res.data["Time Series (15min)"];

				if (!alphaData) {
					return fetchHistoricalStockData(symbol, "6m");
				}

				formattedData = Object.keys(alphaData)
					.map((key) => {
						return [
							new Date(key).getTime(),
							parseFloat(alphaData[key]["4. close"]),
						];
					})
					.sort((a, b) => a[0] - b[0]);
			} else {
				const yahooData = await yahooFinance.historical(symbol, {
					period1: new Date("2000-01-01"),
					period2: new Date(),
					interval: "1d",
				});

				formattedData = yahooData.map(
					(data: { date: { getTime: () => any }; close: any }) => {
						return [data.date.getTime(), data.close];
					},
				);
			}
			stockCache.set(cacheKey, formattedData);
			return formattedData;
		}
	} catch (error) {
		console.error("Error fetching " + symbol + " historical data:", error);
		return null;
	}
};

export const searchStocks = async (query: string): Promise<any> => {
	const queryOptions = {
		newsCount: 0,
		enableFuzzyQuery: true,
		enableNavLinks: false,
		enableCb: false,
		enableEnhancedTrivialQuery: false,
	};

	return yahooFinance
		.search(query, queryOptions)
		.then((results) => {
			return results.quotes;
		})
		.catch((err) => {
			if (err.result && Array.isArray(err.result.quotes)) {
				return err.result.quotes;
			} else {
				console.error(err);
				throw new Error(err);
			}
		});
};

/**
 * Detect if a numeric price has only one significant digit.
 * Examples that return true: 1000, 500, 10, 5, 0.5, 0.05
 * Examples that return false: 1200, 123, 1.23, 0.52
 */
export const hasOneSignificantDigit = (value: number): boolean => {
	if (!isFinite(value) || value <= 0) return false;

	const abs = Math.abs(value);
	// exponent (power of ten)
	const exponent = Math.floor(Math.log10(abs));
	const pow = Math.pow(10, exponent);
	const mantissa = abs / pow; // should be in [1, 10)

	// If mantissa is an integer 1..9 (within float tolerance) then value has a single significant digit.
	const rounded = Math.round(mantissa);
	const eps = 1e-9;
	return rounded >= 1 && rounded <= 9 && Math.abs(mantissa - rounded) < eps;
};
