// detector.js - 专业交易算法模型 v5.0（浏览器版本）
// ───────────────────────────────────────────────

// 内存缓存（5s内复用，切换周期时清空）
var _cache = {};
function getCacheKey(interval) { return interval; }
function getCached(interval) {
  var c = _cache[getCacheKey(interval)];
  if (c && Date.now() - c.ts < 5000) return c.data; // 缩短缓存时间到5秒
  return null;
}
function setCache(interval, data) {
  _cache[getCacheKey(interval)] = { ts: Date.now(), data: data };
}
function clearCache(interval) {
  if (interval) delete _cache[getCacheKey(interval)];
  else Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
}

// ★ 信号历史记录（用于冷却机制）
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

// ★ 增强信号冷却机制 - 防止频繁交易和频繁切换方向
function checkSignalCooldown(lastSignal, currentType) {
  var now = Date.now();
  
  // 如果没有上次信号，允许生成
  if (!lastSignal || !lastSignal.lastSignalTime) {
    return true;
  }
  
  var timeSinceLastSignal = now - lastSignal.lastSignalTime;
  var lastSignalType = lastSignal.lastSignalType;
  var lastSignalScore = Math.abs(lastSignal.lastSignalScore || 0);
  
  // 动态冷却时间设置 - 优化版本
  var baseCooldown = 5 * 60 * 1000; // 基础冷却期5分钟（减少）
  var sameDirectionCooldown = 10 * 60 * 1000; // 同方向信号冷却10分钟
  var oppositeDirectionCooldown = 20 * 60 * 1000; // 相反方向信号冷却20分钟（增加）
  
  // 如果上次是高分信号(85+)，需要更长的冷却时间
  if (lastSignalScore >= 85) {
    baseCooldown *= 1.5;
    sameDirectionCooldown *= 1.5;
    oppositeDirectionCooldown *= 2; // 高分信号后，反向需要更长冷却
  } else if (lastSignalScore >= 70) {
    baseCooldown *= 1.2;
    sameDirectionCooldown *= 1.2;
    oppositeDirectionCooldown *= 1.5;
  }
  
  // 如果上次信号方向与当前方向相反，增加冷却
  if (currentType && currentType !== lastSignalType) {
    // 反向信号需要更严格的检查
    oppositeDirectionCooldown *= 1.5;
  }
  
  // 基础冷却期：任何信号都需要至少基础冷却时间
  if (timeSinceLastSignal < baseCooldown) {
    console.log('[信号冷却] 基础冷却期中，剩余:', Math.round((baseCooldown - timeSinceLastSignal) / 60000), '分钟');
    return false;
  }
  
  // 同方向信号冷却：需要更长的间隔
  if (currentType && currentType === lastSignalType) {
    if (timeSinceLastSignal < sameDirectionCooldown) {
      console.log('[信号冷却] 同方向信号间隔太短，需要至少', Math.round(sameDirectionCooldown / 60000), '分钟');
      return false;
    }
  }
  // 相反方向信号冷却：需要最长的间隔，避免频繁切换
  else if (currentType && currentType !== lastSignalType) {
    if (timeSinceLastSignal < oppositeDirectionCooldown) {
      console.log('[信号冷却] 相反方向信号间隔太短，需要至少', Math.round(oppositeDirectionCooldown / 60000), '分钟');
      return false;
    }
    
    // 额外检查：如果上次是高分信号，需要更严格的相反方向冷却
    if (lastSignalScore >= 75 && timeSinceLastSignal < oppositeDirectionCooldown * 1.5) {
      console.log('[信号冷却] 高分信号后，相反方向信号需要更长的冷却期');
      return false;
    }
  }
  
  return true;
}

// ★ 记录信号生成
function recordSignal(signalType, score) {
  // 检查是否为变盘信号
  const lastType = _signalHistory.lastSignalType;
  const isReversal = lastType && signalType && lastType !== signalType;
  
  _signalHistory.lastSignalTime = Date.now();
  _signalHistory.lastSignalType = signalType;
  _signalHistory.lastSignalScore = score;
  _signalHistory.signalCount++;
  
  // 检查是否需要推送
  const absScore = Math.abs(score);
  if (absScore >= 60) {
    _signalHistory.lastPushScore = score;
    _signalHistory.lastPushTime = Date.now();
    
    // 推送级别：普通(60-84)、紧急(85+)
    _signalHistory.pushLevel = absScore >= 85 ? 'urgent' : 'normal';
  }
  
  if (isReversal) {
    console.log('[变盘信号] 类型:', signalType, '分数:', score, '时间:', new Date().toLocaleString());
    // 触发变盘提醒
    if (typeof window.onReversalSignal === 'function') {
      window.onReversalSignal({
        type: signalType,
        score: score,
        lastType: lastType,
        timestamp: Date.now()
      });
    }
  } else {
    console.log('[信号记录] 类型:', signalType, '分数:', score, '时间:', new Date().toLocaleString());
  }
}

// ★ 记录交易
function recordTrade(trade) {
  _tradeHistory.push(trade);
  updatePerformanceStats();
  console.log('[交易记录] 类型:', trade.type, '结果:', trade.result, '盈亏:', trade.profit.toFixed(2));
}

