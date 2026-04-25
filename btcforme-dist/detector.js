// detector.js - 专业交易算法模型 v6.0（优化版）
// ───────────────────────────────────────────────
// 优化内容：
// 1. 删除随机因子（评分稳定性）
// 2. 插针比例从3倍降到2倍（避免漏信号）
// 3. RSI条件更严格（趋势市加边界）
// 4. 布林带条件修正（OR改AND）
// 5. 横盘降分从30降到15（避免信号误杀）
// 6. 止盈止损重新设计（更贴合实际交易）
// 7. 入场区间收窄（0.5ATR→0.3ATR）
// 8. 推送分类改为：做多/做空信号（85+）和偏多/偏空提醒（60-85）
// ───────────────────────────────────────────────

// 内存缓存（5s内复用）
var _cache = {};
function getCacheKey(interval) { return interval; }
function getCached(interval) {
  var c = _cache[getCacheKey(interval)];
  if (c && Date.now() - c.ts < 5000) return c.data;
  return null;
}
function setCache(interval, data) {
  _cache[getCacheKey(interval)] = { ts: Date.now(), data: data };
}
function clearCache(interval) {
  if (interval) delete _cache[getCacheKey(interval)];
  else Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
}

// ★ 信号历史记录
var _signalHistory = {
  lastSignalTime: 0,
  lastSignalType: null,
  lastSignalScore: 0,
  signalCount: 0,
  lastPushScore: 0,
  lastPushTime: 0
};

// ★ 交易记录和绩效分析
var _tradeHistory = [];
var _performanceStats = {
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  totalProfit: 0,
  totalLoss: 0,
  winRate: 0,
  profitFactor: 1,
  maxDrawdown: 0,
  averageProfit: 0,
  averageLoss: 0
};

// ★ 获取上次信号信息
function getLastSignalInfo() {
  return _signalHistory;
}

// ★ 信号冷却机制
function checkSignalCooldown(lastSignal, currentType) {
  var now = Date.now();
  if (!lastSignal || !lastSignal.lastSignalTime) return true;
  
  var timeSinceLastSignal = now - lastSignal.lastSignalTime;
  var lastSignalType = lastSignal.lastSignalType;
  var lastSignalScore = Math.abs(lastSignal.lastSignalScore || 0);
  
  // 优化后的冷却时间（分钟）
  var baseCooldown = 5 * 60 * 1000;       // 基础5分钟
  var sameDirectionCooldown = 10 * 60 * 1000;   // 同方向10分钟
  var oppositeDirectionCooldown = 20 * 60 * 1000; // 反向20分钟
  
  // 高分信号冷却加严
  if (lastSignalScore >= 85) {
    baseCooldown *= 1.5;
    sameDirectionCooldown *= 1.5;
    oppositeDirectionCooldown *= 2;
  } else if (lastSignalScore >= 70) {
    baseCooldown *= 1.2;
    sameDirectionCooldown *= 1.2;
    oppositeDirectionCooldown *= 1.5;
  }
  
  if (currentType && currentType !== lastSignalType) {
    oppositeDirectionCooldown *= 1.5;
  }
  
  if (timeSinceLastSignal < baseCooldown) {
    console.log('[冷却] 基础冷却，剩余:', Math.round((baseCooldown - timeSinceLastSignal) / 60000), '分钟');
    return false;
  }
  if (currentType && currentType === lastSignalType && timeSinceLastSignal < sameDirectionCooldown) {
    console.log('[冷却] 同方向信号冷却中');
    return false;
  }
  else if (currentType && currentType !== lastSignalType && timeSinceLastSignal < oppositeDirectionCooldown) {
    console.log('[冷却] 反向信号冷却中');
    return false;
  }
  if (lastSignalScore >= 75 && timeSinceLastSignal < oppositeDirectionCooldown * 1.5) {
    console.log('[冷却] 高分反向需更长冷却');
    return false;
  }
  
  return true;
}

// ★ 记录信号生成（推送分类已优化）
function recordSignal(signalType, score) {
  var lastType = _signalHistory.lastSignalType;
  var isReversal = lastType && signalType && lastType !== signalType;
  
  _signalHistory.lastSignalTime = Date.now();
  _signalHistory.lastSignalType = signalType;
  _signalHistory.lastSignalScore = score;
  _signalHistory.signalCount++;
  
  var absScore = Math.abs(score);
  if (absScore >= 60) {
    _signalHistory.lastPushScore = score;
    _signalHistory.lastPushTime = Date.now();
    
    // ★ 优化后的推送分类
    // |score| >= 85: 做多/做空信号（强）
    // 60 <= |score| < 85: 偏多/偏空提醒（弱）
    if (absScore >= 85) {
      _signalHistory.pushLevel = 'signal';      // 强信号
    } else {
      _signalHistory.pushLevel = 'caution';     // 偏信号
    }
  }
  
  if (isReversal) {
    console.log('[变盘]', signalType, score, new Date().toLocaleString());
    if (typeof window.onReversalSignal === 'function') {
      window.onReversalSignal({ type: signalType, score: score, lastType: lastType, timestamp: Date.now() });
    }
  } else {
    console.log('[信号]', signalType, score, new Date().toLocaleString());
  }
}

