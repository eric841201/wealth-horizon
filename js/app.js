/**
 * WEALTH HORIZON - Wealth Milestone & Multi-Asset Portfolio Engine
 * 多標的動態配置、動態水位感應、加權複利推演與視覺互動模組
 */

// ==============================
// 1. 初始設定與狀態定義
// ==============================

const STORAGE_KEY = 'WEALTH_HORIZON_DATA_V1';

const DEFAULT_STATE = {
    settings: {
        startDate: '2026-02-05',
        monthlyDeposit: 30000,           // 每月固定存入金額 (調薪直接改此處)
        emergencyCap: 120000,            // 高利活存目標上限
        monthlyEmergencyMax: 15000,      // 高利活存每月撥款上限
        currentGoal: 1000000             // 當前聚焦目標: 100萬 或 1000萬
    },
    accounts: {
        emergencyBalance: 0              // 當前高利活存實際餘額
    },
    portfolio: [
        {
            id: 'asset_1',
            name: '0050 元大台灣50',
            ratio: 100,                  // 配比權重 % (總和需為 100%)
            expectedRate: 7.0,           // 該標的預估年化報酬率 (%)
            principal: 0,                // 累計投入本金
            marketValue: 0               // 真實市值
        }
    ],
    transactions: []                     // 流水帳歷史紀錄
};

// 標的顏色調色盤 (用於視覺區分多標的)
const ASSET_COLORS = [
    { border: '#10b981', bg: 'rgba(16, 185, 129, 0.2)', text: '#34d399', badge: 'bg-emerald-subtle text-emerald' }, // 翡翠綠
    { border: '#38bdf8', bg: 'rgba(56, 189, 248, 0.2)', text: '#38bdf8', badge: 'bg-info-subtle text-info' },       // 科技藍
    { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.2)', text: '#c084fc', badge: 'bg-purple-subtle text-purple' },  // 紫羅蘭
    { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)', text: '#fbbf24', badge: 'bg-gold-subtle text-gold' },      // 琥珀金
    { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.2)', text: '#f472b6', badge: 'bg-danger-subtle text-danger' },  // 玫瑰粉
    { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)', text: '#22d3ee', badge: 'bg-cyan-subtle text-cyan' }       // 青綠色
];

let appState = loadState();
let projectionChartInstance = null;
let currentChartYears = 5;

// ==============================
// 2. 狀態持久化與向下相容遷移
// ==============================

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            const state = {
                settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
                accounts: { ...DEFAULT_STATE.accounts, ...(parsed.accounts || {}) },
                portfolio: parsed.portfolio || [],
                transactions: parsed.transactions || []
            };

            // 向下相容遷移：如果舊資料沒有 portfolio，但有舊的 etfPrincipal/etfMarketValue
            if (!state.portfolio || state.portfolio.length === 0) {
                const oldPrincipal = parsed.accounts ? (parsed.accounts.etfPrincipal || 0) : 0;
                const oldMarketValue = parsed.accounts ? (parsed.accounts.etfMarketValue || oldPrincipal) : 0;
                const oldRate = parsed.settings ? (parsed.settings.annualReturnRate || 7.0) : 7.0;

                state.portfolio = [
                    {
                        id: 'asset_1',
                        name: '0050 元大台灣50',
                        ratio: 100,
                        expectedRate: oldRate,
                        principal: oldPrincipal,
                        marketValue: oldMarketValue
                    }
                ];
            }

            return state;
        }
    } catch (e) {
        console.error('Failed to load local storage state:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch (e) {
        console.error('Failed to save state:', e);
    }
}

// ==============================
// 3. 投資組合聚合計算工具
// ==============================

function getPortfolioPrincipal() {
    return appState.portfolio.reduce((sum, a) => sum + (a.principal || 0), 0);
}

function getPortfolioMarketValue() {
    return appState.portfolio.reduce((sum, a) => sum + (a.marketValue || 0), 0);
}

function getPortfolioProfit() {
    return getPortfolioMarketValue() - getPortfolioPrincipal();
}

/**
 * 計算投資組合整體的加權平均年化報酬率 (%)
 */
function getWeightedReturnRate() {
    if (!appState.portfolio || appState.portfolio.length === 0) return 7.0;
    const totalRatio = appState.portfolio.reduce((sum, a) => sum + (a.ratio || 0), 0);
    if (totalRatio === 0) return 7.0;

    const weightedSum = appState.portfolio.reduce((sum, a) => sum + (a.ratio * a.expectedRate), 0);
    return weightedSum / totalRatio;
}

// ==============================
// 4. 核心演算法：雙層動態分流與多標的溢流
// ==============================

/**
 * 雙層動態分流演算法
 * 第一層：優先補滿高利活存缺口 (最多 15,000 或加速全補)
 * 第二層：剩餘溢流資金依投資組合 ratio 權重動態切分到各標的
 */
function calculateAllocation(depositAmount, isLumpSum = false) {
    const { emergencyCap, monthlyEmergencyMax } = appState.settings;
    const currentEmergency = appState.accounts.emergencyBalance;

    // 1. 第一層：計算活存實質缺口
    const gap = Math.max(0, emergencyCap - currentEmergency);
    let toEmergency = 0;

    if (gap > 0) {
        if (isLumpSum) {
            toEmergency = Math.min(depositAmount, gap);
        } else {
            toEmergency = Math.min(depositAmount, gap, monthlyEmergencyMax);
        }
    }

    // 2. 第二層：進攻投資組合溢流總額
    const overflowAmount = Math.max(0, depositAmount - toEmergency);

    // 3. 按照 portfolio 中的各標的 ratio 權重分流
    const assetAllocations = [];
    let allocatedSum = 0;

    const portfolio = appState.portfolio && appState.portfolio.length > 0 
        ? appState.portfolio 
        : DEFAULT_STATE.portfolio;

    portfolio.forEach((asset, idx) => {
        let amt = 0;
        if (idx === portfolio.length - 1) {
            // 最後一個標的吸收尾差，確保加總 100% 精確相等
            amt = Math.max(0, overflowAmount - allocatedSum);
        } else {
            amt = Math.round(overflowAmount * (asset.ratio / 100));
            allocatedSum += amt;
        }
        assetAllocations.push({
            id: asset.id,
            name: asset.name,
            ratio: asset.ratio,
            amount: amt
        });
    });

    return {
        toEmergency,
        overflowAmount,
        assetAllocations,
        isFullNow: (currentEmergency + toEmergency) >= emergencyCap,
        remainingGap: Math.max(0, gap - toEmergency)
    };
}

