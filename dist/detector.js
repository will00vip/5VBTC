// detector.js - 专业交易算法模型 v5.0（浏览器版本）
// ───────────────────────────────────────────────

// 内存缓存（30s内复用，切换周期时清空）
var _cache = {};
function getCacheKey(interval) { return interval; }
function getCached(interval) {
  var c = _cache[getCacheKey(interval)];
  if (c && Date.now() - c.ts < 30000) return c.data;
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
  signalCount: 0
};

// ★ 获取上次信号信息
function getLastSignalInfo() {
  return _signalHistory;
}

// ★ 检查信号冷却 - 防止频繁交易
function checkSignalCooldown(lastSignal, currentType) {
  var now = Date.now();
  var cooldownPeriod = 10 * 60 * 1000; // 10分钟冷却期
  var minInterval = 5 * 60 * 1000; // 同一方向信号至少间隔5分钟
  
  // 如果没有上次信号，允许生成
  if (!lastSignal || !lastSignal.lastSignalTime) {
    return true;
  }
  
  var timeSinceLastSignal = now - lastSignal.lastSignalTime;
  
  // 10分钟内不生成任何新信号
  if (timeSinceLastSignal < cooldownPeriod) {
    console.log('[信号冷却] 冷却期中，剩余:', Math.round((cooldownPeriod - timeSinceLastSignal) / 1000), '秒');
    return false;
  }
  
  // 如果方向相同，需要更长的间隔（15分钟）
  if (currentType && currentType === lastSignal.lastSignalType) {
    if (timeSinceLastSignal < 15 * 60 * 1000) {
      console.log('[信号冷却] 同方向信号间隔太短');
      return false;
    }
  }
  
  return true;
}

