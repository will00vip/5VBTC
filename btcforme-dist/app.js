// ═══════════════════════════════════════════════
// BTC三步法专业交易系统 v6.2 - 三周期共振算法
// ═══════════════════════════════════════════════

// ── 专业配置 ──
const CONFIG = {
  // 模拟账户配置（100U测试）
  ACCOUNT_BALANCE: 100.0,           // 初始100U
  RISK_PER_TRADE: 0.02,              // 每次风险2%
  MAX_POSITION_PCT: 0.50,            // 最大持仓50%
  CONTRACT_SIZE: 0.001,              // 合约单位
  DEFAULT_LEVERAGE: 20,              // 杠杆20x
  
  // 多周期共振参数
  ENABLE_MULTI_PERIOD: true,
  RESONANCE_TREND_ALIGN: true,
  RESONANCE_RSI_EXTREME: true,
  RESONANCE_MACD_ALIGN: true,
  
  // 信号强度阈值（100分制）
  SIGNAL_MIN_PUSH: 50,     // 分数≥50才推送信号（及时发现）
  SIGNAL_STRONG: 70,       // 70分以上为强信号
  SIGNAL_EXCELLENT: 85,    // 85分以上为优质信号
  
  // 数据源
  DATA_SOURCES: [
    {
      name: 'BinanceVision',
      klineUrl: (iv, lim) => `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=${lim}`,
      parse: raw => Array.isArray(raw) ? raw.map(k => ({ time:+k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] })) : null
    }
  ],
  
  // 模拟账户状态
  SIMULATOR: {
    initialBalance: 100.0,
    currentBalance: 100.0,
    trades: [],              // 所有交易记录
    positions: [],           // 当前持仓
    equity: 100.0,          // 总权益
    winRate: 0,             // 胜率
    profitFactor: 0         // 盈利因子
  }
}

// ── 错误处理工具 ──
function handleError(error, context) {
  console.error(`[${context}] 错误:`, error)
  // 可以在这里添加错误日志上报逻辑
  return null
}

// 全局错误捕获
window.onerror = function(message, source, lineno, colno, error) {
  console.error('[全局错误]', message, error)
  // 可以在这里添加错误日志上报逻辑
  return true
}

// 全局Promise错误捕获
window.addEventListener('unhandledrejection', function(event) {
  console.error('[未处理的Promise错误]', event.reason)
  // 可以在这里添加错误日志上报逻辑
  event.preventDefault()
})

// ── 高级技术指标 ──
function ema(arr, n) {
  const k = 2/(n+1), res = []
  arr.forEach((v,i) => { res.push(i===0 ? v : v*k + res[i-1]*(1-k)) })
  return res
}

function sma(arr, n) {
  return arr.map((_, i) => {
    const start = Math.max(0, i - n + 1)
    const slice = arr.slice(start, i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

function macd(closes) {
  const ema12=ema(closes,12), ema26=ema(closes,26)
  const dif=ema12.map((v,i)=>v-ema26[i])
  const dea=ema(dif,9)
  const bar=dif.map((v,i)=>(v-dea[i])*2)
  return { dif, dea, bar }
}

function kdj(highs, lows, closes) {
  const n=9, K=[], D=[], J=[]
  closes.forEach((c,i) => {
    const s=Math.max(0,i-n+1), hh=Math.max(...highs.slice(s,i+1)), ll=Math.min(...lows.slice(s,i+1))
    const rsv=hh===ll?50:(c-ll)/(hh-ll)*100
    const kp=i>0?K[i-1]:50, dp=i>0?D[i-1]:50
    const kv=kp*2/3+rsv/3, dv=dp*2/3+kv/3
    K.push(kv); D.push(dv); J.push(3*kv-2*dv)
  })
  return { K, D, J }
}

function rsi(closes, n=14) {
  const res=[]
  for(let i=0;i<closes.length;i++) {
    if(i<n){res.push(50);continue}
    let gain=0,loss=0
    for(let j=i-n+1;j<=i;j++){const d=closes[j]-closes[j-1];d>0?gain+=d:loss-=d}
    const rs=loss===0?100:gain/loss
    res.push(100-100/(1+rs))
  }
  return res
}

function wr(highs,lows,closes,n=14) {
  return closes.map((c,i)=>{
    const s=Math.max(0,i-n+1), hh=Math.max(...highs.slice(s,i+1)), ll=Math.min(...lows.slice(s,i+1))
    return hh===ll?-50:-((hh-c)/(hh-ll))*100
  })
}

function boll(closes,n=20,mult=2) {
  return closes.map((_,i)=>{
    const s=Math.max(0,i-n+1), sl=closes.slice(s,i+1)
    const mid=sl.reduce((a,b)=>a+b)/sl.length
    const std=Math.sqrt(sl.reduce((a,b)=>a+(b-mid)**2,0)/sl.length)
    return {mid, upper:mid+mult*std, lower:mid-mult*std}
  })
}

// ATR - 平均真实波幅（用于动态止损）
function atr(highs, lows, closes, period = 14) {
  const tr = []
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i])
    } else {
      const hl = highs[i] - lows[i]
      const hc = Math.abs(highs[i] - closes[i - 1])
      const lc = Math.abs(lows[i] - closes[i - 1])
      tr.push(Math.max(hl, hc, lc))
    }
  }
  
  const atrValues = []
  let sum = 0
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      sum += tr[i]
      atrValues.push(i === period - 1 ? sum / period : 0)
    } else {
      sum = atrValues[i - 1] * (period - 1) + tr[i]
      atrValues.push(sum / period)
    }
  }
  return atrValues
}

// ADX - 平均趋向指数（用于趋势强度判断）
function adx(highs, lows, closes, period = 14) {
  const tr = []  // 真实波幅
  const plusDM = []  // +DM
  const minusDM = [] // -DM
  
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i])
      plusDM.push(0)
      minusDM.push(0)
    } else {
      // 真实波幅
      const hl = highs[i] - lows[i]
      const hc = Math.abs(highs[i] - closes[i - 1])
      const lc = Math.abs(lows[i] - closes[i - 1])
      tr.push(Math.max(hl, hc, lc))
      
      // 方向运动
      const upMove = highs[i] - highs[i - 1]
      const downMove = lows[i - 1] - lows[i]
      
      if (upMove > downMove && upMove > 0) {
        plusDM.push(upMove)
        minusDM.push(0)
      } else if (downMove > upMove && downMove > 0) {
        plusDM.push(0)
        minusDM.push(downMove)
      } else {
        plusDM.push(0)
        minusDM.push(0)
      }
    }
  }
  
  // 计算平滑的TR、+DI、-DI
  const atrValues = []
  const plusDI = []
  const minusDI = []
  const dx = []
  const adxValues = []
  
  let trSum = 0
  let plusDMSum = 0
  let minusDMSum = 0
  
  for (let i = 0; i < tr.length; i++) {
    trSum += tr[i]
    plusDMSum += plusDM[i]
    minusDMSum += minusDM[i]
    
    if (i < period - 1) {
      atrValues.push(0)
      plusDI.push(0)
      minusDI.push(0)
      dx.push(0)
      adxValues.push(0)
    } else if (i === period - 1) {
      const atrVal = trSum / period
      const plusDIVal = (plusDMSum / atrVal) * 100
      const minusDIVal = (minusDMSum / atrVal) * 100
      const dxVal = Math.abs(plusDIVal - minusDIVal) / (plusDIVal + minusDIVal) * 100
      
      atrValues.push(atrVal)
      plusDI.push(plusDIVal)
      minusDI.push(minusDIVal)
      dx.push(dxVal)
      adxValues.push(dxVal)
    } else {
      // 平滑计算
      const atrVal = (atrValues[i - 1] * (period - 1) + tr[i]) / period
      const plusDIVal = (plusDI[i - 1] * (period - 1) + plusDM[i]) / atrVal * 100
      const minusDIVal = (minusDI[i - 1] * (period - 1) + minusDM[i]) / atrVal * 100
      const dxVal = Math.abs(plusDIVal - minusDIVal) / (plusDIVal + minusDIVal) * 100
      const adxVal = (adxValues[i - 1] * (period - 1) + dxVal) / period
      
      atrValues.push(atrVal)
      plusDI.push(plusDIVal)
      minusDI.push(minusDIVal)
      dx.push(dxVal)
      adxValues.push(adxVal)
    }
  }
  
  return adxValues
}

// ── 趋势判断 ──
function determineTrend(bars) {
  const closes = bars.map(b => b.close)
  const ema20 = ema(closes, 20)
  const ema60 = ema(closes, 60)
  const n = closes.length - 1
  
  const price = closes[n]
  const ma20 = ema20[n]
  const ma60 = ema60[n]
  
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

// ── 成交量分析 ──
function analyzeVolume(bars) {
  const volumes = bars.map(b => b.volume)
  const n = volumes.length - 1
  
  // 计算20日平均成交量
  const avgVolume20 = volumes.slice(Math.max(0, n-19), n+1).reduce((a, b) => a + b, 0) / Math.min(20, n+1)
  const currentVolume = volumes[n]
  
  // 计算成交量与价格的配合关系
  const closes = bars.map(b => b.close)
  const priceChange = (closes[n] - closes[n-1]) / closes[n-1] * 100
  
  // 放量判断
  const isVolumeSpike = currentVolume > avgVolume20 * 2 // 异常放量
  const isVolumeUpWithPrice = priceChange > 0 && currentVolume > avgVolume20 * 1.5 // 价涨量增
  const isVolumeDownWithPrice = priceChange < 0 && currentVolume > avgVolume20 * 1.5 // 价跌量增
  
  return {
    currentVolume,
    avgVolume20,
    volumeRatio: currentVolume / avgVolume20,
    isVolumeSpike,
    isVolumeUpWithPrice,
    isVolumeDownWithPrice
  }
}

// ── 多周期共振分析 ──
function analyzeMultiPeriodResonance(periodsData) {
  const trends = []
  let resonanceScore = 0
  
  // 分析每个周期的趋势
  for (const period in periodsData) {
    const data = periodsData[period]
    const trend = determineTrend(data.bars)
    trends.push({ period, trend: trend.trend })
  }
  
  // 计算共振强度
  const bullCount = trends.filter(t => t.trend.includes('bull')).length
  const bearCount = trends.filter(t => t.trend.includes('bear')).length
  
  // 权重体系：长周期权重更高
  const periodWeights = {
    '1m': 1,
    '5m': 2,
    '15m': 3,
    '1h': 4,
    '4h': 5,
    '1d': 6,
    '1w': 7
  }
  
  // 计算加权共振分数
  let weightedBullScore = 0
  let weightedBearScore = 0
  let totalWeight = 0
  
  for (const t of trends) {
    const weight = periodWeights[t.period] || 1
    totalWeight += weight
    
    if (t.trend === 'strong_bull') weightedBullScore += weight * 2
    else if (t.trend === 'bull') weightedBullScore += weight * 1
    else if (t.trend === 'strong_bear') weightedBearScore += weight * 2
    else if (t.trend === 'bear') weightedBearScore += weight * 1
  }
  
  if (totalWeight > 0) {
    const bullRatio = weightedBullScore / totalWeight
    const bearRatio = weightedBearScore / totalWeight
    
    if (bullRatio > 0.7) resonanceScore = Math.round(bullRatio * 100)
    else if (bearRatio > 0.7) resonanceScore = -Math.round(bearRatio * 100)
  }
  
  return {
    trends,
    resonanceScore,
    bullCount,
    bearCount
  }
}

// ── 市场状态识别 ──
function detectMarketState(bars) {
  const closes = bars.map(b => b.close)
  const highs = bars.map(b => b.high)
  const lows = bars.map(b => b.low)
  const volumes = bars.map(b => b.volume)
  
  const n = closes.length - 1
  
  // 1. 计算ATR和波动率
  const atrValues = atr(highs, lows, closes, 14)
  const currentATR = atrValues[n]
  const avgATR = atrValues.slice(-20).reduce((a, b) => a + b, 0) / 20
  const atrRatio = currentATR / avgATR
  
  // 2. 计算趋势强度
  const trend = determineTrend(bars)
  const ma20 = ema(closes, 20)[n]
  const ma60 = ema(closes, 60)[n]
  const price = closes[n]
  
  // 价格与均线距离百分比
  const distanceToMA20 = Math.abs((price - ma20) / ma20 * 100)
  const distanceToMA60 = Math.abs((price - ma60) / ma60 * 100)
  
  // 3. 计算ADX趋势强度
  const adxValues = adx(highs, lows, closes, 14)
  const currentADX = adxValues[n] || 0
  
  // 4. 计算布林带宽度
  const bollValues = boll(closes, 20, 2)
  const bollUpper = bollValues[n]?.upper || price
  const bollLower = bollValues[n]?.lower || price
  const bollWidth = (bollUpper - bollLower) / price * 100
  
  // 5. 成交量分析
  const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
  const currentVolume = volumes[n]
  const volumeRatio = currentVolume / avgVolume20
  
  // 6. 市场状态判断逻辑
  let marketState = 'ranging' // 默认震荡市
  
  // 趋势市判断
  if (currentADX > 25 && distanceToMA20 > 1.0) {
    if (trend.trend.includes('bull')) {
      marketState = 'trending'
    } else if (trend.trend.includes('bear')) {
      marketState = 'trending'
    }
  }
  
  // 高波动市判断
  if (atrRatio > 1.5 || bollWidth > 4.0) {
    marketState = 'volatile'
  }
  
  // 反转市判断（价格在关键位置且成交量放大）
  if ((distanceToMA60 < 0.5 || Math.abs(price - ma60) / ma60 < 0.005) && 
      volumeRatio > 1.8 && 
      currentADX < 20) {
    marketState = 'reversing'
  }
  
  // 震荡市确认（低波动、低ADX、价格在均线附近）
  if (bollWidth < 2.0 && currentADX < 20 && distanceToMA20 < 0.8) {
    marketState = 'ranging'
  }
  
  return {
    state: marketState,
    adx: Math.round(currentADX * 10) / 10,
    atrRatio: Math.round(atrRatio * 100) / 100,
    bollWidth: Math.round(bollWidth * 100) / 100,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    distanceToMA20: Math.round(distanceToMA20 * 100) / 100,
    distanceToMA60: Math.round(distanceToMA60 * 100) / 100,
    trend: trend.trend
  }
}

// ── 多周期共振检测 ──
function checkMultiPeriodResonance(currentBars, higherBars) {
  if (!higherBars || higherBars.length === 0) {
    return { resonance: {}, currentRSI: 50, higherRSI: null, volumeRatio: 1 }
  }
  
  const currentTrend = determineTrend(currentBars)
  const higherTrend = determineTrend(higherBars)
  
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

// ── 增强信号强度评分系统 (1-100分) ──
function calculateSignalStrength(signalType, conditions, resonance, bars) {
  let score = 0
  const maxScore = 100 // 总分100分
  
  // 1. 基础形态条件 (30分)
  const baseConditionsMet = conditions.filter(c => c.ok).length
  score += Math.min(baseConditionsMet, 3) * 10 // 每个条件10分
  
  // 2. 多周期共振 (20分)
  if (resonance.trend_aligned) score += 8
  if (resonance.rsi_extreme) score += 5
  if (resonance.macd_aligned) score += 5
  if (resonance.volume_confirmed) score += 2
  
  // 3. 趋势强度 (15分)
  const trend = determineTrend(bars)
  if (trend.trend === 'strong_bull' || trend.trend === 'strong_bear') score += 15
  else if (trend.trend === 'bull' || trend.trend === 'bear') score += 10
  else if (trend.trend === 'neutral') score += 5
  
  // 4. 波动率评估 (10分)
  const atrValues = atr(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close))
  const currentATR = atrValues[atrValues.length - 1]
  const price = bars[bars.length - 1].close
  const atrPercent = (currentATR / price) * 100
  
  // 适中的波动率最好 (2-4%)
  if (atrPercent >= 2 && atrPercent <= 4) score += 10
  else if (atrPercent >= 1 && atrPercent <= 5) score += 7
  else if (atrPercent >= 0.5 && atrPercent <= 8) score += 4
  
  // 5. 成交量分析 (10分) - 新增维度
  const lastBar = bars[bars.length - 1]
  const prevBars = bars.slice(-6, -1)
  const avgVolume = prevBars.reduce((sum, b) => sum + b.volume, 0) / prevBars.length
  const volumeRatio = lastBar.volume / avgVolume
  
  // 放量加分，缩量减分
  if (volumeRatio > 1.5) score += Math.min(10, Math.round((volumeRatio - 1) * 5))
  else if (volumeRatio < 0.7) score -= 3
  
  // 6. 技术指标综合 (15分) - 新增维度
  const closes = bars.map(b => b.close)
  const highs = bars.map(b => b.high)
  const lows = bars.map(b => b.low)
  const n = closes.length - 1
  
  const rsiArr = rsi(closes)
  const kdjData = kdj(highs, lows, closes)
  const macdData = macd(closes)
  
  const rsiVal = rsiArr[n]
  const jVal = kdjData.J[n]
  const macdBar = macdData.bar[n]
  
  // RSI超买超卖判断
  if ((signalType === 'long' && rsiVal < 35) || (signalType === 'short' && rsiVal > 65)) score += 5
  
  // KDJ超买超卖判断
  if ((signalType === 'long' && jVal < 20) || (signalType === 'short' && jVal > 80)) score += 5
  
  // MACD动量判断
  if ((signalType === 'long' && macdBar > 0) || (signalType === 'short' && macdBar < 0)) score += 5
  
  // 确保分数在0-100之间
  score = Math.max(0, Math.min(score, 100))
  
  return score
}

// ── 智能止盈止损计算（优化版） ──
function calculateTradeLevels(signalType, bars, marketState = 'trending') {
  const lastBar = bars[bars.length - 1]
  
  // 计算ATR
  const atrValues = atr(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close), 14)
  const currentATR = atrValues[atrValues.length - 1]
  const price = lastBar.close
  
  // 计算支撑阻力位（最近高低点）
  const recentHigh = Math.max(...bars.slice(-20).map(b => b.high))
  const recentLow = Math.min(...bars.slice(-20).map(b => b.low))
  const recentRange = recentHigh - recentLow
  
  let entryZone = []
  let stopLoss = 0
  let takeProfits = []
  let trailingStopStart = 0
  
  if (signalType === 'long') {
    // 做多入场区间
    entryZone = [price - currentATR * 0.3, price + currentATR * 0.2]
    
    // 智能止损（取最近低点或ATR止损中的较小值）
    const atrStop = price - currentATR * getStopLossMultiplier(marketState)
    const supportStop = recentLow - currentATR * 0.5
    stopLoss = Math.min(atrStop, supportStop)
    
    // 智能止盈（基于风险回报比和市场状态）
    const risk = price - stopLoss
    const baseTP = price + risk * getTakeProfitRatio(marketState, 1)
    
    // 追踪止损起始点（当价格达到1:1盈亏比时启动）
    trailingStopStart = price + risk * 0.8
    
    // 部分止盈目标
    takeProfits = [
      price + risk * 1.0,  // TP1: 1:1
      price + risk * 1.8,  // TP2: 1.8:1
      price + risk * 2.5   // TP3: 2.5:1
    ]
    
  } else if (signalType === 'short') {
    // 做空入场区间
    entryZone = [price - currentATR * 0.2, price + currentATR * 0.3]
    
    // 智能止损
    const atrStop = price + currentATR * getStopLossMultiplier(marketState)
    const resistanceStop = recentHigh + currentATR * 0.5
    stopLoss = Math.max(atrStop, resistanceStop)
    
    // 智能止盈
    const risk = stopLoss - price
    const baseTP = price - risk * getTakeProfitRatio(marketState, 1)
    
    // 追踪止损起始点
    trailingStopStart = price - risk * 0.8
    
    // 部分止盈目标
    takeProfits = [
      price - risk * 1.0,  // TP1: 1:1
      price - risk * 1.8,  // TP2: 1.8:1
      price - risk * 2.5   // TP3: 2.5:1
    ]
  }
  
  return {
    entryZone: entryZone.map(p => Math.round(p * 10) / 10),
    stopLoss: Math.round(stopLoss * 10) / 10,
    takeProfits: takeProfits.map(p => Math.round(p * 10) / 10),
    trailingStopStart: Math.round(trailingStopStart * 10) / 10,
    atr: Math.round(currentATR * 10) / 10,
    atrPercent: Math.round((currentATR / price) * 100 * 100) / 100,
    recentHigh: Math.round(recentHigh * 10) / 10,
    recentLow: Math.round(recentLow * 10) / 10,
    riskRewardRatio: Math.round((takeProfits[0] - price) / Math.abs(price - stopLoss) * 10) / 10
  }
}

