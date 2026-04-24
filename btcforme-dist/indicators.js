// indicators.js - 技术指标计算库 v2.0
// ───────────────────────────────────────────────

/** EMA - 指数移动平均 */
function ema(arr, n) {
  const k = 2 / (n + 1)
  const res = []
  arr.forEach((v, i) => {
    if (i === 0) { res.push(v); return }
    res.push(v * k + res[i - 1] * (1 - k))
  })
  return res
}

/** SMA - 简单移动平均 */
function sma(arr, n) {
  return arr.map((_, i) => {
    const start = Math.max(0, i - n + 1)
    const slice = arr.slice(start, i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

/** MACD(12,26,9) → { dif, dea, bar } 数组 */
function macd(closes) {
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const dif = ema12.map((v, i) => v - ema26[i])
  const dea = ema(dif, 9)
  const bar = dif.map((v, i) => (v - dea[i]) * 2)
  return { dif, dea, bar }
}

/** KDJ(9,3,3) */
function kdj(highs, lows, closes) {
  const n = 9
  const K = [], D = [], J = []
  closes.forEach((c, i) => {
    const start = Math.max(0, i - n + 1)
    const hh = Math.max(...highs.slice(start, i + 1))
    const ll = Math.min(...lows.slice(start, i + 1))
    const rsv = hh === ll ? 50 : (c - ll) / (hh - ll) * 100
    const kPrev = i > 0 ? K[i - 1] : 50
    const dPrev = i > 0 ? D[i - 1] : 50
    const k = kPrev * 2 / 3 + rsv / 3
    const d = dPrev * 2 / 3 + k / 3
    K.push(k); D.push(d); J.push(3 * k - 2 * d)
  })
  return { K, D, J }
}

/** RSI(14) */
function rsi(closes, n = 14) {
  const res = []
  for (let i = 0; i < closes.length; i++) {
    if (i < n) { res.push(50); continue }
    let gain = 0, loss = 0
    for (let j = i - n + 1; j <= i; j++) {
      const d = closes[j] - closes[j - 1]
      if (d > 0) gain += d; else loss -= d
    }
    const rs = loss === 0 ? 100 : gain / loss
    res.push(100 - 100 / (1 + rs))
  }
  return res
}

/** WR(14) */
function wr(highs, lows, closes, n = 14) {
  return closes.map((c, i) => {
    const start = Math.max(0, i - n + 1)
    const hh = Math.max(...highs.slice(start, i + 1))
    const ll = Math.min(...lows.slice(start, i + 1))
    return hh === ll ? -50 : -((hh - c) / (hh - ll)) * 100
  })
}

/** BOLL(20,2) */
function boll(closes, n = 20, mult = 2) {
  return closes.map((_, i) => {
    const start = Math.max(0, i - n + 1)
    const slice = closes.slice(start, i + 1)
    const mid = slice.reduce((a, b) => a + b) / slice.length
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / slice.length)
    return { mid, upper: mid + mult * std, lower: mid - mult * std }
  })
}

/** ATR - 平均真实波幅 */
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

/** 计算支撑阻力位 */
function supportResistance(highs, lows, closes, lookback = 20) {
  const levels = []
  for (let i = lookback; i < highs.length; i++) {
    const highSlice = highs.slice(i - lookback, i + 1)
    const lowSlice = lows.slice(i - lookback, i + 1)
    
    const localHigh = Math.max(...highSlice)
    const localLow = Math.min(...lowSlice)
    
    if (highs[i] === localHigh && closes[i] < highs[i] * 0.98) {
      levels.push({ type: 'resistance', price: highs[i], index: i })
    }
    if (lows[i] === localLow && closes[i] > lows[i] * 1.02) {
      levels.push({ type: 'support', price: lows[i], index: i })
    }
  }
  return levels.slice(-5)
}

console.log('[Indicators] 技术指标库已加载');