/**
 * 未來資產與達標月份推演演算法 (支援調薪與多標的加權複利)
 */
function simulateFutureMilestones(customMonthlyDeposit = null, customRate = null) {
    const monthlyDeposit = customMonthlyDeposit !== null ? customMonthlyDeposit : appState.settings.monthlyDeposit;
    const annualRate = (customRate !== null ? customRate : getWeightedReturnRate()) / 100;
    const monthlyRate = annualRate / 12;

    const { emergencyCap, monthlyEmergencyMax } = appState.settings;

    let simEmergency = appState.accounts.emergencyBalance;
    let simPortfolio = getPortfolioMarketValue();

    let monthsTo1M = null;
    let monthsTo10M = null;

    const MAX_SIM_MONTHS = 12 * 60; // 最多推算 60 年

    for (let m = 1; m <= MAX_SIM_MONTHS; m++) {
        // 1. 投資組合複利生息
        simPortfolio = simPortfolio * (1 + monthlyRate);

        // 2. 當月資金注入分流
        const gap = Math.max(0, emergencyCap - simEmergency);
        let toEmergency = 0;
        if (gap > 0) {
            toEmergency = Math.min(monthlyDeposit, gap, monthlyEmergencyMax);
        }
        const toPortfolio = monthlyDeposit - toEmergency;

        simEmergency += toEmergency;
        simPortfolio += toPortfolio;

        const currentNetWorth = simEmergency + simPortfolio;

        if (monthsTo1M === null && currentNetWorth >= 1000000) {
            monthsTo1M = m;
        }
        if (monthsTo10M === null && currentNetWorth >= 10000000) {
            monthsTo10M = m;
            break;
        }
    }

    return { monthsTo1M, monthsTo10M };
}

// ==============================
// 5. UI 渲染引擎
// ==============================

function formatCurrency(num) {
    return Math.round(num).toLocaleString('en-US');
}

function updateUI() {
    const { emergencyBalance } = appState.accounts;
    const { monthlyDeposit, emergencyCap, currentGoal } = appState.settings;

    const portfolioPrincipal = getPortfolioPrincipal();
    const portfolioMarketValue = getPortfolioMarketValue();
    const unrealizedProfit = getPortfolioProfit();

    const totalNetWorth = emergencyBalance + portfolioMarketValue;
    const totalPrincipal = emergencyBalance + portfolioPrincipal;

    // 1. 頂部總資產
    document.getElementById('displayTotalNetWorth').textContent = formatCurrency(totalNetWorth);
    document.getElementById('statTotalPrincipal').textContent = `NT$ ${formatCurrency(totalPrincipal)}`;

    // 損益與增益百分比
    const profitSign = unrealizedProfit >= 0 ? '+' : '';
    document.getElementById('statUnrealizedProfit').textContent = `${profitSign}NT$ ${formatCurrency(unrealizedProfit)}`;
    document.getElementById('statUnrealizedProfit').className = `stat-value ${unrealizedProfit >= 0 ? 'text-success' : 'text-danger'}`;

    const profitRate = totalPrincipal > 0 ? ((unrealizedProfit / totalPrincipal) * 100).toFixed(1) : '0.0';
    const badgeProfit = document.getElementById('badgeProfitRate');
    badgeProfit.innerHTML = `<i class="bi bi-graph-up-arrow me-1"></i> 市值增益 ${profitSign}${profitRate}%`;
    badgeProfit.className = `badge ${unrealizedProfit >= 0 ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'} ms-2 align-self-center py-2 px-3 rounded-pill`;

    // 2. 目標進度條
    const goalPercent = Math.min(100, (totalNetWorth / currentGoal) * 100);
    document.getElementById('textGoalPercent').textContent = `${goalPercent.toFixed(2)}%`;
    document.getElementById('progressBarGoal').style.width = `${goalPercent}%`;
    document.getElementById('labelCurrentMilestoneGoal').textContent = `距離 ${currentGoal === 1000000 ? '100 萬 (第一桶金)' : '1000 萬 (財務自由)'} 進度`;

    // 3. 雙水庫動態水位更新 (含多標的持有清單)
    updateReservoirs();

    // 4. 里程碑倒數推演更新
    updateCountdownAndEstimation();

    // 5. RPG 里程碑地圖渲染
    renderMilestonesRoadmap(totalNetWorth);

    // 6. 流水帳表格渲染
    renderTransactionTable();

    // 7. 更新標籤與沙盤標籤
    document.getElementById('labelEmergencyCap').textContent = formatCurrency(emergencyCap);
    document.getElementById('badgeActiveRate').textContent = `每月存 NT$ ${formatCurrency(monthlyDeposit)}`;
    document.getElementById('hintCurrentMonthlySetting').textContent = `預設：$${formatCurrency(monthlyDeposit)}`;

    // 8. 走勢圖更新
    renderProjectionChart();

    // 9. 更新試算沙盤
    updateSimulationOutput();
}

/**
 * 雙水庫與多標的清單渲染
 */