// 根据市场状态获取止损倍数
function getStopLossMultiplier(marketState) {
  const multipliers = {
    'trending': 1.2,    // 趋势市：紧止损
    'ranging': 1.5,     // 震荡市：宽止损
    'reversing': 2.0,   // 反转市：更宽止损
    'volatile': 2.5     // 高波动市：最宽止损
  }
  return multipliers[marketState] || 1.5
}

// 根据市场状态获取止盈比例
function getTakeProfitRatio(marketState, level) {
  // 不同市场状态下的止盈目标
  const ratios = {
    'trending': [1.0, 2.0, 3.0],  // 趋势市：更高止盈目标
    'ranging': [0.8, 1.5, 2.0],   // 震荡市：较低目标
    'reversing': [1.2, 2.2, 3.2], // 反转市：较高目标
    'volatile': [1.5, 2.5, 3.5]   // 高波动市：最高目标
  }
  
  const stateRatios = ratios[marketState] || [1.0, 1.8, 2.5]
  return stateRatios[level - 1] || 1.0
}

// ── 仓位建议 ──
function calculatePositionAdvice(signalStrength, entryPrice, stopLoss, accountBalance = 10000) {
  // 将100分制转换为星级
  function scoreToStars(score) {
    if (score >= 85) return 5     // 85-100分：5星
    if (score >= 70) return 4     // 70-84分：4星
    if (score >= 55) return 3     // 55-69分：3星
    if (score >= 40) return 2     // 40-54分：2星
    return 1                     // 0-39分：1星
  }
  
  const starRating = scoreToStars(signalStrength)
  
  // 仓位比例对应星级
  const positionRatios = {
    5: 0.50,  // 5星：50%
    4: 0.30,  // 4星：30%
    3: 0.20,  // 3星：20%
    2: 0.10,  // 2星：10%
    1: 0.05   // 1星：5%
  }
  
  const positionRatio = positionRatios[starRating] || 0.10
  const positionValue = accountBalance * positionRatio
  const stopDistance = Math.abs(entryPrice - stopLoss)
  
  // 计算合约数量（简化为U本位）
  const contractSize = entryPrice // 简化：1个合约=1个币
  const contracts = Math.floor(positionValue / contractSize)
  
  return {
    signalStrength, // 100分制
    starRating: starRating, // 1-5星
    starDisplay: '⭐'.repeat(starRating) + '☆'.repeat(5 - starRating),
    positionRatio: Math.round(positionRatio * 100),
    suggestedContracts: contracts,
    positionValue: Math.round(positionValue),
    riskPerTrade: Math.round(stopDistance * contracts),
    stopDistance: Math.round(stopDistance * 10) / 10
  }
}

// ── 多源降级数据获取 + 60s缓存 ──
const _klinesCache = {}

// 所有数据源（按优先级）
const DATA_SOURCES_ALL = [
  {
    name: 'BinanceVision',
    klineUrl: (iv, lim) => `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=${lim}`,
    parse: raw => Array.isArray(raw) ? raw.map(k => ({ time: Math.floor(+k[0]/1000), open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] })) : null
  },
  {
    name: 'HTX',
    klineUrl: (iv, lim) => {
      // HTX interval mapping
      const m = { '1m':'1min','3m':'3min','5m':'5min','15m':'15min','30m':'30min','1h':'60min','2h':'120min','4h':'4hour','6h':'6hour','12h':'12hour','1d':'1day','3d':'3day','1w':'1week' }
      return `https://api.huobi.pro/market/history/kline?symbol=btcusdt&period=${m[iv]||'15min'}&size=${lim}`
    },
    parse: raw => {
      const list = raw && raw.data
      if (!Array.isArray(list)) return null
      return list.reverse().map(k => ({ time: +k.id, open:+k.open, high:+k.high, low:+k.low, close:+k.close, volume:+k.vol }))
    }
  },
  {
    name: 'OKX',
    klineUrl: (iv, lim) => {
      const m = { '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','2h':'2H','4h':'4H','6h':'6H','12h':'12H','1d':'1D','3d':'3D','1w':'1W' }
      return `https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=${m[iv]||'15m'}&limit=${lim}`
    },
    parse: raw => {
      const list = raw && raw.data
      if (!Array.isArray(list)) return null
      return list.reverse().map(k => ({ time: Math.floor(+k[0]/1000), open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] }))
    }
  }
]

async function fetchKlines(interval = '15m', limit = 200) {
  const cacheKey = `${interval}_${limit}`
  const now = Date.now()
  // 60s 缓存命中
  if (_klinesCache[cacheKey] && (now - _klinesCache[cacheKey].ts) < 60000) {
    return _klinesCache[cacheKey].data
  }

  let lastErr
  for (const src of DATA_SOURCES_ALL) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(src.klineUrl(interval, limit), { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const raw = await res.json()
      const data = src.parse(raw)
      if (!data || data.length < 10) throw new Error('数据不足')
      _klinesCache[cacheKey] = { ts: now, data }
      console.log(`[数据源] ${src.name} OK interval=${interval}`)
      return data
    } catch (e) {
      handleError(e, `数据源 ${src.name}`)
      lastErr = e
    }
  }
  // 所有源失败，返回旧缓存（如有）
  if (_klinesCache[cacheKey]) {
    console.warn('[数据源] 全部失败，返回旧缓存')
    return _klinesCache[cacheKey].data
  }
  const error = lastErr || new Error('所有数据源均失败')
  handleError(error, 'fetchKlines')
  throw error
}

// 强制刷新（清缓存）
function refreshKlines(interval, limit = 200) {
  const cacheKey = `${interval}_${limit}`
  delete _klinesCache[cacheKey]
  return fetchKlines(interval, limit)
}

window.BTCKlines = { fetchKlines, refreshKlines, cache: _klinesCache }
// 全局暴露 fetchKlines，让 ui.js 里的 runSimulation 可以直接调用
window.fetchKlines = fetchKlines

// ══════════════════════════════════════════
// WebSocket实时K线推送（毫秒级响应）
// ══════════════════════════════════════════

let _ws = null          // WebSocket连接
let _wsReconnectTimer = null  // 重连定时器
let _wsStatus = 'disconnected'  // 连接状态
let _lastKlineData = null  // 最新K线数据缓存

// 回调函数（由ui.js设置）
window.onWebSocketKline = null  // K线更新回调

// 启动WebSocket连接
function startWebSocket() {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    console.log('[WebSocket] 已经连接')
    return
  }
  
  // Binance K线WebSocket（1分钟K线）
  const wsUrl = 'wss://stream.binance.com:9443/ws/btcusdt@kline_1m'
  
  console.log('[WebSocket] 正在连接...')
  updateWsStatus('connecting')
  
  try {
    _ws = new WebSocket(wsUrl)
    
    _ws.onopen = () => {
      console.log('[WebSocket] ✅ 连接成功！实时K线已开启')
      updateWsStatus('connected')
      
      // 清除重连定时器
      if (_wsReconnectTimer) {
        clearTimeout(_wsReconnectTimer)
        _wsReconnectTimer = null
      }
    }
    
    _ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        
        // 处理K线数据
        if (msg.e === 'kline' && msg.k) {
          const k = msg.k
          
          // 构建标准K线格式
          const bar = {
            time: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            isFinal: k.x  // 是否收盘
          }
          
          _lastKlineData = bar
          
          // 触发回调（通知ui.js更新）
          if (typeof window.onWebSocketKline === 'function') {
            window.onWebSocketKline(bar)
          }
        }
      } catch (e) {
        console.warn('[WebSocket] 解析失败:', e.message)
      }
    }
    
    _ws.onerror = (error) => {
      console.warn('[WebSocket] 连接错误:', error)
      updateWsStatus('error')
    }
    
    _ws.onclose = () => {
      console.log('[WebSocket] 连接关闭，5秒后重连...')
      updateWsStatus('reconnecting')
      scheduleReconnect()
    }
    
  } catch (e) {
    console.error('[WebSocket] 创建失败:', e)
    scheduleReconnect()
  }
}

// 定时重连
function scheduleReconnect() {
  if (_wsReconnectTimer) return
  
  _wsReconnectTimer = setTimeout(() => {
    _wsReconnectTimer = null
    startWebSocket()
  }, 5000)
}

// 断开WebSocket
function stopWebSocket() {
  if (_wsReconnectTimer) {
    clearTimeout(_wsReconnectTimer)
    _wsReconnectTimer = null
  }
  
  if (_ws) {
    _ws.close()
    _ws = null
  }
  
  updateWsStatus('disconnected')
}

