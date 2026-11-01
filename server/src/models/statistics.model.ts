import { Schema, model } from "mongoose";
import { BenchmarkPrices, calculateStatistics } from "../utils/statistics";

interface StatisticsCache {
	_id: string;
	attemptedAt?: Date;
	snapshot?: ReturnType<typeof calculateStatistics>;
}

export const StatisticsCache = model("StatisticsCache", new Schema<StatisticsCache>({
	_id: String,
	attemptedAt: Date,
	snapshot: Schema.Types.Mixed,
}));

export const BenchmarkHistory = model("BenchmarkHistory", new Schema<BenchmarkPrices & { _id: string }>({
	_id: String,
	symbol: String,
	updatedAt: Date,
	prices: [{ _id: false, date: Number, close: Number }],
}));
