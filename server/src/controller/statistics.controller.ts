import { Request, Response } from "express";
import { getPublicStatistics } from "../utils/publicStatistics";

const getStatistics = async (_req: Request, res: Response) => {
	try {
		const statistics = await getPublicStatistics();
		if (!statistics) {
			res.set("Retry-After", "60").status(503).send({ message: "Statistics are being prepared. Please try again shortly." });
			return;
		}
		res.status(200).send(statistics);
	} catch (error) {
		console.error("Error loading public statistics:", error);
		res.status(503).send({ message: "Statistics are temporarily unavailable." });
	}
};

export default { getStatistics };