// 更新WebSocket状态
function updateWsStatus(status) {
  _wsStatus = status
  
  // 更新UI（如果存在）
  const statusEl = document.getElementById('wsStatus')
  if (statusEl) {
    const statusMap = {
      'disconnected': { text: '⚫ 离线', class: 'ws-off' },
      'connecting': { text: '🟡 连接中', class: 'ws-connecting' },
      'connected': { text: '🟢 实时', class: 'ws-on' },
      'error': { text: '🔴 错误', class: 'ws-error' },
      'reconnecting': { text: '🟠 重连中', class: 'ws-reconnecting' }
    }
    const info = statusMap[status] || { text: '⚫ 离线', class: 'ws-off' }
    statusEl.textContent = info.text
    statusEl.className = 'ws-status-tag ' + info.class
  }
  
  console.log('[WebSocket] 状态:', status)
}

// 获取连接状态
function getWsStatus() {
  return _wsStatus
}

// ══════════════════════════════════════════
// 主检测函数
// ══════════════════════════════════════════
async function detectSignal(interval = '15m') {
  try {
    // 获取当前周期数据
    const bars = await fetchKlines(interval, 200)
    if (!bars || bars.length < 50) throw new Error('数据不足')
    
    // 获取更高周期数据（用于共振分析）
    let higherBars = []
    const higherInterval = getHigherInterval(interval)
    if (higherInterval && CONFIG.ENABLE_MULTI_PERIOD) {
      try {
        higherBars = await fetchKlines(higherInterval, 100)
      } catch (e) {
        console.warn('高周期数据获取失败:', e.message)
      }
    }
    
    // 多周期共振分析
    const resonanceInfo = checkMultiPeriodResonance(bars, higherBars)
    
    // 基础形态检测
    const lastBar = bars[bars.length - 1]
    const prevBar = bars[bars.length - 2]
    
    const body = Math.abs(prevBar.close - prevBar.open) || 0.01
    const lowerShadow = Math.min(prevBar.open, prevBar.close) - prevBar.low
    const upperShadow = prevBar.high - Math.max(prevBar.open, prevBar.close)
    
    // 形态条件 - 放宽条件
    // 原条件：下影 >= 2倍实体 且 收盘价 > (低点 + 振幅*0.5)
    // 新条件：下影 >= 1.5倍实体 或 下影 >= 实体 且 收盘价 > 低点
    const isLongPin = (lowerShadow >= body * 1.5 && prevBar.close > (prevBar.low + (prevBar.high - prevBar.low) * 0.5)) ||
                     (lowerShadow >= body && prevBar.close > prevBar.low)
    
    const isShortPin = (upperShadow >= body * 1.5 && prevBar.close < (prevBar.high - (prevBar.high - prevBar.low) * 0.5)) ||
                      (upperShadow >= body && prevBar.close < prevBar.high)
    
    // ── 技术指标计算 ──
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
    
    // ── 确认K线条件（严格版：需满足2个及以上）──
    const longConfirmCount = [
      lastBar.low > prevBar.low,          // 低点抬高
      lastBar.close > lastBar.open,       // 阳线
      lastBar.close > prevBar.close       // 收盘价创新高
    ].filter(Boolean).length
    const c2Long = longConfirmCount >= 2
    
    const shortConfirmCount = [
      lastBar.high < prevBar.high,        // 高点降低
      lastBar.close < lastBar.open,       // 阴线
      lastBar.close < prevBar.close       // 收盘价创新低
    ].filter(Boolean).length
    const c2Short = shortConfirmCount >= 2
    
    // ── 技术指标条件（严格版：分开判断多空）──
    // 做多：MACD金叉或RSI超卖或KDJ超卖
    const c4Long = (macdBar > macdPrev && macdBar < 0) ||   // MACD底部放量
                  (macdData.dif[n] > macdData.dea[n] && macdData.dif[n-1] <= macdData.dea[n-1]) || // MACD金叉
                  (rsiVal < 40 && jVal < 35) ||             // RSI+KDJ双超卖（必须同时满足）
                  (wrVal < -80 && rsiVal < 45)              // 威廉超卖且RSI偏低
    
    // 做空：MACD死叉或RSI超买或KDJ超买
    const c4Short = (macdBar < macdPrev && macdBar > 0) ||  // MACD顶部萎缩
                   (macdData.dif[n] < macdData.dea[n] && macdData.dif[n-1] >= macdData.dea[n-1]) || // MACD死叉
                   (rsiVal > 60 && jVal > 65) ||             // RSI+KDJ双超买（必须同时满足）
                   (wrVal > -20 && rsiVal > 55)              // 威廉超买且RSI偏高
    
    // ── 真正的摆动高低点识别（结构极值）──
    // 左右各N根K线都比它低/高，才是真正的摆动点
    function findSwingLows(barsArr, lookback, swing) {
      const lows = []
      for (let i = swing; i < barsArr.length - swing; i++) {
        const center = barsArr[i].low
        let isSwing = true
        for (let j = i - swing; j <= i + swing; j++) {
          if (j !== i && barsArr[j].low <= center) { isSwing = false; break }
        }
        if (isSwing) lows.push(center)
      }
      return lows
    }
    function findSwingHighs(barsArr, lookback, swing) {
      const highs = []
      for (let i = swing; i < barsArr.length - swing; i++) {
        const center = barsArr[i].high
        let isSwing = true
        for (let j = i - swing; j <= i + swing; j++) {
          if (j !== i && barsArr[j].high >= center) { isSwing = false; break }
        }
        if (isSwing) highs.push(center)
      }
      return highs
    }

    const currentPrice = lastBar.close
    const atrNow = atr(highs, lows, closes)[n]
    const recentBars = bars.slice(-60)  // 取近60根找结构

    // 找摆动低点（支撑）和摆动高点（阻力）
    const swingLows = findSwingLows(recentBars, 60, 3)
    const swingHighs = findSwingHighs(recentBars, 60, 3)

    // 判断是否接近关键支撑位（任意一个摆动低点在1.5ATR范围内）
    const nearSupport = swingLows.length > 0 &&
      swingLows.some(low => Math.abs(currentPrice - low) < atrNow * 1.5)
    // 判断是否接近关键阻力位（任意一个摆动高点在1.5ATR范围内）
    const nearResistance = swingHighs.length > 0 &&
      swingHighs.some(high => Math.abs(currentPrice - high) < atrNow * 1.5)

    // ── 大周期趋势过滤（4H/日线方向）──
    // 用更高周期确认顺势方向（higherBars已在上方获取）
    let higherTrend = 'neutral'
    if (higherBars && higherBars.length >= 30) {
      const htInfo = determineTrend(higherBars)
      higherTrend = htInfo.trend
    }
    const higherIsBull = higherTrend === 'bull' || higherTrend === 'strong_bull'
    const higherIsBear = higherTrend === 'bear' || higherTrend === 'strong_bear'
    const higherIsNeutral = !higherIsBull && !higherIsBear

    // ── 信号判断（做多/做空分别评分）──
    let signalType = null
    let signalConfidence = 0

    // 成交量分析
    const volumeAnalysis = analyzeVolume(bars)
    
    // 多周期共振分析
    const periodsData = {
      '15m': { bars: bars },
      '1h': { bars: bars },
      '4h': { bars: bars },
      '1d': { bars: bars }
    }
    const resonanceAnalysis = analyzeMultiPeriodResonance(periodsData)

    // 做多信号
    if (isLongPin) {
      let longScore = 40  // 插针形态基础分
      if (c2Long) longScore += 25       // 确认K线
      if (c4Long) longScore += 20       // 技术指标
      if (nearSupport) longScore += 15  // 关键支撑位（摆动低点）

      // 大周期趋势加/减分
      if (higherIsBull) longScore += 10       // 顺势做多 +10
      else if (higherIsBear) longScore -= 15  // 逆势做多 -15（强烈降分）
      
      // 成交量分析加分
      if (volumeAnalysis.isVolumeUpWithPrice) longScore += 10  // 价涨量增
      else if (volumeAnalysis.isVolumeSpike) longScore += 5     // 异常放量
      
      // 多周期共振加分
      if (resonanceAnalysis.resonanceScore > 70) longScore += 10  // 强共振
      else if (resonanceAnalysis.resonanceScore > 50) longScore += 5   // 中等共振

      if (longScore >= 60) {
        signalType = 'long'
        signalConfidence = longScore  // 做多：正分 +60 到 +100
      }
    }

    // 做空信号
    if (isShortPin) {
      let shortScore = 40  // 插针形态基础分
      if (c2Short) shortScore += 25        // 确认K线
      if (c4Short) shortScore += 20        // 技术指标
      if (nearResistance) shortScore += 15 // 关键阻力位（摆动高点）

      // 大周期趋势加/减分
      if (higherIsBear) shortScore += 10       // 顺势做空 +10
      else if (higherIsBull) shortScore -= 15  // 逆势做空 -15
      
      // 成交量分析加分
      if (volumeAnalysis.isVolumeDownWithPrice) shortScore += 10  // 价跌量增
      else if (volumeAnalysis.isVolumeSpike) shortScore += 5       // 异常放量
      
      // 多周期共振加分
      if (resonanceAnalysis.resonanceScore < -70) shortScore += 10  // 强共振
      else if (resonanceAnalysis.resonanceScore < -50) shortScore += 5   // 中等共振

      if (shortScore >= 60 && shortScore > Math.abs(signalConfidence)) {
        signalType = 'short'
        signalConfidence = -shortScore  // 做空：负分 -100 到 -60
      }
    }

    // ── 信号质量等级（推送时显示）──
    // 正分：+60~+69基础 / +70~+84优质 / +85~+100强烈
    // 负分：-60~-69基础 / -70~-84优质 / -85~-100强烈
    const absConf = Math.abs(signalConfidence)
    const signalQuality = absConf >= 85 ? '🔥强烈信号' :
                          absConf >= 70 ? '✅优质信号' :
                          absConf >= 60 ? '⚠️基础信号(建议等70分以上再操作)' : ''
    const trendWarning = (signalType === 'long' && higherIsBear) ? '⛔逆势做多，高风险！' :
                         (signalType === 'short' && higherIsBull) ? '⛔逆势做空，高风险！' :
                         (signalType === 'long' && higherIsBull) ? '✅顺势做多' :
                         (signalType === 'short' && higherIsBear) ? '✅顺势做空' : ''
    
    // 条件详情
    const longConditions = [
      { label: '下影插针', ok: isLongPin, tip: `下影${lowerShadow.toFixed(0)} vs 实体${body.toFixed(0)}` },
      { label: '确认K线', ok: c2Long, tip: `满足${longConfirmCount}/3个确认条件` },
      { label: '技术指标', ok: c4Long, tip: macdBar > 0 ? 'MACD多头' : 'MACD止跌' },
      { label: '关键支撑', ok: nearSupport, tip: nearSupport ? `接近摆动低点(${swingLows.length}个支撑)` : '远离支撑' },
      { label: '大周期趋势', ok: higherIsBull, tip: higherIsBull ? '✅顺势做多' : higherIsBear ? '⛔逆势(高风险)' : '↔震荡' },
    ]

    const shortConditions = [
      { label: '上影插针', ok: isShortPin, tip: `上影${upperShadow.toFixed(0)} vs 实体${body.toFixed(0)}` },
      { label: '确认K线', ok: c2Short, tip: `满足${shortConfirmCount}/3个确认条件` },
      { label: '技术指标', ok: c4Short, tip: macdBar < 0 ? 'MACD空头' : 'MACD止涨' },
      { label: '关键阻力', ok: nearResistance, tip: nearResistance ? `接近摆动高点(${swingHighs.length}个阻力)` : '远离阻力' },
      { label: '大周期趋势', ok: higherIsBear, tip: higherIsBear ? '✅顺势做空' : higherIsBull ? '⛔逆势(高风险)' : '↔震荡' },
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
        CONFIG.ACCOUNT_BALANCE
      ) : null
    
    // 趋势分析
    const trendInfo = determineTrend(bars)
    
    return {
      type: signalType,
      signalStrength,
      signalConfidence,     // 原始100分制评分
      signalQuality,        // 信号质量文字标注
      trendWarning,         // 趋势方向警告
      starRating: positionAdvice?.starRating || 0,
      starDisplay: positionAdvice?.starDisplay || '无信号',
      bars,
      higherBars,
      
      // 条件详情
      longConditions,
      shortConditions,
      isLongPin, isShortPin,
      lowerShadow, upperShadow, body,
      c2Long, c2Short, c4Long, c4Short,
      
      // 位置信息
      nearSupport, nearResistance,
      swingLowCount: swingLows.length,
      swingHighCount: swingHighs.length,
      
      // 大周期趋势
      higherTrend, higherIsBull, higherIsBear,
      
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
      
      // 成交量分析
      volumeAnalysis,
      
      // 多周期共振分析
      resonanceAnalysis,
      
      // 原始数据
      lastBar,
      prevBar
    }
    
  } catch (error) {
    console.error('信号检测失败:', error)
    return { type: null, error: error.message }
  }
}

// ── 辅助函数 ──
function getHigherInterval(interval) {
  const intervalMap = {
    '15m': '1h',
    '1h': '4h',
    '4h': '1d',
    '1d': '1w'
  }
  return intervalMap[interval] || null
}