// ★ 记录交易
function recordTrade(trade) {
  _tradeHistory.push(trade);
  updatePerformanceStats();
}

// ★ 更新绩效统计
function updatePerformanceStats() {
  var trades = _tradeHistory;
  _performanceStats.totalTrades = trades.length;
  _performanceStats.winningTrades = trades.filter(function(t) { return t.result === 'win'; }).length;
  _performanceStats.losingTrades = trades.filter(function(t) { return t.result === 'loss'; }).length;
  _performanceStats.totalProfit = trades.filter(function(t) { return t.result === 'win'; }).reduce(function(s, t) { return s + t.profit; }, 0);
  _performanceStats.totalLoss = trades.filter(function(t) { return t.result === 'loss'; }).reduce(function(s, t) { return s + Math.abs(t.profit); }, 0);
  _performanceStats.winRate = trades.length > 0 ? (_performanceStats.winningTrades / trades.length) * 100 : 0;
  _performanceStats.profitFactor = _performanceStats.totalLoss > 0 ? _performanceStats.totalProfit / _performanceStats.totalLoss : 1;
  _performanceStats.averageProfit = _performanceStats.winningTrades > 0 ? _performanceStats.totalProfit / _performanceStats.winningTrades : 0;
  _performanceStats.averageLoss = _performanceStats.losingTrades > 0 ? _performanceStats.totalLoss / _performanceStats.losingTrades : 0;
  
  var runningProfit = 0, peak = 0, maxDrawdown = 0;
  trades.forEach(function(trade) {
    runningProfit += trade.profit;
    peak = Math.max(peak, runningProfit);
    var drawdown = peak > 0 ? (peak - runningProfit) / peak * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  });
  _performanceStats.maxDrawdown = maxDrawdown;
}

function getPerformanceStats() { return _performanceStats; }
function getTradeHistory() { return _tradeHistory; }

// ★ 获取数据源
function getSources() { return CONFIG.DATA_SOURCES || []; }

// ★ 多源拉K线
async function fetchKlines(interval, limit) {
  var sources = getSources();
  var lastErr;
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    try {
      var raw = await fetchJson(src.klineUrl(interval, limit));
      var bars = src.parse(raw);
      if (bars && bars.length > 0) {
        console.log('[数据源]', src.name, bars.length, '根K线');
        return bars;
      }
    } catch (e) {
      console.warn('[' + src.name + '] 失败:', e.message);
      lastErr = e;
    }
  }
  throw new Error('所有数据源失败: ' + (lastErr ? lastErr.message : ''));
}

function fetchJson(url, timeout) {
  timeout = timeout || 6000;
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(new Error('timeout')); }, timeout);
    wx.request({
      url: url, timeout: timeout,
      success: function(res) {
        clearTimeout(timer);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error('HTTP ' + res.statusCode));
      },
      fail: function(err) { clearTimeout(timer); reject(new Error(err.errMsg || 'request fail')); }
    });
  });
}

function getAverageVolume(bars, period) {
  period = period || 20;
  if (bars.length < period) return 0;
  var sum = 0;
  for (var i = bars.length - period; i < bars.length; i++) sum += bars[i].volume;
  return sum / period;
}

function calculateATR(bars, period) {
  period = period || 14;
  var highs = bars.map(function(b) { return b.high; });
  var lows = bars.map(function(b) { return b.low; });
  var closes = bars.map(function(b) { return b.close; });
  return atr(highs, lows, closes, period);
}

function calculateMA(bars, period) {
  period = period || 20;
  if (bars.length < period) return 0;
  var sum = 0;
  for (var i = bars.length - period; i < bars.length; i++) sum += bars[i].close;
  return sum / period;
}

