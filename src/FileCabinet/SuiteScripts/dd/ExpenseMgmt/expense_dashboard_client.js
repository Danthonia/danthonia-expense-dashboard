(function () {
    'use strict';

    var config = window.DANTHONIA_EXPENSE_DASHBOARD || {};
    var charts = {};
    var currentDetails = [];
    var refreshTimer = null;
    var drilldownRequestId = 0;
    var breakdownRequestId = 0;
    var accountTimeRequestId = 0;
    var suspenseEstimateRequestId = 0;
    var shareTrendRequestId = 0;
    var currentDrilldownRows = [];
    var currentDrilldownMeta = '';
    var currentDrilldownMode = 'actual';
    var currentSuspenseEstimate = null;
    var currentBreakdownRemainders = {};
    var currentBreakdownPeriod = '';
    var currentBreakdownMultipleAccounts = false;
    var currentBreakdownPeriodMode = 'ytd';
    var currentBreakdownAccountName = '';
    var currentAccountTimePeriodMode = 'ytd';
    var currentAccountTimeAccountName = '';
    var currentShareTrendPeriodMode = 'ytd';
    var palette = [
        '#17365D', '#2F75B5', '#ED7D31', '#7F7F7F', '#FFC000', '#70AD47',
        '#00A6A6', '#8064A2', '#5B9BD5', '#C0504D', '#8C564B', '#556B2F',
        '#9EADBA', '#4E7C8A', '#B07AA1', '#D99B63', '#607D3B', '#6B7280',
        '#A46A4A', '#3B7D7A'
    ];
    var yearPalette = ['#7B2CBF', '#00897B', '#D1495B', '#ED7D31', '#17365D'];
    var yearPaletteLight = ['#D9B8F4', '#8FD1C8', '#F0ADB6', '#F6C49D', '#91A8C2'];
    var accountPalette = [
        '#17365D', '#C2410C', '#0F766E', '#7E22CE', '#B91C1C',
        '#4D7C0F', '#0369A1', '#9D174D', '#6D4C41', '#475569'
    ];

    function byId(id) {
        return document.getElementById(id);
    }

    function valueOf(id) {
        return byId(id).value || '';
    }

    function selectedValues(id) {
        var select = byId(id);
        return Array.prototype.map.call(select.selectedOptions || [], function (option) {
            return option.value;
        }).filter(Boolean);
    }

    function initialiseCompactMultiSelect(id, pluralLabel) {
        var select = byId(id);
        var control = document.createElement('div');
        var toggle = document.createElement('button');
        var toggleText = document.createElement('span');
        var caret = document.createElement('span');
        var menu = document.createElement('div');
        var optionButtons = [];

        control.className = 'multi-select-control';
        toggle.className = 'multi-select-toggle';
        toggle.type = 'button';
        toggle.setAttribute('aria-haspopup', 'listbox');
        toggle.setAttribute('aria-expanded', 'false');
        toggleText.className = 'multi-select-toggle-text';
        caret.className = 'multi-select-caret';
        caret.textContent = '\u25be';
        toggle.appendChild(toggleText);
        toggle.appendChild(caret);

        menu.className = 'multi-select-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-multiselectable', 'true');

        function selectedOptions() {
            return Array.prototype.filter.call(select.options, function (option) {
                return option.selected && Boolean(option.value);
            });
        }

        function updateDisplay() {
            var selected = selectedOptions();
            if (!selected.length) {
                toggleText.textContent = select.options[0].textContent;
            } else if (selected.length === 1) {
                toggleText.textContent = selected[0].textContent;
            } else {
                toggleText.textContent = selected.length + ' ' + pluralLabel + ' selected';
            }
            optionButtons.forEach(function (button, index) {
                var isSelected = select.options[index].selected;
                button.classList.toggle('is-selected', isSelected);
                button.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                button.firstChild.textContent = isSelected ? '\u2713' : '';
            });
        }

        Array.prototype.forEach.call(select.options, function (option, index) {
            var button = document.createElement('button');
            var check = document.createElement('span');
            var text = document.createElement('span');
            button.className = 'multi-select-option';
            button.type = 'button';
            button.setAttribute('role', 'option');
            check.className = 'multi-select-check';
            text.textContent = option.textContent;
            button.appendChild(check);
            button.appendChild(text);
            button.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                if (!option.value) {
                    Array.prototype.forEach.call(select.options, function (item) {
                        item.selected = false;
                    });
                    option.selected = true;
                } else {
                    select.options[0].selected = false;
                    option.selected = !option.selected;
                    if (!selectedOptions().length) {
                        select.options[0].selected = true;
                    }
                }
                updateDisplay();
                select.dispatchEvent(new Event('change', { bubbles: true }));
            });
            optionButtons.push(button);
            menu.appendChild(button);
        });

        toggle.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            var shouldOpen = menu.hidden;
            Array.prototype.forEach.call(document.querySelectorAll('.multi-select-menu'), function (otherMenu) {
                otherMenu.hidden = true;
                if (otherMenu.previousSibling) {
                    otherMenu.previousSibling.setAttribute('aria-expanded', 'false');
                }
            });
            menu.hidden = !shouldOpen;
            toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        });

        document.addEventListener('click', function (event) {
            if (!control.contains(event.target)) {
                menu.hidden = true;
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !menu.hidden) {
                menu.hidden = true;
                toggle.setAttribute('aria-expanded', 'false');
                toggle.focus();
            }
        });

        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');
        control.appendChild(toggle);
        control.appendChild(menu);
        select.insertAdjacentElement('afterend', control);
        updateDisplay();
    }

    function formatCurrency(value) {
        var number = Number(value) || 0;
        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: config.currencyCode || 'AUD',
                currencyDisplay: 'narrowSymbol',
                maximumFractionDigits: 0
            }).format(number);
        } catch (error) {
            return '$' + Math.round(number).toLocaleString();
        }
    }

    function formatPercent(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) {
            return 'Not available';
        }
        return new Intl.NumberFormat(undefined, {
            style: 'percent',
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
            signDisplay: 'exceptZero'
        }).format(Number(value));
    }

    function formatSharePercent(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) {
            return 'Not available';
        }
        return new Intl.NumberFormat(undefined, {
            style: 'percent',
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
        }).format(Number(value));
    }

    function monthName(year, month, style) {
        return new Intl.DateTimeFormat(undefined, { month: style || 'long', year: 'numeric' })
            .format(new Date(year, month - 1, 1));
    }

    function comparisonClass(value) {
        if (value === null || value === undefined || Number(value) === 0) {
            return 'neutral';
        }
        return Number(value) > 0 ? 'unfavourable' : 'favourable';
    }

    function setText(id, value) {
        byId(id).textContent = value;
    }

    function setLoading(isLoading) {
        byId('loadingState').hidden = !isLoading;
        byId('dashboardContent').setAttribute('aria-busy', isLoading ? 'true' : 'false');
        byId('dashboardFilters').classList.toggle('is-loading', isLoading);
        byId('kpiAverageShareCard').disabled = isLoading;
    }

    function showError(message) {
        var error = byId('errorMessage');
        error.textContent = message;
        error.hidden = !message;
    }

    function destroyChart(key) {
        if (charts[key]) {
            charts[key].destroy();
            delete charts[key];
        }
    }

    function destroyCategoryCharts() {
        Object.keys(charts).forEach(function (key) {
            if (key.indexOf('category-') === 0) {
                destroyChart(key);
            }
        });
    }

    function chartCurrencyTooltip(context) {
        var label = context.dataset.label ? context.dataset.label + ': ' : '';
        return label + formatCurrency(context.parsed.y !== undefined ? context.parsed.y : context.raw);
    }

    function accountSpendTooltip(context) {
        var amount = Number(context.raw) || 0;
        if (context.dataset.isBudgetLine) {
            return 'Monthly budget: ' + formatCurrency(amount);
        }
        var stackTotal = context.chart.data.datasets.reduce(function (total, dataset) {
            if (
                dataset.stack !== context.dataset.stack
                || (!context.dataset.isSuspenseEstimate && dataset.isSuspenseEstimate)
            ) {
                return total;
            }
            return total + Math.abs(Number(dataset.data[context.dataIndex]) || 0);
        }, 0);
        var percentage = stackTotal ? Math.abs(amount) / stackTotal : 0;
        return (context.dataset.tooltipLabel || context.dataset.label) + ': ' + formatCurrency(amount) + ' (' +
            new Intl.NumberFormat(undefined, {
                style: 'percent',
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
            }).format(percentage) + ')';
    }

    function accountSpendTotalsTooltip(items) {
        var totals = [];
        var includedStacks = {};
        items.forEach(function (context) {
            if (context.dataset.isBudgetLine) {
                return;
            }
            var stack = context.dataset.stack;
            if (includedStacks[stack]) {
                return;
            }
            includedStacks[stack] = true;
            var postedTotal = context.chart.data.datasets.reduce(function (sum, dataset) {
                if (dataset.stack !== stack || dataset.isSuspenseEstimate) {
                    return sum;
                }
                return sum + (Number(dataset.data[context.dataIndex]) || 0);
            }, 0);
            var forecastAmount = context.chart.data.datasets.reduce(function (sum, dataset) {
                if (dataset.stack !== stack || !dataset.isSuspenseEstimate) {
                    return sum;
                }
                return sum + (Number(dataset.data[context.dataIndex]) || 0);
            }, 0);
            totals.push(
                String(context.dataset.year) + (forecastAmount ? ' posted total: ' : ' total: ') +
                    formatCurrency(postedTotal)
            );
            if (forecastAmount) {
                totals.push(
                    String(context.dataset.year) + ' estimated total: ' +
                        formatCurrency(postedTotal + forecastAmount)
                );
            }
        });
        return totals;
    }

    function drilldownUrl(year, month, spendKind) {
        var endpoint = new URL(config.endpoint, window.location.origin);
        endpoint.searchParams.set('action', 'drilldown');
        endpoint.searchParams.set('month', String(year) + '-' + String(month).padStart(2, '0'));
        endpoint.searchParams.set('department', selectedValues('departmentFilter').join(','));
        endpoint.searchParams.set('account', selectedValues('accountFilter').join(','));
        endpoint.searchParams.set('subsidiary', valueOf('subsidiaryFilter'));
        endpoint.searchParams.set('spendKind', spendKind);
        return endpoint.toString();
    }

    function contributorDrilldownUrl(kind, contributorName) {
        var endpoint = new URL(config.endpoint, window.location.origin);
        endpoint.searchParams.set('action', 'contributor');
        endpoint.searchParams.set('month', valueOf('monthFilter'));
        endpoint.searchParams.set('department', selectedValues('departmentFilter').join(','));
        endpoint.searchParams.set('account', selectedValues('accountFilter').join(','));
        endpoint.searchParams.set('subsidiary', valueOf('subsidiaryFilter'));
        endpoint.searchParams.set('breakdownPeriod', currentBreakdownPeriodMode);
        endpoint.searchParams.set('contributorKind', kind);
        endpoint.searchParams.set('contributorName', contributorName);
        if (currentBreakdownPeriodMode === 'custom') {
            endpoint.searchParams.set('startDate', valueOf('breakdownStartDate'));
            endpoint.searchParams.set('endDate', valueOf('breakdownEndDate'));
        }
        return endpoint.toString();
    }

    function accountBreakdownUrl() {
        var endpoint = new URL(config.endpoint, window.location.origin);
        endpoint.searchParams.set('action', 'breakdown');
        endpoint.searchParams.set('month', valueOf('monthFilter'));
        endpoint.searchParams.set('department', selectedValues('departmentFilter').join(','));
        endpoint.searchParams.set('account', selectedValues('accountFilter').join(','));
        endpoint.searchParams.set('subsidiary', valueOf('subsidiaryFilter'));
        endpoint.searchParams.set('breakdownPeriod', currentBreakdownPeriodMode);
        if (currentBreakdownPeriodMode === 'custom') {
            endpoint.searchParams.set('startDate', valueOf('breakdownStartDate'));
            endpoint.searchParams.set('endDate', valueOf('breakdownEndDate'));
        }
        return endpoint.toString();
    }

    function suspenseEstimateUrl() {
        var endpoint = new URL(config.endpoint, window.location.origin);
        endpoint.searchParams.set('action', 'suspenseestimate');
        endpoint.searchParams.set('month', valueOf('monthFilter'));
        endpoint.searchParams.set('department', selectedValues('departmentFilter').join(','));
        endpoint.searchParams.set('account', selectedValues('accountFilter').join(','));
        endpoint.searchParams.set('subsidiary', valueOf('subsidiaryFilter'));
        return endpoint.toString();
    }

    function isoDate(year, month, day) {
        return String(year) + '-' + String(month).padStart(2, '0') + '-' +
            String(day).padStart(2, '0');
    }

    function reportingMonthParts() {
        var parts = valueOf('monthFilter').split('-');
        return {
            year: Number(parts[0]),
            month: Number(parts[1])
        };
    }

    function breakdownPresetDates(mode) {
        var reportingMonth = reportingMonthParts();
        var year = mode === 'lastyear'
            ? reportingMonth.year - 1
            : reportingMonth.year;
        if (mode === 'ytd') {
            return {
                startDate: isoDate(year, 1, 1),
                endDate: isoDate(year, reportingMonth.month, new Date(year, reportingMonth.month, 0).getDate())
            };
        }
        return {
            startDate: isoDate(year, 1, 1),
            endDate: isoDate(year, 12, 31)
        };
    }

    function setBreakdownPeriodButtonState(mode) {
        Array.prototype.forEach.call(
            document.querySelectorAll('[data-breakdown-period]'),
            function (button) {
                var isActive = button.dataset.breakdownPeriod === mode;
                button.classList.toggle('is-active', isActive);
                button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            }
        );
    }

    function syncBreakdownPresetDates(mode) {
        if (mode === 'custom') {
            return;
        }
        var dates = breakdownPresetDates(mode);
        byId('breakdownStartDate').value = dates.startDate;
        byId('breakdownEndDate').value = dates.endDate;
    }

    function selectBreakdownPeriod(mode) {
        currentBreakdownPeriodMode = mode;
        syncBreakdownPresetDates(mode);
        setBreakdownPeriodButtonState(mode);
        byId('breakdownStartDate').removeAttribute('aria-invalid');
        byId('breakdownEndDate').removeAttribute('aria-invalid');
        if (currentBreakdownAccountName) {
            loadAccountBreakdown(currentBreakdownAccountName);
        }
    }

    function applyCustomBreakdownDates() {
        var startDate = valueOf('breakdownStartDate');
        var endDate = valueOf('breakdownEndDate');
        currentBreakdownPeriodMode = 'custom';
        setBreakdownPeriodButtonState('custom');
        if (!startDate || !endDate) {
            return;
        }
        var datesInvalid = startDate > endDate;
        byId('breakdownStartDate').setAttribute('aria-invalid', datesInvalid ? 'true' : 'false');
        byId('breakdownEndDate').setAttribute('aria-invalid', datesInvalid ? 'true' : 'false');
        if (datesInvalid) {
            var banner = byId('accountBreakdownError');
            banner.textContent = 'The From date must be on or before the To date.';
            banner.hidden = false;
            return;
        }
        if (currentBreakdownAccountName) {
            loadAccountBreakdown(currentBreakdownAccountName);
        }
    }

    function accountTimeUrl() {
        var endpoint = new URL(config.endpoint, window.location.origin);
        endpoint.searchParams.set('action', 'accounttrend');
        endpoint.searchParams.set('month', valueOf('monthFilter'));
        endpoint.searchParams.set('department', selectedValues('departmentFilter').join(','));
        endpoint.searchParams.set('account', selectedValues('accountFilter').join(','));
        endpoint.searchParams.set('subsidiary', valueOf('subsidiaryFilter'));
        endpoint.searchParams.set('breakdownPeriod', currentAccountTimePeriodMode);
        if (currentAccountTimePeriodMode === 'lastyears') {
            endpoint.searchParams.set('periodYears', valueOf('accountTimeYears'));
        }
        if (currentAccountTimePeriodMode === 'custom') {
            endpoint.searchParams.set('startDate', valueOf('accountTimeStartDate'));
            endpoint.searchParams.set('endDate', valueOf('accountTimeEndDate'));
        }
        return endpoint.toString();
    }

    function setAccountTimePeriodButtonState(mode) {
        Array.prototype.forEach.call(
            document.querySelectorAll('[data-account-time-period]'),
            function (button) {
                var isActive = button.dataset.accountTimePeriod === mode;
                button.classList.toggle('is-active', isActive);
                button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            }
        );
    }

    function syncAccountTimePresetDates(mode) {
        if (mode === 'custom') {
            return;
        }
        if (mode === 'lastyears') {
            var reportingMonth = reportingMonthParts();
            var years = Math.max(1, Math.min(5, Number(valueOf('accountTimeYears')) || 1));
            byId('accountTimeStartDate').value = isoDate(
                reportingMonth.year - years + 1,
                1,
                1
            );
            byId('accountTimeEndDate').value = isoDate(
                reportingMonth.year,
                reportingMonth.month,
                new Date(reportingMonth.year, reportingMonth.month, 0).getDate()
            );
            return;
        }
        var dates = breakdownPresetDates(mode);
        byId('accountTimeStartDate').value = dates.startDate;
        byId('accountTimeEndDate').value = dates.endDate;
    }

    function selectAccountTimePeriod(mode) {
        currentAccountTimePeriodMode = mode;
        byId('accountTimeYears').value = '';
        syncAccountTimePresetDates(mode);
        setAccountTimePeriodButtonState(mode);
        byId('accountTimeStartDate').removeAttribute('aria-invalid');
        byId('accountTimeEndDate').removeAttribute('aria-invalid');
        if (currentAccountTimeAccountName) {
            loadAccountSpendOverTime(currentAccountTimeAccountName);
        }
    }

    function selectAccountTimeYears() {
        var years = valueOf('accountTimeYears');
        if (!years) {
            selectAccountTimePeriod('ytd');
            return;
        }
        currentAccountTimePeriodMode = 'lastyears';
        syncAccountTimePresetDates('lastyears');
        setAccountTimePeriodButtonState('lastyears');
        byId('accountTimeStartDate').removeAttribute('aria-invalid');
        byId('accountTimeEndDate').removeAttribute('aria-invalid');
        if (currentAccountTimeAccountName) {
            loadAccountSpendOverTime(currentAccountTimeAccountName);
        }
    }

    function applyCustomAccountTimeDates() {
        var startDate = valueOf('accountTimeStartDate');
        var endDate = valueOf('accountTimeEndDate');
        currentAccountTimePeriodMode = 'custom';
        byId('accountTimeYears').value = '';
        setAccountTimePeriodButtonState('custom');
        if (!startDate || !endDate) {
            return;
        }
        var datesInvalid = startDate > endDate;
        byId('accountTimeStartDate').setAttribute('aria-invalid', datesInvalid ? 'true' : 'false');
        byId('accountTimeEndDate').setAttribute('aria-invalid', datesInvalid ? 'true' : 'false');
        if (datesInvalid) {
            var banner = byId('accountTimeError');
            banner.textContent = 'The From date must be on or before the To date.';
            banner.hidden = false;
            return;
        }
        if (currentAccountTimeAccountName) {
            loadAccountSpendOverTime(currentAccountTimeAccountName);
        }
    }

    function shareTrendUrl() {
        var endpoint = new URL(config.endpoint, window.location.origin);
        endpoint.searchParams.set('action', 'sharetrend');
        endpoint.searchParams.set('month', valueOf('monthFilter'));
        endpoint.searchParams.set('department', selectedValues('departmentFilter').join(','));
        endpoint.searchParams.set('account', selectedValues('accountFilter').join(','));
        endpoint.searchParams.set('subsidiary', valueOf('subsidiaryFilter'));
        endpoint.searchParams.set('shareDepartment', config.shareDepartmentId || '');
        endpoint.searchParams.set('breakdownPeriod', currentShareTrendPeriodMode);
        if (currentShareTrendPeriodMode === 'custom') {
            endpoint.searchParams.set('startDate', valueOf('shareStartDate'));
            endpoint.searchParams.set('endDate', valueOf('shareEndDate'));
        }
        return endpoint.toString();
    }

    function setShareTrendPeriodButtonState(mode) {
        Array.prototype.forEach.call(
            document.querySelectorAll('[data-share-period]'),
            function (button) {
                var isActive = button.dataset.sharePeriod === mode;
                button.classList.toggle('is-active', isActive);
                button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            }
        );
    }

    function syncShareTrendPresetDates(mode) {
        if (mode === 'custom') {
            return;
        }
        var dates = breakdownPresetDates(mode);
        byId('shareStartDate').value = dates.startDate;
        byId('shareEndDate').value = dates.endDate;
    }

    function selectShareTrendPeriod(mode) {
        currentShareTrendPeriodMode = mode;
        syncShareTrendPresetDates(mode);
        setShareTrendPeriodButtonState(mode);
        byId('shareStartDate').removeAttribute('aria-invalid');
        byId('shareEndDate').removeAttribute('aria-invalid');
        if (!byId('shareTrendModal').hidden) {
            loadShareTrend();
        }
    }

    function applyCustomShareTrendDates() {
        var startDate = valueOf('shareStartDate');
        var endDate = valueOf('shareEndDate');
        currentShareTrendPeriodMode = 'custom';
        setShareTrendPeriodButtonState('custom');
        if (!startDate || !endDate) {
            return;
        }
        var datesInvalid = startDate > endDate;
        byId('shareStartDate').setAttribute('aria-invalid', datesInvalid ? 'true' : 'false');
        byId('shareEndDate').setAttribute('aria-invalid', datesInvalid ? 'true' : 'false');
        if (datesInvalid) {
            var banner = byId('shareTrendError');
            banner.textContent = 'The From date must be on or before the To date.';
            banner.hidden = false;
            return;
        }
        if (!byId('shareTrendModal').hidden) {
            loadShareTrend();
        }
    }

    function syncModalOpenState() {
        var spendOpen = !byId('spendDrilldownModal').hidden;
        var remainderOpen = !byId('breakdownRemainderModal').hidden;
        var shareTrendOpen = !byId('shareTrendModal').hidden;
        document.body.classList.toggle('modal-open', spendOpen || remainderOpen || shareTrendOpen);
    }

    function closeSpendDrilldown() {
        drilldownRequestId += 1;
        byId('spendDrilldownModal').hidden = true;
        syncModalOpenState();
    }

    function setSpendDrilldownMode(mode) {
        var isSuspense = mode === 'suspense';
        currentDrilldownMode = isSuspense ? 'suspense' : 'actual';
        setText('spendDrilldownKicker', isSuspense ? 'Suspense forecast' : 'Actual spend');
        setText('spendAccountHeader', isSuspense ? 'Suspense account' : 'Expense account');
        setText('spendAmountHeader', isSuspense ? 'Suspense amount' : 'Amount');
        byId('spendEstimatedHeader').hidden = !isSuspense;
    }

    function renderSpendDrilldownRows(rows) {
        var body = byId('spendDrilldownBody');
        body.replaceChildren();
        rows.forEach(function (item) {
            var row = document.createElement('tr');
            appendCell(row, item.date);
            appendCell(row, item.transactionNumber, 'transaction-number');
            appendCell(row, item.type);
            appendCell(row, item.payee);
            appendCell(row, item.creditCardUser || '—');
            appendCell(row, item.account);
            appendCell(row, formatCurrency(item.amount), 'numeric');
            if (currentDrilldownMode === 'suspense') {
                appendCell(row, formatCurrency(item.estimatedAmount), 'numeric suspense-estimated-cell');
            }
            body.appendChild(row);
        });
        if (!rows.length) {
            var emptyRow = document.createElement('tr');
            var emptyCell = document.createElement('td');
            emptyCell.colSpan = currentDrilldownMode === 'suspense' ? 8 : 7;
            emptyCell.className = 'empty-state';
            emptyCell.textContent = currentDrilldownMode === 'suspense'
                ? 'No suspended expense lines were found for this reporting month.'
                : 'No posted expense lines matched this selection and the current filters.';
            emptyRow.appendChild(emptyCell);
            body.appendChild(emptyRow);
        }
    }

    function setSpendDrilldownSort(sortMode) {
        var amountButton = byId('sortSpendByAmount');
        var dateButton = byId('sortSpendByDate');
        var sortedRows = currentDrilldownRows.slice();
        var isDateSort = sortMode === 'date';

        sortedRows.sort(function (left, right) {
            if (isDateSort) {
                var dateDifference = String(right.date).localeCompare(String(left.date));
                return dateDifference || (Number(right.amount) - Number(left.amount));
            }
            var amountDifference = Number(right.amount) - Number(left.amount);
            return amountDifference || String(right.date).localeCompare(String(left.date));
        });
        amountButton.classList.toggle('is-active', !isDateSort);
        amountButton.setAttribute('aria-pressed', isDateSort ? 'false' : 'true');
        dateButton.classList.toggle('is-active', isDateSort);
        dateButton.setAttribute('aria-pressed', isDateSort ? 'true' : 'false');
        renderSpendDrilldownRows(sortedRows);
        setText(
            'spendDrilldownMeta',
            currentDrilldownMeta + (isDateSort ? ' · newest date first' : ' · highest amount first')
        );
        byId('spendDrilldownModal').querySelector('.modal-table-scroll').scrollTop = 0;
    }

    function openSpendDrilldown(year, month, spendKind, chartAmount) {
        var requestId = ++drilldownRequestId;
        var modal = byId('spendDrilldownModal');
        var kindLabel = spendKind === 'all'
            ? 'All spend'
            : spendKind === 'creditcard'
                ? 'Credit-card spend'
                : 'Other spend';
        setSpendDrilldownMode('actual');
        setText('spendDrilldownTitle', kindLabel + ' — ' + monthName(year, month));
        setText('spendDrilldownMeta', formatCurrency(chartAmount) + ' represented by the selected bar segment.');
        byId('spendDrilldownLoading').hidden = false;
        byId('spendDrilldownError').hidden = true;
        byId('spendDrilldownError').textContent = '';
        byId('spendDrilldownBody').replaceChildren();
        currentDrilldownRows = [];
        currentDrilldownMeta = '';
        byId('sortSpendByAmount').disabled = true;
        byId('sortSpendByDate').disabled = true;
        modal.hidden = false;
        document.body.classList.add('modal-open');
        byId('closeSpendDrilldown').focus();

        fetch(drilldownUrl(year, month, spendKind), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        })
            .then(function (response) {
                return response.json().then(function (payload) {
                    if (!response.ok || !payload.ok) {
                        var message = payload && payload.error && payload.error.message;
                        throw new Error(message || 'The transaction drill-down request failed.');
                    }
                    return payload.data;
                });
            })
            .then(function (data) {
                var rows = data.rows || [];
                if (requestId !== drilldownRequestId) {
                    return;
                }
                currentDrilldownRows = rows;
                currentDrilldownMeta = formatCurrency(chartAmount) + ' total · ' + rows.length + ' expense lines';
                byId('sortSpendByAmount').disabled = false;
                byId('sortSpendByDate').disabled = false;
                setSpendDrilldownSort('amount');
            })
            .catch(function (error) {
                if (requestId !== drilldownRequestId) {
                    return;
                }
                byId('spendDrilldownError').textContent = error.message || String(error);
                byId('spendDrilldownError').hidden = false;
            })
            .finally(function () {
                if (requestId === drilldownRequestId) {
                    byId('spendDrilldownLoading').hidden = true;
                }
            });
    }

    function openSuspenseDrilldown() {
        var data = currentSuspenseEstimate;
        if (!data || !data.available) {
            return;
        }
        drilldownRequestId += 1;
        closeBreakdownRemainder();
        setSpendDrilldownMode('suspense');
        setText(
            'spendDrilldownTitle',
            'Credit-card suspense — ' + monthName(data.filters.reportYear, data.filters.reportMonth)
        );
        byId('spendDrilldownLoading').hidden = true;
        byId('spendDrilldownError').hidden = true;
        byId('spendDrilldownError').textContent = '';
        currentDrilldownRows = (data.rows || []).slice();
        currentDrilldownMeta = formatCurrency(data.estimatedSuspense) +
            ' estimated for ' + selectedAccountName() + ' from ' + formatCurrency(data.suspenseAmount) +
            ' in suspense · ' + currentDrilldownRows.length + ' suspended expense lines';
        byId('sortSpendByAmount').disabled = false;
        byId('sortSpendByDate').disabled = false;
        byId('spendDrilldownModal').hidden = false;
        syncModalOpenState();
        setSpendDrilldownSort('amount');
        byId('closeSpendDrilldown').focus();
    }

    function openContributorDrilldown(kind, item) {
        var requestId = ++drilldownRequestId;
        var modal = byId('spendDrilldownModal');
        var kindLabel = kind === 'creditCard'
            ? 'credit-card transactions'
            : 'payee transactions';
        closeBreakdownRemainder();
        setSpendDrilldownMode('actual');
        setText('spendDrilldownTitle', item.name + ' — ' + kindLabel);
        setText(
            'spendDrilldownMeta',
            formatCurrency(item.amount) + ' contributor spend · ' + currentBreakdownPeriod
        );
        byId('spendDrilldownLoading').hidden = false;
        byId('spendDrilldownError').hidden = true;
        byId('spendDrilldownError').textContent = '';
        byId('spendDrilldownBody').replaceChildren();
        currentDrilldownRows = [];
        currentDrilldownMeta = '';
        byId('sortSpendByAmount').disabled = true;
        byId('sortSpendByDate').disabled = true;
        modal.hidden = false;
        syncModalOpenState();
        byId('closeSpendDrilldown').focus();

        fetch(contributorDrilldownUrl(kind, item.name), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        })
            .then(function (response) {
                return response.json().then(function (payload) {
                    if (!response.ok || !payload.ok) {
                        var message = payload && payload.error && payload.error.message;
                        throw new Error(message || 'The contributor transaction request failed.');
                    }
                    return payload.data;
                });
            })
            .then(function (data) {
                if (requestId !== drilldownRequestId) {
                    return;
                }
                var rows = data.rows || [];
                currentDrilldownRows = rows;
                currentDrilldownMeta = formatCurrency(data.total) + ' total · ' +
                    rows.length + ' expense lines · ' + breakdownPeriodLabel(data);
                byId('sortSpendByAmount').disabled = false;
                byId('sortSpendByDate').disabled = false;
                setSpendDrilldownSort('amount');
            })
            .catch(function (error) {
                if (requestId !== drilldownRequestId) {
                    return;
                }
                byId('spendDrilldownError').textContent = error.message || String(error);
                byId('spendDrilldownError').hidden = false;
            })
            .finally(function () {
                if (requestId === drilldownRequestId) {
                    byId('spendDrilldownLoading').hidden = true;
                }
            });
    }

    function configureChartDefaults() {
        if (!window.Chart) {
            throw new Error('Chart.js did not load. Check whether your network permits cdn.jsdelivr.net.');
        }
        Chart.defaults.color = '#475569';
        Chart.defaults.font.family = 'Aptos, Segoe UI, Arial, sans-serif';
        Chart.defaults.borderColor = '#D9E2F3';
    }

    function renderKpis(data) {
        var filters = data.filters;
        var kpis = data.kpis;
        var accountLabels = selectedAccountLabels();
        var reportingMonth = monthName(filters.reportYear, filters.reportMonth);
        var reportingMonthOnly = new Intl.DateTimeFormat(undefined, { month: 'long' })
            .format(new Date(filters.reportYear, filters.reportMonth - 1, 1));

        setText('kpiAccountScope', 'Combined expense accounts: ' + accountLabels.join(' + '));
        byId('kpiAccountScope').hidden = accountLabels.length < 2;

        setText('reportSubtitle', 'Posted expense activity through ' + reportingMonth + '. Charts update as filters change.');
        setText('kpiMonthLabel', reportingMonthOnly + ' this year total');
        setText('kpiCurrentMonth', formatCurrency(kpis.currentMonth));
        setText('kpiCurrentMonthMeta', formatPercent(
            kpis.sameMonthPriorYear ? (kpis.currentMonth - kpis.sameMonthPriorYear) / Math.abs(kpis.sameMonthPriorYear) : null
        ) + ' vs ' + reportingMonthOnly + ' last year');

        setText('kpiPriorMonthLabel', reportingMonthOnly + ' last year total');
        setText('kpiPriorMonth', formatCurrency(kpis.sameMonthPriorYear));
        setText('kpiPriorMonthMeta', 'Same reporting month last year');

        setText('kpiAverageSpend', formatCurrency(kpis.averageSpend));
        setText('kpiAverageSpendMeta', 'Last year - months with data only');

        setText('kpiShareOfMonth', formatSharePercent(kpis.shareOfMonth));
        setText(
            'kpiShareOfMonthMeta',
            filters.accountIds && filters.accountIds.length
                ? 'Of all ' + (config.shareDepartmentName || 'Community : General') + ' expenses this month'
                : 'All ' + (config.shareDepartmentName || 'Community : General') + ' expenses this month'
        );

        setText('kpiAverageShare', formatSharePercent(kpis.averageShareOfMonth));
        setText(
            'kpiAverageShareMeta',
            'YTD average of months with data within ' + (config.shareDepartmentName || 'Community : General') + ' · click for trend'
        );

        setText('kpiYtdLabel', 'This year YTD');
        setText('kpiYtd', formatCurrency(kpis.currentYtd));
        setText('kpiYtdMeta', 'January through ' + reportingMonthOnly);

        setText('kpiPriorYtdLabel', 'Last year YTD');
        setText('kpiPriorYtd', formatCurrency(kpis.priorYtd));
        setText('kpiPriorYtdMeta', 'Same period last year');

        setText('kpiChange', formatPercent(kpis.ytdChange));
        setText('kpiChangeMeta', 'This year YTD compared with last year');
        byId('kpiChangeCard').classList.remove('favourable', 'unfavourable', 'neutral');
        byId('kpiChangeCard').classList.add(comparisonClass(kpis.ytdChange));

        setText('averageMonthlyYtd', formatCurrency(kpis.averageMonthlyYtd));
        setText('lastFullYear', formatCurrency(kpis.lastFullYear));
        setText('fullYearChange', formatPercent(kpis.fullYearChange));
        setText('categoryCount', String(data.meta.categoryCount));
    }

    function renderMonthlyTrend(data) {
        destroyChart('monthly');
        var datasets = data.monthlyTrend.datasets.map(function (dataset, index) {
            return {
                label: dataset.label,
                data: dataset.values,
                backgroundColor: palette[index % palette.length],
                borderColor: '#FFFFFF',
                borderWidth: 0.5,
                borderSkipped: false,
                maxBarThickness: 26
            };
        });
        charts.monthly = new Chart(byId('monthlyTrendChart'), {
            type: 'bar',
            data: { labels: data.monthlyTrend.labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                animation: { duration: 250 },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, padding: 16 }
                    },
                    tooltip: { callbacks: { label: chartCurrencyTooltip } }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { autoSkip: true, maxTicksLimit: 18, maxRotation: 0 }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: { callback: function (value) { return formatCurrency(value); } }
                    }
                }
            }
        });
        var startYear = data.filters.reportYear - data.filters.comparisonYears + 1;
        setText('monthlyTrendTitle', 'Monthly spending by ' + (data.filters.groupBy === 'department' ? 'department' : 'expense account'));
        setText('monthlyTrendMeta', startYear + ' to ' + data.filters.reportYear + ', stacked by category');
    }

    function renderSpendMix(data) {
        destroyChart('mix');
        var visible = data.spendMix.filter(function (item) { return Number(item.value) !== 0; });
        charts.mix = new Chart(byId('spendMixChart'), {
            type: 'doughnut',
            data: {
                labels: visible.map(function (item) { return item.label; }),
                datasets: [{
                    data: visible.map(function (item) { return Math.abs(Number(item.value)); }),
                    backgroundColor: visible.map(function (_, index) { return palette[index % palette.length]; }),
                    borderColor: '#FFFFFF',
                    borderWidth: 2,
                    hoverOffset: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '64%',
                animation: { duration: 250 },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 11, usePointStyle: true, padding: 14 }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                var signedValue = visible[context.dataIndex].value;
                                return context.label + ': ' + formatCurrency(signedValue);
                            }
                        }
                    }
                }
            }
        });
    }

    function selectedAccountLabels() {
        var select = byId('accountFilter');
        return Array.prototype.filter.call(select.selectedOptions || [], function (option) {
            return Boolean(option.value);
        }).map(function (option) {
            return option.textContent;
        });
    }

    function selectedAccountName() {
        var labels = selectedAccountLabels();
        if (!labels.length) {
            return 'All expense accounts';
        }
        if (labels.length === 1) {
            return labels[0];
        }
        return labels.join(' + ');
    }

    function lightenChartColor(hex, amount) {
        var value = String(hex || '#17365D').replace('#', '');
        var red = parseInt(value.slice(0, 2), 16);
        var green = parseInt(value.slice(2, 4), 16);
        var blue = parseInt(value.slice(4, 6), 16);
        return 'rgb(' + [red, green, blue].map(function (channel) {
            return Math.round(channel + (255 - channel) * amount);
        }).join(', ') + ')';
    }

    function accountComparisonDatasets(analysis) {
        var multipleAccounts = selectedAccountLabels().length > 1;
        var accountIndexes = {};
        (analysis.accounts || []).forEach(function (account, index) {
            accountIndexes[String(account.id)] = index;
        });
        return analysis.datasets.reduce(function (datasets, yearDataset, yearIndex) {
            var year = Number(yearDataset.label);
            var stack = 'year-' + yearDataset.label;
            var accounts = multipleAccounts ? (yearDataset.accounts || []) : [{
                id: analysis.id,
                name: analysis.name,
                creditCardValues: yearDataset.creditCardValues,
                otherValues: yearDataset.otherValues
            }];
            accounts.forEach(function (account) {
                var accountIndex = accountIndexes[String(account.id)] || 0;
                var yearColorIndex = Math.max(0, yearPalette.length - analysis.datasets.length + yearIndex);
                var darkColor = multipleAccounts
                    ? accountPalette[accountIndex % accountPalette.length]
                    : yearPalette[yearColorIndex];
                var lightColor = multipleAccounts
                    ? lightenChartColor(darkColor, 0.58)
                    : yearPaletteLight[yearColorIndex];
                var creditLabel = multipleAccounts
                    ? account.name + ' — Credit card'
                    : yearDataset.label + ' — Credit card';
                var otherLabel = multipleAccounts
                    ? account.name + ' — Other spend'
                    : yearDataset.label + ' — Other spend';
                datasets.push({
                    label: creditLabel,
                    tooltipLabel: yearDataset.label + ' — ' + account.name + ' — Credit card',
                    legendKey: (multipleAccounts ? String(account.id) : String(year)) + ':creditcard',
                    data: account.creditCardValues,
                    year: year,
                    accountId: String(account.id),
                    spendKind: 'creditcard',
                    backgroundColor: darkColor,
                    borderColor: darkColor,
                    borderWidth: 0,
                    borderRadius: 2,
                    grouped: true,
                    stack: stack,
                    categoryPercentage: 0.52,
                    barPercentage: 1
                });
                datasets.push({
                    label: otherLabel,
                    tooltipLabel: yearDataset.label + ' — ' + account.name + ' — Other spend',
                    legendKey: (multipleAccounts ? String(account.id) : String(year)) + ':other',
                    data: account.otherValues,
                    year: year,
                    accountId: String(account.id),
                    spendKind: 'other',
                    backgroundColor: lightColor,
                    borderColor: lightColor,
                    borderWidth: 0,
                    borderRadius: 2,
                    grouped: true,
                    stack: stack,
                    categoryPercentage: 0.52,
                    barPercentage: 1
                });
            });
            return datasets;
        }, []);
    }

    function accountBudgetDataset(analysis) {
        var budget = analysis.budget;
        if (!budget || !budget.available) {
            return null;
        }
        var values = (budget.monthlyValues || []).map(function (value) {
            return value === null || value === undefined ? null : Number(value) || 0;
        });
        if (!values.some(function (value) { return value !== null; })) {
            return null;
        }
        return {
            type: 'line',
            label: 'Monthly budget',
            legendKey: 'monthly-budget',
            data: values,
            year: analysis.datasets.length
                ? Number(analysis.datasets[analysis.datasets.length - 1].label)
                : null,
            isBudgetLine: true,
            borderColor: '#C68A00',
            backgroundColor: '#C68A00',
            borderWidth: 3,
            borderDash: [9, 6],
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#FFF8E1',
            pointBorderColor: '#C68A00',
            pointBorderWidth: 2,
            fill: false,
            tension: 0,
            spanGaps: false,
            stack: 'budget-line',
            order: -10
        };
    }

    function renderAccountSpendOverTime(data, accountName) {
        var years = [];
        (data.series || []).forEach(function (item) {
            if (years.indexOf(Number(item.year)) === -1) {
                years.push(Number(item.year));
            }
        });
        var monthlyPoints = (data.series || []).map(function (item) {
            var yearIndex = years.indexOf(Number(item.year));
            return {
                year: Number(item.year),
                month: Number(item.month),
                label: monthName(Number(item.year), Number(item.month), 'short'),
                amount: Number(item.amount) || 0,
                hasData: Boolean(item.hasData),
                color: yearPalette[yearIndex % yearPalette.length]
            };
        });
        var values = monthlyPoints.map(function (item) { return item.amount; });
        var average = Number(data.average) || 0;
        var activeYears = (data.years || []).slice().sort(function (left, right) {
            return Number(left.year) - Number(right.year);
        });
        var firstActiveYear = activeYears.length ? activeYears[0] : null;
        var latestYear = activeYears.length ? activeYears[activeYears.length - 1] : null;
        var periodChange = data.change === null || data.change === undefined
            ? null
            : Number(data.change);
        var hasTrend = Boolean(
            firstActiveYear && latestYear && firstActiveYear.year !== latestYear.year
        );
        var trendLabel = 'Comparable-period average trend';
        var trendValues = monthlyPoints.map(function () { return null; });
        if (hasTrend) {
            var firstTrendIndex = monthlyPoints.findIndex(function (item) {
                return item.year === Number(firstActiveYear.year);
            });
            var lastTrendIndex = -1;
            monthlyPoints.forEach(function (item, index) {
                if (item.year === Number(latestYear.year)) {
                    lastTrendIndex = index;
                }
            });
            var trendDistance = lastTrendIndex - firstTrendIndex;
            trendValues = monthlyPoints.map(function (_, index) {
                if (index < firstTrendIndex || index > lastTrendIndex) {
                    return null;
                }
                var progress = trendDistance ? (index - firstTrendIndex) / trendDistance : 0;
                return firstActiveYear.average + (
                    (latestYear.average - firstActiveYear.average) * progress
                );
            });
        } else {
            var activeTrendPoints = [];
            monthlyPoints.forEach(function (item, index) {
                if (item.hasData) {
                    activeTrendPoints.push({ x: index, y: item.amount });
                }
            });
            hasTrend = activeTrendPoints.length >= 2;
            trendLabel = 'Monthly spend trend';
            if (hasTrend) {
                var trendCount = activeTrendPoints.length;
                var trendSumX = activeTrendPoints.reduce(function (total, item) { return total + item.x; }, 0);
                var trendSumY = activeTrendPoints.reduce(function (total, item) { return total + item.y; }, 0);
                var trendSumXY = activeTrendPoints.reduce(function (total, item) { return total + (item.x * item.y); }, 0);
                var trendSumXX = activeTrendPoints.reduce(function (total, item) { return total + (item.x * item.x); }, 0);
                var trendDenominator = (trendCount * trendSumXX) - (trendSumX * trendSumX);
                var trendSlope = trendDenominator
                    ? ((trendCount * trendSumXY) - (trendSumX * trendSumY)) / trendDenominator
                    : 0;
                var trendIntercept = (trendSumY - (trendSlope * trendSumX)) / trendCount;
                var activeTrendStart = activeTrendPoints[0].x;
                var activeTrendEnd = activeTrendPoints[activeTrendPoints.length - 1].x;
                trendValues = monthlyPoints.map(function (_, index) {
                    return index >= activeTrendStart && index <= activeTrendEnd
                        ? trendIntercept + (trendSlope * index)
                        : null;
                });
            }
        }
        var firstTrendValue = null;
        var lastTrendValue = null;
        trendValues.forEach(function (value) {
            if (value === null || value === undefined || !Number.isFinite(Number(value))) {
                return;
            }
            if (firstTrendValue === null) {
                firstTrendValue = Number(value);
            }
            lastTrendValue = Number(value);
        });
        var fittedTrendChange = firstTrendValue
            ? (lastTrendValue - firstTrendValue) / Math.abs(firstTrendValue)
            : null;
        var displayedTrendChange = periodChange !== null ? periodChange : fittedTrendChange;

        byId('accountSpendOverTimeSection').hidden = false;
        setText('accountSpendOverTimeTitle', accountName + ' — spend over time');
        setText(
            'accountSpendOverTimeMeta',
            breakdownPeriodLabel(data) + ' · months without data excluded from averages' +
                (hasTrend ? ' · solid purple line shows the spend trend' : '')
        );
        setText('accountTimeAverage', formatCurrency(average));
        setText('accountTimeChange', formatPercent(displayedTrendChange));
        setText(
            'accountTimeChangeMeta',
            periodChange !== null
                ? String(firstActiveYear.year) + ' monthly average to ' + String(latestYear.year) + ' monthly average'
                : fittedTrendChange !== null
                    ? 'Fitted trend from the first to last active month'
                : activeYears.length >= 2
                    ? 'The earlier average is zero'
                    : 'At least two active years are needed for a percentage'
        );
        byId('accountTimeChangeStat').classList.remove('favourable', 'unfavourable', 'neutral');
        byId('accountTimeChangeStat').classList.add(comparisonClass(displayedTrendChange));

        destroyChart('account-spend-over-time');
        var spendOverTimeDatasets = [{
            type: 'bar',
            label: 'Monthly spend',
            data: values,
            backgroundColor: monthlyPoints.map(function (item) { return item.color; }),
            borderWidth: 0,
            borderRadius: 3,
            borderSkipped: false,
            maxBarThickness: 28,
            categoryPercentage: 0.84,
            barPercentage: 0.9,
            order: 1
        }, {
            type: 'line',
            label: 'Average monthly spend (months with data)',
            data: monthlyPoints.map(function () { return average; }),
            borderColor: '#ED7D31',
            backgroundColor: '#ED7D31',
            borderWidth: 3,
            borderDash: [7, 5],
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0,
            order: 0
        }];
        if (hasTrend) {
            spendOverTimeDatasets.push({
                type: 'line',
                label: trendLabel,
                data: trendValues,
                borderColor: '#7A3E9D',
                backgroundColor: '#7A3E9D',
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0,
                spanGaps: true,
                order: -1
            });
        }

        var trendEndLabelPlugin = {
            id: 'accountTrendEndLabel',
            afterDatasetsDraw: function (chart) {
                if (!hasTrend || displayedTrendChange === null) {
                    return;
                }
                var trendDatasetIndex = chart.data.datasets.findIndex(function (dataset) {
                    return dataset.label === trendLabel;
                });
                if (trendDatasetIndex < 0) {
                    return;
                }
                var trendDataset = chart.data.datasets[trendDatasetIndex];
                var endIndex = -1;
                trendDataset.data.forEach(function (value, index) {
                    if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
                        endIndex = index;
                    }
                });
                var endElement = chart.getDatasetMeta(trendDatasetIndex).data[endIndex];
                if (!endElement) {
                    return;
                }

                var direction = displayedTrendChange > 0
                    ? '\u2191 '
                    : displayedTrendChange < 0
                        ? '\u2193 '
                        : '\u2192 ';
                var label = direction + formatPercent(displayedTrendChange);
                var context = chart.ctx;
                var chartArea = chart.chartArea;
                var labelHeight = 38;
                var horizontalPadding = 13;
                context.save();
                context.font = '800 16px Aptos, "Segoe UI", sans-serif';
                var labelWidth = context.measureText(label).width + (horizontalPadding * 2);
                var labelX = Math.min(chartArea.right + 16, chart.width - labelWidth - 4);
                var labelY = endElement.y - (labelHeight / 2);
                labelY = Math.max(
                    chartArea.top + 4,
                    Math.min(chartArea.bottom - labelHeight - 4, labelY)
                );
                var connectorX = labelX;
                var connectorY = labelY + (labelHeight / 2);
                context.strokeStyle = '#7A3E9D';
                context.lineWidth = 2;
                context.beginPath();
                context.moveTo(endElement.x, endElement.y);
                context.lineTo(connectorX, connectorY);
                context.stroke();
                context.fillStyle = '#7A3E9D';
                context.beginPath();
                context.roundRect(labelX, labelY, labelWidth, labelHeight, 9);
                context.fill();
                context.fillStyle = '#FFFFFF';
                context.textAlign = 'left';
                context.textBaseline = 'middle';
                context.fillText(
                    label,
                    labelX + horizontalPadding,
                    labelY + (labelHeight / 2)
                );
                context.restore();
            }
        };

        charts['account-spend-over-time'] = new Chart(byId('accountSpendOverTimeChart'), {
            type: 'bar',
            plugins: [trendEndLabelPlugin],
            data: {
                labels: monthlyPoints.map(function (item) { return item.label; }),
                datasets: spendOverTimeDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 250 },
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { right: 145 } },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 11, usePointStyle: true, padding: 16 }
                    },
                    tooltip: {
                        callbacks: { label: chartCurrencyTooltip }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            autoSkip: true,
                            maxTicksLimit: 18,
                            maxRotation: 45,
                            minRotation: 0
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { callback: function (value) { return formatCurrency(value); } }
                    }
                }
            }
        });
        byId('accountTimeLoading').hidden = true;
        byId('accountTimeContent').hidden = false;
    }

    function loadAccountSpendOverTime(accountName) {
        var requestId = ++accountTimeRequestId;
        currentAccountTimeAccountName = accountName;
        byId('accountSpendOverTimeSection').hidden = false;
        syncAccountTimePresetDates(currentAccountTimePeriodMode);
        setAccountTimePeriodButtonState(currentAccountTimePeriodMode);
        setText('accountSpendOverTimeTitle', accountName + ' — spend over time');
        byId('accountTimeLoading').hidden = false;
        byId('accountTimeContent').hidden = true;
        byId('accountTimeError').hidden = true;

        fetch(accountTimeUrl(), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        })
            .then(function (response) {
                return response.json().then(function (payload) {
                    if (!response.ok || !payload.ok) {
                        var message = payload && payload.error && payload.error.message;
                        throw new Error(message || 'The spend-over-time request failed.');
                    }
                    return payload.data;
                });
            })
            .then(function (trendData) {
                if (requestId === accountTimeRequestId) {
                    renderAccountSpendOverTime(trendData, accountName);
                }
            })
            .catch(function (error) {
                if (requestId !== accountTimeRequestId) {
                    return;
                }
                var banner = byId('accountTimeError');
                banner.textContent = error.message || String(error);
                banner.hidden = false;
            })
            .finally(function () {
                if (requestId === accountTimeRequestId) {
                    byId('accountTimeLoading').hidden = true;
                }
            });
    }

    function renderSuspenseDrivers(containerId, items) {
        var container = byId(containerId);
        container.replaceChildren();
        (items || []).forEach(function (item) {
            var row = document.createElement('div');
            var heading = document.createElement('div');
            var name = document.createElement('strong');
            var estimate = document.createElement('span');
            var detail = document.createElement('small');
            var rate = item.historicalRate;

            row.className = 'suspense-driver-row';
            name.textContent = item.name || 'Unassigned';
            estimate.textContent = formatCurrency(item.estimatedAmount) + ' estimated';
            heading.appendChild(name);
            heading.appendChild(estimate);
            detail.textContent = formatCurrency(item.suspenseAmount) + ' currently in suspense · ' +
                (rate === null || rate === undefined
                    ? 'overall account rate used'
                    : formatSharePercent(rate) + ' historically allocated here');
            row.appendChild(heading);
            row.appendChild(detail);
            container.appendChild(row);
        });
        if (!(items || []).length) {
            var empty = document.createElement('p');
            empty.className = 'empty-state compact';
            empty.textContent = 'No current-month suspense drivers found.';
            container.appendChild(empty);
        }
    }

    function applySuspenseEstimateToAccountChart(data) {
        var chart = charts['account-comparison'];
        if (!chart) {
            return;
        }
        chart.data.datasets = chart.data.datasets.filter(function (dataset) {
            return !dataset.isSuspenseEstimate;
        });
        if (data && data.available && Number(data.estimatedSuspense)) {
            var values = Array(12).fill(null);
            var reportYear = Number(data.filters.reportYear);
            values[Number(data.filters.reportMonth) - 1] = Number(data.estimatedSuspense);
            chart.data.datasets.push({
                label: 'Estimated unallocated card suspense',
                tooltipLabel: 'Estimated unallocated card suspense',
                legendKey: 'suspense-estimate',
                data: values,
                year: reportYear,
                spendKind: 'forecast',
                isSuspenseEstimate: true,
                backgroundColor: 'rgba(122, 62, 157, 0.46)',
                borderColor: '#7A3E9D',
                borderWidth: 2,
                borderRadius: 2,
                grouped: true,
                stack: 'year-' + String(reportYear),
                categoryPercentage: 0.52,
                barPercentage: 1
            });
        }
        chart.update();
    }

    function renderAccountSuspenseEstimate(data) {
        var section = byId('accountSuspenseForecast');
        var error = byId('accountSuspenseError');
        currentSuspenseEstimate = data;
        section.hidden = false;
        error.hidden = true;
        error.textContent = '';

        if (!data.available) {
            byId('accountSuspenseContent').hidden = true;
            setText('accountSuspenseMeta', 'Forecast unavailable');
            error.textContent = 'No credit-card suspense account could be identified. The account name should include “Suspense” and a card identifier such as Credit Card, CCA, Visa or NAB.';
            error.hidden = false;
            applySuspenseEstimateToAccountChart(null);
            return;
        }

        setText('accountSuspenseActual', formatCurrency(data.actualCurrentMonth));
        setText('accountSuspenseTotal', formatCurrency(data.suspenseAmount));
        setText('accountSuspenseEstimate', formatCurrency(data.estimatedSuspense));
        setText('accountSuspenseForecastTotal', formatCurrency(data.estimatedCurrentMonth));
        renderSuspenseDrivers('accountSuspenseCardholders', data.topCardholders);
        renderSuspenseDrivers('accountSuspensePayees', data.topPayees);

        var suspenseNames = (data.suspenseAccounts || []).map(function (account) {
            return account.name;
        }).join(' + ');
        if (!data.transactionCount) {
            setText(
                'accountSuspenseMeta',
                'No current-month credit-card suspense lines found' +
                    (suspenseNames ? ' in ' + suspenseNames : '') + '.'
            );
        } else {
            setText(
                'accountSuspenseMeta',
                String(data.transactionCount) + ' suspense lines · ' +
                    formatSharePercent(data.coverage) + ' matched to cardholder or merchant history'
            );
        }
        setText(
            'accountSuspenseNote',
            data.modelAvailable
                ? 'Estimate uses posted allocations from ' + formatBreakdownDate(data.historyStart) +
                    ' to ' + formatBreakdownDate(data.historyEnd) +
                    '. It blends each cardholder and merchant/payee’s usual selected-account allocation with the ' +
                    formatSharePercent(data.overallHistoricalRate) +
                    ' overall account baseline. Forecast values are not posted actuals.'
                : 'There is not yet enough prior allocation history for a tailored estimate. Forecast values are not posted actuals.'
        );
        byId('accountSuspenseContent').hidden = false;
        applySuspenseEstimateToAccountChart(data);
    }

    function loadAccountSuspenseEstimate() {
        var requestId = ++suspenseEstimateRequestId;
        var section = byId('accountSuspenseForecast');
        section.hidden = false;
        byId('accountSuspenseLoading').hidden = false;
        byId('accountSuspenseContent').hidden = true;
        byId('accountSuspenseError').hidden = true;
        byId('accountSuspenseError').textContent = '';
        setText('accountSuspenseMeta', 'Reviewing current suspense activity and prior allocations…');

        fetch(suspenseEstimateUrl(), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        })
            .then(function (response) {
                return response.json().then(function (payload) {
                    if (!response.ok || !payload.ok) {
                        var message = payload && payload.error && payload.error.message;
                        throw new Error(message || 'The suspense forecast request failed.');
                    }
                    return payload.data;
                });
            })
            .then(function (data) {
                if (requestId === suspenseEstimateRequestId) {
                    renderAccountSuspenseEstimate(data);
                }
            })
            .catch(function (error) {
                if (requestId !== suspenseEstimateRequestId) {
                    return;
                }
                byId('accountSuspenseError').textContent = error.message || String(error);
                byId('accountSuspenseError').hidden = false;
                byId('accountSuspenseContent').hidden = true;
                setText('accountSuspenseMeta', 'Forecast unavailable');
                applySuspenseEstimateToAccountChart(null);
            })
            .finally(function () {
                if (requestId === suspenseEstimateRequestId) {
                    byId('accountSuspenseLoading').hidden = true;
                }
            });
    }

    function hideAccountSuspenseEstimate() {
        suspenseEstimateRequestId += 1;
        currentSuspenseEstimate = null;
        byId('accountSuspenseForecast').hidden = true;
        byId('accountSuspenseError').hidden = true;
        applySuspenseEstimateToAccountChart(null);
    }

    function hideAccountSpendOverTime() {
        accountTimeRequestId += 1;
        currentAccountTimeAccountName = '';
        byId('accountSpendOverTimeSection').hidden = true;
        byId('accountTimeError').hidden = true;
        destroyChart('account-spend-over-time');
    }

    function renderAccountFocus(data) {
        var analysis = data.accountAnalysis;
        var isFocused = Boolean(analysis);
        byId('accountFocusSection').hidden = !isFocused;
        byId('accountSpendOverTimeSection').hidden = !isFocused;
        byId('portfolioCharts').hidden = isFocused;
        byId('categorySection').hidden = isFocused;

        if (!isFocused) {
            destroyChart('account-comparison');
            hideAccountSuspenseEstimate();
            hideAccountSpendOverTime();
            return false;
        }

        destroyChart('monthly');
        destroyChart('mix');
        destroyCategoryCharts();

        var accountName = selectedAccountName() || analysis.name;
        var multipleAccounts = selectedAccountLabels().length > 1;
        var current = analysis.current || {
            average: 0,
            max: 0,
            min: 0,
            maxMonth: '-',
            minMonth: '-',
            ytd: 0,
            priorYtd: 0,
            ytdChange: null
        };
        var budget = analysis.budget || {};
        var hasSelectedMonthBudget = budget.available
            && budget.selectedMonthAmount !== null
            && budget.selectedMonthAmount !== undefined;
        var budgetHasLine = budget.available && (budget.monthlyValues || []).some(function (value) {
            return value !== null && value !== undefined;
        });
        setText('accountComparisonTitle', accountName + ' — monthly spend by year');
        setText(
            'accountComparisonMeta',
            'Current year is shown through ' + monthName(data.filters.reportYear, data.filters.reportMonth) +
            '; previous years show all 12 months. ' +
            (multipleAccounts
                ? 'Selected accounts are stacked by color; within each month, year bars run left to right as ' +
                    analysis.datasets.map(function (dataset) { return dataset.label; }).join(', ') + '. '
                : '') +
            'Dark segments are credit-card spend; light segments are other spend. A purple current-month segment is an estimated allocation from credit-card suspense. ' +
            (budgetHasLine ? 'The dashed gold line shows the native monthly budget. ' : '') +
            'Click an actual-spend bar to see all of its transactions.'
        );
        setText('accountAverage', formatCurrency(current.average));
        setText('accountMaximum', formatCurrency(current.max));
        setText('accountMaximumMonth', current.maxMonth || '-');
        setText('accountMinimum', formatCurrency(current.min));
        setText('accountMinimumMonth', current.minMonth || '-');
        setText(
            'accountBudget',
            hasSelectedMonthBudget
                ? formatCurrency(budget.selectedMonthAmount)
                : 'No budget set up'
        );
        setText(
            'accountBudgetMeta',
            hasSelectedMonthBudget
                ? monthName(data.filters.reportYear, data.filters.reportMonth) +
                    (budget.categoryName ? ' · ' + budget.categoryName : '') +
                    (budget.hasMultipleVersions ? ' · other versions available' : '')
                : 'For this month and selected filters'
        );
        byId('accountBudgetStat').classList.toggle('no-budget', !hasSelectedMonthBudget);
        setText('accountYtdChange', formatPercent(current.ytdChange));
        setText(
            'accountYtdComparison',
            formatCurrency(current.ytd) + ' vs ' + formatCurrency(current.priorYtd) + ' last year'
        );
        byId('accountYtdChangeStat').classList.remove('favourable', 'unfavourable', 'neutral');
        byId('accountYtdChangeStat').classList.add(comparisonClass(current.ytdChange));

        destroyChart('account-comparison');
        var accountChartDatasets = accountComparisonDatasets(analysis);
        var budgetDataset = accountBudgetDataset(analysis);
        if (budgetDataset) {
            accountChartDatasets.push(budgetDataset);
        }
        charts['account-comparison'] = new Chart(byId('accountComparisonChart'), {
            type: 'bar',
            data: {
                labels: analysis.labels,
                datasets: accountChartDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 250 },
                interaction: { mode: 'index', intersect: false },
                onClick: function (event, elements, chart) {
                    var clickedElements = chart.getElementsAtEventForMode(
                        event,
                        'nearest',
                        { intersect: true },
                        true
                    );
                    if (!clickedElements.length) {
                        return;
                    }
                    var element = clickedElements[0];
                    var dataset = chart.data.datasets[element.datasetIndex];
                    if (dataset.isBudgetLine) {
                        return;
                    }
                    if (dataset.isSuspenseEstimate) {
                        openSuspenseDrilldown();
                        return;
                    }
                    var barTotal = chart.data.datasets.reduce(function (total, item) {
                        if (item.stack !== dataset.stack || item.isSuspenseEstimate) {
                            return total;
                        }
                        return total + (Number(item.data[element.index]) || 0);
                    }, 0);
                    openSpendDrilldown(
                        dataset.year,
                        element.index + 1,
                        'all',
                        barTotal
                    );
                },
                onHover: function (event, elements, chart) {
                    if (event.native && event.native.target) {
                        var hoveredElements = chart.getElementsAtEventForMode(
                            event,
                            'nearest',
                            { intersect: true },
                            false
                        );
                        var hoveredDataset = hoveredElements.length
                            ? chart.data.datasets[hoveredElements[0].datasetIndex]
                            : null;
                        event.native.target.style.cursor = hoveredDataset && !hoveredDataset.isBudgetLine
                            ? 'pointer'
                            : 'default';
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 11,
                            usePointStyle: true,
                            padding: 16,
                            filter: function (legendItem, chartData) {
                                var dataset = chartData.datasets[legendItem.datasetIndex];
                                return chartData.datasets.findIndex(function (candidate) {
                                    return candidate.legendKey === dataset.legendKey;
                                }) === legendItem.datasetIndex;
                            }
                        },
                        onClick: function (event, legendItem, legend) {
                            var chart = legend.chart;
                            var dataset = chart.data.datasets[legendItem.datasetIndex];
                            var shouldShow = !chart.isDatasetVisible(legendItem.datasetIndex);
                            chart.data.datasets.forEach(function (candidate, index) {
                                if (candidate.legendKey === dataset.legendKey) {
                                    chart.setDatasetVisibility(index, shouldShow);
                                }
                            });
                            chart.update();
                        }
                    },
                    tooltip: {
                        mode: 'nearest',
                        intersect: true,
                        callbacks: {
                            label: accountSpendTooltip,
                            footer: accountSpendTotalsTooltip
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        offset: true,
                        grid: {
                            display: true,
                            offset: true,
                            color: 'rgba(23, 54, 93, 0.24)',
                            borderDash: [2, 4],
                            drawTicks: false,
                            lineWidth: 1
                        }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: { callback: function (value) { return formatCurrency(value); } }
                    }
                }
            }
        });

        var historyBody = byId('accountHistoryBody');
        historyBody.replaceChildren();
        analysis.years.forEach(function (year) {
            var row = document.createElement('tr');
            appendCell(row, String(year.year), 'category-name');
            appendCell(row, formatCurrency(year.ytd), 'numeric');
            appendCell(row, formatCurrency(year.average), 'numeric');
            appendCell(row, formatCurrency(year.max), 'numeric');
            appendCell(row, formatCurrency(year.min), 'numeric');
            appendCell(
                row,
                formatPercent(year.changeVsPrevious),
                'numeric change ' + comparisonClass(year.changeVsPrevious)
            );
            historyBody.appendChild(row);
        });
        return true;
    }

    function closeBreakdownRemainder() {
        byId('breakdownRemainderModal').hidden = true;
        syncModalOpenState();
    }

    function openBreakdownRemainder(kind) {
        var breakdown = currentBreakdownRemainders[kind];
        if (!breakdown || !breakdown.items || !breakdown.items.length) {
            return;
        }
        var label = kind === 'creditCard'
            ? 'credit-card spenders'
            : 'other-spend payees';
        setText('breakdownRemainderTitle', 'Remaining ' + label);
        setText(
            'breakdownRemainderMeta',
            String(breakdown.count) + ' contributors · ' +
            formatPercent(breakdown.percentage) + ' of selected-account spend · ' +
            currentBreakdownPeriod
        );
        var body = byId('breakdownRemainderBody');
        body.replaceChildren();
        byId('breakdownRemainderAccountHeader').hidden = !currentBreakdownMultipleAccounts;
        breakdown.items.forEach(function (item) {
            var row = document.createElement('tr');
            var contributorCell = document.createElement('td');
            var contributorButton = document.createElement('button');
            contributorButton.type = 'button';
            contributorButton.className = 'breakdown-contributor-button';
            contributorButton.textContent = item.name;
            contributorButton.addEventListener('click', function () {
                openContributorDrilldown(kind, item);
            });
            contributorCell.appendChild(contributorButton);
            row.appendChild(contributorCell);
            if (currentBreakdownMultipleAccounts) {
                appendCell(row, item.accountName || '—');
            }
            appendCell(row, formatPercent(item.percentage), 'numeric');
            appendCell(row, formatCurrency(item.amount), 'numeric');
            body.appendChild(row);
        });
        byId('breakdownRemainderModal').hidden = false;
        syncModalOpenState();
    }

    function closeShareTrend() {
        shareTrendRequestId += 1;
        byId('shareTrendModal').hidden = true;
        syncModalOpenState();
    }

    function renderShareTrend(data) {
        var departmentName = config.shareDepartmentName || 'Community : General';
        var periodLabel = breakdownPeriodLabel(data);
        setText(
            'shareTrendMeta',
            periodLabel + ' · average ' + formatSharePercent(data.averagePercentage) +
            ' · selected account spend as a share of all ' + departmentName + ' expenses'
        );
        destroyChart('share-trend');
        charts['share-trend'] = new Chart(byId('shareTrendChart'), {
            type: 'bar',
            data: {
                labels: data.series.map(function (item) {
                    return monthName(item.year, item.month, 'short');
                }),
                datasets: [{
                    label: 'Share of monthly spend',
                    data: data.series.map(function (item) { return item.percentage; }),
                    backgroundColor: '#2F75B5',
                    hoverBackgroundColor: '#17365D',
                    borderRadius: 5,
                    borderSkipped: false,
                    maxBarThickness: 34,
                    categoryPercentage: 0.72,
                    barPercentage: 0.72
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', intersect: true },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return 'Share: ' + formatSharePercent(context.raw);
                            },
                            afterLabel: function (context) {
                                var item = data.series[context.dataIndex];
                                return formatCurrency(item.selectedAmount) + ' of ' +
                                    formatCurrency(item.totalAmount);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { maxRotation: 45, minRotation: 0 }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: 1,
                        ticks: {
                            callback: function (value) {
                                return formatSharePercent(value);
                            }
                        }
                    }
                }
            }
        });
        byId('shareTrendLoading').hidden = true;
        byId('shareTrendContent').hidden = false;
    }

    function loadShareTrend() {
        var requestId = ++shareTrendRequestId;
        byId('shareTrendLoading').hidden = false;
        byId('shareTrendContent').hidden = true;
        byId('shareTrendError').hidden = true;
        fetch(shareTrendUrl(), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        })
            .then(function (response) {
                return response.json().then(function (payload) {
                    if (!response.ok || !payload.ok) {
                        var message = payload && payload.error && payload.error.message;
                        throw new Error(message || 'The monthly-share request failed.');
                    }
                    return payload.data;
                });
            })
            .then(function (data) {
                if (requestId === shareTrendRequestId) {
                    renderShareTrend(data);
                }
            })
            .catch(function (error) {
                if (requestId !== shareTrendRequestId) {
                    return;
                }
                var banner = byId('shareTrendError');
                banner.textContent = error.message || String(error);
                banner.hidden = false;
            })
            .finally(function () {
                if (requestId === shareTrendRequestId) {
                    byId('shareTrendLoading').hidden = true;
                }
            });
    }

    function openShareTrend() {
        syncShareTrendPresetDates(currentShareTrendPeriodMode);
        setShareTrendPeriodButtonState(currentShareTrendPeriodMode);
        setText(
            'shareTrendTitle',
            selectedAccountName() + ' — share of ' +
                (config.shareDepartmentName || 'Community : General') + ' spend'
        );
        byId('shareTrendModal').hidden = false;
        syncModalOpenState();
        loadShareTrend();
    }

    function createBreakdownRow(item, isRemaining, clickHandler) {
        var isClickable = typeof clickHandler === 'function';
        var row = document.createElement(isClickable ? 'button' : 'div');
        var heading = document.createElement('div');
        var nameBlock = document.createElement('div');
        var name = document.createElement('strong');
        var amount = document.createElement('span');
        var percentage = document.createElement('small');
        var track = document.createElement('div');
        var fill = document.createElement('span');

        row.className = 'breakdown-row' +
            (isClickable ? ' breakdown-row-clickable' : '') +
            (isRemaining ? ' breakdown-row-remaining' : '');
        if (isClickable) {
            row.type = 'button';
            row.addEventListener('click', clickHandler);
        }
        heading.className = 'breakdown-row-heading';
        nameBlock.className = 'breakdown-row-name';
        name.textContent = item.name;
        nameBlock.appendChild(name);
        if (item.accountName) {
            var accountName = document.createElement('span');
            accountName.textContent = item.accountName;
            nameBlock.appendChild(accountName);
        }
        amount.textContent = formatCurrency(item.amount);
        percentage.textContent = formatPercent(item.percentage);
        track.className = 'breakdown-share-track';
        fill.style.width = Math.max(0, Math.min(100, Number(item.percentage) * 100)) + '%';
        track.appendChild(fill);
        heading.appendChild(nameBlock);
        heading.appendChild(amount);
        row.appendChild(heading);
        row.appendChild(percentage);
        row.appendChild(track);
        return row;
    }

    function renderContributorBreakdown(containerId, kind, breakdown) {
        var container = byId(containerId);
        container.replaceChildren();
        if (!breakdown.top.length && !breakdown.remaining.count) {
            var empty = document.createElement('p');
            empty.className = 'breakdown-empty';
            empty.textContent = 'No positive spend in this period.';
            container.appendChild(empty);
            return;
        }
        breakdown.top.forEach(function (item) {
            container.appendChild(createBreakdownRow(item, false, function () {
                openContributorDrilldown(kind, item);
            }));
        });
        if (breakdown.remaining.count) {
            container.appendChild(createBreakdownRow({
                name: 'Remaining ' + String(breakdown.remaining.count),
                amount: breakdown.remaining.amount,
                percentage: breakdown.remaining.percentage
            }, true, function () {
                openBreakdownRemainder(kind);
            }));
        }
    }

    function formatBreakdownDate(value) {
        var parts = String(value || '').split('-');
        if (parts.length !== 3) {
            return value || '';
        }
        return new Intl.DateTimeFormat(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        }).format(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    }

    function breakdownPeriodLabel(data) {
        var period = data.period || {};
        if (period.mode === 'ytd') {
            return 'YTD through ' + monthName(data.filters.reportYear, data.filters.reportMonth);
        }
        if (period.mode === 'thisyear') {
            return 'Full year ' + String(data.filters.reportYear);
        }
        if (period.mode === 'lastyear') {
            return 'Full year ' + String(data.filters.reportYear - 1);
        }
        if (period.mode === 'lastyears') {
            return 'Last ' + String(period.years) + (Number(period.years) === 1 ? ' year' : ' years') +
                ' through ' + monthName(data.filters.reportYear, data.filters.reportMonth);
        }
        return formatBreakdownDate(period.startDate) + '–' + formatBreakdownDate(period.endDate);
    }

    function renderAccountBreakdown(data) {
        currentBreakdownPeriod = breakdownPeriodLabel(data);
        currentBreakdownMultipleAccounts = Boolean(
            data.filters.accountIds && data.filters.accountIds.length > 1
        );
        currentBreakdownRemainders = {
            creditCard: data.creditCard.remaining,
            other: data.other.remaining
        };
        setText(
            'accountBreakdownMeta',
            currentBreakdownPeriod + '; percentages are of total selected-account spend.' +
                (currentBreakdownMultipleAccounts ? ' Expense accounts are shown beneath each contributor.' : '')
        );
        setText('creditCardBreakdownTotal', formatCurrency(data.creditCard.total));
        setText('otherBreakdownTotal', formatCurrency(data.other.total));
        renderContributorBreakdown(
            'creditCardBreakdownList',
            'creditCard',
            data.creditCard
        );
        renderContributorBreakdown('otherBreakdownList', 'other', data.other);
        byId('accountBreakdownLoading').hidden = true;
        byId('accountBreakdownContent').hidden = false;
    }

    function loadAccountBreakdown(accountName) {
        var requestId = ++breakdownRequestId;
        var section = byId('accountBreakdownSection');
        currentBreakdownAccountName = accountName;
        section.hidden = false;
        syncBreakdownPresetDates(currentBreakdownPeriodMode);
        setBreakdownPeriodButtonState(currentBreakdownPeriodMode);
        setText('accountBreakdownTitle', accountName + ' — Spend contributors');
        byId('accountBreakdownLoading').hidden = false;
        byId('accountBreakdownContent').hidden = true;
        byId('accountBreakdownError').hidden = true;
        currentBreakdownRemainders = {};

        fetch(accountBreakdownUrl(), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        })
            .then(function (response) {
                return response.json().then(function (payload) {
                    if (!response.ok || !payload.ok) {
                        var message = payload && payload.error && payload.error.message;
                        throw new Error(message || 'The contributor breakdown request failed.');
                    }
                    return payload.data;
                });
            })
            .then(function (data) {
                if (requestId === breakdownRequestId) {
                    renderAccountBreakdown(data);
                }
            })
            .catch(function (error) {
                if (requestId !== breakdownRequestId) {
                    return;
                }
                var banner = byId('accountBreakdownError');
                banner.textContent = error.message || String(error);
                banner.hidden = false;
            })
            .finally(function () {
                if (requestId === breakdownRequestId) {
                    byId('accountBreakdownLoading').hidden = true;
                }
            });
    }

    function hideAccountBreakdown() {
        breakdownRequestId += 1;
        currentBreakdownAccountName = '';
        byId('accountBreakdownSection').hidden = true;
        closeBreakdownRemainder();
        currentBreakdownRemainders = {};
        currentBreakdownMultipleAccounts = false;
    }

    function appendCell(row, value, className) {
        var cell = document.createElement('td');
        cell.textContent = value;
        if (className) {
            cell.className = className;
        }
        row.appendChild(cell);
    }

    function renderCategoryCharts(data) {
        destroyCategoryCharts();
        var container = byId('categoryCharts');
        container.replaceChildren();
        data.categoryComparisons.forEach(function (category, categoryIndex) {
            var article = document.createElement('article');
            article.className = 'panel category-chart-card';
            var heading = document.createElement('div');
            heading.className = 'panel-heading compact';
            var title = document.createElement('h3');
            title.textContent = category.name;
            heading.appendChild(title);
            var frame = document.createElement('div');
            frame.className = 'chart-frame chart-frame-category';
            var canvas = document.createElement('canvas');
            canvas.id = 'categoryChart' + categoryIndex;
            frame.appendChild(canvas);
            article.appendChild(heading);
            article.appendChild(frame);
            container.appendChild(article);

            var chartKey = 'category-' + categoryIndex;
            charts[chartKey] = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: category.labels,
                    datasets: category.datasets.map(function (dataset, datasetIndex) {
                        var colorIndex = Math.max(0, yearPalette.length - category.datasets.length + datasetIndex);
                        return {
                            label: dataset.label,
                            data: dataset.values,
                            backgroundColor: yearPalette[colorIndex],
                            borderColor: yearPalette[colorIndex],
                            borderWidth: 0,
                            borderRadius: 2,
                            grouped: true,
                            categoryPercentage: 0.52,
                            barPercentage: 1
                        };
                    })
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 220 },
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { boxWidth: 10, usePointStyle: true, padding: 12 }
                        },
                        tooltip: { callbacks: { label: chartCurrencyTooltip } }
                    },
                    scales: {
                        x: {
                            stacked: false,
                            offset: true,
                            grid: {
                                display: true,
                                offset: true,
                                color: 'rgba(23, 54, 93, 0.24)',
                                borderDash: [2, 4],
                                drawTicks: false,
                                lineWidth: 1
                            }
                        },
                        y: {
                            stacked: false,
                            beginAtZero: true,
                            ticks: {
                                maxTicksLimit: 6,
                                callback: function (value) { return formatCurrency(value); }
                            }
                        }
                    }
                }
            });
        });
        if (!data.categoryComparisons.length) {
            var empty = document.createElement('div');
            empty.className = 'panel empty-state';
            empty.textContent = 'Category comparison charts will appear when matching expense data is available.';
            container.appendChild(empty);
        }
        setText('comparisonTitle', 'Monthly ' + (data.filters.groupBy === 'department' ? 'department' : 'account') + ' comparisons by year');
    }

    function renderDetails(data) {
        currentDetails = data.details || [];
        byId('exportButton').disabled = !currentDetails.length;
    }

    function renderDashboard(data) {
        renderKpis(data);
        var accountFocused = renderAccountFocus(data);
        if (!accountFocused) {
            renderMonthlyTrend(data);
            renderSpendMix(data);
            renderCategoryCharts(data);
            hideAccountBreakdown();
        } else {
            var accountName = selectedAccountName();
            loadAccountBreakdown(accountName);
            loadAccountSpendOverTime(accountName);
            loadAccountSuspenseEstimate();
        }
        renderDetails(data);
        setText('generatedAt', 'Refreshed ' + new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date(data.generatedAt)));
    }

    function queryUrl() {
        var endpoint = new URL(config.endpoint, window.location.origin);
        endpoint.searchParams.set('action', 'data');
        endpoint.searchParams.set('month', valueOf('monthFilter'));
        endpoint.searchParams.set('groupBy', valueOf('groupByFilter'));
        endpoint.searchParams.set('department', selectedValues('departmentFilter').join(','));
        endpoint.searchParams.set('account', selectedValues('accountFilter').join(','));
        endpoint.searchParams.set('subsidiary', valueOf('subsidiaryFilter'));
        endpoint.searchParams.set('years', valueOf('yearsFilter'));
        endpoint.searchParams.set('categoryLimit', valueOf('categoryLimitFilter'));
        endpoint.searchParams.set('shareDepartment', config.shareDepartmentId || '');
        return endpoint.toString();
    }

    function loadDashboard() {
        showError('');
        setLoading(true);
        fetch(queryUrl(), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        })
            .then(function (response) {
                return response.json().then(function (payload) {
                    if (!response.ok || !payload.ok) {
                        var message = payload && payload.error && payload.error.message;
                        throw new Error(message || 'The dashboard data request failed.');
                    }
                    return payload.data;
                });
            })
            .then(function (data) {
                renderDashboard(data);
            })
            .catch(function (error) {
                showError(error.message || String(error));
            })
            .finally(function () {
                setLoading(false);
            });
    }

    function scheduleDashboardLoad() {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(loadDashboard, 250);
    }

    function csvValue(value) {
        var text = String(value == null ? '' : value);
        return '"' + text.replace(/"/g, '""') + '"';
    }

    function exportDetails() {
        if (!currentDetails.length) {
            return;
        }
        var headers = ['Date', 'Transaction', 'Type', 'Payee', 'Account', 'Department', 'Memo', 'Amount'];
        var rows = currentDetails.map(function (item) {
            return [
                item.date,
                item.transactionNumber,
                item.type,
                item.payee,
                item.account,
                item.department,
                item.memo,
                item.amount
            ];
        });
        var csv = [headers].concat(rows).map(function (row) {
            return row.map(csvValue).join(',');
        }).join('\r\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'danthonia-expense-detail-' + valueOf('monthFilter') + '.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
    }

    function initialise() {
        configureChartDefaults();
        byId('monthFilter').value = config.defaultMonth || '';
        byId('yearsFilter').value = String(config.defaultYears || 2);
        byId('categoryLimitFilter').value = String(config.defaultCategoryLimit || 12);
        initialiseCompactMultiSelect('departmentFilter', 'departments');
        initialiseCompactMultiSelect('accountFilter', 'expense accounts');

        byId('dashboardFilters').addEventListener('submit', function (event) {
            event.preventDefault();
            loadDashboard();
        });
        [
            'monthFilter',
            'groupByFilter',
            'departmentFilter',
            'accountFilter',
            'subsidiaryFilter',
            'yearsFilter',
            'categoryLimitFilter'
        ].forEach(function (id) {
            byId(id).addEventListener('change', scheduleDashboardLoad);
        });
        byId('exportButton').addEventListener('click', exportDetails);
        byId('printButton').addEventListener('click', function () { window.print(); });
        byId('closeSpendDrilldown').addEventListener('click', closeSpendDrilldown);
        byId('sortSpendByAmount').addEventListener('click', function () {
            setSpendDrilldownSort('amount');
        });
        byId('sortSpendByDate').addEventListener('click', function () {
            setSpendDrilldownSort('date');
        });
        byId('spendDrilldownModal').addEventListener('click', function (event) {
            if (event.target === byId('spendDrilldownModal')) {
                closeSpendDrilldown();
            }
        });
        byId('closeBreakdownRemainder').addEventListener('click', closeBreakdownRemainder);
        byId('breakdownRemainderModal').addEventListener('click', function (event) {
            if (event.target === byId('breakdownRemainderModal')) {
                closeBreakdownRemainder();
            }
        });
        byId('kpiAverageShareCard').addEventListener('click', openShareTrend);
        byId('closeShareTrend').addEventListener('click', closeShareTrend);
        byId('shareTrendModal').addEventListener('click', function (event) {
            if (event.target === byId('shareTrendModal')) {
                closeShareTrend();
            }
        });
        Array.prototype.forEach.call(
            document.querySelectorAll('[data-breakdown-period]'),
            function (button) {
                button.addEventListener('click', function () {
                    selectBreakdownPeriod(button.dataset.breakdownPeriod);
                });
            }
        );
        byId('breakdownStartDate').addEventListener('change', applyCustomBreakdownDates);
        byId('breakdownEndDate').addEventListener('change', applyCustomBreakdownDates);
        Array.prototype.forEach.call(
            document.querySelectorAll('[data-account-time-period]'),
            function (button) {
                button.addEventListener('click', function () {
                    selectAccountTimePeriod(button.dataset.accountTimePeriod);
                });
            }
        );
        byId('accountTimeYears').addEventListener('change', selectAccountTimeYears);
        byId('accountTimeStartDate').addEventListener('change', applyCustomAccountTimeDates);
        byId('accountTimeEndDate').addEventListener('change', applyCustomAccountTimeDates);
        Array.prototype.forEach.call(
            document.querySelectorAll('[data-share-period]'),
            function (button) {
                button.addEventListener('click', function () {
                    selectShareTrendPeriod(button.dataset.sharePeriod);
                });
            }
        );
        byId('shareStartDate').addEventListener('change', applyCustomShareTrendDates);
        byId('shareEndDate').addEventListener('change', applyCustomShareTrendDates);
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                if (!byId('shareTrendModal').hidden) {
                    closeShareTrend();
                } else if (!byId('breakdownRemainderModal').hidden) {
                    closeBreakdownRemainder();
                } else if (!byId('spendDrilldownModal').hidden) {
                    closeSpendDrilldown();
                }
            }
        });
        loadDashboard();
    }

    function safelyInitialise() {
        try {
            initialise();
        } catch (error) {
            showError(error.message || String(error));
            setLoading(false);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', safelyInitialise);
    } else {
        safelyInitialise();
    }
}());
