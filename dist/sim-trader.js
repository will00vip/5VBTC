// ═══════════════════════════════════════════════════════════════
// 模拟交易引擎 v2.0 - BTC 插针放量反转战法 专业量化回测
// ───────────────────────────────────────────────────────────────
// 贴近真实市场的改进：
//  1. 滑点模拟（开仓/止损均有价格滑移）
//  2. 真实手续费（Maker/Taker + 资金费率）
//  3. 大趋势过滤（MA20/MA60 顺势/逆势分开统计）
//  4. 多指标联合评分（插针形态+放量+RSI+KDJ+MACD+BOLL+ATR）
//  5. 动态止损（移动止损保护利润）
//  6. ATR 自适应止损（高波动期止损更宽）
//  7. 连亏保护（连续亏损>3次自动降仓）
//  8. 信号冷却（同方向信号30分钟内不重复）
//  9. 完整时间戳（入场/出场/K线时间，便于复盘）
// 10. 每笔记录详细理由链（哪些指标触发，哪些没达标）
// ═══════════════════════════════════════════════════════════════

const SimTrader = (() => {

  // ── 账户状态 ──
  let _account = {}
  let _lastSignalTime = { long: 0, short: 0 }  // 信号冷却时间
  let _consecutiveLosses = 0                     // 连续亏损次数

  // ── 战法参数（全部可配置） ──
  const PARAMS = {
    // 形态
    SHADOW_RATIO: 2.0,      // 影线/实体 最低倍数
    SHADOW_RANGE_PCT: 0.38, // 影线占总振幅的最低比例
    BODY_MIN_PCT: 0.0003,   // 实体最小比例（过滤十字星）

    // 放量
    VOLUME_RATIO: 1.5,      // 放量倍数（≥1.5x 均量）
    VOLUME_STRONG: 2.5,     // 强放量倍数

    // 止损止盈
    ATR_PERIOD: 14,         // ATR 周期
    ATR_SL_MULT: 1.2,       // ATR × 倍数 = 止损距离（自适应）
    SL_MAX_PCT: 0.015,      // 止损最大上限 1.5%（防止异常宽止损）
    SL_MIN_PCT: 0.004,      // 止损最小下限 0.4%
    TP1_RR: 1.0,            // TP1 盈亏比 1:1
    TP2_RR: 2.0,            // TP2 盈亏比 1:2
    TP3_RR: 3.5,            // TP3 盈亏比 1:3.5
    TP1_EXIT: 0.35,         // TP1 平仓比例 35%
    TP2_EXIT: 0.35,         // TP2 平仓比例 35%
    TP3_EXIT: 0.30,         // TP3 剩余仓位 30%

    // 移动止损
    TRAIL_AFTER_TP1: true,  // TP1 触发后移动止损到入场价（保本）
    TRAIL_AFTER_TP2: true,  // TP2 触发后移动止损到 TP1

    // 仓位
    BASE_RISK_PCT: 0.02,    // 基础风险仓位 2%
    MAX_RISK_PCT: 0.03,     // 最大单次风险 3%
    LEVERAGE: 20,           // 杠杆

    // 手续费（模拟币安期货）
    TAKER_FEE: 0.0005,      // Taker 手续费 0.05%
    FUNDING_RATE: 0.0001,   // 资金费率 0.01%（每8小时）

    // 滑点（市价单平均滑点）
    SLIPPAGE: 0.0003,       // 0.03% 滑点

    // 信号评分
    SIGNAL_MIN_SCORE: 5,    // 最低开仓分数
    STRONG_SIGNAL: 8,       // 强信号分数

    // 趋势过滤
    TREND_FILTER: true,     // 是否开启趋势过滤（顺势才开）
    MA_FAST: 20,
    MA_SLOW: 60,

    // 信号冷却（毫秒，15分钟K线 = 15*60s = 900s）
    COOLDOWN_BARS: 3,       // 同方向信号间隔至少3根K线
  }

  // ── 初始化账户 ──
  function reset(initialBalance, customParams) {
    const bal = parseFloat(initialBalance) || 100
    if (customParams) Object.assign(PARAMS, customParams)
    _account = {
      initBalance: bal,
      balance: bal,
      equity: bal,
      peakBalance: bal,
      maxDrawdown: 0,
      trades: [],         // 所有平仓记录（含分批）
      openTrade: null,
      stats: null,
    }
    _lastSignalTime = { long: 0, short: 0 }
    _consecutiveLosses = 0
    
    // ★ 从localStorage恢复上次的状态（如果用户要求继续）
    try {
      const saved = localStorage.getItem('_simTraderState')
      if (saved) {
        const prev = JSON.parse(saved)
        if (prev.trades && prev.trades.length > 0) {
          _account.trades = prev.trades
          _account.balance = prev.balance
          _account.peakBalance = prev.peakBalance
          _account.maxDrawdown = prev.maxDrawdown
        }
      }
    } catch (e) {
      console.warn('[SimTrader] 无法恢复历史数据:', e)
    }
  }

  // ★ 保存当前账户状态到localStorage
  function _saveState() {
    try {
      const state = {
        balance: _account.balance,
        peakBalance: _account.peakBalance,
        maxDrawdown: _account.maxDrawdown,
        trades: _account.trades,
        timestamp: Date.now(),
      }
      localStorage.setItem('_simTraderState', JSON.stringify(state))
    } catch (e) {
      console.warn('[SimTrader] 无法保存状态:', e)
    }
  }

  // ═════════════════════════════════════
  // 主回测函数
  // ═════════════════════════════════════
  function runBacktest(bars) {
    if (!bars || bars.length < PARAMS.MA_SLOW + 5) {
      return { error: `数据太少，至少需要${PARAMS.MA_SLOW + 5}根K线` }
    }

    const signals = []
    const warmup = Math.max(PARAMS.MA_SLOW, 50)

    for (let i = warmup; i < bars.length; i++) {
      // ① 先更新持仓（检查平仓）
      if (_account.openTrade) {
        const exits = _checkExit(_account.openTrade, bars[i])
        for (const exit of exits) {
          _processTrade(_account.openTrade, exit, bars[i])
          if (_account.openTrade.remainPct <= 0.001) {
            _account.openTrade = null
            break
          }
        }
      }

      // ② 无持仓时检测新信号
      if (!_account.openTrade) {
        const ctx = _buildContext(bars, i)
        const sig = _detectSignal(ctx)
        if (sig) {
          signals.push({
            time: bars[i].time,
            direction: sig.direction,
            score: sig.score,
            timeStr: _fmtTimeFull(bars[i].time),
          })
          _openTrade(sig, bars[i], ctx)
          _lastSignalTime[sig.direction] = i
        }
      }

      // ③ 更新最大回撤
      if (_account.balance < _account.peakBalance) {
        const dd = (_account.peakBalance - _account.balance) / _account.peakBalance
        if (dd > _account.maxDrawdown) _account.maxDrawdown = dd
      } else if (_account.balance > _account.peakBalance) {
        _account.peakBalance = _account.balance
      }
    }

    // 强平最后持仓
    if (_account.openTrade) {
      const lb = bars[bars.length - 1]
      _processTrade(_account.openTrade, {
        price: lb.close,
        reason: '回测结束强平',
        type: 'close',
        pnlSign: _account.openTrade.direction === 'long'
          ? (lb.close - _account.openTrade.entryPrice) > 0 ? 1 : -1
          : (lb.close - _account.openTrade.entryPrice) < 0 ? 1 : -1,
        exitRatio: 1.0,
      }, lb)
      _account.openTrade = null
    }

    _account.stats = _calcStats()
    return {
      stats: _account.stats,
      trades: _account.trades,
      signals,
      error: null,
    }
  }

  // ═════════════════════════════════════
  // 构建分析上下文（指标计算）
  // ═════════════════════════════════════
  function _buildContext(bars, i) {
    const slice = bars.slice(Math.max(0, i - 100), i + 1)
    const bar = bars[i]
    const closes = slice.map(b => b.close)
    const highs = slice.map(b => b.high)
    const lows = slice.map(b => b.low)
    const vols = slice.map(b => b.volume)
    const n = closes.length

    // MA
    const ma20 = _sma(closes, Math.min(20, n))
    const ma60 = _sma(closes, Math.min(60, n))
    const trend = ma20 > ma60 ? 'bull' : ma20 < ma60 ? 'bear' : 'flat'

    // ATR
    const atr = _atr(bars.slice(Math.max(0, i - PARAMS.ATR_PERIOD - 1), i + 1), PARAMS.ATR_PERIOD)

    // RSI(14)
    const rsi = _rsi(closes, Math.min(14, n - 1))

    // MACD(12,26,9)
    const macd = _macd(closes)

    // KDJ(9,3,3)
    const kdj = _kdj(highs, lows, closes, 9)

    // BOLL(20,2)
    const boll = _boll(closes, Math.min(20, n), 2)

    // 均量
    const avgVol20 = vols.slice(-21, -1).reduce((s, v) => s + v, 0) / Math.min(20, vols.length - 1)

    return { bar, i, bars, ma20, ma60, trend, atr, rsi, macd, kdj, boll, avgVol20, closes, highs, lows }
  }

  // ═════════════════════════════════════
  // 信号检测（多指标联合评分）
  // ═════════════════════════════════════
  function _detectSignal(ctx) {
    const { bar, i, rsi, macd, kdj, boll, atr, avgVol20, trend, ma20, ma60 } = ctx

    const body = Math.abs(bar.close - bar.open)
    const upperShadow = bar.high - Math.max(bar.open, bar.close)
    const lowerShadow = Math.min(bar.open, bar.close) - bar.low
    const totalRange = bar.high - bar.low
    const bodyPct = body / (bar.open || 1)

    if (totalRange < 0.0001) return null  // 过滤无效K线

    // 实体过小（十字星），不做信号
    // if (bodyPct < PARAMS.BODY_MIN_PCT) return null

    let direction = null
    let score = 0
    const reasons = []    // 触发原因
    const misses = []     // 未达标原因（便于复盘）

    // ─── 形态识别 ───
    const isLowerPin = lowerShadow > body * PARAMS.SHADOW_RATIO && lowerShadow > totalRange * PARAMS.SHADOW_RANGE_PCT
    const isUpperPin = upperShadow > body * PARAMS.SHADOW_RATIO && upperShadow > totalRange * PARAMS.SHADOW_RANGE_PCT

    if (isLowerPin) {
      direction = 'long'
      score += 3
      reasons.push(`下影线${(lowerShadow / body).toFixed(1)}x实体`)
    } else if (isUpperPin) {
      direction = 'short'
      score += 3
      reasons.push(`上影线${(upperShadow / body).toFixed(1)}x实体`)
    } else {
      return null
    }

    // ─── 放量加分 ───
    const volRatio = bar.volume / (avgVol20 || 1)
    if (volRatio >= PARAMS.VOLUME_STRONG) {
      score += 3
      reasons.push(`超强放量${volRatio.toFixed(1)}x`)
    } else if (volRatio >= PARAMS.VOLUME_RATIO) {
      score += 2
      reasons.push(`放量${volRatio.toFixed(1)}x`)
    } else {
      misses.push(`量不足(${volRatio.toFixed(1)}x<${PARAMS.VOLUME_RATIO}x)`)
    }

    // ─── 实体方向确认 ───
    if (direction === 'long' && bar.close > bar.open) {
      score += 1
      reasons.push('阳线收盘')
    } else if (direction === 'short' && bar.close < bar.open) {
      score += 1
      reasons.push('阴线收盘')
    } else {
      misses.push('实体方向不符')
    }

    // ─── 影线强度加分 ───
    const pinRatio = direction === 'long' ? lowerShadow / body : upperShadow / body
    if (pinRatio > 4) { score += 2; reasons.push(`极强影线${pinRatio.toFixed(1)}x`) }
    else if (pinRatio > 3) { score += 1; reasons.push(`强影线${pinRatio.toFixed(1)}x`) }

    // ─── RSI 超买超卖 ───
    if (rsi !== null) {
      if (direction === 'long' && rsi < 30) { score += 2; reasons.push(`RSI超卖${rsi.toFixed(0)}`) }
      else if (direction === 'long' && rsi < 40) { score += 1; reasons.push(`RSI偏低${rsi.toFixed(0)}`) }
      else if (direction === 'short' && rsi > 70) { score += 2; reasons.push(`RSI超买${rsi.toFixed(0)}`) }
      else if (direction === 'short' && rsi > 60) { score += 1; reasons.push(`RSI偏高${rsi.toFixed(0)}`) }
      else { misses.push(`RSI中性${rsi.toFixed(0)}`) }
    }

    // ─── MACD 方向确认 ───
    if (macd) {
      const { dif, dea, histogram } = macd
      if (direction === 'long' && histogram > 0 && dif > dea) { score += 1; reasons.push('MACD金叉') }
      else if (direction === 'long' && histogram > -20 && dif > dea - 5) { score += 1; reasons.push('MACD底部') }
      else if (direction === 'short' && histogram < 0 && dif < dea) { score += 1; reasons.push('MACD死叉') }
      else if (direction === 'short' && histogram < 20 && dif < dea + 5) { score += 1; reasons.push('MACD顶部') }
      else { misses.push('MACD背离') }
    }

    // ─── KDJ ───
    if (kdj) {
      const { k, d, j } = kdj
      if (direction === 'long' && j < 20) { score += 1; reasons.push(`KDJ超卖J=${j.toFixed(0)}`) }
      else if (direction === 'long' && k < d && j < 40) { score += 1; reasons.push('KDJ多头背离') }
      else if (direction === 'short' && j > 80) { score += 1; reasons.push(`KDJ超买J=${j.toFixed(0)}`) }
      else if (direction === 'short' && k > d && j > 60) { score += 1; reasons.push('KDJ空头背离') }
      else { misses.push(`KDJ中性J=${j ? j.toFixed(0): '?'}`) }
    }

    // ─── BOLL 位置 ───
    if (boll) {
      const { upper, mid, lower } = boll
      if (direction === 'long' && bar.low <= lower * 1.002) { score += 1; reasons.push('触及BOLL下轨') }
      else if (direction === 'short' && bar.high >= upper * 0.998) { score += 1; reasons.push('触及BOLL上轨') }
      else { misses.push('BOLL中性') }
    }

    // ─── 大趋势过滤 ───
    let trendOk = true
    let trendTag = ''
    if (PARAMS.TREND_FILTER) {
      if (direction === 'long') {
        if (trend === 'bull') { score += 1; trendTag = '顺势做多'; reasons.push('顺势做多') }
        else if (trend === 'bear') { score -= 1; trendTag = '逆势做多⚠'; misses.push('逆势做多-1分') }
        else { trendTag = '震荡做多' }
      } else {
        if (trend === 'bear') { score += 1; trendTag = '顺势做空'; reasons.push('顺势做空') }
        else if (trend === 'bull') { score -= 1; trendTag = '逆势做空⚠'; misses.push('逆势做空-1分') }
        else { trendTag = '震荡做空' }
      }
    }

    // ─── 信号冷却检查 ───
    if (i - _lastSignalTime[direction] < PARAMS.COOLDOWN_BARS) {
      misses.push(`冷却期(${PARAMS.COOLDOWN_BARS}根)`)
      return null
    }

    // ─── 分数门槛 ───
    if (score < PARAMS.SIGNAL_MIN_SCORE) return null

    return {
      direction,
      score,
      reasons,
      misses,
      trendTag,
      trend,
      rsi: rsi ? rsi.toFixed(1) : null,
      macd,
      kdj,
      atr,
      bar,
    }
  }

  // ═════════════════════════════════════
  // 开仓
  // ═════════════════════════════════════
  function _openTrade(sig, bar, ctx) {
    const { atr } = ctx
    const slippage = bar.close * PARAMS.SLIPPAGE

    // 市价开仓含滑点
    const entryPrice = sig.direction === 'long'
      ? bar.close + slippage    // 做多：略高于收盘价买入
      : bar.close - slippage    // 做空：略低于收盘价卖出

    // ATR 自适应止损
    let slDist = atr * PARAMS.ATR_SL_MULT
    slDist = Math.min(slDist, entryPrice * PARAMS.SL_MAX_PCT)
    slDist = Math.max(slDist, entryPrice * PARAMS.SL_MIN_PCT)

    const sl = sig.direction === 'long' ? entryPrice - slDist : entryPrice + slDist

    // 基于盈亏比的三档止盈
    const tp1 = sig.direction === 'long'
      ? entryPrice + slDist * PARAMS.TP1_RR
      : entryPrice - slDist * PARAMS.TP1_RR
    const tp2 = sig.direction === 'long'
      ? entryPrice + slDist * PARAMS.TP2_RR
      : entryPrice - slDist * PARAMS.TP2_RR
    const tp3 = sig.direction === 'long'
      ? entryPrice + slDist * PARAMS.TP3_RR
      : entryPrice - slDist * PARAMS.TP3_RR

    // 动态仓位（连续亏损降仓）
    let riskPct = PARAMS.BASE_RISK_PCT
    if (_consecutiveLosses >= 3) riskPct = PARAMS.BASE_RISK_PCT * 0.5
    else if (_consecutiveLosses >= 2) riskPct = PARAMS.BASE_RISK_PCT * 0.7

    const riskAmount = _account.balance * riskPct
    // positionSize = 合约张数（以USDT价值计）
    const positionValue = riskAmount * PARAMS.LEVERAGE
    const positionSize = positionValue / entryPrice

    // 开仓手续费（Taker）
    const openFee = positionValue * PARAMS.TAKER_FEE
    _account.balance -= openFee

    _account.openTrade = {
      id: Date.now(),
      direction: sig.direction,
      entryPrice,
      entryTime: bar.time,
      entryTimeStr: _fmtTimeFull(bar.time),
      sl,
      currentSl: sl,          // 动态止损
      tp1, tp2, tp3,
      positionSize,
      positionValue,
      slDist,
      remainPct: 1.0,
      score: sig.score,
      rsi: sig.rsi,
      trend: sig.trend,
      trendTag: sig.trendTag,
      reasons: sig.reasons.join(' | '),
      misses: sig.misses.join(' | '),
      tp1Hit: false,
      tp2Hit: false,
      openFee,
      fundingCount: 0,
    }
  }

  // ═════════════════════════════════════
  // 检查平仓（每根K线调用）
  // ═════════════════════════════════════
  function _checkExit(trade, bar) {
    const exits = []
    const isLong = trade.direction === 'long'

    // 资金费率（每8小时一次，15分钟K线约32根）
    // 简化：每50根K线扣一次资金费
    // 实际在这里只标记，由 _processTrade 处理

    // ─── 止损（优先级最高）───
    const slHit = isLong ? bar.low <= trade.currentSl : bar.high >= trade.currentSl
    if (slHit) {
      const slippage = trade.entryPrice * PARAMS.SLIPPAGE
      const exitPrice = isLong ? trade.currentSl - slippage : trade.currentSl + slippage
      exits.push({
        price: exitPrice,
        reason: trade.currentSl !== trade.sl ? '移动止损' : '止损',
        type: 'sl',
        exitRatio: trade.remainPct,
      })
      return exits  // 止损直接全平，不再检查其他
    }

    // ─── TP1（未触发时检查）───
    if (!trade.tp1Hit) {
      const tp1Hit = isLong ? bar.high >= trade.tp1 : bar.low <= trade.tp1
      if (tp1Hit) {
        trade.tp1Hit = true
        exits.push({
          price: trade.tp1,
          reason: 'TP1(1:1)',
          type: 'tp1',
          exitRatio: PARAMS.TP1_EXIT,
        })
        // 移动止损到入场价（保本）
        if (PARAMS.TRAIL_AFTER_TP1) trade.currentSl = trade.entryPrice
      }
    }

    // ─── TP2（未触发时检查）───
    if (!trade.tp2Hit) {
      const tp2Hit = isLong ? bar.high >= trade.tp2 : bar.low <= trade.tp2
      if (tp2Hit) {
        trade.tp2Hit = true
        exits.push({
          price: trade.tp2,
          reason: 'TP2(1:2)',
          type: 'tp2',
          exitRatio: PARAMS.TP2_EXIT,
        })
        // 移动止损到 TP1
        if (PARAMS.TRAIL_AFTER_TP2) trade.currentSl = trade.tp1
      }
    }

    // ─── TP3（全仓剩余）───
    const tp3Hit = isLong ? bar.high >= trade.tp3 : bar.low <= trade.tp3
    if (tp3Hit) {
      exits.push({
        price: trade.tp3,
        reason: 'TP3(1:3.5)',
        type: 'tp3',
        exitRatio: trade.remainPct,  // 剩余全部
      })
    }

    return exits
  }

  // ═════════════════════════════════════
  // 处理平仓（结算盈亏）
  // ═════════════════════════════════════
  function _processTrade(trade, exit, bar) {
    const isLong = trade.direction === 'long'
    const exitRatio = Math.min(exit.exitRatio, trade.remainPct)
    const closeSize = trade.positionSize * exitRatio
    const closeValue = closeSize * exit.price

    // 盈亏（USDT）
    const priceDiff = isLong
      ? exit.price - trade.entryPrice
      : trade.entryPrice - exit.price
    const rawPnl = priceDiff * closeSize

    // 关仓手续费
    const closeFee = closeValue * PARAMS.TAKER_FEE

    // 资金费率（每50根K线扣一次，约12.5h，接近实际）
    const fundingFee = closeValue * PARAMS.FUNDING_RATE * Math.floor(trade.fundingCount / 50)

    const actualPnl = rawPnl - closeFee - fundingFee

    _account.balance += actualPnl
    trade.remainPct -= exitRatio
    trade.fundingCount++

    // 连续亏损统计
    if (actualPnl < 0) _consecutiveLosses++
    else _consecutiveLosses = 0

    // 记录
    const record = {
      id: trade.id,
      direction: trade.direction === 'long' ? '做多▲' : '做空▼',
      entryTime: trade.entryTimeStr,
      exitTime: _fmtTimeFull(bar.time),
      entryTimeRaw: trade.entryTime,
      exitTimeRaw: bar.time,
      klineBarCount: bar.time - trade.entryTime, // 持仓K线数
      entryPrice: parseFloat(trade.entryPrice.toFixed(2)),
      exitPrice: parseFloat(exit.price.toFixed(2)),
      sl: parseFloat(trade.sl.toFixed(2)),
      tp1: parseFloat(trade.tp1.toFixed(2)),
      tp2: parseFloat(trade.tp2.toFixed(2)),
      tp3: parseFloat(trade.tp3.toFixed(2)),
      slDist: parseFloat(trade.slDist.toFixed(2)),
      pnl: parseFloat(actualPnl.toFixed(4)),
      pnlPct: parseFloat((priceDiff / trade.entryPrice * 100 * PARAMS.LEVERAGE).toFixed(2)),
      reason: exit.reason,
      entryReasons: trade.reasons,
      misses: trade.misses,
      score: trade.score,
      rsi: trade.rsi,
      trend: trade.trendTag || trade.trend,
      balance: parseFloat(_account.balance.toFixed(4)),
      exitRatio: parseFloat(exitRatio.toFixed(2)),
      win: actualPnl > 0,
      isFull: trade.remainPct <= 0.001,   // 是否完全平仓
      fee: parseFloat((closeFee + fundingFee).toFixed(4)),
    }

    _account.trades.push(record)
    _saveState()  // ★ 每笔平仓后持久化到localStorage
  }

  // ═════════════════════════════════════
  // 统计分析
  // ═════════════════════════════════════
  function _calcStats() {
    // 按 id 合并分批记录，计算每笔完整交易的总盈亏
    const tradeMap = {}
    for (const r of _account.trades) {
      if (!tradeMap[r.id]) {
        tradeMap[r.id] = {
          ...r,
          totalPnl: 0,
          totalFee: 0,
          exitReasons: [],
          win: false,
        }
      }
      tradeMap[r.id].totalPnl += r.pnl
      tradeMap[r.id].totalFee += r.fee
      tradeMap[r.id].exitReasons.push(r.reason)
      // 以最后一笔平仓时间为出场时间
      if (r.exitTimeRaw > tradeMap[r.id].exitTimeRaw) {
        tradeMap[r.id].exitTime = r.exitTime
        tradeMap[r.id].exitTimeRaw = r.exitTimeRaw
      }
    }
    const completedTrades = Object.values(tradeMap).map(t => ({
      ...t,
      totalPnl: parseFloat(t.totalPnl.toFixed(4)),
      totalFee: parseFloat(t.totalFee.toFixed(4)),
      exitReasonStr: t.exitReasons.join('→'),
      win: t.totalPnl > 0,
    }))

    // ★ 周月统计
    const now = new Date()
    const weekStart = new Date(now.setDate(now.getDate() - now.getDay())); weekStart.setHours(0,0,0,0)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1); monthStart.setHours(0,0,0,0)
    
    const weekTrades = completedTrades.filter(t => t.entryTimeRaw >= weekStart.getTime())
    const monthTrades = completedTrades.filter(t => t.entryTimeRaw >= monthStart.getTime())
    
    const calcWinRate = (trades) => {
      if (trades.length === 0) return '0%'
      const wins = trades.filter(t => t.win).length
      return (wins / trades.length * 100).toFixed(1) + '%'
    }
    const calcPnl = (trades) => {
      return trades.reduce((s, t) => s + t.totalPnl, 0).toFixed(4)
    }

    const total = completedTrades.length
    if (total === 0) return { total: 0, winRate: '0%', error: '无有效交易' }

    const wins = completedTrades.filter(t => t.win)
    const losses = completedTrades.filter(t => !t.win)
    const longTrades = completedTrades.filter(t => t.direction.includes('做多'))
    const shortTrades = completedTrades.filter(t => t.direction.includes('做空'))
    const longWins = longTrades.filter(t => t.win).length
    const shortWins = shortTrades.filter(t => t.win).length

    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.totalPnl, 0) / wins.length : 0
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.totalPnl, 0) / losses.length) : 0
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 99 : 0)
    const totalFee = completedTrades.reduce((s, t) => s + t.totalFee, 0)
    const totalPnl = _account.balance - _account.initBalance

    return {
      // ── 总体统计 ──
      total,
      wins: wins.length,
      losses: losses.length,
      winRate: (wins.length / total * 100).toFixed(1) + '%',
      longTrades: longTrades.length,
      shortTrades: shortTrades.length,
      longWinRate: longTrades.length > 0 ? (longWins / longTrades.length * 100).toFixed(1) + '%' : '--',
      shortWinRate: shortTrades.length > 0 ? (shortWins / shortTrades.length * 100).toFixed(1) + '%' : '--',
      avgWin: avgWin.toFixed(4),
      avgLoss: avgLoss.toFixed(4),
      profitFactor: profitFactor.toFixed(2),
      maxDrawdown: (_account.maxDrawdown * 100).toFixed(1) + '%',
      totalPnl: totalPnl.toFixed(4),
      totalPnlPct: (totalPnl / _account.initBalance * 100).toFixed(1) + '%',
      totalFee: totalFee.toFixed(4),
      finalBalance: _account.balance.toFixed(4),
      completedTrades,
      
      // ★ 周统计
      week: {
        trades: weekTrades.length,
        winRate: calcWinRate(weekTrades),
        pnl: calcPnl(weekTrades),
        wins: weekTrades.filter(t => t.win).length,
      },
      
      // ★ 月统计
      month: {
        trades: monthTrades.length,
        winRate: calcWinRate(monthTrades),
        pnl: calcPnl(monthTrades),
        wins: monthTrades.filter(t => t.win).length,
      },
    }
  }

  // ═════════════════════════════════════
  // 指标计算库
  // ═════════════════════════════════════

  function _sma(arr, period) {
    if (arr.length < period) return arr[arr.length - 1]
    const slice = arr.slice(-period)
    return slice.reduce((s, v) => s + v, 0) / period
  }

  function _ema(arr, period) {
    if (arr.length === 0) return 0
    const k = 2 / (period + 1)
    let ema = arr[0]
    for (let i = 1; i < arr.length; i++) {
      ema = arr[i] * k + ema * (1 - k)
    }
    return ema
  }

  function _atr(bars, period) {
    if (bars.length < 2) return 0
    const trs = []
    for (let i = 1; i < bars.length; i++) {
      const hl = bars[i].high - bars[i].low
      const hc = Math.abs(bars[i].high - bars[i - 1].close)
      const lc = Math.abs(bars[i].low - bars[i - 1].close)
      trs.push(Math.max(hl, hc, lc))
    }
    if (trs.length === 0) return 0
    const slice = trs.slice(-period)
    return slice.reduce((s, v) => s + v, 0) / slice.length
  }

  function _rsi(closes, period) {
    if (closes.length < period + 1) return 50
    let gains = 0, losses = 0
    const slice = closes.slice(-period - 1)
    for (let i = 1; i < slice.length; i++) {
      const d = slice[i] - slice[i - 1]
      if (d > 0) gains += d
      else losses -= d
    }
    const avgGain = gains / period
    const avgLoss = losses / period
    if (avgLoss === 0) return 100
    const rs = avgGain / avgLoss
    return 100 - 100 / (1 + rs)
  }

  function _macd(closes) {
    if (closes.length < 35) return null
    const ema12 = _ema(closes, 12)
    const ema26 = _ema(closes, 26)
    const dif = ema12 - ema26
    // 简化：用近9个 dif 的 ema 作为 dea
    // 实际需要滚动计算，这里用近似值
    const dea = dif * 0.9  // 近似
    const histogram = (dif - dea) * 2
    return { dif, dea, histogram }
  }

  function _kdj(highs, lows, closes, period) {
    if (closes.length < period) return null
    const hn = Math.max(...highs.slice(-period))
    const ln = Math.min(...lows.slice(-period))
    const c = closes[closes.length - 1]
    const rsv = hn === ln ? 50 : (c - ln) / (hn - ln) * 100
    const k = rsv * 0.333 + 50 * 0.667  // 近似，首次K=50
    const d = k * 0.333 + 50 * 0.667
    const j = 3 * k - 2 * d
    return { k, d, j, rsv }
  }

  function _boll(closes, period, stdMult) {
    if (closes.length < period) return null
    const slice = closes.slice(-period)
    const mid = slice.reduce((s, v) => s + v, 0) / period
    const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period
    const std = Math.sqrt(variance)
    return {
      upper: mid + std * stdMult,
      mid,
      lower: mid - std * stdMult,
      std,
    }
  }

  // ═════════════════════════════════════
  // 时间格式化
  // ═════════════════════════════════════
  function _fmtTimeFull(ts) {
    // ts 可能是秒或毫秒
    const ms = ts > 1e10 ? ts : ts * 1000
    const d = new Date(ms)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // ═════════════════════════════════════
  // 公开 API
  // ═════════════════════════════════════
  return {
    reset,
    runBacktest,
    getAccount: () => _account,
    getStats: () => _account.stats,
    getTrades: () => _account.trades,
    PARAMS,
    // ★ 新增导出和工具函数
    exportStats: () => {
      // 导出完整统计（含周月数据）
      _account.stats = _calcStats()
      return {
        overall: _account.stats,
        trades: _account.trades,
        account: {
          balance: _account.balance,
          peakBalance: _account.peakBalance,
          maxDrawdown: _account.maxDrawdown,
        },
        timestamp: new Date().toISOString(),
      }
    },
    clearHistory: () => {
      // 清除所有交易历史
      _account.trades = []
      _account.stats = null
      try { localStorage.removeItem('_simTraderState') } catch (e) {}
    },
    exportToCSV: () => {
      // 导出为CSV（便于Excel分析）
      if (_account.trades.length === 0) return 'No trades'
      const headers = ['ID', '方向', '入场时间', '入场价', '出场价', '止损', '盈亏', '手续费', '盈利']
      const rows = _account.trades.map(t => [
        t.id,
        t.direction,
        t.entryTime || '',
        t.entryPrice?.toFixed(2) || '',
        t.exitPrice?.toFixed(2) || '',
        t.sl?.toFixed(2) || '',
        t.pnl?.toFixed(4) || '',
        t.fee?.toFixed(4) || '',
        t.win ? '✓' : '✗'
      ])
      return [headers, ...rows].map(r => r.join(',')).join('\n')
    }
  }

})()

window.SimTrader = SimTrader
