import React, { useEffect, useState } from "react";
import {
	Alert, AlertIcon, Badge, Box, Button, Flex, Heading, HStack, Link,
	SimpleGrid, Skeleton, Stack, Table, TableContainer, Tbody, Td, Text,
	Th, Thead, Tr, useColorModeValue,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import accessibility from "highcharts/modules/accessibility";
import { getStatistics, PublicStatistics, TrendingStatistic } from "../services/statistics.service";

accessibility(Highcharts);

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const count = (value: number) => new Intl.NumberFormat("en-US").format(value);
const percent = (value: number | null) => value === null ? "Unavailable" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const date = (value: string) => new Date(value).toLocaleString();
const colors = ["#D53F8C", "#805AD5", "#3182CE", "#38B2AC", "#ED8936", "#ECC94B", "#68D391", "#B794F4", "#FC8181", "#A0AEC0"];

function Panel({ children, ...props }: React.ComponentProps<typeof Box>) {
	const bg = useColorModeValue("white", "gray.800");
	return <Box bg={bg} borderWidth="1px" borderRadius="xl" p={{ base: 5, md: 7 }} {...props}>{children}</Box>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
	return <Panel>
		<Text fontSize="sm" color="gray.500" fontWeight="medium">{label}</Text>
		<Text fontSize={{ base: "2xl", md: "3xl" }} fontWeight="bold" letterSpacing="tight" my={2}>{value}</Text>
		<Text fontSize="xs" color="gray.500">{detail}</Text>
	</Panel>;
}

function SortHeading({ label, active, ascending, onClick }: { label: string; active: boolean; ascending: boolean; onClick: () => void }) {
	return <Button variant="unstyled" h="auto" fontSize="xs" textTransform="uppercase" letterSpacing="wide" onClick={onClick} aria-label={`Sort by ${label}${active ? (ascending ? ", ascending" : ", descending") : ""}`}>
		{label} <Box as="span" aria-hidden="true">{active ? (ascending ? "↑" : "↓") : "↕"}</Box>
	</Button>;
}

function Holdings({ data }: { data: PublicStatistics }) {
	const [sort, setSort] = useState<"holders" | "value">("holders");
	const [ascending, setAscending] = useState(false);
	const rows = [...data.holdings].sort((a, b) => (ascending ? 1 : -1) * (a[sort] - b[sort]) || a.symbol.localeCompare(b.symbol));
	const changeSort = (key: "holders" | "value") => { setSort(key); setAscending(sort === key ? !ascending : false); };
	return <Panel>
		<Heading size="md" mb={2}>Most held stocks</Heading>
		<Text fontSize="sm" color="gray.500" mb={5}>The community’s current positions. Click a heading to sort.</Text>
		<TableContainer maxH="440px" overflowY="auto">
			<Table size="sm">
				<Thead><Tr><Th>Stock / asset</Th>{(["holders", "value"] as const).map(key => <Th key={key} isNumeric aria-sort={sort === key ? (ascending ? "ascending" : "descending") : "none"}>
					<SortHeading label={key === "holders" ? "Holders" : "Invested value"} active={sort === key} ascending={ascending} onClick={() => changeSort(key)} />
				</Th>)}</Tr></Thead>
				<Tbody>{rows.map(row => <Tr key={row.symbol}>
					<Td py={4}><Text fontWeight="semibold">{row.symbol}</Text><Text fontSize="xs" color="gray.500" mt={1} maxW="200px" isTruncated>{row.name}</Text></Td>
					<Td isNumeric>{count(row.holders)}</Td><Td isNumeric fontWeight="medium">{money(row.value)}</Td>
				</Tr>)}</Tbody>
			</Table>
		</TableContainer>
		{!rows.length && <Text color="gray.500" py={6}>No holdings yet.</Text>}
		<Text fontSize="xs" color="gray.500" mt={4}>Invested value = shares held × cached market price, not purchase cost. Includes crypto and ETFs.</Text>
	</Panel>;
}

function Trending({ rows }: { rows: TrendingStatistic[] }) {
	type Key = "bought30" | "sold30" | "bought365" | "sold365";
	const [sort, setSort] = useState<Key>("bought30");
	const [ascending, setAscending] = useState(false);
	const columns: { key: Key; label: string }[] = [
		{ key: "bought30", label: "Bought · 30d" }, { key: "sold30", label: "Sold · 30d" },
		{ key: "bought365", label: "Bought · 365d" }, { key: "sold365", label: "Sold · 365d" },
	];
	return <Panel>
		<Heading size="md" mb={2}>Trending</Heading>
		<Text fontSize="sm" color="gray.500" mb={5}>Where the money is moving. Gross trade value in USD, excluding fees.</Text>
		<TableContainer maxH="440px" overflowY="auto"><Table size="sm">
			<Thead><Tr><Th>Stock / asset</Th>{columns.map(column => <Th key={column.key} isNumeric aria-sort={sort === column.key ? (ascending ? "ascending" : "descending") : "none"}>
				<SortHeading label={column.label} active={sort === column.key} ascending={ascending} onClick={() => { setSort(column.key); setAscending(sort === column.key ? !ascending : false); }} />
			</Th>)}</Tr></Thead>
			<Tbody>{[...rows].sort((a, b) => (ascending ? 1 : -1) * (a[sort] - b[sort]) || a.symbol.localeCompare(b.symbol)).map(row => <Tr key={row.symbol}>
				<Td py={4}><Text fontWeight="semibold">{row.symbol}</Text><Text color="gray.500" fontSize="xs" mt={1} maxW="190px" isTruncated>{row.name}</Text></Td>
				{columns.map(column => <Td key={column.key} isNumeric>{money(row[column.key])}</Td>)}
			</Tr>)}</Tbody>
		</Table></TableContainer>
		{!rows.length && <Text color="gray.500" py={6}>No trades in the last 365 days.</Text>}
	</Panel>;
}

function AllocationCharts({ data }: { data: PublicStatistics }) {
	const textColor = useColorModeValue("#2D3748", "#EDF2F7");
	const gridColor = useColorModeValue("#EDF2F7", "#4A5568");
	const ordered = [...data.holdings].filter(row => row.value > 0).sort((a, b) => b.value - a.value);
	const slices = ordered.slice(0, 9).map(row => ({ name: row.symbol, y: row.value }));
	if (ordered.length > 9) slices.push({ name: `Other (${ordered.length - 9} assets)`, y: ordered.slice(9).reduce((sum, row) => sum + row.value, 0) });
	const common: Highcharts.Options = {
		chart: { backgroundColor: "transparent", height: 310, animation: false, style: { fontFamily: "inherit" } },
		plotOptions: { series: { animation: false } },
		title: { text: undefined }, credits: { enabled: false }, colors,
		legend: { itemStyle: { color: textColor, fontWeight: "normal" } },
		accessibility: { enabled: true },
	};
	const pie: Highcharts.Options = {
		...common,
		legend: { ...common.legend, itemWidth: 110, itemDistance: 8, padding: 4 },
		accessibility: { description: "Share of the community's invested market value by asset. Cash is excluded." },
		tooltip: { pointFormat: "<b>${point.y:,.0f}</b> · {point.percentage:.1f}%" },
		plotOptions: { series: { animation: false }, pie: { borderWidth: 2, borderColor: "transparent", showInLegend: true, dataLabels: { enabled: false } } },
		series: [{ type: "pie", name: "Invested value", data: slices }],
	};
	const bar: Highcharts.Options = {
		...common,
		chart: { ...common.chart, type: "bar" },
		xAxis: { categories: ["Cash", "Stocks & assets"], lineWidth: 0, tickWidth: 0, labels: { style: { color: textColor } } },
		yAxis: { min: 0, tickAmount: 3, title: { text: undefined }, gridLineColor: gridColor, labels: { style: { color: textColor }, formatter() { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(Number(this.value)); } } },
		legend: { enabled: false },
		tooltip: { pointFormat: "<b>${point.y:,.0f}</b>" },
		plotOptions: { series: { animation: false }, bar: { borderWidth: 0, borderRadius: 5, pointWidth: 36 } },
		series: [{ type: "bar", name: "Community value", data: [{ y: data.cash, color: "#A0AEC0" }, { y: data.stockValue, color: colors[0] }] }],
	};
	return <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
		<Panel><Heading size="md" mb={2}>A slice of the portfolio</Heading><Text fontSize="sm" color="gray.500">{money(data.stockValue)} invested · cash excluded</Text>
			{data.stockValue > 0 ? <HighchartsReact highcharts={Highcharts} options={pie} /> : <Text py={12} color="gray.500">No priced holdings yet.</Text>}
			<Text fontSize="xs" color="gray.500">Largest nine positions shown separately; the table lists every asset.</Text>
		</Panel>
		<Panel><Heading size="md" mb={2}>On the sidelines or in the market?</Heading><Text fontSize="sm" color="gray.500">Cash versus current holdings across all {count(data.accounts)} accounts.</Text>
			<HighchartsReact highcharts={Highcharts} options={bar} />
			<Flex justify="space-between" gap={3} fontSize="sm" wrap="wrap"><Text>Cash <b>{money(data.cash)}</b></Text><Text>Invested <b>{money(data.stockValue)}</b></Text></Flex>
		</Panel>
	</SimpleGrid>;
}

function Performance({ data }: { data: PublicStatistics }) {
	const totalReturn = data.returns.capital > 0 ? (data.returns.value / data.returns.capital - 1) * 100 : null;
	const comparisons = [
		{ name: "The students", symbol: "Actual portfolios, including cash & fees", value: data.investingUsers ? data.returns.value : null, returnPercent: totalReturn, updatedAt: null, priceDate: null },
		{ name: "Cash", symbol: "Initial cash × investing users · no interest", value: data.returns.capital, returnPercent: 0, updatedAt: null, priceDate: null },
		...data.benchmarks.map(benchmark => ({ ...benchmark, name: benchmark.symbol === "BTC-USD" ? "What if everyone bought Bitcoin?" : "What if everyone bought S&P 500?", symbol: benchmark.symbol === "BTC-USD" ? "BTC-USD · buy & hold" : "S&P 500 index · buy & hold" })),
	];
	return <Panel>
		<Flex justify="space-between" gap={3} wrap="wrap" mb={5}><Box><Heading size="md" mb={2}>Are the strategies paying off?</Heading><Text color="gray.500" fontSize="sm">Lifetime returns for {count(data.investingUsers)} investing users. Accounts that never traded are excluded.</Text></Box><Badge alignSelf="start" colorScheme="purple">After recorded fees</Badge></Flex>
		<SimpleGrid columns={{ base: 1, sm: 3 }} spacing={6} mb={8}>
			<Box><Text color="gray.500" fontSize="sm">Students with positive returns</Text><Text fontSize="3xl" fontWeight="bold">{data.returns.positiveShare == null ? "Unavailable" : `${data.returns.positiveShare.toFixed(2)}%`}</Text><Text color="gray.500" fontSize="xs">Share of investing students whose portfolio exceeds their initial cash, after fees.</Text></Box>
			<Box><Text color="gray.500" fontSize="sm">Median investor return</Text><Text fontSize="3xl" fontWeight="bold">{percent(data.returns.median)}</Text><Text color="gray.500" fontSize="xs">The middle investor, not distorted by a few big winners.</Text></Box>
			<Box><Text color="gray.500" fontSize="sm">Average investor return</Text><Text fontSize="3xl" fontWeight="bold">{percent(data.returns.average)}</Text><Text color="gray.500" fontSize="xs">Each investing account has equal weight.</Text></Box>
		</SimpleGrid>
		<Heading size="sm" mb={4}>The buy-and-hold alternative</Heading>
		<SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4}>{comparisons.map((item, index) => <Box key={item.name} p={5} borderWidth="1px" borderRadius="lg" borderTopWidth="3px" borderTopColor={colors[index]}>
			<Text fontWeight="semibold" minH={{ lg: "48px" }}>{item.name}</Text><Text color="gray.500" fontSize="xs" mt={1}>{item.symbol}</Text>
			<Text fontSize="2xl" fontWeight="bold" mt={4}>{item.value === null ? "Unavailable" : money(item.value)}</Text>
			{item.returnPercent !== null && <Text fontWeight="semibold" color={item.returnPercent >= 0 ? "green.500" : "red.500"}>{percent(item.returnPercent)}</Text>}
		</Box>)}</SimpleGrid>
		<Text color="gray.500" fontSize="xs" mt={5} lineHeight="tall">Same investors, same fixed starting capital ({money(data.returns.capital)} total). Each hypothetical investor buys once at the daily close on their first trade’s UTC date, or the next available session, and holds until the latest available close. Bitcoin and the S&P 500 price index exclude fees, dividends and interest. These are approximate scenarios, not annualized or risk-adjusted returns. A benchmark is unavailable unless every investor has a matching entry price.</Text>
	</Panel>;
}

