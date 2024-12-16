import dotenv from "dotenv";
dotenv.config();
const jwtSecret = process.env.STOTRA_JWT_SECRET;
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Request, Response } from "express";

import User from "../models/user.model";
import axios from "axios";

const signup = (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Authentication']
	*/
	// Check if username and password are provided in the request body
	if (!req.body.username || !req.body.password) {
		res.status(400).send({ message: "Content cannot be empty!" });
		return;
	}

	// Hash the password and create a new user object
	const newUser = new User({
		username: req.body.username,
		password: bcrypt.hashSync(req.body.password, 8),
		watchlist: [],
		ledger: [],
		positions: [],
		cash: 100_000,
	});

	// Save the new user to the database
	newUser
		.save()
		.then(() => {
			// Respond with success message when the user is registered
			res.send({ message: "User was registered successfully!" });
		})
		.catch((err: Error) => {
			// Handle any errors during user saving
			res.status(500).send({ message: err.message });
		});
};


const login = (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Authentication']
	*/

	// Find the user by username
	User.findOne({
		username: req.body.username,
	})
		.then((user) => {
			if (!user) {
				// If user is not found, return a 404 error
				return res.status(404).send({ message: "User not found." });
			}

			// Compare the provided password with the stored hashed password
			const passwordIsValid = bcrypt.compareSync(
				req.body.password,
				user.password
			);

			if (!passwordIsValid) {
				// If the password is incorrect, return a 401 error
				return res.status(401).send({
					accessToken: null,
					message: "Incorrect password",
				});
			}

			// Generate a JWT token if the login is successful
			const token = jwt.sign({ id: user.id }, jwtSecret!, {
				algorithm: "HS256",
				allowInsecureKeySizes: true,
				expiresIn: "7 days",
			});

			// Send the response with the user data and access token
			res.status(200).send({
				id: user._id,
				username: user.username,
				accessToken: token,
			});
		})
		.catch((err: Error) => {
			// Handle any errors during the process
			res.status(500).send({ message: err.message });
		});
};


export default { signup, login };
