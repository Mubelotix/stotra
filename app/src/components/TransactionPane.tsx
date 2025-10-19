import React, { useEffect, useMemo, useState } from "react";
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

const sharesFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 8,
});

function TransactionPane(props: { symbol: string; price: number }) {
	const [count, setCount] = useState(1);
	const [buyingPower, setBuyingPower] = useState(0);
	const [availableShares, setAvailableShares] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [isByValue, setIsByValue] = useState(true);
	const [tradeFee, setTradeFee] = useState(0); // decimal e.g., 0.001 = 0.1%
	const [tabIndex, setTabIndex] = useState(0); // 0 = Buy, 1 = Sell

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
					title: "Error " + (isBuy ? "buying" : "selling") + " " + symbol,
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
			setAvailableShares(value);
		});

		accounts.getTradeFee().then((fee) => setTradeFee(fee ?? 0));
	}, [location, props.symbol]);

	// Compute shares and amounts with inclusive fee semantics when trading by value
	const estimatedShares = useMemo(() => {
		if (!isByValue) return count;
		if (tabIndex === 0) {
			const amount = count;
			const feeAmt = amount * tradeFee;
			const net = Math.max(amount - feeAmt, 0);
			return net / props.price;
		} else {
			const netDesired = count;
			const denom = props.price * Math.max(1 - tradeFee, 1e-12);
			return netDesired / denom;
		}
	}, [isByValue, count, props.price, tradeFee, tabIndex]);

	const grossAmount = useMemo(() => {
		if (!isByValue) return props.price * count;
		if (tabIndex === 0) {
			return count; // total to spend
		} else {
			return estimatedShares * props.price; // pre-fee proceeds for sell
		}
	}, [isByValue, count, props.price, estimatedShares, tabIndex]);

	const feeAmount = useMemo(() => grossAmount * tradeFee, [grossAmount, tradeFee]);
	const netAmount = useMemo(() => Math.max(grossAmount - feeAmount, 0), [grossAmount, feeAmount]);

	const isBuyDisabled = useMemo(() => {
		if (tabIndex !== 0) return false;
		const requiredCash = isByValue ? count : grossAmount + feeAmount;
		return requiredCash > buyingPower || estimatedShares <= 0;
	}, [tabIndex, isByValue, count, grossAmount, feeAmount, buyingPower, estimatedShares]);

	const isSellDisabled = useMemo(() => {
		if (tabIndex !== 1) return false;
		return estimatedShares <= 0 || estimatedShares > availableShares;
	}, [tabIndex, estimatedShares, availableShares]);

	return (
		<>
			<Tabs index={tabIndex} onChange={(i) => setTabIndex(i)}>
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

				{/* Totals summary will be shown per tab to reflect correct sign */}
				</Stack>

				<TabPanels>
					<TabPanel>
						<Stack p="2" mb={3}>
							<HStack>
								<Text>Fee ({(tradeFee * 100).toFixed(3)}%)</Text>
								<Spacer />
								<Text>{formatter.format(feeAmount)}</Text>
							</HStack>
							<HStack>
								<Text>Estimated Shares</Text>
								<Spacer />
								<Text>{isFinite(estimatedShares) ? sharesFormatter.format(estimatedShares) : "-"}</Text>
							</HStack>
							<HStack fontWeight="bold">
								<Text>Total Debited</Text>
								<Spacer />
								<Text>{formatter.format(isByValue ? count : grossAmount + feeAmount)}</Text>
							</HStack>
						</Stack>
						<Button
							size="lg"
							width="100%"
							onClick={() => {
								setIsLoading(true);
								if (isByValue) {
									accounts
										.makeBuyByAmount(props.symbol!, count)
										.then(() => {
											toast({
												title: "Transaction submitted",
												description: "Bought ",
												status: "success",
											});
											accounts.getBuyingPower().then(setBuyingPower);
											accounts.getAvailableShares(props.symbol!).then(setAvailableShares);
											setIsLoading(false);
										})
										.catch((err) => {
											toast({
												title: "Error buying " + props.symbol!,
												description: err.message,
												status: "error",
											});
											setIsLoading(false);
										});
								} else {
									submitTransaction(props.symbol!, estimatedShares, true);
								}
							}}
							{...(isLoading ? { isLoading: true } : {})}
							isDisabled={isBuyDisabled}
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
						<Stack p="2" mb={3}>
							<HStack>
								<Text>Fee ({(tradeFee * 100).toFixed(3)}%)</Text>
								<Spacer />
								<Text>{formatter.format(feeAmount)}</Text>
							</HStack>
							<HStack>
								<Text>Estimated Shares</Text>
								<Spacer />
								<Text>{isFinite(estimatedShares) ? sharesFormatter.format(estimatedShares) : "-"}</Text>
							</HStack>
							<HStack fontWeight="bold">
								<Text>Net Credit</Text>
								<Spacer />
								<Text>{formatter.format(netAmount)}</Text>
							</HStack>
						</Stack>
						<Button
							size="lg"
							width="100%"
							onClick={() => submitTransaction(props.symbol!, estimatedShares, false)}
							{...(isLoading ? { isLoading: true } : {})}
							isDisabled={isSellDisabled}
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