function StocksVsCrypto({ data }: { data: PublicStatistics }) {
	const rows = data.assetClasses.filter(row => row.key !== "other" || row.holders || row.bought30 || row.sold30);
	return <Panel>
		<Heading size="md" mb={2}>Stocks vs crypto</Heading>
		<Text fontSize="sm" color="gray.500" mb={5}>Traditional markets or digital assets? Compare where students put their money.</Text>
		{data.stockValue > 0 && <Flex h={5} borderRadius="full" overflow="hidden" mb={4} role="img" aria-label={rows.map(row => `${row.label}: ${(row.value / data.stockValue * 100).toFixed(1)}% of invested value`).join("; ")}>
			{rows.map((row, index) => <Box key={row.key} w={`${row.value / data.stockValue * 100}%`} bg={colors[index]} title={`${row.label}: ${money(row.value)}`} />)}
		</Flex>}
		<HStack spacing={5} wrap="wrap" mb={5}>{rows.map((row, index) => <HStack key={row.key} fontSize="sm"><Box w={3} h={3} bg={colors[index]} borderRadius="sm" /><Text>{row.label}{data.stockValue > 0 ? ` · ${(row.value / data.stockValue * 100).toFixed(1)}%` : ""}</Text></HStack>)}</HStack>
		<TableContainer><Table size="sm">
			<Thead><Tr><Th>Asset class</Th><Th isNumeric>Invested value</Th><Th isNumeric>Holders</Th><Th isNumeric>Bought · 30d</Th><Th isNumeric>Sold · 30d</Th><Th isNumeric>Fees · 30d</Th></Tr></Thead>
			<Tbody>{rows.map(row => <Tr key={row.key}><Td py={4} fontWeight="semibold">{row.label}</Td><Td isNumeric>{money(row.value)}</Td><Td isNumeric>{count(row.holders)}</Td><Td isNumeric>{money(row.bought30)}</Td><Td isNumeric>{money(row.sold30)}</Td><Td isNumeric>{money(row.fees30)}</Td></Tr>)}</Tbody>
		</Table></TableContainer>
		<Text color="gray.500" fontSize="xs" mt={4}>Stocks & funds includes equities, ETFs and mutual funds. Classification uses cached Yahoo asset types; missing or other types remain unclassified. Holders are unique within each class; someone can hold both. Cash is excluded.</Text>
	</Panel>;
}

