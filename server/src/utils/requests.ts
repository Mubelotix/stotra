import YahooFinance from "yahoo-finance2";
import Cache from "node-cache";
import axios from "axios";
const stockCache = new Cache({ stdTTL: 60 }); // 1 minute

import dotenv from "dotenv";
dotenv.config();
export const yahooFinance = new YahooFinance({
	validation: { logErrors: false},
	queue: { concurrency: 1 }
});

export const fetchStockData = async (demandedSymbol: string): Promise<any> => {
	const cachedData = stockCache.get(demandedSymbol + "-quote");
	if (cachedData) {
		return cachedData;
	}

	try {
		const quote = await yahooFinance.quoteCombine(demandedSymbol, {
			fields: [
				"regularMarketPrice",
				"regularMarketChangePercent",
				"longName",
				"regularMarketPreviousClose",
				"quoteType",
				"averageDailyVolume10Day",
			],
		});

		const {
			symbol,
			regularMarketPrice,
			regularMarketChangePercent,
			longName,
			regularMarketPreviousClose,
			quoteType,
			averageDailyVolume10Day,
		} = quote;

		if (demandedSymbol !== symbol) {
			throw new Error("Symbol mismatch");
		}

		const stockData = {
			symbol,
			longName,
			regularMarketPrice,
			regularMarketPreviousClose,
			regularMarketChangePercent,
			quoteType,
			averageDailyVolume10Day,
		};

		stockCache.set(symbol + "-quote", stockData);
		return stockData;
	} catch (err: any) {
		if (err.result && Array.isArray(err.result)) {
			for (let result of err.result) {				
				const {
					symbol,
					regularMarketPrice,
					regularMarketChangePercent,
					longName,
					regularMarketPreviousClose,
					quoteType,
					averageDailyVolume10Day,
				} = result;
	
				if (demandedSymbol !== symbol) {
					continue;
				}
	
				const stockData = {
					symbol,
					longName,
					regularMarketPrice,
					regularMarketPreviousClose,
					regularMarketChangePercent,
					quoteType,
					averageDailyVolume10Day,
				};
	
				stockCache.set(symbol + "-quote", stockData);
				return stockData;	
			}
			console.error("No results found for " + demandedSymbol);
			throw new Error("No results found for " + demandedSymbol);
		} else {
			console.error(err);
			console.error("Error fetching " + demandedSymbol + " stock data:", err);
			throw new Error(err);
		}
	}
};

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
