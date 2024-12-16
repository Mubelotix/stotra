import mongoose from "mongoose";
mongoose.Promise = global.Promise;

require("dotenv").config();

// Read password from dotenv file
const uri = process.env.STOTRA_MONGODB_URI;

if (!uri) {
	throw new Error("MongoDB URI is not defined");
}

mongoose.connect(uri);

const db = mongoose.connection;

db.on("error", console.error.bind(console, "connection error:"));

db.once("open", () => {
	console.log("Connected to Database");
});

module.exports = db;