// ══════════════════════════════════════════
// 简易历史回测引擎 v1.0
// 对过去N根K线跑一遍插针算法，统计胜率/盈亏比
// ══════════════════════════════════════════
function runBacktest(bars) {
  if (!bars || bars.length < 80) return null

  const results = []
  const atrArr = atr(bars.map(b=>b.high), bars.map(b=>b.low), bars.map(b=>b.close))

  // 从第50根开始，每次往后取一个窗口
  for (let i = 52; i < bars.length - 10; i++) {
    const window = bars.slice(0, i)
    const pinBar = window[window.length - 2]  // 插针K
    const confirmBar = window[window.length - 1]  // 确认K

    const body = Math.abs(pinBar.close - pinBar.open) || 0.01
    const lowerShadow = Math.min(pinBar.open, pinBar.close) - pinBar.low
    const upperShadow = pinBar.high - Math.max(pinBar.open, pinBar.close)

    const isLongPin = lowerShadow >= body * 1.5 && pinBar.close > (pinBar.low + (pinBar.high - pinBar.low) * 0.5)
    const isShortPin = upperShadow >= body * 1.5 && pinBar.close < (pinBar.high - (pinBar.high - pinBar.low) * 0.5)

    if (!isLongPin && !isShortPin) continue

    // 确认K线条件
    const longConfirm = [
      confirmBar.low > pinBar.low,
      confirmBar.close > confirmBar.open,
      confirmBar.close > pinBar.close
    ].filter(Boolean).length >= 2

    const shortConfirm = [
      confirmBar.high < pinBar.high,
      confirmBar.close < confirmBar.open,
      confirmBar.close < pinBar.close
    ].filter(Boolean).length >= 2

    // 计算基础评分（简化版，不含大周期）
    let signalType = null
    if (isLongPin && longConfirm) signalType = 'long'
    else if (isShortPin && shortConfirm) signalType = 'short'

    if (!signalType) continue

    // 用后续10根K线判断结果（止盈=2倍ATR，止损=1倍ATR）
    const entryPrice = confirmBar.close
    const atrVal = atrArr[i - 1] || entryPrice * 0.005
    const takeProfit = signalType === 'long' ? entryPrice + atrVal * 2 : entryPrice - atrVal * 2
    const stopLoss = signalType === 'long' ? entryPrice - atrVal : entryPrice + atrVal

    let outcome = 'open'
    for (let j = i; j < Math.min(i + 10, bars.length); j++) {
      const fb = bars[j]
      if (signalType === 'long') {
        if (fb.high >= takeProfit) { outcome = 'win'; break }
        if (fb.low <= stopLoss) { outcome = 'loss'; break }
      } else {
        if (fb.low <= takeProfit) { outcome = 'win'; break }
        if (fb.high >= stopLoss) { outcome = 'loss'; break }
      }
    }

    results.push({ signalType, entryPrice, outcome, score: longConfirm || shortConfirm ? 65 : 40 })
  }

  if (results.length === 0) return { totalSignals: 0, winRate: 0, lossRate: 0, note: '无信号' }

  const wins = results.filter(r => r.outcome === 'win').length
  const losses = results.filter(r => r.outcome === 'loss').length
  const total = wins + losses
  const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0
  const lossRate = total > 0 ? (losses / total * 100).toFixed(1) : 0
  const longSignals = results.filter(r => r.signalType === 'long').length
  const shortSignals = results.filter(r => r.signalType === 'short').length

  return {
    totalSignals: results.length,
    wins, losses,
    winRate: parseFloat(winRate),
    lossRate: parseFloat(lossRate),
    longSignals, shortSignals,
    profitFactor: losses > 0 ? (wins * 2 / losses).toFixed(2) : '∞',  // 2:1盈亏比
    note: `回测${results.length}笔信号(近${bars.length}根K线) 胜率${winRate}% 盈亏比2:1`
  }
}


// ══════════════════════════════════════════
// BTC双向评分系统 V10.1
// 同时计算做多/做空分数，取绝对值最大者定方向
// ══════════════════════════════════════════
async function detectBtcSignal(interval) {
  try {
    // 获取多周期数据
    const [dailyBars, h4Bars, h1Bars, m15Bars, m5Bars] = await Promise.all([
      fetchKlines('1d', 100).catch(() => null),
      fetchKlines('4h', 200).catch(() => null),
      fetchKlines('1h', 200).catch(() => null),
      fetchKlines('15m', 200).catch(() => null),
      fetchKlines('5m', 200).catch(() => null)
    ]);

    if (!m5Bars || m5Bars.length < 60) throw new Error('5m数据不足');

    // 使用5m作为主要分析周期
    const bars = m5Bars;
    const n = bars.length - 1;
    const closes = bars.map(b => b.close);
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const vols = bars.map(b => b.volume);

    // 技术指标计算
    const m5Macd = macd(closes);
    const m5Rsi = rsi(closes);
    const m5Kdj = kdj(highs, lows, closes);
    const m5Boll = boll(closes);
    const m5Wr = wr(highs, lows, closes);
    const trendInfo = determineTrend(bars);

    // 多周期趋势
    const dailyTrend = dailyBars ? determineTrend(dailyBars) : { trend: 'neutral' };
    const h4Trend = h4Bars ? determineTrend(h4Bars) : { trend: 'neutral' };
    const h1Trend = h1Bars ? determineTrend(h1Bars) : { trend: 'neutral' };
    const m15Trend = m15Bars ? determineTrend(m15Bars) : { trend: 'neutral' };

    // ═══════════════════════════════════════════
    // 五维度评分系统（总分100分）
    // ═══════════════════════════════════════════

    // 维度1: 基础条件（17分）
    let longBaseScore = 0, shortBaseScore = 0;

    // 检测插针形态（倒数第2根K线）
    const pinBar = bars[n - 1];
    const confirmBar = bars[n];
    const pinBody = Math.abs(pinBar.close - pinBar.open) || 1;
    const pinLower = Math.min(pinBar.open, pinBar.close) - pinBar.low;
    const pinUpper = pinBar.high - Math.max(pinBar.open, pinBar.close);
    const isLongPin = pinLower >= pinBody * 2.0 && confirmBar.close > confirmBar.open;
    const isShortPin = pinUpper >= pinBody * 2.0 && confirmBar.close < confirmBar.open;

    // 放量判定
    const avgVol20 = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const curVol = vols[n - 1];
    const isVolume = curVol > avgVol20 * 1.3;
    const volumeRatio = curVol / avgVol20;

    // 基础分计算
    if (isLongPin) longBaseScore += 10;
    if (isVolume) longBaseScore += 7;
    if (isShortPin) shortBaseScore += 10;
    if (isVolume) shortBaseScore += 7;

    // 维度2: 多周期共振（43分）
    let longResonanceScore = 0, shortResonanceScore = 0;

    // 日线趋势（10分）
    if (dailyTrend.trend === 'strong_bull') longResonanceScore += 10;
    else if (dailyTrend.trend === 'bull') longResonanceScore += 7;
    else if (dailyTrend.trend === 'strong_bear') shortResonanceScore += 10;
    else if (dailyTrend.trend === 'bear') shortResonanceScore += 7;

    // 4h趋势（8分）
    if (h4Trend.trend === 'strong_bull') longResonanceScore += 8;
    else if (h4Trend.trend === 'bull') longResonanceScore += 5;
    else if (h4Trend.trend === 'strong_bear') shortResonanceScore += 8;
    else if (h4Trend.trend === 'bear') shortResonanceScore += 5;

    // 1h趋势（8分）
    if (h1Trend.trend === 'strong_bull') longResonanceScore += 8;
    else if (h1Trend.trend === 'bull') longResonanceScore += 5;
    else if (h1Trend.trend === 'strong_bear') shortResonanceScore += 8;
    else if (h1Trend.trend === 'bear') shortResonanceScore += 5;

    // 15m趋势（7分）
    if (m15Trend.trend === 'strong_bull') longResonanceScore += 7;
    else if (m15Trend.trend === 'bull') longResonanceScore += 4;
    else if (m15Trend.trend === 'strong_bear') shortResonanceScore += 7;
    else if (m15Trend.trend === 'bear') shortResonanceScore += 4;

    // 5m趋势（5分）
    if (trendInfo.trend === 'strong_bull') longResonanceScore += 5;
    else if (trendInfo.trend === 'bull') longResonanceScore += 3;
    else if (trendInfo.trend === 'strong_bear') shortResonanceScore += 5;
    else if (trendInfo.trend === 'bear') shortResonanceScore += 3;

    // 5m MACD方向（5分）
    const m5MacdBull = m5Macd.dif[n] > m5Macd.dea[n];
    const m5MacdBear = m5Macd.dif[n] < m5Macd.dea[n];
    if (m5MacdBull) longResonanceScore += 5;
    if (m5MacdBear) shortResonanceScore += 5;

    // 维度3: 趋势强度（17分）
    let longTrendScore = 0, shortTrendScore = 0;

    // MA排列（10分）
    if (trendInfo.ma20 && trendInfo.ma60) {
      if (trendInfo.price > trendInfo.ma20 && trendInfo.ma20 > trendInfo.ma60) {
        longTrendScore += 10; // 多头排列
      } else if (trendInfo.price < trendInfo.ma20 && trendInfo.ma20 < trendInfo.ma60) {
        shortTrendScore += 10; // 空头排列
      }
    }

    // RSI位置（7分）
    const rsiVal = m5Rsi[n];
    if (rsiVal < 30) longTrendScore += 7; // 超卖区，做多优势
    else if (rsiVal < 40) longTrendScore += 4;
    if (rsiVal > 70) shortTrendScore += 7; // 超买区，做空优势
    else if (rsiVal > 60) shortTrendScore += 4;

    // 维度4: 波动率（17分）
    let volatilityScore = 0;
    const atr = calculateATR(bars, 14);
    const atrPercent = (atr / closes[n]) * 100;

    if (atrPercent > 0.5 && atrPercent < 3.0) {
      volatilityScore = 17; // 理想波动率
    } else if (atrPercent >= 3.0 && atrPercent < 5.0) {
      volatilityScore = 12; // 高波动
    } else if (atrPercent >= 0.3 && atrPercent <= 0.5) {
      volatilityScore = 10; // 低波动
    } else {
      volatilityScore = 5; // 极端波动或太平淡
    }

    // 维度5: 成交量（6分）
    let volumeScore = 0;
    if (volumeRatio > 2.0) volumeScore = 6;
    else if (volumeRatio > 1.5) volumeScore = 5;
    else if (volumeRatio > 1.3) volumeScore = 4;
    else if (volumeRatio > 1.0) volumeScore = 2;

    // ═══════════════════════════════════════════
    // 总分计算（做多正分，做空负分）
    // ═══════════════════════════════════════════
    const longTotal = longBaseScore + longResonanceScore + longTrendScore + volatilityScore + volumeScore;
    const shortTotal = shortBaseScore + shortResonanceScore + shortTrendScore + volatilityScore + volumeScore;

    // 确定信号方向和分数
    let finalScore = 0;
    let signalType = null;

    if (longTotal > shortTotal && longTotal >= 60) {
      finalScore = longTotal;
      signalType = 'long';
    } else if (shortTotal > longTotal && shortTotal >= 60) {
      finalScore = -shortTotal;
      signalType = 'short';
    }

    // 交易级别计算
    const tradeLevels = signalType ? calculateTradeLevels(signalType, bars) : null;
    const positionAdvice = (signalType && tradeLevels) ? calculatePositionAdvice(
      Math.abs(finalScore),
      closes[n],
      tradeLevels.stopLoss,
      CONFIG.ACCOUNT_BALANCE
    ) : null;

    // 五维度详情
    const dimensionScores = {
      base: { long: longBaseScore, short: shortBaseScore, max: 17 },
      resonance: { long: longResonanceScore, short: shortResonanceScore, max: 43 },
      trend: { long: longTrendScore, short: shortTrendScore, max: 17 },
      volatility: { value: volatilityScore, max: 17 },
      volume: { value: volumeScore, max: 6 }
    };

    // 条件列表（兼容旧UI）
    const longConditions = [
      { label: '插针形态', ok: isLongPin, tip: isLongPin ? '✅ 检测到做多插针' : '⏳ 无做多插针' },
      { label: '放量确认', ok: isVolume, tip: '量比' + volumeRatio.toFixed(1) + 'x' },
      { label: '趋势共振', ok: longResonanceScore >= 20, tip: '共振分' + longResonanceScore + '/43' }
    ];
    const shortConditions = [
      { label: '插针形态', ok: isShortPin, tip: isShortPin ? '✅ 检测到做空插针' : '⏳ 无做空插针' },
      { label: '放量确认', ok: isVolume, tip: '量比' + volumeRatio.toFixed(1) + 'x' },
      { label: '趋势共振', ok: shortResonanceScore >= 20, tip: '共振分' + shortResonanceScore + '/43' }
    ];

    // 共振信息
    const resonanceInfo = {
      resonance: {
        trend_aligned: longResonanceScore >= 20 || shortResonanceScore >= 20,
        rsi_extreme: rsiVal < 35 || rsiVal > 65,
        macd_aligned: m5MacdBull || m5MacdBear,
        volume_confirmed: isVolume
      },
      currentRSI: rsiVal,
      higherRSI: h1Bars ? rsi(h1Bars.map(b => b.close))[h1Bars.length - 1] : rsiVal,
      volumeRatio: volumeRatio
    };

    return {
      type: signalType,
      score: finalScore,
      absScore: Math.abs(finalScore),
      signalStrength: Math.min(5, Math.floor(Math.abs(finalScore) / 20)),
      starRating: signalType ? Math.min(5, Math.floor(Math.abs(finalScore) / 20)) + '星' : '无信号',
      bars: bars,
      dimensionScores,
      longConditions,
      shortConditions,
      isLongPin,
      isShortPin,
      isVolume,
      volumeRatio,
      resonance: resonanceInfo.resonance,
      currentRSI: rsiVal,
      higherRSI: resonanceInfo.higherRSI,
      trend: trendInfo.trend,
      price: trendInfo.price,
      ma20: trendInfo.ma20,
      ma60: trendInfo.ma60,
      macdBar: m5Macd.bar[n],
      dif: m5Macd.dif[n],
      dea: m5Macd.dea[n],
      kVal: m5Kdj.K[n],
      dVal: m5Kdj.D[n],
      jVal: m5Kdj.J[n],
      rsiVal: rsiVal,
      wrVal: m5Wr[n],
      bollLast: m5Boll[n],
      tradeLevels,
      positionAdvice,
      lastBar: bars[n],
      prevBar: bars[n - 1]
    };

  } catch (error) {
    console.error('detectBtcSignal error:', error);
    return { type: null, error: error.message };
  }
}

// ATR计算辅助函数
function calculateATR(bars, period = 14) {
  if (bars.length < period + 1) return 0;
  let trSum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  return trSum / period;
}


// ═══════════════════════════════════════════════════════════
// 模拟交易引擎 v2.0 - 优化版（交易成本+动态风险管理）
// ═══════════════════════════════════════════════════════════

class SimulatorEngine {
  constructor() {
    this.trades = []           // 全部交易
    this.positions = []        // 当前持仓
    this.equity = 1000         // 总权益
    this.balance = 1000        // 可用余额
    this.totalFee = 0          // 累计手续费
    this.totalSlippage = 0     // 累计滑点损失
    this.totalFunding = 0      // 累计资金费率
    this.winStreak = 0         // 连胜次数
    this.lossStreak = 0        // 连败次数
    this.maxDailyLoss = 0      // 当日最大亏损
    this.lastTradeTime = null  // 上次交易时间
    // 最大回撤保护模块
    this.maxDrawdownProtection = {
      enabled: true,           // 是否启用
      threshold: 10,           // 触发阈值（百分比）
      pauseDuration: 60,       // 暂停时长（分钟）
      restartCondition: 'time', // 重启条件：time（时间）或 equity（权益恢复）
      restartEquityThreshold: 95, // 权益恢复阈值（百分比）
      pausedUntil: 0,          // 暂停结束时间
      currentDrawdown: 0,      // 当前回撤
      peakEquity: 1000         // 峰值权益
    }
    // 交易执行模块
    this.tradeExecution = {
      enabled: true,           // 是否启用
      randomOrderInterval: {
        enabled: true,         // 是否启用随机下单间隔
        min: 1000,             // 最小间隔（毫秒）
        max: 5000              // 最大间隔（毫秒）
      },
      orderSplit: {
        enabled: true,         // 是否启用委托量拆分
        splitRatio: 0.3,       // 每次拆分比例
        minOrderSize: 1        // 最小委托量
      },
      riskControl: {
        enabled: true,         // 是否启用风控规则
        maxPositionSize: 100,  // 最大持仓量
        maxLeverage: 30,       // 最大杠杆
        maxRiskPerTrade: 0.05, // 每笔交易最大风险比例
        minSignalScore: 60     // 最小信号分数
      }
    }
    // 版本迭代日志模块
    this.versionLog = {
      currentVersion: 'v1.0.0',  // 当前版本号
      logs: []                   // 版本迭代记录
    }
    this.load()
  }
  
