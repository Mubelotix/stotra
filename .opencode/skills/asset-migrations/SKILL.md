---
name: Asset Migrations
description: Investigate Stotra missing quotes and obsolete stock, fund, or crypto symbols; verify corporate actions, reconcile USD accounting and ledgers, and run safe dry-run-first migrations.
---

# Asset migrations in Stotra

Use for missing prices, obsolete symbols, delistings, mergers, fund changes, crypto swaps, cash-outs, historical trade corrections, and valuations in this repository. The objective is **economically correct holdings and USD cash**, not merely fewer symbols in `missingPrices`.

## Communication and privacy (apply throughout)

- The **only server-specific identifier** to disclose or repeat is the container name `stotra-backend`. No hostnames, addresses, login names, ports, topology, or credentials in examples, commands, skill files, or answers. Do not echo server details supplied by the user.
- The user runs commands **in their own server terminal**. Provide copy/paste `sudo docker exec ... stotra-backend ...` commands, not SSH/SCP instructions; do not remotely access the server yourself. Do not assume the repository checkout is available there. When a new script is needed, offer a self-contained, single quoted here-document into the container, followed by separate dry-run and apply commands. Quote the delimiter to prevent shell expansion. Do not hand the user a local repository path that cannot work on their server.
- Minimize exposure: report symbol-level findings and aggregate counts by default. Use read-only diagnostics and request transaction-level output only when essential; omit unrelated user identifiers and never expose secrets. Perform source research and local tests yourself before requesting any user-run command.
- Distinguish **verified**, **inferred**, **unsupported**, and **unknown**. State unresolved cases clearly; never call a missing quote worthless.

## Phase 1 — Establish what is actually missing

1. Read the relevant code: `server/src/models/{user,position,transaction,quote}.model.ts`, `server/src/utils/{statistics,publicStatistics,requests,quoteRefreshLimit}.ts`, and `server/src/controller/stocks.controller.ts`. Identify the actual deployed schema and quote path before writing a database command. Scripts in `server/scripts/` and tests in `server/test/` are examples, not automatically correct for new cases.
2. The public statistics snapshot is persisted and recomputed at most hourly; public requests are cache-only. The worker warms up to 100 stale symbols per pass; normal Yahoo requests share a rolling 100/hour budget (up to 200 for actual trades), and failed attempts count. A newly migrated ticker can stay in the warning temporarily despite a valid live Yahoo quote. Check snapshot `generatedAt`, quote `attemptedAt`/`updatedAt`, and positive held positions before declaring an action failed. Do **not** bypass the refresh budget just to hide the warning.
3. Establish a read-only inventory: unique held symbols, quantities and lot purchase prices/dates, matching ledger buys and sells, relevant cached quote name/type/price/currency, and whether an account already holds the proposed successor. For an ambiguous holding inspect only the minimum additional ledger data needed. Reconcile `sum(buys) − sum(sells)` with the remaining positions, allowing only documented floating-point tolerance.
4. Separate **quote outage/budget exhaustion**, **valid but delayed new quote**, **stale Yahoo alias**, and **real corporate action**. No price is not proof of delisting, zero consideration, or zero value.

## Phase 2 — Prove identity and terms

For each symbol record the **original security**, event type, effective/record/settlement dates, ratio and/or consideration, currency and unit, destination identifier, and primary evidence URL. Use issuer, exchange, regulator, fund manager, or project-primary notices for corporate actions; secondary price sites may corroborate but do not establish terms. Verify that the position was eligible at the relevant date and examine intervening trades. Never treat an acquirer's ticker as a 1:1 rename if holders actually received cash, shares at a ratio, or units/warrants.

| Class | Safe treatment when proven | Reasons to hold back |
| --- | --- | --- |
| Pure symbol change | Preserve lots, quantities, basis, and cash; choose deliberately whether historical ledger entries keep the old identifier. | Destination identity or currency differs. |
| Reverse split / stock merger | New quantity = old quantity × exchange ratio; preserve total cost basis, with price per share adjusted inversely. Handle mixed cash separately. | Missing ratio, fractional-share cash terms, or post-event trades. |
| All-cash acquisition | Remove eligible shares, credit documented USD proceeds, record an explicit zero-fee synthetic sell if suitable for the ledger. | Non-USD offer without FX, uncertain consideration, already paid position, or double-counted dividend. |
| Fund merger / SPAC unit | Verify exact share class/ISIN and exchange ratio or unit components; model each component. | Only a similar name or successor company is known. |
| Crypto token migration | Verify old/new project identity, **contract and chain**, conversion ratio and holder eligibility. | Similar ticker but unrelated token, unclaimed conditional allocation, or thin/unreliable market. |
| Unsupported quote | Preserve the holding and report the pricing gap; investigate an appropriate data source separately. | Never invent a price, replace with an unrelated coin, or automatically cash out for $0. |