function updateReservoirs() {
    const { emergencyBalance } = appState.accounts;
    const { emergencyCap, currentGoal } = appState.settings;

    const portfolioPrincipal = getPortfolioPrincipal();
    const portfolioMarketValue = getPortfolioMarketValue();
    const weightedRate = getWeightedReturnRate();

    // 水庫 A: 高利活存
    const emergencyPercent = Math.min(100, (emergencyBalance / emergencyCap) * 100);
    const waveEmergency = document.getElementById('waveEmergency');
    waveEmergency.style.height = `${emergencyPercent}%`;

    const liquidBoxBlue = waveEmergency.closest('.liquid-box');
    const badgeEmergency = document.getElementById('badgeEmergencyStatus');

    document.getElementById('textEmergencyPercent').textContent = `${emergencyPercent.toFixed(0)}%`;
    document.getElementById('textEmergencyAmount').textContent = `NT$ ${formatCurrency(emergencyBalance)} / ${formatCurrency(emergencyCap)}`;

    const deficit = Math.max(0, emergencyCap - emergencyBalance);
    document.getElementById('textEmergencyDeficit').textContent = `NT$ ${formatCurrency(deficit)}`;

    if (emergencyBalance >= emergencyCap) {
        badgeEmergency.textContent = '🛡️ 安全防線已築成 (滿額)';
        badgeEmergency.className = 'badge bg-gold text-dark rounded-pill fw-bold';
        liquidBoxBlue.classList.add('full-tank');
        document.getElementById('textEmergencyMonthsLeft').textContent = '✅ 已完全防禦，資金全數溢流至進攻組合';
    } else {
        badgeEmergency.textContent = '充能蓄水中';
        badgeEmergency.className = 'badge bg-primary-subtle text-primary rounded-pill';
        liquidBoxBlue.classList.remove('full-tank');
        const monthsLeft = Math.ceil(deficit / Math.min(deficit, appState.settings.monthlyEmergencyMax));
        document.getElementById('textEmergencyMonthsLeft').textContent = `約需 ${monthsLeft} 個月完成`;
    }

    // 水庫 B: 進攻投資組合
    const etfPercent = Math.min(100, (portfolioMarketValue / currentGoal) * 100);
    document.getElementById('waveEtf').style.height = `${etfPercent}%`;
    document.getElementById('textEtfPercent').textContent = `${etfPercent.toFixed(1)}%`;
    document.getElementById('textEtfCurrent').textContent = `組合市值 NT$ ${formatCurrency(portfolioMarketValue)}`;
    document.getElementById('textEtfPrincipal').textContent = `NT$ ${formatCurrency(portfolioPrincipal)}`;
    document.getElementById('textEtfRatePreview').textContent = `加權年化 ${weightedRate.toFixed(1)}%`;
    document.getElementById('textAssetCount').textContent = `${appState.portfolio.length} 檔`;

    const badgeEtfMode = document.getElementById('badgeEtfMode');
    if (emergencyBalance >= emergencyCap) {
        badgeEtfMode.textContent = '🚀 全額全速溢流中';
        badgeEtfMode.className = 'badge bg-gold-subtle text-gold rounded-pill fw-bold';
    } else {
        badgeEtfMode.textContent = '🌱 分流累積中';
        badgeEtfMode.className = 'badge bg-emerald-subtle text-emerald rounded-pill';
    }

    // 動態渲染水庫下方各標的詳細比例清單
    renderPortfolioAssetsList();
}

/**
 * 渲染水庫 B 下方的多標的持有清單條
 */
