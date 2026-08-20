/**
 * Expense dashboard data service.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/log', 'N/query', 'N/record', 'N/search'], (log, query, record, search) => {
    const EXPENSE_ACCOUNT_TYPES = ['Expense', 'OthExpense', 'COGS'];
    const DEFAULT_COMPARISON_YEARS = 2;
    const DEFAULT_CATEGORY_LIMIT = 12;
    const MAX_DETAIL_ROWS = 200;
    const QUERY_IDS = {
        summary: 'cust_danthonia_exp_summary',
        detail: 'cust_danthonia_exp_detail',
        share: 'cust_danthonia_exp_share',
        options: 'cust_danthonia_exp_options',
        budget: 'cust_danthonia_exp_budget'
    };

    const GROUPINGS = {
        account: {
            id: 'TO_CHAR(tal.account)',
            name: "NVL(BUILTIN.DF(tal.account), 'No account')"
        },
        department: {
            id: "NVL(TO_CHAR(tl.department), '0')",
            name: "NVL(BUILTIN.DF(tl.department), 'No department')"
        }
    };

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function dateString(year, month, day) {
        return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    function parseInteger(value, fallback, minimum, maximum) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }
        return Math.min(maximum, Math.max(minimum, parsed));
    }

    function parseInternalId(value) {
        const candidate = String(value || '').trim();
        return /^\d+$/.test(candidate) ? Number(candidate) : null;
    }

    function parseInternalIds(value) {
        const seen = {};
        return String(value || '')
            .split(',')
            .map(parseInternalId)
            .filter((id) => {
                if (id === null || seen[id]) {
                    return false;
                }
                seen[id] = true;
                return true;
            });
    }

    function parseReportMonth(value) {
        const now = new Date();
        const fallback = {
            year: now.getFullYear(),
            month: now.getMonth() + 1
        };
        const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
        if (!match) {
            return fallback;
        }
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (year < 2000 || year > 2200 || month < 1 || month > 12) {
            return fallback;
        }
        return { year, month };
    }

    function parseIsoDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
        if (!match) {
            return null;
        }
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
            year < 2000
            || year > 2200
            || date.getUTCFullYear() !== year
            || date.getUTCMonth() !== month - 1
            || date.getUTCDate() !== day
        ) {
            return null;
        }
        return { year, month, day };
    }

    function shiftIsoDate(value, days) {
        const parsed = parseIsoDate(value);
        if (!parsed) {
            return '';
        }
        const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
        return dateString(
            date.getUTCFullYear(),
            date.getUTCMonth() + 1,
            date.getUTCDate()
        );
    }

    function breakdownPeriod(parameters, filters) {
        const requestedMode = String(parameters.breakdownPeriod || 'ytd').toLowerCase();
        const mode = ['ytd', 'thisyear', 'lastyear', 'lastyears', 'custom'].includes(requestedMode)
            ? requestedMode
            : 'ytd';
        if (mode === 'custom') {
            const start = parseIsoDate(parameters.startDate);
            const end = parseIsoDate(parameters.endDate);
            if (!start || !end) {
                throw new Error('Enter both custom breakdown dates in YYYY-MM-DD format.');
            }
            const startDate = dateString(start.year, start.month, start.day);
            const endDate = dateString(end.year, end.month, end.day);
            if (startDate > endDate) {
                throw new Error('The custom breakdown start date must be on or before the end date.');
            }
            return {
                mode,
                startDate,
                endDate,
                endDateExclusive: shiftIsoDate(endDate, 1)
            };
        }

        if (mode === 'thisyear') {
            return {
                mode,
                startDate: dateString(filters.reportYear, 1, 1),
                endDate: dateString(filters.reportYear, 12, 31),
                endDateExclusive: dateString(filters.reportYear + 1, 1, 1)
            };
        }
        if (mode === 'lastyear') {
            return {
                mode,
                startDate: dateString(filters.reportYear - 1, 1, 1),
                endDate: dateString(filters.reportYear - 1, 12, 31),
                endDateExclusive: dateString(filters.reportYear, 1, 1)
            };
        }
        if (mode === 'lastyears') {
            const years = parseInteger(parameters.periodYears, 1, 1, 5);
            const end = nextMonth(filters.reportYear, filters.reportMonth);
            return {
                mode,
                years,
                startDate: dateString(filters.reportYear - years + 1, 1, 1),
                endDate: shiftIsoDate(dateString(end.year, end.month, 1), -1),
                endDateExclusive: dateString(end.year, end.month, 1)
            };
        }

        const end = nextMonth(filters.reportYear, filters.reportMonth);
        return {
            mode: 'ytd',
            startDate: dateString(filters.reportYear, 1, 1),
            endDate: shiftIsoDate(dateString(end.year, end.month, 1), -1),
            endDateExclusive: dateString(end.year, end.month, 1)
        };
    }

    function normalizeFilters(parameters) {
        const reportMonth = parseReportMonth(parameters.month);
        return {
            reportYear: reportMonth.year,
            reportMonth: reportMonth.month,
            comparisonYears: parseInteger(
                parameters.years,
                DEFAULT_COMPARISON_YEARS,
                1,
                5
            ),
            categoryLimit: parseInteger(
                parameters.categoryLimit,
                DEFAULT_CATEGORY_LIMIT,
                5,
                20
            ),
            groupBy: 'account',
            departmentIds: parseInternalIds(parameters.department),
            accountIds: parseInternalIds(parameters.account),
            subsidiaryId: parseInternalId(parameters.subsidiary),
            shareDepartmentId: parseInternalId(parameters.shareDepartment)
        };
    }

    function nextMonth(year, month) {
        if (month === 12) {
            return { year: year + 1, month: 1 };
        }
        return { year, month: month + 1 };
    }

    function createExpenseWhere(filters, startDate, endDate) {
        const clauses = [
            "NVL(tal.posting, 'T') = 'T'",
            `tal.accounttype IN (${EXPENSE_ACCOUNT_TYPES.map(() => '?').join(', ')})`,
            "t.trandate >= TO_DATE(?, 'YYYY-MM-DD')",
            "t.trandate < TO_DATE(?, 'YYYY-MM-DD')"
        ];
        const params = EXPENSE_ACCOUNT_TYPES.slice();
        params.push(startDate, endDate);

        if (filters.departmentIds.length) {
            clauses.push(`tl.department IN (${filters.departmentIds.map(() => '?').join(', ')})`);
            params.push(...filters.departmentIds);
        }
        if (filters.accountIds.length) {
            clauses.push(`tal.account IN (${filters.accountIds.map(() => '?').join(', ')})`);
            params.push(...filters.accountIds);
        }
        if (filters.subsidiaryId !== null) {
            clauses.push('tl.subsidiary = ?');
            params.push(filters.subsidiaryId);
        }

        return { sql: clauses.join('\n      AND '), params };
    }

    function runPagedSuiteQl(sql, params, customScriptId) {
        const rows = [];
        const pageIterator = query.runSuiteQLPaged({
            query: sql,
            params,
            pageSize: 1000,
            customScriptId
        }).iterator();

        pageIterator.each((pageResult) => {
            pageResult.value.data.iterator().each((rowResult) => {
                rows.push(rowResult.value.asMap());
                return true;
            });
            return true;
        });
        return rows;
    }

    function runSuiteQl(sql, params, customScriptId) {
        return query.runSuiteQL({
            query: sql,
            params,
            customScriptId
        }).asMappedResults();
    }

    function loadBudgetPeriodContexts(filters) {
        const calendarStart = dateString(filters.reportYear, 1, 1);
        const calendarEnd = dateString(filters.reportYear, 12, 31);
        const fiscalYears = runSuiteQl(`
            SELECT
                id AS period_id,
                TO_CHAR(startdate, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(enddate, 'YYYY-MM-DD') AS end_date
            FROM AccountingPeriod
            WHERE isyear = 'T'
                AND startdate <= TO_DATE(?, 'YYYY-MM-DD')
                AND enddate >= TO_DATE(?, 'YYYY-MM-DD')
            ORDER BY startdate, id
        `, [calendarEnd, calendarStart], QUERY_IDS.budget);
        if (!fiscalYears.length) {
            return [];
        }
        return fiscalYears.map((fiscalYear) => {
            const periods = runSuiteQl(`
                SELECT
                    id AS period_id,
                    TO_CHAR(startdate, 'YYYY-MM-DD') AS start_date,
                    TO_CHAR(enddate, 'YYYY-MM-DD') AS end_date
                FROM AccountingPeriod
                WHERE isyear = 'F'
                    AND isquarter = 'F'
                    AND startdate >= TO_DATE(?, 'YYYY-MM-DD')
                    AND enddate <= TO_DATE(?, 'YYYY-MM-DD')
                ORDER BY startdate, enddate, id
            `, [fiscalYear.start_date, fiscalYear.end_date], QUERY_IDS.budget)
                .slice(0, 24)
                .map((period, index) => {
                    const parsedStart = parseIsoDate(period.start_date);
                    return {
                        id: String(period.period_id || ''),
                        fieldId: `periodamount${index + 1}`,
                        startDate: String(period.start_date || ''),
                        endDate: String(period.end_date || ''),
                        calendarYear: parsedStart ? parsedStart.year : null,
                        calendarMonth: parsedStart ? parsedStart.month : null
                    };
                });
            return {
                yearId: String(fiscalYear.period_id || ''),
                startDate: String(fiscalYear.start_date || ''),
                endDate: String(fiscalYear.end_date || ''),
                periods
            };
        });
    }

    function runNativeBudgetSearch(filters, periodContext, includeCategory, exactDimensions) {
        const periodIds = periodContext.periods.map((period) => period.id).filter(Boolean);
        if (!periodIds.length) {
            return [];
        }
        const variants = [
            {
                account: 'account',
                period: 'accountingperiod',
                category: 'category',
                department: 'department',
                subsidiary: 'subsidiary',
                accountingBook: 'accountingbook',
                dimensions: ['class', 'location', 'customer', 'item'],
                categoryName: "NVL(BUILTIN.DF(b.category), 'Default budget')"
            },
            {
                account: 'account',
                period: 'period',
                category: 'category',
                department: 'department',
                subsidiary: 'subsidiary',
                accountingBook: 'accountingbook',
                dimensions: ['class', 'location', 'customer', 'item'],
                categoryName: "NVL(BUILTIN.DF(b.category), 'Default budget')"
            },
            {
                account: 'account_id',
                period: 'accounting_period_id',
                category: 'category_id',
                department: 'department_id',
                subsidiary: 'subsidiary_id',
                accountingBook: 'accounting_book_id',
                dimensions: ['class_id', 'location_id', 'customer_id', 'item_id'],
                categoryName: "NVL(TO_CHAR(b.category_id), 'Default budget')"
            }
        ];
        let rows;
        let lastError;
        for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
            const fields = variants[variantIndex];
            const clauses = [
                `b.${fields.account} IN (${filters.accountIds.map(() => '?').join(', ')})`,
                `b.${fields.period} IN (${periodIds.map(() => '?').join(', ')})`,
                `(b.${fields.accountingBook} IS NULL OR b.${fields.accountingBook} IN (` +
                    "SELECT id FROM AccountingBook WHERE isprimary = 'T'))"
            ];
            const params = filters.accountIds.slice().concat(periodIds);
            if (filters.departmentIds.length) {
                clauses.push(
                    `b.${fields.department} IN (${filters.departmentIds.map(() => '?').join(', ')})`
                );
                params.push(...filters.departmentIds);
            } else {
                clauses.push(`b.${fields.department} IS NULL`);
            }
            if (filters.subsidiaryId !== null) {
                clauses.push(`b.${fields.subsidiary} = ?`);
                params.push(filters.subsidiaryId);
            }
            if (exactDimensions) {
                fields.dimensions.forEach((name) => clauses.push(`b.${name} IS NULL`));
            }
            const categoryIdExpression = includeCategory
                ? `TO_CHAR(b.${fields.category})`
                : "''";
            const categoryNameExpression = includeCategory
                ? fields.categoryName
                : "'Default budget'";
            try {
                rows = runPagedSuiteQl(`
                    SELECT
                        TO_CHAR(b.${fields.period}) AS period_id,
                        NVL(b.amount, 0) AS amount,
                        ${categoryIdExpression} AS category_id,
                        ${categoryNameExpression} AS category_name
                    FROM Budget b
                    WHERE ${clauses.join('\n                        AND ')}
                    ORDER BY b.${fields.period}, b.${fields.account}
                `, params, QUERY_IDS.budget);
                break;
            } catch (error) {
                lastError = error;
            }
        }
        if (!rows) {
            throw lastError || new Error('Native budget data is unavailable.');
        }

        const groups = {};
        const periodsById = {};
        periodContext.periods.forEach((period) => {
            periodsById[period.id] = period;
        });
        rows.forEach((row) => {
            const period = periodsById[String(row.period_id || '')];
            if (!period || !period.calendarMonth || period.calendarYear !== filters.reportYear) {
                return;
            }
            const categoryId = String(row.category_id || '');
            const categoryName = String(row.category_name || categoryId || 'Default budget');
            const groupKey = categoryId || '__default__';
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    categoryId,
                    categoryName,
                    monthlyValues: Array(12).fill(0),
                    monthHasBudget: Array(12).fill(false),
                    rowCount: 0
                };
            }
            const group = groups[groupKey];
            group.rowCount += 1;
            const monthIndex = period.calendarMonth - 1;
            group.monthlyValues[monthIndex] += Number(row.amount) || 0;
            group.monthHasBudget[monthIndex] = true;
        });
        return Object.keys(groups).map((key) => groups[key]);
    }

    function loadAccountBudget(filters) {
        const emptyBudget = {
            available: false,
            selectedMonthAmount: null,
            monthlyValues: Array(12).fill(null),
            categoryId: '',
            categoryName: '',
            fiscalYearStart: '',
            fiscalYearEnd: '',
            hasMultipleVersions: false
        };
        if (!filters.accountIds.length) {
            return emptyBudget;
        }
        try {
            const periodContexts = loadBudgetPeriodContexts(filters)
                .filter((context) => context.periods.length);
            if (!periodContexts.length) {
                return emptyBudget;
            }

            function groupsForContext(periodContext) {
                try {
                    return runNativeBudgetSearch(filters, periodContext, true, true);
                } catch (fullSearchError) {
                    log.debug({
                        title: 'Expense dashboard budget category search fallback',
                        details: fullSearchError
                    });
                    try {
                        return runNativeBudgetSearch(filters, periodContext, false, true);
                    } catch (dimensionSearchError) {
                        log.debug({
                            title: 'Expense dashboard exact-dimension budget search fallback',
                            details: dimensionSearchError
                        });
                        try {
                            return runNativeBudgetSearch(filters, periodContext, true, false);
                        } catch (basicCategoryError) {
                            log.debug({
                                title: 'Expense dashboard basic budget search fallback',
                                details: basicCategoryError
                            });
                            return runNativeBudgetSearch(filters, periodContext, false, false);
                        }
                    }
                }
            }

            const monthlyValues = Array(12).fill(null);
            const reportDate = dateString(filters.reportYear, filters.reportMonth, 1);
            let categoryId = '';
            let categoryName = '';
            let fiscalYearStart = '';
            let fiscalYearEnd = '';
            let hasMultipleVersions = false;
            let matchedBudgetRecords = 0;

            periodContexts.forEach((periodContext) => {
                const groups = groupsForContext(periodContext);
                if (!groups.length) {
                    return;
                }
                groups.sort((left, right) => {
                    const leftLegacy = /legacy|default/i.test(left.categoryName) ? 0 : 1;
                    const rightLegacy = /legacy|default/i.test(right.categoryName) ? 0 : 1;
                    return leftLegacy - rightLegacy
                        || left.categoryName.localeCompare(right.categoryName)
                        || left.categoryId.localeCompare(right.categoryId);
                });
                const selected = groups[0];
                matchedBudgetRecords += selected.rowCount;
                hasMultipleVersions = hasMultipleVersions || groups.length > 1;
                selected.monthlyValues.forEach((amount, index) => {
                    if (!selected.monthHasBudget[index]) {
                        return;
                    }
                    monthlyValues[index] = (monthlyValues[index] === null ? 0 : monthlyValues[index])
                        + amount;
                });
                if (
                    !categoryName
                    || periodContext.startDate <= reportDate && periodContext.endDate >= reportDate
                ) {
                    categoryId = selected.categoryId;
                    categoryName = selected.categoryName;
                    fiscalYearStart = periodContext.startDate;
                    fiscalYearEnd = periodContext.endDate;
                }
            });

            if (!matchedBudgetRecords) {
                return emptyBudget;
            }
            return {
                available: true,
                selectedMonthAmount: monthlyValues[filters.reportMonth - 1],
                monthlyValues,
                categoryId,
                categoryName,
                fiscalYearStart,
                fiscalYearEnd,
                hasMultipleVersions
            };
        } catch (error) {
            log.debug({
                title: 'Expense dashboard native budget unavailable',
                details: error
            });
            return emptyBudget;
        }
    }

    function loadMonthlyRows(filters) {
        const trendStartYear = filters.reportYear - filters.comparisonYears + 1;
        const startYear = Math.min(trendStartYear, filters.reportYear - 2);
        const end = nextMonth(filters.reportYear, filters.reportMonth);
        const where = createExpenseWhere(
            filters,
            dateString(startYear, 1, 1),
            dateString(end.year, end.month, 1)
        );
        const grouping = GROUPINGS[filters.groupBy];
        const sql = `
            SELECT
                ${grouping.id} AS category_id,
                ${grouping.name} AS category_name,
                TO_CHAR(t.trandate, 'YYYY') AS spend_year,
                TO_CHAR(t.trandate, 'MM') AS spend_month,
                CASE WHEN t.type IN ('CardChrg', 'CardRfnd') THEN 'T' ELSE 'F' END AS is_credit_card,
                SUM(NVL(tal.amount, 0)) AS amount
            FROM Transaction t
            INNER JOIN TransactionLine tl
                ON tl.transaction = t.id
            INNER JOIN TransactionAccountingLine tal
                ON tal.transaction = tl.transaction
                AND tal.transactionline = tl.id
            INNER JOIN AccountingBook ab
                ON ab.id = tal.accountingbook
                AND ab.isprimary = 'T'
            WHERE ${where.sql}
            GROUP BY
                ${grouping.id},
                ${grouping.name},
                TO_CHAR(t.trandate, 'YYYY'),
                TO_CHAR(t.trandate, 'MM'),
                CASE WHEN t.type IN ('CardChrg', 'CardRfnd') THEN 'T' ELSE 'F' END
            ORDER BY
                spend_year,
                spend_month,
                category_id
        `;
        return runPagedSuiteQl(sql, where.params, QUERY_IDS.summary);
    }

    function loadMonthlyTotals(filters, startDate, endDate) {
        const where = createExpenseWhere(filters, startDate, endDate);
        return runSuiteQl(`
            SELECT
                TO_CHAR(t.trandate, 'YYYY') AS spend_year,
                TO_CHAR(t.trandate, 'MM') AS spend_month,
                SUM(NVL(tal.amount, 0)) AS total_amount
            FROM Transaction t
            INNER JOIN TransactionLine tl
                ON tl.transaction = t.id
            INNER JOIN TransactionAccountingLine tal
                ON tal.transaction = tl.transaction
                AND tal.transactionline = tl.id
            INNER JOIN AccountingBook ab
                ON ab.id = tal.accountingbook
                AND ab.isprimary = 'T'
            WHERE ${where.sql}
            GROUP BY
                TO_CHAR(t.trandate, 'YYYY'),
                TO_CHAR(t.trandate, 'MM')
            ORDER BY
                spend_year,
                spend_month
        `, where.params, QUERY_IDS.share);
    }

    function monthlyTotalsByKey(rows) {
        return rows.reduce((totals, row) => {
            totals[monthKey(Number(row.spend_year), Number(row.spend_month))] =
                Number(row.total_amount) || 0;
            return totals;
        }, {});
    }

    function monthsInPeriod(period) {
        const start = parseIsoDate(period.startDate);
        const end = parseIsoDate(period.endDate);
        const months = [];
        if (!start || !end) {
            return months;
        }
        let year = start.year;
        let month = start.month;
        while (year < end.year || (year === end.year && month <= end.month)) {
            months.push({ year, month, key: monthKey(year, month) });
            if (month === 12) {
                year += 1;
                month = 1;
            } else {
                month += 1;
            }
        }
        return months;
    }

    function createShareTrendData(filters, period) {
        const shareDepartmentIds = filters.shareDepartmentId !== null
            ? [filters.shareDepartmentId]
            : filters.departmentIds;
        const selectedAccountFilters = Object.assign({}, filters, {
            departmentIds: shareDepartmentIds
        });
        const allAccountFilters = Object.assign({}, selectedAccountFilters, { accountIds: [] });
        const allRows = loadMonthlyTotals(
            allAccountFilters,
            period.startDate,
            period.endDateExclusive
        );
        const selectedRows = filters.accountIds.length
            ? loadMonthlyTotals(
                selectedAccountFilters,
                period.startDate,
                period.endDateExclusive
            )
            : allRows;
        const allByMonth = monthlyTotalsByKey(allRows);
        const selectedByMonth = monthlyTotalsByKey(selectedRows);
        const series = monthsInPeriod(period).map((item) => {
            const totalAmount = allByMonth[item.key] || 0;
            const selectedAmount = selectedByMonth[item.key] || 0;
            const hasSelectedData = Object.prototype.hasOwnProperty.call(
                selectedByMonth,
                item.key
            );
            return {
                year: item.year,
                month: item.month,
                selectedAmount,
                totalAmount,
                hasData: hasSelectedData,
                percentage: totalAmount ? selectedAmount / totalAmount : null
            };
        });
        const percentages = series
            .filter((item) => item.hasData)
            .map((item) => item.percentage)
            .filter((value) => value !== null && Number.isFinite(value));
        return {
            averagePercentage: percentages.length
                ? percentages.reduce((total, value) => total + value, 0) / percentages.length
                : null,
            series
        };
    }

    function normaliseSpendKind(value) {
        if (value === 'creditcard' || value === 'other') {
            return value;
        }
        return 'all';
    }

    function loadDetailRows(filters, requestedSpendKind, requestedLimit, requestedPeriod) {
        const end = nextMonth(filters.reportYear, filters.reportMonth);
        const period = requestedPeriod || {
            startDate: dateString(filters.reportYear, filters.reportMonth, 1),
            endDate: dateString(end.year, end.month, 1)
        };
        const where = createExpenseWhere(
            filters,
            period.startDate,
            period.endDate
        );
        const spendKind = normaliseSpendKind(requestedSpendKind);
        const spendKindClause = spendKind === 'creditcard'
            ? "AND t.type IN ('CardChrg', 'CardRfnd')"
            : spendKind === 'other'
                ? "AND t.type NOT IN ('CardChrg', 'CardRfnd')"
                : '';
        const includeAllRows = requestedLimit === 0;
        const maximumRows = requestedLimit || MAX_DETAIL_ROWS;
        const amountOrder = spendKind === 'all'
            ? 'ABS(NVL(tal.amount, 0)) DESC'
            : 'NVL(tal.amount, 0) DESC';
        const baseSql = `
            SELECT
                    t.id AS transaction_id,
                    tl.id AS transaction_line_id,
                    NVL(t.tranid, TO_CHAR(t.id)) AS transaction_number,
                    TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
                    t.type AS transaction_type_code,
                    NVL(BUILTIN.DF(t.type), t.type) AS transaction_type,
                    NVL(BUILTIN.DF(t.entity), 'No payee') AS payee,
                    '' AS credit_card_user,
                    CASE
                        WHEN t.type IN ('CardChrg', 'CardRfnd') THEN NVL((
                            SELECT MAX(card_account.fullname)
                            FROM TransactionAccountingLine card_tal
                            INNER JOIN Account card_account
                                ON card_account.id = card_tal.account
                            WHERE card_tal.transaction = t.id
                                AND card_tal.accountingbook = tal.accountingbook
                                AND card_tal.accounttype = 'CredCard'
                        ), 'Credit card account')
                        ELSE ''
                    END AS credit_card_account,
                    CASE
                        WHEN t.type IN ('CardChrg', 'CardRfnd') THEN (
                            SELECT MAX(card_account.id)
                            FROM TransactionAccountingLine card_tal
                            INNER JOIN Account card_account
                                ON card_account.id = card_tal.account
                            WHERE card_tal.transaction = t.id
                                AND card_tal.accountingbook = tal.accountingbook
                                AND card_tal.accounttype = 'CredCard'
                        )
                        ELSE NULL
                    END AS credit_card_account_id,
                    CASE WHEN t.type IN ('CardChrg', 'CardRfnd') THEN 'Credit card' ELSE 'Other' END AS spend_kind,
                    TO_CHAR(tal.account) AS account_id,
                    NVL(BUILTIN.DF(tal.account), 'No account') AS account_name,
                    TO_CHAR(tl.department) AS department_id,
                    NVL(BUILTIN.DF(tl.department), 'No department') AS department_name,
                    NVL(tal.amount, 0) AS amount,
                    NVL(tl.memo, NVL(t.memo, '')) AS memo
                FROM Transaction t
                INNER JOIN TransactionLine tl
                    ON tl.transaction = t.id
                INNER JOIN TransactionAccountingLine tal
                    ON tal.transaction = tl.transaction
                    AND tal.transactionline = tl.id
                INNER JOIN AccountingBook ab
                    ON ab.id = tal.accountingbook
                    AND ab.isprimary = 'T'
                WHERE ${where.sql}
                    ${spendKindClause}
                ORDER BY
                    ${amountOrder},
                    t.trandate DESC,
                    t.id DESC,
                    tl.id DESC,
                    tal.account DESC
        `;
        const sql = includeAllRows
            ? baseSql
            : `SELECT * FROM (${baseSql}) WHERE ROWNUM <= ${maximumRows}`;
        const rows = includeAllRows
            ? runPagedSuiteQl(sql, where.params, QUERY_IDS.detail)
            : runSuiteQl(sql, where.params, QUERY_IDS.detail);
        const mappedRows = rows.map((row) => ({
            transactionId: String(row.transaction_id || ''),
            transactionLineId: String(row.transaction_line_id || ''),
            transactionNumber: String(row.transaction_number || ''),
            date: String(row.transaction_date || ''),
            typeCode: String(row.transaction_type_code || ''),
            type: String(row.transaction_type || ''),
            payee: String(row.payee || ''),
            creditCardUser: String(row.credit_card_user || ''),
            creditCardAccount: String(row.credit_card_account || ''),
            creditCardAccountId: String(row.credit_card_account_id || ''),
            spendKind: String(row.spend_kind || ''),
            accountId: String(row.account_id || ''),
            account: String(row.account_name || ''),
            departmentId: String(row.department_id || ''),
            department: String(row.department_name || ''),
            amount: Number(row.amount) || 0,
            memo: String(row.memo || '')
        }));
        return includeAllRows ? enrichCardDetails(mappedRows) : mappedRows;
    }

    function loadCreditCardSuspenseAccounts() {
        const candidates = safeOptionQuery(
            "SELECT id, fullname AS name FROM Account WHERE isinactive = 'F' AND LOWER(fullname) LIKE '%suspense%' ORDER BY fullname, id",
            'credit-card suspense account'
        );
        const matched = candidates.filter((account) => (
            /(?:credit\s*card|card|cca|visa|mastercard|amex|nab)/i.test(account.name)
        ));
        if (matched.length) {
            return matched;
        }
        return candidates.length === 1 ? candidates : [];
    }

    function loadSuspenseRows(filters, suspenseAccounts, startDate, endDate) {
        if (!suspenseAccounts.length) {
            return [];
        }
        const accountIds = suspenseAccounts.map((account) => String(account.id));
        const clauses = [
            "NVL(tal.posting, 'T') = 'T'",
            "t.trandate >= TO_DATE(?, 'YYYY-MM-DD')",
            "t.trandate < TO_DATE(?, 'YYYY-MM-DD')",
            `tal.account IN (${accountIds.map(() => '?').join(', ')})`
        ];
        const params = [startDate, endDate].concat(accountIds);
        if (filters.departmentIds.length) {
            clauses.push(`tl.department IN (${filters.departmentIds.map(() => '?').join(', ')})`);
            params.push(...filters.departmentIds);
        }
        if (filters.subsidiaryId !== null) {
            clauses.push('tl.subsidiary = ?');
            params.push(filters.subsidiaryId);
        }
        const rows = runPagedSuiteQl(`
            SELECT
                t.id AS transaction_id,
                tl.id AS transaction_line_id,
                NVL(t.tranid, TO_CHAR(t.id)) AS transaction_number,
                TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
                t.type AS transaction_type_code,
                NVL(BUILTIN.DF(t.type), t.type) AS transaction_type,
                NVL(BUILTIN.DF(t.entity), 'No payee') AS payee,
                '' AS credit_card_user,
                CASE
                    WHEN t.type IN ('CardChrg', 'CardRfnd') THEN NVL((
                        SELECT MAX(card_account.fullname)
                        FROM TransactionAccountingLine card_tal
                        INNER JOIN Account card_account
                            ON card_account.id = card_tal.account
                        WHERE card_tal.transaction = t.id
                            AND card_tal.accountingbook = tal.accountingbook
                            AND card_tal.accounttype = 'CredCard'
                    ), 'Credit card account')
                    ELSE ''
                END AS credit_card_account,
                CASE
                    WHEN t.type IN ('CardChrg', 'CardRfnd') THEN (
                        SELECT MAX(card_account.id)
                        FROM TransactionAccountingLine card_tal
                        INNER JOIN Account card_account
                            ON card_account.id = card_tal.account
                        WHERE card_tal.transaction = t.id
                            AND card_tal.accountingbook = tal.accountingbook
                            AND card_tal.accounttype = 'CredCard'
                    )
                    ELSE NULL
                END AS credit_card_account_id,
                CASE WHEN t.type IN ('CardChrg', 'CardRfnd') THEN 'Credit card' ELSE 'Other' END AS spend_kind,
                TO_CHAR(tal.account) AS account_id,
                NVL(BUILTIN.DF(tal.account), 'Credit card suspense') AS account_name,
                TO_CHAR(tl.department) AS department_id,
                NVL(BUILTIN.DF(tl.department), 'No department') AS department_name,
                NVL(tal.amount, 0) AS amount,
                NVL(tl.memo, NVL(t.memo, '')) AS memo
            FROM Transaction t
            INNER JOIN TransactionLine tl
                ON tl.transaction = t.id
            INNER JOIN TransactionAccountingLine tal
                ON tal.transaction = tl.transaction
                AND tal.transactionline = tl.id
            INNER JOIN AccountingBook ab
                ON ab.id = tal.accountingbook
                AND ab.isprimary = 'T'
            WHERE ${clauses.join('\n                AND ')}
            ORDER BY
                ABS(NVL(tal.amount, 0)) DESC,
                t.trandate DESC,
                t.id DESC,
                tl.id DESC
        `, params, QUERY_IDS.detail);
        return enrichCardDetails(rows.map((row) => ({
            transactionId: String(row.transaction_id || ''),
            transactionLineId: String(row.transaction_line_id || ''),
            transactionNumber: String(row.transaction_number || ''),
            date: String(row.transaction_date || ''),
            typeCode: String(row.transaction_type_code || ''),
            type: String(row.transaction_type || ''),
            payee: String(row.payee || ''),
            creditCardUser: String(row.credit_card_user || ''),
            creditCardAccount: String(row.credit_card_account || ''),
            creditCardAccountId: String(row.credit_card_account_id || ''),
            spendKind: String(row.spend_kind || ''),
            accountId: String(row.account_id || ''),
            account: String(row.account_name || ''),
            departmentId: String(row.department_id || ''),
            department: String(row.department_name || ''),
            amount: Number(row.amount) || 0,
            memo: String(row.memo || '')
        })));
    }

    function normaliseDetailColumn(detailColumn) {
        if (typeof detailColumn === 'string') {
            return {
                key: detailColumn,
                name: detailColumn,
                useText: detailColumn !== 'ccholdername'
            };
        }
        return detailColumn;
    }

    function searchCardDetails(transactionIds, requestedColumns) {
        const detailsByTransaction = {};
        const detailColumns = requestedColumns.map(normaliseDetailColumn);
        const internalIdColumn = search.createColumn({ name: 'internalid' });
        const columns = [internalIdColumn].concat(detailColumns.map((definition) => {
            const options = { name: definition.name };
            if (definition.join) {
                options.join = definition.join;
            }
            return search.createColumn(options);
        }));

        for (let offset = 0; offset < transactionIds.length; offset += 1000) {
            const ids = transactionIds.slice(offset, offset + 1000);
            search.create({
                type: search.Type.TRANSACTION,
                filters: [
                    ['internalid', 'anyof', ids],
                    'AND',
                    ['mainline', 'is', 'T']
                ],
                columns
            }).run().each((result) => {
                const transactionId = String(result.getValue(internalIdColumn) || '');
                const detail = {};
                detailColumns.forEach((definition, index) => {
                    const column = columns[index + 1];
                    let value = '';
                    if (definition.useText) {
                        try {
                            value = result.getText(column) || '';
                        } catch (error) {
                            value = '';
                        }
                    }
                    value = value || result.getValue(column);
                    detail[definition.key] = String(value || '');
                });
                detailsByTransaction[transactionId] = detail;
                return true;
            });
        }
        return detailsByTransaction;
    }

    function mergeTransactionDetails(target, source) {
        Object.keys(source).forEach((transactionId) => {
            target[transactionId] = Object.assign(
                {},
                target[transactionId] || {},
                source[transactionId]
            );
        });
    }

    function employeeDisplayName(detail) {
        const fullName = [detail.employeeFirstName, detail.employeeLastName]
            .filter(Boolean)
            .join(' ')
            .trim();
        return fullName || detail.employeeName || '';
    }

    function displayFieldValue(transactionRecord, fieldId) {
        try {
            const text = transactionRecord.getText({ fieldId });
            if (text) {
                return String(text).trim();
            }
        } catch (error) {
            // Text fields do not support getText; getValue below handles them.
        }
        try {
            const value = transactionRecord.getValue({ fieldId });
            if (value === null || value === undefined || value === false) {
                return '';
            }
            const candidate = String(value).trim();
            return /^(?:T|F|\d+)$/.test(candidate) ? '' : candidate;
        } catch (error) {
            return '';
        }
    }

    function isCardUserField(fieldId, label) {
        const id = String(fieldId || '').toLowerCase();
        const name = String(label || '').toLowerCase();
        const combined = `${id} ${name}`;
        if ([
            'employee',
            'ccholdername',
            'ccname',
            'cardholder',
            'cardholdername',
            'cardmemberembossedname',
            'nameoncard'
        ].includes(id)) {
            return true;
        }
        return /(?:cardholder|card holder|name on card|card member|card user|card employee|credit card name|credit card user|corporate card name|corporate card user)/i
            .test(combined);
    }

    function findCardUserField(sourceRecord) {
        const fields = sourceRecord.getFields();
        for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
            const fieldId = fields[fieldIndex];
            let label = '';
            try {
                const field = sourceRecord.getField({ fieldId });
                label = field ? field.label : '';
            } catch (error) {
                label = '';
            }
            if (!isCardUserField(fieldId, label)) {
                continue;
            }
            const value = displayFieldValue(sourceRecord, fieldId);
            if (value) {
                return { fieldId, sampleValue: value };
            }
        }
        return null;
    }

    function isMerchantField(fieldId, label) {
        const id = String(fieldId || '').toLowerCase();
        const name = String(label || '').toLowerCase();
        if (['entity', 'vendor', 'account', 'employee', 'memo'].includes(id)) {
            return false;
        }
        const combined = `${id} ${name}`;
        if (/(?:merchant\s*(?:name|payee)?|card\s*acceptor|trading\s*name|payee\s*name|statement\s*(?:payee|description|narrative|text)|bank\s*(?:payee|description|narrative|details|text)|transaction\s*(?:description|details|narrative)|supplier\s*name|vendor\s*name)/i.test(combined)) {
            return !/(?:merchant\s*(?:category|code)|category\s*code)/i.test(combined);
        }
        if (
            /^(?:custbody|custcol)_/.test(id)
            && /(?:description|details|narrative|payee)/i.test(combined)
        ) {
            return true;
        }
        return false;
    }

    function displaySublistFieldValue(sourceRecord, sublistId, fieldId, line) {
        try {
            const text = sourceRecord.getSublistText({ sublistId, fieldId, line });
            if (text) {
                return String(text).trim();
            }
        } catch (error) {
            // Text fields do not support getSublistText; getSublistValue handles them.
        }
        try {
            const value = sourceRecord.getSublistValue({ sublistId, fieldId, line });
            if (value === null || value === undefined || value === false) {
                return '';
            }
            const candidate = String(value).trim();
            return /^(?:T|F|\d+)$/.test(candidate) ? '' : candidate;
        } catch (error) {
            return '';
        }
    }

    function findMerchantField(sourceRecord) {
        const bodyFields = sourceRecord.getFields();
        for (let index = 0; index < bodyFields.length; index += 1) {
            const fieldId = bodyFields[index];
            let label = '';
            try {
                const field = sourceRecord.getField({ fieldId });
                label = field ? field.label : '';
            } catch (error) {
                label = '';
            }
            if (!isMerchantField(fieldId, label)) {
                continue;
            }
            const value = displayFieldValue(sourceRecord, fieldId);
            if (value) {
                return { fieldId, location: 'body', sampleValue: value };
            }
        }

        const sublists = sourceRecord.getSublists();
        for (let sublistIndex = 0; sublistIndex < sublists.length; sublistIndex += 1) {
            const sublistId = sublists[sublistIndex];
            const lineCount = sourceRecord.getLineCount({ sublistId });
            if (!lineCount) {
                continue;
            }
            let fields = [];
            try {
                fields = sourceRecord.getSublistFields({ sublistId });
            } catch (error) {
                fields = [];
            }
            for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
                const fieldId = fields[fieldIndex];
                let label = '';
                try {
                    const field = sourceRecord.getSublistField({
                        sublistId,
                        fieldId,
                        line: 0
                    });
                    label = field ? field.label : '';
                } catch (error) {
                    label = '';
                }
                if (!isMerchantField(fieldId, label)) {
                    continue;
                }
                for (let line = 0; line < lineCount; line += 1) {
                    const value = displaySublistFieldValue(
                        sourceRecord,
                        sublistId,
                        fieldId,
                        line
                    );
                    if (value) {
                        return {
                            fieldId,
                            sublistId,
                            location: 'line',
                            sampleValue: value
                        };
                    }
                }
            }
        }
        return null;
    }

    function discoverCardUserField(rows) {
        const sampleRows = rows.filter((row) => row.spendKind === 'Credit card').slice(0, 5);
        for (let index = 0; index < sampleRows.length; index += 1) {
            const row = sampleRows[index];
            try {
                const transactionRecord = record.load({
                    type: row.typeCode === 'CardRfnd' ? 'creditcardrefund' : 'creditcardcharge',
                    id: row.transactionId,
                    isDynamic: false
                });
                const match = findCardUserField(transactionRecord);
                if (match) {
                    return match;
                }
            } catch (error) {
                log.debug({
                    title: 'Expense drill-down card-user field discovery',
                    details: error
                });
            }
        }
        return null;
    }

    function discoverAccountCardUserField(rows) {
        const accountIds = [];
        const seen = {};
        rows.forEach((row) => {
            if (row.creditCardAccountId && !seen[row.creditCardAccountId]) {
                seen[row.creditCardAccountId] = true;
                accountIds.push(row.creditCardAccountId);
            }
        });
        for (let index = 0; index < Math.min(accountIds.length, 5); index += 1) {
            try {
                const accountRecord = record.load({
                    type: record.Type.ACCOUNT,
                    id: accountIds[index],
                    isDynamic: false
                });
                const match = findCardUserField(accountRecord);
                if (match) {
                    return match;
                }
            } catch (error) {
                log.debug({
                    title: 'Expense drill-down card-account user field discovery',
                    details: error
                });
            }
        }
        return null;
    }

    function discoverCardMerchantField(rows) {
        const sampleRows = rows.filter((row) => row.spendKind === 'Credit card').slice(0, 5);
        for (let index = 0; index < sampleRows.length; index += 1) {
            const row = sampleRows[index];
            try {
                const transactionRecord = record.load({
                    type: row.typeCode === 'CardRfnd' ? 'creditcardrefund' : 'creditcardcharge',
                    id: row.transactionId,
                    isDynamic: false
                });
                const match = findMerchantField(transactionRecord);
                if (match) {
                    return Object.assign({ sampleTransactionId: row.transactionId }, match);
                }
            } catch (error) {
                log.debug({
                    title: 'Expense drill-down merchant field discovery',
                    details: error
                });
            }
        }
        return null;
    }

    function searchCardLineDetails(transactionIds, fieldId) {
        const detailsByTransaction = {};
        const internalIdColumn = search.createColumn({ name: 'internalid' });
        const merchantColumn = search.createColumn({ name: fieldId });
        for (let offset = 0; offset < transactionIds.length; offset += 1000) {
            search.create({
                type: search.Type.TRANSACTION,
                filters: [
                    ['internalid', 'anyof', transactionIds.slice(offset, offset + 1000)],
                    'AND',
                    ['mainline', 'is', 'F'],
                    'AND',
                    ['taxline', 'is', 'F']
                ],
                columns: [internalIdColumn, merchantColumn]
            }).run().each((result) => {
                const transactionId = String(result.getValue(internalIdColumn) || '');
                let merchant = '';
                try {
                    merchant = result.getText(merchantColumn) || '';
                } catch (error) {
                    merchant = '';
                }
                merchant = String(merchant || result.getValue(merchantColumn) || '').trim();
                if (merchant && !detailsByTransaction[transactionId]) {
                    detailsByTransaction[transactionId] = { configuredMerchant: merchant };
                }
                return true;
            });
        }
        return detailsByTransaction;
    }

    function loadMerchantFallback(rows, merchantField, detailsByTransaction) {
        const seen = {};
        let loads = 0;
        rows.forEach((row) => {
            const existing = detailsByTransaction[row.transactionId] || {};
            if (
                loads >= 60
                || row.spendKind !== 'Credit card'
                || !row.transactionId
                || seen[row.transactionId]
                || existing.configuredMerchant
            ) {
                return;
            }
            seen[row.transactionId] = true;
            loads += 1;
            try {
                const transactionRecord = record.load({
                    type: row.typeCode === 'CardRfnd' ? 'creditcardrefund' : 'creditcardcharge',
                    id: row.transactionId,
                    isDynamic: false
                });
                let merchant = '';
                if (merchantField.location === 'body') {
                    merchant = displayFieldValue(transactionRecord, merchantField.fieldId);
                } else {
                    const lineCount = transactionRecord.getLineCount({
                        sublistId: merchantField.sublistId
                    });
                    for (let line = 0; line < lineCount && !merchant; line += 1) {
                        merchant = displaySublistFieldValue(
                            transactionRecord,
                            merchantField.sublistId,
                            merchantField.fieldId,
                            line
                        );
                    }
                }
                if (merchant) {
                    detailsByTransaction[row.transactionId] = Object.assign(
                        {},
                        existing,
                        { configuredMerchant: merchant }
                    );
                }
            } catch (error) {
                log.debug({
                    title: 'Expense drill-down merchant record fallback',
                    details: error
                });
            }
        });
    }

    function searchAccountCardUsers(accountIds, fieldId) {
        const usersByAccount = {};
        const internalIdColumn = search.createColumn({ name: 'internalid' });
        const userColumn = search.createColumn({ name: fieldId });
        for (let offset = 0; offset < accountIds.length; offset += 1000) {
            search.create({
                type: search.Type.ACCOUNT,
                filters: [['internalid', 'anyof', accountIds.slice(offset, offset + 1000)]],
                columns: [internalIdColumn, userColumn]
            }).run().each((result) => {
                const accountId = String(result.getValue(internalIdColumn) || '');
                usersByAccount[accountId] = String(
                    result.getText(userColumn) || result.getValue(userColumn) || ''
                );
                return true;
            });
        }
        return usersByAccount;
    }

    function enrichCardDetails(rows) {
        const transactionIds = [];
        const cardTransactionIds = [];
        const seen = {};
        const seenCardTransactions = {};
        rows.forEach((row) => {
            if (row.transactionId && !seen[row.transactionId]) {
                seen[row.transactionId] = true;
                transactionIds.push(row.transactionId);
            }
            if (
                row.spendKind === 'Credit card'
                && row.transactionId
                && !seenCardTransactions[row.transactionId]
            ) {
                seenCardTransactions[row.transactionId] = true;
                cardTransactionIds.push(row.transactionId);
            }
        });
        if (!transactionIds.length) {
            return rows;
        }

        const detailsByTransaction = {};
        try {
            mergeTransactionDetails(detailsByTransaction, searchCardDetails(transactionIds, [
                {
                    key: 'employeeName',
                    name: 'entityid',
                    join: 'employee',
                    useText: false
                },
                {
                    key: 'employeeFirstName',
                    name: 'firstname',
                    join: 'employee',
                    useText: false
                },
                {
                    key: 'employeeLastName',
                    name: 'lastname',
                    join: 'employee',
                    useText: false
                }
            ]));
        } catch (error) {
            log.debug({
                title: 'Expense drill-down employee lookup fallback',
                details: error
            });
        }

        const columnAttempts = [
            ['ccholdername', 'createdby', 'acctcorpcardexp'],
            ['createdby', 'acctcorpcardexp'],
            ['createdby']
        ];
        for (let index = 0; index < columnAttempts.length; index += 1) {
            try {
                mergeTransactionDetails(
                    detailsByTransaction,
                    searchCardDetails(transactionIds, columnAttempts[index])
                );
                break;
            } catch (error) {
                log.debug({
                    title: 'Expense drill-down cardholder lookup fallback',
                    details: error
                });
            }
        }

        const discoveredCardUserField = discoverCardUserField(rows);
        if (discoveredCardUserField) {
            try {
                const discoveredDetails = searchCardDetails(transactionIds, [{
                    key: 'configuredCardUser',
                    name: discoveredCardUserField.fieldId,
                    useText: true
                }]);
                mergeTransactionDetails(detailsByTransaction, discoveredDetails);
            } catch (error) {
                log.debug({
                    title: 'Expense drill-down configured card-user lookup fallback',
                    details: error
                });
            }
        }

        let usersByCardAccount = {};
        const discoveredAccountUserField = discoverAccountCardUserField(rows);
        if (discoveredAccountUserField) {
            const cardAccountIds = [];
            const seenCardAccounts = {};
            rows.forEach((row) => {
                if (row.creditCardAccountId && !seenCardAccounts[row.creditCardAccountId]) {
                    seenCardAccounts[row.creditCardAccountId] = true;
                    cardAccountIds.push(row.creditCardAccountId);
                }
            });
            try {
                usersByCardAccount = searchAccountCardUsers(
                    cardAccountIds,
                    discoveredAccountUserField.fieldId
                );
            } catch (error) {
                log.debug({
                    title: 'Expense drill-down card-account user lookup fallback',
                    details: error
                });
            }
        }

        const discoveredMerchantField = discoverCardMerchantField(rows);
        if (discoveredMerchantField) {
            try {
                const merchantDetails = discoveredMerchantField.location === 'line'
                    ? searchCardLineDetails(
                        cardTransactionIds,
                        discoveredMerchantField.fieldId
                    )
                    : searchCardDetails(cardTransactionIds, [{
                        key: 'configuredMerchant',
                        name: discoveredMerchantField.fieldId,
                        useText: true
                    }]);
                mergeTransactionDetails(detailsByTransaction, merchantDetails);
            } catch (error) {
                log.debug({
                    title: 'Expense drill-down merchant lookup fallback',
                    details: error
                });
            }
            if (
                discoveredMerchantField.sampleTransactionId
                && discoveredMerchantField.sampleValue
            ) {
                const sampleId = discoveredMerchantField.sampleTransactionId;
                detailsByTransaction[sampleId] = Object.assign(
                    {},
                    detailsByTransaction[sampleId] || {},
                    { configuredMerchant: discoveredMerchantField.sampleValue }
                );
            }
            loadMerchantFallback(rows, discoveredMerchantField, detailsByTransaction);
        }

        rows.forEach((row) => {
            const detail = detailsByTransaction[row.transactionId] || {};
            if (row.typeCode === 'ExpRept') {
                row.creditCardUser = row.payee;
            } else if (row.spendKind === 'Credit card') {
                row.payee = detail.configuredMerchant || row.payee;
                row.creditCardUser = employeeDisplayName(detail)
                    || detail.configuredCardUser
                    || usersByCardAccount[row.creditCardAccountId]
                    || detail.ccholdername
                    || detail.createdby
                    || '';
            }
            if (!row.creditCardAccount && detail.acctcorpcardexp) {
                row.creditCardAccount = detail.acctcorpcardexp;
            }
        });
        return rows;
    }

    function monthKey(year, month) {
        return `${year}-${pad2(month)}`;
    }

    function percentageChange(current, prior) {
        if (!prior) {
            return null;
        }
        return (current - prior) / Math.abs(prior);
    }

    function sumMonths(categoryMonthValues, year, fromMonth, throughMonth) {
        let total = 0;
        for (let month = fromMonth; month <= throughMonth; month += 1) {
            total += categoryMonthValues[monthKey(year, month)] || 0;
        }
        return total;
    }

    function averageMonthsWithData(categoryMonthValues, year, fromMonth, throughMonth) {
        let total = 0;
        let monthCount = 0;
        for (let month = fromMonth; month <= throughMonth; month += 1) {
            const key = monthKey(year, month);
            if (Object.prototype.hasOwnProperty.call(categoryMonthValues, key)) {
                total += categoryMonthValues[key] || 0;
                monthCount += 1;
            }
        }
        return monthCount ? total / monthCount : 0;
    }

    function monthLabels(startYear, endYear) {
        const shortMonths = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];
        const labels = [];
        for (let year = startYear; year <= endYear; year += 1) {
            for (let month = 1; month <= 12; month += 1) {
                labels.push({
                    key: monthKey(year, month),
                    label: `${shortMonths[month - 1]} ${String(year).slice(-2)}`,
                    year,
                    month
                });
            }
        }
        return labels;
    }

    function createAccountAnalysis(categoryList, filters, comparisonYears) {
        if (!filters.accountIds.length) {
            return null;
        }

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const selectedIds = {};
        filters.accountIds.forEach((id) => {
            selectedIds[String(id)] = true;
        });
        const categoriesById = {};
        categoryList.forEach((item) => {
            if (selectedIds[item.id]) {
                categoriesById[item.id] = item;
            }
        });
        const selectedCategories = filters.accountIds
            .map((id) => categoriesById[String(id)])
            .filter(Boolean);
        const category = {
            id: filters.accountIds.join(','),
            name: filters.accountIds.length === 1 && selectedCategories.length
                ? selectedCategories[0].name
                : `${filters.accountIds.length} selected expense accounts`,
            months: {},
            creditCardMonths: {}
        };
        selectedCategories.forEach((item) => {
            Object.keys(item.months).forEach((key) => {
                category.months[key] = (category.months[key] || 0) + item.months[key];
            });
            Object.keys(item.creditCardMonths).forEach((key) => {
                category.creditCardMonths[key] = (
                    category.creditCardMonths[key] || 0
                ) + item.creditCardMonths[key];
            });
        });

        const yearStatistics = comparisonYears.map((year) => {
            const fullYearValues = months.map((_, index) => (
                category.months[monthKey(year, index + 1)] || 0
            ));
            const fullYearHasDataValues = months.map((_, index) => (
                Object.prototype.hasOwnProperty.call(
                    category.months,
                    monthKey(year, index + 1)
                )
            ));
            const fullYearCreditCardValues = months.map((_, index) => (
                category.creditCardMonths[monthKey(year, index + 1)] || 0
            ));
            const fullYearOtherValues = fullYearValues.map((amount, index) => (
                amount - fullYearCreditCardValues[index]
            ));
            const comparableValues = fullYearValues.slice(0, filters.reportMonth);
            const total = comparableValues.reduce((sum, amount) => sum + amount, 0);
            const maximum = comparableValues.length ? Math.max(...comparableValues) : 0;
            const minimum = comparableValues.length ? Math.min(...comparableValues) : 0;
            const accountValues = selectedCategories.map((account) => {
                const values = months.map((_, index) => (
                    account.months[monthKey(year, index + 1)] || 0
                ));
                const creditCardValues = months.map((_, index) => (
                    account.creditCardMonths[monthKey(year, index + 1)] || 0
                ));
                const otherValues = values.map((amount, index) => (
                    amount - creditCardValues[index]
                ));
                return {
                    id: account.id,
                    name: account.name,
                    creditCardValues: creditCardValues.map((amount, index) => (
                        year === filters.reportYear && index + 1 > filters.reportMonth ? null : amount
                    )),
                    otherValues: otherValues.map((amount, index) => (
                        year === filters.reportYear && index + 1 > filters.reportMonth ? null : amount
                    ))
                };
            });
            return {
                year,
                ytd: total,
                average: averageMonthsWithData(
                    category.months,
                    year,
                    1,
                    filters.reportMonth
                ),
                max: maximum,
                min: minimum,
                maxMonth: months[comparableValues.indexOf(maximum)] || '',
                minMonth: months[comparableValues.indexOf(minimum)] || '',
                values: fullYearValues.map((amount, index) => (
                    year === filters.reportYear && index + 1 > filters.reportMonth ? null : amount
                )),
                hasDataValues: fullYearHasDataValues.map((hasData, index) => (
                    year === filters.reportYear && index + 1 > filters.reportMonth ? false : hasData
                )),
                creditCardValues: fullYearCreditCardValues.map((amount, index) => (
                    year === filters.reportYear && index + 1 > filters.reportMonth ? null : amount
                )),
                otherValues: fullYearOtherValues.map((amount, index) => (
                    year === filters.reportYear && index + 1 > filters.reportMonth ? null : amount
                )),
                accounts: accountValues
            };
        });
        const current = yearStatistics.find((item) => item.year === filters.reportYear) || null;
        const priorYtd = months.slice(0, filters.reportMonth).reduce((total, _, index) => (
            total + (category.months[monthKey(filters.reportYear - 1, index + 1)] || 0)
        ), 0);

        return {
            id: category.id,
            name: category.name,
            accounts: selectedCategories.map((item) => ({ id: item.id, name: item.name })),
            labels: months,
            datasets: yearStatistics.map((item) => ({
                label: String(item.year),
                values: item.values,
                hasDataValues: item.hasDataValues,
                creditCardValues: item.creditCardValues,
                otherValues: item.otherValues,
                accounts: item.accounts
            })),
            current: current ? {
                average: current.average,
                max: current.max,
                min: current.min,
                maxMonth: current.maxMonth,
                minMonth: current.minMonth,
                ytd: current.ytd,
                priorYtd,
                ytdChange: percentageChange(current.ytd, priorYtd)
            } : null,
            years: yearStatistics.slice().reverse().map((item, index, reversedYears) => {
                const previous = reversedYears[index + 1];
                return {
                    year: item.year,
                    ytd: item.ytd,
                    average: item.average,
                    max: item.max,
                    min: item.min,
                    changeVsPrevious: previous ? percentageChange(item.ytd, previous.ytd) : null
                };
            })
        };
    }

    function aggregateDashboard(monthlyRows, filters) {
        const categories = {};
        const startYear = filters.reportYear - filters.comparisonYears + 1;
        const labelObjects = monthLabels(startYear, filters.reportYear);
        const comparisonYears = [];
        for (let year = startYear; year <= filters.reportYear; year += 1) {
            comparisonYears.push(year);
        }

        monthlyRows.forEach((row) => {
            const id = String(row.category_id || '0');
            const year = Number(row.spend_year);
            const month = Number(row.spend_month);
            if (!categories[id]) {
                categories[id] = {
                    id,
                    name: String(row.category_name || 'Uncategorised'),
                    months: {},
                    creditCardMonths: {}
                };
            }
            const key = monthKey(year, month);
            const amount = Number(row.amount) || 0;
            categories[id].months[key] = (categories[id].months[key] || 0) + amount;
            if (String(row.is_credit_card) === 'T') {
                categories[id].creditCardMonths[key] = (
                    categories[id].creditCardMonths[key] || 0
                ) + amount;
            }
        });

        const categoryList = Object.keys(categories).map((id) => categories[id]);
        categoryList.forEach((category) => {
            category.currentYtd = sumMonths(
                category.months,
                filters.reportYear,
                1,
                filters.reportMonth
            );
            category.rankingAmount = Math.abs(category.currentYtd);
            if (!category.rankingAmount) {
                category.rankingAmount = Math.abs(sumMonths(
                    category.months,
                    filters.reportYear - 1,
                    1,
                    12
                ));
            }
        });
        categoryList.sort((left, right) => {
            if (right.rankingAmount !== left.rankingAmount) {
                return right.rankingAmount - left.rankingAmount;
            }
            return left.name.localeCompare(right.name);
        });

        const topCategories = categoryList.slice(0, filters.categoryLimit);
        const remainingCategories = categoryList.slice(filters.categoryLimit);

        function allCategoryTotal(year, fromMonth, throughMonth) {
            return categoryList.reduce(
                (total, category) => total + sumMonths(category.months, year, fromMonth, throughMonth),
                0
            );
        }

        function allCategoryAverageWithData(year, fromMonth, throughMonth) {
            let total = 0;
            let monthCount = 0;
            for (let month = fromMonth; month <= throughMonth; month += 1) {
                const key = monthKey(year, month);
                let monthHasData = false;
                let monthTotal = 0;
                categoryList.forEach((category) => {
                    if (Object.prototype.hasOwnProperty.call(category.months, key)) {
                        monthHasData = true;
                        monthTotal += category.months[key] || 0;
                    }
                });
                if (monthHasData) {
                    total += monthTotal;
                    monthCount += 1;
                }
            }
            return monthCount ? total / monthCount : 0;
        }

        const currentMonthTotal = allCategoryTotal(
            filters.reportYear,
            filters.reportMonth,
            filters.reportMonth
        );
        const priorMonthTotal = allCategoryTotal(
            filters.reportYear - 1,
            filters.reportMonth,
            filters.reportMonth
        );
        const currentYtd = allCategoryTotal(filters.reportYear, 1, filters.reportMonth);
        const priorYtd = allCategoryTotal(filters.reportYear - 1, 1, filters.reportMonth);
        const lastFullYear = allCategoryTotal(filters.reportYear - 1, 1, 12);
        const previousFullYear = allCategoryTotal(filters.reportYear - 2, 1, 12);

        const summary = topCategories.map((category) => {
            const currentMonth = sumMonths(
                category.months,
                filters.reportYear,
                filters.reportMonth,
                filters.reportMonth
            );
            const categoryCurrentYtd = sumMonths(
                category.months,
                filters.reportYear,
                1,
                filters.reportMonth
            );
            const categoryPriorYtd = sumMonths(
                category.months,
                filters.reportYear - 1,
                1,
                filters.reportMonth
            );
            const categoryLastFullYear = sumMonths(
                category.months,
                filters.reportYear - 1,
                1,
                12
            );
            const categoryPreviousFullYear = sumMonths(
                category.months,
                filters.reportYear - 2,
                1,
                12
            );
            return {
                id: category.id,
                name: category.name,
                currentMonth,
                averageSpend: averageMonthsWithData(
                    category.months,
                    filters.reportYear - 1,
                    1,
                    12
                ),
                shareOfMonth: currentMonthTotal ? currentMonth / currentMonthTotal : 0,
                currentYtd: categoryCurrentYtd,
                priorYtd: categoryPriorYtd,
                ytdChange: percentageChange(categoryCurrentYtd, categoryPriorYtd),
                lastFullYear: categoryLastFullYear,
                fullYearChange: percentageChange(categoryLastFullYear, categoryPreviousFullYear)
            };
        });

        const stackedDatasets = topCategories.map((category) => ({
            id: category.id,
            label: category.name,
            values: labelObjects.map((item) => category.months[item.key] || 0)
        }));
        if (remainingCategories.length) {
            stackedDatasets.push({
                id: 'other',
                label: 'Other expenses',
                values: labelObjects.map((item) => remainingCategories.reduce(
                    (total, category) => total + (category.months[item.key] || 0),
                    0
                ))
            });
        }

        const categoryComparisons = topCategories.map((category) => ({
            id: category.id,
            name: category.name,
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            datasets: comparisonYears.map((year) => ({
                label: String(year),
                values: Array.from({ length: 12 }, (_, index) => (
                    category.months[monthKey(year, index + 1)] || 0
                ))
            }))
        }));

        const spendMix = summary.map((row) => ({ label: row.name, value: row.currentYtd }));
        if (remainingCategories.length) {
            spendMix.push({
                label: 'Other expenses',
                value: remainingCategories.reduce(
                    (total, category) => total + sumMonths(
                        category.months,
                        filters.reportYear,
                        1,
                        filters.reportMonth
                    ),
                    0
                )
            });
        }

        const accountAnalysis = createAccountAnalysis(categoryList, filters, comparisonYears);

        return {
            filters: {
                reportYear: filters.reportYear,
                reportMonth: filters.reportMonth,
                comparisonYears: filters.comparisonYears,
                categoryLimit: filters.categoryLimit,
                groupBy: filters.groupBy,
                departmentIds: filters.departmentIds,
                accountIds: filters.accountIds,
                subsidiaryId: filters.subsidiaryId,
                shareDepartmentId: filters.shareDepartmentId
            },
            kpis: {
                currentMonth: currentMonthTotal,
                sameMonthPriorYear: priorMonthTotal,
                averageSpend: allCategoryAverageWithData(filters.reportYear - 1, 1, 12),
                shareOfMonth: currentMonthTotal ? 1 : 0,
                currentYtd,
                priorYtd,
                ytdChange: percentageChange(currentYtd, priorYtd),
                averageMonthlyYtd: allCategoryAverageWithData(
                    filters.reportYear,
                    1,
                    filters.reportMonth
                ),
                lastFullYear,
                fullYearChange: percentageChange(lastFullYear, previousFullYear)
            },
            monthlyTrend: {
                labels: labelObjects.map((item) => item.label),
                datasets: stackedDatasets
            },
            spendMix,
            summary,
            categoryComparisons,
            accountAnalysis,
            meta: {
                categoryCount: categoryList.length,
                displayedCategoryCount: topCategories.length,
                hasOtherCategory: remainingCategories.length > 0,
                rowCount: monthlyRows.length,
                lastFullYear,
                previousFullYear
            }
        };
    }

    function safeOptionQuery(sql, optionType) {
        try {
            return runSuiteQl(sql, [], QUERY_IDS.options).map((row) => ({
                id: String(row.id),
                name: String(row.name || row.id)
            }));
        } catch (error) {
            log.debug({
                title: `Expense dashboard ${optionType} options unavailable`,
                details: error
            });
            return [];
        }
    }

    function getFilterOptions() {
        return {
            departments: safeOptionQuery(
                "SELECT id, fullname AS name FROM Department WHERE isinactive = 'F' ORDER BY fullname, id",
                'department'
            ),
            accounts: safeOptionQuery(
                "SELECT id, fullname AS name FROM Account WHERE isinactive = 'F' AND accttype IN ('Expense', 'OthExpense', 'COGS') ORDER BY fullname, id",
                'expense account'
            ),
            subsidiaries: safeOptionQuery(
                "SELECT id, legalname AS name FROM Subsidiary WHERE isinactive = 'F' ORDER BY legalname, id",
                'subsidiary'
            )
        };
    }

    function getDashboard(parameters) {
        const filters = normalizeFilters(parameters || {});
        const monthlyRows = loadMonthlyRows(filters);
        const dashboard = aggregateDashboard(monthlyRows, filters);
        const sharePeriod = breakdownPeriod({ breakdownPeriod: 'ytd' }, filters);
        const shareTrend = createShareTrendData(filters, sharePeriod);
        const currentShare = shareTrend.series.find((item) => (
            item.year === filters.reportYear && item.month === filters.reportMonth
        ));
        dashboard.kpis.shareOfMonth = currentShare && currentShare.percentage !== null
            ? currentShare.percentage
            : 0;
        dashboard.kpis.averageShareOfMonth = shareTrend.averagePercentage === null
            ? 0
            : shareTrend.averagePercentage;
        if (dashboard.accountAnalysis) {
            dashboard.accountAnalysis.budget = loadAccountBudget(filters);
        }
        dashboard.details = loadDetailRows(filters);
        dashboard.generatedAt = new Date().toISOString();
        dashboard.currencyCode = 'AUD';
        return dashboard;
    }

    function getDrilldown(parameters) {
        const filters = normalizeFilters(parameters || {});
        const spendKind = normaliseSpendKind(parameters && parameters.spendKind);
        return {
            filters: {
                reportYear: filters.reportYear,
                reportMonth: filters.reportMonth,
                departmentIds: filters.departmentIds,
                accountIds: filters.accountIds,
                subsidiaryId: filters.subsidiaryId
            },
            spendKind,
            rows: loadDetailRows(filters, spendKind, 0)
        };
    }

    function getShareTrend(parameters) {
        const filters = normalizeFilters(parameters || {});
        const period = breakdownPeriod(parameters || {}, filters);
        const trend = createShareTrendData(filters, period);
        return {
            filters: {
                reportYear: filters.reportYear,
                reportMonth: filters.reportMonth,
                accountIds: filters.accountIds,
                subsidiaryId: filters.subsidiaryId,
                shareDepartmentId: filters.shareDepartmentId
            },
            period,
            averagePercentage: trend.averagePercentage,
            series: trend.series
        };
    }

    function getAccountSpendTrend(parameters) {
        const filters = normalizeFilters(parameters || {});
        const period = breakdownPeriod(parameters || {}, filters);
        const rows = filters.accountIds.length
            ? loadMonthlyTotals(filters, period.startDate, period.endDateExclusive)
            : [];
        const totalsByMonth = monthlyTotalsByKey(rows);
        const series = monthsInPeriod(period).map((item) => ({
            year: item.year,
            month: item.month,
            amount: totalsByMonth[item.key] || 0,
            hasData: Object.prototype.hasOwnProperty.call(totalsByMonth, item.key)
        }));
        const yearsByValue = {};
        const comparisonSeries = period.mode === 'lastyears'
            ? series.filter((item) => item.month <= filters.reportMonth)
            : series;
        comparisonSeries.forEach((item) => {
            if (!item.hasData) {
                return;
            }
            if (!yearsByValue[item.year]) {
                yearsByValue[item.year] = { year: item.year, total: 0, monthCount: 0 };
            }
            yearsByValue[item.year].total += item.amount;
            yearsByValue[item.year].monthCount += 1;
        });
        const years = Object.keys(yearsByValue)
            .map((year) => yearsByValue[year])
            .sort((left, right) => left.year - right.year)
            .map((item) => ({
                year: item.year,
                average: item.monthCount ? item.total / item.monthCount : 0,
                monthCount: item.monthCount
            }));
        const activeAmounts = series
            .filter((item) => item.hasData)
            .map((item) => item.amount);
        const average = activeAmounts.length
            ? activeAmounts.reduce((total, amount) => total + amount, 0) / activeAmounts.length
            : 0;
        const firstYear = years.length ? years[0] : null;
        const lastYear = years.length ? years[years.length - 1] : null;
        return {
            filters: {
                reportYear: filters.reportYear,
                reportMonth: filters.reportMonth,
                departmentIds: filters.departmentIds,
                accountIds: filters.accountIds,
                subsidiaryId: filters.subsidiaryId
            },
            period,
            average,
            change: firstYear && lastYear && firstYear.year !== lastYear.year
                ? percentageChange(lastYear.average, firstYear.average)
                : null,
            years,
            series
        };
    }

    function getAccountSuspenseEstimate(parameters) {
        const filters = normalizeFilters(parameters || {});
        const currentStart = dateString(filters.reportYear, filters.reportMonth, 1);
        const currentEnd = nextMonth(filters.reportYear, filters.reportMonth);
        const currentEndDate = dateString(currentEnd.year, currentEnd.month, 1);
        const historyStart = dateString(filters.reportYear - 1, filters.reportMonth, 1);
        const actualRows = filters.accountIds.length
            ? loadMonthlyTotals(filters, currentStart, currentEndDate)
            : [];
        const actualCurrentMonth = actualRows.reduce(
            (total, row) => total + (Number(row.total_amount) || 0),
            0
        );
        const suspenseAccounts = loadCreditCardSuspenseAccounts();
        if (!filters.accountIds.length || !suspenseAccounts.length) {
            return {
                filters: {
                    reportYear: filters.reportYear,
                    reportMonth: filters.reportMonth,
                    accountIds: filters.accountIds
                },
                available: false,
                actualCurrentMonth,
                estimatedCurrentMonth: actualCurrentMonth,
                suspenseAccounts,
                suspenseAmount: 0,
                estimatedSuspense: 0,
                coverage: 0,
                transactionCount: 0,
                topCardholders: [],
                topPayees: [],
                rows: []
            };
        }

        const unallocatedFilters = Object.assign({}, filters, {
            accountIds: [],
            departmentIds: []
        });
        const suspenseRows = loadSuspenseRows(
            unallocatedFilters,
            suspenseAccounts,
            currentStart,
            currentEndDate
        );
        if (!suspenseRows.length) {
            return {
                filters: {
                    reportYear: filters.reportYear,
                    reportMonth: filters.reportMonth,
                    accountIds: filters.accountIds
                },
                available: true,
                modelAvailable: false,
                actualCurrentMonth,
                estimatedCurrentMonth: actualCurrentMonth,
                suspenseAccounts,
                suspenseAmount: 0,
                estimatedSuspense: 0,
                coverage: 0,
                transactionCount: 0,
                historyStart,
                historyEnd: shiftIsoDate(currentStart, -1),
                topCardholders: [],
                topPayees: [],
                rows: []
            };
        }

        const historyRows = loadDetailRows(unallocatedFilters, 'all', 0, {
            startDate: historyStart,
            endDate: currentStart
        });
        const selectedAccounts = {};
        const selectedDepartments = {};
        filters.accountIds.forEach((id) => { selectedAccounts[String(id)] = true; });
        filters.departmentIds.forEach((id) => { selectedDepartments[String(id)] = true; });
        const userHistory = {};
        const payeeHistory = {};
        let historicalTotal = 0;
        let historicalSelected = 0;

        function contributorKey(value) {
            return String(value || '').trim().toLowerCase();
        }

        function addHistory(map, name, amount, isSelected) {
            const key = contributorKey(name);
            if (!map[key]) {
                map[key] = { name, total: 0, selected: 0 };
            }
            map[key].total += amount;
            if (isSelected) {
                map[key].selected += amount;
            }
        }

        historyRows.forEach((row) => {
            const amount = Number(row.amount) || 0;
            if (amount <= 0) {
                return;
            }
            const isSelected = Boolean(selectedAccounts[String(row.accountId)])
                && (
                    !filters.departmentIds.length
                    || Boolean(selectedDepartments[String(row.departmentId)])
                );
            historicalTotal += amount;
            if (isSelected) {
                historicalSelected += amount;
            }
            if (row.spendKind === 'Credit card') {
                addHistory(
                    userHistory,
                    row.creditCardUser || 'Unassigned card user',
                    amount,
                    isSelected
                );
            }
            addHistory(
                payeeHistory,
                row.payee || 'No merchant / payee',
                amount,
                isSelected
            );
        });

        function boundedRate(value) {
            return Math.max(0, Math.min(1, Number(value) || 0));
        }

        function historicalRate(stat) {
            return stat && stat.total ? boundedRate(stat.selected / stat.total) : null;
        }

        const overallRate = historicalTotal
            ? boundedRate(historicalSelected / historicalTotal)
            : 0;
        const cardholderDrivers = {};
        const payeeDrivers = {};
        let suspenseAmount = 0;
        let estimatedSuspense = 0;
        let coveredAmount = 0;
        let absoluteSuspenseAmount = 0;
        const estimatedRows = [];

        function addDriver(map, name, amount, estimate, stat) {
            const key = contributorKey(name);
            if (!map[key]) {
                map[key] = {
                    name,
                    suspenseAmount: 0,
                    estimatedAmount: 0,
                    historicalRate: historicalRate(stat),
                    historicalSpend: stat ? stat.total : 0
                };
            }
            map[key].suspenseAmount += amount;
            map[key].estimatedAmount += estimate;
        }

        suspenseRows.forEach((row) => {
            const amount = Number(row.amount) || 0;
            const cardholder = row.creditCardUser || 'Unassigned card user';
            const payee = row.payee || 'No merchant / payee';
            const userStat = userHistory[contributorKey(cardholder)] || null;
            const payeeStat = payeeHistory[contributorKey(payee)] || null;
            let weightedRate = overallRate;
            let totalWeight = 1;
            if (userStat && userStat.total) {
                const userWeight = Math.min(4, Math.sqrt(userStat.total / 1000));
                weightedRate += historicalRate(userStat) * userWeight;
                totalWeight += userWeight;
            }
            if (payeeStat && payeeStat.total) {
                const payeeWeight = Math.min(5, Math.sqrt(payeeStat.total / 750));
                weightedRate += historicalRate(payeeStat) * payeeWeight;
                totalWeight += payeeWeight;
            }
            const allocationRate = boundedRate(weightedRate / totalWeight);
            const estimate = amount * allocationRate;
            suspenseAmount += amount;
            estimatedSuspense += estimate;
            absoluteSuspenseAmount += Math.abs(amount);
            if (userStat || payeeStat) {
                coveredAmount += Math.abs(amount);
            }
            addDriver(cardholderDrivers, cardholder, amount, estimate, userStat);
            addDriver(payeeDrivers, payee, amount, estimate, payeeStat);
            estimatedRows.push(Object.assign({}, row, {
                suspenseAmount: amount,
                estimatedAmount: estimate,
                allocationRate
            }));
        });

        function topDrivers(map) {
            return Object.keys(map)
                .map((key) => map[key])
                .sort((left, right) => (
                    Math.abs(right.suspenseAmount) - Math.abs(left.suspenseAmount)
                    || left.name.localeCompare(right.name)
                ))
                .slice(0, 5);
        }

        return {
            filters: {
                reportYear: filters.reportYear,
                reportMonth: filters.reportMonth,
                departmentIds: filters.departmentIds,
                accountIds: filters.accountIds,
                subsidiaryId: filters.subsidiaryId
            },
            available: true,
            modelAvailable: historicalTotal > 0,
            actualCurrentMonth,
            estimatedCurrentMonth: actualCurrentMonth + estimatedSuspense,
            suspenseAccounts,
            suspenseAmount,
            estimatedSuspense,
            coverage: absoluteSuspenseAmount ? coveredAmount / absoluteSuspenseAmount : 0,
            transactionCount: suspenseRows.length,
            overallHistoricalRate: overallRate,
            historyStart,
            historyEnd: shiftIsoDate(currentStart, -1),
            topCardholders: topDrivers(cardholderDrivers),
            topPayees: topDrivers(payeeDrivers),
            rows: estimatedRows
        };
    }

    function createContributorBreakdown(rows, spendKind, showAccount) {
        const totalsByContributor = {};
        rows.forEach((row) => {
            if (row.spendKind !== spendKind || row.amount <= 0) {
                return;
            }
            const name = spendKind === 'Credit card'
                ? row.creditCardUser || 'Unassigned card user'
                : row.payee || 'No payee';
            const accountName = showAccount ? row.account || 'No expense account' : '';
            if (!totalsByContributor[name]) {
                totalsByContributor[name] = { name, accountNames: {}, amount: 0 };
            }
            totalsByContributor[name].amount += row.amount;
            if (accountName) {
                totalsByContributor[name].accountNames[accountName] = true;
            }
        });
        const items = Object.keys(totalsByContributor)
            .map((key) => {
                const contributor = totalsByContributor[key];
                return {
                    name: contributor.name,
                    accountName: Object.keys(contributor.accountNames).sort().join(' + '),
                    amount: contributor.amount
                };
            })
            .sort((left, right) => right.amount - left.amount || left.name.localeCompare(right.name));
        const total = items.reduce((sum, item) => sum + item.amount, 0);
        items.forEach((item) => {
            item.percentage = total ? item.amount / total : 0;
        });
        const remainingItems = items.slice(5);
        const remainingAmount = remainingItems.reduce((sum, item) => sum + item.amount, 0);
        return {
            total,
            top: items.slice(0, 5),
            remaining: {
                count: remainingItems.length,
                amount: remainingAmount,
                percentage: total ? remainingAmount / total : 0,
                items: remainingItems
            }
        };
    }

    function applyAccountSpendPercentages(breakdown, accountSpendTotal) {
        breakdown.top.concat(breakdown.remaining.items).forEach((item) => {
            item.percentage = accountSpendTotal ? item.amount / accountSpendTotal : 0;
        });
        breakdown.remaining.percentage = accountSpendTotal
            ? breakdown.remaining.amount / accountSpendTotal
            : 0;
        return breakdown;
    }

    function getAccountBreakdown(parameters) {
        const filters = normalizeFilters(parameters || {});
        const period = breakdownPeriod(parameters || {}, filters);
        if (!filters.accountIds.length) {
            return {
                filters: {
                    reportYear: filters.reportYear,
                    reportMonth: filters.reportMonth,
                    accountIds: []
                },
                period,
                creditCard: createContributorBreakdown([], 'Credit card', false),
                other: createContributorBreakdown([], 'Other', false)
            };
        }
        const rows = loadDetailRows(filters, 'all', 0, {
            startDate: period.startDate,
            endDate: period.endDateExclusive
        });
        const showAccount = filters.accountIds.length > 1;
        const creditCard = createContributorBreakdown(rows, 'Credit card', showAccount);
        const other = createContributorBreakdown(rows, 'Other', showAccount);
        const accountSpendTotal = creditCard.total + other.total;
        return {
            filters: {
                reportYear: filters.reportYear,
                reportMonth: filters.reportMonth,
                departmentIds: filters.departmentIds,
                accountIds: filters.accountIds,
                subsidiaryId: filters.subsidiaryId
            },
            period,
            accountSpendTotal,
            creditCard: applyAccountSpendPercentages(creditCard, accountSpendTotal),
            other: applyAccountSpendPercentages(other, accountSpendTotal)
        };
    }

    function getContributorTransactions(parameters) {
        const filters = normalizeFilters(parameters || {});
        const period = breakdownPeriod(parameters || {}, filters);
        const requestedKind = String(parameters.contributorKind || '');
        const contributorKind = requestedKind === 'creditCard' ? 'creditCard' : 'other';
        const contributorName = String(parameters.contributorName || '');
        const rows = filters.accountIds.length && contributorName
            ? loadDetailRows(filters, 'all', 0, {
                startDate: period.startDate,
                endDate: period.endDateExclusive
            })
            : [];
        const matchingRows = rows.filter((row) => {
            if (contributorKind === 'creditCard') {
                return row.spendKind === 'Credit card'
                    && (row.creditCardUser || 'Unassigned card user') === contributorName;
            }
            return row.spendKind === 'Other'
                && (row.payee || 'No payee') === contributorName;
        });
        return {
            filters: {
                reportYear: filters.reportYear,
                reportMonth: filters.reportMonth,
                departmentIds: filters.departmentIds,
                accountIds: filters.accountIds,
                subsidiaryId: filters.subsidiaryId
            },
            period,
            contributorKind,
            contributorName,
            total: matchingRows.reduce((sum, row) => sum + row.amount, 0),
            rows: matchingRows
        };
    }

    return {
        getAccountBreakdown,
        getAccountSpendTrend,
        getAccountSuspenseEstimate,
        getContributorTransactions,
        getDashboard,
        getDrilldown,
        getShareTrend,
        getFilterOptions
    };
});