// ★ 更新绩效统计
function updatePerformanceStats() {
  var trades = _tradeHistory;
  _performanceStats.totalTrades = trades.length;
  _performanceStats.winningTrades = trades.filter(t => t.result === 'win').length;
  _performanceStats.losingTrades = trades.filter(t => t.result === 'loss').length;
  _performanceStats.totalProfit = trades.filter(t => t.result === 'win').reduce((sum, t) => sum + t.profit, 0);
  _performanceStats.totalLoss = trades.filter(t => t.result === 'loss').reduce((sum, t) => sum + Math.abs(t.profit), 0);
  _performanceStats.winRate = trades.length > 0 ? (_performanceStats.winningTrades / trades.length) * 100 : 0;
  _performanceStats.profitFactor = _performanceStats.totalLoss > 0 ? _performanceStats.totalProfit / _performanceStats.totalLoss : 1;
  _performanceStats.averageProfit = _performanceStats.winningTrades > 0 ? _performanceStats.totalProfit / _performanceStats.winningTrades : 0;
  _performanceStats.averageLoss = _performanceStats.losingTrades > 0 ? _performanceStats.totalLoss / _performanceStats.losingTrades : 0;
  
  // 计算最大回撤
  var runningProfit = 0;
  var peak = 0;
  var maxDrawdown = 0;
  trades.forEach(trade => {
    runningProfit += trade.profit;
    peak = Math.max(peak, runningProfit);
    var drawdown = (peak - runningProfit) / peak * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  });
  _performanceStats.maxDrawdown = maxDrawdown;
}

// ★ 获取绩效统计
function getPerformanceStats() {
  return _performanceStats;
}

// ★ 获取交易历史
function getTradeHistory() {
  return _tradeHistory;
}

// wx.request 封装成 Promise，带超时（使用全局 wx）
function fetchJson(url, timeout) {
  timeout = timeout || 6000;
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(new Error('timeout')); }, timeout);
    wx.request({
      url: url,
      timeout: timeout,
      success: function(res) {
        clearTimeout(timer);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error('HTTP ' + res.statusCode));
        }
      },
      fail: function(err) {
        clearTimeout(timer);
        reject(new Error(err.errMsg || 'request fail'));
      }
    });
  });
}

// 获取数据源（使用全局 CONFIG）
function getSources() {
  return CONFIG.DATA_SOURCES || [];
}

/** 多源拉K线，返回 bar 数组 */
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

/** 计算平均成交量 */
function getAverageVolume(bars, period) {
  period = period || 20;
  if (bars.length < period) return 0;
  
  var sum = 0;
  for (var i = bars.length - period; i < bars.length; i++) {
    sum += bars[i].volume;
  }
  return sum / period;
}

/** 计算ATR用于动态止损 */
function calculateATR(bars, period) {
  period = period || 14;
  var highs = bars.map(function(b) { return b.high; });
  var lows = bars.map(function(b) { return b.low; });
  var closes = bars.map(function(b) { return b.close; });
  return atr(highs, lows, closes, period);
}

/** 计算移动平均线 */
function calculateMA(bars, period) {
  period = period || 20;
  if (bars.length < period) return 0;
  
  var sum = 0;
  for (var i = bars.length - period; i < bars.length; i++) {
    sum += bars[i].close;
  }
  return sum / period;
}