function renderPortfolioAssetsList() {
    const container = document.getElementById('portfolioAssetsListContainer');
    if (!container) return;

    container.innerHTML = '';
    const portfolio = appState.portfolio || [];

    if (portfolio.length === 0) {
        container.innerHTML = '<span class="text-secondary xsmall">尚未配置標的，請至「策略參數」新增。</span>';
        return;
    }

    portfolio.forEach((asset, idx) => {
        const color = ASSET_COLORS[idx % ASSET_COLORS.length];
        const profit = (asset.marketValue || 0) - (asset.principal || 0);
        const profitSign = profit >= 0 ? '+' : '';

        const item = document.createElement('div');
        item.className = 'p-2 rounded bg-black border border-secondary-subtle';
        item.style.borderLeft = `4px solid ${color.border}`;

        item.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-1">
                <div class="d-flex align-items-center gap-1">
                    <span class="fw-bold text-white small">${asset.name}</span>
                    <span class="badge ${color.badge} xsmall-badge">${asset.ratio}%</span>
                </div>
                <div class="text-end">
                    <span class="fw-bold small text-white">NT$ ${formatCurrency(asset.marketValue || 0)}</span>
                </div>
            </div>
            <div class="d-flex justify-content-between align-items-center xsmall text-secondary">
                <span>本金: $${formatCurrency(asset.principal || 0)} · 預期: ${asset.expectedRate}%</span>
                <span class="${profit >= 0 ? 'text-success' : 'text-danger'}">
                    損益: ${profitSign}$${formatCurrency(profit)}
                </span>
            </div>
        `;
        container.appendChild(item);
    });
}

/**
 * 預估達標日期與倒數天數計算
 */
function updateCountdownAndEstimation() {
    const totalNetWorth = appState.accounts.emergencyBalance + getPortfolioMarketValue();
    const targetGoal = appState.settings.currentGoal;

    if (totalNetWorth >= targetGoal) {
        document.getElementById('statEstimatedDate').textContent = '🎉 目標已圓滿達成！';
        document.getElementById('countdownMonths').textContent = '0';
        document.getElementById('countdownDays').textContent = '0';
        document.getElementById('textEncouragement').textContent = '恭喜！您已成功解鎖此財富里程碑，請前往切換下一個目標！';
        return;
    }

    const { monthsTo1M, monthsTo10M } = simulateFutureMilestones();
    const neededMonths = targetGoal === 1000000 ? monthsTo1M : monthsTo10M;

    if (neededMonths === null) {
        document.getElementById('statEstimatedDate').textContent = '未達標';
        document.getElementById('countdownMonths').textContent = '--';
        document.getElementById('countdownDays').textContent = '--';
        return;
    }

    const today = new Date();
    const targetDate = new Date(today.getFullYear(), today.getMonth() + neededMonths, today.getDate());

    const estYear = targetDate.getFullYear();
    const estMonth = targetDate.getMonth() + 1;
    document.getElementById('statEstimatedDate').textContent = `${estYear} 年 ${estMonth} 月`;

    document.getElementById('countdownMonths').textContent = neededMonths;
    document.getElementById('countdownDays').textContent = neededMonths * 30;

    const encouragement = document.getElementById('textEncouragement');
    if (neededMonths <= 6) {
        encouragement.textContent = '🔥 終點就在眼前！保持節奏，最後一哩路即將衝線！';
    } else if (appState.accounts.emergencyBalance >= appState.settings.emergencyCap) {
        encouragement.textContent = '🛡️ 防禦盾牌已滿！現在每存一筆錢，都是 100% 灌入核心進攻組合滾動複利！';
    } else {
        encouragement.textContent = '穩紮穩打！先把 12 萬安全網築牢，未來的自己會感謝現在的你。';
    }
}

/**
 * 渲染 RPG 里程碑大地圖
 */
function renderMilestonesRoadmap(currentNetWorth) {
    const milestones = [
        { id: 'start', title: '2/5 啟航', amount: 0, icon: 'bi-flag-fill' },
        { id: 'm120k', title: '安全防線', amount: 120000, icon: 'bi-shield-fill' },
        { id: 'm250k', title: '初露鋒芒', amount: 250000, icon: 'bi-coin' },
        { id: 'm500k', title: '半桶金', amount: 500000, icon: 'bi-stars' },
        { id: 'm1m', title: '第一桶金', amount: 1000000, icon: 'bi-trophy-fill' },
        { id: 'm3m', title: '複利滾輪', amount: 3000000, icon: 'bi-snow' },
        { id: 'm5m', title: '半步自由', amount: 5000000, icon: 'bi-gem' },
        { id: 'm10m', title: '千萬自由', amount: 10000000, icon: 'bi-crown-fill' }
    ];

    const container = document.getElementById('milestonesTrack');
    container.innerHTML = '';

    let maxIdx = 0;
    milestones.forEach((m, idx) => {
        if (currentNetWorth >= m.amount) maxIdx = idx;
    });
    const progressWidth = (maxIdx / (milestones.length - 1)) * 100;

    const progressBar = document.createElement('div');
    progressBar.className = 'milestones-track-progress';
    progressBar.style.width = `calc(${progressWidth}% - 80px)`;
    container.appendChild(progressBar);

    milestones.forEach((m, idx) => {
        const isUnlocked = currentNetWorth >= m.amount;
        const isCurrent = isUnlocked && (idx === milestones.length - 1 || currentNetWorth < milestones[idx + 1].amount);

        const node = document.createElement('div');
        node.className = `milestone-node ${isUnlocked ? 'unlocked' : ''} ${isCurrent ? 'current' : ''}`;

        node.innerHTML = `
            <div class="milestone-icon" title="${m.title} ($${formatCurrency(m.amount)})">
                <i class="bi ${m.icon}"></i>
            </div>
            <div class="milestone-title">${m.title}</div>
            <div class="milestone-target">${m.amount === 0 ? 'Start' : formatCurrency(m.amount)}</div>
        `;
        container.appendChild(node);
    });
}

/**
 * 渲染流水帳表格
 */
function renderTransactionTable() {
    const tbody = document.getElementById('transactionTableBody');
    const emptyNotice = document.getElementById('emptyTableNotice');
    tbody.innerHTML = '';

    const list = [...appState.transactions].reverse();

    if (list.length === 0) {
        emptyNotice.classList.remove('d-none');
        return;
    }
    emptyNotice.classList.add('d-none');

    list.forEach(tx => {
        const tr = document.createElement('tr');
        
        let typeBadge = '';
        if (tx.type === 'REGULAR') {
            typeBadge = '<span class="badge bg-primary-subtle text-primary">例行存入</span>';
        } else if (tx.type === 'BONUS') {
            typeBadge = '<span class="badge bg-gold-subtle text-gold">結餘/加碼</span>';
        } else if (tx.type === 'DIVIDEND') {
            typeBadge = '<span class="badge bg-emerald-subtle text-emerald">股息再投入</span>';
        } else if (tx.type === 'REVALUE') {
            typeBadge = '<span class="badge bg-info-subtle text-info">市值校正</span>';
        }

        // 標的切分詳情備註
        let allocationDetail = `+ NT$ ${formatCurrency(tx.toEtf || 0)}`;
        if (tx.assetBreakdown && tx.assetBreakdown.length > 1) {
            const parts = tx.assetBreakdown.map(b => `${b.name}: $${formatCurrency(b.amount)}`);
            allocationDetail += `<br><span class="xsmall text-muted">(${parts.join(', ')})</span>`;
        }

        tr.innerHTML = `
            <td class="text-secondary">${tx.date}</td>
            <td>${typeBadge}</td>
            <td class="text-end fw-bold text-white">NT$ ${formatCurrency(tx.amount)}</td>
            <td class="text-end text-primary">+ NT$ ${formatCurrency(tx.toEmergency || 0)}</td>
            <td class="text-end text-emerald">${allocationDetail}</td>
            <td class="text-secondary small">${tx.note || '-'}</td>
            <td class="text-center">
                <button type="button" class="btn btn-outline-danger btn-sm p-1 px-2 btn-delete-tx" data-id="${tx.id}" title="撤銷這筆紀錄">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-delete-tx').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.getAttribute('data-id'));
            deleteTransaction(id);
        });
    });
}