// ★ 判断趋势方向和强度
function determineTrend(bars) {
  var closes = bars.map(function(b) { return b.close; });
  var ema20 = ema(closes, 20);
  var ema60 = ema(closes, 60);
  var n = closes.length - 1;
  var price = closes[n];
  var ma20 = ema20[n], ma60 = ema60[n];
  
  var ma20Slope = (ema20[n] - ema20[Math.max(0, n - 10)]) / ema20[Math.max(0, n - 10)] * 100;
  var ma60Slope = (ema60[n] - ema60[Math.max(0, n - 20)]) / ema60[Math.max(0, n - 20)] * 100;
  var priceToMA20 = (price - ma20) / ma20 * 100;
  var momentum = (price - closes[Math.max(0, n - 10)]) / closes[Math.max(0, n - 10)] * 100;
  
  var isTrendReversal = false, reversalStrength = 0;
  var ma20Prev = ema20[Math.max(0, n - 1)], ma60Prev = ema60[Math.max(0, n - 1)];
  var goldenCross = ma20 > ma60 && ma20Prev <= ma60Prev;
  var deathCross = ma20 < ma60 && ma20Prev >= ma60Prev;
  var ma20Break = Math.abs(priceToMA20) > 1.5;
  var ma60Break = Math.abs((price - ma60) / ma60 * 100) > 3;
  
  var rsiValues = rsi(closes, 14);
  var rsiCurrent = rsiValues[rsiValues.length - 1];
  var rsiPrev = rsiValues[Math.max(0, rsiValues.length - 2)];
  var rsiReversal = (rsiCurrent < 30 && rsiPrev >= 30) || (rsiCurrent > 70 && rsiPrev <= 70);
  
  var highs = bars.map(function(b) { return b.high; });
  var lows = bars.map(function(b) { return b.low; });
  var kdjVal = kdj(highs, lows, closes);
  var jCurrent = kdjVal.J[kdjVal.J.length - 1];
  var jPrev = kdjVal.J[Math.max(0, kdjVal.J.length - 2)];
  var kdjCross = (kdjVal.K[kdjVal.K.length - 1] > kdjVal.D[kdjVal.D.length - 1] && kdjVal.K[Math.max(0, kdjVal.K.length - 2)] <= kdjVal.D[Math.max(0, kdjVal.D.length - 2)]) ||
                 (kdjVal.K[kdjVal.K.length - 1] < kdjVal.D[kdjVal.D.length - 1] && kdjVal.K[Math.max(0, kdjVal.K.length - 2)] >= kdjVal.D[Math.max(0, kdjVal.D.length - 2)]);
  
  var momentumPrev = (closes[Math.max(0, n - 10)] - closes[Math.max(0, n - 20)]) / closes[Math.max(0, n - 20)] * 100;
  var momentumReversal = Math.sign(momentum) !== Math.sign(momentumPrev) && Math.abs(momentum) > 1;
  
  if (goldenCross || deathCross || (ma20Break && ma60Break) || rsiReversal || kdjCross || momentumReversal) {
    isTrendReversal = true;
    var rf = 0;
    if (goldenCross || deathCross) rf += 30;
    if (ma20Break && ma60Break) rf += 25;
    if (rsiReversal) rf += 20;
    if (kdjCross) rf += 15;
    if (momentumReversal) rf += 10;
    reversalStrength = Math.min(100, rf + Math.abs(momentum) * 1.5 + Math.abs(ma20Slope) * 3);
  }
  
  var trendStrength = 0, trend = 'sideways';
  if (price > ma20 && ma20 > ma60 && ma20Slope > 0.05 && ma60Slope > 0.02) {
    trend = 'up';
    trendStrength = Math.min(100, 60 + Math.abs(ma20Slope) * 8 + Math.abs(ma60Slope) * 4 + Math.abs(priceToMA20) * 1.5);
  } else if (price < ma20 && ma20 < ma60 && ma20Slope < -0.05 && ma60Slope < -0.02) {
    trend = 'down';
    trendStrength = Math.min(100, 60 + Math.abs(ma20Slope) * 8 + Math.abs(ma60Slope) * 4 + Math.abs(priceToMA20) * 1.5);
  } else if (price > ma20 && ma20 > ma60) {
    trend = 'up';
    trendStrength = Math.min(100, 40 + Math.abs(ma20Slope) * 6 + Math.abs(priceToMA20) * 1);
  } else if (price < ma20 && ma20 < ma60) {
    trend = 'down';
    trendStrength = Math.min(100, 40 + Math.abs(ma20Slope) * 6 + Math.abs(priceToMA20) * 1);
  } else {
    trend = 'sideways';
    trendStrength = Math.max(0, 25 - Math.abs(ma20Slope) * 3 + Math.abs(momentum) * 0.5);
  }
  
  if (trend === 'up') {
    if (priceToMA20 > 2) trendStrength = Math.min(100, trendStrength + 10);
    if (ma20Slope > 0 && ma60Slope > 0) trendStrength = Math.min(100, trendStrength + 15);
  } else if (trend === 'down') {
    if (priceToMA20 < -2) trendStrength = Math.min(100, trendStrength + 10);
    if (ma20Slope < 0 && ma60Slope < 0) trendStrength = Math.min(100, trendStrength + 15);
  }
  
  return {
    trend: trend,
    trendStrength: Math.round(trendStrength),
    price: price,
    ma20: ma20, ma60: ma60,
    aboveMA20: price > ma20, aboveMA60: price > ma60,
    ma20Slope: ma20Slope, ma60Slope: ma60Slope,
    momentum: momentum,
    isTrendReversal: isTrendReversal,
    reversalStrength: Math.round(reversalStrength),
    goldenCross: goldenCross, deathCross: deathCross
  };
}

