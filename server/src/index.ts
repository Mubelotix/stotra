const morgan = require("morgan"); //import morgan
const { log } = require("mercedlogger"); // import mercedlogger's log function
const cors = require("cors");
const rateLimit = require("express-rate-limit").rateLimit;
import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";

// Config/initialization
const app = express();
dotenv.config();

const PORT = process.env.PORT || 3010;
const IP_HEADER = process.env.STOTRA_IP_HEADER?.toLowerCase();

// Docs
const { swaggerDocs } = require("./utils/swagger");

// Database
const Database = require("./utils/db");
const UserSchema = require("./models/user.model");

// Middleware
app.use(cors());
app.use(morgan("tiny"));
app.use(express.json());

// Ratelimiting
const apiLimiter = rateLimit({
	windowMs: 5 * 60 * 1000, // 5 minutes
	max: 1000, // Limit each IP to 1000 requests per `window` (here, per 5 minutes)
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
	keyGenerator: (req: any) => {
		return IP_HEADER ? req.headers[IP_HEADER] || req.ip : req.ip;
	},
});

app.use("/api/", apiLimiter);

// REST Routes
app.use(require("./routes"));

app.listen(PORT, async () => {
	console.log(`Example app listening at http://0.0.0.0:${PORT}`);
	swaggerDocs(app, PORT);
});
