import React, { useEffect, useState } from "react";
import accounts from "../services/accounts.service";
import {
	Text,
	useToast,
	Tabs,
	TabList,
	Tab,
	Stack,
	HStack,
	Spacer,
	NumberInput,
	NumberInputField,
	NumberInputStepper,
	NumberIncrementStepper,
	NumberDecrementStepper,
	Divider,
	TabPanels,
	TabPanel,
	Button,
	Center,
	Switch,
} from "@chakra-ui/react";
import { useLocation } from "react-router-dom";

const formatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

function TransactionPane(props: { symbol: string; price: number }) {
	const [count, setCount] = useState(1);
	const [buyingPower, setBuyingPower] = useState(0);
	const [availableShares, setAvailableShares] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [isByValue, setIsByValue] = useState(true);

	const location = useLocation();

	const toast = useToast();

	const submitTransaction = (
		symbol: string,
		quantity: number,
		isBuy: boolean
	) => {
		setIsLoading(true);
		accounts
			.makeTransaction(symbol, quantity, isBuy ? "buy" : "sell")
			.then(() => {
				// Show success toast on successful transaction
				toast({
					title: "Transaction submitted",
					description: isBuy
						? "Bought "
						: "Sold " + quantity + " shares of " + symbol,
					status: "success",
				});
				// Update buying power and available shares
				accounts.getBuyingPower().then((value) => {
					setBuyingPower(value);
				});
				accounts.getAvailableShares(symbol).then((value) => {
					setAvailableShares(value);
				});
				// Turn off button spinner
				setIsLoading(false);
			})
			.catch((err) => {
				// Show error toast on failed transaction
				toast({
					title: "Error " + isBuy ? "buying" : "selling" + " " + symbol,
					description: err.message,
					status: "error",
				});
				// Turn off button spinner
				setIsLoading(false);
			});
	};

	useEffect(() => {
		accounts.getBuyingPower().then((value) => {
			setBuyingPower(value);
		});

		accounts.getAvailableShares(props.symbol!).then((value) => {
			console.log(props.symbol!, value);
			setAvailableShares(value);
		});
	}, [location]);

	return (
		<>
			<Tabs>
				<TabList>
					<Tab>Buy {props.symbol}</Tab>
					<Tab>Sell {props.symbol}</Tab>
				</TabList>

				<Stack p="5">
				<HStack>
					<Text>Trade by Value</Text>
					<Spacer />
					<Switch isChecked={isByValue} onChange={() => setIsByValue(!isByValue)}>
					</Switch>
				</HStack>

				{isByValue ? (
					<HStack>
					<Text>Value</Text>
					<Spacer />
					<NumberInput
						defaultValue={count}
						min={0.01}
						width="20"
						onChange={(e) => setCount(parseFloat(e))}
					>
						<NumberInputField />
						<NumberInputStepper>
						<NumberIncrementStepper />
						<NumberDecrementStepper />
						</NumberInputStepper>
					</NumberInput>
					</HStack>
				) : (
					<HStack>
					<Text>Shares</Text>
					<Spacer />
					<NumberInput
						defaultValue={count}
						min={0.000000001}
						width="20"
						onChange={(e) => setCount(parseFloat(e))}
					>
						<NumberInputField />
						<NumberInputStepper>
						<NumberIncrementStepper />
						<NumberDecrementStepper />
						</NumberInputStepper>
					</NumberInput>
					</HStack>
				)}

				<HStack>
					<Text>Current Price</Text>
					<Spacer />
					<Text>{formatter.format(props.price)}</Text>
				</HStack>

				<Spacer />
				<Divider />
				<Spacer />

				<HStack fontWeight="bold">
					<Text>Estimated Total</Text>
					<Spacer />
					<Text>
					{isByValue
						? formatter.format(count)
						: formatter.format(props.price * count)}
					</Text>
				</HStack>
				</Stack>

				<TabPanels>
					<TabPanel>
						<Button
							size="lg"
							width="100%"
							onClick={() => submitTransaction(props.symbol!, isByValue ? count / props.price : count, true)}
							{...(isLoading ? { isLoading: true } : {})}
						>
							Buy
						</Button>
						<Center mt={3}>
							<Text fontWeight="bold" fontSize="sm">
								{formatter.format(buyingPower)} Buying Power Available
							</Text>
						</Center>
					</TabPanel>
					<TabPanel>
						<Button
							size="lg"
							width="100%"
							onClick={() => submitTransaction(props.symbol!, isByValue ? count / props.price : count, false)}
							{...(isLoading ? { isLoading: true } : {})}
						>
							Sell
						</Button>
						<Center mt={3}>
							<Text fontWeight="bold" fontSize="sm">
								{availableShares} Shares Available
							</Text>
						</Center>
					</TabPanel>
				</TabPanels>
			</Tabs>
		</>
	);
}

export default TransactionPane;
