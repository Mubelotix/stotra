const morgan = require("morgan"); //import morgan
const { log } = require("mercedlogger"); // import mercedlogger's log function
const cors = require("cors");
const rateLimit = require("express-rate-limit").rateLimit;
import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import yahooFinance from "yahoo-finance2";

// Config/initialization
const app = express();
// yahooFinance.setGlobalConfig({ validation: { logErrors: false } });
dotenv.config();

const PORT = process.env.PORT || 3010;

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
	windowMs: 5 * 60 * 1000, // 15 minutes
	max: 250, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.use("/api/", apiLimiter);

// REST Routes
app.use(require("./routes"));

app.listen(PORT, async () => {
	console.log(`Example app listening at http://0.0.0.0:${PORT}`);
	swaggerDocs(app, PORT);
});
