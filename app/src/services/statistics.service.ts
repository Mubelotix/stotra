import axios from "axios";

export interface HoldingStatistic {
	symbol: string;
	name: string;
	holders: number;
	value: number;
}

export interface TrendingStatistic {
	symbol: string;
	name: string;
	bought30: number;
	sold30: number;
	bought365: number;
	sold365: number;
}

export interface PublicStatistics {
	generatedAt: string;
	accounts: number;
	investingUsers: number;
	transactions30: number;
	tradingUsers30: number;
	fees30: number;
	feesAllTime: number;
	cash: number;
	stockValue: number;
	assetClasses: { key: string; label: string; value: number; holders: number; bought30: number; sold30: number; fees30: number }[];
	holdings: HoldingStatistic[];
	trending: TrendingStatistic[];
	returns: { average: number | null; median: number | null; capital: number; value: number };
	benchmarks: { symbol: string; value: number | null; returnPercent: number | null; coveredInvestors: number; updatedAt: string | null; priceDate: string | null }[];
	missingPrices: string[];
	oldestQuoteAt: string | null;
}

export async function getStatistics(signal: AbortSignal): Promise<PublicStatistics> {
	return (await axios.get<PublicStatistics>("/api/statistics", { signal })).data;
}
