/**
 * WEALTH HORIZON - Wealth Milestone & Dynamic Allocation System
 * 核心演算法、狀態管理、動態水位感應、複利推演與視覺互動模組
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
        annualReturnRate: 7.0,           // 0050 預期年化報酬率 (%)
        currentGoal: 1000000             // 當前聚焦目標: 100萬 或 1000萬
    },
    accounts: {
        emergencyBalance: 0,             // 當前高利活存實際餘額
        etfPrincipal: 0,                 // 0050 累計投入本金
        etfMarketValue: 0                // 0050 真實市值 (未手動校正時等於本金)
    },
    transactions: []                     // 流水帳歷史紀錄
};

let appState = loadState();
let projectionChartInstance = null;
let currentChartYears = 5;

// ==============================
// 2. 狀態持久化 (LocalStorage)
// ==============================

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
                accounts: { ...DEFAULT_STATE.accounts, ...(parsed.accounts || {}) },
                transactions: parsed.transactions || []
            };
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
// 3. 核心演算法：動態分流與溢流感應
// ==============================

/**
 * 水位感應動態分流演算法
 * @param {number} depositAmount - 欲存入金額
 * @param {boolean} isLumpSum - 是否開啟加速全額補滿
 */
function calculateAllocation(depositAmount, isLumpSum = false) {
    const { emergencyCap, monthlyEmergencyMax } = appState.settings;
    const currentEmergency = appState.accounts.emergencyBalance;

    // 1. 計算活存距離滿額的實質缺口
    const gap = Math.max(0, emergencyCap - currentEmergency);
    let toEmergency = 0;

    if (gap > 0) {
        if (isLumpSum) {
            // 加速補滿模式：優先把缺口全部填滿
            toEmergency = Math.min(depositAmount, gap);
        } else {
            // 常規存入模式：最多撥款 monthlyEmergencyMax (15,000)，但若缺口更小則僅補缺口
            toEmergency = Math.min(depositAmount, gap, monthlyEmergencyMax);
        }
    }

    // 2. 自動溢流：超出高利活存分配額度的資金，100% 導向 0050 ETF
    const toEtf = depositAmount - toEmergency;

    return {
        toEmergency,
        toEtf,
        isFullNow: (currentEmergency + toEmergency) >= emergencyCap,
        remainingGap: Math.max(0, gap - toEmergency)
    };
}

/**
 * 未來資產與達標月份推演演算法 (支援調薪動態重算)
 * 歷史帳本不變，以「當前總資產」為基準，套用未來每月新存款額與複利向未來模擬
 */
