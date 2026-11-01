import { startingCash } from "./config";

// Pure calculations: no database access or market-data requests.
export interface StatisticsUser {
	cash: number;
	positions: { symbol: string; quantity: number }[];
	ledger: { symbol: string; price: number; quantity: number; fee?: number; type: string; date: number }[];
}

export interface StatisticsQuote {
	_id: string;
	data?: { longName?: string; regularMarketPrice?: number; quoteType?: string };
	updatedAt?: Date;
}

export interface Investor {
	value: number;
	firstTrade: number;
}

export interface BenchmarkPrices {
	symbol: string;
	updatedAt?: Date;
	prices: { date: number; close: number }[];
}

const day = 86400000;
const isTrade = (trade: StatisticsUser["ledger"][number]) => trade.type === "buy" || trade.type === "sell";

export function getInvestors(users: StatisticsUser[], quotes: StatisticsQuote[], now: number): Investor[] {
	const prices = new Map(quotes.map(quote => [quote._id, quote.data?.regularMarketPrice ?? 0]));
	return users.flatMap(user => {
		const trades = user.ledger.filter(trade => isTrade(trade) && trade.date <= now);
		if (!trades.length) return [];
		return [{
			value: user.cash + user.positions.reduce((value, position) => value + position.quantity * (prices.get(position.symbol) ?? 0), 0),
			firstTrade: Math.min(...trades.map(trade => trade.date)),
		}];
	});
}

export function calculateBenchmark(investors: Investor[], history: BenchmarkPrices) {
	const prices = history.prices.filter(point => point.close > 0 && Number.isFinite(point.close)).sort((a, b) => a.date - b.date);
	const latest = prices[prices.length - 1];
	let value = 0;
	let coveredInvestors = 0;
	for (const investor of investors) {
		// Daily closing price on the UTC first-trade date, or the next available session.
		const firstDay = Math.floor(investor.firstTrade / day) * day;
		const entry = prices.find(point => point.date >= firstDay && point.date < firstDay + 7 * day);
		if (!entry || !latest) continue;
		value += startingCash * latest.close / entry.close;
		coveredInvestors++;
	}
	const capital = investors.length * startingCash;
	const complete = investors.length > 0 && coveredInvestors === investors.length;
	return {
		symbol: history.symbol,
		value: complete ? value : null,
		returnPercent: complete ? (value / capital - 1) * 100 : null,
		coveredInvestors,
		updatedAt: history.updatedAt?.toISOString() ?? null,
		priceDate: latest ? new Date(latest.date).toISOString() : null,
	};
}

export function calculateStatistics(users: StatisticsUser[], quotes: StatisticsQuote[], histories: BenchmarkPrices[], now = Date.now()) {
	const bySymbol = new Map(quotes.map(quote => [quote._id, quote]));
	const assetClasses = [
		{ key: "stocks", label: "Stocks & funds", value: 0, holders: 0, bought30: 0, sold30: 0, fees30: 0 },
		{ key: "crypto", label: "Crypto", value: 0, holders: 0, bought30: 0, sold30: 0, fees30: 0 },
		{ key: "other", label: "Other / unclassified", value: 0, holders: 0, bought30: 0, sold30: 0, fees30: 0 },
	];
	const assetClass = (symbol: string) => {
		const type = bySymbol.get(symbol)?.data?.quoteType;
		return assetClasses[type === "CRYPTOCURRENCY" ? 1 : type && ["EQUITY", "ETF", "MUTUALFUND"].includes(type) ? 0 : 2];
	};
	const holdings = new Map<string, { symbol: string; name: string; holders: number; value: number }>();
	const trending = new Map<string, { symbol: string; name: string; bought30: number; sold30: number; bought365: number; sold365: number }>();
	const missingPrices = new Set<string>();
	let cash = 0, stockValue = 0, transactions30 = 0, tradingUsers30 = 0, fees30 = 0, feesAllTime = 0;
	for (const user of users) {
		cash += user.cash;
		const held = new Set<string>();
		const heldClasses = new Set<string>();
		for (const position of user.positions) {
			if (position.quantity <= 0) continue;
			const quote = bySymbol.get(position.symbol);
			const price = quote?.data?.regularMarketPrice ?? 0;
			if (!(price > 0)) missingPrices.add(position.symbol);
			const holding = holdings.get(position.symbol) ?? { symbol: position.symbol, name: quote?.data?.longName ?? position.symbol, holders: 0, value: 0 };
			holding.value += position.quantity * price;
			if (!held.has(position.symbol)) holding.holders++;
			held.add(position.symbol);
			holdings.set(position.symbol, holding);
			stockValue += position.quantity * price;
			const category = assetClass(position.symbol);
			category.value += position.quantity * price;
			if (!heldClasses.has(category.key)) category.holders++;
			heldClasses.add(category.key);
		}
		let active = false;
		for (const trade of user.ledger) {
			if (!isTrade(trade) || trade.date > now) continue;
			feesAllTime += trade.fee ?? 0;
			if (trade.date < now - 365 * day) continue;
			const row = trending.get(trade.symbol) ?? { symbol: trade.symbol, name: bySymbol.get(trade.symbol)?.data?.longName ?? trade.symbol, bought30: 0, sold30: 0, bought365: 0, sold365: 0 };
			const amount = trade.price * trade.quantity;
			if (trade.type === "buy") row.bought365 += amount;
			else row.sold365 += amount;
			if (trade.date >= now - 30 * day) {
				transactions30++;
				active = true;
				fees30 += trade.fee ?? 0;
				const category = assetClass(trade.symbol);
				category.fees30 += trade.fee ?? 0;
				if (trade.type === "buy") category.bought30 += amount;
				else category.sold30 += amount;
				if (trade.type === "buy") row.bought30 += amount;
				else row.sold30 += amount;
			}
			trending.set(trade.symbol, row);
		}
		if (active) tradingUsers30++;
	}
	const investors = getInvestors(users, quotes, now);
	const returns = investors.map(investor => (investor.value / startingCash - 1) * 100).sort((a, b) => a - b);
	const middle = Math.floor(returns.length / 2);
	const quoteDates = [...holdings.keys()].flatMap(symbol => bySymbol.get(symbol)?.updatedAt ? [bySymbol.get(symbol)!.updatedAt!.getTime()] : []);
	return {
		generatedAt: new Date(now).toISOString(),
		accounts: users.length,
		investingUsers: investors.length,
		transactions30, tradingUsers30, fees30, feesAllTime, cash, stockValue,
		assetClasses,
		holdings: [...holdings.values()].sort((a, b) => b.holders - a.holders || b.value - a.value),
		trending: [...trending.values()].sort((a, b) => b.bought30 - a.bought30),
		returns: {
			average: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
			median: returns.length ? (returns[middle] + returns[Math.floor((returns.length - 1) / 2)]) / 2 : null,
			capital: investors.length * startingCash,
			value: investors.reduce((sum, investor) => sum + investor.value, 0),
		},
		benchmarks: histories.map(history => calculateBenchmark(investors, history)),
		missingPrices: [...missingPrices].sort(),
		oldestQuoteAt: quoteDates.length ? new Date(Math.min(...quoteDates)).toISOString() : null,
	};
}
