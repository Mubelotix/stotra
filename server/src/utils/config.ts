import dotenv from "dotenv";

dotenv.config();
export const startingCash = Number(process.env.STOTRA_STARTING_CASH || 100_000);
if (!Number.isFinite(startingCash) || startingCash <= 0) throw new Error("STOTRA_STARTING_CASH must be positive");