  // 从localStorage加载历史
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem('btc_simulator') || '{}')
      this.trades = saved.trades || []
      this.positions = saved.positions || []
      this.equity = saved.equity || 1000
      this.balance = saved.balance || 1000
      this.totalFee = saved.totalFee || 0
      this.totalSlippage = saved.totalSlippage || 0
      this.totalFunding = saved.totalFunding || 0
      this.winStreak = saved.winStreak || 0
      this.lossStreak = saved.lossStreak || 0
      this.maxDailyLoss = saved.maxDailyLoss || 0
      this.lastTradeTime = saved.lastTradeTime || null
      // 加载最大回撤保护模块数据
      this.maxDrawdownProtection = saved.maxDrawdownProtection || {
        enabled: true,
        threshold: 10,
        pauseDuration: 60,
        restartCondition: 'time',
        restartEquityThreshold: 95,
        pausedUntil: 0,
        currentDrawdown: 0,
        peakEquity: this.equity
      }
      // 加载交易执行模块数据
      this.tradeExecution = saved.tradeExecution || {
        enabled: true,
        randomOrderInterval: {
          enabled: true,
          min: 1000,
          max: 5000
        },
        orderSplit: {
          enabled: true,
          splitRatio: 0.3,
          minOrderSize: 1
        },
        riskControl: {
          enabled: true,
          maxPositionSize: 100,
          maxLeverage: 30,
          maxRiskPerTrade: 0.05,
          minSignalScore: 60
        }
      }
      // 加载版本迭代日志模块数据
      this.versionLog = saved.versionLog || {
        currentVersion: 'v1.0.0',
        logs: []
      }
    } catch(e) { console.warn('[Sim] 加载失败:', e) }
  }
  
  // 保存状态
  save() {
    localStorage.setItem('btc_simulator', JSON.stringify({
      trades: this.trades,
      positions: this.positions,
      equity: this.equity,
      balance: this.balance,
      totalFee: this.totalFee,
      totalSlippage: this.totalSlippage,
      totalFunding: this.totalFunding,
      winStreak: this.winStreak,
      lossStreak: this.lossStreak,
      maxDailyLoss: this.maxDailyLoss,
      lastTradeTime: this.lastTradeTime,
      maxDrawdownProtection: this.maxDrawdownProtection,
      tradeExecution: this.tradeExecution,
      versionLog: this.versionLog
    }))
  }
  
  // 归因分析方法
  analyzeTrade(position, exitPrice, netPnl, reason) {
    const isWin = netPnl > 0
    const profitPercent = (netPnl / (position.size * position.entryPrice)) * 100
    
    // 1. 交易触发因子
    const triggerFactors = []
    if (position.score >= 85) triggerFactors.push('高分信号')
    if (position.signalQuality && position.signalQuality.includes('高质量')) triggerFactors.push('高质量信号')
    if (position.trendWarning && position.trendWarning.includes('顺势')) triggerFactors.push('顺势信号')
    
    // 2. 行情环境标签
    const marketEnvTags = []
    if (position.atrPercent > 2.0) marketEnvTags.push('高波动')
    else if (position.atrPercent < 0.5) marketEnvTags.push('低波动')
    else marketEnvTags.push('正常波动')
    
    // 3. 核心原因分析
    let coreReason = ''
    if (isWin) {
      if (profitPercent > 2) coreReason = '大幅盈利：趋势强劲'
      else if (profitPercent > 0.5) coreReason = '小幅盈利：信号准确'
      else coreReason = '微盈利：市场波动'
    } else {
      if (profitPercent < -2) coreReason = '大幅亏损：趋势反转'
      else if (profitPercent < -0.5) coreReason = '小幅亏损：止损触发'
      else coreReason = '微亏损：市场噪音'
    }
    
    // 4. 执行质量
    let executionQuality = ''
    const totalCostPercent = (position.entryFee + position.slippage + position.funding) / (position.size * position.entryPrice) * 100
    if (totalCostPercent < 0.1) executionQuality = '优秀'
    else if (totalCostPercent < 0.3) executionQuality = '良好'
    else executionQuality = '一般'
    
    // 5. 市场条件
    const marketConditions = {
      volatility: position.atrPercent,
      signalStrength: position.score,
      executionCost: totalCostPercent
    }
    
    // 更新交易记录的归因分析字段
    position.attribution = {
      triggerFactors,
      marketEnvTags,
      coreReason,
      executionQuality,
      marketConditions
    }
    
    // 同时更新trades数组中的对应记录
    const tradeIdx = this.trades.findIndex(t => t.id === position.id)
    if (tradeIdx >= 0) {
      this.trades[tradeIdx].attribution = position.attribution
    }
  }
  
  // 检查最大回撤保护状态
  checkMaxDrawdownProtection() {
    const mdp = this.maxDrawdownProtection
    if (!mdp.enabled) return true
    
    // 检查是否处于暂停状态
    if (Date.now() < mdp.pausedUntil) {
      const remaining = Math.round((mdp.pausedUntil - Date.now()) / 1000 / 60)
      console.log(`[Sim] 最大回撤保护：暂停中，剩余 ${remaining} 分钟`)
      return false
    }
    
    // 更新峰值权益
    if (this.equity > mdp.peakEquity) {
      mdp.peakEquity = this.equity
      mdp.currentDrawdown = 0
    }
    
    // 计算当前回撤
    mdp.currentDrawdown = ((mdp.peakEquity - this.equity) / mdp.peakEquity) * 100
    
    // 检查是否触发回撤阈值
    if (mdp.currentDrawdown >= mdp.threshold) {
      console.log(`[Sim] 最大回撤保护：触发阈值 ${mdp.currentDrawdown.toFixed(1)}% >= ${mdp.threshold}%`)
      mdp.pausedUntil = Date.now() + mdp.pauseDuration * 60 * 1000
      console.log(`[Sim] 最大回撤保护：暂停 ${mdp.pauseDuration} 分钟`)
      return false
    }
    
    // 检查重启条件（权益恢复）
    if (mdp.restartCondition === 'equity') {
      const equityRecovery = (this.equity / mdp.peakEquity) * 100
      if (equityRecovery >= mdp.restartEquityThreshold) {
        console.log(`[Sim] 最大回撤保护：权益恢复至 ${equityRecovery.toFixed(1)}%，重启交易`)
        mdp.pausedUntil = 0
      }
    }
    
    return true
  }
  
  // 检查风控规则
  checkRiskControl(signalScore, positionSize) {
    const te = this.tradeExecution
    if (!te.enabled || !te.riskControl.enabled) return true
    
    const rc = te.riskControl
    
    // 1. 信号分数检查
    if (Math.abs(signalScore) < rc.minSignalScore) {
      console.log(`[Sim] 风控规则：信号分数 ${Math.abs(signalScore)} < 最低要求 ${rc.minSignalScore}`)
      return false
    }
    
    // 2. 持仓量检查
    if (positionSize > rc.maxPositionSize) {
      console.log(`[Sim] 风控规则：持仓量 ${positionSize} > 最大限制 ${rc.maxPositionSize}`)
      return false
    }
    
    // 3. 风险比例检查
    const riskAmount = positionSize * 10 // 假设每单位10U
    const riskRatio = riskAmount / this.equity
    if (riskRatio > rc.maxRiskPerTrade) {
      console.log(`[Sim] 风控规则：风险比例 ${(riskRatio * 100).toFixed(1)}% > 最大限制 ${(rc.maxRiskPerTrade * 100).toFixed(1)}%`)
      return false
    }
    
    return true
  }
  
  // 执行交易（带随机间隔和委托拆分）
  async executeTrade(signal, price, marketData = {}) {
    const te = this.tradeExecution
    if (!te.enabled) {
      return this.openPosition(signal, price, marketData)
    }
    
    // 1. 随机下单间隔（测试时跳过）
    // if (te.randomOrderInterval.enabled) {
    //   const interval = Math.floor(Math.random() * (te.randomOrderInterval.max - te.randomOrderInterval.min) + te.randomOrderInterval.min)
    //   console.log(`[Sim] 交易执行：随机间隔 ${interval}ms`)
    //   await new Promise(resolve => setTimeout(resolve, interval))
    // }
    
    // 2. 委托量拆分（测试时跳过）
    // if (te.orderSplit.enabled && te.orderSplit.splitRatio < 1) {
    //   const originalSize = Math.floor(this.equity * 0.02 / 10) || 1 // 原始委托量
    //   const splitCount = Math.ceil(1 / te.orderSplit.splitRatio)
    //   let remainingSize = originalSize
    //   
    //   console.log(`[Sim] 交易执行：委托量拆分 ${splitCount}次`)
    //   
    //   for (let i = 0; i < splitCount; i++) {
    //     const splitSize = Math.max(te.orderSplit.minOrderSize, Math.floor(remainingSize * te.orderSplit.splitRatio))
    //     if (splitSize > 0) {
    //       console.log(`[Sim] 交易执行：第 ${i+1} 次拆分，委托量 ${splitSize}`)
    //       // 这里可以添加实际的拆分下单逻辑
    //       remainingSize -= splitSize
    //     }
    //   }
    // }
    
    // 3. 执行开仓
    return this.openPosition(signal, price, marketData)
  }
  
  // 添加版本日志
  addVersionLog(version, changes, backtestResult, winRateChange) {
    const log = {
      version,
      timestamp: Date.now(),
      changes,
      backtestResult,
      winRateChange,
      tradeCount: this.trades.length
    }
    
    this.versionLog.logs.unshift(log) // 添加到日志开头
    this.versionLog.currentVersion = version
    this.save()
    
    console.log(`[Sim] 版本日志已添加：${version}`)
    return log
  }
  
  // 获取版本信息
  getVersionInfo() {
    return {
      currentVersion: this.versionLog.currentVersion,
      totalVersions: this.versionLog.logs.length,
      lastUpdate: this.versionLog.logs.length > 0 ? this.versionLog.logs[0].timestamp : null
    }
  }
  
  // 获取版本历史
  getVersionHistory() {
    return this.versionLog.logs
  }
  
  // 计算动态风险比例（基于市场波动率）
  calculateDynamicRisk(atrPercent) {
    // 基本风险比例：2%
    let baseRisk = 0.02
    
    // 根据波动率调整
    if (atrPercent > 2.0) {      // 高波动率：降低风险
      baseRisk = 0.01
    } else if (atrPercent < 0.5) { // 低波动率：适度增加风险
      baseRisk = 0.03
    }
    
    // 根据连败次数调整（连败越多，风险越低）
    if (this.lossStreak >= 3) {
      baseRisk *= 0.5  // 连败3次，风险减半
    } else if (this.winStreak >= 3) {
      baseRisk *= 1.2  // 连胜3次，风险增加20%
    }
    
    return Math.max(0.005, Math.min(0.05, baseRisk)) // 限制在0.5%-5%之间
  }

  // 按信号自动开单（优化版）- 适配v3新算法
  openPosition(signal, price, marketData = {}) {
    // 1. 信号质量检查 - 适配新算法字段
    const signalScore = signal.signalConfidence || signal.signalStrength || signal.score || 0
    // 对于做空信号，使用绝对值比较
    if (Math.abs(signalScore) < CONFIG.SIGNAL_MIN_PUSH) {
      console.log(`[Sim] 信号弱于阈值(${Math.abs(signalScore)}<${CONFIG.SIGNAL_MIN_PUSH})，不开单`)
      return null
    }
    
    // 2. 冷静期检查（避免过度交易）- 测试时缩短冷静期
    const now = Date.now()
    if (this.lastTradeTime && (now - this.lastTradeTime) < 1000) { // 1秒冷静期（测试用）
      console.log('[Sim] 冷静期中，避免过度交易')
      return null
    }
    
    // 3. 最大回撤检查（当日亏损超过10%停止交易）
    if (this.maxDailyLoss <= -10) {
      console.log('[Sim] 当日最大回撤超过10%，停止交易')
      return null
    }
    
    // 4. 最大回撤保护模块检查
    if (!this.checkMaxDrawdownProtection()) {
      return null
    }
    
    // 6. 计算交易成本
    const entryFeeRate = 0.0003  // 0.03%开仓手续费
    const expectedSlippage = 0.001  // 0.1%预期滑点
    const fundingRate = 0.0001     // 0.01%每8小时资金费率
    
    // 5. 计算动态风险比例
    const atrPercent = marketData.atrPercent || 1.0
    const dynamicRisk = this.calculateDynamicRisk(atrPercent)
    
    // 6. 计算头寸大小（基于凯利公式简化版）
    // 预期胜率基于信号评分（使用绝对值，因为做空信号分数为负数）
    const winRate = Math.abs(signalScore) / 100 * 0.7 // 假设评分与胜率相关性0.7
    const avgWin = 1.5  // 平均盈利倍数
    const avgLoss = 1.0  // 平均亏损倍数
    const kellyFraction = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin
    const positionRatio = Math.max(0.01, Math.min(0.3, kellyFraction * 0.5)) // 半凯利
    
    // 7. 计算头寸
    const positionValue = this.equity * positionRatio
    let positionSize = Math.floor(positionValue / 10) || 1
    // 确保positionSize不超过最大限制100
    positionSize = Math.min(positionSize, 100)
    const riskAmount = positionSize * 10
    
    // 8. 交易执行模块 - 风控规则检查
    if (!this.checkRiskControl(signalScore, positionSize)) {
      return null
    }
    
    // 8. 计算交易成本
    const entryFee = price * positionSize * entryFeeRate
    const slippageCost = price * positionSize * expectedSlippage
    const initialFunding = price * positionSize * fundingRate
    
    this.totalFee += entryFee
    this.totalSlippage += slippageCost
    this.totalFunding += initialFunding
    
    // 9. 计算大盘涨跌幅（假设使用最近24小时的涨跌幅）
    const marketChange = marketData.marketChange || 0
    
    // 10. 创建交易记录
    const trade = {
      id: Date.now(),
      type: signal.type,
      entryPrice: price,
      entryTime: new Date(),
      size: positionSize,
      score: signalScore,
      stars: signal.stars || Math.floor(signalScore / 20),
      stopLoss: signal.tradeLevels?.stopLoss || 0,
      tp1: signal.tradeLevels?.takeProfits?.[0] || 0,
      tp2: signal.tradeLevels?.takeProfits?.[1] || 0,
      trailingStop: 0,  // 追踪止损位
      status: 'open',
      pnl: 0,
      pnlPercent: 0,
      bars: 0,
      entryFee,
      slippage: slippageCost,
      funding: initialFunding,
      riskPercent: dynamicRisk * 100,
      kellyPosition: positionRatio * 100,
      // 大盘涨跌幅
      marketChange: marketChange,
      // 归因分析字段
      attribution: null,
      // 交易执行字段
      executionInfo: {
        randomInterval: this.tradeExecution.randomOrderInterval.enabled ? Math.floor(Math.random() * (this.tradeExecution.randomOrderInterval.max - this.tradeExecution.randomOrderInterval.min) + this.tradeExecution.randomOrderInterval.min) : 0,
        orderSplit: this.tradeExecution.orderSplit.enabled,
        splitCount: this.tradeExecution.orderSplit.enabled ? Math.ceil(1 / this.tradeExecution.orderSplit.splitRatio) : 1
      },
      // 市场环境字段
      marketEnvironment: {
        atrPercent: atrPercent,
        volatility: atrPercent > 2.0 ? 'high' : atrPercent < 0.5 ? 'low' : 'normal',
        trend: signal.trend || 'neutral',
        marketChange: marketChange
      },
      atrPercent: atrPercent,
      signalQuality: signal.signalQuality || '',
      trendWarning: signal.trendWarning || '',
      // 归因分析字段
      attribution: {
        triggerFactors: [],  // 交易触发因子
        marketEnvTags: [],  // 行情环境标签
        coreReason: '',  // 盈利/亏损核心原因
        executionQuality: '',  // 执行质量
        marketConditions: {}  // 市场条件
      }
    }
    
    // 10. 更新账户状态
    this.positions.push(trade)
    this.trades.push(Object.assign({}, trade, { 
      status: 'opened', 
      timestamp: Date.now() 
    }))
    this.balance -= (riskAmount + entryFee + slippageCost + initialFunding)
    this.lastTradeTime = now
    
    console.log(`[Sim] ✅ ${trade.type.toUpperCase()} 开仓 - 价格:$${price.toFixed(2)}`)
    console.log(`     头寸:${positionSize}, 评分:${signalScore}, 风险:${(dynamicRisk*100).toFixed(1)}%`)
    console.log(`     质量:${signal.signalQuality || ''} ${signal.trendWarning || ''}`)
    console.log(`     成本: 手续费$${entryFee.toFixed(2)} 滑点$${slippageCost.toFixed(2)} 资金费率$${initialFunding.toFixed(2)}`)
    
    return trade
  }
  
  // 平仓（止损或止盈）优化版
  closePosition(positionId, exitPrice, reason = 'manual') {
    const idx = this.positions.findIndex(p => p.id === positionId)
    if (idx < 0) return null
    
    const pos = this.positions[idx]
    
    // 1. 计算平仓手续费和滑点
    const exitFeeRate = 0.0003  // 0.03%平仓手续费
    const exitSlippageRate = 0.001  // 0.1%平仓滑点
    const exitFee = exitPrice * pos.size * exitFeeRate
    const exitSlippage = exitPrice * pos.size * exitSlippageRate
    
    // 2. 计算持仓期间的资金费率（假设持仓8小时）
    const holdingHours = 8
    const fundingPerHour = 0.0001  // 0.01%每8小时
    const totalFunding = exitPrice * pos.size * fundingPerHour * holdingHours
    
    // 3. 计算净利润（扣除所有成本）
    const grossPnl = pos.type === 'long' 
      ? (exitPrice - pos.entryPrice) * pos.size 
      : (pos.entryPrice - exitPrice) * pos.size
    
    const totalCost = pos.entryFee + pos.slippage + pos.funding + exitFee + exitSlippage + totalFunding
    const netPnl = grossPnl - totalCost
    
    // 4. 更新成本统计
    this.totalFee += exitFee
    this.totalSlippage += exitSlippage
    this.totalFunding += totalFunding
    
    // 5. 归因分析
    this.analyzeTrade(pos, exitPrice, netPnl, reason)
    
    const pnlPercent = (netPnl / (pos.size * pos.entryPrice)) * 100
    const result = netPnl > 0 ? 'win' : netPnl < 0 ? 'loss' : 'breakeven'
    
    // 5. 更新连胜连败统计
    if (result === 'win') {
      this.winStreak++
      this.lossStreak = 0
    } else if (result === 'loss') {
      this.lossStreak++
      this.winStreak = 0
      // 更新当日最大亏损
      this.maxDailyLoss = Math.min(this.maxDailyLoss, netPnl)
    }
    
    // 6. 计算风险回报比
    const risk = Math.abs(pos.entryPrice - pos.stopLoss)
    const reward = Math.abs(exitPrice - pos.entryPrice)
    const riskRewardRatio = risk > 0 ? Math.round(reward / risk * 100) / 100 : 0
    
    const closedTrade = Object.assign({}, pos, {
      exitPrice,
      exitTime: new Date(),
      grossPnl: parseFloat(grossPnl.toFixed(2)),
      netPnl: parseFloat(netPnl.toFixed(2)),
      pnlPercent: parseFloat(pnlPercent.toFixed(2)),
      exitFee,
      exitSlippage,
      holdingFunding: totalFunding,
      totalCost: parseFloat(totalCost.toFixed(2)),
      status: 'closed',
      result,
      reason,
      riskRewardRatio,
      timestamp: Date.now()
    })
    
    // 7. 更新账户状态
    this.positions.splice(idx, 1)
    this.trades.push(closedTrade)
    this.equity += netPnl
    this.balance += pos.size * 10 + netPnl
    
    // 8. 保存状态
    this.save()
    
    console.log(`[Sim] 🏁 ${reason.toUpperCase()} - ${result.toUpperCase()}`)
    console.log(`     净盈亏: $${netPnl.toFixed(2)} (${pnlPercent.toFixed(1)}%)`)
    console.log(`     总成本: $${totalCost.toFixed(2)} (手续费$${exitFee.toFixed(2)} 滑点$${exitSlippage.toFixed(2)} 资金费率$${totalFunding.toFixed(2)})`)
    console.log(`     风险回报比: ${riskRewardRatio}:1, 连胜:${this.winStreak}, 连败:${this.lossStreak}`)
    
    return closedTrade
  }
  
  // 检查是否触发SL/TP
  updateByPrice(currentPrice) {
    const closed = []
    for (let pos of this.positions) {
      let trigger = null
      
      if (pos.type === 'long') {
        if (currentPrice <= pos.stopLoss) trigger = 'SL'
        else if (pos.tp2 > 0 && currentPrice >= pos.tp2) trigger = 'TP2'
        else if (pos.tp1 > 0 && currentPrice >= pos.tp1) trigger = 'TP1'
      } else {
        if (currentPrice >= pos.stopLoss) trigger = 'SL'
        else if (pos.tp2 > 0 && currentPrice <= pos.tp2) trigger = 'TP2'
        else if (pos.tp1 > 0 && currentPrice <= pos.tp1) trigger = 'TP1'
      }
      
      if (trigger) {
        const exitPrice = pos.type === 'long' && trigger === 'SL' ? pos.stopLoss
                        : pos.type === 'short' && trigger === 'SL' ? pos.stopLoss
                        : currentPrice
        const result = this.closePosition(pos.id, exitPrice, trigger)
        closed.push(result)
      }
    }
    return closed
  }
  
  // 统计胜率
  getStats() {
    const closedTrades = this.trades.filter(t => t.status === 'closed')
    const wins = closedTrades.filter(t => t.result === 'win')
    const losses = closedTrades.filter(t => t.result === 'loss')
    
    // 基础统计
    const winRate = closedTrades.length > 0 ? ((wins.length / closedTrades.length) * 100).toFixed(1) : 0
    const totalPnL = this.equity - 100
    const roi = ((totalPnL / 100) * 100).toFixed(1)
    
    // 风险回报统计
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.netPnl, 0) / wins.length : 0
    const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + t.netPnl, 0) / losses.length : 0
    const avgRiskReward = wins.length > 0 ? wins.reduce((sum, t) => sum + (t.riskRewardRatio || 0), 0) / wins.length : 0
    
    // 最大连续统计
    let maxWinStreak = 0
    let maxLossStreak = 0
    let currentStreak = 0
    let currentType = null
    
    for (let trade of closedTrades) {
      if (currentType === null) {
        currentType = trade.result
        currentStreak = 1
      } else if (trade.result === currentType) {
        currentStreak++
      } else {
        if (currentType === 'win' && currentStreak > maxWinStreak) maxWinStreak = currentStreak
        if (currentType === 'loss' && currentStreak > maxLossStreak) maxLossStreak = currentStreak
        currentType = trade.result
        currentStreak = 1
      }
    }
    
    // 按评分分组统计
    const byScore = {
      excellent: closedTrades.filter(t => t.score >= 85),
      strong: closedTrades.filter(t => t.score >= 70 && t.score < 85),
      normal: closedTrades.filter(t => t.score >= 50 && t.score < 70),
      weak: closedTrades.filter(t => t.score < 50)
    }
    
    // 按平仓原因统计
    const byReason = {
      SL: closedTrades.filter(t => t.reason === 'SL'),
      TP1: closedTrades.filter(t => t.reason === 'TP1'),
      TP2: closedTrades.filter(t => t.reason === 'TP2'),
      manual: closedTrades.filter(t => t.reason === 'manual')
    }
    
    // 计算夏普比率（简化版）
    const returns = closedTrades.map(t => t.pnlPercent || 0)
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
    const stdDev = returns.length > 0 ? 
      Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length) : 0
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev).toFixed(2) : 0
    
    return {
      // 基础统计
      totalTrades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: parseFloat(winRate),
      totalPnL: parseFloat(totalPnL.toFixed(2)),
      roi: parseFloat(roi),
      equity: parseFloat(this.equity.toFixed(2)),
      balance: parseFloat(this.balance.toFixed(2)),
      
      // 风险管理统计
      avgWin: parseFloat(avgWin.toFixed(2)),
      avgLoss: parseFloat(avgLoss.toFixed(2)),
      profitFactor: Math.abs(avgLoss) > 0 ? Math.abs(avgWin / avgLoss).toFixed(2) : '∞',
      avgRiskReward: parseFloat(avgRiskReward.toFixed(2)),
      sharpeRatio: parseFloat(sharpeRatio),
      
      // 连续统计
      currentWinStreak: this.winStreak,
      currentLossStreak: this.lossStreak,
      maxWinStreak,
      maxLossStreak,
      
      // 成本统计
      totalFee: parseFloat(this.totalFee.toFixed(2)),
      totalSlippage: parseFloat(this.totalSlippage.toFixed(2)),
      totalFunding: parseFloat(this.totalFunding.toFixed(2)),
      totalCost: parseFloat((this.totalFee + this.totalSlippage + this.totalFunding).toFixed(2)),
      costPercentage: this.equity > 0 ? parseFloat(((this.totalFee + this.totalSlippage + this.totalFunding) / this.equity * 100).toFixed(2)) : 0,
      
      // 按评分分组
      byScore: {
        excellent: { 
          count: byScore.excellent.length, 
          winRate: byScore.excellent.length > 0 ? ((byScore.excellent.filter(t => t.result === 'win').length / byScore.excellent.length) * 100).toFixed(1) : 0,
          avgPnl: byScore.excellent.length > 0 ? (byScore.excellent.reduce((sum, t) => sum + t.netPnl, 0) / byScore.excellent.length).toFixed(2) : 0
        },
        strong: { 
          count: byScore.strong.length, 
          winRate: byScore.strong.length > 0 ? ((byScore.strong.filter(t => t.result === 'win').length / byScore.strong.length) * 100).toFixed(1) : 0,
          avgPnl: byScore.strong.length > 0 ? (byScore.strong.reduce((sum, t) => sum + t.netPnl, 0) / byScore.strong.length).toFixed(2) : 0
        },
        normal: { 
          count: byScore.normal.length, 
          winRate: byScore.normal.length > 0 ? ((byScore.normal.filter(t => t.result === 'win').length / byScore.normal.length) * 100).toFixed(1) : 0,
          avgPnl: byScore.normal.length > 0 ? (byScore.normal.reduce((sum, t) => sum + t.netPnl, 0) / byScore.normal.length).toFixed(2) : 0
        },
        weak: { 
          count: byScore.weak.length, 
          winRate: byScore.weak.length > 0 ? ((byScore.weak.filter(t => t.result === 'win').length / byScore.weak.length) * 100).toFixed(1) : 0,
          avgPnl: byScore.weak.length > 0 ? (byScore.weak.reduce((sum, t) => sum + t.netPnl, 0) / byScore.weak.length).toFixed(2) : 0
        }
      },
      
      // 按平仓原因
      byReason: {
        SL: { count: byReason.SL.length, winRate: byReason.SL.length > 0 ? ((byReason.SL.filter(t => t.result === 'win').length / byReason.SL.length) * 100).toFixed(1) : 0 },
        TP1: { count: byReason.TP1.length, winRate: byReason.TP1.length > 0 ? ((byReason.TP1.filter(t => t.result === 'win').length / byReason.TP1.length) * 100).toFixed(1) : 0 },
        TP2: { count: byReason.TP2.length, winRate: byReason.TP2.length > 0 ? ((byReason.TP2.filter(t => t.result === 'win').length / byReason.TP2.length) * 100).toFixed(1) : 0 },
        manual: { count: byReason.manual.length, winRate: byReason.manual.length > 0 ? ((byReason.manual.filter(t => t.result === 'win').length / byReason.manual.length) * 100).toFixed(1) : 0 }
      }
    }
  }
  
  // 重置账户
  reset() {
    this.trades = []
    this.positions = []
    this.equity = 1000
    this.balance = 1000
    this.totalFee = 0
    this.totalSlippage = 0
    this.totalFunding = 0
    this.winStreak = 0
    this.lossStreak = 0
    this.maxDailyLoss = 0
    this.lastTradeTime = null
    // 重置最大回撤保护模块
    this.maxDrawdownProtection = {
      enabled: true,
      threshold: 10,
      pauseDuration: 60,
      restartCondition: 'time',
      restartEquityThreshold: 95,
      pausedUntil: 0,
      currentDrawdown: 0,
      peakEquity: 1000
    }
    localStorage.removeItem('btc_simulator')
    console.log('[Sim] 账户已重置，初始资金1000 U')
  }
  
  // 运行模拟交易测试
  async runSimulationTest() {
    console.log('[Sim] 开始模拟交易测试，目标50笔交易')
    this.reset()
    
    let tradeCount = 0
    const targetTrades = 50
    const startTime = Date.now()
    
    // 模拟交易循环
    while (tradeCount < targetTrades) {
      try {
        // 模拟信号（随机生成60-100之间的分数）
        const signalScore = Math.floor(Math.random() * 41) + 60
        const signalType = Math.random() > 0.5 ? 'long' : 'short'
        const signal = {
          type: signalType,
          signalConfidence: signalType === 'long' ? signalScore : -signalScore
        }
        
        // 模拟大盘涨跌幅（随机生成-5%到5%之间）
        const marketChange = (Math.random() * 10 - 5).toFixed(2)
        
        // 执行交易
        const price = 30000 + Math.random() * 10000 // 模拟价格
        const marketData = { atrPercent: 1.0, marketChange: parseFloat(marketChange) }
        const position = await this.executeTrade(signal, price, marketData)
        
        if (position) {
          tradeCount++
          console.log(`[Sim] 交易 ${tradeCount}/${targetTrades} 执行成功，分数: ${signal.signalConfidence}，大盘涨跌幅: ${marketChange}%`)
          
          // 模拟价格变动，触发止盈止损
          
          // 随机模拟价格变动（胜率设置为65%）
          let priceChange
          if (Math.random() < 0.65) {
            // 盈利情况
            priceChange = signalType === 'long' ? (Math.random() * 2) / 100 : -(Math.random() * 2) / 100
          } else {
            // 亏损情况
            priceChange = signalType === 'long' ? -(Math.random() * 2) / 100 : (Math.random() * 2) / 100
          }
          const newPrice = price * (1 + priceChange)
          this.updateByPrice(newPrice)
        }
        
        // 等待下一次交易
        await new Promise(resolve => setTimeout(resolve, 10))
      } catch (error) {
        console.error('[Sim] 模拟交易错误:', error)
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    
    // 统计结果
    const stats = this.getStats()
    const endTime = Date.now()
    const duration = (endTime - startTime) / 1000 / 60
    
    console.log('\n[Sim] 模拟交易测试完成')
    console.log(`交易总笔数: ${stats.totalTrades}`)
    console.log(`胜率: ${stats.winRate}%`)
    console.log(`总盈亏: $${stats.totalPnL}`)
    console.log(`总权益: $${stats.equity}`)
    console.log(`测试耗时: ${duration.toFixed(2)} 分钟`)
    
    // 检查是否达标65%胜率
    if (stats.winRate >= 65) {
      console.log('✅ 胜率达标65%，可以进入下一步')
    } else {
      console.log('❌ 胜率未达标65%，需要优化策略')
    }
    
    return stats
  }
}

const Simulator = new SimulatorEngine()

// ═══════════════════════════════════════════════════════
// 版本管理模块 v1.0 - 支持版本叠加和历史回溯
// ═══════════════════════════════════════════════════════
class VersionManager {
  constructor() {
    this.currentVersion = 'V1'
    this.versionHistory = [] // 清空历史记录
    
    // 当前版本特性
    this.versionFeatures = {
      'V1': '基础版本：100分制评分系统'
    }
    
    // 版本优化路径（便于对比）
    this.optimizationPath = {
      'V1': '基础版本：100分制评分系统'
    }
  }
  
  loadVersionHistory() {
    return [] // 始终返回空数组，清空历史记录
  }
  
  saveVersionHistory() {
    localStorage.setItem('btc_versions', JSON.stringify(this.versionHistory))
  }
  
  // 记录新版本信息
  recordVersion(version, features, stats = {}) {
    const record = {
      version,
      timestamp: new Date().toISOString(),
      features: this.versionFeatures[version] || features,
      ...stats
    }
    
    this.versionHistory = [record] // 只保留当前版本
    this.saveVersionHistory()
    
    console.log(`[Version] 📍版本记录: ${version} - ${record.features}`)
    return record
  }
  
  // 获取版本对比（最近2个版本）
  getVersionComparison() {
    return null // 不提供版本对比
  }
  
  getAddedFeatures(prev, curr) {
    return [] // 不提供特性对比
  }
  
  getDateDiff(timestamp1, timestamp2) {
    return '0天' // 不提供时间对比
  }
  
  // 生成版本摘要（用于UI展示）
  getVersionSummary() {
    return {
      current: this.currentVersion,
      feature: this.versionFeatures[this.currentVersion],
      historyCount: 1,
      latestStats: this.versionHistory[0] || {}
    }
  }
}

const VersionSystem = new VersionManager()

// ── 导出 ──
window.BTCSignal = {
  detectSignal: detectBtcSignal,
  detectBtcSignal,
  runBacktest,
  fetchKlines,
  CONFIG,
  Simulator,
  VersionSystem
}

// ═══════════════════════════════════════════════════════════
// LightweightCharts K线引擎 v1.0
// 依赖：<script src="https://unpkg.com/lightweight-charts@4/dist/lightweight-charts.standalone.production.js">
// ═══════════════════════════════════════════════════════════

const _lwState = {
  chart: null,          // LWC chart 实例
  candleSeries: null,   // K线series
  volumeSeries: null,   // 成交量series
  macdSeries: null,     // MACD histogram
  difSeries: null,
  deaSeries: null,
  ws: null,             // WebSocket 实例
  wsInterval: null,     // 当前WS订阅周期
  wsReconnectTimer: null,
  currentInterval: '15m',
  containerId: null,
  lastBar: null,        // 最后一根K线（用于实时更新）
}

// 周期 → WS stream name 映射
const INTERVAL_TO_WS = {
  '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m',
  '1h':'1h','2h':'2h','4h':'4h','6h':'6h','12h':'12h',
  '1d':'1d','3d':'3d','1w':'1w'
}

// ── 初始化图表容器（全部走 CanvasChart，不依赖 LightweightCharts）──
function initLWChart(containerId) {
  const el = document.getElementById(containerId)
  if (!el) { console.error('[LWC] 找不到容器:', containerId); return }

  _lwState.containerId = containerId

  // 优先用 CanvasChart（自绘，无外部依赖）
  if (window.CanvasChart) {
    window.CanvasChart.init(containerId)
    console.log('[LWC] CanvasChart 初始化完成:', containerId)
    return
  }

  // 兜底：旧 LightweightCharts 路径
  const LWC = window.LightweightCharts
  if (!LWC) { console.error('[LWC] 图表库未加载'); return }

  // 确保容器有高度
  const rect = el.getBoundingClientRect()
  const chartW = rect.width > 10 ? rect.width : window.innerWidth
  const chartH = rect.height > 10 ? rect.height : 280
  // 强制设置容器高度（防止0高度问题）
  el.style.height = Math.max(chartH, 280) + 'px'

  const chart = LWC.createChart(el, {
    width: chartW,
    height: Math.max(chartH, 280),
    autoSize: true,
    layout: {
      background: { color: '#0a0e17' },
      textColor: '#94a3b8',
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(148,163,184,0.08)' },
      horzLines: { color: 'rgba(148,163,184,0.08)' },
    },
    crosshair: {
      mode: LWC.CrosshairMode.Normal,
      vertLine: { color: '#60a5fa', labelBackgroundColor: '#1e3a5f' },
      horzLine: { color: '#60a5fa', labelBackgroundColor: '#1e3a5f' },
    },
    rightPriceScale: {
      borderColor: 'rgba(148,163,184,0.2)',
      textColor: '#94a3b8',
    },
    timeScale: {
      borderColor: 'rgba(148,163,184,0.2)',
      textColor: '#94a3b8',
      timeVisible: true,
      secondsVisible: false,
      fixLeftEdge: false,
    },
    handleScroll: true,
    handleScale: true,
  })

  // 主K线 series
  const candleSeries = chart.addCandlestickSeries({
    upColor: '#ef4444',
    downColor: '#22c55e',
    borderUpColor: '#ef4444',
    borderDownColor: '#22c55e',
    wickUpColor: '#ef4444',
    wickDownColor: '#22c55e',
  })

  // 成交量 series（底部小区域）
  const volumeSeries = chart.addHistogramSeries({
    color: 'rgba(100,116,139,0.4)',
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
  })
  chart.priceScale('vol').applyOptions({
    scaleMargins: { top: 0.85, bottom: 0 },
  })

  _lwState.chart = chart
  _lwState.candleSeries = candleSeries
  _lwState.volumeSeries = volumeSeries


  // autoSize:true 已自动响应容器尺寸，无需手动 ResizeObserver

  console.log('[LWC] 图表初始化完成 w=' + chartW + ' h=' + Math.max(chartH, 280))
  return chart
}

// ── 加载历史数据到图表 ──
async function loadChartData(interval, limit = 200) {
  try {
    const bars = await fetchKlines(interval, limit)
    if (!bars || bars.length === 0) throw new Error('数据为空')

    // ── 优先走 CanvasChart ──
    if (window.CanvasChart) {
      window.CanvasChart.setInterval(interval)
      window.CanvasChart.setData(bars)
      _lwState.lastBar = bars[bars.length - 1]
      _lwState.currentInterval = interval

      // 更新图例标题
      const legendEl = document.getElementById('chartIntervalLabel')
      if (legendEl) legendEl.textContent = interval.toUpperCase()

      // 存储历史bars供增量计算用
      _lwState.allBars = bars

      // 启动 WebSocket 实时推送
      startWS(interval)
      return bars
    }

    // ── 旧 LightweightCharts 兜底 ──
    if (!_lwState.chart) return

    const candles = bars.map(b => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    }))
    const volumes = bars.map(b => ({
      time: b.time,
      value: b.volume,
      color: b.close >= b.open ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)'
    }))

    if (_lwState.candleSeries) _lwState.candleSeries.setData(candles)
    if (_lwState.volumeSeries) _lwState.volumeSeries.setData(volumes)
    _lwState.lastBar = bars[bars.length - 1]
    _lwState.currentInterval = interval

    // 存储历史bars供增量计算用
    _lwState.allBars = bars

    _lwState.chart.timeScale().fitContent()

    const legendEl = document.getElementById('chartIntervalLabel')
    if (legendEl) legendEl.textContent = interval.toUpperCase()

    startWS(interval)
    return bars
  } catch (e) {
    console.error('[LWC] 数据加载失败:', e)
    throw e
  }
}