/** 判断趋势方向和强度 */
function determineTrend(bars) {
  var closes = bars.map(function(b) { return b.close; });
  var ema20 = ema(closes, 20);
  var ema60 = ema(closes, 60);
  var n = closes.length - 1;
  
  var price = closes[n];
  var ma20 = ema20[n];
  var ma60 = ema60[n];
  
  // 计算趋势强度 (0-100) - 使用更长周期减少短期波动影响
  var ma20Slope = (ema20[n] - ema20[Math.max(0, n - 10)]) / ema20[Math.max(0, n - 10)] * 100;
  var ma60Slope = (ema60[n] - ema60[Math.max(0, n - 20)]) / ema60[Math.max(0, n - 20)] * 100;
  var priceToMA20 = (price - ma20) / ma20 * 100;
  var priceToMA60 = (price - ma60) / ma60 * 100;
  
  // 计算短期动量
  var momentum = (price - closes[Math.max(0, n - 10)]) / closes[Math.max(0, n - 10)] * 100;
  
  // 检测变盘信号
  var isTrendReversal = false;
  var reversalStrength = 0;
  
  // 检查是否有金叉/死叉
  var ma20Prev = ema20[Math.max(0, n - 1)];
  var ma60Prev = ema60[Math.max(0, n - 1)];
  var goldenCross = ma20 > ma60 && ma20Prev <= ma60Prev;
  var deathCross = ma20 < ma60 && ma20Prev >= ma60Prev;
  
  // 检查价格是否突破重要均线
  var ma20Break = Math.abs(priceToMA20) > 1.5;
  var ma60Break = Math.abs(priceToMA60) > 3;
  
  // 计算RSI和KDJ指标
  var rsiValues = rsi(closes, 14);
  var rsiCurrent = rsiValues[rsiValues.length - 1];
  var rsiPrev = rsiValues[Math.max(0, rsiValues.length - 2)];
  
  // 获取高点和低点数据用于KDJ计算
  var highs = bars.map(function(b) { return b.high; });
  var lows = bars.map(function(b) { return b.low; });
  var kdjValues = kdj(highs, lows, closes);
  var jCurrent = kdjValues.J[kdjValues.J.length - 1];
  var jPrev = kdjValues.J[Math.max(0, kdjValues.J.length - 2)];
  
  // 检查RSI超买超卖反转
  var rsiReversal = false;
  if ((rsiCurrent < 30 && rsiPrev >= 30) || (rsiCurrent > 70 && rsiPrev <= 70)) {
    rsiReversal = true;
  }
  
  // 检查KDJ金叉死叉
  var kdjCross = false;
  if (kdjValues.K[kdjValues.K.length - 1] > kdjValues.D[kdjValues.D.length - 1] && 
      kdjValues.K[Math.max(0, kdjValues.K.length - 2)] <= kdjValues.D[Math.max(0, kdjValues.D.length - 2)]) {
    kdjCross = true; // 金叉
  } else if (kdjValues.K[kdjValues.K.length - 1] < kdjValues.D[kdjValues.D.length - 1] && 
             kdjValues.K[Math.max(0, kdjValues.K.length - 2)] >= kdjValues.D[Math.max(0, kdjValues.D.length - 2)]) {
    kdjCross = true; // 死叉
  }
  
  // 检查动量反转
  var momentumPrev = (closes[Math.max(0, n - 10)] - closes[Math.max(0, n - 20)]) / closes[Math.max(0, n - 20)] * 100;
  var momentumReversal = Math.sign(momentum) !== Math.sign(momentumPrev) && Math.abs(momentum) > 1;
  
  // 变盘检测 - 增强版本
  if (goldenCross || deathCross || (ma20Break && ma60Break) || rsiReversal || kdjCross || momentumReversal) {
    isTrendReversal = true;
    
    // 计算变盘强度，考虑多个因素
    var reversalFactors = 0;
    if (goldenCross || deathCross) reversalFactors += 30;
    if (ma20Break && ma60Break) reversalFactors += 25;
    if (rsiReversal) reversalFactors += 20;
    if (kdjCross) reversalFactors += 15;
    if (momentumReversal) reversalFactors += 10;
    
    reversalStrength = Math.min(100, reversalFactors + Math.abs(momentum) * 1.5 + Math.abs(ma20Slope) * 3);
  }
  
  var trendStrength = 0;
  var trend = 'sideways';
  
  // 强多头：价格在MA20之上，MA20在MA60之上，且都向上，MA60斜率>0
  if (price > ma20 && ma20 > ma60 && ma20Slope > 0.05 && ma60Slope > 0.02) {
    trend = 'up';
    trendStrength = Math.min(100, 60 + Math.abs(ma20Slope) * 8 + Math.abs(ma60Slope) * 4 + Math.abs(priceToMA20) * 1.5);
  }
  // 强空头：价格在MA20之下，MA20在MA60之下，且都向下，MA60斜率<0
  else if (price < ma20 && ma20 < ma60 && ma20Slope < -0.05 && ma60Slope < -0.02) {
    trend = 'down';
    trendStrength = Math.min(100, 60 + Math.abs(ma20Slope) * 8 + Math.abs(ma60Slope) * 4 + Math.abs(priceToMA20) * 1.5);
  }
  // 弱多头：价格在MA20之上，MA20在MA60之上，但MA60斜率不明确
  else if (price > ma20 && ma20 > ma60) {
    trend = 'up';
    trendStrength = Math.min(100, 40 + Math.abs(ma20Slope) * 6 + Math.abs(priceToMA20) * 1);
  }
  // 弱空头：价格在MA20之下，MA20在MA60之下，但MA60斜率不明确
  else if (price < ma20 && ma20 < ma60) {
    trend = 'down';
    trendStrength = Math.min(100, 40 + Math.abs(ma20Slope) * 6 + Math.abs(priceToMA20) * 1);
  }
  // 震荡市：价格在MA20和MA60之间，或者均线排列不明确
  else {
    trend = 'sideways';
    // 震荡市趋势强度较低，但考虑动量因素
    trendStrength = Math.max(0, 25 - Math.abs(ma20Slope) * 3 + Math.abs(momentum) * 0.5);
  }
  
  // 增加趋势强度的计算，考虑多周期因素
  if (trend === 'up') {
    // 价格远离MA20时增加趋势强度
    if (priceToMA20 > 2) {
      trendStrength = Math.min(100, trendStrength + 10);
    }
    // 短期和长期均线都向上时增加趋势强度
    if (ma20Slope > 0 && ma60Slope > 0) {
      trendStrength = Math.min(100, trendStrength + 15);
    }
  } else if (trend === 'down') {
    // 价格远离MA20时增加趋势强度
    if (priceToMA20 < -2) {
      trendStrength = Math.min(100, trendStrength + 10);
    }
    // 短期和长期均线都向下时增加趋势强度
    if (ma20Slope < 0 && ma60Slope < 0) {
      trendStrength = Math.min(100, trendStrength + 15);
    }
  }
  
  return {
    trend: trend,
    trendStrength: Math.round(trendStrength),
    price: price,
    ma20: ma20,
    ma60: ma60,
    aboveMA20: price > ma20,
    aboveMA60: price > ma60,
    ma20Slope: ma20Slope,
    ma60Slope: ma60Slope,
    momentum: momentum,
    isTrendReversal: isTrendReversal,
    reversalStrength: Math.round(reversalStrength),
    goldenCross: goldenCross,
    deathCross: deathCross
  };
}