function simulateFutureMilestones(customMonthlyDeposit = null, customRate = null) {
    const monthlyDeposit = customMonthlyDeposit !== null ? customMonthlyDeposit : appState.settings.monthlyDeposit;
    const annualRate = (customRate !== null ? customRate : appState.settings.annualReturnRate) / 100;
    const monthlyRate = annualRate / 12;

    const { emergencyCap, monthlyEmergencyMax } = appState.settings;

    let simEmergency = appState.accounts.emergencyBalance;
    let simEtf = appState.accounts.etfMarketValue;

    let monthsTo1M = null;
    let monthsTo10M = null;

    const MAX_SIM_MONTHS = 12 * 60; // 最多推算 60 年

    for (let m = 1; m <= MAX_SIM_MONTHS; m++) {
        // 1. 0050 既有資產當月複利生息
        simEtf = simEtf * (1 + monthlyRate);

        // 2. 當月資金注入分流
        const gap = Math.max(0, emergencyCap - simEmergency);
        let toEmergency = 0;
        if (gap > 0) {
            toEmergency = Math.min(monthlyDeposit, gap, monthlyEmergencyMax);
        }
        const toEtf = monthlyDeposit - toEmergency;

        simEmergency += toEmergency;
        simEtf += toEtf;

        const currentNetWorth = simEmergency + simEtf;

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
// 4. UI 渲染引擎
// ==============================

function formatCurrency(num) {
    return Math.round(num).toLocaleString('en-US');
}

function updateUI() {
    const { emergencyBalance, etfPrincipal, etfMarketValue } = appState.accounts;
    const { monthlyDeposit, emergencyCap, currentGoal, annualReturnRate } = appState.settings;

    const totalNetWorth = emergencyBalance + etfMarketValue;
    const totalPrincipal = emergencyBalance + etfPrincipal;
    const unrealizedProfit = etfMarketValue - etfPrincipal;

    // 1. 總資產與頂部指標
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

    // 3. 雙水庫動態水位更新
    updateReservoirs();

    // 4. 里程碑倒數推演更新
    updateCountdownAndEstimation();

    // 5. RPG 里程碑地圖渲染
    renderMilestonesRoadmap(totalNetWorth);

    // 6. 流水帳表格渲染
    renderTransactionTable();

    // 7. 更新設定值與沙盤標籤
    document.getElementById('labelEmergencyCap').textContent = formatCurrency(emergencyCap);
    document.getElementById('badgeActiveRate').textContent = `每月存 NT$ ${formatCurrency(monthlyDeposit)}`;
    document.getElementById('hintCurrentMonthlySetting').textContent = `預設：$${formatCurrency(monthlyDeposit)}`;

    // 8. 走勢圖更新
    renderProjectionChart();

    // 9. 更新試算沙盤
    updateSimulationOutput();
}

/**
 * 雙水庫視覺渲染
 */
function updateReservoirs() {
    const { emergencyBalance, etfPrincipal, etfMarketValue } = appState.accounts;
    const { emergencyCap, currentGoal, annualReturnRate } = appState.settings;

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
        document.getElementById('textEmergencyMonthsLeft').textContent = '✅ 已完全防禦，資金全數溢流至 0050';
    } else {
        badgeEmergency.textContent = '充能蓄水中';
        badgeEmergency.className = 'badge bg-primary-subtle text-primary rounded-pill';
        liquidBoxBlue.classList.remove('full-tank');
        const monthsLeft = Math.ceil(deficit / Math.min(deficit, appState.settings.monthlyEmergencyMax));
        document.getElementById('textEmergencyMonthsLeft').textContent = `約需 ${monthsLeft} 個月完成`;
    }

    // 水庫 B: 0050 ETF
    // 以當前目標為基準計算水位比例
    const etfPercent = Math.min(100, (etfMarketValue / currentGoal) * 100);
    document.getElementById('waveEtf').style.height = `${etfPercent}%`;
    document.getElementById('textEtfPercent').textContent = `${etfPercent.toFixed(1)}%`;
    document.getElementById('textEtfCurrent').textContent = `市值 NT$ ${formatCurrency(etfMarketValue)}`;
    document.getElementById('textEtfPrincipal').textContent = `NT$ ${formatCurrency(etfPrincipal)}`;
    document.getElementById('textEtfRatePreview').textContent = `預期年化 ${annualReturnRate.toFixed(1)}%`;

    const badgeEtfMode = document.getElementById('badgeEtfMode');
    if (emergencyBalance >= emergencyCap) {
        badgeEtfMode.textContent = '🚀 全額全速溢流中';
        badgeEtfMode.className = 'badge bg-gold-subtle text-gold rounded-pill fw-bold';
    } else {
        badgeEtfMode.textContent = '🌱 分流累積中';
        badgeEtfMode.className = 'badge bg-emerald-subtle text-emerald rounded-pill';
    }
}

/**
 * 預估達標日期與倒數天數計算
 */
function updateCountdownAndEstimation() {
    const totalNetWorth = appState.accounts.emergencyBalance + appState.accounts.etfMarketValue;
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

    // 計算目標西元年與月份
    const today = new Date();
    const targetDate = new Date(today.getFullYear(), today.getMonth() + neededMonths, today.getDate());

    const estYear = targetDate.getFullYear();
    const estMonth = targetDate.getMonth() + 1;
    document.getElementById('statEstimatedDate').textContent = `${estYear} 年 ${estMonth} 月`;

    document.getElementById('countdownMonths').textContent = neededMonths;
    document.getElementById('countdownDays').textContent = neededMonths * 30;

    // 激勵標語動態變化
    const encouragement = document.getElementById('textEncouragement');
    if (neededMonths <= 6) {
        encouragement.textContent = '🔥 終點就在眼前！保持節奏，最後一哩路即將衝線！';
    } else if (appState.accounts.emergencyBalance >= appState.settings.emergencyCap) {
        encouragement.textContent = '🛡️ 防禦盾牌已滿！現在每存一筆錢，都是 100% 灌入 0050 滾動複利！';
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

    // 計算進度條寬度百分比
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
            typeBadge = '<span class="badge bg-emerald-subtle text-emerald">0050 股息</span>';
        } else if (tx.type === 'REVALUE') {
            typeBadge = '<span class="badge bg-info-subtle text-info">市值校正</span>';
        }

        tr.innerHTML = `
            <td class="text-secondary">${tx.date}</td>
            <td>${typeBadge}</td>
            <td class="text-end fw-bold text-white">NT$ ${formatCurrency(tx.amount)}</td>
            <td class="text-end text-primary">+ NT$ ${formatCurrency(tx.toEmergency)}</td>
            <td class="text-end text-emerald">+ NT$ ${formatCurrency(tx.toEtf)}</td>
            <td class="text-secondary small">${tx.note || '-'}</td>
            <td class="text-center">
                <button type="button" class="btn btn-outline-danger btn-sm p-1 px-2 btn-delete-tx" data-id="${tx.id}" title="撤銷這筆紀錄">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 綁定刪除事件
    tbody.querySelectorAll('.btn-delete-tx').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = Number(btn.getAttribute('data-id'));
            deleteTransaction(id);
        });
    });
}

/**
 * 刪除流水帳並反向還原帳戶水位
 */
function deleteTransaction(txId) {
    const tx = appState.transactions.find(t => t.id === txId);
    if (!tx) return;

    if (!confirm(`確定要撤銷 ${tx.date} 這筆 NT$ ${formatCurrency(tx.amount)} 的紀錄嗎？\n系統將自動回退水庫水位。`)) {
        return;
    }

    if (tx.type === 'REVALUE') {
        // 市值校正還原回本金
        appState.accounts.etfMarketValue = appState.accounts.etfPrincipal;
    } else {
        appState.accounts.emergencyBalance = Math.max(0, appState.accounts.emergencyBalance - tx.toEmergency);
        appState.accounts.etfPrincipal = Math.max(0, appState.accounts.etfPrincipal - tx.toEtf);
        appState.accounts.etfMarketValue = Math.max(0, appState.accounts.etfMarketValue - tx.toEtf);
    }

    appState.transactions = appState.transactions.filter(t => t.id !== txId);
    saveState();
    updateUI();
}

// ==============================
// 5. Chart.js 未來 30 年複利沙盤走勢圖
// ==============================

function renderProjectionChart() {
    const ctx = document.getElementById('projectionChart');
    if (!ctx) return;

    const years = currentChartYears;
    const months = years * 12;
    const { monthlyDeposit, emergencyCap, annualReturnRate } = appState.settings;
    const monthlyRate = (annualReturnRate / 100) / 12;

    const labels = [];
    const principalData = [];
    const compoundData = [];

    let currentPrincipal = appState.accounts.emergencyBalance + appState.accounts.etfPrincipal;
    let currentSimEmergency = appState.accounts.emergencyBalance;
    let currentSimEtf = appState.accounts.etfMarketValue;

    for (let m = 0; m <= months; m++) {
        if (m % 6 === 0 || m === months) {
            labels.push(`第 ${(m / 12).toFixed(1)} 年`);
            principalData.push(Math.round(currentPrincipal));
            compoundData.push(Math.round(currentSimEmergency + currentSimEtf));
        }

        // 下個月複利與注資
        currentSimEtf = currentSimEtf * (1 + monthlyRate);
        const gap = Math.max(0, emergencyCap - currentSimEmergency);
        const toEmergency = Math.min(monthlyDeposit, gap, appState.settings.monthlyEmergencyMax);
        const toEtf = monthlyDeposit - toEmergency;

        currentSimEmergency += toEmergency;
        currentSimEtf += toEtf;
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
                    label: '0050 複利資產走勢 (含本金與年化7%複利)',
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
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    labels: { color: '#cbd5e1', font: { family: 'Inter', size: 11 } }
                },
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
// 6. 調薪與沙盤即時互動 (What-If)
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
// 7. 特效與慶祝粒子 (Confetti)
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
// 8. 事件監聽與控制器綁定
// ==============================

document.addEventListener('DOMContentLoaded', () => {
    // 預設日期為今天 (格式 YYYY-MM-DD)，若尚未到 2/5 則可預設為 2026-02-05
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

    // 入帳表單：存入金額即時試算預覽
    const depositAmountInput = document.getElementById('depositAmount');
    const lumpSumSwitch = document.getElementById('switchLumpSum');
    const depositTypeRadios = document.querySelectorAll('input[name="depositType"]');

    function refreshDepositPreview() {
        const amt = Number(depositAmountInput.value) || 0;
        const isLump = lumpSumSwitch.checked;
        const alloc = calculateAllocation(amt, isLump);

        document.getElementById('previewEmergency').textContent = `+ NT$ ${formatCurrency(alloc.toEmergency)}`;
        document.getElementById('previewEtf').textContent = `+ NT$ ${formatCurrency(alloc.toEtf)}`;

        const note = document.getElementById('previewNote');
        if (appState.accounts.emergencyBalance >= appState.settings.emergencyCap) {
            note.textContent = '🎉 高利活存已滿額，全額 100% 溢流灌注 0050 ETF！';
            note.className = 'xsmall text-emerald border-top border-secondary-subtle pt-1 fw-bold';
        } else if (alloc.isFullNow) {
            note.textContent = '🛡️ 本次存入將使高利活存達到 12 萬封頂！超出部分全溢流至 0050。';
            note.className = 'xsmall text-gold border-top border-secondary-subtle pt-1 fw-bold';
        } else {
            note.textContent = `活存尚未滿額，撥款 $${formatCurrency(alloc.toEmergency)}，其餘 $${formatCurrency(alloc.toEtf)} 注入 0050。`;
            note.className = 'xsmall text-muted border-top border-secondary-subtle pt-1';
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

        // 更新帳戶
        appState.accounts.emergencyBalance += alloc.toEmergency;
        appState.accounts.etfPrincipal += alloc.toEtf;
        appState.accounts.etfMarketValue += alloc.toEtf;

        // 寫入交易日誌
        const newTx = {
            id: Date.now(),
            date,
            type,
            amount,
            toEmergency: alloc.toEmergency,
            toEtf: alloc.toEtf,
            note: note || (type === 'REGULAR' ? '每月例行儲蓄入帳' : '額外結餘/獎金加碼')
        };
        appState.transactions.push(newTx);

        saveState();
        updateUI();

        // 關閉 Modal
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('depositModal'));
        if (modal) modal.hide();

        // 重置表單並觸發噴彩粒子
        document.getElementById('depositNote').value = '';
        triggerGoldConfetti();
    });

    // 快捷例行打卡按鈕
    document.getElementById('btnRegularDepositQuick').addEventListener('click', () => {
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('depositModal'));
        document.getElementById('typeRegular').checked = true;
        depositAmountInput.value = appState.settings.monthlyDeposit;
        lumpSumSwitch.checked = false;
        refreshDepositPreview();
        modal.show();
    });

    // 市值校正 Modal 開啟時同步數值
    document.getElementById('recalibrateModal').addEventListener('show.bs.modal', () => {
        document.getElementById('labelCurrentEtfPrincipal').textContent = `NT$ ${formatCurrency(appState.accounts.etfPrincipal)}`;
        document.getElementById('labelCurrentEtfMarketVal').textContent = `NT$ ${formatCurrency(appState.accounts.etfMarketValue)}`;
        document.getElementById('inputActualMarketVal').value = appState.accounts.etfMarketValue;
    });

    // 市值校正提交
    document.getElementById('formRevalue').addEventListener('submit', (e) => {
        e.preventDefault();
        const newVal = Number(document.getElementById('inputActualMarketVal').value);
        if (newVal < 0) return;

        const diff = newVal - appState.accounts.etfMarketValue;
        appState.accounts.etfMarketValue = newVal;

        appState.transactions.push({
            id: Date.now(),
            date: new Date().toISOString().split('T')[0],
            type: 'REVALUE',
            amount: newVal,
            toEmergency: 0,
            toEtf: diff,
            note: `0050 市值現值校正 (${diff >= 0 ? '+' : ''}${formatCurrency(diff)})`
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
            appState.accounts.etfPrincipal += divAmt;
            appState.accounts.etfMarketValue += divAmt;
        }

        appState.transactions.push({
            id: Date.now(),
            date: new Date().toISOString().split('T')[0],
            type: 'DIVIDEND',
            amount: divAmt,
            toEmergency: toEmerg,
            toEtf: toEtf,
            note: `0050 股息再投入 (${action === 'TO_EMERGENCY' ? '注入活存' : '買進0050'})`
        });

        saveState();
        updateUI();

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('recalibrateModal'));
        if (modal) modal.hide();
        document.getElementById('inputDividendAmt').value = '';
        triggerGoldConfetti();
    });

    // 設定中心開啟與提交 (調薪修改)
    document.getElementById('settingsModal').addEventListener('show.bs.modal', () => {
        document.getElementById('settingMonthlyDeposit').value = appState.settings.monthlyDeposit;
        document.getElementById('settingEmergencyCap').value = appState.settings.emergencyCap;
        document.getElementById('settingMonthlyEmergencyRate').value = appState.settings.monthlyEmergencyMax;
        document.getElementById('settingEtfAnnualRate').value = appState.settings.annualReturnRate;
    });

    document.getElementById('formSettings').addEventListener('submit', (e) => {
        e.preventDefault();
        const newMonthly = Number(document.getElementById('settingMonthlyDeposit').value);
        const newCap = Number(document.getElementById('settingEmergencyCap').value);
        const newMaxRate = Number(document.getElementById('settingMonthlyEmergencyRate').value);
        const newAnnualRate = Number(document.getElementById('settingEtfAnnualRate').value);

        appState.settings.monthlyDeposit = newMonthly;
        appState.settings.emergencyCap = newCap;
        appState.settings.monthlyEmergencyMax = newMaxRate;
        appState.settings.annualReturnRate = newAnnualRate;

        // 同步沙盤滑桿
        document.getElementById('sliderDeposit').value = newMonthly;
        document.getElementById('sliderRate').value = newAnnualRate;

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
        const rate = Number(document.getElementById('sliderRate').value);

        appState.settings.monthlyDeposit = deposit;
        appState.settings.annualReturnRate = rate;
        saveState();
        updateUI();
        triggerGoldConfetti();
        alert(`已成功套用新策略！\n未來每月預設存入：NT$ ${formatCurrency(deposit)}\n0050 預期年化報酬率：${rate.toFixed(1)}%`);
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
                if (imported.settings && imported.accounts) {
                    appState = imported;
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
