# Danthonia Expense Management Dashboard

This SuiteCloud project turns the reference household-spending workbook into a responsive NetSuite Suitelet. It reads posted general-ledger expense activity and renders the dashboard with Chart.js.

## Dashboard contents

- Reporting month, multi-select department and expense-account, subsidiary and 1-5 year comparison-window filters
- Current-month, same-month-prior-year, previous-full-year monthly average, selected-account share of Community : General monthly expenses, average monthly share, current-YTD, prior-YTD and YTD-change KPIs; every monthly average excludes months without transaction data
- A clickable average-share KPI with a monthly percentage bar chart, YTD/full-year/last-year presets, and an inclusive custom date range
- Multi-year stacked monthly expense trend
- Current-YTD expense mix
- One monthly comparison chart per leading expense category
- A selected-account focus view with Jan-December comparison bars for each year, an average of months with data, monthly minimum/maximum, YTD change and a same-period year history; multiple selected accounts are color-coded and stacked within each year bar while dark/light shades distinguish credit-card and other spend. A separate purple current-month segment forecasts the portion of unallocated credit-card suspense likely to reach the selected account and department, using the prior 12 completed months of cardholder and merchant/payee allocation patterns; clicking that segment opens every contributing suspense line with its original amount and estimated allocation
- A native NetSuite selected-month budget card and dashed gold monthly budget line for the selected expense account(s), department(s), subsidiary and fiscal year; when multiple budget categories exist, one version is displayed without adding alternative budgets together, and the card says `No budget set up` when the selected month has no matching budget
- A selected-account spend-over-time panel with YTD/full-year/last-year presets, a quick last 1–5 years selector and an inclusive custom date range, one chronological bar per month, an average line that excludes months without data, and an upward/downward spend trend line with a percentage arrow at its endpoint
- A selected-account contributor panel showing the top five credit-card users and top five non-card payees, their expense-account source when multiple accounts are selected, their share of total selected-account spend, and a clickable remainder list, with YTD/full-year/last-year presets and an inclusive custom date range; every contributor opens a complete transaction list sortable by amount or date
- Credit-card and other spend segments within each selected-account comparison bar, with exact shares in the chart tooltip
- Click-through bar segments that open all matching transaction lines for that month and year
- Browser-side CSV export of up to 200 posted expense lines for the reporting month

Filter changes refresh the data asynchronously, so the Suitelet page and Chart.js instances do not reload.

The startup view uses the current month, department `Community: Genral`, all expense accounts, a two-year comparison window and subsidiary `Church Communities`. Open either compact department or expense-account selector and click rows to toggle multiple entries. Multiple selected expense accounts are totalled together in the KPIs and color-stacked in the focused comparison chart. If a named department or subsidiary is unavailable to the executing role, its filter safely falls back to the corresponding `All` option.

## NetSuite data definition

The service uses `Transaction`, `TransactionLine`, `TransactionAccountingLine` and `AccountingBook` through `N/query` SuiteQL. It includes:

- posting accounting lines from the primary accounting book;
- account types `Expense`, `OthExpense` and `COGS`;
- transaction-date months;
- native primary-book amounts, including negative credits/refunds.

Credit-card spend is identified from NetSuite's native Credit Card Charge (`CardChrg`) and Credit Card Refund (`CardRfnd`) transaction types. Other transaction types are shown in the non-credit-card segment.

The suspense forecast detects active accounts whose full name contains `Suspense` plus a card identifier such as `Credit Card`, `CCA`, `Visa`, `Mastercard`, `Amex` or `NAB` (or uses the only active suspense account when there is exactly one). For the reporting month it reads those posted suspense lines across the selected subsidiary before department allocation. It then estimates the portion likely to reach the selected account and department by blending prior-12-month allocation rates for the cardholder, merchant/payee and the overall selected-account baseline. The purple chart segment and forecast figures remain separate from posted actual spend.

Clicking either shade of a comparison bar opens every matching expense line for that complete month/year bar through paged SuiteQL. Its scrollable table can be sorted by amount from highest to lowest or by date from newest to oldest. Bills use NetSuite's transaction vendor/entity as their merchant/payee. Card charges instead prefer their imported merchant, statement-payee, card-acceptor or transaction-description field from either the transaction header or expense line, so the issuing bank is only a fallback. For card transactions, the popup resolves the Employee join first, then a configured transaction or credit-card account field labelled as a credit-card user/cardholder/name-on-card, then NetSuite's Credit Cardholder Name and Created By fallbacks. Expense reports use their employee entity. These popup-only lookups are guarded so an unavailable field cannot prevent the dashboard itself from loading.

The default category is expense account. Users can switch to department grouping. If multiple subsidiaries use different base currencies, select one subsidiary before interpreting totals; the code deliberately does not invent a consolidation exchange-rate rule.

## Files

- `src/FileCabinet/SuiteScripts/dd/ExpenseMgmt/expense_dashboard_suitelet.js` - HTML/JSON Suitelet endpoint
- `src/FileCabinet/SuiteScripts/dd/ExpenseMgmt/expense_dashboard_service.js` - SuiteQL and aggregation logic
- `src/FileCabinet/SuiteScripts/dd/ExpenseMgmt/expense_dashboard_client.js` - Chart.js rendering and interaction
- `src/FileCabinet/SuiteScripts/dd/ExpenseMgmt/expense_dashboard.css` - responsive dashboard styling
- `src/Objects/customscript_danthonia_suitelet.xml` - script and deployment object

## Deploy

The project is already configured for the `stewardsbx` authentication ID.

```powershell
suitecloud project:validate
suitecloud project:deploy
```

The deployment is set to `RELEASED`, uses `DEBUG` logging, and is available to the `CCA - Steward` and `Administrator` roles. It is linked from the Accounting and Classic centers under Reports.

The executing role needs access to SuiteAnalytics Workbook/query data plus the relevant transaction, account, department and subsidiary records. The Suitelet is not configured for unauthenticated external access.

## Configuration notes

- Chart.js is pinned to `4.4.7` from jsDelivr in the Suitelet. If your Content Security Policy blocks that CDN, upload the same `chart.umd.min.js` build to the File Cabinet and replace `CHART_JS_URL` with its NetSuite file URL.
- The client formats values as AUD to match the reference workbook. Change `currencyCode` in `expense_dashboard_suitelet.js` and `expense_dashboard_service.js` if the selected subsidiary reports in another currency.
- Category count defaults to 12. The server accepts 5-20 and combines additional categories into `Other expenses` in the stacked chart.
- Use the account's Records Catalog if a feature-dependent field such as department or subsidiary is named differently in this NetSuite account.