/** 检查多周期共振 */
function checkMultiPeriodResonance(currentBars, higherBars) {
  var currentTrend = determineTrend(currentBars);
  var higherTrend = determineTrend(higherBars);
  
  var resonance = {
    trend_aligned: false,
    rsi_extreme: false,
    macd_aligned: false,
    volume_confirmed: false
  };
  
  // 修复趋势一致性检查逻辑
  if (currentTrend.trend === 'up' && higherTrend.trend === 'up') {
    resonance.trend_aligned = true;
  } else if (currentTrend.trend === 'down' && higherTrend.trend === 'down') {
    resonance.trend_aligned = true;
  }
  
  var currentCloses = currentBars.map(function(b) { return b.close; });
  var higherCloses = higherBars.map(function(b) { return b.close; });
  var currentRSI = rsi(currentCloses);
  var higherRSI = rsi(higherCloses);
  
  var nCurrent = currentCloses.length - 1;
  var nHigher = higherCloses.length - 1;
  
  // 优化RSI极端值判断：考虑趋势和共振
  var currentRSIVal = currentRSI[nCurrent];
  var higherRSIVal = higherRSI[nHigher];
  
  // 超卖共振：当前周期超卖且高周期也处于相对低位
  if (currentRSIVal < 35 && higherRSIVal < 45) {
    resonance.rsi_extreme = 'oversold';
  } 
  // 超买共振：当前周期超买且高周期也处于相对高位
  else if (currentRSIVal > 65 && higherRSIVal > 55) {
    resonance.rsi_extreme = 'overbought';
  }
  // 趋势中的RSI共振：在趋势中允许更宽松的RSI范围
  else if (currentTrend.trend === 'up' && currentRSIVal < 50 && higherRSIVal < 55) {
    resonance.rsi_extreme = 'trend_oversold';
  }
  else if (currentTrend.trend === 'down' && currentRSIVal > 50 && higherRSIVal > 45) {
    resonance.rsi_extreme = 'trend_overbought';
  }
  
  var currentMACD = macd(currentCloses);
  var higherMACD = macd(higherCloses);
  
  var currentBullish = currentMACD.dif[nCurrent] > currentMACD.dea[nCurrent];
  var higherBullish = higherMACD.dif[nHigher] > higherMACD.dea[nHigher];
  
  if (currentBullish && higherBullish) {
    resonance.macd_aligned = 'bullish';
  } else if (!currentBullish && !higherBullish) {
    resonance.macd_aligned = 'bearish';
  }
  
  var currentVolume = currentBars[currentBars.length - 1].volume;
  var prevVolumes = currentBars.slice(-6, -1).map(function(b) { return b.volume; });
  var avgVolume = prevVolumes.reduce(function(a, b) { return a + b; }, 0) / prevVolumes.length;
  
  resonance.volume_confirmed = currentVolume > avgVolume * 1.2;
  
  return {
    resonance: resonance,
    currentRSI: currentRSI[nCurrent],
    higherRSI: higherRSI[nHigher],
    currentVolume: currentVolume,
    avgVolume: avgVolume,
    volumeRatio: currentVolume / avgVolume
  };
}

