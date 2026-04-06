// pages/index/index.js v5.0 - 专业交易系统
const { detectSignal, clearSignalCache } = require('../../utils/detector')
const CONFIG = require('../../config')

// 周期配置 - 专注于核心周期
const PERIODS = [
  { iv: '15m', label: '15m · 精确执行', color: 'blue', active: true },
  { iv: '1h', label: '1h · 入场周期', color: 'green', active: false },
  { iv: '4h', label: '4h · 趋势确认', color: 'orange', active: false },
  { iv: '1d', label: '1d · 大趋势', color: 'purple', active: false }
]

// 信号强度描述
const SIGNAL_STRENGTH_DESC = {
  5: { label: '极强信号', color: '#10b981', icon: '🔥', desc: '三周期共振，概率极高' },
  4: { label: '强信号', color: '#3b82f6', icon: '⚡', desc: '双周期共振，值得参与' },
  3: { label: '中等信号', color: '#f59e0b', icon: '⭐', desc: '趋势明确，可轻仓' },
  2: { label: '弱信号', color: '#ef4444', icon: '⚠️', desc: '形态为主，谨慎参与' },
  1: { label: '观望信号', color: '#6b7280', icon: '👀', desc: '条件不足，继续观察' }
}

// 趋势描述
const TREND_DESC = {
  strong_bull: { label: '强势多头', color: '#10b981', icon: '🚀' },
  bull: { label: '多头', color: '#22c55e', icon: '📈' },
  neutral: { label: '震荡', color: '#6b7280', icon: '↔️' },
  bear: { label: '空头', color: '#ef4444', icon: '📉' },
  strong_bear: { label: '强势空头', color: '#dc2626', icon: '💥' }
}

// 共振条件描述
const RESONANCE_DESC = {
  trend_aligned: { label: '趋势共振', icon: '🎯', desc: '多周期趋势方向一致' },
  rsi_extreme: { label: 'RSI共振', icon: '📊', desc: '多周期RSI超买超卖' },
  macd_aligned: { label: 'MACD共振', icon: '📈', desc: '多周期MACD方向一致' },
  volume_confirmed: { label: '放量确认', icon: '📢', desc: '成交量显著放大' }
}