/**
 * 撤銷流水帳並還原水位
 */
function deleteTransaction(txId) {
    const tx = appState.transactions.find(t => t.id === txId);
    if (!tx) return;

    if (!confirm(`確定要撤銷 ${tx.date} 這筆 NT$ ${formatCurrency(tx.amount)} 的紀錄嗎？\n系統將自動回退水庫水位。`)) {
        return;
    }

    if (tx.type === 'REVALUE') {
        // 市值校正還原
        if (tx.targetAssetId) {
            const asset = appState.portfolio.find(a => a.id === tx.targetAssetId);
            if (asset) asset.marketValue = Math.max(0, asset.marketValue - tx.toEtf);
        }
    } else {
        // 還原活存
        appState.accounts.emergencyBalance = Math.max(0, appState.accounts.emergencyBalance - (tx.toEmergency || 0));

        // 還原投資組合
        if (tx.assetBreakdown && tx.assetBreakdown.length > 0) {
            tx.assetBreakdown.forEach(b => {
                const asset = appState.portfolio.find(a => a.id === b.id);
                if (asset) {
                    asset.principal = Math.max(0, asset.principal - b.amount);
                    asset.marketValue = Math.max(0, asset.marketValue - b.amount);
                }
            });
        } else if (appState.portfolio.length > 0) {
            // 單一標的舊紀錄退還
            const first = appState.portfolio[0];
            first.principal = Math.max(0, first.principal - (tx.toEtf || 0));
            first.marketValue = Math.max(0, first.marketValue - (tx.toEtf || 0));
        }
    }

    appState.transactions = appState.transactions.filter(t => t.id !== txId);
    saveState();
    updateUI();
}

// ==============================
// 6. Chart.js 未來 30 年複利沙盤走勢圖
// ==============================

function renderProjectionChart() {
    const ctx = document.getElementById('projectionChart');
    if (!ctx) return;

    const years = currentChartYears;
    const months = years * 12;
    const { monthlyDeposit, emergencyCap } = appState.settings;
    const annualRate = getWeightedReturnRate() / 100;
    const monthlyRate = annualRate / 12;

    const labels = [];
    const principalData = [];
    const compoundData = [];

    let currentPrincipal = appState.accounts.emergencyBalance + getPortfolioPrincipal();
    let currentSimEmergency = appState.accounts.emergencyBalance;
    let currentSimPortfolio = getPortfolioMarketValue();

    for (let m = 0; m <= months; m++) {
        if (m % 6 === 0 || m === months) {
            labels.push(`第 ${(m / 12).toFixed(1)} 年`);
            principalData.push(Math.round(currentPrincipal));
            compoundData.push(Math.round(currentSimEmergency + currentSimPortfolio));
        }

        currentSimPortfolio = currentSimPortfolio * (1 + monthlyRate);
        const gap = Math.max(0, emergencyCap - currentSimEmergency);
        const toEmergency = Math.min(monthlyDeposit, gap, appState.settings.monthlyEmergencyMax);
        const toPortfolio = monthlyDeposit - toEmergency;

        currentSimEmergency += toEmergency;
        currentSimPortfolio += toPortfolio;
        currentPrincipal += monthlyDeposit;
    }

    if (projectionChartInstance) {
        projectionChartInstance.destroy();
    }

    projectionChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: `進攻組合複利走勢 (加權年化 ${getWeightedReturnRate().toFixed(1)}%)`,
                    data: compoundData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    fill: true,
                    tension: 0.35,
                    borderWidth: 3,
                    pointRadius: 3,
                    pointHoverRadius: 6
                },
                {
                    label: '累積純本金 (無投資)',
                    data: principalData,
                    borderColor: '#94a3b8',
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.1,
                    borderWidth: 2,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: '#cbd5e1', font: { family: 'Inter', size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: NT$ ${formatCurrency(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 10 },
                        callback: function(val) {
                            return val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : `${val / 1000}k`;
                        }
                    }
                }
            }
        }
    });
}

// ==============================
// 7. 調薪與沙盤即時互動 (What-If)
// ==============================

function updateSimulationOutput() {
    const deposit = Number(document.getElementById('sliderDeposit').value);
    const rate = Number(document.getElementById('sliderRate').value);

    document.getElementById('sliderDepositVal').textContent = `NT$ ${formatCurrency(deposit)}`;
    document.getElementById('sliderRateVal').textContent = `${rate.toFixed(1)} %`;

    const { monthsTo1M, monthsTo10M } = simulateFutureMilestones(deposit, rate);

    document.getElementById('simResult1M').textContent = monthsTo1M 
        ? `${Math.floor(monthsTo1M / 12)} 年 ${monthsTo1M % 12} 個月` 
        : '已達成';

    document.getElementById('simResult10M').textContent = monthsTo10M 
        ? `${Math.floor(monthsTo10M / 12)} 年 ${monthsTo10M % 12} 個月` 
        : '超過 60 年';
}

// ==============================
// 8. 特效與慶祝粒子 (Confetti)
// ==============================

function triggerGoldConfetti() {
    if (typeof confetti === 'function') {
        confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#fbbf24', '#f59e0b', '#10b981', '#ffffff']
        });
    }
}

// ==============================
// 9. 多標的配置管理面板 (Settings Modal 專用)
// ==============================

let tempPortfolioConfig = [];

function initSettingsPortfolioManager() {
    tempPortfolioConfig = JSON.parse(JSON.stringify(appState.portfolio || DEFAULT_STATE.portfolio));
    renderSettingsPortfolioList();
}

