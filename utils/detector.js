// ───────────────────────────────────────────────
// 专业交易算法模型 v5.0 - 三周期共振 + 趋势过滤
// ───────────────────────────────────────────────
const { macd, kdj, rsi, wr, boll, atr, ema } = require('./indicators')
const CONFIG = require('../config')

// 数据源列表使用配置中的DATA_SOURCES
const SOURCES = CONFIG.DATA_SOURCES || []

/** wx.request 封装成 Promise，带超时 */
function fetchJson(url, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout)
    wx.request({
      url,
      success: res => {
        clearTimeout(timer)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(new Error('HTTP ' + res.statusCode))
        }
      },
      fail: err => { clearTimeout(timer); reject(new Error(err.errMsg || 'request fail')) }
    })
  })
}

// 内存缓存（30s内复用，切换周期时清空）
const _cache = {}
function getCacheKey(interval) { return interval }
function getCached(interval) {
  const c = _cache[getCacheKey(interval)]
  if (c && Date.now() - c.ts < 30000) return c.data
  return null
}
function setCache(interval, data) {
  _cache[getCacheKey(interval)] = { ts: Date.now(), data }
}
function clearCache(interval) {
  if (interval) delete _cache[getCacheKey(interval)]
  else Object.keys(_cache).forEach(k => delete _cache[k])
}

/** 多源拉K线，返回 bar 数组 */
async function fetchKlines(interval, limit) {
  let lastErr
  for (const src of SOURCES) {
    try {
      const raw = await fetchJson(src.klineUrl(interval, limit))
      const bars = src.parse(raw)
      if (bars && bars.length > 0) {
        console.log('[数据源]', src.name, bars.length, '根K线')
        return bars
      }
    } catch (e) {
      console.warn('[' + src.name + '] 失败:', e.message)
      lastErr = e
    }
  }
  throw new Error('所有数据源失败: ' + (lastErr ? lastErr.message : ''))
}

/** 计算ATR用于动态止损 */
function calculateATR(bars, period = 14) {
  const highs = bars.map(b => b.high)
  const lows = bars.map(b => b.low)
  const closes = bars.map(b => b.close)
  return atr(highs, lows, closes, period)
}

/** 判断趋势方向 */
function determineTrend(bars) {
  const closes = bars.map(b => b.close)
  const ema20 = ema(closes, 20)
  const ema60 = ema(closes, 60)
  const n = closes.length - 1
  
  const price = closes[n]
  const ma20 = ema20[n]
  const ma60 = ema60[n]
  
  // 趋势判断
  let trend = 'neutral'
  if (price > ma20 && ma20 > ma60) trend = 'strong_bull'
  else if (price > ma20 && ma20 > ma60 * 0.98) trend = 'bull'
  else if (price < ma20 && ma20 < ma60) trend = 'strong_bear'
  else if (price < ma20 && ma20 < ma60 * 1.02) trend = 'bear'
  
  return {
    trend,
    price,
    ma20,
    ma60,
    aboveMA20: price > ma20,
    aboveMA60: price > ma60
  }
}

