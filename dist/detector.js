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

/** 判断趋势方向 */
function determineTrend(bars) {
  var closes = bars.map(function(b) { return b.close; });
  var ema20 = ema(closes, 20);
  var ema60 = ema(closes, 60);
  var n = closes.length - 1;
  
  var price = closes[n];
  var ma20 = ema20[n];
  var ma60 = ema60[n];
  
  var trend = 'neutral';
  if (price > ma20 && ma20 > ma60) trend = 'strong_bull';
  else if (price > ma20 && ma20 > ma60 * 0.98) trend = 'bull';
  else if (price < ma20 && ma20 < ma60) trend = 'strong_bear';
  else if (price < ma20 && ma20 < ma60 * 1.02) trend = 'bear';
  
  return {
    trend: trend,
    price: price,
    ma20: ma20,
    ma60: ma60,
    aboveMA20: price > ma20,
    aboveMA60: price > ma60
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

/** 信号强度评分系统 (1-5星) */
function calculateSignalStrength(signalType, conditions, resonance, bars) {
  var score = 0;
  var maxScore = 35; // 增加最大分数，使评分更加严格
  
  // 基础条件评分
  var baseConditionsMet = conditions.filter(function(c) { return c.ok; }).length;
  score += baseConditionsMet * 2; // 增加基础条件权重
  
  // 多周期共振评分
  if (resonance.trend_aligned) score += 5;
  if (resonance.rsi_extreme) score += 3;
  if (resonance.macd_aligned) score += 4;
  if (resonance.volume_confirmed) score += 3;
  
  // 趋势强度评分
  var trend = determineTrend(bars);
  if (trend.trend === 'strong_bull' || trend.trend === 'strong_bear') score += 6;
  else if (trend.trend === 'bull' || trend.trend === 'bear') score += 4;
  else if (trend.trend === 'neutral') score += 1;
  
  // 波动率评分
  var atrValues = calculateATR(bars);
  var currentATR = atrValues[atrValues.length - 1];
  var price = bars[bars.length - 1].close;
  var atrPercent = (currentATR / price) * 100;
  
  if (atrPercent >= 2 && atrPercent <= 4) score += 6;
  else if (atrPercent >= 1 && atrPercent <= 5) score += 4;
  else if (atrPercent >= 0.5 && atrPercent <= 8) score += 2;
  
  // 成交量评分
  var avgVolume = getAverageVolume(bars, 20);
  var lastVolume = bars[bars.length - 1].volume;
  if (lastVolume > avgVolume * 1.5) score += 3;
  else if (lastVolume > avgVolume * 1.2) score += 2;
  else if (lastVolume > avgVolume) score += 1;
  
  // 计算最终星级评分（1-5星）
  var starScore = Math.round(score / maxScore * 5);
  return Math.min(Math.max(starScore, 1), 5);
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
  
  // 增强的做多信号条件
  if (isLongPin && c2Long && c4Long && volumeConditions.long && rsiConditions.long) {
    signalType = 'long';
  }
  
  // 增强的做空信号条件
  if (isShortPin && c2Short && c4Short && volumeConditions.short && rsiConditions.short) {
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
  
  var signalStrength = signalType ? 
    calculateSignalStrength(signalType, 
      signalType === 'long' ? longConditions : shortConditions,
      resonanceInfo.resonance,
      bars) : 0;
  
  // 将1-5星评分映射到60-100分（做多）或-100到-60分（做空）
  if (signalType) {
    if (signalType === 'long') {
      // 做多：1-5星 → 60-100分
      signalStrength = Math.round(60 + (signalStrength - 1) / 4 * 40);
    } else {
      // 做空：1-5星 → -100到-60分
      signalStrength = Math.round(-100 + (signalStrength - 1) / 4 * 40);
    }
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
    
    macdBar: macdBar, macdPrev: macdPrev,
    dif: macdData.dif[n], dea: macdData.dea[n],
    kVal: kdjData.K[n], dVal: kdjData.D[n], jVal: jVal,
    rsiVal: rsiVal, wrVal: wrVal,
    bollLast: bollLast,
    
    tradeLevels: tradeLevels,
    positionAdvice: positionAdvice,
    
    lastBar: lastBar,
    prevBar: prevBar
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
