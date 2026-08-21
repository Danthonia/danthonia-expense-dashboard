/**
 * Danthonia expense management dashboard Suitelet.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define([
    'N/file',
    'N/log',
    'N/url',
    './expense_dashboard_service'
], (file, log, url, dashboardService) => {
    const SCRIPT_ID = 'customscript_danthonia_suitelet';
    const DEPLOYMENT_ID = 'customdeploy_danthonia_suitelet';
    const CLIENT_PATH = 'SuiteScripts/dd/ExpenseMgmt/expense_dashboard_client.js';
    const CSS_PATH = 'SuiteScripts/dd/ExpenseMgmt/expense_dashboard.css';
    const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
    const COMMUNITY_GENERAL_NAMES = ['Community: Genral', 'Community: General'];

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function jsonForScript(value) {
        return JSON.stringify(value)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
    }

    function loadAssetUrl(path) {
        try {
            return file.load({ id: path }).url;
        } catch (error) {
            log.error({
                title: `Unable to load dashboard asset: ${path}`,
                details: error
            });
            return '';
        }
    }

    function normaliseOptionName(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\s*:\s*/g, ':')
            .replace(/\s+/g, ' ');
    }

    function preferredOption(options, preferredNames) {
        const targets = (preferredNames || []).map(normaliseOptionName);
        return options.find((option) => (
            targets.includes(normaliseOptionName(option.name))
        ));
    }

    function optionMarkup(options, emptyLabel, preferredNames) {
        const selectedOption = preferredOption(options, preferredNames);
        return [
            `<option value=""${selectedOption ? '' : ' selected'}>${escapeHtml(emptyLabel)}</option>`,
            ...options.map((option) => (
                `<option value="${escapeHtml(option.id)}"${selectedOption && String(option.id) === String(selectedOption.id) ? ' selected' : ''}>${escapeHtml(option.name)}</option>`
            ))
        ].join('');
    }

    function renderPage(configuration) {
        const departmentOptions = optionMarkup(
            configuration.filters.departments,
            'All departments',
            COMMUNITY_GENERAL_NAMES
        );
        const accountOptions = optionMarkup(
            configuration.filters.accounts,
            'All expense accounts'
        );
        const subsidiaryOptions = optionMarkup(
            configuration.filters.subsidiaries,
            'All subsidiaries',
            ['Church Communities']
        );
        const stylesheet = configuration.cssUrl
            ? `<link rel="stylesheet" href="${escapeHtml(configuration.cssUrl)}">`
            : '';
        const clientScript = configuration.clientUrl
            ? `<script src="${escapeHtml(configuration.clientUrl)}"></script>`
            : '';

        return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Danthonia Expense Management</title>
    ${stylesheet}
</head>
<body>
    <div class="dashboard-shell">
        <header class="dashboard-header">
            <div>
                <p class="eyebrow">Financial operations</p>
                <h1>Danthonia Expense Management</h1>
                <p id="reportSubtitle" class="subtitle">Loading posted expense activity...</p>
            </div>
            <div class="header-actions">
                <button id="exportButton" class="button button-secondary" type="button" disabled>
                    Export detail CSV
                </button>
                <button id="printButton" class="button button-secondary" type="button">
                    Print
                </button>
            </div>
        </header>

        <form id="dashboardFilters" class="filter-panel">
            <label>
                <span>Reporting month</span>
                <input id="monthFilter" name="month" type="month" required>
            </label>
            <div class="filter-field">
                <span class="filter-label">Department <small>Click to select multiple</small></span>
                <select id="departmentFilter" name="department" class="native-multi-select" multiple>
                    ${departmentOptions}
                </select>
            </div>
            <div class="filter-field">
                <span class="filter-label">Expense account <small>Click to select multiple</small></span>
                <select id="accountFilter" name="account" class="native-multi-select" multiple>
                    ${accountOptions}
                </select>
            </div>
            <label>
                <span>Comparison window</span>
                <select id="yearsFilter" name="years">
                    <option value="1">1 year</option>
                    <option value="2" selected>2 years</option>
                    <option value="3">3 years</option>
                    <option value="4">4 years</option>
                    <option value="5">5 years</option>
                </select>
            </label>
            <label>
                <span>Subsidiary</span>
                <select id="subsidiaryFilter" name="subsidiary">
                    ${subsidiaryOptions}
                </select>
            </label>
            <input id="groupByFilter" name="groupBy" type="hidden" value="account">
            <input id="categoryLimitFilter" name="categoryLimit" type="hidden" value="12">
            <button class="button button-primary" type="submit">Refresh dashboard</button>
        </form>

        <div id="errorMessage" class="error-banner" role="alert" hidden></div>
        <div id="loadingState" class="loading-bar" aria-live="polite">
            <span></span> Refreshing expense data...
        </div>

        <main id="dashboardContent" aria-busy="true">
            <p id="kpiAccountScope" class="kpi-account-scope" hidden></p>
            <section class="kpi-grid kpi-grid-eight" aria-label="Expense summary">
                <article class="kpi-card kpi-card-primary">
                    <p id="kpiMonthLabel" class="kpi-label">Current month</p>
                    <p id="kpiCurrentMonth" class="kpi-value">-</p>
                    <p id="kpiCurrentMonthMeta" class="kpi-meta">-</p>
                </article>
                <article class="kpi-card">
                    <p id="kpiPriorMonthLabel" class="kpi-label">Same month last year</p>
                    <p id="kpiPriorMonth" class="kpi-value">-</p>
                    <p id="kpiPriorMonthMeta" class="kpi-meta">-</p>
                </article>
                <article class="kpi-card">
                    <p class="kpi-label">Average spend</p>
                    <p id="kpiAverageSpend" class="kpi-value">-</p>
                    <p id="kpiAverageSpendMeta" class="kpi-meta">-</p>
                </article>
                <article class="kpi-card">
                    <p class="kpi-label">Share of month</p>
                    <p id="kpiShareOfMonth" class="kpi-value">-</p>
                    <p id="kpiShareOfMonthMeta" class="kpi-meta">-</p>
                </article>
                <button id="kpiAverageShareCard" class="kpi-card kpi-card-button" type="button" aria-haspopup="dialog" aria-controls="shareTrendModal" disabled>
                    <p class="kpi-label">Average share of the month percentage</p>
                    <p id="kpiAverageShare" class="kpi-value">-</p>
                    <p id="kpiAverageShareMeta" class="kpi-meta">Click to view the monthly trend</p>
                </button>
                <article class="kpi-card">
                    <p id="kpiYtdLabel" class="kpi-label">This year YTD</p>
                    <p id="kpiYtd" class="kpi-value">-</p>
                    <p id="kpiYtdMeta" class="kpi-meta">-</p>
                </article>
                <article class="kpi-card">
                    <p id="kpiPriorYtdLabel" class="kpi-label">Last year YTD</p>
                    <p id="kpiPriorYtd" class="kpi-value">-</p>
                    <p id="kpiPriorYtdMeta" class="kpi-meta">-</p>
                </article>
                <article id="kpiChangeCard" class="kpi-card">
                    <p class="kpi-label">YTD change</p>
                    <p id="kpiChange" class="kpi-value">-</p>
                    <p id="kpiChangeMeta" class="kpi-meta">-</p>
                </article>
            </section>

            <section id="accountFocusSection" class="account-focus-section" hidden>
                <article class="panel account-focus-panel">
                    <div class="panel-heading">
                        <div>
                            <p class="section-kicker">Selected expense account</p>
                            <h2 id="accountComparisonTitle">Monthly spend by year</h2>
                        </div>
                        <p id="accountComparisonMeta" class="panel-meta"></p>
                    </div>
                    <div class="account-stat-grid">
                        <div class="account-stat">
                            <span>Average per month with data</span>
                            <strong id="accountAverage">-</strong>
                            <small>Current year - empty months excluded</small>
                        </div>
                        <div class="account-stat">
                            <span>Highest month</span>
                            <strong id="accountMaximum">-</strong>
                            <small id="accountMaximumMonth">-</small>
                        </div>
                        <div class="account-stat">
                            <span>Lowest month</span>
                            <strong id="accountMinimum">-</strong>
                            <small id="accountMinimumMonth">-</small>
                        </div>
                        <div id="accountBudgetStat" class="account-stat budget">
                            <span>Selected month budget</span>
                            <strong id="accountBudget">-</strong>
                            <small id="accountBudgetMeta">-</small>
                        </div>
                        <div id="accountYtdChangeStat" class="account-stat">
                            <span>YTD vs last year</span>
                            <strong id="accountYtdChange">-</strong>
                            <small id="accountYtdComparison">-</small>
                        </div>
                    </div>
                    <div class="chart-frame chart-frame-account">
                        <canvas id="accountComparisonChart"></canvas>
                    </div>
                    <section id="accountSuspenseForecast" class="account-suspense-forecast" hidden>
                        <div class="suspense-forecast-heading">
                            <div>
                                <p class="section-kicker">Credit-card suspense forecast</p>
                                <h3>Estimated current-month spend before allocation</h3>
                            </div>
                            <p id="accountSuspenseMeta" class="panel-meta"></p>
                        </div>
                        <div id="accountSuspenseLoading" class="breakdown-loading">Estimating unallocated credit-card spend...</div>
                        <div id="accountSuspenseError" class="error-banner" role="alert" hidden></div>
                        <div id="accountSuspenseContent" hidden>
                            <div class="suspense-forecast-stats">
                                <div class="suspense-forecast-stat">
                                    <span>Posted selected-account spend</span>
                                    <strong id="accountSuspenseActual">-</strong>
                                </div>
                                <div class="suspense-forecast-stat">
                                    <span>Credit-card suspense this month</span>
                                    <strong id="accountSuspenseTotal">-</strong>
                                </div>
                                <div class="suspense-forecast-stat estimate">
                                    <span>Estimated suspense for selected account</span>
                                    <strong id="accountSuspenseEstimate">-</strong>
                                </div>
                                <div class="suspense-forecast-stat forecast">
                                    <span>Estimated current-month total</span>
                                    <strong id="accountSuspenseForecastTotal">-</strong>
                                </div>
                            </div>
                            <div class="suspense-driver-grid">
                                <article>
                                    <h4>Top cardholder suspense drivers</h4>
                                    <p>Usual selected-account allocation and this month’s estimate.</p>
                                    <div id="accountSuspenseCardholders" class="suspense-driver-list"></div>
                                </article>
                                <article>
                                    <h4>Top merchant / payee suspense drivers</h4>
                                    <p>Historical merchant/payee allocation and this month’s estimate.</p>
                                    <div id="accountSuspensePayees" class="suspense-driver-list"></div>
                                </article>
                            </div>
                            <p id="accountSuspenseNote" class="suspense-forecast-note"></p>
                        </div>
                    </section>
                    <div class="table-scroll account-history-table">
                        <table>
                            <thead>
                                <tr>
                                    <th scope="col">Year</th>
                                    <th class="numeric" scope="col">Spend to selected month</th>
                                    <th class="numeric" scope="col">Average of months with data</th>
                                    <th class="numeric" scope="col">Maximum month</th>
                                    <th class="numeric" scope="col">Minimum month</th>
                                    <th class="numeric" scope="col">Change vs previous year</th>
                                </tr>
                            </thead>
                            <tbody id="accountHistoryBody"></tbody>
                        </table>
                    </div>
                </article>
            </section>

            <section id="accountBreakdownSection" class="panel account-breakdown-panel" hidden>
                <div class="panel-heading">
                    <div>
                        <p class="section-kicker">Selected account detail</p>
                        <h2 id="accountBreakdownTitle">Spend contributors</h2>
                    </div>
                    <p id="accountBreakdownMeta" class="panel-meta"></p>
                </div>
                <div class="breakdown-period-controls" aria-label="Selected account detail period">
                    <div class="breakdown-period-buttons" role="group" aria-label="Period presets">
                        <button id="breakdownPeriodYtd" class="breakdown-period-button is-active" type="button" data-breakdown-period="ytd" aria-pressed="true">Year to date</button>
                        <button id="breakdownPeriodThisYear" class="breakdown-period-button" type="button" data-breakdown-period="thisyear" aria-pressed="false">This year</button>
                        <button id="breakdownPeriodLastYear" class="breakdown-period-button" type="button" data-breakdown-period="lastyear" aria-pressed="false">Last year</button>
                    </div>
                    <div class="breakdown-custom-dates">
                        <label for="breakdownStartDate">
                            <span>From</span>
                            <input id="breakdownStartDate" type="date">
                        </label>
                        <label for="breakdownEndDate">
                            <span>To</span>
                            <input id="breakdownEndDate" type="date">
                        </label>
                    </div>
                </div>
                <div id="accountBreakdownLoading" class="breakdown-loading">Loading contributor breakdown...</div>
                <div id="accountBreakdownError" class="error-banner" role="alert" hidden></div>
                <div id="accountBreakdownContent" class="account-breakdown-grid" hidden>
                    <article class="breakdown-column">
                        <div class="breakdown-heading">
                            <div>
                                <p class="section-kicker">Credit-card spend</p>
                                <h3>Top 5 credit-card spenders</h3>
                            </div>
                            <strong id="creditCardBreakdownTotal">-</strong>
                        </div>
                        <div id="creditCardBreakdownList" class="breakdown-list"></div>
                    </article>
                    <article class="breakdown-column">
                        <div class="breakdown-heading">
                            <div>
                                <p class="section-kicker">Other spend categories</p>
                                <h3>Top 5 other-spend payees</h3>
                            </div>
                            <strong id="otherBreakdownTotal">-</strong>
                        </div>
                        <p class="breakdown-note">Grouped by merchant or payee.</p>
                        <div id="otherBreakdownList" class="breakdown-list"></div>
                    </article>
                </div>
            </section>

            <section id="accountSpendOverTimeSection" class="panel account-spend-over-time-panel" hidden>
                <div class="panel-heading">
                    <div>
                        <p class="section-kicker">Spend over time</p>
                        <h2 id="accountSpendOverTimeTitle">Selected-account annual trend</h2>
                    </div>
                    <p id="accountSpendOverTimeMeta" class="panel-meta"></p>
                </div>
                <div class="breakdown-period-controls" aria-label="Spend over time period">
                    <div class="breakdown-period-buttons" role="group" aria-label="Period presets">
                        <button id="accountTimePeriodYtd" class="breakdown-period-button is-active" type="button" data-account-time-period="ytd" aria-pressed="true">Year to date</button>
                        <button id="accountTimePeriodThisYear" class="breakdown-period-button" type="button" data-account-time-period="thisyear" aria-pressed="false">This year</button>
                        <button id="accountTimePeriodLastYear" class="breakdown-period-button" type="button" data-account-time-period="lastyear" aria-pressed="false">Last year</button>
                        <select id="accountTimeYears" class="breakdown-period-select" aria-label="Spend over time history window">
                            <option value="">Last 1–5 years</option>
                            <option value="1">Last 1 year</option>
                            <option value="2">Last 2 years</option>
                            <option value="3">Last 3 years</option>
                            <option value="4">Last 4 years</option>
                            <option value="5">Last 5 years</option>
                        </select>
                    </div>
                    <div class="breakdown-custom-dates">
                        <label for="accountTimeStartDate">
                            <span>From</span>
                            <input id="accountTimeStartDate" type="date">
                        </label>
                        <label for="accountTimeEndDate">
                            <span>To</span>
                            <input id="accountTimeEndDate" type="date">
                        </label>
                    </div>
                </div>
                <div id="accountTimeLoading" class="breakdown-loading">Loading spend over time...</div>
                <div id="accountTimeError" class="error-banner" role="alert" hidden></div>
                <div id="accountTimeContent" class="account-time-content" hidden>
                    <div class="account-time-summary">
                        <div class="account-time-stat">
                            <span>Average spend per month with data</span>
                            <strong id="accountTimeAverage">-</strong>
                        </div>
                        <div id="accountTimeChangeStat" class="account-time-stat">
                            <span>Monthly average increase / decrease</span>
                            <strong id="accountTimeChange">-</strong>
                            <small id="accountTimeChangeMeta">-</small>
                        </div>
                    </div>
                    <div class="chart-frame chart-frame-account-time">
                        <canvas id="accountSpendOverTimeChart"></canvas>
                    </div>
                </div>
            </section>

            <section id="portfolioCharts" class="chart-layout">
                <article class="panel panel-wide">
                    <div class="panel-heading">
                        <div>
                            <p class="section-kicker">Trend</p>
                            <h2 id="monthlyTrendTitle">Monthly expense mix</h2>
                        </div>
                        <p id="monthlyTrendMeta" class="panel-meta"></p>
                    </div>
                    <div class="chart-frame chart-frame-large">
                        <canvas id="monthlyTrendChart"></canvas>
                    </div>
                </article>

                <article class="panel">
                    <div class="panel-heading">
                        <div>
                            <p class="section-kicker">Composition</p>
                            <h2>Current YTD spend mix</h2>
                        </div>
                    </div>
                    <div class="chart-frame chart-frame-doughnut">
                        <canvas id="spendMixChart"></canvas>
                    </div>
                </article>

                <article class="panel insight-panel">
                    <div class="panel-heading">
                        <div>
                            <p class="section-kicker">Management view</p>
                            <h2>Period context</h2>
                        </div>
                    </div>
                    <dl class="insight-list">
                        <div><dt>Average month with data, current YTD</dt><dd id="averageMonthlyYtd">-</dd></div>
                        <div><dt>Last full year</dt><dd id="lastFullYear">-</dd></div>
                        <div><dt>Full-year change</dt><dd id="fullYearChange">-</dd></div>
                        <div><dt>Categories in result</dt><dd id="categoryCount">-</dd></div>
                    </dl>
                </article>
            </section>

            <section id="categorySection" class="category-section">
                <div class="section-heading">
                    <div>
                        <p class="section-kicker">Monthly comparisons</p>
                        <h2 id="comparisonTitle">Each category by year</h2>
                    </div>
                    <p class="panel-meta">The highest-spend categories appear first.</p>
                </div>
                <div id="categoryCharts" class="category-chart-grid"></div>
            </section>

        </main>

        <footer>
            <span id="generatedAt">Not yet refreshed</span>
            <span>Posted expense, other expense and COGS lines from the primary accounting book.</span>
        </footer>
    </div>

    <div id="spendDrilldownModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="spendDrilldownTitle" hidden>
        <section class="spend-modal">
            <header class="spend-modal-header">
                <div>
                    <p id="spendDrilldownKicker" class="section-kicker">Actual spend</p>
                    <h2 id="spendDrilldownTitle">Expense transactions</h2>
                    <p id="spendDrilldownMeta" class="panel-meta">Loading transaction lines...</p>
                </div>
                <div class="spend-modal-tools">
                    <div class="modal-sort-actions" aria-label="Sort transaction lines">
                        <button id="sortSpendByAmount" class="modal-sort-button is-active" type="button" aria-pressed="true">
                            Amount: highest first
                        </button>
                        <button id="sortSpendByDate" class="modal-sort-button" type="button" aria-pressed="false">
                            Date: newest first
                        </button>
                    </div>
                    <button id="closeSpendDrilldown" class="modal-close" type="button" aria-label="Close transaction list">&times;</button>
                </div>
            </header>
            <div id="spendDrilldownLoading" class="modal-loading">Loading actual spend...</div>
            <div id="spendDrilldownError" class="error-banner" role="alert" hidden></div>
            <div class="modal-table-scroll">
                <table class="drilldown-table">
                    <thead>
                        <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Transaction</th>
                            <th scope="col">Type</th>
                            <th scope="col">Merchant / payee</th>
                            <th scope="col">Credit card user</th>
                            <th id="spendAccountHeader" scope="col">Expense account</th>
                            <th id="spendAmountHeader" class="numeric" scope="col">Amount</th>
                            <th id="spendEstimatedHeader" class="numeric" scope="col" hidden>Estimated allocation</th>
                        </tr>
                    </thead>
                    <tbody id="spendDrilldownBody"></tbody>
                </table>
            </div>
        </section>
    </div>

    <div id="breakdownRemainderModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="breakdownRemainderTitle" hidden>
        <section class="spend-modal breakdown-modal">
            <header class="spend-modal-header">
                <div>
                    <p class="section-kicker">Remaining contributors</p>
                    <h2 id="breakdownRemainderTitle">Remaining spend</h2>
                    <p id="breakdownRemainderMeta" class="panel-meta"></p>
                </div>
                <button id="closeBreakdownRemainder" class="modal-close" type="button" aria-label="Close remaining contributors">&times;</button>
            </header>
            <div class="modal-table-scroll">
                <table class="breakdown-remainder-table">
                    <thead>
                        <tr>
                            <th scope="col">Contributor</th>
                            <th id="breakdownRemainderAccountHeader" scope="col" hidden>Expense account</th>
                            <th class="numeric" scope="col">Percentage</th>
                            <th class="numeric" scope="col">Amount</th>
                        </tr>
                    </thead>
                    <tbody id="breakdownRemainderBody"></tbody>
                </table>
            </div>
        </section>
    </div>

    <div id="shareTrendModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shareTrendTitle" hidden>
        <section class="spend-modal share-trend-modal">
            <header class="spend-modal-header">
                <div>
                    <p class="section-kicker">Average share of month</p>
                    <h2 id="shareTrendTitle">Monthly share of Community : General spend</h2>
                    <p id="shareTrendMeta" class="panel-meta"></p>
                </div>
                <button id="closeShareTrend" class="modal-close" type="button" aria-label="Close monthly share chart">&times;</button>
            </header>
            <div class="breakdown-period-controls share-trend-controls" aria-label="Monthly share chart period">
                <div class="breakdown-period-buttons" role="group" aria-label="Period presets">
                    <button id="sharePeriodYtd" class="breakdown-period-button is-active" type="button" data-share-period="ytd" aria-pressed="true">Year to date</button>
                    <button id="sharePeriodThisYear" class="breakdown-period-button" type="button" data-share-period="thisyear" aria-pressed="false">This year</button>
                    <button id="sharePeriodLastYear" class="breakdown-period-button" type="button" data-share-period="lastyear" aria-pressed="false">Last year</button>
                </div>
                <div class="breakdown-custom-dates">
                    <label for="shareStartDate">
                        <span>From</span>
                        <input id="shareStartDate" type="date">
                    </label>
                    <label for="shareEndDate">
                        <span>To</span>
                        <input id="shareEndDate" type="date">
                    </label>
                </div>
            </div>
            <div id="shareTrendLoading" class="modal-loading">Loading monthly percentages...</div>
            <div id="shareTrendError" class="error-banner" role="alert" hidden></div>
            <div id="shareTrendContent" class="share-trend-chart" hidden>
                <canvas id="shareTrendChart"></canvas>
            </div>
        </section>
    </div>

    <script>
        window.DANTHONIA_EXPENSE_DASHBOARD = ${jsonForScript(configuration.clientConfig)};
    </script>
    <script src="${escapeHtml(CHART_JS_URL)}"></script>
    ${clientScript}
</body>
</html>`;
    }

    function writeJson(response, payload) {
        response.setHeader({
            name: 'Content-Type',
            value: 'application/json; charset=utf-8'
        });
        response.write(JSON.stringify(payload));
    }

    function writeDashboardData(context) {
        try {
            const data = dashboardService.getDashboard(context.request.parameters || {});
            writeJson(context.response, { ok: true, data });
        } catch (error) {
            log.error({ title: 'Expense dashboard data request failed', details: error });
            context.response.statusCode = 500;
            writeJson(context.response, {
                ok: false,
                error: {
                    name: error.name || 'EXPENSE_DASHBOARD_ERROR',
                    message: error.message || String(error)
                }
            });
        }
    }

    function writeDrilldownData(context) {
        try {
            const data = dashboardService.getDrilldown(context.request.parameters || {});
            writeJson(context.response, { ok: true, data });
        } catch (error) {
            log.error({ title: 'Expense dashboard drill-down request failed', details: error });
            context.response.statusCode = 500;
            writeJson(context.response, {
                ok: false,
                error: {
                    name: error.name || 'EXPENSE_DRILLDOWN_ERROR',
                    message: error.message || String(error)
                }
            });
        }
    }

    function writeBreakdownData(context) {
        try {
            const data = dashboardService.getAccountBreakdown(context.request.parameters || {});
            writeJson(context.response, { ok: true, data });
        } catch (error) {
            log.error({ title: 'Expense dashboard account-breakdown request failed', details: error });
            context.response.statusCode = 500;
            writeJson(context.response, {
                ok: false,
                error: {
                    name: error.name || 'EXPENSE_BREAKDOWN_ERROR',
                    message: error.message || String(error)
                }
            });
        }
    }

    function writeShareTrendData(context) {
        try {
            const data = dashboardService.getShareTrend(context.request.parameters || {});
            writeJson(context.response, { ok: true, data });
        } catch (error) {
            log.error({ title: 'Expense dashboard share-trend request failed', details: error });
            context.response.statusCode = 500;
            writeJson(context.response, {
                ok: false,
                error: {
                    name: error.name || 'EXPENSE_SHARE_TREND_ERROR',
                    message: error.message || String(error)
                }
            });
        }
    }

    function writeAccountSpendTrendData(context) {
        try {
            const data = dashboardService.getAccountSpendTrend(context.request.parameters || {});
            writeJson(context.response, { ok: true, data });
        } catch (error) {
            log.error({ title: 'Expense dashboard account spend-trend request failed', details: error });
            context.response.statusCode = 500;
            writeJson(context.response, {
                ok: false,
                error: {
                    name: error.name || 'EXPENSE_ACCOUNT_TREND_ERROR',
                    message: error.message || String(error)
                }
            });
        }
    }

    function writeContributorTransactions(context) {
        try {
            const data = dashboardService.getContributorTransactions(context.request.parameters || {});
            writeJson(context.response, { ok: true, data });
        } catch (error) {
            log.error({ title: 'Expense dashboard contributor transactions request failed', details: error });
            context.response.statusCode = 500;
            writeJson(context.response, {
                ok: false,
                error: {
                    name: error.name || 'EXPENSE_CONTRIBUTOR_TRANSACTIONS_ERROR',
                    message: error.message || String(error)
                }
            });
        }
    }

    function writeAccountSuspenseEstimate(context) {
        try {
            const data = dashboardService.getAccountSuspenseEstimate(context.request.parameters || {});
            writeJson(context.response, { ok: true, data });
        } catch (error) {
            log.error({ title: 'Expense dashboard suspense estimate request failed', details: error });
            context.response.statusCode = 500;
            writeJson(context.response, {
                ok: false,
                error: {
                    name: error.name || 'EXPENSE_SUSPENSE_ESTIMATE_ERROR',
                    message: error.message || String(error)
                }
            });
        }
    }

    function writeDashboardPage(context) {
        const now = new Date();
        const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const filters = dashboardService.getFilterOptions();
        const shareDepartment = preferredOption(filters.departments, COMMUNITY_GENERAL_NAMES);
        const endpoint = url.resolveScript({
            scriptId: SCRIPT_ID,
            deploymentId: DEPLOYMENT_ID,
            returnExternalUrl: false
        });
        const configuration = {
            cssUrl: loadAssetUrl(CSS_PATH),
            clientUrl: loadAssetUrl(CLIENT_PATH),
            filters,
            clientConfig: {
                endpoint,
                defaultMonth,
                defaultYears: 2,
                defaultCategoryLimit: 12,
                shareDepartmentId: shareDepartment ? String(shareDepartment.id) : '',
                shareDepartmentName: shareDepartment ? shareDepartment.name : 'Community : General',
                currencyCode: 'AUD'
            }
        };
        context.response.setHeader({
            name: 'Content-Type',
            value: 'text/html; charset=utf-8'
        });
        context.response.write(renderPage(configuration));
    }

    function onRequest(context) {
        if (context.request.parameters.action === 'suspenseestimate') {
            writeAccountSuspenseEstimate(context);
            return;
        }
        if (context.request.parameters.action === 'contributor') {
            writeContributorTransactions(context);
            return;
        }
        if (context.request.parameters.action === 'accounttrend') {
            writeAccountSpendTrendData(context);
            return;
        }
        if (context.request.parameters.action === 'sharetrend') {
            writeShareTrendData(context);
            return;
        }
        if (context.request.parameters.action === 'breakdown') {
            writeBreakdownData(context);
            return;
        }
        if (context.request.parameters.action === 'drilldown') {
            writeDrilldownData(context);
            return;
        }
        if (context.request.parameters.action === 'data') {
            writeDashboardData(context);
            return;
        }
        try {
            writeDashboardPage(context);
        } catch (error) {
            log.error({ title: 'Expense dashboard page failed', details: error });
            context.response.write(`Unable to load the expense dashboard: ${escapeHtml(error.message || error)}`);
        }
    }

    return { onRequest };
});