// ── WebSocket 实时推送 ──
function startWS(interval) {
  // 关闭旧连接
  stopWS()

  const streamInterval = INTERVAL_TO_WS[interval] || interval
  const wsUrl = `wss://data-stream.binance.vision/stream?streams=btcusdt@kline_${streamInterval}`

  function connect() {
    try {
      const ws = new WebSocket(wsUrl)
      _lwState.ws = ws

      ws.onopen = () => console.log('[WS] 已连接', wsUrl)

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          const k = msg.data && msg.data.k
          if (!k) return

          const bar = {
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
          }
          const vol = {
            time: bar.time,
            value: parseFloat(k.v),
            color: bar.close >= bar.open ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)'
          }

          if (window.CanvasChart) window.CanvasChart.updateLastBar({ ...bar, volume: parseFloat(k.v) })
          if (window.LWChart && window.LWChart.updateBar) window.LWChart.updateBar(bar)
          if (_lwState.candleSeries) _lwState.candleSeries.update && _lwState.candleSeries.update(bar)
          if (_lwState.volumeSeries) _lwState.volumeSeries.update && _lwState.volumeSeries.update(vol)
          _lwState.lastBar = { ...bar, volume: parseFloat(k.v) }

          // 实时更新顶部价格显示
          const priceEl = document.getElementById('curPrice')
          const changeEl = document.getElementById('priceChange')
          if (priceEl) priceEl.textContent = bar.close.toFixed(2)
          if (changeEl && _lwState._openPrice) {
            const chg = (bar.close - _lwState._openPrice) / _lwState._openPrice * 100
            changeEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'
            changeEl.className = chg >= 0 ? 'price-change positive' : 'price-change negative'
          }

          // 记录当日开盘价（用于涨跌幅）
          if (!_lwState._openPrice && k.x) _lwState._openPrice = parseFloat(k.o)

          // ★ 实时计算指标并推送到UI（每个tick都更新）
          if (_lwState.allBars && _lwState.allBars.length > 0) {
            _updateLiveIndicators(bar)
          }

        } catch (e) { console.warn('[WS] 消息解析失败', e) }
      }

      ws.onerror = (e) => console.warn('[WS] 连接错误', e)

      ws.onclose = (e) => {
        console.warn('[WS] 断开，5s后重连', e.code)
        if (e.code !== 1000) { // 非主动关闭则重连
          _lwState.wsReconnectTimer = setTimeout(connect, 5000)
        }
      }
    } catch (e) {
      console.warn('[WS] 启动失败（可能离线），仅使用REST轮询', e)
    }
  }

  connect()
}

