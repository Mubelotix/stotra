import React, { useEffect, useState } from "react";
import { ChevronDownIcon, UnlockIcon } from "@chakra-ui/icons";
import { Button, Menu, MenuButton, MenuList, MenuItem } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import accounts from "../services/accounts.service";

function AccountMenu() {
	const [username, setUsername] = useState<string>("loading...");

	useEffect(() => {
		accounts.getUsername().then((gotUsername) => {
			setUsername(gotUsername);
		});
	}, []);

	return (
		<>
			{username ? (
				<Menu>
					<MenuButton
						as={Button}
						width={{ base: "100%", md: "auto" }}
						rightIcon={<ChevronDownIcon />}
					>
						{username}
					</MenuButton>
					<MenuList minWidth="fit-content">
						<MenuItem
							as={Button}
							leftIcon={<UnlockIcon />}
							variant="ghost"
							mx="2"
							width="auto"
							onClick={() => {
								window.location.href = "/api/logout";
							}}
						>
							Logout
						</MenuItem>
					</MenuList>
				</Menu>
			) : (
				<Button
					as={Link}
					to="/login"
					variant="outline"
					width={{ base: "100%", md: "auto" }}
				>
					Login
				</Button>
			)}
		</>
	);
}

export default AccountMenu;