// ★ 多周期共振检查
function checkMultiPeriodResonance(currentBars, higherBars) {
  var currentTrend = determineTrend(currentBars);
  var higherTrend = determineTrend(higherBars);
  
  var resonance = { trend_aligned: false, rsi_extreme: false, macd_aligned: false, volume_confirmed: false };
  
  if ((currentTrend.trend === 'up' && higherTrend.trend === 'up') ||
      (currentTrend.trend === 'down' && higherTrend.trend === 'down')) {
    resonance.trend_aligned = true;
  }
  
  var currentCloses = currentBars.map(function(b) { return b.close; });
  var higherCloses = higherBars.map(function(b) { return b.close; });
  var currentRSI = rsi(currentCloses);
  var higherRSI = rsi(higherCloses);
  var nC = currentCloses.length - 1, nH = higherCloses.length - 1;
  var cRSI = currentRSI[nC], hRSI = higherRSI[nH];
  
  // RSI共振
  if (cRSI < 35 && hRSI < 45) resonance.rsi_extreme = 'oversold';
  else if (cRSI > 65 && hRSI > 55) resonance.rsi_extreme = 'overbought';
  else if (currentTrend.trend === 'up' && cRSI < 50 && hRSI < 55) resonance.rsi_extreme = 'trend_oversold';
  else if (currentTrend.trend === 'down' && cRSI > 50 && hRSI > 45) resonance.rsi_extreme = 'trend_overbought';
  
  var cMACD = macd(currentCloses), hMACD = macd(higherCloses);
  var cBull = cMACD.dif[nC] > cMACD.dea[nC], hBull = hMACD.dif[nH] > hMACD.dea[nH];
  if (cBull && hBull) resonance.macd_aligned = 'bullish';
  else if (!cBull && !hBull) resonance.macd_aligned = 'bearish';
  
  var cVol = currentBars[currentBars.length - 1].volume;
  var pVols = currentBars.slice(-6, -1).map(function(b) { return b.volume; });
  var avgVol = pVols.reduce(function(a, b) { return a + b; }, 0) / pVols.length;
  resonance.volume_confirmed = cVol > avgVol * 1.2;
  
  return { resonance: resonance, currentRSI: cRSI, higherRSI: hRSI, currentVolume: cVol, avgVolume: avgVol, volumeRatio: cVol / avgVol };
}