/** 信号强度评分系统 - 直接100分制 */
function calculateSignalStrength(signalType, conditions, resonance, bars) {
  var score = 0;
  var maxScore = 100;
  var scoreDetails = {
    baseConditions: { score: 0, max: 17, items: [] },  // 17% of total
    resonance: { score: 0, max: 43, items: [] },       // 43% of total
    trend: { score: 0, max: 17, items: [] },           // 17% of total
    volatility: { score: 0, max: 17, items: [] },      // 17% of total
    volume: { score: 0, max: 6, items: [] }            // 6% of total
  };
  
  // 基础条件评分 (0-17分)
  conditions.forEach(function(c) {
    var itemScore = c.ok ? 5.7 : 0; // 每项5.7分，3项共17.1分
    score += itemScore;
    scoreDetails.baseConditions.score += itemScore;
    scoreDetails.baseConditions.items.push({
      label: c.label,
      score: Math.round(itemScore),
      max: 6,
      ok: c.ok,
      tip: c.tip
    });
  });
  
  // 多周期共振评分 (0-43分)
  var resonanceItems = [
    { key: 'trend_aligned', label: '趋势一致性', score: 15, ok: resonance.trend_aligned },
    { key: 'rsi_extreme', label: 'RSI极端值', score: 9, ok: resonance.rsi_extreme },
    { key: 'macd_aligned', label: 'MACD方向', score: 12, ok: resonance.macd_aligned },
    { key: 'volume_confirmed', label: '成交量确认', score: 7, ok: resonance.volume_confirmed }
  ];
  resonanceItems.forEach(function(item) {
    var itemScore = item.ok ? item.score : 0;
    score += itemScore;
    scoreDetails.resonance.score += itemScore;
    scoreDetails.resonance.items.push({
      label: item.label,
      score: itemScore,
      max: item.score,
      ok: item.ok
    });
  });
  
  // 趋势强度评分 (0-17分) - 优化版本
  var trend = determineTrend(bars);
  var trendScore = 0;
  var trendLabel = '';
  
  // 检查信号方向与趋势方向是否一致
  var isTrendAligned = (signalType === 'long' && trend.trend === 'up') || 
                      (signalType === 'short' && trend.trend === 'down');
  
  if (isTrendAligned && trend.trendStrength >= 70) {
    // 强势趋势：17分
    trendScore = 17;
    trendLabel = '强势趋势(' + trend.trend + ')';
  } else if (isTrendAligned && trend.trendStrength >= 40) {
    // 一般趋势：11分
    trendScore = 11;
    trendLabel = '一般趋势(' + trend.trend + ')';
  } else if (trend.trend === 'sideways') {
    // 中性/震荡：3分
    trendScore = 3;
    trendLabel = '中性震荡';
  } else {
    // 趋势相反：3分
    trendScore = 3;
    trendLabel = '趋势相反';
  }
  
  score += trendScore;
  scoreDetails.trend.score = trendScore;
  scoreDetails.trend.items.push({
    label: trendLabel,
    score: Math.round(trendScore),
    max: 17,
    trend: trend.trend,
    strength: trend.trendStrength,
    aligned: isTrendAligned
  });
  
  // 波动率评分 (0-17分)
  var atrValues = calculateATR(bars);
  var currentATR = atrValues[atrValues.length - 1];
  var price = bars[bars.length - 1].close;
  var atrPercent = (currentATR / price) * 100;
  var volatilityScore = 0;
  var volatilityLabel = '';
  
  if (atrPercent >= 2 && atrPercent <= 4) {
    // 理想波动率 2-4% → 17分
    volatilityScore = 17;
    volatilityLabel = '理想波动率(' + atrPercent.toFixed(2) + '%)';
  } else if (atrPercent >= 1 && atrPercent <= 5) {
    // 良好波动率 1-5% → 11分
    volatilityScore = 11;
    volatilityLabel = '良好波动率(' + atrPercent.toFixed(2) + '%)';
  } else if (atrPercent >= 0.5 && atrPercent <= 8) {
    // 一般波动率 0.5-8% → 6分
    volatilityScore = 6;
    volatilityLabel = '一般波动率(' + atrPercent.toFixed(2) + '%)';
  } else {
    volatilityLabel = '波动率异常(' + atrPercent.toFixed(2) + '%)';
  }
  score += volatilityScore;
  scoreDetails.volatility.score = volatilityScore;
  scoreDetails.volatility.items.push({
    label: volatilityLabel,
    score: Math.round(volatilityScore),
    max: 17,
    atrPercent: atrPercent
  });
  
  // 成交量评分 (0-6分)
  var avgVolume = getAverageVolume(bars, 20);
  var lastVolume = bars[bars.length - 1].volume;
  var volumeScore = 0;
  var volumeLabel = '';
  var volumeRatio = lastVolume / avgVolume;
  
  if (lastVolume >= avgVolume * 1.5) {
    // 1.5倍→6分
    volumeScore = 6;
    volumeLabel = '放量(' + volumeRatio.toFixed(2) + '倍)';
  } else if (lastVolume >= avgVolume * 1.2) {
    // 1.2倍→4分
    volumeScore = 4;
    volumeLabel = '温和放量(' + volumeRatio.toFixed(2) + '倍)';
  } else if (lastVolume > avgVolume) {
    // 轻微→2分
    volumeScore = 2;
    volumeLabel = '轻微放量(' + volumeRatio.toFixed(2) + '倍)';
  } else {
    volumeLabel = '缩量(' + volumeRatio.toFixed(2) + '倍)';
  }
  score += volumeScore;
  scoreDetails.volume.score = volumeScore;
  scoreDetails.volume.items.push({
    label: volumeLabel,
    score: Math.round(volumeScore),
    max: 6,
    volumeRatio: volumeRatio
  });
  
  // 添加随机波动因子，避免分数完全相同
  var randomFactor = Math.random() * 2 - 1; // -1到1之间的随机数
  score += randomFactor;
  
  // 确保分数在合理范围内
  score = Math.min(maxScore, Math.max(0, score));
  
  return {
    total: score,
    max: maxScore,
    details: scoreDetails,
    rawScore: score
  };
}

/** 计算入场区间和止损止盈 */
function calculateTradeLevels(signalType, bars, atrPeriod) {
  atrPeriod = atrPeriod || 14;
  var lastBar = bars[bars.length - 1];
  var atrValues = calculateATR(bars, atrPeriod);
  var currentATR = atrValues[atrValues.length - 1];
  var price = lastBar.close;
  
  var entryZone = [];
  var stopLoss = 0;
  var takeProfits = [];
  
  // 计算最近的支撑位/阻力位
  var recentLows = [];
  var recentHighs = [];
  for (var i = Math.max(0, bars.length - 20); i < bars.length; i++) {
    recentLows.push(bars[i].low);
    recentHighs.push(bars[i].high);
  }
  var recentLow = Math.min.apply(Math, recentLows);
  var recentHigh = Math.max.apply(Math, recentHighs);
  
  // 调整止损距离，基于ATR的0.6倍，同时考虑最近的支撑位/阻力位
  var stopLossMultiplier = 0.6; // 减小止损距离到0.6倍ATR
  
  if (signalType === 'long') {
    entryZone = [price - currentATR * 0.5, price];
    // 止损设置在最近低点下方或0.6倍ATR，取较大值
    var atrStopLoss = price - currentATR * stopLossMultiplier;
    var supportStopLoss = recentLow - 50; // 最近低点下方50点
    stopLoss = Math.max(atrStopLoss, supportStopLoss);
    takeProfits = [
      price + currentATR * 1.2, // 止盈1：1.2倍ATR
      price + currentATR * 2.0, // 止盈2：2.0倍ATR
      price + currentATR * 2.8  // 止盈3：2.8倍ATR
    ];
  } else if (signalType === 'short') {
    entryZone = [price, price + currentATR * 0.5];
    // 止损设置在最近高点上方或0.6倍ATR，取较小值
    var atrStopLoss = price + currentATR * stopLossMultiplier;
    var resistanceStopLoss = recentHigh + 50; // 最近高点上方50点
    stopLoss = Math.min(atrStopLoss, resistanceStopLoss);
    takeProfits = [
      price - currentATR * 1.2, // 止盈1：1.2倍ATR
      price - currentATR * 2.0, // 止盈2：2.0倍ATR
      price - currentATR * 2.8  // 止盈3：2.8倍ATR
    ];
  }
  
  return {
    entryZone: entryZone.map(function(p) { return Math.round(p * 10) / 10; }),
    stopLoss: Math.round(stopLoss * 10) / 10,
    takeProfits: takeProfits.map(function(p) { return Math.round(p * 10) / 10; }),
    atr: Math.round(currentATR * 10) / 10,
    atrPercent: Math.round((currentATR / price) * 100 * 100) / 100
  };
}