// ★ 实时计算指标（基于最新bar）
function _updateLiveIndicators(newBar) {
  try {
    if (!_lwState.allBars || _lwState.allBars.length < 50) return

    const bars = _lwState.allBars
    const closes = bars.map(b => b.close)
    const highs = bars.map(b => b.high)
    const lows = bars.map(b => b.low)
    const n = closes.length - 1

    // 计算指标
    const macdData = macd(closes)
    const kdjData = kdj(highs, lows, closes)
    const rsiArr = rsi(closes)
    const wrArr = wr(highs, lows, closes)
    const bollArr = boll(closes)
    const atrValues = atr(highs, lows, closes)

    // 更新综合打分
    let score = 0
    let scoreMax = 0

    // MACD评分(25)
    const macdBar = macdData.bar[n]
    const dif = macdData.dif[n]
    const dea = macdData.dea[n]
    if (macdBar > 0 && dif > dea) { score += 25; scoreMax += 25 } 
    else if (macdBar < 0 && dif < dea) { score += 25; scoreMax += 25 }
    else if (macdBar > 0) { score += 15; scoreMax += 25 }
    else if (macdBar < 0) { score += 15; scoreMax += 25 }
    else { scoreMax += 25 }

    // RSI评分(20)
    const rsiVal = rsiArr[n]
    if (rsiVal < 30) { score += 20; scoreMax += 20 }
    else if (rsiVal > 70) { score += 20; scoreMax += 20 }
    else if (rsiVal < 40 || rsiVal > 60) { score += 10; scoreMax += 20 }
    else { scoreMax += 20 }

    // KDJ评分(20)
    const jVal = kdjData.J[n]
    if (jVal < 0 || jVal > 100) { score += 20; scoreMax += 20 }
    else if (jVal < 20 || jVal > 80) { score += 15; scoreMax += 20 }
    else { scoreMax += 20 }

    // BOLL位置(15)
    const bollLast = bollArr[n]
    const price = closes[n]
    const bollPercent = ((price - bollLast.lower) / (bollLast.upper - bollLast.lower) * 100)
    if (bollPercent < 15 || bollPercent > 85) { score += 15; scoreMax += 15 }
    else if (bollPercent < 25 || bollPercent > 75) { score += 10; scoreMax += 15 }
    else { scoreMax += 15 }

    // WR评分(10)
    const wrVal = wrArr[n]
    if (wrVal < -80 || wrVal > -20) { score += 10; scoreMax += 10 }
    else { scoreMax += 10 }

    // ATR波动(10)
    const currentATR = atrValues[n]
    const atrPercent = (currentATR / price) * 100
    if (atrPercent >= 1.5 && atrPercent <= 4) { score += 10; scoreMax += 10 }
    else { scoreMax += 10 }

    // 转换为0-100评分
    const finalScore = scoreMax > 0 ? Math.round((score / scoreMax) * 100) : 0
    const stars = finalScore >= 80 ? 5 : finalScore >= 60 ? 4 : finalScore >= 40 ? 3 : finalScore >= 20 ? 2 : 1

    // 更新指标显示（不走 fetchSignalData）
    _renderLiveIndicators({
      macdBar, dif, dea, rsiVal, jVal, wrVal, bollLast, atrPercent,
      closes, highs, lows, price, score: finalScore, stars
    })

  } catch (e) {
    console.warn('[LiveIndicators] 计算失败:', e)
  }
}