// ★ 评分系统 v6.0（删除随机因子）
function calculateSignalStrength(signalType, conditions, resonance, bars) {
  var score = 0;
  var scoreDetails = {
    baseConditions: { score: 0, max: 20, items: [] },
    resonance: { score: 0, max: 40, items: [] },
    trend: { score: 0, max: 20, items: [] },
    volatility: { score: 0, max: 14, items: [] },
    volume: { score: 0, max: 6, items: [] }
  };
  
  // 基础条件 (0-20分)，3项每项约6.7分
  conditions.forEach(function(c) {
    var itemScore = c.ok ? 6.7 : 0;
    score += itemScore;
    scoreDetails.baseConditions.score += itemScore;
    scoreDetails.baseConditions.items.push({ label: c.label, score: Math.round(itemScore), max: 7, ok: c.ok, tip: c.tip });
  });
  
  // 多周期共振 (0-40分)
  var rItems = [
    { label: '趋势一致性', score: 12, ok: resonance.trend_aligned },
    { label: 'RSI极端值', score: 8, ok: resonance.rsi_extreme },
    { label: 'MACD方向', score: 12, ok: resonance.macd_aligned },
    { label: '成交量确认', score: 8, ok: resonance.volume_confirmed }
  ];
  rItems.forEach(function(item) {
    var s = item.ok ? item.score : 0;
    score += s;
    scoreDetails.resonance.score += s;
    scoreDetails.resonance.items.push({ label: item.label, score: s, max: item.score, ok: item.ok });
  });
  
  // 趋势一致性 (0-20分)
  var trend = determineTrend(bars);
  var isAligned = (signalType === 'long' && trend.trend === 'up') || (signalType === 'short' && trend.trend === 'down');
  var trendScore = 0, trendLabel = '';
  if (isAligned) {
    trendScore = 10 + (trend.trendStrength / 100) * 10;
    trendLabel = '趋势一致(' + trend.trend + ')';
  } else if (trend.trend === 'sideways') {
    trendScore = 12;
    trendLabel = '震荡市';
  } else {
    if (trend.isTrendReversal && trend.reversalStrength >= 60) { trendScore = 10; trendLabel = '趋势反转'; }
    else { trendScore = 3; trendLabel = '趋势相反'; }
  }
  score += trendScore;
  scoreDetails.trend.score = trendScore;
  scoreDetails.trend.items.push({ label: trendLabel, score: Math.round(trendScore), max: 20, trend: trend.trend, strength: trend.trendStrength, aligned: isAligned });
  
  // 波动率 (0-14分)
  var atrVals = calculateATR(bars);
  var cATR = atrVals[atrVals.length - 1];
  var price = bars[bars.length - 1].close;
  var atrPct = (cATR / price) * 100;
  var volScore = 0, volLabel = '';
  if (atrPct >= 2 && atrPct <= 4) { volScore = 14; volLabel = '理想(' + atrPct.toFixed(2) + '%)'; }
  else if (atrPct >= 1 && atrPct <= 5) { volScore = 9; volLabel = '良好(' + atrPct.toFixed(2) + '%)'; }
  else if (atrPct >= 0.5 && atrPct <= 8) { volScore = 5; volLabel = '一般(' + atrPct.toFixed(2) + '%)'; }
  else { volLabel = '异常(' + atrPct.toFixed(2) + '%)'; }
  score += volScore;
  scoreDetails.volatility.score = volScore;
  scoreDetails.volatility.items.push({ label: volLabel, score: Math.round(volScore), max: 14, atrPercent: atrPct });
  
  // 成交量 (0-6分)
  var avgV = getAverageVolume(bars, 20);
  var lastV = bars[bars.length - 1].volume;
  var vRatio = lastV / avgV;
  var vScore = 0, vLabel = '';
  if (vRatio > 1.5) { vScore = 6; vLabel = '放量(' + vRatio.toFixed(2) + 'x)'; }
  else if (vRatio > 1.2) { vScore = 4; vLabel = '温和放量(' + vRatio.toFixed(2) + 'x)'; }
  else if (vRatio > 1.0) { vScore = 2; vLabel = '轻微放量(' + vRatio.toFixed(2) + 'x)'; }
  else { vLabel = '缩量(' + vRatio.toFixed(2) + 'x)'; }
  score += vScore;
  scoreDetails.volume.score = vScore;
  scoreDetails.volume.items.push({ label: vLabel, score: vScore, max: 6, volumeRatio: vRatio });
  
  // ★ 重要：删除随机因子，评分稳定可复现
  // score = score + randomFactor;  // 已删除！
  
  score = Math.min(100, Math.max(0, score));
  
  return { total: score, max: 100, details: scoreDetails, rawScore: score };
}

// ★ 止盈止损计算 v6.0（优化版：止损合理、止盈分档更实用）
// 止损：1.0x ATR（给价格呼吸空间，不容易被扫）
// 入场区间：0.3x ATR（收窄，更精准）
// TP1：0.8x ATR（快进快出，1:0.8 R:R）
// TP2：1.5x ATR（标准目标，1:1.5 R:R）
// TP3：2.5x ATR（乐观目标，1:2.5 R:R）
function calculateTradeLevels(signalType, bars, atrPeriod) {
  atrPeriod = atrPeriod || 14;
  var lastBar = bars[bars.length - 1];
  var atrVals = calculateATR(bars, atrPeriod);
  var cATR = atrVals[atrVals.length - 1];
  var price = lastBar.close;
  
  // 计算最近支撑阻力
  var recentLows = [], recentHighs = [];
  for (var i = Math.max(0, bars.length - 20); i < bars.length; i++) {
    recentLows.push(bars[i].low);
    recentHighs.push(bars[i].high);
  }
  var rLow = Math.min.apply(Math, recentLows);
  var rHigh = Math.max.apply(Math, recentHighs);
  
  var stopMult = 1.0;   // 止损 1.0x ATR（优化）
  var entryMult = 0.3;  // 入场区间 0.3x ATR（收窄）
  
  if (signalType === 'long') {
    var entryZone = [price - cATR * entryMult, price];
    var atrSL = price - cATR * stopMult;
    var supSL = rLow - cATR * 0.3;  // 支撑位下方0.3ATR
    var stopLoss = Math.max(atrSL, supSL);
    var takeProfits = [
      price + cATR * 0.8,   // TP1: 1:0.8
      price + cATR * 1.5,   // TP2: 1:1.5
      price + cATR * 2.5    // TP3: 1:2.5
    ];
    return {
      entryZone: entryZone.map(function(p) { return Math.round(p); }),
      stopLoss: Math.round(stopLoss),
      takeProfits: takeProfits.map(function(p) { return Math.round(p); }),
      atr: Math.round(cATR),
      atrPercent: Math.round((cATR / price) * 10000) / 100,
      riskReward1: 0.8,
      riskReward2: 1.5,
      riskReward3: 2.5
    };
  } else if (signalType === 'short') {
    var entryZone = [price, price + cATR * entryMult];
    var atrSL = price + cATR * stopMult;
    var resSL = rHigh + cATR * 0.3;
    var stopLoss = Math.min(atrSL, resSL);
    var takeProfits = [
      price - cATR * 0.8,
      price - cATR * 1.5,
      price - cATR * 2.5
    ];
    return {
      entryZone: entryZone.map(function(p) { return Math.round(p); }),
      stopLoss: Math.round(stopLoss),
      takeProfits: takeProfits.map(function(p) { return Math.round(p); }),
      atr: Math.round(cATR),
      atrPercent: Math.round((cATR / price) * 10000) / 100,
      riskReward1: 0.8,
      riskReward2: 1.5,
      riskReward3: 2.5
    };
  }
  return null;
}