/** 检查多周期共振 */
function checkMultiPeriodResonance(currentBars, higherBars) {
  const currentTrend = determineTrend(currentBars)
  const higherTrend = determineTrend(higherBars)
  
  // 共振条件
  const resonance = {
    trend_aligned: false,
    rsi_extreme: false,
    macd_aligned: false,
    volume_confirmed: false
  }
  
  // 趋势对齐
  if (currentTrend.trend.includes('bull') && higherTrend.trend.includes('bull')) {
    resonance.trend_aligned = true
  } else if (currentTrend.trend.includes('bear') && higherTrend.trend.includes('bear')) {
    resonance.trend_aligned = true
  }
  
  // 计算RSI
  const currentCloses = currentBars.map(b => b.close)
  const higherCloses = higherBars.map(b => b.close)
  const currentRSI = rsi(currentCloses)
  const higherRSI = rsi(higherCloses)
  
  const nCurrent = currentCloses.length - 1
  const nHigher = higherCloses.length - 1
  
  // RSI超买超卖共振
  if (currentRSI[nCurrent] < 30 && higherRSI[nHigher] < 40) {
    resonance.rsi_extreme = 'oversold'
  } else if (currentRSI[nCurrent] > 70 && higherRSI[nHigher] > 60) {
    resonance.rsi_extreme = 'overbought'
  }
  
  // MACD共振
  const currentMACD = macd(currentCloses)
  const higherMACD = macd(higherCloses)
  
  const currentBullish = currentMACD.dif[nCurrent] > currentMACD.dea[nCurrent]
  const higherBullish = higherMACD.dif[nHigher] > higherMACD.dea[nHigher]
  
  if (currentBullish && higherBullish) {
    resonance.macd_aligned = 'bullish'
  } else if (!currentBullish && !higherBullish) {
    resonance.macd_aligned = 'bearish'
  }
  
  // 成交量确认
  const currentVolume = currentBars[currentBars.length - 1].volume
  const prevVolumes = currentBars.slice(-6, -1).map(b => b.volume)
  const avgVolume = prevVolumes.reduce((a, b) => a + b, 0) / prevVolumes.length
  
  resonance.volume_confirmed = currentVolume > avgVolume * 1.2
  
  return {
    resonance,
    currentRSI: currentRSI[nCurrent],
    higherRSI: higherRSI[nHigher],
    currentVolume,
    avgVolume,
    volumeRatio: currentVolume / avgVolume
  }
}

/** 信号强度评分系统 (1-5星) */
function calculateSignalStrength(signalType, conditions, resonance, bars) {
  let score = 0
  const maxScore = 25 // 每个条件最多5分
  
  // 1. 基础形态条件 (5分)
  const baseConditionsMet = conditions.filter(c => c.ok).length
  score += Math.min(baseConditionsMet, 4) * 1.25
  
  // 2. 多周期共振 (10分)
  if (resonance.trend_aligned) score += 3
  if (resonance.rsi_extreme) score += 2
  if (resonance.macd_aligned) score += 3
  if (resonance.volume_confirmed) score += 2
  
  // 3. 趋势强度 (5分)
  const trend = determineTrend(bars)
  if (trend.trend === 'strong_bull' || trend.trend === 'strong_bear') score += 5
  else if (trend.trend === 'bull' || trend.trend === 'bear') score += 3
  else if (trend.trend === 'neutral') score += 1
  
  // 4. 波动率评估 (5分)
  const atrValues = calculateATR(bars)
  const currentATR = atrValues[atrValues.length - 1]
  const price = bars[bars.length - 1].close
  const atrPercent = (currentATR / price) * 100
  
  // 适中的波动率最好 (2-4%)
  if (atrPercent >= 2 && atrPercent <= 4) score += 5
  else if (atrPercent >= 1 && atrPercent <= 5) score += 3
  else if (atrPercent >= 0.5 && atrPercent <= 8) score += 1
  
  // 转换为星级
  const starScore = Math.round(score / maxScore * 5)
  return Math.min(Math.max(starScore, 1), 5)
}

/** 计算入场区间和止损止盈 */
function calculateTradeLevels(signalType, bars, atrPeriod = 14) {
  const lastBar = bars[bars.length - 1]
  const atrValues = calculateATR(bars, atrPeriod)
  const currentATR = atrValues[atrValues.length - 1]
  const price = lastBar.close
  
  let entryZone = []
  let stopLoss = 0
  let takeProfits = []
  
  if (signalType === 'long') {
    // 做多入场区间：当前价格 - 0.5ATR 到 当前价格
    entryZone = [price - currentATR * 0.5, price]
    // 止损：入场价 - 1.5ATR
    stopLoss = price - currentATR * 1.5
    // 止盈：1:1, 1:2, 1:3
    takeProfits = [
      price + currentATR * 1.5,  // TP1
      price + currentATR * 3.0,   // TP2
      price + currentATR * 4.5    // TP3
    ]
  } else if (signalType === 'short') {
    // 做空入场区间：当前价格 到 当前价格 + 0.5ATR
    entryZone = [price, price + currentATR * 0.5]
    // 止损：入场价 + 1.5ATR
    stopLoss = price + currentATR * 1.5
    // 止盈：1:1, 1:2, 1:3
    takeProfits = [
      price - currentATR * 1.5,  // TP1
      price - currentATR * 3.0,   // TP2
      price - currentATR * 4.5    // TP3
    ]
  }
  
  return {
    entryZone: entryZone.map(p => Math.round(p * 10) / 10),
    stopLoss: Math.round(stopLoss * 10) / 10,
    takeProfits: takeProfits.map(p => Math.round(p * 10) / 10),
    atr: Math.round(currentATR * 10) / 10,
    atrPercent: Math.round((currentATR / price) * 100 * 100) / 100
  }
}