// ★ 记录信号生成
function recordSignal(signalType, score) {
  _signalHistory.lastSignalTime = Date.now();
  _signalHistory.lastSignalType = signalType;
  _signalHistory.lastSignalScore = score;
  _signalHistory.signalCount++;
  console.log('[信号记录] 类型:', signalType, '分数:', score, '时间:', new Date().toLocaleString());
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

/** 判断趋势方向和强度 */
function determineTrend(bars) {
  var closes = bars.map(function(b) { return b.close; });
  var ema20 = ema(closes, 20);
  var ema60 = ema(closes, 60);
  var n = closes.length - 1;
  
  var price = closes[n];
  var ma20 = ema20[n];
  var ma60 = ema60[n];
  
  // 计算趋势强度 (0-100)
  var ma20Slope = (ema20[n] - ema20[n - 5]) / ema20[n - 5] * 100;
  var ma60Slope = (ema60[n] - ema60[n - 10]) / ema60[n - 10] * 100;
  var priceToMA20 = (price - ma20) / ma20 * 100;
  var priceToMA60 = (price - ma60) / ma60 * 100;
  
  var trendStrength = 0;
  var trend = 'sideways';
  
  // 强多头：价格在MA20之上，MA20在MA60之上，且都向上
  if (price > ma20 && ma20 > ma60 && ma20Slope > 0.1) {
    trend = 'up';
    trendStrength = Math.min(100, 50 + Math.abs(ma20Slope) * 10 + Math.abs(priceToMA20) * 2);
  }
  // 强空头：价格在MA20之下，MA20在MA60之下，且都向下
  else if (price < ma20 && ma20 < ma60 && ma20Slope < -0.1) {
    trend = 'down';
    trendStrength = Math.min(100, 50 + Math.abs(ma20Slope) * 10 + Math.abs(priceToMA20) * 2);
  }
  // 震荡市
  else {
    trend = 'sideways';
    trendStrength = Math.max(0, 30 - Math.abs(ma20Slope) * 5);
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
    ma60Slope: ma60Slope
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
  
  if (currentTrend.trend.indexOf('bull') >= 0 && higherTrend.trend.indexOf('bull') >= 0) {
    resonance.trend_aligned = true;
  } else if (currentTrend.trend.indexOf('bear') >= 0 && higherTrend.trend.indexOf('bear') >= 0) {
    resonance.trend_aligned = true;
  }
  
  var currentCloses = currentBars.map(function(b) { return b.close; });
  var higherCloses = higherBars.map(function(b) { return b.close; });
  var currentRSI = rsi(currentCloses);
  var higherRSI = rsi(higherCloses);
  
  var nCurrent = currentCloses.length - 1;
  var nHigher = higherCloses.length - 1;
  
  if (currentRSI[nCurrent] < 30 && higherRSI[nHigher] < 40) {
    resonance.rsi_extreme = 'oversold';
  } else if (currentRSI[nCurrent] > 70 && higherRSI[nHigher] > 60) {
    resonance.rsi_extreme = 'overbought';
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

/** 信号强度评分系统 (1-5星) - 返回详细得分 */
function calculateSignalStrength(signalType, conditions, resonance, bars) {
  var score = 0;
  var maxScore = 35;
  var scoreDetails = {
    baseConditions: { score: 0, max: 6, items: [] },
    resonance: { score: 0, max: 15, items: [] },
    trend: { score: 0, max: 6, items: [] },
    volatility: { score: 0, max: 6, items: [] },
    volume: { score: 0, max: 3, items: [] }
  };
  
  // 基础条件评分 (0-6分)
  conditions.forEach(function(c) {
    var itemScore = c.ok ? 2 : 0;
    score += itemScore;
    scoreDetails.baseConditions.score += itemScore;
    scoreDetails.baseConditions.items.push({
      label: c.label,
      score: itemScore,
      max: 2,
      ok: c.ok,
      tip: c.tip
    });
  });
  
  // 多周期共振评分 (0-15分)
  var resonanceItems = [
    { key: 'trend_aligned', label: '趋势一致性', score: 5, ok: resonance.trend_aligned },
    { key: 'rsi_extreme', label: 'RSI极端值', score: 3, ok: resonance.rsi_extreme },
    { key: 'macd_aligned', label: 'MACD方向', score: 4, ok: resonance.macd_aligned },
    { key: 'volume_confirmed', label: '成交量确认', score: 3, ok: resonance.volume_confirmed }
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
  
  // 趋势强度评分 (0-6分)
  var trend = determineTrend(bars);
  var trendScore = 0;
  var trendLabel = '';
  if (trend.trend === 'strong_bull' || trend.trend === 'strong_bear') {
    trendScore = 6;
    trendLabel = '强势' + (signalType === 'long' ? '多头' : '空头');
  } else if (trend.trend === 'bull' || trend.trend === 'bear') {
    trendScore = 4;
    trendLabel = '一般' + (signalType === 'long' ? '多头' : '空头');
  } else if (trend.trend === 'neutral') {
    trendScore = 1;
    trendLabel = '中性趋势';
  } else {
    trendLabel = '震荡行情';
  }
  score += trendScore;
  scoreDetails.trend.score = trendScore;
  scoreDetails.trend.items.push({
    label: trendLabel,
    score: trendScore,
    max: 6,
    trend: trend.trend,
    strength: trend.strength
  });
  
  // 波动率评分 (0-6分)
  var atrValues = calculateATR(bars);
  var currentATR = atrValues[atrValues.length - 1];
  var price = bars[bars.length - 1].close;
  var atrPercent = (currentATR / price) * 100;
  var volatilityScore = 0;
  var volatilityLabel = '';
  
  if (atrPercent >= 2 && atrPercent <= 4) {
    volatilityScore = 6;
    volatilityLabel = '理想波动率(' + atrPercent.toFixed(2) + '%)';
  } else if (atrPercent >= 1 && atrPercent <= 5) {
    volatilityScore = 4;
    volatilityLabel = '良好波动率(' + atrPercent.toFixed(2) + '%)';
  } else if (atrPercent >= 0.5 && atrPercent <= 8) {
    volatilityScore = 2;
    volatilityLabel = '一般波动率(' + atrPercent.toFixed(2) + '%)';
  } else {
    volatilityLabel = '波动率异常(' + atrPercent.toFixed(2) + '%)';
  }
  score += volatilityScore;
  scoreDetails.volatility.score = volatilityScore;
  scoreDetails.volatility.items.push({
    label: volatilityLabel,
    score: volatilityScore,
    max: 6,
    atrPercent: atrPercent
  });
  
  // 成交量评分 (0-3分)
  var avgVolume = getAverageVolume(bars, 20);
  var lastVolume = bars[bars.length - 1].volume;
  var volumeScore = 0;
  var volumeLabel = '';
  var volumeRatio = lastVolume / avgVolume;
  
  if (lastVolume > avgVolume * 1.5) {
    volumeScore = 3;
    volumeLabel = '放量(' + volumeRatio.toFixed(2) + '倍)';
  } else if (lastVolume > avgVolume * 1.2) {
    volumeScore = 2;
    volumeLabel = '温和放量(' + volumeRatio.toFixed(2) + '倍)';
  } else if (lastVolume > avgVolume) {
    volumeScore = 1;
    volumeLabel = '轻微放量(' + volumeRatio.toFixed(2) + '倍)';
  } else {
    volumeLabel = '缩量(' + volumeRatio.toFixed(2) + '倍)';
  }
  score += volumeScore;
  scoreDetails.volume.score = volumeScore;
  scoreDetails.volume.items.push({
    label: volumeLabel,
    score: volumeScore,
    max: 3,
    volumeRatio: volumeRatio
  });
  
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
  
  if (signalType === 'long') {
    entryZone = [price - currentATR * 0.5, price];
    stopLoss = price - currentATR * 1.5;
    takeProfits = [
      price + currentATR * 1.5,
      price + currentATR * 3.0,
      price + currentATR * 4.5
    ];
  } else if (signalType === 'short') {
    entryZone = [price, price + currentATR * 0.5];
    stopLoss = price + currentATR * 1.5;
    takeProfits = [
      price - currentATR * 1.5,
      price - currentATR * 3.0,
      price - currentATR * 4.5
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
  
  var body = Math.abs(prevBar.close - prevBar.open) || 0.01;
  var lowerShadow = Math.min(prevBar.open, prevBar.close) - prevBar.low;
  var upperShadow = prevBar.high - Math.max(prevBar.open, prevBar.close);
  
  var isLongPin = lowerShadow >= body * 2 && prevBar.close > (prevBar.low + (prevBar.high - prevBar.low) * 0.5);
  var isShortPin = upperShadow >= body * 2 && prevBar.close < (prevBar.high - (prevBar.high - prevBar.low) * 0.5);
  
  var c2Long = lastBar.low > prevBar.low && lastBar.close > lastBar.open;
  var c2Short = lastBar.high < prevBar.high && lastBar.close < lastBar.open;
  
  var closes = bars.map(function(b) { return b.close; });
  var highs = bars.map(function(b) { return b.high; });
  var lows = bars.map(function(b) { return b.low; });
  
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
  var trendStrength = trendInfo.strength || 0; // 0-100
  
  // 增强的信号检测条件
  var volumeConditions = {
    long: prevBar.volume > getAverageVolume(bars, 20) * 1.2,
    short: prevBar.volume > getAverageVolume(bars, 20) * 1.2
  };
  
  var rsiConditions = {
    long: rsiVal < 40,  // 超卖区域
    short: rsiVal > 60  // 超买区域
  };
  
  var bollConditions = {
    long: lastBar.close < bollLast.lower,
    short: lastBar.close > bollLast.upper
  };
  
  // ★ 趋势一致性检查 - 只做与趋势方向一致的信号
  var trendAlignment = {
    long: trendDirection === 'up' || trendDirection === 'sideways',
    short: trendDirection === 'down' || trendDirection === 'sideways'
  };
  
  // ★ 信号冷却检查 - 防止频繁交易
  var lastSignal = getLastSignalInfo();
  var canGenerateSignal = checkSignalCooldown(lastSignal, signalType);
  
  // 增强的做多信号条件（添加趋势过滤）
  if (isLongPin && c2Long && c4Long && volumeConditions.long && rsiConditions.long && trendAlignment.long && canGenerateSignal) {
    signalType = 'long';
  }
  
  // 增强的做空信号条件（添加趋势过滤）
  if (isShortPin && c2Short && c4Short && volumeConditions.short && rsiConditions.short && trendAlignment.short && canGenerateSignal) {
    signalType = 'short';
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
  
  // 将0-35分映射到60-100分（做多）或-100到-60分（做空）
  if (signalType && scoreResult) {
    var rawScore = scoreResult.rawScore;
    scoreDetails = scoreResult.details;
    
    if (signalType === 'long') {
      // 做多：0-35 → 60-100分
      signalStrength = Math.round(60 + (rawScore / 35) * 40);
    } else {
      // 做空：0-35 → -100到-60分
      signalStrength = Math.round(-100 + (rawScore / 35) * 40);
    }
    
    // ★ 记录信号生成
    recordSignal(signalType, signalStrength);
  }
  
  var tradeLevels = signalType ? calculateTradeLevels(signalType, bars) : null;
  
  var positionAdvice = signalType && tradeLevels ? 
    calculatePositionAdvice(
      signalStrength, 
      lastBar.close, 
      tradeLevels.stopLoss,
      CONFIG.ACCOUNT_BALANCE || 10000
    ) : null;
  
  var trendInfo = determineTrend(bars);
  
  var result = {
    type: signalType,
    signalStrength: signalStrength,
    signalConfidence: signalStrength, // 与signalStrength保持一致，供UI和推送使用
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
    trendStrength: trendInfo.strength, // 趋势强度
    
    macdBar: macdBar, macdPrev: macdPrev,
    dif: macdData.dif[n], dea: macdData.dea[n],
    kVal: kdjData.K[n], dVal: kdjData.D[n], jVal: jVal,
    rsiVal: rsiVal, wrVal: wrVal,
    bollLast: bollLast,
    
    tradeLevels: tradeLevels,
    positionAdvice: positionAdvice,
    
    lastBar: lastBar,
    prevBar: prevBar,
    
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