/** 仓位建议（根据信号强度） */
function calculatePositionAdvice(signalStrength, entryPrice, stopLoss, accountBalance) {
  accountBalance = accountBalance || 10000;
  var positionRatios = {
    5: 0.50,
    4: 0.30,
    3: 0.20,
    2: 0.10,
    1: 0.05
  };
  
  var positionRatio = positionRatios[signalStrength] || 0.10;
  var positionValue = accountBalance * positionRatio;
  var stopDistance = Math.abs(entryPrice - stopLoss);
  
  var contractSize = entryPrice;
  var contracts = Math.floor(positionValue / contractSize);
  
  return {
    signalStrength: signalStrength,
    starRating: '⭐'.repeat(signalStrength) + '☆'.repeat(5 - signalStrength),
    positionRatio: Math.round(positionRatio * 100),
    suggestedContracts: contracts,
    positionValue: Math.round(positionValue),
    riskPerTrade: Math.round(stopDistance * contracts),
    stopDistance: Math.round(stopDistance * 10) / 10
  };
}

/** 获取更高周期 */
function getHigherInterval(interval) {
  var intervalMap = {
    '15m': '1h',
    '1h': '4h',
    '4h': '1d',
    '1d': '1w'
  };
  return intervalMap[interval] || null;
}

/** 主检测函数 - 专业版 */
async function detectSignal(interval) {
  interval = interval || '15m';
  var limit = 200;
  
  var cached = getCached(interval);
  if (cached) return cached;
  
  var bars = await fetchKlines(interval, limit);
  
  var higherBars = [];
  try {
    var higherInterval = getHigherInterval(interval);
    if (higherInterval) {
      higherBars = await fetchKlines(higherInterval, Math.floor(limit / 2));
    }
  } catch (e) {
    console.warn('高周期数据获取失败:', e.message);
  }
  
  var resonanceInfo = higherBars.length > 0 ? 
    checkMultiPeriodResonance(bars, higherBars) : 
    { resonance: {}, currentRSI: 50, higherRSI: null, volumeRatio: 1 };
  
  var lastBar = bars[bars.length - 1];
  var prevBar = bars[bars.length - 2];
  var prevPrevBar = bars[bars.length - 3]; // 前第二根K线，用于多K线确认
  
  var body = Math.abs(prevBar.close - prevBar.open) || 0.01;
  var lowerShadow = Math.min(prevBar.open, prevBar.close) - prevBar.low;
  var upperShadow = prevBar.high - Math.max(prevBar.open, prevBar.close);
  
  // 插针检测：要求影线至少是实体的3倍，且价格在K线中上部
  // 多K线确认：前1-2根K线中只要有1根满足插针条件即可（改为OR逻辑，更宽松）
  var prevBody = Math.abs(prevPrevBar.close - prevPrevBar.open) || 0.01;
  var prevLowerShadow = Math.min(prevPrevBar.open, prevPrevBar.close) - prevPrevBar.low;
  var prevUpperShadow = prevPrevBar.high - Math.max(prevPrevBar.open, prevPrevBar.close);
  
  // 当前K线的插针判定
  var isLongPinCurrent = lowerShadow >= body * 3 && prevBar.close > (prevBar.low + (prevBar.high - prevBar.low) * 0.6);
  var isShortPinCurrent = upperShadow >= body * 3 && prevBar.close < (prevBar.high - (prevBar.high - prevBar.low) * 0.6);
  
  // 前一根K线的插针判定（标准稍宽松）
  var isLongPinPrev = prevLowerShadow >= prevBody * 2.5 && prevPrevBar.close > (prevPrevBar.low + (prevPrevBar.high - prevPrevBar.low) * 0.6);
  var isShortPinPrev = prevUpperShadow >= prevBody * 2.5 && prevPrevBar.close < (prevPrevBar.high - (prevPrevBar.high - prevPrevBar.low) * 0.6);
  
  // 多K线确认：当前K线或前一根K线满足条件即可（OR逻辑，更容易触发信号）
  var isLongPin = isLongPinCurrent || isLongPinPrev;
  var isShortPin = isShortPinCurrent || isShortPinPrev;
  
  var c2Long = lastBar.low > prevBar.low && lastBar.close > lastBar.open;
  var c2Short = lastBar.high < prevBar.high && lastBar.close < lastBar.open;
  
  var closes = bars.map(function(b) { return b.close; });
  var highs = bars.map(function(b) { return b.high; });
  var lows = bars.map(function(b) { return b.low; });
  
  // 计算动量指标
  var n = closes.length - 1;
  var momentum = (closes[n] - closes[Math.max(0, n - 10)]) / closes[Math.max(0, n - 10)] * 100;
  
  var macdData = macd(closes);
  var kdjData = kdj(highs, lows, closes);
  var rsiArr = rsi(closes);
  var wrArr = wr(highs, lows, closes);
  var bollArr = boll(closes);
  
  var n = closes.length - 1;
  
  var macdBar = macdData.bar[n];
  var macdPrev = macdData.bar[n - 1];
  var jVal = kdjData.J[n];
  var rsiVal = rsiArr[n];
  var wrVal = wrArr[n];
  var bollLast = bollArr[n];
  
  var c4Long = macdBar > macdPrev || (macdData.dif[n] > macdData.dea[n] && macdData.dif[n-1] <= macdData.dea[n-1]);
  var c4Short = macdBar < macdPrev || (macdData.dif[n] < macdData.dea[n] && macdData.dif[n-1] >= macdData.dea[n-1]);
  
  var signalType = null;
  
  // ★ 趋势过滤 - 避免震荡市频繁切换
  var trendInfo = determineTrend(bars);
  var trendDirection = trendInfo.trend; // 'up', 'down', 'sideways'
  var trendStrength = trendInfo.trendStrength || 0; // 0-100
  
  // 增强的信号检测条件
  var volumeConditions = {
    long: prevBar.volume > getAverageVolume(bars, 20) * 1.2,
    short: prevBar.volume > getAverageVolume(bars, 20) * 1.2
  };
  
  // 优化RSI条件：在趋势中允许更宽松的RSI范围
  var rsiConditions = {
    long: rsiVal < 45 || (trendDirection === 'up' && rsiVal < 55),  // 超卖区域或上升趋势中相对低位
    short: rsiVal > 55 || (trendDirection === 'down' && rsiVal > 45)  // 超买区域或下降趋势中相对高位
  };
  
  // 优化布林带条件：允许价格在布林带附近，不要求完全突破
  var bollConditions = {
    long: lastBar.close < bollLast.middle || lastBar.close < bollLast.lower * 1.02,
    short: lastBar.close > bollLast.middle || lastBar.close > bollLast.upper * 0.98
  };
  
  // ★ 增强趋势一致性检查 - 基于趋势强度动态调整
  var trendAlignment = {
    long: true,
    short: true
  };
  
  // 根据趋势强度动态调整信号允许范围
  if (trendDirection === 'up') {
    // 上升趋势中：根据趋势强度限制做空信号
    if (trendStrength >= 70) {
      trendAlignment.short = false; // 强上升趋势中完全禁止做空
    } else if (trendStrength >= 50) {
      trendAlignment.short = false; // 中等上升趋势中禁止做空
    }
    // 上升趋势中做多信号更容易通过
  } else if (trendDirection === 'down') {
    // 下降趋势中：根据趋势强度限制做多信号
    if (trendStrength >= 70) {
      trendAlignment.long = false; // 强下降趋势中完全禁止做多
    } else if (trendStrength >= 50) {
      trendAlignment.long = false; // 中等下降趋势中禁止做多
    }
    // 下降趋势中做空信号更容易通过
  } else {
    // 震荡市中：根据趋势强度调整信号允许范围
    if (trendStrength >= 60) {
      // 强震荡市中，只允许与短期动量方向一致的信号
      trendAlignment.long = momentum > 0;
      trendAlignment.short = momentum < 0;
    }
  }
  
  // ★ 增强的信号质量过滤
  var signalQuality = {
    long: {
      volume: volumeConditions.long,
      rsi: rsiConditions.long,
      boll: bollConditions.long,
      trend: trendAlignment.long,
      // 额外条件：价格在MA上方
      ma: lastBar.close > calculateMA(bars, 20),
      // 额外条件：MACD金叉
      macd: macdBar > 0 && macdData.dif[n] > macdData.dea[n],
      // 变盘特殊条件
      reversal: !trendInfo.isTrendReversal || (trendInfo.isTrendReversal && trendInfo.goldenCross),
      // 额外条件：趋势强度
      trendStrength: trendDirection === 'up' || (trendDirection === 'sideways' && trendStrength < 60)
    },
    short: {
      volume: volumeConditions.short,
      rsi: rsiConditions.short,
      boll: bollConditions.short,
      trend: trendAlignment.short,
      // 额外条件：价格在MA下方
      ma: lastBar.close < calculateMA(bars, 20),
      // 额外条件：MACD死叉
      macd: macdBar < 0 && macdData.dif[n] < macdData.dea[n],
      // 变盘特殊条件
      reversal: !trendInfo.isTrendReversal || (trendInfo.isTrendReversal && trendInfo.deathCross),
      // 额外条件：趋势强度
      trendStrength: trendDirection === 'down' || (trendDirection === 'sideways' && trendStrength < 60),
      // 额外条件：在强上升趋势中禁止做空
      noStrongUpTrend: !(trendDirection === 'up' && trendStrength > 60)
    }
  };
  
  // 计算信号质量分数
  function calculateQualityScore(conditions) {
    var total = Object.keys(conditions).length;
    var met = Object.values(conditions).filter(Boolean).length;
    return (met / total) * 100;
  }
  
  var longQualityScore = calculateQualityScore(signalQuality.long);
  var shortQualityScore = calculateQualityScore(signalQuality.short);
  
  // 增强的做多信号条件（添加更多质量过滤）
  if (isLongPin && c2Long && c4Long && (longQualityScore >= 70 || (trendInfo.isTrendReversal && trendInfo.goldenCross && longQualityScore >= 60))) {
    // 检查信号冷却
    var lastSignal = getLastSignalInfo();
    var canGenerateSignal = checkSignalCooldown(lastSignal, 'long');
    if (canGenerateSignal) {
      signalType = 'long';
    } else {
      console.log('[信号冷却] 做多信号被冷却限制');
    }
  }
  
  // 增强的做空信号条件（添加更多质量过滤）
  if (isShortPin && c2Short && c4Short && (shortQualityScore >= 70 || (trendInfo.isTrendReversal && trendInfo.deathCross && shortQualityScore >= 60))) {
    // 检查信号冷却
    var lastSignal = getLastSignalInfo();
    var canGenerateSignal = checkSignalCooldown(lastSignal, 'short');
    if (canGenerateSignal) {
      signalType = 'short';
    } else {
      console.log('[信号冷却] 做空信号被冷却限制');
    }
  }
  
  var longConditions = [
    { label: '下影插针', ok: isLongPin, tip: '下影' + lowerShadow.toFixed(0) + ' vs 实体' + body.toFixed(0) },
    { label: '低点抬高', ok: c2Long, tip: lastBar.low > prevBar.low ? '确认低' + lastBar.low.toFixed(0) + '>插针低' + prevBar.low.toFixed(0) : '未确认' },
    { label: 'MACD配合', ok: c4Long, tip: macdBar > 0 ? 'MACD多头' : 'MACD止跌' },
  ];
  
  var shortConditions = [
    { label: '上影插针', ok: isShortPin, tip: '上影' + upperShadow.toFixed(0) + ' vs 实体' + body.toFixed(0) },
    { label: '高点压制', ok: c2Short, tip: lastBar.high < prevBar.high ? '确认高' + lastBar.high.toFixed(0) + '<插针高' + prevBar.high.toFixed(0) : '未确认' },
    { label: 'MACD配合', ok: c4Short, tip: macdBar < 0 ? 'MACD空头' : 'MACD止涨' },
  ];
  
  var scoreResult = signalType ? 
    calculateSignalStrength(signalType, 
      signalType === 'long' ? longConditions : shortConditions,
      resonanceInfo.resonance,
      bars) : null;
  
  var signalStrength = 0;
  var scoreDetails = null;
  
  // 直接使用100分制，做多为正值，做空为负值
  if (signalType && scoreResult) {
    var rawScore = scoreResult.rawScore;
    scoreDetails = scoreResult.details;
    
    if (signalType === 'long') {
      // 做多：0-100分
      signalStrength = Math.round(rawScore);
    } else {
      // 做空：-100到0分
      signalStrength = Math.round(-rawScore);
    }
    
    // ★ 横盘整理特殊处理：在横盘整理时降低信号评分（减少降低幅度）
    if (trendInfo.trend === 'sideways') {
      // 横盘整理时降低信号评分（从30分减少到15分）
      var sidewaysReduction = 15; // 横盘整理时降低15分
      if (signalType === 'long') {
        signalStrength = Math.max(0, signalStrength - sidewaysReduction);
      } else {
        signalStrength = Math.min(0, signalStrength + sidewaysReduction);
      }
      console.log('[横盘整理] 信号评分已调整:', signalStrength);
    }
    
    // ★ 记录信号生成
    recordSignal(signalType, signalStrength);
  }
  
  var tradeLevels = signalType ? calculateTradeLevels(signalType, bars) : null;
  
  // 计算支撑位和阻力位
  var recentLows = [];
  var recentHighs = [];
  for (var i = Math.max(0, bars.length - 20); i < bars.length; i++) {
    recentLows.push(bars[i].low);
    recentHighs.push(bars[i].high);
  }
  var nearestSupport = Math.min.apply(Math, recentLows);
  var nearestResistance = Math.max.apply(Math, recentHighs);
  
  var positionAdvice = signalType && tradeLevels ? 
    calculatePositionAdvice(
      signalStrength, 
      lastBar.close, 
      tradeLevels.stopLoss,
      CONFIG.ACCOUNT_BALANCE || 10000
    ) : null;
  
  // 修复：signalConfidence应该根据信号类型保持正负号
  // 对于做多信号，signalStrength是正数，signalConfidence保持正数
  // 对于做空信号，signalStrength是正数，signalConfidence转为负数
  const signalConfidence = signalType === 'long' ? signalStrength : -signalStrength;
  
  var result = {
    type: signalType,
    signalStrength: Math.abs(signalStrength), // signalStrength保持正数
    signalConfidence: signalConfidence, // signalConfidence保持正负号
    starRating: positionAdvice ? positionAdvice.starRating : '无信号',
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
    ma20: trendInfo.ma20,
    ma60: trendInfo.ma60,
    trendStrength: trendInfo.trendStrength, // 趋势强度
    
    macdBar: macdBar, macdPrev: macdPrev,
    dif: macdData.dif[n], dea: macdData.dea[n],
    kVal: kdjData.K[n], dVal: kdjData.D[n], jVal: jVal,
    rsiVal: rsiVal, wrVal: wrVal,
    bollLast: bollLast,
    
    tradeLevels: tradeLevels,
    positionAdvice: positionAdvice,
    
    lastBar: lastBar,
    prevBar: prevBar,
    
    // ★ 支撑位和阻力位
    nearestSupport: nearestSupport,
    nearestResistance: nearestResistance,
    
    // ★ 详细评分信息
    scoreDetails: scoreDetails,
    rawScore: scoreResult ? scoreResult.rawScore : 0
  };
  
  setCache(interval, result);
  return result;
}

// 清除缓存
function clearSignalCache(interval) {
  clearCache(interval);
}

// 暴露全局函数
window.detectSignal = detectSignal;
window.clearSignalCache = clearSignalCache;

console.log('[Detector] 信号检测模块已加载');