For replacement quotes, execute the **installed** `yahoo-finance` binary locally or in `stotra-backend` as appropriate. Its search output is a candidate list, not verification. Check returned `symbol` is an exact match, name/issuer or project matches, `quoteType` and `currency` are expected, and `regularMarketPrice` is finite and positive. For crypto, match a stable project/market identifier and inspect liquidity, volume, and whether a price represents the actual held contract; a positive quote alone does not prove convertibility. If a replacement has no working price in the app's feed, either plan a separately verified price-source change or leave it unresolved.

## Phase 3 — Reconcile USD economics before coding

Stotra maintains USD cash, while Yahoo may quote foreign assets in EUR, CNY, TWD, **GBp** (pence), etc. Confirm the quote's *currency and unit*; `GBp` requires dividing by 100 before multiplying by GBP/USD. Use historical daily FX for the relevant purchase, previous sale, and settlement dates; select the quote matching the **local market date**, not the first UTC timestamp returned by a chart. Record the selected FX and source in the dry run. If the original app charged USD cash using an unconverted foreign price, preserve the **actual USD debit**, rather than refunding it or treating the original quantity as authoritative:

```
original_USD_debit_excluding_fee = original_buy_price × original_buy_quantity
USD_unit_price_at_buy = local_buy_price / local_units_per_major_currency × dated_FX_to_USD
corrected_buy_quantity = original_USD_debit_excluding_fee / USD_unit_price_at_buy
```

Keep the original fee unless there is evidence it too was misapplied. For a single buy followed by a partial sale, if the user's intent was to sell the same **fraction of holdings**, use `scale = corrected_buy_quantity / original_buy_quantity`, `corrected_sold_quantity = original_sold_quantity × scale`, and `corrected_remaining = corrected_buy_quantity − corrected_sold_quantity`. Correct the historical sale's USD unit price at its own dated FX, then adjust cash by **new sale proceeds minus originally credited proceeds**, accounting explicitly for any fee change. Finally apply the offer's USD proceeds to the corrected remainder. Validate the resulting ledger, positions, and USD cash together; never reuse this single-factor shortcut for multiple buys/lots or complex sales without deriving a correct matching policy. For a voluntary sale or ambiguous trading intent, ask before interpreting it as a proportional sale.

Differentiate **cash offer**, **cash in lieu of fractions**, **dividend**, and **simulated sale**. Do not fold a dividend into acquisition proceeds unless documented, the holder qualified, the simulation has not credited it before, and the accounting choice is stated. Preserve source and historical ledger entries that refer to genuinely different contracts/securities where needed; don't rewrite history solely to make old symbols disappear from statistics. Check `purchasePrice ≥ 0`, quantity minimum, finite arithmetic, time order, and no duplicated successor positions or cash credits.

## Phase 4 — Build a safe, repeatable migration

1. Create a narrow script under `server/scripts/`, following actual model and transaction schema. Keep the research/effective dates/ratios in code comments or nearby references. Default to read-only **dry run** and require `--apply` for writes. Check destination Yahoo quote identity again at run time; fail closed when validation or FX lookup fails. Do not silently skip a failure and report success.
2. Make the operation idempotent: selection requires the old held symbol, verifies no matching action was previously applied, and doesn't duplicate sale records/cash on rerun. Handle each user as one validated unit; guard against conflicting account edits between preview and apply (re-read/optimistic check or transaction where practical), and report explicit `SKIP` reasons. Preserve unrelated accounts and fields.
3. Test representative cases: old/new symbol identification, multiple lots, exchange ratios, currency unit and dated FX (including market timezone), cost and quantity invariants, partial sales and cash delta, fees/dividends, tiny fractional shares, mixed consideration, invalid quotes, absent positions, ambiguous histories, and rerunning. Run `npm test` in `server/`; identify any skipped integration checks.
4. Give the user **server-terminal copy/paste commands**: first a self-contained upload/create step if needed (no assumption of a checkout), then dry run, then—only after they inspect results and back up the database—an `--apply` command. If a command fails, fix its working-directory/quoting assumption rather than asking the user to discover paths.

## Phase 5 — Verify and close out

- Compare the production dry-run with the predicted accounts/aggregate shares and cash; investigate any skip, new trade, or price discrepancy. Revalidate before advising apply. Never assume the user ran a command until they report its output.
- After application, confirm updated positions, cash/ledger invariants, and idempotent rerun without additional writes. Wait for the background quote/statistics refresh; distinguish a still-unpriced new symbol from a failed position migration.
- Report what was fixed, what remains unknown or intentionally skipped, and any deeper issue (such as foreign-price conversion in the trading path) requiring a separate feature. Do not claim all missing-price warnings are solved merely because known mergers were processed.