Page({
  data: {
    // 基础信息
    interval: '15m',
    intervalLabel: '15m · 精确执行',
    periods: PERIODS,
    
    // 价格信息
    curPrice: '--',
    priceChange: '--',
    priceDir: '',
    price24hChange: '--',
    volume24h: '--',
    
    // 信号核心
    hasSignal: false,
    signalType: '', // long / short
    signalStrength: 0,
    starRating: '',
    signalDesc: '',
    
    // 趋势分析
    trend: 'neutral',
    trendLabel: '分析中',
    trendColor: '#6b7280',
    trendIcon: '↔️',
    ma20: '--',
    ma60: '--',
    maPosition: '--', // 价格相对于MA位置
    
    // 多周期共振分析
    resonance: {
      trend_aligned: false,
      rsi_extreme: false,
      macd_aligned: false,
      volume_confirmed: false
    },
    currentRSI: '--',
    higherRSI: '--',
    volumeRatio: '--',
    
    // 条件详情
    conditions: [],
    conditionsMet: 0,
    conditionsTotal: 0,
    
    // 交易计划
    entryZone: ['--', '--'],
    stopLoss: '--',
    takeProfits: ['--', '--', '--'],
    atrValue: '--',
    atrPercent: '--',
    
    // 仓位建议
    positionAdvice: {
      starRating: '☆☆☆☆☆',
      positionRatio: '--',
      suggestedContracts: '--',
      positionValue: '--',
      riskPerTrade: '--',
      stopDistance: '--'
    },
    
    // 技术指标矩阵
    indicators: [
      { name: 'MACD', value: '--', status: 'neutral', hint: '趋势动量' },
      { name: 'RSI', value: '--', status: 'neutral', hint: '超买超卖' },
      { name: 'KDJ', value: '--', status: 'neutral', hint: '随机指标' },
      { name: 'WR', value: '--', status: 'neutral', hint: '威廉指标' },
      { name: 'BOLL', value: '--', status: 'neutral', hint: '布林带位置' },
      { name: 'ATR', value: '--', status: 'neutral', hint: '波动率' }
    ],
    
    // 状态
    loading: false,
    errorMsg: '',
    updateTime: '--',
    lastUpdate: '--',
    
    // UI控制
    showDetails: false,
    showSettings: false,
    showHistory: false,
    
    // 历史信号
    historySignals: []
  },

  onLoad() {
    console.log('[系统] 专业交易系统 v5.0 启动')
    this.initData()
    this.startAutoRefresh()
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
  },

  // 初始化数据
  initData() {
    this.setData({
      loading: true,
      errorMsg: ''
    })
    this.fetchSignal()
  },

  // 获取信号数据
  async fetchSignal() {
    try {
      this.setData({ loading: true, errorMsg: '' })
      
      const result = await detectSignal(this.data.interval)
      console.log('[信号]', result)
      
      // 处理信号结果
      this.processSignalResult(result)
      
    } catch (error) {
      console.error('[错误]', error)
      this.setData({
        errorMsg: error.message || '数据获取失败',
        loading: false
      })
    }
  },

  // 处理信号结果
  processSignalResult(result) {
    const now = new Date()
    const updateTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    
    // 基础数据
    const baseData = {
      loading: false,
      updateTime,
      lastUpdate: updateTime,
      curPrice: result.lastBar ? result.lastBar.close.toFixed(2) : '--',
      priceChange: '--', // 简化，实际需要计算
      priceDir: 'neutral'
    }
    
    // 趋势分析
    const trendData = this.processTrend(result)
    
    // 信号分析
    const signalData = this.processSignal(result)
    
    // 共振分析
    const resonanceData = this.processResonance(result)
    
    // 条件分析
    const conditionData = this.processConditions(result)
    
    // 交易计划
    const tradeData = this.processTradeLevels(result)
    
    // 仓位建议
    const positionData = this.processPositionAdvice(result)
    
    // 技术指标
    const indicatorData = this.processIndicators(result)
    
    // 合并所有数据
    this.setData({
      ...baseData,
      ...trendData,
      ...signalData,
      ...resonanceData,
      ...conditionData,
      ...tradeData,
      ...positionData,
      ...indicatorData
    })
  },

  // 处理趋势数据
  processTrend(result) {
    if (!result.trend) {
      return {
        trend: 'neutral',
        trendLabel: '分析中',
        trendColor: '#6b7280',
        trendIcon: '↔️',
        ma20: '--',
        ma60: '--',
        maPosition: '--'
      }
    }
    
    const trendInfo = TREND_DESC[result.trend] || TREND_DESC.neutral
    const maPosition = result.price && result.ma20 ? 
      ((result.price - result.ma20) / result.ma20 * 100).toFixed(2) + '%' : '--'
    
    return {
      trend: result.trend,
      trendLabel: trendInfo.label,
      trendColor: trendInfo.color,
      trendIcon: trendInfo.icon,
      ma20: result.ma20 ? result.ma20.toFixed(2) : '--',
      ma60: result.ma60 ? result.ma60.toFixed(2) : '--',
      maPosition
    }
  },

  // 处理信号数据
  processSignal(result) {
    if (!result.type) {
      return {
        hasSignal: false,
        signalType: '',
        signalStrength: 0,
        starRating: '☆☆☆☆☆',
        signalDesc: '等待信号...'
      }
    }
    
    const strength = result.signalStrength || 1
    const strengthInfo = SIGNAL_STRENGTH_DESC[strength] || SIGNAL_STRENGTH_DESC[1]
    const direction = result.type === 'long' ? '做多' : '做空'
    
    return {
      hasSignal: true,
      signalType: result.type,
      signalStrength: strength,
      starRating: result.starRating || '⭐'.repeat(strength) + '☆'.repeat(5 - strength),
      signalDesc: `${direction} · ${strengthInfo.label}`
    }
  },

  // 处理共振分析
  processResonance(result) {
    const resonance = result.resonance || {}
    const currentRSI = result.currentRSI ? result.currentRSI.toFixed(1) : '--'
    const higherRSI = result.higherRSI ? result.higherRSI.toFixed(1) : '--'
    const volumeRatio = result.volumeRatio ? result.volumeRatio.toFixed(2) + 'x' : '--'
    
    return {
      resonance,
      currentRSI,
      higherRSI,
      volumeRatio
    }
  },

  // 处理条件分析
  processConditions(result) {
    let conditions = []
    let conditionsMet = 0
    
    if (result.type === 'long' && result.longConditions) {
      conditions = result.longConditions
      conditionsMet = conditions.filter(c => c.ok).length
    } else if (result.type === 'short' && result.shortConditions) {
      conditions = result.shortConditions
      conditionsMet = conditions.filter(c => c.ok).length
    }
    
    return {
      conditions,
      conditionsMet,
      conditionsTotal: conditions.length || 0
    }
  },

  // 处理交易级别
  processTradeLevels(result) {
    if (!result.tradeLevels) {
      return {
        entryZone: ['--', '--'],
        stopLoss: '--',
        takeProfits: ['--', '--', '--'],
        atrValue: '--',
        atrPercent: '--'
      }
    }
    
    const tl = result.tradeLevels
    return {
      entryZone: tl.entryZone || ['--', '--'],
      stopLoss: tl.stopLoss || '--',
      takeProfits: tl.takeProfits || ['--', '--', '--'],
      atrValue: tl.atr || '--',
      atrPercent: tl.atrPercent ? tl.atrPercent + '%' : '--'
    }
  },

  // 处理仓位建议
  processPositionAdvice(result) {
    if (!result.positionAdvice) {
      return {
        positionAdvice: {
          starRating: '☆☆☆☆☆',
          positionRatio: '--',
          suggestedContracts: '--',
          positionValue: '--',
          riskPerTrade: '--',
          stopDistance: '--'
        }
      }
    }
    
    return {
      positionAdvice: result.positionAdvice
    }
  },

  // 处理技术指标
  processIndicators(result) {
    const indicators = [
      { name: 'MACD', value: '--', status: 'neutral', hint: '趋势动量' },
      { name: 'RSI', value: '--', status: 'neutral', hint: '超买超卖' },
      { name: 'KDJ', value: '--', status: 'neutral', hint: '随机指标' },
      { name: 'WR', value: '--', status: 'neutral', hint: '威廉指标' },
      { name: 'BOLL', value: '--', status: 'neutral', hint: '布林带位置' },
      { name: 'ATR', value: '--', status: 'neutral', hint: '波动率' }
    ]
    
    // MACD
    if (result.macdBar !== undefined) {
      const macdValue = result.macdBar.toFixed(2)
      const macdStatus = result.macdBar > 0 ? 'bullish' : result.macdBar < 0 ? 'bearish' : 'neutral'
      indicators[0] = { ...indicators[0], value: macdValue, status: macdStatus }
    }
    
    // RSI
    if (result.rsiVal !== undefined) {
      const rsiValue = result.rsiVal.toFixed(1)
      let rsiStatus = 'neutral'
      if (rsiValue < 30) rsiStatus = 'oversold'
      else if (rsiValue > 70) rsiStatus = 'overbought'
      indicators[1] = { ...indicators[1], value: rsiValue, status: rsiStatus }
    }
    
    // KDJ
    if (result.jVal !== undefined) {
      const kdjValue = result.jVal.toFixed(1)
      let kdjStatus = 'neutral'
      if (result.jVal < 20) kdjStatus = 'oversold'
      else if (result.jVal > 80) kdjStatus = 'overbought'
      indicators[2] = { ...indicators[2], value: kdjValue, status: kdjStatus }
    }
    
    // WR
    if (result.wrVal !== undefined) {
      const wrValue = result.wrVal.toFixed(1)
      let wrStatus = 'neutral'
      if (result.wrVal < -80) wrStatus = 'oversold'
      else if (result.wrVal > -20) wrStatus = 'overbought'
      indicators[3] = { ...indicators[3], value: wrValue, status: wrStatus }
    }
    
    // BOLL
    if (result.bollLast && result.lastBar) {
      const price = result.lastBar.close
      const { upper, lower } = result.bollLast
      const bollPercent = ((price - lower) / (upper - lower) * 100).toFixed(1)
      let bollStatus = 'neutral'
      if (bollPercent < 20) bollStatus = 'oversold'
      else if (bollPercent > 80) bollStatus = 'overbought'
      indicators[4] = { ...indicators[4], value: bollPercent + '%', status: bollStatus }
    }
    
    // ATR
    if (result.tradeLevels && result.tradeLevels.atrPercent) {
      const atrPercent = result.tradeLevels.atrPercent
      let atrStatus = 'neutral'
      if (atrPercent < 1) atrStatus = 'low'
      else if (atrPercent > 3) atrStatus = 'high'
      indicators[5] = { ...indicators[5], value: atrPercent + '%', status: atrStatus }
    }
    
    return { indicators }
  },

  // 切换周期
  switchPeriod(e) {
    const interval = e.currentTarget.dataset.interval
    if (!interval || interval === this.data.interval) return
    
    // 更新周期选择
    const periods = this.data.periods.map(p => ({
      ...p,
      active: p.iv === interval
    }))
    
    const periodLabel = periods.find(p => p.iv === interval)?.label || interval
    
    this.setData({
      interval,
      intervalLabel: periodLabel,
      periods,
      loading: true
    })
    
    // 清除缓存并重新获取
    clearSignalCache(interval)
    this.fetchSignal()
  },

  // 手动刷新
  onRefresh() {
    clearSignalCache(this.data.interval)
    this.fetchSignal()
  },

  // 自动刷新
  startAutoRefresh() {
    // 每30秒自动刷新一次
    this._timer = setInterval(() => {
      if (!this.data.loading) {
        this.fetchSignal()
      }
    }, 30000)
  },

  // 切换详情显示
  toggleDetails() {
    this.setData({
      showDetails: !this.data.showDetails
    })
  },

  // 切换设置
  toggleSettings() {
    this.setData({
      showSettings: !this.data.showSettings
    })
  },

  // 添加历史信号（模拟）
  addToHistory(signal) {
    const history = this.data.historySignals
    const newSignal = {
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      type: signal.type === 'long' ? '做多' : '做空',
      strength: signal.signalStrength,
      entry: signal.entryZone ? signal.entryZone[0] : '--',
      result: '等待中'
    }
    
    history.unshift(newSignal)
    if (history.length > 10) history.pop()
    
    this.setData({ historySignals: history })
  },

  // 页面事件处理
  onShareAppMessage() {
    return {
      title: 'BTC三步法专业交易系统',
      path: '/pages/index/index'
    }
  }
})