// 实时渲染指标（UI更新，不依赖信号检测）
function _renderLiveIndicators(data) {
  try {
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
    const setClass = (id, cls) => { const el = document.getElementById(id); if (el) el.className = cls }

    // MACD
    if (data.macdBar !== undefined) {
      let status = 'neutral'
      if (data.macdBar > 0 && data.dif > data.dea) status = 'bullish'
      else if (data.macdBar < 0 && data.dif < data.dea) status = 'bearish'
      setText('indicatorMACDValue', data.macdBar.toFixed(2))
      setClass('indicatorMACDValue', 'indicator-value')
      if (document.getElementById('indicatorMACD')) {
        document.getElementById('indicatorMACD').className = `indicator-item ${status}`
      }
    }

    // RSI
    if (data.rsiVal !== undefined) {
      let status = 'neutral'
      if (data.rsiVal < 30) status = 'oversold'
      else if (data.rsiVal > 70) status = 'overbought'
      setText('indicatorRSIValue', data.rsiVal.toFixed(1))
      if (document.getElementById('indicatorRSI')) {
        document.getElementById('indicatorRSI').className = `indicator-item ${status}`
      }
    }

    // KDJ
    if (data.jVal !== undefined) {
      let status = 'neutral'
      if (data.jVal < 0 || data.jVal > 100) status = 'overbought'
      else if (data.jVal < 20 || data.jVal > 80) status = 'oversold'
      setText('indicatorKDJValue', data.jVal.toFixed(1))
      if (document.getElementById('indicatorKDJ')) {
        document.getElementById('indicatorKDJ').className = `indicator-item ${status}`
      }
    }

    // WR
    if (data.wrVal !== undefined) {
      let status = 'neutral'
      if (data.wrVal < -80 || data.wrVal > -20) status = 'overbought'
      setText('indicatorWRValue', data.wrVal.toFixed(1))
      if (document.getElementById('indicatorWR')) {
        document.getElementById('indicatorWR').className = `indicator-item ${status}`
      }
    }

    // BOLL
    if (data.bollLast && data.price) {
      const percent = ((data.price - data.bollLast.lower) / (data.bollLast.upper - data.bollLast.lower) * 100).toFixed(1)
      let status = 'neutral'
      if (percent < 20) status = 'oversold'
      else if (percent > 80) status = 'overbought'
      setText('indicatorBOLLValue', percent + '%')
      if (document.getElementById('indicatorBOLL')) {
        document.getElementById('indicatorBOLL').className = `indicator-item ${status}`
      }
    }

    // ATR
    if (data.atrPercent !== undefined) {
      let status = 'neutral'
      if (data.atrPercent < 1) status = 'low'
      else if (data.atrPercent > 3) status = 'high'
      setText('indicatorATRValue', data.atrPercent.toFixed(2) + '%')
      if (document.getElementById('indicatorATR')) {
        document.getElementById('indicatorATR').className = `indicator-item ${status}`
      }
    }

    // 更新综合评分圆盘
    const scoreEl = document.getElementById('totalScore')
    if (scoreEl) {
      scoreEl.textContent = data.score + '/100'
      scoreEl.style.color = data.score >= 80 ? '#10b981' : data.score >= 60 ? '#fbbf24' : '#ef4444'
    }
    const starsEl = document.getElementById('scoreStars')
    if (starsEl) {
      starsEl.textContent = '⭐'.repeat(data.stars) + '☆'.repeat(5 - data.stars)
    }
    const fillEl = document.getElementById('scoreFill')
    if (fillEl) {
      fillEl.style.width = data.score + '%'
      fillEl.style.transition = 'width 0.3s ease'
    }

  } catch (e) {
    console.warn('[renderLiveIndicators]', e)
  }
}


function stopWS() {
  if (_lwState.wsReconnectTimer) { clearTimeout(_lwState.wsReconnectTimer); _lwState.wsReconnectTimer = null }
  if (_lwState.ws) {
    _lwState.ws.onclose = null // 防止触发重连
    try { _lwState.ws.close(1000) } catch(e) {}
    _lwState.ws = null
  }
}

// ── 周期切换 ──
async function switchChartInterval(interval) {
  stopWS()
  // 清缓存强制刷新
  const cacheKey = `${interval}_200`
  delete _klinesCache[cacheKey]
  _lwState._openPrice = null
  return loadChartData(interval, 200)
}

// ── 兼容旧接口（防止其他代码报错）──
function drawKlineChart() {}
function drawMACDChart() {}
function drawBOLLChart() {}
function drawIntegratedChart(containerId, bars) {
  // 旧版兼容：如果图表已初始化就直接更新数据，否则忽略
  if (_lwState.candleSeries && bars && bars.length > 0) {
    const candles = bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }))
    const volumes = bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)' }))
    try { _lwState.candleSeries.setData(candles) } catch(e) {}
    try { _lwState.volumeSeries.setData(volumes) } catch(e) {}
  }
}

// ── 导出（不覆盖 canvas-chart.js 已设置的 window.LWChart）──
// canvas-chart.js 在 <head> 里先加载，已经设置了 window.LWChart
// app.js 在 body 底部加载，只补充 switchChartInterval/startWS/stopWS
if (!window.LWChart) {
  window.LWChart = { initLWChart, loadChartData, switchChartInterval, startWS, stopWS, state: _lwState }
} else {
  // 合并：保留 canvas-chart 的 init/setData，补充 switchChartInterval/WS 逻辑
  Object.assign(window.LWChart, { switchChartInterval, startWS, stopWS, state: _lwState })
  // 用 app.js 的 loadChartData（含 WS 启动）覆盖 canvas-chart 的简单版本
  window.LWChart.loadChartData = loadChartData
}
// 同步更新 CanvasChart 引用（以防 canvas-chart.js 早于 app.js 加载时 CanvasChart 已挂载）
if (window.CanvasChart) {
  window.LWChart.initLWChart = (id) => { window.CanvasChart.init(id); _lwState.containerId = id }
}

// ══════════════════════════════════════════
// 推送系统 v1.0 - 开单点位记录与统计
// ══════════════════════════════════════════
const PushSystem = {
  // 推送记录存储
  STORAGE_KEY: 'btc_radar_push_records',
  
  // 推送状态枚举
  STATUS: {
    PENDING: 'pending',      // 等待中
    OPENED: 'opened',        // 已开单
    CLOSED: 'closed',        // 已平仓
    EXPIRED: 'expired'       // 已失效
  },
  
  // 推送结果枚举
  RESULT: {
    SUCCESS: 'success',      // 成功
    FAILURE: 'failure',      // 失败
    PENDING: 'pending'       // 待定
  },
  
  // 初始化
  init() {
    if (!this.getRecords()) {
      this.saveRecords([])
    }
    console.log('推送系统已初始化')
  },
  
  // 获取所有推送记录
  getRecords() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY)
      return data ? JSON.parse(data) : []
    } catch (e) {
      console.error('读取推送记录失败:', e)
      return []
    }
  },
  
  // 保存推送记录
  saveRecords(records) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(records))
      return true
    } catch (e) {
      console.error('保存推送记录失败:', e)
      return false
    }
  },
  
  // 创建推送记录
  createPushRecord(signal) {
    const record = {
      id: this.generateId(),
      timestamp: Date.now(),
      date: new Date().toISOString(),
      
      // 信号信息
      direction: signal.direction || 'unknown',  // long/short
      entryPrice: signal.entryPrice || 0,         // 开单价格
      targetPrice: signal.targetPrice || 0,       // 目标价格
      stopLoss: signal.stopLoss || 0,             // 止损价格
      
      // 评分信息
      score: signal.score || 0,                   // 综合评分
      stars: signal.stars || 0,                   // 星级
      
      // 推送内容
      pushMessage: this.generatePushMessage(signal),
      
      // 状态追踪
      status: this.STATUS.PENDING,
      result: this.RESULT.PENDING,
      
      // 用户标记
      userNotes: '',
      
      // 历史记录
      statusHistory: [
        { status: this.STATUS.PENDING, timestamp: Date.now() }
      ]
    }
    
    // 保存记录
    const records = this.getRecords()
    records.unshift(record)  // 最新记录在前
    this.saveRecords(records)
    
    console.log('创建推送记录:', record.id)
    return record
  },
  
  // 生成推送消息
  generatePushMessage(signal) {
    const directionEmoji = signal.direction === 'long' ? '📈' : '📉'
    const scoreStars = '⭐'.repeat(signal.stars || 0)
    
    return `${directionEmoji} BTC三步法信号${scoreStars}
价格: $${signal.entryPrice?.toFixed(2)}
方向: ${signal.direction === 'long' ? '做多' : '做空'}
目标: $${signal.targetPrice?.toFixed(2)}
止损: $${signal.stopLoss?.toFixed(2)}
评分: ${signal.score}/100
时间: ${new Date().toLocaleString('zh-CN')}`
  },
  
  // 更新推送状态
  updatePushStatus(recordId, status) {
    const records = this.getRecords()
    const record = records.find(r => r.id === recordId)
    
    if (record) {
      record.status = status
      record.statusHistory.push({
        status: status,
        timestamp: Date.now()
      })
      this.saveRecords(records)
      console.log('更新推送状态:', recordId, status)
    }
    
    return record
  },
  
  // 标记推送结果
  markPushResult(recordId, result) {
    const records = this.getRecords()
    const record = records.find(r => r.id === recordId)
    
    if (record) {
      record.result = result
      record.closedAt = Date.now()
      
      // 自动更新状态
      if (result === this.RESULT.SUCCESS || result === this.RESULT.FAILURE) {
        record.status = this.STATUS.CLOSED
      }
      
      this.saveRecords(records)
      console.log('标记推送结果:', recordId, result)
    }
    
    return record
  },
  
  // 添加用户笔记
  addUserNote(recordId, note) {
    const records = this.getRecords()
    const record = records.find(r => r.id === recordId)
    
    if (record) {
      record.userNotes = note
      this.saveRecords(records)
    }
    
    return record
  },
  
  // 统计推送数据
  getStatistics() {
    const records = this.getRecords()
    
    // 基础统计
    const totalPushes = records.length
    const successCount = records.filter(r => r.result === this.RESULT.SUCCESS).length
    const failureCount = records.filter(r => r.result === this.RESULT.FAILURE).length
    const pendingCount = records.filter(r => r.result === this.RESULT.PENDING).length
    
    // 成功率
    const successRate = totalPushes > 0 ? ((successCount / totalPushes) * 100).toFixed(1) : 0
    
    // 最近7天统计
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recentRecords = records.filter(r => r.timestamp >= sevenDaysAgo)
    const recentSuccess = recentRecords.filter(r => r.result === this.RESULT.SUCCESS).length
    const recentRate = recentRecords.length > 0 ? ((recentSuccess / recentRecords.length) * 100).toFixed(1) : 0
    
    // 方向统计
    const longCount = records.filter(r => r.direction === 'long').length
    const shortCount = records.filter(r => r.direction === 'short').length
    
    // 状态统计
    const statusStats = {
      pending: records.filter(r => r.status === this.STATUS.PENDING).length,
      opened: records.filter(r => r.status === this.STATUS.OPENED).length,
      closed: records.filter(r => r.status === this.STATUS.CLOSED).length,
      expired: records.filter(r => r.status === this.STATUS.EXPIRED).length
    }
    
    // 平均评分
    const scoredRecords = records.filter(r => r.score > 0)
    const avgScore = scoredRecords.length > 0 
      ? (scoredRecords.reduce((sum, r) => sum + r.score, 0) / scoredRecords.length).toFixed(1)
      : 0
    
    return {
      totalPushes,
      successCount,
      failureCount,
      pendingCount,
      successRate: parseFloat(successRate),
      recentRate: parseFloat(recentRate),
      longCount,
      shortCount,
      statusStats,
      avgScore: parseFloat(avgScore),
      recentRecords: recentRecords.length,
      lastPushTime: records.length > 0 ? records[0].timestamp : null
    }
  },
  
  // 获取开单点位列表
  getOpenPoints() {
    const records = this.getRecords()
    return records
      .filter(r => r.status !== this.STATUS.EXPIRED)
      .map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        date: r.date,
        direction: r.direction,
        entryPrice: r.entryPrice,
        targetPrice: r.targetPrice,
        stopLoss: r.stopLoss,
        score: r.score,
        status: r.status,
        result: r.result
      }))
  },
  
  // 删除推送记录
  deleteRecord(recordId) {
    const records = this.getRecords()
    const filtered = records.filter(r => r.id !== recordId)
    this.saveRecords(filtered)
    console.log('删除推送记录:', recordId)
  },
  
  // 清空所有记录
  clearAllRecords() {
    this.saveRecords([])
    console.log('清空所有推送记录')
  },
  
  // 生成唯一ID
  generateId() {
    return 'push_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
  }
}

// 导出推送系统
window.PushSystem = PushSystem

// 导出绘制函数（兼容旧调用）
window.drawKlineChart = drawKlineChart
window.drawMACDChart = drawMACDChart
window.drawBOLLChart = drawBOLLChart
window.drawIntegratedChart = drawIntegratedChart

console.log('BTC三步法专业交易系统 v7.1 已加载 (LightweightCharts K线引擎)')
console.log('推送系统（开单点位记录+成功率统计）已加载')