// ★ 星级换算（分数→星级1-5，用于仓位）
function scoreToStars(score) {
  var abs = Math.abs(score);
  if (abs >= 90) return 5;
  if (abs >= 80) return 4;
  if (abs >= 70) return 3;
  if (abs >= 60) return 2;
  return 1;
}

// ★ 仓位建议
function calculatePositionAdvice(signalStrength, entryPrice, stopLoss, accountBalance) {
  accountBalance = accountBalance || 10000;
  var stars = scoreToStars(signalStrength);
  var positionRatios = { 5: 0.50, 4: 0.30, 3: 0.20, 2: 0.10, 1: 0.05 };
  var posRatio = positionRatios[stars] || 0.10;
  var posValue = accountBalance * posRatio;
  var stopDist = Math.abs(entryPrice - stopLoss);
  var contracts = Math.floor(posValue / entryPrice);
  return {
    stars: stars,
    starRating: '\u2b50'.repeat(stars) + '\u2606'.repeat(5 - stars),
    positionRatio: Math.round(posRatio * 100),
    suggestedContracts: contracts,
    positionValue: Math.round(posValue),
    riskPerTrade: Math.round(stopDist * contracts),
    stopDistance: Math.round(stopDist)
  };
}

// ★ 获取更高周期
function getHigherInterval(interval) {
  var m = { '15m': '1h', '1h': '4h', '4h': '1d', '1d': '1w' };
  return m[interval] || null;
}