export default function Statistics() {
	const [data, setData] = useState<PublicStatistics | null>(null);
	const [error, setError] = useState("");
	const [retry, setRetry] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		const load = () => { void getStatistics(controller.signal).then(result => { setData(result); setError(""); }).catch(() => { if (!controller.signal.aborted) setError("Statistics are temporarily unavailable. Please try again shortly."); }); };
		load();
		const timer = window.setInterval(load, 5 * 60000);
		return () => { controller.abort(); window.clearInterval(timer); };
	}, [retry]);
	return <Stack spacing={6}>
		<Flex justify="space-between" align="start" gap={4} wrap="wrap">
			<Box><HStack mb={3}><Badge colorScheme="pink" borderRadius="full" px={3} py={1}>Public observatory</Badge><Text fontSize="xs" color="gray.500">No login needed</Text></HStack>
				<Heading size="xl" letterSpacing="tight">Inside the student portfolio</Heading><Text mt={3} color="gray.500" maxW="650px">What engineering students hold, what they trade, and whether all that research is beating buy-and-hold.</Text></Box>
			<Link as={RouterLink} to="/leaderboard" fontSize="sm" fontWeight="semibold">View leaderboard →</Link>
		</Flex>
		{error && <Alert status="error" borderRadius="lg"><AlertIcon /><Box flex="1">{error}{data && " Showing the last loaded snapshot."}</Box><Button size="sm" onClick={() => setRetry(retry + 1)}>Retry</Button></Alert>}
		{!data && !error && <SimpleGrid columns={{ base: 1, md: 4 }} spacing={6}>{[1, 2, 3, 4].map(key => <Skeleton key={key} height="150px" borderRadius="xl" />)}</SimpleGrid>}
		{data && <>
			<Flex justify="space-between" gap={2} wrap="wrap" fontSize="xs" color="gray.500"><Text>Snapshot: {date(data.generatedAt)} · recomputed hourly</Text><Text>{count(data.investingUsers)} investors · {count(data.accounts)} accounts</Text></Flex>
			{Date.now() - new Date(data.generatedAt).getTime() > 2 * 3600000 && <Alert status="warning" borderRadius="lg"><AlertIcon />This snapshot is older than expected. An updated snapshot is not available yet.</Alert>}
			{data.missingPrices.length > 0 && <Alert status="warning" borderRadius="lg"><AlertIcon /><Text fontSize="sm">Prices available for {count(data.holdings.length - data.missingPrices.length)} of {count(data.holdings.length)} held assets. Missing prices count as $0, understating valuations and returns. Prices refresh automatically in the background.</Text></Alert>}
			<SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={4}>
				<Metric label="Monthly transactions" value={count(data.transactions30)} detail="Buys + sells · rolling 30 days" />
				<Metric label="Monthly trading users" value={count(data.tradingUsers30)} detail="Unique traders · rolling 30 days" />
				<Metric label="Fees paid this month" value={money(data.fees30)} detail="Recorded fees · rolling 30 days" />
				<Metric label="Fees paid, all time" value={money(data.feesAllTime)} detail="Virtual dollars spent on trading" />
			</SimpleGrid>
			<AllocationCharts data={data} />
			<StocksVsCrypto data={data} />
			<Holdings data={data} />
			<Trending rows={data.trending} />
			<Performance data={data} />
			<Box fontSize="xs" color="gray.500" lineHeight="tall"><Text>About the numbers: all amounts are virtual USD. Holdings use the persistent quote cache and may be older than this hourly snapshot.{data.oldestQuoteAt && ` Oldest held-asset quote: ${date(data.oldestQuoteAt)}.`}</Text><Text>Returns use the same fixed starting capital for every investor. Fees absent from older transactions are not estimated. Aggregate data only; no individual portfolios are exposed here.</Text></Box>
		</>}
	</Stack>;
}
