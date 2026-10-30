import { Schema, model } from "mongoose";

export interface StockData {
	symbol: string;
	longName: string;
	regularMarketPrice: number;
	regularMarketPreviousClose: number;
	regularMarketChangePercent: number;
	quoteType: string;
	averageDailyVolume10Day: number;
}

export interface CachedQuote {
	_id: string;
	data?: StockData;
	updatedAt?: Date;
	attemptedAt?: Date;
}

const quoteSchema = new Schema<CachedQuote>({
	_id: { type: String, required: true },
	data: Schema.Types.Mixed,
	updatedAt: Date,
	attemptedAt: Date,
});

export default model("Quote", quoteSchema);