// ★ 主检测函数
async function detectSignal(interval) {
  interval = interval || '15m';
  var limit = 200;
  
  var cached = getCached(interval);
  if (cached) return cached;
  
  var bars = await fetchKlines(interval, limit);
  var higherBars = [];
  try {
    var hi = getHigherInterval(interval);
    if (hi) higherBars = await fetchKlines(hi, Math.floor(limit / 2));
  } catch (e) { console.warn('高周期数据获取失败:', e.message); }
  
  var resonanceInfo = higherBars.length > 0 ? checkMultiPeriodResonance(bars, higherBars) : { resonance: {}, currentRSI: 50, higherRSI: null, volumeRatio: 1 };
  
  var lastBar = bars[bars.length - 1];
  var prevBar = bars[bars.length - 2];
  var prevPrevBar = bars[bars.length - 3];
  
  var body = Math.abs(prevBar.close - prevBar.open) || 0.01;
  var lowerShadow = Math.min(prevBar.open, prevBar.close) - prevBar.low;
  var upperShadow = prevBar.high - Math.max(prevBar.open, prevBar.close);
  
  var prevBody = Math.abs(prevPrevBar.close - prevPrevBar.open) || 0.01;
  var prevLowerShadow = Math.min(prevPrevBar.open, prevPrevBar.close) - prevPrevBar.low;
  var prevUpperShadow = prevPrevBar.high - Math.max(prevPrevBar.open, prevPrevBar.close);
  
  // ★ 优化：插针比例从3倍降到2倍（当前K），1.5倍（前K）
  var isLongPinCur = lowerShadow >= body * 2 && prevBar.close > (prevBar.low + (prevBar.high - prevBar.low) * 0.55);
  var isLongPinPrev = prevLowerShadow >= prevBody * 1.5 && prevPrevBar.close > (prevPrevBar.low + (prevPrevBar.high - prevPrevBar.low) * 0.55);
  var isLongPin = isLongPinCur && isLongPinPrev;
  
  var isShortPinCur = upperShadow >= body * 2 && prevBar.close < (prevBar.high - (prevBar.high - prevBar.low) * 0.55);
  var isShortPinPrev = prevUpperShadow >= prevBody * 1.5 && prevPrevBar.close < (prevPrevBar.high - (prevPrevBar.high - prevPrevBar.low) * 0.55);
  var isShortPin = isShortPinCur && isShortPinPrev;
  
  var c2Long = lastBar.low > prevBar.low && lastBar.close > lastBar.open;
  var c2Short = lastBar.high < prevBar.high && lastBar.close < lastBar.open;
  
  var closes = bars.map(function(b) { return b.close; });
  var highs = bars.map(function(b) { return b.high; });
  var lows = bars.map(function(b) { return b.low; });
  var n = closes.length - 1;
  var momentum = (closes[n] - closes[Math.max(0, n - 10)]) / closes[Math.max(0, n - 10)] * 100;
  
  var macdData = macd(closes);
  var kdjData = kdj(highs, lows, closes);
  var rsiArr = rsi(closes);
  var wrArr = wr(highs, lows, closes);
  var bollArr = boll(closes);
  
  var macdBar = macdData.bar[n];
  var macdPrev = macdData.bar[n - 1];
  var jVal = kdjData.J[n];
  var rsiVal = rsiArr[n];
  var wrVal = wrArr[n];
  var bollLast = bollArr[n];
  
  // MACD条件：柱线放大 OR 金叉/死叉
  var c4Long = macdBar > macdPrev || (macdData.dif[n] > macdData.dea[n] && macdData.dif[n-1] <= macdData.dea[n-1]);
  var c4Short = macdBar < macdPrev || (macdData.dif[n] < macdData.dea[n] && macdData.dif[n-1] >= macdData.dea[n-1]);
  
  var signalType = null;
  var trendInfo = determineTrend(bars);
  var trendDir = trendInfo.trend;
  var trendStr = trendInfo.trendStrength || 0;
  
  // 成交量条件
  var volCond = {
    long: prevBar.volume > getAverageVolume(bars, 20) * 1.2,
    short: prevBar.volume > getAverageVolume(bars, 20) * 1.2
  };
  
  // ★ 优化RSI条件：趋势市加严格边界
  var rsiCond = {
    long: rsiVal < 45 || (trendDir === 'up' && rsiVal < 50),    // 上升趋势要求更严格
    short: rsiVal > 55 || (trendDir === 'down' && rsiVal > 50)
  };
  
  // ★ 优化布林带条件：修正OR逻辑，改为AND（价格同时满足两个条件）
  var bollCond = {
    long: lastBar.close <= bollLast.middle && lastBar.close <= bollLast.lower * 1.01,
    short: lastBar.close >= bollLast.middle && lastBar.close >= bollLast.upper * 0.99
  };
  
  // 趋势过滤
  var trendAlign = { long: true, short: true };
  if (trendDir === 'up') {
    if (trendStr >= 50) trendAlign.short = false;
  } else if (trendDir === 'down') {
    if (trendStr >= 50) trendAlign.long = false;
  } else if (trendStr >= 60) {
    trendAlign.long = momentum > 0;
    trendAlign.short = momentum < 0;
  }
  
  // ★ 增强信号质量过滤（加入KDJ J值判断）
  var signalQuality = {
    long: {
      volume: volCond.long,
      rsi: rsiCond.long,
      boll: bollCond.long,
      trend: trendAlign.long,
      ma: lastBar.close > calculateMA(bars, 20),
      macd: macdBar > 0 && macdData.dif[n] > macdData.dea[n],
      reversal: !trendInfo.isTrendReversal || (trendInfo.isTrendReversal && trendInfo.goldenCross),
      trendDir: trendDir === 'up' || (trendDir === 'sideways' && trendStr < 60),
      kdjJ: jVal < 30  // ★ 新增：KDJ J值<30（超卖强化）
    },
    short: {
      volume: volCond.short,
      rsi: rsiCond.short,
      boll: bollCond.short,
      trend: trendAlign.short,
      ma: lastBar.close < calculateMA(bars, 20),
      macd: macdBar < 0 && macdData.dif[n] < macdData.dea[n],
      reversal: !trendInfo.isTrendReversal || (trendInfo.isTrendReversal && trendInfo.deathCross),
      trendDir: trendDir === 'down' || (trendDir === 'sideways' && trendStr < 60),
      kdjJ: jVal > 70   // ★ 新增：KDJ J值>70（超买强化）
    }
  };
  
  function calcQualityScore(conds) {
    var total = Object.keys(conds).length;
    var met = Object.values(conds).filter(Boolean).length;
    return (met / total) * 100;
  }
  
  var longQS = calcQualityScore(signalQuality.long);
  var shortQS = calcQualityScore(signalQuality.short);
  
  // 信号生成
  if (isLongPin && c2Long && c4Long && (longQS >= 70 || (trendInfo.isTrendReversal && trendInfo.goldenCross && longQS >= 60))) {
    var lastSig = getLastSignalInfo();
    if (checkSignalCooldown(lastSig, 'long')) signalType = 'long';
  }
  
  if (isShortPin && c2Short && c4Short && (shortQS >= 70 || (trendInfo.isTrendReversal && trendInfo.deathCross && shortQS >= 60))) {
    var lastSig2 = getLastSignalInfo();
    if (checkSignalCooldown(lastSig2, 'short')) signalType = 'short';
  }
  
  var longConditions = [
    { label: '下影插针', ok: isLongPin, tip: '下影' + Math.round(lowerShadow) + ' vs 实体' + Math.round(body) },
    { label: '低点抬高', ok: c2Long, tip: lastBar.low > prevBar.low ? '确认' : '未确认' },
    { label: 'MACD配合', ok: c4Long, tip: macdBar > 0 ? 'MACD多头' : 'MACD止跌' },
  ];
  
  var shortConditions = [
    { label: '上影插针', ok: isShortPin, tip: '上影' + Math.round(upperShadow) + ' vs 实体' + Math.round(body) },
    { label: '高点压制', ok: c2Short, tip: lastBar.high < prevBar.high ? '确认' : '未确认' },
    { label: 'MACD配合', ok: c4Short, tip: macdBar < 0 ? 'MACD空头' : 'MACD止涨' },
  ];
  
  var scoreResult = signalType ? calculateSignalStrength(signalType, signalType === 'long' ? longConditions : shortConditions, resonanceInfo.resonance, bars) : null;
  var signalStrength = 0, scoreDetails = null;
  
  if (signalType && scoreResult) {
    var rawScore = scoreResult.rawScore;
    scoreDetails = scoreResult.details;
    
    if (signalType === 'long') signalStrength = Math.round(rawScore);
    else signalStrength = Math.round(-rawScore);
    
    // ★ 优化：横盘降分从30降到15（避免信号被误杀）
    if (trendInfo.trend === 'sideways') {
      var reduction = 15;
      if (signalType === 'long') signalStrength = Math.max(0, signalStrength - reduction);
      else signalStrength = Math.min(0, signalStrength + reduction);
      console.log('[横盘] 评分调整:', signalStrength, '(降', reduction, '分)');
    }
    
    recordSignal(signalType, signalStrength);
  }
  
  var tradeLevels = signalType ? calculateTradeLevels(signalType, bars) : null;
  
  var recentLows2 = [], recentHighs2 = [];
  for (var j = Math.max(0, bars.length - 20); j < bars.length; j++) {
    recentLows2.push(bars[j].low);
    recentHighs2.push(bars[j].high);
  }
  
  var posAdvice = signalType && tradeLevels ? calculatePositionAdvice(signalStrength, lastBar.close, tradeLevels.stopLoss, CONFIG.ACCOUNT_BALANCE || 10000) : null;
  
  var result = {
    type: signalType,
    signalStrength: signalStrength,
    signalConfidence: signalStrength,
    starRating: posAdvice ? posAdvice.starRating : '无信号',
    stars: posAdvice ? posAdvice.stars : 0,
    bars: bars,
    higherBars: higherBars,
    longConditions: longConditions,
    shortConditions: shortConditions,
    isLongPin: isLongPin, isShortPin: isShortPin,
    lowerShadow: lowerShadow, upperShadow: upperShadow, body: body,
    c2Long: c2Long, c2Short: c2Short, c4Long: c4Long, c4Short: c4Short,
    resonance: resonanceInfo.resonance,
    currentRSI: resonanceInfo.currentRSI,
    higherRSI: resonanceInfo.higherRSI,
    volumeRatio: resonanceInfo.volumeRatio,
    trend: trendInfo.trend,
    price: trendInfo.price,
    ma20: trendInfo.ma20, ma60: trendInfo.ma60,
    trendStrength: trendInfo.trendStrength,
    macdBar: macdBar, macdPrev: macdPrev,
    dif: macdData.dif[n], dea: macdData.dea[n],
    kVal: kdjData.K[n], dVal: kdjData.D[n], jVal: jVal,
    rsiVal: rsiVal, wrVal: wrVal,
    bollLast: bollLast,
    tradeLevels: tradeLevels,
    positionAdvice: posAdvice,
    lastBar: lastBar, prevBar: prevBar,
    nearestSupport: Math.min.apply(Math, recentLows2),
    nearestResistance: Math.max.apply(Math, recentHighs2),
    scoreDetails: scoreDetails,
    rawScore: scoreResult ? scoreResult.rawScore : 0
  };
  
  setCache(interval, result);
  return result;
}

function clearSignalCache(interval) { clearCache(interval); }

window.detectSignal = detectSignal;
window.clearSignalCache = clearSignalCache;

console.log('[Detector] v6.0 信号检测模块已加载 - 优化版');
