import { NextFunction, Request, Response } from "express";
import User from "../models/user.model";
import dotenv from "dotenv";

dotenv.config();
const startingCash = process.env.STOTRA_STARTING_CASH || 100_000;
const usernameHeader = process.env.STOTRA_USERNAME_HEADER || "x-username";

async function getOrCreateUserId(username: string): Promise<string> {
    try {
        // Step 1: Search for the user by username
        let user = await User.findOne({ username });

        // Step 2: If user doesn't exist, create a new user
        if (!user) {
            // Initialize a new user object with default values
            const newUser = new User({
                username: username,
                watchlist: [],
                ledger: [],
                positions: [],
                cash: startingCash,
            });

            // Save the new user to the database
            user = await newUser.save();
            console.log(`User '${username}' was created with ID: ${user._id}`);
        }

        // Step 3: Return the user ID
        return user._id;
    } catch (error) {
        console.error("Error in getOrCreateUserId:", error);
        throw new Error("Failed to get or create user.");
    }
};

export async function verifyToken(
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<Response | void> {
	/* #swagger.security = [{
		"bearerAuth": []
	}] 
	#swagger.autoHeaders=false
	*/

	// Retrieve the username from the trusted header
	let username = req.headers[usernameHeader];
	if (Array.isArray(username)) {
		username = username[0];
	}
	if (!username) {
		return res.status(401).send({ message: "No username provided" });
	}

	try {
		// Use the getOrCreateUserId function to get or create the user's ID
		const userId = await getOrCreateUserId(username);

		// Attach the userId to the request object for downstream use
		// Use a custom property instead of req.body to support GET requests
		(req as any).userId = userId;
		
		// Also set it on req.body if it exists (for POST/PUT requests)
		if (req.body) {
			req.body.userId = userId;
		}

		// Continue to the next middleware or route handler
		next();
	} catch (error) {
		// Handle any errors that occur while retrieving or creating the user ID
		console.error("Error in verifyToken middleware:", error);
		return res.status(500).send({ message: "Internal Server Error" });
	}
}

export default { verifyToken };