/** 仓位建议（根据信号强度） */
function calculatePositionAdvice(signalStrength, entryPrice, stopLoss, accountBalance = 10000) {
  // 仓位比例对应星级
  const positionRatios = {
    5: 0.50,  // 5星：50%
    4: 0.30,  // 4星：30%
    3: 0.20,  // 3星：20%
    2: 0.10,  // 2星：10%
    1: 0.05   // 1星：5%
  }
  
  const positionRatio = positionRatios[signalStrength] || 0.10
  const positionValue = accountBalance * positionRatio
  const stopDistance = Math.abs(entryPrice - stopLoss)
  
  // 计算合约数量（简化为U本位）
  const contractSize = entryPrice // 简化：1个合约=1个币
  const contracts = Math.floor(positionValue / contractSize)
  
  return {
    signalStrength,
    starRating: '⭐'.repeat(signalStrength) + '☆'.repeat(5 - signalStrength),
    positionRatio: Math.round(positionRatio * 100),
    suggestedContracts: contracts,
    positionValue: Math.round(positionValue),
    riskPerTrade: Math.round(stopDistance * contracts),
    stopDistance: Math.round(stopDistance * 10) / 10
  }
}

/** 主检测函数 - 专业版 */
async function detectSignal(interval) {
  interval = interval || '15m'
  const limit = 200 // 需要更多数据计算多周期指标
  
  // 命中缓存直接返回（30s内）
  const cached = getCached(interval)
  if (cached) return cached
  
  // 获取当前周期数据
  const bars = await fetchKlines(interval, limit)
  
  // 获取更高周期数据（用于共振分析）
  let higherBars = []
  try {
    const higherInterval = getHigherInterval(interval)
    if (higherInterval) {
      higherBars = await fetchKlines(higherInterval, Math.floor(limit / 2))
    }
  } catch (e) {
    console.warn('高周期数据获取失败:', e.message)
  }
  
  // 多周期共振分析
  const resonanceInfo = higherBars.length > 0 ? 
    checkMultiPeriodResonance(bars, higherBars) : 
    { resonance: {}, currentRSI: 50, higherRSI: null, volumeRatio: 1 }
  
  // 基础形态检测（保留原逻辑但简化）
  const lastBar = bars[bars.length - 1]
  const prevBar = bars[bars.length - 2]
  
  const body = Math.abs(prevBar.close - prevBar.open) || 0.01
  const lowerShadow = Math.min(prevBar.open, prevBar.close) - prevBar.low
  const upperShadow = prevBar.high - Math.max(prevBar.open, prevBar.close)
  
  // 形态条件
  const isLongPin = lowerShadow >= body * 2 && prevBar.close > (prevBar.low + (prevBar.high - prevBar.low) * 0.5)
  const isShortPin = upperShadow >= body * 2 && prevBar.close < (prevBar.high - (prevBar.high - prevBar.low) * 0.5)
  
  const c2Long = lastBar.low > prevBar.low && lastBar.close > lastBar.open
  const c2Short = lastBar.high < prevBar.high && lastBar.close < lastBar.open
  
  // 技术指标
  const closes = bars.map(b => b.close)
  const highs = bars.map(b => b.high)
  const lows = bars.map(b => b.low)
  
  const macdData = macd(closes)
  const kdjData = kdj(highs, lows, closes)
  const rsiArr = rsi(closes)
  const wrArr = wr(highs, lows, closes)
  const bollArr = boll(closes)
  
  const n = closes.length - 1
  
  const macdBar = macdData.bar[n]
  const macdPrev = macdData.bar[n - 1]
  const jVal = kdjData.J[n]
  const rsiVal = rsiArr[n]
  const wrVal = wrArr[n]
  const bollLast = bollArr[n]
  
  // MACD条件
  const c4Long = macdBar > macdPrev || (macdData.dif[n] > macdData.dea[n] && macdData.dif[n-1] <= macdData.dea[n-1])
  const c4Short = macdBar < macdPrev || (macdData.dif[n] < macdData.dea[n] && macdData.dif[n-1] >= macdData.dea[n-1])
  
  // 判断信号方向
  let signalType = null
  if (isLongPin && c2Long && c4Long) signalType = 'long'
  if (isShortPin && c2Short && c4Short) signalType = 'short'
  
  // 条件详情
  const longConditions = [
    { label: '下影插针', ok: isLongPin, tip: `下影${lowerShadow.toFixed(0)} vs 实体${body.toFixed(0)}` },
    { label: '低点抬高', ok: c2Long, tip: lastBar.low > prevBar.low ? `确认低${lastBar.low.toFixed(0)}>插针低${prevBar.low.toFixed(0)}` : '未确认' },
    { label: 'MACD配合', ok: c4Long, tip: macdBar > 0 ? 'MACD多头' : 'MACD止跌' },
  ]
  
  const shortConditions = [
    { label: '上影插针', ok: isShortPin, tip: `上影${upperShadow.toFixed(0)} vs 实体${body.toFixed(0)}` },
    { label: '高点压制', ok: c2Short, tip: lastBar.high < prevBar.high ? `确认高${lastBar.high.toFixed(0)}<插针高${prevBar.high.toFixed(0)}` : '未确认' },
    { label: 'MACD配合', ok: c4Short, tip: macdBar < 0 ? 'MACD空头' : 'MACD止涨' },
  ]
  
  // 计算信号强度
  const signalStrength = signalType ? 
    calculateSignalStrength(signalType, 
      signalType === 'long' ? longConditions : shortConditions,
      resonanceInfo.resonance,
      bars) : 0
  
  // 计算交易级别
  const tradeLevels = signalType ? calculateTradeLevels(signalType, bars) : null
  
  // 仓位建议
  const positionAdvice = signalType && tradeLevels ? 
    calculatePositionAdvice(
      signalStrength, 
      lastBar.close, 
      tradeLevels.stopLoss,
      CONFIG.ACCOUNT_BALANCE || 10000
    ) : null
  
  // 趋势分析
  const trendInfo = determineTrend(bars)
  
  // 构建结果对象
  const result = {
    type: signalType,
    signalStrength,
    starRating: positionAdvice?.starRating || '无信号',
    bars,
    higherBars,
    
    // 条件详情
    longConditions,
    shortConditions,
    isLongPin, isShortPin,
    lowerShadow, upperShadow, body,
    c2Long, c2Short, c4Long, c4Short,
    
    // 共振分析
    resonance: resonanceInfo.resonance,
    currentRSI: resonanceInfo.currentRSI,
    higherRSI: resonanceInfo.higherRSI,
    volumeRatio: resonanceInfo.volumeRatio,
    
    // 趋势分析
    trend: trendInfo.trend,
    price: trendInfo.price,
    ma20: trendInfo.ma20,
    ma60: trendInfo.ma60,
    
    // 技术指标值
    macdBar, macdPrev,
    dif: macdData.dif[n], dea: macdData.dea[n],
    kVal: kdjData.K[n], dVal: kdjData.D[n], jVal,
    rsiVal, wrVal,
    bollLast,
    
    // 交易级别
    tradeLevels,
    
    // 仓位建议
    positionAdvice,
    
    // 原始数据
    lastBar,
    prevBar
  }
  
  // 写入缓存
  setCache(interval, result)
  return result
}

/** 获取更高周期 */
function getHigherInterval(interval) {
  const intervalMap = {
    '15m': '1h',
    '1h': '4h',
    '4h': '1d',
    '1d': '1w'
  }
  return intervalMap[interval] || null
}

module.exports = { fetchKlines, detectSignal, clearSignalCache: clearCache }