function renderSettingsPortfolioList() {
    const listContainer = document.getElementById('settingsPortfolioList');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    let totalRatio = 0;
    let weightedRateSum = 0;

    tempPortfolioConfig.forEach((asset, idx) => {
        totalRatio += Number(asset.ratio) || 0;
        weightedRateSum += (Number(asset.ratio) || 0) * (Number(asset.expectedRate) || 0);

        const row = document.createElement('div');
        row.className = 'p-2 rounded bg-dark border border-secondary-subtle d-flex flex-column gap-1';

        row.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <span class="xsmall text-gold fw-bold">標的 #${idx + 1}</span>
                ${tempPortfolioConfig.length > 1 ? `
                    <button type="button" class="btn btn-link text-danger p-0 xsmall text-decoration-none btn-remove-asset" data-idx="${idx}">
                        <i class="bi bi-trash"></i> 移除
                    </button>
                ` : ''}
            </div>
            <div class="row g-2 align-items-center">
                <div class="col-6">
                    <input type="text" class="form-control form-control-sm form-control-dark asset-input-name" data-idx="${idx}" value="${asset.name}" placeholder="標的名稱 (如 0050)" required>
                </div>
                <div class="col-3">
                    <div class="input-group input-group-sm">
                        <input type="number" class="form-control form-control-dark asset-input-ratio" data-idx="${idx}" min="1" max="100" value="${asset.ratio}" required>
                        <span class="input-group-text bg-dark border-secondary text-secondary p-1 xsmall">%</span>
                    </div>
                </div>
                <div class="col-3">
                    <div class="input-group input-group-sm">
                        <input type="number" class="form-control form-control-dark asset-input-rate" data-idx="${idx}" step="0.1" min="1" max="30" value="${asset.expectedRate}" required>
                        <span class="input-group-text bg-dark border-secondary text-secondary p-1 xsmall">年化%</span>
                    </div>
                </div>
            </div>
        `;
        listContainer.appendChild(row);
    });

    // 檢核總配比
    const ratioCheckElem = document.getElementById('textTotalRatioCheck');
    const alertElem = document.getElementById('alertRatioError');
    const saveBtn = document.querySelector('#formSettings button[type="submit"]');

    ratioCheckElem.textContent = `${totalRatio}%`;
    const weightedAvg = totalRatio > 0 ? (weightedRateSum / totalRatio).toFixed(1) : '0.0';
    document.getElementById('textWeightedRatePreview').textContent = `${weightedAvg}%`;

    if (totalRatio === 100) {
        ratioCheckElem.className = 'fw-bold text-success';
        alertElem.classList.add('d-none');
        if (saveBtn) saveBtn.disabled = false;
    } else {
        ratioCheckElem.className = 'fw-bold text-danger';
        alertElem.textContent = `⚠️ 各標的配比加總目前為 ${totalRatio}%，必須剛好等於 100% 才能儲存！`;
        alertElem.classList.remove('d-none');
        if (saveBtn) saveBtn.disabled = true;
    }

    // 綁定輸入即時更新事件
    listContainer.querySelectorAll('.asset-input-name').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = Number(e.target.getAttribute('data-idx'));
            tempPortfolioConfig[idx].name = e.target.value;
        });
    });

    listContainer.querySelectorAll('.asset-input-ratio').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = Number(e.target.getAttribute('data-idx'));
            tempPortfolioConfig[idx].ratio = Number(e.target.value) || 0;
            renderSettingsPortfolioList();
        });
    });

    listContainer.querySelectorAll('.asset-input-rate').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = Number(e.target.getAttribute('data-idx'));
            tempPortfolioConfig[idx].expectedRate = Number(e.target.value) || 0;
            renderSettingsPortfolioList();
        });
    });

    listContainer.querySelectorAll('.btn-remove-asset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = Number(btn.getAttribute('data-idx'));
            tempPortfolioConfig.splice(idx, 1);
            renderSettingsPortfolioList();
        });
    });
}

// ==============================
// 10. 事件監聽與控制器綁定
// ==============================

document.addEventListener('DOMContentLoaded', () => {
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById('depositDate').value = todayStr;

    // 目標切換 (100萬 vs 1000萬)
    document.querySelectorAll('input[name="targetGoalToggle"]').forEach(elem => {
        elem.addEventListener('change', (e) => {
            appState.settings.currentGoal = Number(e.target.value);
            saveState();
            updateUI();
        });
    });

    // 入帳打卡即時預覽分流
    const depositAmountInput = document.getElementById('depositAmount');
    const lumpSumSwitch = document.getElementById('switchLumpSum');
    const depositTypeRadios = document.querySelectorAll('input[name="depositType"]');
    const breakdownContainer = document.getElementById('previewPortfolioBreakdown');

    function refreshDepositPreview() {
        const amt = Number(depositAmountInput.value) || 0;
        const isLump = lumpSumSwitch.checked;
        const alloc = calculateAllocation(amt, isLump);

        document.getElementById('previewEmergency').textContent = `+ NT$ ${formatCurrency(alloc.toEmergency)}`;
        document.getElementById('previewEtf').textContent = `+ NT$ ${formatCurrency(alloc.overflowAmount)}`;

        // 展開多標的分流清單
        if (alloc.overflowAmount > 0 && alloc.assetAllocations.length > 0) {
            breakdownContainer.classList.remove('d-none');
            breakdownContainer.innerHTML = alloc.assetAllocations.map(a => `
                <div class="d-flex justify-content-between align-items-center py-1">
                    <span class="text-secondary">${a.name} (${a.ratio}%):</span>
                    <span class="fw-bold text-emerald">+ NT$ ${formatCurrency(a.amount)}</span>
                </div>
            `).join('');
        } else {
            breakdownContainer.classList.add('d-none');
            breakdownContainer.innerHTML = '';
        }

        const note = document.getElementById('previewNote');
        if (appState.accounts.emergencyBalance >= appState.settings.emergencyCap) {
            note.textContent = '🎉 高利活存已滿額，全額 100% 溢流灌注核心進攻組合！';
            note.className = 'xsmall text-emerald border-top border-secondary-subtle pt-1 mt-2 fw-bold';
        } else if (alloc.isFullNow) {
            note.textContent = '🛡️ 本次存入將使高利活存達到 12 萬封頂！超出部分全數分流至進攻組合。';
            note.className = 'xsmall text-gold border-top border-secondary-subtle pt-1 mt-2 fw-bold';
        } else {
            note.textContent = `活存尚未滿額，撥款 $${formatCurrency(alloc.toEmergency)}，其餘 $${formatCurrency(alloc.overflowAmount)} 依配比注入進攻組合。`;
            note.className = 'xsmall text-muted border-top border-secondary-subtle pt-1 mt-2';
        }
    }

    depositAmountInput.addEventListener('input', refreshDepositPreview);
    lumpSumSwitch.addEventListener('change', refreshDepositPreview);

    depositTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'BONUS') {
                lumpSumSwitch.checked = true;
            } else {
                depositAmountInput.value = appState.settings.monthlyDeposit;
                lumpSumSwitch.checked = false;
            }
            refreshDepositPreview();
        });
    });

    // 表單提交：入帳打卡
    document.getElementById('formDeposit').addEventListener('submit', (e) => {
        e.preventDefault();
        const date = document.getElementById('depositDate').value;
        const amount = Number(depositAmountInput.value);
        const type = document.querySelector('input[name="depositType"]:checked').value;
        const isLump = lumpSumSwitch.checked;
        const note = document.getElementById('depositNote').value.trim();

        if (amount <= 0) return;

        const alloc = calculateAllocation(amount, isLump);

        // 1. 更新活存帳戶
        appState.accounts.emergencyBalance += alloc.toEmergency;

        // 2. 更新多標的投資組合帳戶
        alloc.assetAllocations.forEach(a => {
            const asset = appState.portfolio.find(p => p.id === a.id);
            if (asset) {
                asset.principal += a.amount;
                asset.marketValue += a.amount;
            }
        });

        // 3. 寫入流水帳
        const newTx = {
            id: Date.now(),
            date,
            type,
            amount,
            toEmergency: alloc.toEmergency,
            toEtf: alloc.overflowAmount,
            assetBreakdown: alloc.assetAllocations,
            note: note || (type === 'REGULAR' ? '每月例行儲蓄入帳' : '額外結餘/獎金加碼')
        };
        appState.transactions.push(newTx);

        saveState();
        updateUI();

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('depositModal'));
        if (modal) modal.hide();

        document.getElementById('depositNote').value = '';
        triggerGoldConfetti();
    });

    // 快捷例行打卡
    document.getElementById('btnRegularDepositQuick').addEventListener('click', () => {
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('depositModal'));
        document.getElementById('typeRegular').checked = true;
        depositAmountInput.value = appState.settings.monthlyDeposit;
        lumpSumSwitch.checked = false;
        refreshDepositPreview();
        modal.show();
    });

    // 市值校正 Modal 開啟時同步標的清單與數值
    const selectRevalueAsset = document.getElementById('selectRevalueAsset');
    const selectDividendAsset = document.getElementById('selectDividendAsset');

    function syncRecalibrateModalData() {
        selectRevalueAsset.innerHTML = '';
        selectDividendAsset.innerHTML = '';

        appState.portfolio.forEach(asset => {
            const opt1 = document.createElement('option');
            opt1.value = asset.id;
            opt1.textContent = `${asset.name} (${asset.ratio}%)`;
            selectRevalueAsset.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = asset.id;
            opt2.textContent = `${asset.name} (${asset.ratio}%)`;
            selectDividendAsset.appendChild(opt2);
        });

        updateRevalueSelectedAssetDisplay();
    }

    function updateRevalueSelectedAssetDisplay() {
        const selectedId = selectRevalueAsset.value;
        const asset = appState.portfolio.find(a => a.id === selectedId) || appState.portfolio[0];
        if (asset) {
            document.getElementById('labelCurrentEtfPrincipal').textContent = `NT$ ${formatCurrency(asset.principal || 0)}`;
            document.getElementById('labelCurrentEtfMarketVal').textContent = `NT$ ${formatCurrency(asset.marketValue || 0)}`;
            document.getElementById('inputActualMarketVal').value = asset.marketValue || 0;
        }
    }

    selectRevalueAsset.addEventListener('change', updateRevalueSelectedAssetDisplay);
    document.getElementById('recalibrateModal').addEventListener('show.bs.modal', syncRecalibrateModalData);

    // 市值校正提交
    document.getElementById('formRevalue').addEventListener('submit', (e) => {
        e.preventDefault();
        const selectedId = selectRevalueAsset.value;
        const asset = appState.portfolio.find(a => a.id === selectedId);
        if (!asset) return;

        const newVal = Number(document.getElementById('inputActualMarketVal').value);
        if (newVal < 0) return;

        const diff = newVal - (asset.marketValue || 0);
        asset.marketValue = newVal;

        appState.transactions.push({
            id: Date.now(),
            date: new Date().toISOString().split('T')[0],
            type: 'REVALUE',
            amount: newVal,
            toEmergency: 0,
            toEtf: diff,
            targetAssetId: asset.id,
            note: `${asset.name} 市值現值校正 (${diff >= 0 ? '+' : ''}${formatCurrency(diff)})`
        });

        saveState();
        updateUI();

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('recalibrateModal'));
        if (modal) modal.hide();
        triggerGoldConfetti();
    });

    // 股息再投入提交
    document.getElementById('formDividend').addEventListener('submit', (e) => {
        e.preventDefault();
        const selectedId = selectDividendAsset.value;
        const asset = appState.portfolio.find(a => a.id === selectedId);
        if (!asset) return;

        const divAmt = Number(document.getElementById('inputDividendAmt').value);
        const action = document.getElementById('dividendAction').value;
        if (divAmt <= 0) return;

        let toEmerg = 0;
        let toEtf = 0;

        if (action === 'TO_EMERGENCY') {
            toEmerg = divAmt;
            appState.accounts.emergencyBalance += divAmt;
        } else {
            toEtf = divAmt;
            asset.principal += divAmt;
            asset.marketValue += divAmt;
        }

        appState.transactions.push({
            id: Date.now(),
            date: new Date().toISOString().split('T')[0],
            type: 'DIVIDEND',
            amount: divAmt,
            toEmergency: toEmerg,
            toEtf: toEtf,
            targetAssetId: asset.id,
            assetBreakdown: [{ id: asset.id, name: asset.name, amount: toEtf }],
            note: `${asset.name} 股息再投入 (${action === 'TO_EMERGENCY' ? '轉入活存' : '再買進'})`
        });

        saveState();
        updateUI();

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('recalibrateModal'));
        if (modal) modal.hide();
        document.getElementById('inputDividendAmt').value = '';
        triggerGoldConfetti();
    });

    // 設定中心開啟與標的管理器初始化
    document.getElementById('settingsModal').addEventListener('show.bs.modal', () => {
        document.getElementById('settingMonthlyDeposit').value = appState.settings.monthlyDeposit;
        document.getElementById('settingEmergencyCap').value = appState.settings.emergencyCap;
        document.getElementById('settingMonthlyEmergencyRate').value = appState.settings.monthlyEmergencyMax;
        initSettingsPortfolioManager();
    });

    // 新增標的按鈕
    document.getElementById('btnAddPortfolioAsset').addEventListener('click', () => {
        const newIdx = tempPortfolioConfig.length + 1;
        tempPortfolioConfig.push({
            id: `asset_${Date.now()}`,
            name: `美股大盤 VOO`,
            ratio: 0,
            expectedRate: 8.0,
            principal: 0,
            marketValue: 0
        });
        renderSettingsPortfolioList();
    });

    // 設定儲存提交
    document.getElementById('formSettings').addEventListener('submit', (e) => {
        e.preventDefault();

        // 檢核總配比
        const totalRatio = tempPortfolioConfig.reduce((sum, a) => sum + (Number(a.ratio) || 0), 0);
        if (totalRatio !== 100) {
            alert(`各標的配比總和為 ${totalRatio}%，必須剛好等於 100% 才能儲存！`);
            return;
        }

        const newMonthly = Number(document.getElementById('settingMonthlyDeposit').value);
        const newCap = Number(document.getElementById('settingEmergencyCap').value);
        const newMaxRate = Number(document.getElementById('settingMonthlyEmergencyRate').value);

        appState.settings.monthlyDeposit = newMonthly;
        appState.settings.emergencyCap = newCap;
        appState.settings.monthlyEmergencyMax = newMaxRate;

        // 保留各標的原有的本金與市值，只更新配置參數
        appState.portfolio = tempPortfolioConfig.map(t => {
            const existing = appState.portfolio.find(p => p.id === t.id);
            return {
                id: t.id,
                name: t.name.trim() || '未命名標的',
                ratio: Number(t.ratio) || 0,
                expectedRate: Number(t.expectedRate) || 7.0,
                principal: existing ? existing.principal : 0,
                marketValue: existing ? existing.marketValue : 0
            };
        });

        // 同步沙盤滑桿
        document.getElementById('sliderDeposit').value = newMonthly;
        document.getElementById('sliderRate').value = getWeightedReturnRate();

        saveState();
        updateUI();

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('settingsModal'));
        if (modal) modal.hide();
        triggerGoldConfetti();
    });

    // 重設全部資料
    document.getElementById('btnResetAllData').addEventListener('click', () => {
        if (confirm('警告：確定要清空所有存錢紀錄與設定嗎？此操作不可逆！')) {
            localStorage.removeItem(STORAGE_KEY);
            appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
            saveState();
            updateUI();
            const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('settingsModal'));
            if (modal) modal.hide();
        }
    });

    // 沙盤滑桿即時互動
    document.getElementById('sliderDeposit').addEventListener('input', updateSimulationOutput);
    document.getElementById('sliderRate').addEventListener('input', updateSimulationOutput);

    // 套用沙盤為正式設定
    document.getElementById('btnApplySimulation').addEventListener('click', () => {
        const deposit = Number(document.getElementById('sliderDeposit').value);
        appState.settings.monthlyDeposit = deposit;
        saveState();
        updateUI();
        triggerGoldConfetti();
        alert(`已成功套用新每月預設存入本金：NT$ ${formatCurrency(deposit)}`);
    });

    // 走勢圖年份範圍切換
    document.querySelectorAll('.btn-chart-range').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-chart-range').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentChartYears = Number(e.target.getAttribute('data-years'));
            renderProjectionChart();
        });
    });

    // 匯出備份 JSON
    document.getElementById('btnExportData').addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appState, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `wealth_horizon_backup_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    });

    // 匯入備份 JSON
    document.getElementById('importFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target.result);
                if (imported.settings && (imported.portfolio || imported.accounts)) {
                    appState = imported;
                    // 確保向下相容
                    if (!appState.portfolio || appState.portfolio.length === 0) {
                        appState.portfolio = JSON.parse(JSON.stringify(DEFAULT_STATE.portfolio));
                    }
                    saveState();
                    updateUI();
                    triggerGoldConfetti();
                    alert('資料備份還原成功！');
                } else {
                    alert('檔案格式不符，請匯入正確的備份 JSON。');
                }
            } catch (err) {
                alert('解析 JSON 檔案失敗。');
            }
        };
        reader.readAsText(file);
    });

    // 初始化應用程式
    updateUI();
    refreshDepositPreview();
});
