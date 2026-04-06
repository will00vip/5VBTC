// UI交互逻辑 - 专业交易系统

// ★ Capacitor 插件初始化
const HapticFeedback = window.Capacitor?.Plugins?.HapticFeedback
const SMS = window.Capacitor?.Plugins?.SMS

// ★ 短信配置（用户手机号）
const SMS_CONFIG = {
  phoneNumber: '18684642535',  // 接收短信的手机号
  enabled: true,               // 是否启用SMS推送
}

// 震动方案（强度递进）
const VIBRATION_PATTERNS = {
  SIGNAL_ALERT: [100],           // 单次强震（信号触发）
  DOUBLE_ALERT: [100, 50, 100],  // 双次震（警告）
  TRIPLE_ALERT: [50, 50, 50, 50, 50]  // 五连击（紧急）
}

// ★ 通用震动函数
async function triggerVibration(pattern = 'SIGNAL_ALERT', intensity = 'Medium') {
  try {
    const isCapacitor = !!window.Capacitor
    const isWeb = !isCapacitor
    
    if (isCapacitor && HapticFeedback) {
      // ✅ 真机（Android/iOS）- Capacitor原生API
      await HapticFeedback.perform({
        style: intensity  // Light / Medium / Heavy
      })
      
      // 如果是自定义模式，再额外震动
      const customPattern = VIBRATION_PATTERNS[pattern]
      if (customPattern && customPattern.length > 1) {
        for (let duration of customPattern) {
          await HapticFeedback.perform({ style: 'Medium' })
          await new Promise(r => setTimeout(r, duration))
        }
      }
    } else if (isWeb && navigator.vibrate) {
      // 🌐 Web浏览器fallback - 标准 Vibration API
      const pattern = VIBRATION_PATTERNS[pattern] || [100]
      navigator.vibrate(pattern)
    }
    
    console.log('[Vibration] 震动已触发:', pattern)
  } catch (e) {
    console.warn('[Vibration] 震动失败:', e.message)
  }
}

// ★ 增强推送系统（分级推送 + 频率控制）
class EnhancedPushSystem {
  constructor() {
    // 推送渠道配置
    this.pushChannels = {
      '紧急': ['sms', 'toast'],      // 85分以上：SMS + Toast
      '重要': ['toast', 'notification'], // 70-84分：Toast + 通知
      '普通': ['toast']              // 50-69分：Toast
    }
    
    // 推送历史记录（用于频率控制）
    this.pushHistory = []
    
    // 推送频率控制（分钟）
    this.pushCooldown = {
      '紧急': 30,  // 30分钟内最多1次
      '重要': 15,  // 15分钟内最多1次
      '普通': 5    // 5分钟内最多1次
    }
  }
  
  // 检查是否可以推送 - 增强版（防止冲突信号）
  canPush(priority, signalType, score) {
    const now = Date.now()
    const cooldown = this.pushCooldown[priority] * 60 * 1000
    const absScore = Math.abs(score)
    
    // 1. 检查相同优先级和类型的最近推送
    const recentSameType = this.pushHistory.filter(push => 
      now - push.time < cooldown && 
      push.priority === priority &&
      push.signalType === signalType
    )
    if (recentSameType.length > 0) {
      console.log(`[推送] 频率控制：跳过 ${priority} ${signalType} 信号（相同类型冷却中）`)
      return false
    }
    
    // 2. 检查冲突信号（高分做多和做空不应同时推送）
    // 如果当前信号是高分信号（>=70），检查是否有相反类型的高分信号在最近时间内
    if (priority === '重要' || priority === '紧急') {
      const oppositeType = signalType === 'long' ? 'short' : 'long'
      const recentOppositeHighScore = this.pushHistory.filter(push => 
        now - push.time < 30 * 60 * 1000 &&  // 30分钟内
        (push.priority === '重要' || push.priority === '紧急') &&
        push.signalType === oppositeType &&
        Math.abs(push.score) >= 70  // 只检查高分信号
      )
      
      if (recentOppositeHighScore.length > 0) {
        console.log(`[推送] 冲突信号控制：跳过 ${priority} ${signalType} 信号（已有高分${oppositeType}信号在30分钟内）`)
        return false
      }
    }
    
    // 3. 额外逻辑：75分以上做多信号应该优先，避免被做空信号干扰
    // 如果有75分以上做多信号在最近15分钟内，不推送任何做空信号
    if (signalType === 'short') {
      const recentHighLong = this.pushHistory.filter(push => 
        now - push.time < 15 * 60 * 1000 &&  // 15分钟内
        push.signalType === 'long' &&
        push.score >= 75
      )
      
      if (recentHighLong.length > 0) {
        console.log(`[推送] 高分做多优先：跳过做空信号（有${recentHighLong[0].score}分做多信号在15分钟内）`)
        return false
      }
    }
    
    return true
  }
  
  // 记录推送历史
  recordPush(priority, signalType, score) {
    this.pushHistory.push({
      time: Date.now(),
      priority: priority,
      signalType: signalType,
      score: score
    })
    
    // 清理过期记录（保留24小时）
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    this.pushHistory = this.pushHistory.filter(push => push.time > dayAgo)
  }
  
  // 推送信号
  async pushSignal(result, directionText, score, price) {
    // 确定推送优先级
    let priority = '普通'
    const absScore = Math.abs(score)
    if (absScore >= 85) priority = '紧急'
    else if (absScore >= 70) priority = '重要'
    else if (absScore >= 60) priority = '普通'
    
    // 检查频率控制
    let signalType = result.type
    // 无信号时，根据趋势设置signalType
    if (!signalType) {
      if (result.trend === 'strong_bull' || result.trend === 'bull') {
        signalType = 'bull_trend'
      } else if (result.trend === 'strong_bear' || result.trend === 'bear') {
        signalType = 'bear_trend'
      } else {
        signalType = 'neutral_trend'
      }
    }
    if (!this.canPush(priority, signalType, score)) {
      console.log(`[推送] 频率控制：跳过 ${priority} ${signalType} 信号`)
      return
    }
    
    // 获取推送渠道
    const channels = this.pushChannels[priority]
    
    // 执行推送
    for (const channel of channels) {
      switch (channel) {
        case 'sms':
          await this.sendSMS(result, directionText, score, price, priority)
          break
        case 'toast':
          this.showToast(result, directionText, score, price, priority)
          break
        case 'notification':
          this.showNotification(result, directionText, score, price, priority)
          break
      }
    }
    
    // 记录推送历史
    this.recordPush(priority, signalType, score)
  }
  
  // SMS推送
  async sendSMS(result, directionText, score, price, priority) {
    if (!SMS_CONFIG.enabled || !SMS) {
      console.log('[SMS] 短信功能未启用或不支持')
      return
    }
    
    try {
      const entry = (result.tradeLevels?.entryLevel || price)?.toFixed?.(2) || '--'
      const sl = (result.tradeLevels?.stopLoss || '--')?.toFixed?.(2) || '--'
      const tp1 = (result.tradeLevels?.takeProfits?.[0] || '--')?.toFixed?.(2) || '--'
      const tp2 = (result.tradeLevels?.takeProfits?.[1] || '--')?.toFixed?.(2) || '--'
      
      // 短信内容（包含优先级）
      const smsMessage = `[${priority}]${directionText}${score}分
价格:${price?.toFixed?.(2) || '--'}
入场:${entry}
止损:${sl}
TP:${tp1}/${tp2}`

      await SMS.send({
        numbers: [SMS_CONFIG.phoneNumber],
        message: smsMessage,
      })

      console.log(`[SMS] ${priority}推送已发送:`, smsMessage)
    } catch (e) {
      console.warn('[SMS] 短信发送失败:', e.message)
    }
  }
  
  // Toast推送 - 增强版（点击查看详情，手动关闭）
  showToast(result, directionText, score, price, priority) {
    try {
      // 获取更多详细信息
      const entry = (result.tradeLevels?.entryLevel || price)?.toFixed?.(2) || '--'
      const sl = (result.tradeLevels?.stopLoss || '--')?.toFixed?.(2) || '--'
      const tp1 = (result.tradeLevels?.takeProfits?.[0] || '--')?.toFixed?.(2) || '--'
      const tp2 = (result.tradeLevels?.takeProfits?.[1] || '--')?.toFixed?.(2) || '--'
      
      // 创建Toast元素
      const toast = document.createElement('div')
      toast.className = `push-toast ${priority}`
      toast.innerHTML = `
        <div class="toast-header">
          <span class="priority-tag">${priority}</span>
          <span class="signal-type">${directionText}</span>
          <button class="toast-close">×</button>
        </div>
        <div class="toast-body">
          <div class="toast-detail-row">
            <span class="detail-label">价格:</span>
            <span class="detail-value">${price?.toFixed?.(2) || '--'}</span>
          </div>
          <div class="toast-detail-row">
            <span class="detail-label">入场:</span>
            <span class="detail-value">${entry}</span>
          </div>
          <div class="toast-detail-row">
            <span class="detail-label">止损:</span>
            <span class="detail-value stop-loss-value">${sl}</span>
          </div>
          <div class="toast-detail-row">
            <span class="detail-label">止盈1:</span>
            <span class="detail-value take-profit-value">${tp1}</span>
          </div>
          <div class="toast-detail-row">
            <span class="detail-label">止盈2:</span>
            <span class="detail-value take-profit-value">${tp2}</span>
          </div>
          <div class="toast-detail-row">
            <span class="detail-label">信号强度:</span>
            <span class="detail-value">${result.starDisplay || '无信号'}</span>
          </div>
        </div>
        <div class="toast-actions">
          <button class="toast-action-btn" onclick="window.location.href='#chart'">查看图表</button>
          <button class="toast-action-btn" onclick="window.location.href='#trade'">交易面板</button>
        </div>
      `
      
      // 添加到页面
      document.body.appendChild(toast)
      
      // 添加关闭按钮事件
      const closeBtn = toast.querySelector('.toast-close')
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          toast.style.opacity = '0'
          toast.style.transform = 'translateX(100px)'
          setTimeout(() => toast.remove(), 300)
        })
      }
      
      // 只有普通优先级在8秒后自动淡出，重要和紧急需要手动关闭
      if (priority === '普通') {
        setTimeout(() => {
          if (toast.parentNode) {
            toast.style.opacity = '0'
            toast.style.transform = 'translateX(100px)'
            setTimeout(() => {
              if (toast.parentNode) toast.remove()
            }, 300)
          }
        }, 8000)
      }
      
      console.log(`[Toast] ${priority}推送已显示（增强版）`)
    } catch (e) {
      console.warn('[Toast] 显示失败:', e.message)
    }
  }
  
  // 通知推送（预留）
  showNotification(result, directionText, score, price, priority) {
    console.log(`[通知] ${priority}推送: ${directionText} ${score}分`)
    // TODO: 集成App通知系统
  }
}

// 创建推送系统实例
const pushSystem = new EnhancedPushSystem()



document.addEventListener('DOMContentLoaded', function() {
  // 初始化系统
  initSystem()
  
  // 检查是否已同意免责声明
  if (!localStorage.getItem('disclaimerAgreed')) {
    document.getElementById('disclaimerModal').style.display = 'flex'
  } else {
    // 已同意直接启动
    startApp()
  }
  
  // 绑定事件
  bindEvents()
  
  // 启动自动刷新
  startAutoRefresh()
})

// 系统初始化
function initSystem() {
  console.log('BTC三步法专业交易系统 v7.1 启动 - LightweightCharts K线引擎')
  
  // 设置默认周期
  currentInterval = '15m'
  
  // 隐藏加载状态
  setTimeout(() => {
    const loading = document.getElementById('loadingSection')
    if (loading) loading.style.display = 'none'
  }, 1000)
}

// 启动应用（同意免责声明后调用）
function startApp() {
  console.log('[App] 启动应用 - 开始数据预热')

  // 显示加载状态
  const loadingEl = document.getElementById('loadingSection')
  if (loadingEl) loadingEl.style.display = 'block'

  // 初始化后台监控状态
  initMonitorStatus()

  // 初始化猫咪表情
  initCatMood()

  // 并发预热：1) 信号数据 2) 基础价格数据 3) K线数据
  Promise.all([
    fetchSignalData(),
    _warmupBasicData(),
    _initChartWhenReady()
  ]).then(() => {
    // 所有数据预热完成
    if (loadingEl) loadingEl.style.display = 'none'
    console.log('[App] 数据预热完成，系统就绪 ✅')
    
    // 启动WebSocket实时推送
    initWebSocketRealtime()
  }).catch(err => {
    console.warn('[App] 预热异常:', err)
    // 继续运行，不阻塞
  })
}

// ══════════════════════════════════════════
// WebSocket实时更新
// ══════════════════════════════════════════

let _wsChart = null  // 图表更新定时器
let _wsLastBar = null  // 最新K线数据
let _wsLastKlineTime = 0  // 上次K线时间戳

function initWebSocketRealtime() {
  console.log('[WebSocket] 启动实时K线推送...')
  
  // 设置K线数据回调
  window.onWebSocketKline = function(bar) {
    _wsLastBar = bar
    
    // 实时更新价格显示
    _updatePriceRealtime(bar)
    
    // K线变化时重置猫咪等待时间
    if (bar.time !== _wsLastKlineTime) {
      _wsLastKlineTime = bar.time
      // K线变化了，可能有新信号，重置等待计时器
      resetCatWaitTimer()
    }
  }
  
  // 启动WebSocket连接
  if (typeof startWebSocket === 'function') {
    startWebSocket()
  }
  
  // 每秒更新图表（节流）
  _wsChart = setInterval(() => {
    if (_wsLastBar && window.updateChartBar) {
      window.updateChartBar(_wsLastBar)
    }
  }, 1000)
}

// 实时更新价格
function _updatePriceRealtime(bar) {
  const priceEl = document.getElementById('curPrice')
  if (priceEl) {
    priceEl.textContent = '₿ ' + bar.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  
  const highLowEl = document.getElementById('highLowPrice')
  if (highLowEl) {
    highLowEl.textContent = '高 ' + bar.high.toLocaleString() + ' | 低 ' + bar.low.toLocaleString()
  }
}

// 停止WebSocket
function stopWebSocketRealtime() {
  if (_wsChart) {
    clearInterval(_wsChart)
    _wsChart = null
  }
  
  if (typeof stopWebSocket === 'function') {
    stopWebSocket()
  }
  
  window.onWebSocketKline = null
}

// 基础数据预热（价格 + 指标 + 24H数据）
async function _warmupBasicData() {
  try {
    const result = await window.app?.analyzeBTC?.(currentInterval)
    if (result) {
      updateIndicators(result)
      // 判断是否有插针信号
      const hasSignal = result.signalConfidence && result.signalConfidence !== 0
      updateScoreDial(result.score || 0, hasSignal, result.trend)
      console.log('[Data] 指标数据预热完成', hasSignal ? '有信号' : '无信号')
    }
    
    // 获取24H数据
    await fetch24HData()
  } catch(e) {
    console.warn('[Data] 预热失败，等待实时更新:', e.message)
  }
}

// 获取24H价格变化和成交量
async function fetch24HData() {
  const changeEl = document.getElementById('price24hChange')
  const volumeEl = document.getElementById('volume24h')
  
  try {
    // 尝试火币API
    const url = 'https://api.huobi.pro/market/detail/merged?symbol=btcusdt'
    const resp = await fetch(url)
    if (!resp.ok) throw new Error('火币API失败')
    
    const data = await resp.json()
    if (data.status === 'ok' && data.tick) {
      const tick = data.tick
      const open = tick.open
      const close = tick.close
      
      // 计算24H涨跌
      const changePct = ((close - open) / open * 100)
      
      if (changeEl) {
        changeEl.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%'
        changeEl.className = 'meta-value ' + (changePct >= 0 ? 'positive' : 'negative')
      }
      
      if (volumeEl) {
        const vol = tick.vol // 成交量(BTC)
        const quoteVol = tick.amount // 成交额(USDT)
        if (quoteVol >= 1e9) {
          volumeEl.textContent = (quoteVol / 1e9).toFixed(2) + 'B'
        } else if (quoteVol >= 1e6) {
          volumeEl.textContent = (quoteVol / 1e6).toFixed(2) + 'M'
        } else if (quoteVol >= 1e3) {
          volumeEl.textContent = (quoteVol / 1e3).toFixed(2) + 'K'
        } else {
          volumeEl.textContent = quoteVol.toFixed(2)
        }
      }
      
      console.log('[Data] 24H数据获取成功')
      return
    }
  } catch(e) {
    console.warn('[Data] 火币API失败:', e.message)
  }
  
  // 降级：尝试BinanceVision
  try {
    const url = 'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT'
    const resp = await fetch(url)
    if (!resp.ok) throw new Error('Binance API失败')
    
    const data = await resp.json()
    
    if (changeEl) {
      const pct = parseFloat(data.priceChangePercent)
      changeEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
      changeEl.className = 'meta-value ' + (pct >= 0 ? 'positive' : 'negative')
    }
    
    if (volumeEl) {
      const vol = parseFloat(data.quoteVolume)
      if (vol >= 1e9) {
        volumeEl.textContent = (vol / 1e9).toFixed(2) + 'B'
      } else if (vol >= 1e6) {
        volumeEl.textContent = (vol / 1e6).toFixed(2) + 'M'
      } else {
        volumeEl.textContent = (vol / 1e3).toFixed(2) + 'K'
      }
    }
    
    console.log('[Data] 24H数据(Binance)获取成功')
  } catch(e) {
    console.warn('[Data] 24H数据获取失败:', e.message)
    if (changeEl) changeEl.textContent = '--'
    if (volumeEl) volumeEl.textContent = '--'
  }
}

// 等 lwChartContainer 容器真正有宽度后再初始化图表
function _initChartWhenReady(retryCount) {
  retryCount = retryCount || 0
  const el = document.getElementById('lwChartContainer')
  if (!el) { console.warn('[Chart] 找不到容器'); return }

  const w = el.getBoundingClientRect().width
  if (w > 0) {
    // 容器就绪，初始化
    _doInitChart()
  } else if (retryCount < 20) {
    // 容器还不可见，100ms后重试（最多重试20次=2秒）
    setTimeout(() => _initChartWhenReady(retryCount + 1), 100)
  } else {
    console.warn('[Chart] 容器持续不可见，强制初始化')
    _doInitChart()
  }
}

function _doInitChart() {
  if (!window.LWChart) {
    console.error('[Chart] LWChart 未加载，可能 canvas-chart.js 加载失败')
    _showChartError('图表库加载失败，请重启应用')
    return
  }
  try {
    window.LWChart.initLWChart('lwChartContainer')
    // 延迟一帧，等 app.js 的 fetchKlines 注册完毕
    setTimeout(() => {
      window.LWChart.loadChartData(currentInterval, 200).catch(e => {
        console.warn('[Chart] 数据加载失败:', e)
        _showChartError('数据加载失败: ' + e.message)
      })
    }, 100)
  } catch(e) {
    console.error('[Chart] 初始化异常:', e)
    _showChartError('图表初始化异常: ' + e.message)
  }
}

function _showChartError(msg) {
  const el = document.getElementById('lwChartContainer')
  if (el) {
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ef4444;font-size:13px;padding:20px;text-align:center;">⚠️ ${msg}</div>`
  }
}

// 绑定事件
function bindEvents() {
  // 免责声明同意按钮
  document.getElementById('agreeBtn').addEventListener('click', function() {
    localStorage.setItem('disclaimerAgreed', 'true')
    document.getElementById('disclaimerModal').style.display = 'none'
    startApp()
  })
  
  // 刷新按钮
  document.getElementById('refreshBtn').addEventListener('click', function() {
    // 清缓存强制刷新
    if (window.LWChart) window.LWChart.switchChartInterval(currentInterval)
    fetchSignalData()
  })
  if (document.getElementById('refreshBottomBtn'))
    document.getElementById('refreshBottomBtn').addEventListener('click', fetchSignalData)
  if (document.getElementById('refreshSignalBtn'))
    document.getElementById('refreshSignalBtn').addEventListener('click', fetchSignalData)
  
  // 周期切换（所有 .period-tab 按钮）
  function handlePeriodClick() {
    // 取消所有active
    document.querySelectorAll('.period-tab[data-interval]').forEach(t => t.classList.remove('active'))
    this.classList.add('active')
    currentInterval = this.dataset.interval

    // LWChart 切换周期（K线独立走，不等信号）
    if (window.LWChart) {
      window.LWChart.switchChartInterval(currentInterval).catch(e => console.warn('[Chart] 切换失败:', e))
    }
    // 信号重新计算
    fetchSignalData()
  }
  document.querySelectorAll('.period-tab[data-interval]').forEach(tab => {
    tab.addEventListener('click', handlePeriodClick)
  })

  // 更多周期折叠展开
  const moreBtn = document.getElementById('morePeriodsBtn')
  const morePanel = document.getElementById('morePeriodsPanel')
  if (moreBtn && morePanel) {
    moreBtn.addEventListener('click', function() {
      const show = morePanel.style.display === 'none'
      morePanel.style.display = show ? 'flex' : 'none'
      moreBtn.textContent = show ? '收起▴' : '更多▾'
    })
  }
  
  // 设置按钮
  if (document.getElementById('settingsBtn'))
    document.getElementById('settingsBtn').addEventListener('click', showSettings)
  if (document.getElementById('settingsBottomBtn'))
    document.getElementById('settingsBottomBtn').addEventListener('click', showSettings)
  
  // 详情按钮
  if (document.getElementById('detailsBtn'))
    document.getElementById('detailsBtn').addEventListener('click', toggleDetails)
  if (document.getElementById('viewAnalysisBtn'))
    document.getElementById('viewAnalysisBtn').addEventListener('click', toggleDetails)
  
  // 重试按钮
  if (document.getElementById('retryBtn'))
    document.getElementById('retryBtn').addEventListener('click', fetchSignalData)
}

// 获取信号数据（三步法版本）
async function fetchSignalData() {
  const loadingEl = document.getElementById('loadingSection')
  const errorEl   = document.getElementById('errorSection')
  try {
    if (loadingEl) loadingEl.style.display = 'block'
    if (errorEl)   errorEl.style.display   = 'none'

    // 优先使用三步法引擎
    if (!window.BTCSignal) throw new Error('BTCSignal 引擎未加载，请重启App')
    const detectFn = window.BTCSignal.detectSignal3Step || window.BTCSignal.detectSignal
    const result = await detectFn(currentInterval)

    processSignalResult(result)

  } catch (error) {
    console.error('数据获取失败:', error)
    showError('数据获取失败: ' + error.message)
  } finally {
    if (loadingEl) loadingEl.style.display = 'none'
  }
}

// 处理信号结果
function processSignalResult(result) {
  const now = new Date()
  const updateTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
  const el = document.getElementById('updateTime')
  if (el) el.textContent = updateTime

  if (result.error) { showError(result.error); return }

  // ── K线图：独立维护 ──
  if (window.CanvasChart && window.CanvasChart.getBars().length === 0 && window.fetchKlines) {
    window.LWChart.loadChartData(currentInterval, 200).catch(() => {})
  }

  // ── 价格显示 ──
  if (result.bars && result.bars.length > 0) {
    const bars = result.bars
    const cur = bars[bars.length - 1].close
    const prev = bars[bars.length - 2]?.close || cur
    const chg = ((cur - prev) / prev * 100)
    const priceEl = document.getElementById('curPrice')
    const changeEl = document.getElementById('priceChange')
    if (priceEl && !window.LWChart?.state?.ws) priceEl.textContent = cur.toFixed(2)
    if (changeEl && !window.LWChart?.state?.ws) {
      changeEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'
      changeEl.className = chg >= 0 ? 'price-change positive' : 'price-change negative'
    }
  }

  // ── 计算并更新综合评分 ──
  try {
    const score = calculateOverallScore(result)
    // 判断是否有插针信号（使用缓存）
    const cache = getValidSignalCache()
    const hasSignal = (result.signalConfidence && result.signalConfidence !== 0) || !!cache
    if (window.updateScoreDial) {
      window.updateScoreDial(score, hasSignal, result.trend)  // 有信号显示分数，无信号显示...
    }
  } catch(e) { console.warn('[score]', e) }

  // ── 更新猫咪表情状态 ──
  try { updateCatMood(result) } catch(e) { console.warn('[catMood]', e) }

  // ── 重要信息监控（插针、波动率等） ──
  try { updateImportantInfo(result) } catch(e) { console.warn('[importantInfo]', e) }

  // ── 三步法进度卡 ──
  try { updateThreeStepCard(result) } catch(e) { console.warn('[threeStep]', e) }

  // ── 趋势 / 信号 / 指标 ──
  try { updateTrendInfo(result) } catch(e) { console.warn('[trend]', e) }
  try { updateSignalInfo(result) } catch(e) { console.warn('[signal]', e) }
  try { updateIndicators(result) } catch(e) { console.warn('[indicators]', e.message, e.stack) }
  try { generateSignalAnalysis(result) } catch(e) { console.warn('[analysis]', e) }

  // ── 有真实信号时自动写入历史记录 ──
  const isRealSignal = result.type && (result.isLongPin || result.isShortPin)
  if (isRealSignal) {
    // 重置等待时间
    resetCatWaitTimer()
    
    try { autoSaveSignalRecord(result) } catch(e) { console.warn('[autoSave]', e) }
    
    // ★ 自动化交易系统：自动开单
    try {
      if (result.bars) {
        const price = result.bars[result.bars.length - 1].close
        const score = result.signalConfidence || 0
        const direction = result.type
        const isLong = direction === 'long'
        
        // 获取止损止盈
        const tl = result.tradeLevels || {}
        const sl = tl.stopLoss || (isLong ? price * 0.995 : price * 1.005)
        const tp1 = tl.takeProfit1 || (isLong ? price * 1.008 : price * 0.992)
        const tp2 = tl.takeProfit2 || (isLong ? price * 1.015 : price * 0.985)
        
        // 调用自动化交易系统
        if (typeof onSignalTrigger === 'function') {
          onSignalTrigger(result, price)
        }
        
        console.log('[AutoTrade] 信号触发:', direction, score, price)
      }
    } catch(e) { console.warn('[AutoTrade] 开仓失败:', e) }
    
    // ★ 模拟交易：自动开单
    try {
      if (window.Simulator && result.bars) {
        const price = result.bars[result.bars.length - 1].close
        const pos = window.Simulator.openPosition(result, price)
        if (pos) {
          console.log('[Sim] 自动开仓成功')
          updateSimulatorPanel()
        }
      }
    } catch(e) { console.warn('[Sim] 开仓失败:', e) }
  }

  // ── 显示信号质量标注（60-69分警示）──
  try {
    const conf = result.signalConfidence || 0
    const qualityEl = document.getElementById('signalQualityTag')
    const trendWarnEl = document.getElementById('trendWarningTag')
    if (qualityEl && result.type) {
      qualityEl.textContent = result.signalQuality || ''
      qualityEl.style.color = conf >= 85 ? '#ff6b35' : conf >= 70 ? '#22c55e' : '#f59e0b'
      qualityEl.style.display = 'block'
    } else if (qualityEl) {
      qualityEl.style.display = 'none'
    }
    if (trendWarnEl) {
      trendWarnEl.textContent = result.trendWarning || ''
      trendWarnEl.style.color = (result.trendWarning || '').includes('逆势') ? '#ef4444' : '#22c55e'
      trendWarnEl.style.display = result.trendWarning ? 'block' : 'none'
    }
  } catch(e) { console.warn('[qualityTag]', e) }

  // ── 简易回测统计（仅首次或每30次刷新执行一次，避免卡顿）──
  try {
    if (!window._backtestCount) window._backtestCount = 0
    window._backtestCount++
    if (result.bars && result.bars.length >= 80 && window._backtestCount % 30 === 1) {
      const bt = window.BTCSignal && window.BTCSignal.runBacktest
        ? window.BTCSignal.runBacktest(result.bars)
        : null
      if (bt && bt.totalSignals > 0) {
        window._lastBacktest = bt
        const btEl = document.getElementById('backtestSummary')
        if (btEl) {
          btEl.textContent = `历史回测: ${bt.totalSignals}笔信号 | 胜率${bt.winRate}% | 盈亏比${bt.profitFactor}`
          btEl.style.display = 'block'
        }
        console.log('[Backtest]', bt.note)
      }
    }
  } catch(e) { console.warn('[backtest]', e) }
}

// 信号缓存，用于同步推送和UI显示
let signalCache = null
const SIGNAL_CACHE_DURATION = 5 * 60 * 1000 // 5分钟缓存

// 更新信号缓存
function updateSignalCache(result) {
  if (result.signalConfidence && result.signalConfidence !== 0) {
    signalCache = {
      signalConfidence: result.signalConfidence,
      type: result.type,
      timestamp: Date.now()
    }
  }
}

// 检查信号缓存是否有效
function getValidSignalCache() {
  if (!signalCache) return null
  if (Date.now() - signalCache.timestamp > SIGNAL_CACHE_DURATION) {
    signalCache = null
    return null
  }
  return signalCache
}

// 计算综合评分 - V7最终版
// 核心逻辑：
// 1. 有插针信号 → 使用 signalConfidence（正数做多60-100，负数做空-100到-60）
// 2. 无插针信号 → 技术指标打基础分(0-50)，显示市场状态
function calculateOverallScore(result) {
  if (!result) return 25  // 无数据返回偏低分

  // 检查是否有有效的信号缓存
  const cache = getValidSignalCache()
  if (cache) {
    return Math.round(cache.signalConfidence)  // 使用缓存的信号分数
  }

  // ── 1. 有插针信号时：直接返回信号分数 ──
  if (result.signalConfidence && result.signalConfidence !== 0) {
    updateSignalCache(result)  // 更新信号缓存
    return Math.round(result.signalConfidence)  // 做多正数，做空负数
  }

  // ── 2. 无插针信号：用技术指标打基础分(0-50) ──
  let score = 25  // 基础分25

  // 趋势加分 (0-8分)
  if (result.trend) {
    if (result.trend.includes('上涨') || result.trend.includes('多头')) score += 8
    else if (result.trend.includes('下跌') || result.trend.includes('空头')) score -= 5
  }

  // RSI加分 (0-8分) - 超卖加分，超买减分
  if (result.rsiVal !== undefined) {
    const rsi = result.rsiVal
    if (rsi < 30) score += 8  // 严重超卖，有反弹可能
    else if (rsi < 40) score += 5
    else if (rsi < 50) score += 3
    else if (rsi > 70) score -= 5  // 严重超买
    else if (rsi > 60) score -= 3
    else if (rsi > 50) score += 1
  }

  // MACD加分 (0-7分)
  if (result.macdBar !== undefined) {
    if (result.macdBar > 0) score += 7
    else score -= 3
  }

  // KDJ加分 (0-7分) - 超卖加分
  if (result.jVal !== undefined) {
    const j = result.jVal
    if (j < 20) score += 7  // 严重超卖
    else if (j < 35) score += 5
    else if (j < 50) score += 2
    else if (j > 80) score -= 4  // 严重超买
    else if (j > 65) score -= 2
    else score += 0
  }

  // BOLL位置加分 (0-5分) - 接近下轨加分，上轨减分
  if (result.bollLast && result.lastBar) {
    const { upper, lower } = result.bollLast
    const price = result.lastBar.close
    const bollPercent = ((price - lower) / (upper - lower)) * 100
    if (bollPercent < 20) score += 5  // 接近下轨，极度超卖
    else if (bollPercent < 30) score += 4
    else if (bollPercent < 40) score += 2
    else if (bollPercent > 80) score -= 3  // 接近上轨
    else if (bollPercent > 70) score -= 2
    else score += 0
  }

  // 最终范围：0-50分（无插针时不会超过50）
  return Math.min(50, Math.max(0, Math.round(score)))
}



// 更新评分圆盘UI - V6最终版
// 规则：
// - 有插针信号：正数做多(60-100)绿 / 负数做空(-100到-60)红
// - 无插针信号：技术指标打分(0-50)，根据趋势显示正负
function updateScoreDial(score, hasSignal = false, trend = 'neutral') {
  const circle = document.getElementById('scoreCircle')
  const scoreText = document.getElementById('dialScore')
  
  if (!circle || !scoreText) return
  
  let displayScore = score
  let isLong = score > 0  // 正数做多，负数做空
  
  // 无插针信号时，根据趋势调整分数符号
  if (!hasSignal) {
    if (trend === 'strong_bull' || trend === 'bull') {
      displayScore = Math.abs(score) // 多头趋势显示正数
      isLong = true
    } else if (trend === 'strong_bear' || trend === 'bear') {
      displayScore = -Math.abs(score) // 空头趋势显示负数
      isLong = false
    }
  }
  
  const absScore = Math.abs(displayScore)
  
  // 计算圆环进度（0-100范围）
  const percentage = absScore / 100
  const circumference = 2 * Math.PI * 90
  const offset = circumference - percentage * circumference
  circle.style.strokeDashoffset = offset
  
  if (hasSignal) {
    // 有插针信号时：正负数+对应颜色
    if (isLong) {
      circle.style.stroke = '#10b981'  // 绿色做多
      scoreText.style.color = '#10b981'
      scoreText.textContent = '+' + score
    } else {
      circle.style.stroke = '#ef4444'  // 红色做空
      scoreText.style.color = '#ef4444'
      scoreText.textContent = score  // 负数如 -75
    }
    updateScoreBarIndicator(score, true, isLong ? 'long' : 'short')
  } else {
    // 无插针信号：技术指标打分(0-50)，根据趋势显示颜色
    if (isLong) {
      circle.style.stroke = '#10b981'  // 绿色做多
      scoreText.style.color = '#10b981'
      scoreText.textContent = '+' + Math.abs(displayScore)
    } else if (displayScore < 0) {
      circle.style.stroke = '#ef4444'  // 红色做空
      scoreText.style.color = '#ef4444'
      scoreText.textContent = displayScore
    } else {
      circle.style.stroke = '#3b82f6'  // 蓝色震荡
      scoreText.style.color = '#3b82f6'
      scoreText.textContent = displayScore
    }
    
    // 进度条颜色
    updateScoreBarIndicator(displayScore, false, isLong ? 'long' : displayScore < 0 ? 'short' : 'neutral')
  }
}

// 更新评分进度条指示器
function updateScoreBarIndicator(score, hasSignal = true, direction = 'neutral') {
  const pointer = document.getElementById('scoreBarPointer')
  const statusEl = document.getElementById('currentStatus')
  const statusText = document.getElementById('statusText')
  
  if (!pointer) return
  
  if (!hasSignal || score === 0) {
    // 无信号时：指针居中，灰色
    pointer.style.left = '50%'
    pointer.style.background = '#6b7280'
    
    if (statusEl && statusText) {
      statusEl.className = 'current-status'
      statusText.textContent = '等待信号...'
    }
    return
  }
  
  // score 可能是正数(做多)或负数(做空)
  const isLong = score > 0
  const absScore = Math.abs(score)
  
  // 指针位置：0在中间，50在右边缘，-50在左边缘
  // 正数(做多)：50 + absScore/2 → 50到100
  // 负数(做空)：50 - absScore/2 → 50到0
  let position = isLong ? 50 + (absScore / 2) : 50 - (absScore / 2)
  position = Math.max(0, Math.min(100, position))
  
  // 更新指针位置
  pointer.style.left = position + '%'
  
  // 更新指针颜色和状态文字
  if (isLong) {
    // 做多：绿色
    pointer.style.background = '#10b981'
    if (statusEl && statusText) {
      statusEl.className = 'current-status status-long'
      statusText.textContent = `做多信号 +${score} 🐂`
    }
  } else {
    // 做空：红色
    pointer.style.background = '#ef4444'
    if (statusEl && statusText) {
      statusEl.className = 'current-status status-short'
      statusText.textContent = `做空信号 ${score} 🐻`
    }
  }
}

// 导出到window供其他模块调用
window.updateScoreDial = updateScoreDial

// 三步法进度卡
function updateThreeStepCard(result) {
  const container = document.getElementById('threeStepCard')
  if (!container) return

  const steps = result.threeStepConditions || [
    { step: 1, label: '日线大趋势', ok: false, desc: result.dailyTrendLabel || '分析中' },
    { step: 2, label: '1h共振确认', ok: result.step2LongOk || result.step2ShortOk || false, desc: '分析中' },
    { step: 3, label: '5m精确触发', ok: result.isLongPin || result.isShortPin || false, desc: '分析中' }
  ]

  const metCount = steps.filter(s => s.ok).length
  const allMet = metCount === 3

  container.innerHTML = `
    <div class="three-step-header">
      <span class="three-step-title">⚡ 三步法决策</span>
      <span class="three-step-badge ${allMet ? 'badge-fire' : metCount >= 2 ? 'badge-warn' : 'badge-wait'}">
        ${allMet ? '🔥 信号触发' : metCount + '/3 满足'}
      </span>
    </div>
    <div class="three-step-list">
      ${steps.map(s => `
        <div class="step-item ${s.ok ? 'step-ok' : 'step-wait'}">
          <div class="step-icon">${s.ok ? '✅' : '⏳'}</div>
          <div class="step-body">
            <div class="step-label">步骤${s.step}·${s.label}</div>
            <div class="step-desc">${s.desc}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="three-step-progress">
      <div class="progress-bar">
        <div class="progress-fill ${allMet ? 'fill-green' : 'fill-orange'}" style="width:${metCount/3*100}%"></div>
      </div>
    </div>
  `
}

// 自动保存信号记录
function autoSaveSignalRecord(result) {
  try {
    const records = JSON.parse(localStorage.getItem('signal_records') || '[]')

    // 防重：3分钟内同方向不重复保存
    const lastSame = records.find(r => r.direction === result.type &&
      Date.now() - r.timestamp < 3 * 60 * 1000)
    if (lastSame) {
      // 防重不保存，但仍推送一次以醒目
      _pushNotification(result)
      return
    }

    const price = result.bars ? result.bars[result.bars.length - 1].close : 0
    const tl = result.tradeLevels || {}
    // 分数：signalConfidence (做多正数60-100，做空负数-100到-60)
    const score = result.signalConfidence || 0
    const record = {
      id: 'sig_' + Date.now(),
      timestamp: Date.now(),
      time: new Date().toLocaleString('zh-CN'),
      direction: result.type,          // 'long' / 'short'
      price: price,
      score: score,                    // 正数=做多，负数=做空
      stars: result.signalStrength || 0,
      sl: tl.stopLoss || 0,
      tp1: tl.takeProfits?.[0] || 0,
      tp2: tl.takeProfits?.[1] || 0,
      tp3: tl.takeProfits?.[2] || 0,
      result: 'pending',               // 'win' / 'loss' / 'pending'
      note: ''
    }

    records.unshift(record)
    // 只保留最近200条
    if (records.length > 200) records.splice(200)
    localStorage.setItem('signal_records', JSON.stringify(records))

    // 刷新历史页如果可见
    if (typeof renderHistoryPage === 'function') renderHistoryPage()

    // 同步到实时跟单账户（自动开仓）
    if (typeof _openRealSimPos === 'function') _openRealSimPos(result, price)

    // ★ 推送到手机
    _pushNotification(result)
  } catch (e) {
    console.error('保存信号记录失败:', e)
  }
}

// ★ 推送到手机（PushDeer）
function _pushNotification(result) {
  try {
    // 确定方向文本
    let directionText, qualityTag
    const scoreStars = '⭐'.repeat(Math.min(result.signalStrength || 3, 5))
    const price = result.bars ? result.bars[result.bars.length - 1].close : '--'
    
    // 直接使用与UI相同的calculateOverallScore函数计算分数
    const score = calculateOverallScore(result)
    const absScore = Math.abs(score)

    if (result.type) {
      // 有信号：做多或做空
      const isLong = result.type === 'long'
      directionText = isLong ? '💚 做多' : '❤️ 做空'
      
      // ── 信号质量标注（支持正负数）──
      if (absScore >= 85) qualityTag = '🔥强烈信号'
      else if (absScore >= 70) qualityTag = '✅优质信号'
      else if (absScore >= 60) qualityTag = '⚠️基础信号'
      else qualityTag = '信号'
    } else {
      // 无信号：根据趋势显示震荡状态
      if (result.trend === 'strong_bull' || result.trend === 'bull') {
        directionText = '💚 多头趋势'
        qualityTag = '📈趋势信号'
      } else if (result.trend === 'strong_bear' || result.trend === 'bear') {
        directionText = '❤️ 空头趋势'
        qualityTag = '📉趋势信号'
      } else {
        directionText = '💙 震荡趋势'
        qualityTag = '↔震荡信号'
      }
    }
    
    // ── 趋势方向提示 ──
    const trendTag = result.trendWarning || ''
    // ── 60-69分专属警示 ──
    const weakWarning = absScore < 70 && result.type ? '\n⚠️ 评分偏低(建议等70分以上再操作)' : ''

    // 分数显示：正数显示+号，负数直接显示
    const scoreDisplay = score > 0 ? '+' + score : score
    const title = `${directionText} ${qualityTag} ${scoreDisplay}分 ${scoreStars}`
    
    // 构建止盈止损信息
    let tradeInfo = ''
    if (result.tradeLevels) {
      tradeInfo = `\n📊 交易计划：\n`
      if (result.tradeLevels.entryLevel) {
        tradeInfo += `入场: ${result.tradeLevels.entryLevel.toFixed(2)}\n`
      } else if (result.tradeLevels.entryZone) {
        tradeInfo += `入场区间: ${result.tradeLevels.entryZone[0].toFixed(2)} - ${result.tradeLevels.entryZone[1].toFixed(2)}\n`
      }
      if (result.tradeLevels.stopLoss) {
        tradeInfo += `止损: ${result.tradeLevels.stopLoss.toFixed(2)}\n`
      }
      if (result.tradeLevels.takeProfits && result.tradeLevels.takeProfits.length > 0) {
        for (let i = 0; i < result.tradeLevels.takeProfits.length; i++) {
          tradeInfo += `TP${i+1}: ${result.tradeLevels.takeProfits[i].toFixed(2)}\n`
        }
      }
      if (result.tradeLevels.atrPercent) {
        tradeInfo += `波动率: ${result.tradeLevels.atrPercent}%\n`
      }
    }
    
    const content = `
${trendTag}${weakWarning}
价格: ${price?.toFixed?.(2) || price}${tradeInfo}
支撑位: ${result.nearSupport ? `✅(${result.swingLowCount}个)` : '❌远离'}
阻力位: ${result.nearResistance ? `✅(${result.swingHighCount}个)` : '❌远离'}
大周期: ${result.higherTrend === 'bull' || result.higherTrend === 'strong_bull' ? '📈多头' : result.higherTrend === 'bear' || result.higherTrend === 'strong_bear' ? '📉空头' : '↔震荡'}`.trim()

    // ★ App内弹窗提醒 (已禁用 - 改用原生推送)
    // _showSignalAlert(result, directionText, scoreStars, price)

    // ★ 增强推送系统（分级推送 + 频率控制）
    pushSystem.pushSignal(result, directionText, score, price)

    // PushDeer（Android原生推送）- 配置在.env或localStorage
    const pushDeerKey = localStorage.getItem('pushDeerKey') || 'PDU40148TxZdiIPWokKNhnK1UwmX6RiPuefuDi80f'
    if (pushDeerKey) {
      fetch('https://api2.pushdeer.com/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `pushkey=${pushDeerKey}&text=${title}&desp=${content}`,
      }).catch(e => console.warn('[PushDeer]:', e.message))
    }

    // Server酱（微信）- 可选
    const serverChanKey = localStorage.getItem('serverChanKey')
    if (serverChanKey) {
      fetch(`https://sctapi.ftqq.com/${serverChanKey}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `title=${title}&desp=${content}`,
      }).catch(e => console.warn('[ServerChan]:', e.message))
    }

    console.log('[Push] 推送成功:', title)
  } catch (e) {
    console.error('[Push] 推送失败:', e)
  }
}

// ★ App内信号弹窗
function _showSignalAlert(result, directionText, scoreStars, price) {
  const modal = document.getElementById('signalAlertModal')
  if (!modal) return

  // ★ 实时震动提醒（信号强度越高，震动越强）
  const strength = result.signalStrength || 3
  let vibrationIntensity = 'Light'
  if (strength >= 5) vibrationIntensity = 'Heavy'
  else if (strength >= 4) vibrationIntensity = 'Medium'
  
  triggerVibration('SIGNAL_ALERT', vibrationIntensity)

  // 设置方向类
  modal.classList.remove('short')
  if (result.type === 'short') {
    modal.classList.add('short')
  }

  // 更新内容
  const header = document.getElementById('signalAlertHeader')
  if (header) {
    header.textContent = `${directionText} ${scoreStars}`
  }

  const direction = document.getElementById('signalAlertDirection')
  if (direction) {
    const dirLabel = result.type === 'long' ? '看涨信号' : '看跌信号'
    const strength = result.signalStrength || 3
    direction.textContent = `${dirLabel}（强度: ${strength}/5）`
  }

  const priceEl = document.getElementById('signalAlertPrice')
  if (priceEl) {
    priceEl.textContent = price?.toFixed?.(2) || '--'
  }

  const entryEl = document.getElementById('signalAlertEntry')
  if (entryEl) {
    entryEl.textContent = (result.tradeLevels?.entryLevel || price)?.toFixed?.(2) || '--'
  }

  const slEl = document.getElementById('signalAlertSL')
  if (slEl) {
    slEl.textContent = (result.tradeLevels?.stopLoss || '--')?.toFixed?.(2) || '--'
  }

  const tpEl = document.getElementById('signalAlertTP')
  if (tpEl) {
    const tp1 = (result.tradeLevels?.takeProfits?.[0] || '--')?.toFixed?.(2) || '--'
    const tp2 = (result.tradeLevels?.takeProfits?.[1] || '--')?.toFixed?.(2) || '--'
    tpEl.textContent = `${tp1} / ${tp2}`
  }

  // 显示弹窗
  modal.style.display = 'flex'

  // ★ 关闭函数
  const closeAlert = () => {
    modal.style.display = 'none'
  }

  // ★ 按钮点击关闭（用addEventListener，避免事件冲突）
  const confirmBtn = document.getElementById('confirmAlertBtn')
  if (confirmBtn) {
    // 先清除所有旧监听器
    const newBtn = confirmBtn.cloneNode(true)
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn)
    newBtn.addEventListener('click', closeAlert)
  }

  // ★ 背景点击关闭（只有点击最外层modal才行）
  const handleModalClick = (e) => {
    if (e.target === modal) {
      closeAlert()
    }
  }
  
  // 清除旧的click监听器
  modal.onclick = null
  modal.removeEventListener('click', handleModalClick)
  modal.addEventListener('click', handleModalClick)

  // ★ 5秒自动关闭
  setTimeout(closeAlert, 5000)
}

// 更新趋势信息
function updateTrendInfo(result) {
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text }
  const setClass = (id, className) => { const el = document.getElementById(id); if (el) el.className = className }
  const setStyle = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val }
  
  const trendInfo = {
    strong_bull: { icon: '🚀', label: '强势多头', color: '#10b981' },
    bull: { icon: '📈', label: '多头', color: '#22c55e' },
    neutral: { icon: '↔️', label: '震荡', color: '#6b7280' },
    bear: { icon: '📉', label: '空头', color: '#ef4444' },
    strong_bear: { icon: '💥', label: '强势空头', color: '#dc2626' }
  }
  
  const trend = result.trend || 'neutral'
  const info = trendInfo[trend] || trendInfo.neutral
  
  setText('trendIcon', info.icon)
  setText('trendLabel', info.label)
  
  // 更新MA值
  if (result.ma20) {
    setText('ma20', result.ma20.toFixed(2))
  }
  if (result.ma60) {
    setText('ma60', result.ma60.toFixed(2))
  }
  
  // 更新价格相对MA位置
  if (result.price && result.ma20) {
    const position = ((result.price - result.ma20) / result.ma20 * 100).toFixed(2)
    setText('maPosition', position + '%')
    setClass('maPosition', position >= 0 ? 'position-value positive' : 'position-value negative')
  }
  
  // 更新趋势颜色
  const trendSection = document.querySelector('.trend-section')
  if (trendSection) trendSection.style.background = info.color + '20'
}

// 更新信号信息
function updateSignalInfo(result) {
  const setDisplay = (id, display) => { const el = document.getElementById(id); if (el) el.style.display = display }
  const setContent = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text }
  
  if (!result.type) {
    // 无信号
    setDisplay('signalCard', 'none')
    setDisplay('noSignalCard', 'block')
    return
  }
  
  // 有信号
  setDisplay('signalCard', 'block')
  setDisplay('noSignalCard', 'none')
  
  // 方向信息
  const isLong = result.type === 'long'
  setContent('directionIcon', isLong ? '🟢' : '🔴')
  setContent('directionText', isLong ? '做多信号' : '做空信号')
  
  // 信号强度
  const strength = result.signalStrength || 1
  setContent('starRating', '⭐'.repeat(strength) + '☆'.repeat(5 - strength))
  setContent('positionRating', '⭐'.repeat(strength) + '☆'.repeat(5 - strength))
  
  // 信号描述
  const strengthDesc = {
    5: '极强信号·三周期共振',
    4: '强信号·双周期共振',
    3: '中等信号·趋势明确',
    2: '弱信号·形态为主',
    1: '观望信号·条件不足'
  }
  setContent('signalDesc', strengthDesc[strength] || '信号分析')
  
  // 多周期共振
  updateResonanceInfo(result)
  
  // 条件验证
  updateConditionsInfo(result)
  
  // 交易计划
  updateTradePlan(result)
  
  // 仓位建议
  updatePositionAdvice(result)
}

// 更新多周期共振信息
function updateResonanceInfo(result) {
  const resonance = result.resonance || {}
  const setClass = (id, className) => { const el = document.getElementById(id); if (el) el.className = className }
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text }
  
  // 更新共振项状态
  setClass('resonanceTrend', resonance.trend_aligned ? 'resonance-item active' : 'resonance-item')
  setClass('resonanceRSI', resonance.rsi_extreme ? 'resonance-item active' : 'resonance-item')
  setClass('resonanceMACD', resonance.macd_aligned ? 'resonance-item active' : 'resonance-item')
  setClass('resonanceVolume', resonance.volume_confirmed ? 'resonance-item active' : 'resonance-item')
  
  // 更新共振数据
  if (result.currentRSI !== undefined) {
    setText('currentRSI', result.currentRSI.toFixed(1))
    setClass('currentRSI', result.currentRSI < 30 || result.currentRSI > 70 ? 'meta-value extreme' : 'meta-value')
  }
  
  if (result.higherRSI !== undefined && result.higherRSI !== null) {
    setText('higherRSI', result.higherRSI.toFixed(1))
  }
  
  if (result.volumeRatio !== undefined) {
    setText('volumeRatio', result.volumeRatio.toFixed(2) + 'x')
    setClass('volumeRatio', result.volumeRatio > 1.2 ? 'meta-value high' : 'meta-value')
  }
}

// 更新条件验证信息
function updateConditionsInfo(result) {
  const conditionsList = document.getElementById('conditionsList')
  if (!conditionsList) return  // 元素不存在，安全退出
  
  conditionsList.innerHTML = ''
  
  let conditions = []
  if (result.type === 'long' && result.longConditions) {
    conditions = result.longConditions
  } else if (result.type === 'short' && result.shortConditions) {
    conditions = result.shortConditions
  }
  
  // 更新进度
  const met = conditions.filter(c => c.ok).length
  const total = conditions.length
  const progressEl = document.getElementById('conditionsProgress')
  if (progressEl) progressEl.textContent = `${met}/${total}`
  
  // 添加条件项
  conditions.forEach(condition => {
    const div = document.createElement('div')
    div.className = condition.ok ? 'condition-item ok' : 'condition-item not-ok'
    div.innerHTML = `
      <span class="condition-icon">${condition.ok ? '✓' : '✗'}</span>
      <span class="condition-label">${condition.label}</span>
      <span class="condition-tip">${condition.tip || ''}</span>
    `
    conditionsList.appendChild(div)
  })
}

// 更新交易计划
function updateTradePlan(result) {
  if (!result.tradeLevels) return
  
  const tl = result.tradeLevels
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text }
  
  // 入场区间
  if (tl.entryZone && tl.entryZone.length === 2) {
    setText('entryZone', `${tl.entryZone[0]} - ${tl.entryZone[1]}`)
  }
  
  // 止损位
  if (tl.stopLoss) {
    setText('stopLoss', tl.stopLoss)
  }
  
  // 波动率
  if (tl.atrPercent) {
    setText('atrPercent', tl.atrPercent + '%')
  }
  
  // 止盈目标
  if (tl.takeProfits && tl.takeProfits.length >= 3) {
    setText('tp1', tl.takeProfits[0])
    setText('tp2', tl.takeProfits[1])
    setText('tp3', tl.takeProfits[2])
  }
}

// 更新仓位建议
function updatePositionAdvice(result) {
  if (!result.positionAdvice) return
  
  const pa = result.positionAdvice
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text }
  
  setText('positionRatio', pa.positionRatio + '%')
  setText('suggestedContracts', pa.suggestedContracts)
  setText('riskPerTrade', pa.riskPerTrade + ' U')
  setText('stopDistance', pa.stopDistance)
}

// 更新技术指标（新版 - 匹配图片设计）
function updateIndicators(result) {
  // 1. 更新综合评分可视化条
  updateScoreVisual(result)
  
  // 2. 更新趋势指标
  updateTrendIndicator(result)
  
  // 3. 更新技术指标评分
  updateTechnicalIndicators(result)
}

// 更新综合评分可视化条
function updateScoreVisual(result) {
  const score = result ? calculateOverallScore(result) : 0
  const marker = document.getElementById('scoreMarker')
  if (marker) {
    // 计算位置：0-100分对应0-100%位置
    const position = Math.min(Math.max(score, 0), 100)
    marker.style.left = `${position}%`
    
    // 根据分数设置颜色
    if (score < 40) marker.style.background = '#ef4444'
    else if (score >= 40 && score < 60) marker.style.background = '#f59e0b'
    else marker.style.background = '#10b981'
  }
}

// 更新趋势指标
function updateTrendIndicator(result) {
  if (!result) return
  
  let trendScore = 50
  let status = 'neutral'
  let statusText = '等待'
  let hint = '大周期方向'
  
  // 根据算法结果计算趋势分数
  if (result.dailyTrend) {
    const trend = result.dailyTrend.trend || 'neutral'
    switch(trend) {
      case 'strong_bull':
        trendScore = 90
        status = 'bullish'
        statusText = '强势多头'
        hint = '日线强势上涨'
        break
      case 'bull':
        trendScore = 75
        status = 'bullish'
        statusText = '多头'
        hint = '日线上涨'
        break
      case 'strong_bear':
        trendScore = 10
        status = 'bearish'
        statusText = '强势空头'
        hint = '日线强势下跌'
        break
      case 'bear':
        trendScore = 25
        status = 'bearish'
        statusText = '空头'
        hint = '日线下跌'
        break
      default:
        trendScore = 50
        status = 'neutral'
        statusText = '震荡'
        hint = '日线震荡'
    }
  }
  
  // 更新趋势卡片
  updateIndicatorCard('TREND', trendScore, status, statusText, hint)
}

// 更新技术指标评分
function updateTechnicalIndicators(result) {
  if (!result) return
  
  // RSI 评分
  if (result.rsiVal !== undefined) {
    const rsiScore = calculateRSIScore(result.rsiVal)
    const rsiStatus = getRSIStatus(result.rsiVal)
    const rsiStatusText = getRSIStatusText(result.rsiVal)
    updateIndicatorCard('RSI', rsiScore, rsiStatus, rsiStatusText, '超买超卖')
  } else {
    updateIndicatorCard('RSI', '--', 'neutral', '等待', '--')
  }
  
  // MACD 评分
  if (result.macdBar !== undefined) {
    const macdScore = calculateMACDScore(result.macdBar)
    const macdStatus = getMACDStatus(result.macdBar)
    const macdStatusText = getMACDStatusText(result.macdBar)
    updateIndicatorCard('MACD', macdScore, macdStatus, macdStatusText, '趋势动量')
  } else {
    updateIndicatorCard('MACD', '--', 'neutral', '等待', '--')
  }
  
  // KDJ 评分
  if (result.jVal !== undefined) {
    const kdjScore = calculateKDJScore(result.jVal)
    const kdjStatus = getKDJStatus(result.jVal)
    const kdjStatusText = getKDJStatusText(result.jVal)
    updateIndicatorCard('KDJ', kdjScore, kdjStatus, kdjStatusText, '随机指标')
  } else {
    updateIndicatorCard('KDJ', '--', 'neutral', '等待', '--')
  }
  
  // BOLL 评分
  if (result.bollLast && result.lastBar) {
    const price = result.lastBar.close
    const { upper, lower } = result.bollLast
    const percent = ((price - lower) / (upper - lower) * 100)
    const bollScore = calculateBOLLScore(percent)
    const bollStatus = getBOLLStatus(percent)
    const bollStatusText = getBOLLStatusText(percent)
    updateIndicatorCard('BOLL', bollScore, bollStatus, bollStatusText, '布林带位置')
  } else {
    updateIndicatorCard('BOLL', '--', 'neutral', '等待', '--')
  }
}

// 计算指标分数函数
function calculateRSIScore(rsi) {
  // RSI 0-100分，理想值50，超买>70，超卖<30
  if (rsi < 30) return 85  // 超卖区域，做多机会
  if (rsi > 70) return 15  // 超买区域，做空机会
  if (rsi >= 40 && rsi <= 60) return 70  // 中间区域，趋势稳定
  return 50  // 偏超买/超卖但未极端
}

function calculateMACDScore(macdBar) {
  // MACD柱状图评分，正值看多，负值看空
  if (macdBar > 0.5) return 85  // 强多头
  if (macdBar > 0.1) return 70  // 多头
  if (macdBar < -0.5) return 15  // 强空头
  if (macdBar < -0.1) return 30  // 空头
  return 50  // 中性
}

function calculateKDJScore(j) {
  // KDJ的J值评分，与RSI类似
  if (j < 20) return 85  // 超卖，做多机会
  if (j > 80) return 15  // 超买，做空机会
  if (j >= 40 && j <= 60) return 70  // 中间区域
  return 50  // 偏超买/超卖
}

function calculateBOLLScore(percent) {
  // 布林带位置百分比，0-100%，中间区域最好
  if (percent < 20) return 85  // 下轨附近，超卖
  if (percent > 80) return 15  // 上轨附近，超买
  if (percent >= 40 && percent <= 60) return 80  // 中轨附近最佳
  return 60  // 其他位置
}

// 获取指标状态函数
function getRSIStatus(rsi) {
  if (rsi < 30) return 'oversold'
  if (rsi > 70) return 'overbought'
  if (rsi >= 40 && rsi <= 60) return 'bullish'
  return 'neutral'
}

function getRSIStatusText(rsi) {
  if (rsi < 30) return '超卖'
  if (rsi > 70) return '超买'
  if (rsi >= 40 && rsi <= 60) return '健康'
  return '中性'
}

function getMACDStatus(macdBar) {
  if (macdBar > 0) return 'bullish'
  if (macdBar < 0) return 'bearish'
  return 'neutral'
}

function getMACDStatusText(macdBar) {
  if (macdBar > 0.5) return '强多'
  if (macdBar > 0) return '多头'
  if (macdBar < -0.5) return '强空'
  if (macdBar < 0) return '空头'
  return '中性'
}

function getKDJStatus(j) {
  if (j < 20) return 'oversold'
  if (j > 80) return 'overbought'
  if (j >= 40 && j <= 60) return 'bullish'
  return 'neutral'
}

function getKDJStatusText(j) {
  if (j < 20) return '超卖'
  if (j > 80) return '超买'
  if (j >= 40 && j <= 60) return '健康'
  return '中性'
}

function getBOLLStatus(percent) {
  if (percent < 20) return 'oversold'
  if (percent > 80) return 'overbought'
  if (percent >= 40 && percent <= 60) return 'bullish'
  return 'neutral'
}

function getBOLLStatusText(percent) {
  if (percent < 20) return '下轨'
  if (percent > 80) return '上轨'
  if (percent >= 40 && percent <= 60) return '中轨'
  return '其他'
}

// 更新指标卡片
function updateIndicatorCard(name, score, status, statusText, hint) {
  const card = document.getElementById(`indicator${name}`)
  if (!card) return
  
  const scoreElem = document.getElementById(`indicator${name}Score`)
  const statusElem = document.getElementById(`indicator${name}Status`)
  const hintElem = document.getElementById(`indicator${name}Note`)
  
  // 添加实时更新闪烁效果
  if (score !== '--') {
    card.classList.remove('data-updating')
    void card.offsetWidth
    card.classList.add('data-updating')
  }
  
  if (scoreElem) scoreElem.textContent = score !== '--' ? Math.round(score) : '--'
  if (statusElem) statusElem.textContent = statusText || '等待'
  if (hintElem) hintElem.textContent = hint || '--'
  
  // 更新状态类
  card.className = `indicator-card ${status}`
}

// 更新单个指标（简洁版 - 兼容旧版和新版）
function updateIndicator(name, value, status, hint) {
  // 检查是旧版UI还是新版UI
  const element = document.getElementById(`indicator${name}`)
  if (!element) return

  // 判断卡片类型
  const isNewCard = element.classList.contains('indicator-card')
  
  if (isNewCard) {
    // 新版卡片 - 调用新函数
    updateIndicatorCard(name, calculateIndicatorScore(name, value), status, getStatusText(status), hint)
  } else {
    // 旧版卡片 - 保持原有逻辑
    const valueElem = document.getElementById(`indicator${name}Value`)
    const hintElem = document.getElementById(`indicator${name}Note`)
    const statusElem = document.getElementById(`indicator${name}Status`)
    
    // 添加实时更新闪烁效果
    if (value !== '--') {
      element.classList.remove('data-updating')
      void element.offsetWidth
      element.classList.add('data-updating')
    }
    
    if (valueElem) valueElem.textContent = value
    if (hintElem) hintElem.textContent = hint

    // 更新状态
    element.className = `indicator-item ${status}`
    
    // 状态标签
    const statusText = {
      bullish: '多头',
      bearish: '空头',
      oversold: '超卖',
      overbought: '超买',
      neutral: '等待'
    }
    
    if (statusElem) {
      statusElem.textContent = statusText[status] || '等待'
    }
  }
}

// 根据指标名称和数值计算分数
function calculateIndicatorScore(name, value) {
  if (typeof value !== 'number' || value === '--') return '--'
  
  switch(name) {
    case 'RSI':
      return calculateRSIScore(value)
    case 'MACD':
      return calculateMACDScore(value)
    case 'KDJ':
      return calculateKDJScore(value)
    case 'BOLL':
      // BOLL的值是百分比字符串，需要解析
      if (typeof value === 'string' && value.includes('%')) {
        const percent = parseFloat(value)
        return calculateBOLLScore(percent)
      }
      return 50
    case 'TREND':
      // 趋势指标已经有专门的函数
      return 50  // 默认值
    default:
      return 50
  }
}

// 获取状态文本
function getStatusText(status) {
  const statusTextMap = {
    bullish: '多头',
    bearish: '空头',
    oversold: '超卖',
    overbought: '超买',
    neutral: '等待',
    bullish_strong: '强多',
    bearish_strong: '强空'
  }
  return statusTextMap[status] || '等待'
}

// 生成指标备注
function generateMACDNote(result) {
  if (result.macdBar === undefined) return '--'
  const val = result.macdBar
  if (val > 0 && result.dif > result.dea) return '满足：金叉且多头，看涨'
  if (val > 0 && result.dif < result.dea) return '不满足：多头但死叉，警惕'
  if (val < 0 && result.dif > result.dea) return '不满足：空头但金叉，观望'
  if (val < 0 && result.dif < result.dea) return '满足：死叉且空头，看跌'
  return '中性：MACD在零轴附近震荡'
}

function generateRSINote(result) {
  if (result.rsiVal === undefined) return '--'
  const val = result.rsiVal
  if (val < 30) return '满足：超卖区，可考虑做多'
  if (val > 70) return '满足：超买区，可考虑做空'
  if (val >= 40 && val <= 60) return '中性：RSI正常波动'
  if (val > 30 && val < 40) return '不满足：接近超卖，但未达标'
  if (val > 60 && val < 70) return '不满足：接近超买，但未达标'
  return '中性'
}

function generateKDJNote(result) {
  if (result.jVal === undefined) return '--'
  const val = result.jVal
  if (val < 0) return '满足：超卖严重，做多机会'
  if (val > 100) return '满足：超买严重，做空机会'
  if (val >= 20 && val <= 80) return '中性：KDJ正常区间'
  if (val > 0 && val < 20) return '不满足：接近超卖'
  if (val > 80 && val < 100) return '不满足：接近超买'
  return '中性'
}

function generateWRNote(result) {
  if (result.wrVal === undefined) return '--'
  const val = result.wrVal
  if (val < -80) return '满足：超卖，做多信号'
  if (val > -20) return '满足：超买，做空信号'
  if (val >= -60 && val <= -40) return '中性：WR正常'
  if (val > -80 && val <= -60) return '不满足：接近超卖'
  if (val >= -40 && val < -20) return '不满足：接近超买'
  return '中性'
}

function generateBOLLNote(result) {
  if (!result.bollLast || !result.lastBar) return '--'
  const price = result.lastBar.close
  const { upper, mid, lower } = result.bollLast
  const range = upper - lower
  const percent = ((price - lower) / range * 100)

  if (percent < 10) return '满足：接近下轨，支撑位做多'
  if (percent > 90) return '满足：接近上轨，阻力位做空'
  if (percent >= 20 && percent <= 80) return '中性：在布林带中轨附近'
  if (percent < 20) return '不满足：在下轨下方但未极端'
  if (percent > 80) return '不满足：在上轨上方但未极端'
  return '中性'
}

function generateATRNote(result) {
  if (!result.tradeLevels || !result.tradeLevels.atrPercent) return '--'
  const val = result.tradeLevels.atrPercent
  if (val < 1) return '满足：低波动，适合精细交易'
  if (val > 3) return '满足：高波动，盈利空间大但风险高'
  if (val >= 1.5 && val <= 2.5) return '中性：波动适中'
  if (val >= 1 && val < 1.5) return '不满足：波动偏低'
  if (val > 2.5 && val <= 3) return '不满足：波动偏高'
  return '中性'
}

// 生成动态信号分析
function generateSignalAnalysis(result) {
  const analysisSection = document.getElementById('signalAnalysisSection')
  const analysisItems = document.getElementById('analysisItems')
  if (!analysisItems || !analysisItems) return

  analysisItems.innerHTML = ''

  // 计算总分
  let totalScore = 0
  let maxScore = 0

  // 分析项
  const analyses = []

  // 1. 趋势分析
  const trendScore = calculateTrendScore(result)
  analyses.push({
    name: '趋势方向',
    score: trendScore.score,
    maxScore: trendScore.maxScore,
    status: trendScore.status,
    desc: trendScore.desc,
    explanation: trendScore.explanation
  })
  totalScore += trendScore.score
  maxScore += trendScore.maxScore

  // 2. MACD分析
  const macdScore = calculateMACDScore(result)
  analyses.push({
    name: 'MACD动量',
    score: macdScore.score,
    maxScore: macdScore.maxScore,
    status: macdScore.status,
    desc: macdScore.desc,
    explanation: macdScore.explanation
  })
  totalScore += macdScore.score
  maxScore += macdScore.maxScore

  // 3. RSI分析
  const rsiScore = calculateRSIScore(result)
  analyses.push({
    name: 'RSI超买超卖',
    score: rsiScore.score,
    maxScore: rsiScore.maxScore,
    status: rsiScore.status,
    desc: rsiScore.desc,
    explanation: rsiScore.explanation
  })
  totalScore += rsiScore.score
  maxScore += rsiScore.maxScore

  // 4. BOLL位置
  const bollScore = calculateBOLLScore(result)
  analyses.push({
    name: 'BOLL支撑阻力',
    score: bollScore.score,
    maxScore: bollScore.maxScore,
    status: bollScore.status,
    desc: bollScore.desc,
    explanation: bollScore.explanation
  })
  totalScore += bollScore.score
  maxScore += bollScore.maxScore

  // 5. 形态分析
  const patternScore = calculatePatternScore(result)
  analyses.push({
    name: 'K线形态',
    score: patternScore.score,
    maxScore: patternScore.maxScore,
    status: patternScore.status,
    desc: patternScore.desc,
    explanation: patternScore.explanation
  })
  totalScore += patternScore.score
  maxScore += patternScore.maxScore

  // 6. 成交量分析
  const volumeScore = calculateVolumeScore(result)
  analyses.push({
    name: '成交量确认',
    score: volumeScore.score,
    maxScore: volumeScore.maxScore,
    status: volumeScore.status,
    desc: volumeScore.desc,
    explanation: volumeScore.explanation
  })
  totalScore += volumeScore.score
  maxScore += volumeScore.maxScore

  // 更新总分 - 动态增长动画
  const percentScore = Math.round((totalScore / maxScore) * 100)
  const stars = getStarsFromScore(percentScore)

  const totalScoreEl = document.getElementById('totalScore')
  const scoreStarsEl = document.getElementById('scoreStars')
  const scoreFillEl = document.getElementById('scoreFill')
  
  // 动态增长：从0开始增加到目标分数
  if (totalScoreEl) {
    let currentScore = 0
    const increment = Math.ceil(percentScore / 30) // 分30帧动画
    const animationInterval = setInterval(() => {
      currentScore += increment
      if (currentScore >= percentScore) {
        currentScore = percentScore
        clearInterval(animationInterval)
      }
      totalScoreEl.textContent = `${currentScore}/100`
      totalScoreEl.style.transition = 'color 0.1s'
      // 分数变色：低分红、中分黄、高分绿
      if (currentScore < 50) {
        totalScoreEl.style.color = '#ef4444'
      } else if (currentScore < 70) {
        totalScoreEl.style.color = '#eab308'
      } else {
        totalScoreEl.style.color = '#10b981'
      }
    }, 50)
  }
  
  if (scoreStarsEl) scoreStarsEl.textContent = stars
  
  // 进度条也动态增长
  if (scoreFillEl) {
    let currentWidth = 0
    const increment = percentScore / 30
    const animationInterval = setInterval(() => {
      currentWidth += increment
      if (currentWidth >= percentScore) {
        currentWidth = percentScore
        clearInterval(animationInterval)
      }
      scoreFillEl.style.width = `${currentWidth}%`
    }, 50)
  }

  // 更新评分圆盘
  const hasSignal = result.signalConfidence && result.signalConfidence !== 0
  if (window.updateScoreDial) {
    window.updateScoreDial(percentScore, hasSignal, result.trend)
  }

  // 生成分析项
  if (analysisItems) {
    analyses.forEach(analysis => {
      const itemDiv = document.createElement('div')
      itemDiv.className = `analysis-item ${analysis.status}`
      itemDiv.innerHTML = `
        <div class="analysis-item-header">
          <span class="analysis-item-name">${analysis.name}</span>
          <span class="analysis-item-score">${analysis.score}/${analysis.maxScore}</span>
        </div>
        <div class="analysis-item-desc">${analysis.desc}</div>
        <div class="analysis-item-explanation">${analysis.explanation}</div>
      `
      analysisItems.appendChild(itemDiv)
    })
  }
}

// 计算趋势分数
function calculateTrendScore(result) {
  const trend = result.trend || 'neutral'
  if (trend === 'strong_bull') {
    return {
      score: 20,
      maxScore: 20,
      status: 'pass',
      desc: '强势多头趋势明确',
      explanation: '价格持续位于MA20上方，MA20上穿MA60，多头趋势强劲，适合做多'
    }
  } else if (trend === 'strong_bear') {
    return {
      score: 20,
      maxScore: 20,
      status: 'pass',
      desc: '强势空头趋势明确',
      explanation: '价格持续位于MA20下方，MA20下穿MA60，空头趋势强劲，适合做空'
    }
  } else if (trend === 'bull') {
    return {
      score: 15,
      maxScore: 20,
      status: 'pass',
      desc: '多头趋势',
      explanation: '价格在MA20上方，趋势向好但强度一般'
    }
  } else if (trend === 'bear') {
    return {
      score: 15,
      maxScore: 20,
      status: 'pass',
      desc: '空头趋势',
      explanation: '价格在MA20下方，趋势向下但强度一般'
    }
  } else {
    return {
      score: 5,
      maxScore: 20,
      status: 'fail',
      desc: '震荡行情，无明显趋势',
      explanation: '价格在MA20附近震荡，多空力量均衡，建议观望等待趋势明确'
    }
  }
}

// 计算MACD分数
function calculateMACDScore(result) {
  if (result.macdBar === undefined) return { score: 0, maxScore: 15, status: 'neutral', desc: '无数据', explanation: 'MACD数据缺失' }

  const val = result.macdBar
  const dif = result.dif || 0
  const dea = result.dea || 0

  if (val > 0 && dif > dea) {
    return {
      score: 15,
      maxScore: 15,
      status: 'pass',
      desc: '金叉且在零轴上方',
      explanation: 'MACD金叉且柱图为正，多头动能强劲，符合入场条件'
    }
  } else if (val < 0 && dif < dea) {
    return {
      score: 15,
      maxScore: 15,
      status: 'pass',
      desc: '死叉且在零轴下方',
      explanation: 'MACD死叉且柱图为负，空头动能强劲，符合入场条件'
    }
  } else if (val > 0) {
    return {
      score: 10,
      maxScore: 15,
      status: 'neutral',
      desc: '零轴上方但未金叉',
      explanation: 'MACD多头方向明确但未形成金叉，需要等待确认信号'
    }
  } else if (val < 0) {
    return {
      score: 10,
      maxScore: 15,
      status: 'neutral',
      desc: '零轴下方但未死叉',
      explanation: 'MACD空头方向明确但未形成死叉，需要等待确认信号'
    }
  } else {
    return {
      score: 5,
      maxScore: 15,
      status: 'fail',
      desc: 'MACD在零轴附近震荡',
      explanation: 'MACD方向不明，多空动能均衡，不符合入场条件'
    }
  }
}

// 计算RSI分数
function calculateRSIScore(result) {
  if (result.rsiVal === undefined) return { score: 0, maxScore: 15, status: 'neutral', desc: '无数据', explanation: 'RSI数据缺失' }

  const val = result.rsiVal

  if (val < 30) {
    return {
      score: 15,
      maxScore: 15,
      status: 'pass',
      desc: '超卖区（RSI<30）',
      explanation: '价格下跌过度，空头力量衰竭，反弹概率高，是做多好时机'
    }
  } else if (val > 70) {
    return {
      score: 15,
      maxScore: 15,
      status: 'pass',
      desc: '超买区（RSI>70）',
      explanation: '价格上涨过度，多头力量衰竭，回调概率高，是做空好时机'
    }
  } else if (val < 40) {
    return {
      score: 10,
      maxScore: 15,
      status: 'neutral',
      desc: '接近超卖',
      explanation: 'RSI接近超卖区，但未达到极端值，可考虑轻仓尝试'
    }
  } else if (val > 60) {
    return {
      score: 10,
      maxScore: 15,
      status: 'neutral',
      desc: '接近超买',
      explanation: 'RSI接近超买区，但未达到极端值，可考虑轻仓尝试'
    }
  } else {
    return {
      score: 5,
      maxScore: 15,
      status: 'fail',
      desc: 'RSI中性区间（40-60）',
      explanation: 'RSI在正常波动范围，没有明显的超买超卖信号，不符合入场条件'
    }
  }
}

// 计算BOLL分数
function calculateBOLLScore(result) {
  if (!result.bollLast || !result.lastBar) return { score: 0, maxScore: 15, status: 'neutral', desc: '无数据', explanation: 'BOLL数据缺失' }

  const price = result.lastBar.close
  const { upper, mid, lower } = result.bollLast
  const range = upper - lower
  const percent = ((price - lower) / range * 100)

  if (percent < 10) {
    return {
      score: 15,
      maxScore: 15,
      status: 'pass',
      desc: '接近下轨支撑',
      explanation: '价格接近布林带下轨，处于历史低位，是强支撑位，适合做多'
    }
  } else if (percent > 90) {
    return {
      score: 15,
      maxScore: 15,
      status: 'pass',
      desc: '接近上轨阻力',
      explanation: '价格接近布林带上轨，处于历史高位，是强阻力位，适合做空'
    }
  } else if (percent < 20) {
    return {
      score: 10,
      maxScore: 15,
      status: 'neutral',
      desc: '在下轨附近',
      explanation: '价格在下轨附近，有一定支撑但未到极端位'
    }
  } else if (percent > 80) {
    return {
      score: 10,
      maxScore: 15,
      status: 'neutral',
      desc: '在上轨附近',
      explanation: '价格在上轨附近，有一定阻力但未到极端位'
    }
  } else if (price > mid) {
    return {
      score: 7,
      maxScore: 15,
      status: 'fail',
      desc: '在中轨上方但远离轨道',
      explanation: '价格在中轨上方但未触及布林带边缘，无明显支撑阻力信号'
    }
  } else {
    return {
      score: 5,
      maxScore: 15,
      status: 'fail',
      desc: '在中轨附近震荡',
      explanation: '价格在中轨附近，多空均衡，不符合入场条件'
    }
  }
}

// 计算形态分数
function calculatePatternScore(result) {
  if (!result.type) {
    return {
      score: 0,
      maxScore: 20,
      status: 'fail',
      desc: '无K线形态',
      explanation: '未发现符合条件的K线形态（插针、反转等），不符合入场条件'
    }
  }

  const conditions = result.type === 'long' ? result.longConditions : result.shortConditions
  const met = conditions.filter(c => c.ok).length
  const total = conditions.length

  if (met === total) {
    return {
      score: 20,
      maxScore: 20,
      status: 'pass',
      desc: '形态完全符合',
      explanation: '所有K线形态条件都已满足，反转信号强烈，符合入场条件'
    }
  } else if (met >= total * 0.7) {
    return {
      score: 15,
      maxScore: 20,
      status: 'neutral',
      desc: '形态部分符合',
      explanation: '大部分形态条件满足，但仍有条件未达标，建议谨慎入场或观望'
    }
  } else {
    return {
      score: 5,
      maxScore: 20,
      status: 'fail',
      desc: '形态不符合',
      explanation: 'K线形态条件大部分未满足，反转信号微弱，不符合入场条件'
    }
  }
}

// 计算成交量分数
function calculateVolumeScore(result) {
  if (result.volumeRatio === undefined) return { score: 0, maxScore: 15, status: 'neutral', desc: '无数据', explanation: '成交量数据缺失' }

  const ratio = result.volumeRatio

  if (ratio >= 2.0) {
    return {
      score: 15,
      maxScore: 15,
      status: 'pass',
      desc: '显著放量',
      explanation: '成交量是均值的2倍以上，放量明显，说明市场参与度高，信号可靠性高'
    }
  } else if (ratio >= 1.5) {
    return {
      score: 12,
      maxScore: 15,
      status: 'pass',
      desc: '温和放量',
      explanation: '成交量是均值的1.5倍以上，有一定放量，信号可靠性尚可'
    }
  } else if (ratio >= 1.2) {
    return {
      score: 8,
      maxScore: 15,
      status: 'neutral',
      desc: '轻微放量',
      explanation: '成交量略高于均值，但放量不明显，信号可靠性一般'
    }
  } else {
    return {
      score: 3,
      maxScore: 15,
      status: 'fail',
      desc: '缩量',
      explanation: '成交量低于均值，说明市场参与度低，信号可靠性差，不建议入场'
    }
  }
}

// 根据分数获取星级
function getStarsFromScore(score) {
  if (score >= 80) return '⭐⭐⭐⭐⭐'
  if (score >= 60) return '⭐⭐⭐⭐☆'
  if (score >= 40) return '⭐⭐⭐☆☆'
  if (score >= 20) return '⭐⭐☆☆☆'
  return '⭐☆☆☆☆'
}

// 显示错误
function showError(message) {
  const errTextEl = document.getElementById('errorText')
  const errSecEl  = document.getElementById('errorSection')
  if (errTextEl) errTextEl.textContent = message
  if (errSecEl)  errSecEl.style.display = 'block'
  const signalCard   = document.getElementById('signalCard')
  const noSignalCard = document.getElementById('noSignalCard')
  if (signalCard)   signalCard.style.display   = 'none'
  if (noSignalCard) noSignalCard.style.display = 'block'
}

// 显示设置
function showSettings() {
  alert('专业交易系统设置\n\n1. 多周期共振: 开启\n2. ATR动态止损: 开启\n3. 信号强度过滤: 3星以上\n\n更多设置正在开发中...')
}

// ══════════════════════════════════════════
// 后台监控服务控制
// ══════════════════════════════════════════
const MONITOR_KEY = 'monitor_enabled'
const AUTOSTART_KEY = 'autostart_enabled'
let monitorCheckCount = 0

// 切换监控面板显示
function toggleMonitorPanel() {
  const content = document.getElementById('monitorContent')
  const icon = document.getElementById('monitorToggleIcon')
  if (content.style.display === 'none') {
    content.style.display = 'block'
    icon.textContent = '▲'
  } else {
    content.style.display = 'none'
    icon.textContent = '▼'
  }
}

// 切换后台监控服务
async function toggleMonitorService() {
  const switchEl = document.getElementById('monitorSwitch')
  const isEnabled = switchEl.checked

  try {
    if (window.Capacitor?.Plugins?.App) {
      // 使用 Capacitor App 插件调用原生方法
      await window.Capacitor.Plugins.App.addListener('startMonitorService', () => {
        console.log('[Monitor] 服务已启动')
      })

      if (isEnabled) {
        // 调用原生启动服务
        await window.Capacitor.Plugins.App.launchUrl('btcnotify://start')
      } else {
        // 停止服务（通过发送广播）
        await window.Capacitor.Plugins.App.launchUrl('btcnotify://stop')
      }
    }

    // 保存状态
    localStorage.setItem(MONITOR_KEY, isEnabled ? '1' : '0')
    updateMonitorStatus(isEnabled)

    console.log('[Monitor] 后台监控:', isEnabled ? '已开启' : '已关闭')
  } catch (e) {
    console.warn('[Monitor] 无法控制后台服务:', e.message)
    // Web 环境下提示用户
    if (!window.Capacitor) {
      alert('⚠️ 后台监控仅在App内有效\n\n请下载安装App后开启此功能')
      switchEl.checked = false
    }
  }
}

// 切换自启动
function toggleAutoStart() {
  const switchEl = document.getElementById('autoStartSwitch')
  const isEnabled = switchEl.checked
  localStorage.setItem(AUTOSTART_KEY, isEnabled ? '1' : '0')

  if (isEnabled) {
    console.log('[Monitor] 自启动已开启 - 开机后将自动启动监控')
  } else {
    console.log('[Monitor] 自启动已关闭')
  }
}

// 更新检测间隔
const CHECK_INTERVAL_KEY = 'check_interval_seconds'

function updateCheckInterval() {
  const selectEl = document.getElementById('checkIntervalSelect')
  const interval = parseInt(selectEl.value)
  localStorage.setItem(CHECK_INTERVAL_KEY, interval.toString())
  
  const labels = { 60: '1分钟', 180: '3分钟', 300: '5分钟', 600: '10分钟' }
  console.log('[Monitor] 检测间隔已更新为: ' + labels[interval])
  
  // 提示用户（实际生效需要重启服务）
  if (window.Capacitor?.Plugins?.App) {
    // 可以通知原生层更新间隔
  }
}

// 初始化检测间隔选择器
function initCheckInterval() {
  const saved = localStorage.getItem(CHECK_INTERVAL_KEY) || '180'
  const selectEl = document.getElementById('checkIntervalSelect')
  if (selectEl) {
    selectEl.value = saved
  }
}

// 更新监控状态显示
function updateMonitorStatus(isRunning) {
  const dot = document.getElementById('monitorDot')
  const text = document.getElementById('monitorStatusText')

  if (isRunning) {
    dot.classList.add('active')
    text.textContent = '运行中'
    dot.style.background = '#4ade80'
  } else {
    dot.classList.remove('active')
    text.textContent = '已停止'
    dot.style.background = '#94a3b8'
  }
}

// 测试通知
function testNotification() {
  if (window.Capacitor?.Plugins?.Notifications) {
    window.Capacitor.Plugins.Notifications.requestPermission().then(result => {
      if (result.granted) {
        window.Capacitor.Plugins.Notifications.show({
          title: '🧪 测试通知',
          body: 'BTC三步法监控服务正常运行！',
          id: Date.now()
        })
        alert('✅ 测试通知已发送！')
      } else {
        alert('⚠️ 请先开启通知权限')
      }
    })
  } else if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification('🧪 测试通知', {
        body: 'BTC三步法监控服务正常运行！'
      })
      alert('✅ 测试通知已发送！')
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') {
          new Notification('🧪 测试通知', {
            body: 'BTC三步法监控服务正常运行！'
          })
          alert('✅ 测试通知已发送！')
        }
      })
    } else {
      alert('⚠️ 浏览器通知已被禁用')
    }
  } else {
    alert('⚠️ 当前环境不支持通知功能')
  }
}

// 更新检查次数
function incrementMonitorCount() {
  monitorCheckCount++
  document.getElementById('monitorCount').textContent = monitorCheckCount
  document.getElementById('lastCheckTime').textContent = new Date().toLocaleTimeString()
}

// 初始化后台监控状态（默认开启）
function initMonitorStatus() {
  const savedAutoStart = localStorage.getItem(AUTOSTART_KEY) === '1'
  document.getElementById('autoStartSwitch').checked = savedAutoStart
  
  // 初始化检测间隔选择器
  initCheckInterval()
  
  // 后台监控默认开启
  updateMonitorStatus(true)
  
  // 首次使用自动开启后台服务
  if (localStorage.getItem(MONITOR_KEY) === null) {
    localStorage.setItem(MONITOR_KEY, '1')
    // 通知原生启动服务
    if (window.Capacitor?.Plugins?.App) {
      window.Capacitor.Plugins.App.launchApp().catch(() => {})
    }
  }

  console.log('[Monitor] 初始化状态 - 后台:运行中, 自启:', savedAutoStart ? '开启' : '关闭')
}

// ══════════════════════════════════════════
// 评分说明展开/收起
// ══════════════════════════════════════════

function toggleScoreHint() {
  const content = document.getElementById('hintContent')
  const arrow = document.getElementById('hintArrow')
  if (content.style.display === 'none') {
    content.style.display = 'block'
    arrow.textContent = '▲'
  } else {
    content.style.display = 'none'
    arrow.textContent = '▼'
  }
}

// ══════════════════════════════════════════
// 重要信息监控（插针、波动率等）
// ══════════════════════════════════════════

function updateImportantInfo(result) {
  if (!result || !result.bars || result.bars.length < 20) return
  
  try {
    // 1. 插针检测 - 检测最近K线是否触及布林带上轨或下轨
    const pinDetection = detectPinbar(result)
    document.getElementById('pinDetection').textContent = pinDetection.text
    document.getElementById('pinDetection').className = 'info-value ' + pinDetection.class
    
    // 2. 波动率计算 - ATR指标
    const volatility = calculateVolatility(result)
    document.getElementById('volatilityValue').textContent = volatility.text
    document.getElementById('volatilityValue').className = 'info-value ' + volatility.class
    
    // 3. 快速波动检测 - 最近几根K线的涨跌幅
    const fastMove = detectFastMove(result)
    document.getElementById('fastMoveAlert').textContent = fastMove.text
    document.getElementById('fastMoveAlert').className = 'info-value ' + fastMove.class
    
  } catch(e) {
    console.warn('[ImportantInfo]', e.message)
  }
}

// 插针检测 - 正负信号（与算法同步：下影做多，上影做空）
function detectPinbar(result) {
  const bars = result.bars
  const lastBars = bars.slice(-5) // 最近5根
  
  let pinUp = 0, pinDown = 0
  let pinUpText = '', pinDownText = ''
  
  for (const bar of lastBars) {
    if (!bar) continue
    const { high, low, open, close } = bar
    const body = Math.abs(close - open)
    const upperWick = high - Math.max(open, close)
    const lowerWick = Math.min(open, close) - low
    
    // 下影线超过身体2倍 = 锤子（下影线/做多信号）
    if (lowerWick > body * 2 && lowerWick > upperWick) {
      pinUp++
      if (!pinUpText) pinUpText = '锤子' + lowerWick.toFixed(0) + '点'
    }
    // 上影线超过身体2倍 = 射击星（上影线/做空信号）
    if (upperWick > body * 2 && upperWick > lowerWick) {
      pinDown++
      if (!pinDownText) pinDownText = '射击星' + upperWick.toFixed(0) + '点'
    }
  }
  
  // 与算法同步：下影=做多(+信号)，上影=做空(-信号)
  if (pinUp > 0) {
    return { text: '🟢 +' + pinUp + ' ' + pinUpText, class: 'bullish' }
  } else if (pinDown > 0) {
    return { text: '🔴 -' + pinDown + ' ' + pinDownText, class: 'bearish' }
  }
  return { text: '✅ 正常', class: 'normal' }
}

// 波动率计算
function calculateVolatility(result) {
  const bars = result.bars
  if (bars.length < 14) return { text: '--', class: 'normal' }
  
  // 使用ATR(平均真实波幅)
  const closes = bars.map(b => b.close)
  const highs = bars.map(b => b.high)
  const lows = bars.map(b => b.low)
  
  let atrSum = 0
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i] - closes[i-1])
    )
    atrSum += tr
  }
  const atr = atrSum / (bars.length - 1)
  const currentPrice = closes[closes.length - 1]
  const atrPercent = (atr / currentPrice * 100).toFixed(2)
  
  // 波动率等级
  if (atrPercent > 2) {
    return { text: '⚠️ ' + atrPercent + '% (高)', class: 'warning' }
  } else if (atrPercent > 1) {
    return { text: '📊 ' + atrPercent + '% (中)', class: 'normal' }
  }
  return { text: '📉 ' + atrPercent + '% (低)', class: 'calm' }
}

// 快速波动检测
function detectFastMove(result) {
  const bars = result.bars
  if (bars.length < 3) return { text: '--', class: 'normal' }
  
  const last3 = bars.slice(-3)
  let maxChange = 0
  let direction = ''
  
  for (let i = 1; i < last3.length; i++) {
    const change = Math.abs((last3[i].close - last3[i].open) / last3[i].open * 100)
    if (change > maxChange) {
      maxChange = change
      direction = last3[i].close > last3[i].open ? '📈' : '📉'
    }
  }
  
  if (maxChange > 1.5) {
    return { text: '⚡ ' + direction + ' ' + maxChange.toFixed(2) + '%', class: 'alert' }
  } else if (maxChange > 0.5) {
    return { text: '📊 ' + direction + ' ' + maxChange.toFixed(2) + '%', class: 'normal' }
  }
  return { text: '➡️ ' + maxChange.toFixed(2) + '%', class: 'calm' }
}

// ══════════════════════════════════════════
// ★ 绿色泡泡说话系统 ★
// ══════════════════════════════════════════

// 泡泡说话内容库
const bubbleSpeeches = {
  // 强势做多
  strongLong: [
    '🚀 强势信号！可以考虑重仓',
    '💰 做多机会来了，准备入场',
    '📈 多头共振，满仓干！',
    '🎯 趋势很强，跟上节奏'
  ],
  // 可以做多
  long: [
    '✅ 出现做多信号，轻仓试探',
    '📊 技术面支持，可以小试',
    '🎯 顺势做多，控制仓位',
    '💡 回调企稳是机会'
  ],
  // 观望
  neutral: [
    '⏳ 行情整理中，耐心等待',
    '📊 方向不明，保持观望',
    '🌊 震荡行情，不宜操作',
    '🎲 宁可错过，不可做错'
  ],
  // 可以做空
  short: [
    '📉 出现做空信号，轻仓试探',
    '⚠️ 空头信号，注意风险',
    '🎯 顺势做空，避免抄底',
    '💡 反弹乏力是机会'
  ],
  // 强势做空
  strongShort: [
    '💥 强势空头！可以考虑重仓',
    '📉 做空机会来了，准备入场',
    '🔻 空头共振，满仓干！',
    '⚠️ 趋势很弱，跟上节奏'
  ],
  // 等待/休息
  waiting: [
    '🫧 行情整理中，耐心等待',
    '🌙 没有好机会，再等等',
    '📊 等待是我的强项',
    '⏳ 机会都是等出来的'
  ]
}

// 泡泡说话函数
function bubbleSpeak(type = 'waiting') {
  const speeches = bubbleSpeeches[type] || bubbleSpeeches.waiting
  const text = speeches[Math.floor(Math.random() * speeches.length)]
  
  const bubbleText = document.getElementById('bubbleText')
  if (bubbleText) {
    bubbleText.textContent = text
  }
  
  // 说话动画
  const bubbleChar = document.getElementById('bubbleCharacter')
  if (bubbleChar) {
    bubbleChar.classList.add('speaking')
    setTimeout(() => {
      bubbleChar.classList.remove('speaking')
    }, 2000)
  }
}

// 更新泡泡状态和内容
function updateBubbleSpeech(result, score, signalType) {
  const bubbleBox = document.getElementById('bubbleSpeechBox')
  const bubbleTitle = document.getElementById('bubbleTitle')
  
  if (!bubbleBox) return
  
  // 重置样式
  bubbleBox.className = 'bubble-speech-box'
  
  // 根据信号类型确定泡泡状态和说话内容
  let speechType = 'waiting'
  let title = '🫧 等待信号...'
  
  if (score >= 80 && signalType === 'long') {
    bubbleBox.classList.add('long')
    speechType = 'strongLong'
    title = '🟢🟢 强势做多'
    bubbleSpeak('strongLong')
  } else if (score >= 60 && signalType === 'long') {
    bubbleBox.classList.add('long')
    speechType = 'long'
    title = '🟢 可以做多'
    bubbleSpeak('long')
  } else if (score >= 40 && score < 60) {
    bubbleBox.classList.add('warning')
    speechType = 'neutral'
    title = '🟡 观望等待'
    bubbleSpeak('neutral')
  } else if (score > 20 && signalType === 'short') {
    bubbleBox.classList.add('short')
    speechType = 'short'
    title = '🔴 可以做空'
    bubbleSpeak('short')
  } else if (score <= 20 && signalType === 'short') {
    bubbleBox.classList.add('short')
    speechType = 'strongShort'
    title = '🔴🔴 强势做空'
    bubbleSpeak('strongShort')
  } else if (score > 50) {
    bubbleBox.classList.add('warning')
    speechType = 'neutral'
    title = '🟡 偏多观望'
    bubbleSpeak('neutral')
  } else if (score < 50) {
    bubbleBox.classList.add('warning')
    speechType = 'neutral'
    title = '🟡 偏空观望'
    bubbleSpeak('neutral')
  }
  
  if (bubbleTitle) {
    bubbleTitle.textContent = title
  }
  
  // 点击泡泡也可以说话
  const bubbleChar = document.getElementById('bubbleCharacter')
  if (bubbleChar && !bubbleChar.hasClickListener) {
    bubbleChar.hasClickListener = true
    bubbleChar.addEventListener('click', () => {
      bubbleSpeak(speechType)
      bubbleBox.classList.add('speaking')
      setTimeout(() => bubbleBox.classList.remove('speaking'), 1000)
    })
  }
}

// ══════════════════════════════════════════
// 猫咪表情状态更新 - 智能AI版
// ══════════════════════════════════════════

// 更新猫咪表情和状态（智能AI版）
function updateCatMood(result) {
  const moodIcon = document.getElementById('catMoodIcon')
  const moodTitle = document.getElementById('catMoodTitle')
  const moodDesc = document.getElementById('catMoodDesc')
  
  if (!moodIcon || !moodTitle || !moodDesc) return
  
  // 计算综合评分
  const score = result ? calculateOverallScore(result) : 0
  
  // 获取各种指标状态
  const marketInfo = getMarketAnalysisInfo(result)
  
  // 根据综合分析确定最终状态
  const status = analyzeSignalStatus(result, score, marketInfo)
  
  // ★ 更新绿色泡泡说话 ★
  const signalType = result?.type || null
  updateBubbleSpeech(result, score, signalType)
  
  // 更新UI
  moodIcon.textContent = status.icon
  moodIcon.className = `cat-face ${status.moodClass}`
  moodTitle.textContent = status.icon + ' ' + status.title
  moodDesc.textContent = status.description
  
  // 更新分数指示器（兼容旧ID）
  const scoreEl = document.getElementById('aiScoreValue')
  if (scoreEl) {
    scoreEl.textContent = score > 0 ? score : '--'
    scoreEl.className = 'score-value'
    if (result?.type === 'long') {
      scoreEl.classList.add('long')
    } else if (result?.type === 'short') {
      scoreEl.classList.add('short')
    }
  }
  
  // ★ 更新操作建议区域 ★（口语化版）
  const adviceBadge = document.getElementById('adviceBadge')
  const adviceText = document.getElementById('adviceText')
  const adviceBox = document.getElementById('actionAdvice')
  if (adviceBadge && adviceText && adviceBox) {
    adviceBox.className = 'action-badge-box'  // 重置样式
    if (score >= 80) {
      adviceBadge.textContent = '🟢🟢 强势做多'
      adviceBox.classList.add('long')
      adviceText.textContent = '非常安全！可以考虑重仓'
    } else if (score >= 60) {
      adviceBadge.textContent = '🟢 可以做多'
      adviceBox.classList.add('long')
      adviceText.textContent = '比较安全，可以轻仓试试'
    } else if (score > 50) {
      adviceBadge.textContent = '🟡 观望'
      adviceText.textContent = '还不够安全，再等等看'
    } else if (score >= 40) {
      adviceBadge.textContent = '🟡 观望'
      adviceText.textContent = '不太安全，建议观望'
    } else if (score > 20) {
      adviceBadge.textContent = '🔴 可以做空'
      adviceBox.classList.add('short')
      adviceText.textContent = '有点危险了，可以轻仓做空'
    } else {
      adviceBadge.textContent = '🔴🔴 强势做空'
      adviceBox.classList.add('short')
      adviceText.textContent = '非常危险！可以考虑重仓做空'
    }
  }
  
  // 更新猫咪盒子背景色
  const catBox = document.getElementById('catMoodContainer')
  if (catBox) {
    catBox.className = 'cat-says-box'
    if (status.moodClass === 'excited') {
      catBox.style.borderColor = score >= 60 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'
    } else if (status.moodClass === 'warning') {
      catBox.style.borderColor = 'rgba(251,191,36,0.4)'
    }
  }
  
  // 更新卡片状态（兼容旧ID）
  const noSignalCard = document.getElementById('noSignalCard')
  if (noSignalCard) {
    noSignalCard.className = `hibernate-card ${status.moodClass === 'excited' ? 'signal-strong' : ''} ${status.moodClass === 'warning' ? 'warning' : ''}`
  }
  
  // 更新智能警示语
  updateSmartTips(status, marketInfo, score)
}

// 智能警示语库
const smartTips = {
  // 无信号时的通用警示语
  waiting: [
    '💡 机会都是等出来的，耐心是最大的优势',
    '🌙 行情未明，休息也是一种策略',
    '🎯 宁可错过，不可做错',
    '⏳ 等待是交易的一部分',
    '🌊 潮起潮落，顺势而为',
    '📊 没有机会时，学习是最好的投资',
    '🧘 保持冷静，等待属于自己的机会',
    '🎲 频繁交易是亏损的根源'
  ],
  // 做多信号时的提醒
  long: [
    '📈 趋势向多，但注意控制仓位',
    '🎯 做多信号，轻仓试探为佳',
    '⚠️ 顺势做多，严格止损',
    '💪 多头趋势，回调企稳可加仓'
  ],
  // 做空信号时的提醒
  short: [
    '📉 空头信号，注意仓位管理',
    '🎯 做空机会，轻仓试探',
    '⚠️ 顺势做空，避免抄底',
    '🔻 空头趋势，反弹乏力可加空'
  ],
  // 极端行情提醒
  extreme: [
    '⚡ 超买/超卖区域，注意风险',
    '🎢 波动剧烈，谨慎操作',
    '🛡️ 支撑/阻力区域，观察为主'
  ]
}

// 获取随机警示语
function getRandomTip(category) {
  const tips = smartTips[category] || smartTips.waiting
  return tips[Math.floor(Math.random() * tips.length)]
}

// 更新智能警示语
function updateSmartTips(status, marketInfo, score) {
  const tipsEl = document.getElementById('smartTipsBar')
  if (!tipsEl) return
  
  let category = 'waiting'
  
  // 根据状态选择警示语类别
  if (status.moodClass === 'excited' || status.moodClass === 'happy') {
    category = marketInfo.signalType === 'long' ? 'long' : 
               marketInfo.signalType === 'short' ? 'short' : 'waiting'
  } else if (status.moodClass === 'warning') {
    category = 'extreme'
  }
  
  // 根据分数区间添加额外提示
  let extraTip = ''
  if (score >= 70 && score < 80) {
    extraTip = ' | 🔥 偏强区域，注意获利了结'
  } else if (score >= 30 && score < 40) {
    extraTip = ' | 🔻 偏弱区域，谨慎抄底'
  } else if (score >= 80) {
    extraTip = ' | 🚀 强势信号！但需防回调'
  } else if (score <= 20) {
    extraTip = ' | 💥 极弱区域，注意空头陷阱'
  }
  
  tipsEl.textContent = getRandomTip(category) + extraTip
}



// 获取市场分析信息
function getMarketAnalysisInfo(result) {
  const info = {
    rsi: result?.rsiVal || 50,
    macdBar: result?.macdBar || 0,
    jValue: result?.jVal || 50,
    bollPercent: 50,
    trend: result?.trend || 'neutral',
    volumeRatio: result?.volumeRatio || 1,
    isLongPin: result?.isLongPin || false,
    isShortPin: result?.isShortPin || false,
    hasSignal: result?.type ? true : false,
    signalType: result?.type || null
  }
  
  // 计算BOLL位置
  if (result?.bollLast && result?.lastBar) {
    const price = result.lastBar.close
    const { upper, lower } = result.bollLast
    info.bollPercent = ((price - lower) / (upper - lower) * 100)
  }
  
  return info
}

// 分析信号状态（核心AI逻辑）- 口语化版
// 规则：≥60分做多 | 40-60分观望 | ≤40分做空
function analyzeSignalStatus(result, score, marketInfo) {
  // 🔥 关键：用原始 result.type 判断信号方向
  
  if (result?.type === 'long') {
    // 做多信号 - 口语化表达
    if (score >= 80) {
      return {
        icon: '🚀',
        title: '可以做多！很安全！',
        description: '多周期共振强烈，可以重仓布局！',
        moodClass: 'excited'
      }
    } else if (score >= 60) {
      return {
        icon: '📈',
        title: '可以做多',
        description: '趋势向上，可以轻仓试试',
        moodClass: 'happy'
      }
    } else {
      return {
        icon: '😸',
        title: '勉强可以做多',
        description: '控制仓位，小仓位试试',
        moodClass: 'alert'
      }
    }
  }
  
  if (result?.type === 'short') {
    // 做空信号 - 口语化表达
    if (score <= 10) {
      return {
        icon: '💥',
        title: '可以做空！很危险！',
        description: '空头动能强劲，可以重仓做空！',
        moodClass: 'excited'
      }
    } else if (score <= 25) {
      return {
        icon: '📉',
        title: '可以做空',
        description: '趋势向下，可以轻仓试试',
        moodClass: 'happy'
      }
    } else {
      return {
        icon: '😾',
        title: '勉强可以做空',
        description: '控制仓位，小仓位试试',
        moodClass: 'alert'
      }
    }
  }
  
  // 无明确三步法信号 - 根据指标综合判断（口语化版）
  // 极端超卖（做多机会）
  if (marketInfo.rsi < 35 || marketInfo.jValue < 30) {
    return {
      icon: '⚡',
      title: '快要跌不动了！',
      description: '跌太久了，可能要反弹，可以关注',
      moodClass: 'warning'
    }
  }
  
  // 极端超买（做空机会）
  if (marketInfo.rsi > 65 || marketInfo.jValue > 70) {
    return {
      icon: '⚠️',
      title: '涨太多了！',
      description: '涨太久了，小心回调风险',
      moodClass: 'warning'
    }
  }
  
  // 根据综合评分判断（无明确三步法信号时）
  if (score >= 60) {
    return {
      icon: '📈',
      title: '可以做多',
      description: '多指标偏多，可以轻仓试试',
      moodClass: 'happy'
    }
  }
  
  if (score <= 40) {
    return {
      icon: '📉',
      title: '可以做空',
      description: '多指标偏空，可以轻仓试试',
      moodClass: 'happy'
    }
  }
  
  // 低波动率市场
  if (result?.tradeLevels?.atrPercent < 1) {
    return {
      icon: '😴',
      title: '市场在睡觉',
      description: '波动太小，没啥机会，休息一下',
      moodClass: 'sleeping'
    }
  }
  
  // 高波动市场
  if (result?.tradeLevels?.atrPercent > 3) {
    return {
      icon: '🌊',
      title: '波动很大！',
      description: '行情太猛，小心被扫',
      moodClass: 'warning'
    }
  }
  
  // 布林带极端位置
  if (marketInfo.bollPercent < 30) {
    return {
      icon: '🛡️',
      title: '跌到支撑了',
      description: '可能有支撑，关注能不能反弹',
      moodClass: 'warning'
    }
  }
  
  if (marketInfo.bollPercent > 70) {
    return {
      icon: '🔴',
      title: '涨到阻力了',
      description: '可能有压力，小心回落',
      moodClass: 'warning'
    }
  }
  
  // MACD金叉（做多）
  if (marketInfo.macdBar > 0 && result?.macdBar > result?.macdPrev) {
    return {
      icon: '📈',
      title: 'MACD多头动能',
      description: `MACD柱放大，趋势偏多`,
      moodClass: 'happy'
    }
  }
  
  // MACD死叉（做空）
  if (marketInfo.macdBar < 0 && result?.macdBar < result?.macdPrev) {
    return {
      icon: '📉',
      title: 'MACD空头动能',
      description: `MACD柱放大，趋势偏空`,
      moodClass: 'happy'
    }
  }
  
  // 放量市场
  if (marketInfo.volumeRatio > 1.5) {
    return {
      icon: '📊',
      title: '放量了！',
      description: `交易活跃，注意方向选择`,
      moodClass: 'neutral'
    }
  }
  
  // 缩量市场
  if (marketInfo.volumeRatio < 0.6) {
    return {
      icon: '😴',
      title: '缩量观望',
      description: '没什么人交易，方向不明',
      moodClass: 'sleeping'
    }
  }
  
  // 震荡行情
  if (marketInfo.trend === 'neutral') {
    return {
      icon: '↔️',
      title: '来回晃悠',
      description: '没方向，高抛低吸也行',
      moodClass: 'neutral'
    }
  }
  
  // 默认 - 正常观望
  return {
    icon: '😴',
    title: '休息中...',
    description: '没有好机会，再等等',
    moodClass: 'sleeping'
  }
}

// 保留原有简单版供兼容
function updateCatMoodSimple(result) {
  updateCatMood(result)
}

// 初始化猫咪状态
function initCatMood() {
  updateCatMood(null)
}

// 切换详情显示
function toggleDetails() {
  const details = document.querySelectorAll('.conditions-section, .trade-plan, .position-section')
  details.forEach(detail => {
    if (detail.style.display === 'none') {
      detail.style.display = 'block'
    } else {
      detail.style.display = 'none'
    }
  })
}

// 自动刷新（每15秒 = 每根15m K线）+ 实时指标更新
let _refreshRetryCount = 0
function startAutoRefresh() {
  setInterval(async () => {
    const loadingEl = document.getElementById('loadingSection')
    // 仅当未在加载时才主动刷新信号
    if (!loadingEl || loadingEl.style.display !== 'block') {
      try {
        await fetchSignalData()
        _refreshRetryCount = 0  // 重置重试计数
      } catch (e) {
        _refreshRetryCount++
        console.warn(`[AutoRefresh] 第${_refreshRetryCount}次刷新失败:`, e.message)
        // 连续失败3次则警告用户网络可能离线
        if (_refreshRetryCount >= 3) {
          console.error('[AutoRefresh] 连续失败3次，网络可能离线')
        }
      }
    }
  }, 2000) // 改为2秒刷新 - 最大化数据鲜活度，实时性更强
  
  // ★ 新增：WebSocket每个tick更新指标数据（无延迟）
  console.log('[AutoRefresh] 实时指标更新已启用（通过WebSocket tick + 2秒极速刷新）')
}

// 全局变量
let currentInterval = '15m'

// ══════════════════════════════════════════
// Tab 切换
// ══════════════════════════════════════════
function switchTab(tab) {
  const signalPage = document.querySelector('.container')
  const historyPage = document.getElementById('historyPage')
  const simPage = document.getElementById('simPage')
  const tabSignal = document.getElementById('tabSignal')
  const tabHistory = document.getElementById('tabHistory')
  const tabSim = document.getElementById('tabSim')

  // 全隐藏
  if (signalPage) signalPage.style.display = 'none'
  if (historyPage) historyPage.style.display = 'none'
  if (simPage) simPage.style.display = 'none'
  if (tabSignal) tabSignal.classList.remove('active')
  if (tabHistory) tabHistory.classList.remove('active')
  if (tabSim) tabSim.classList.remove('active')

  if (tab === 'signal') {
    if (signalPage) signalPage.style.display = 'block'
    if (tabSignal) tabSignal.classList.add('active')
  } else if (tab === 'history') {
    if (historyPage) historyPage.style.display = 'block'
    if (tabHistory) tabHistory.classList.add('active')
    renderHistoryPage()
  } else if (tab === 'sim') {
    if (simPage) simPage.style.display = 'block'
    if (tabSim) tabSim.classList.add('active')
    // 初始化实时跟单视图
    switchSimMode('real')
  }
}

// ══════════════════════════════════════════
// 模拟交易回测
// ══════════════════════════════════════════
async function runSimulation() {
  const btn = document.getElementById('simRunBtn')
  const loading = document.getElementById('simLoading')
  if (btn) btn.disabled = true
  if (loading) loading.style.display = 'block'

  try {
    const interval = document.getElementById('simInterval')?.value || '15m'
    const barsCount = parseInt(document.getElementById('simBars')?.value || '500')
    const initBal = parseFloat(document.getElementById('simInitBalance')?.value || '100')
    const minScore = parseInt(document.getElementById('simMinScore')?.value || '5')
    const leverage = parseInt(document.getElementById('simLeverage')?.value || '20')
    const trendFilter = document.getElementById('simTrendFilter')?.checked !== false

    // 拉取历史K线（fetchKlines 在 app.js 里定义，通过 window.fetchKlines 访问）
    const fetchFn = window.fetchKlines || (window.BTCKlines && window.BTCKlines.fetchKlines)
    if (!fetchFn) { alert('数据模块未加载，请刷新重试'); return }
    const bars = await fetchFn(interval, barsCount)
    if (!bars || bars.length < 65) {
      alert('数据太少（至少需要65根K线），请增加K线数量')
      return
    }

    // 重置并传入自定义参数
    window.SimTrader.reset(initBal, {
      SIGNAL_MIN_SCORE: minScore,
      LEVERAGE: leverage,
      TREND_FILTER: trendFilter,
    })

    const result = window.SimTrader.runBacktest(bars)
    if (result.error) { alert(result.error); return }
    if (!result.stats || result.stats.total === 0) {
      alert('回测期间未发现符合条件的信号，建议降低最低分或增加K线数量')
      return
    }

    const stats = result.stats
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
    const setColor = (id, val, isGood) => {
      const el = document.getElementById(id)
      if (!el) return
      el.textContent = val
      el.style.color = isGood ? '#22c55e' : '#ef4444'
    }

    // ── 账户概览 ──
    const finalBal = parseFloat(stats.finalBalance)
    const pnlPct = ((finalBal - initBal) / initBal * 100).toFixed(1)
    setEl('simBalance', finalBal.toFixed(2))
    setColor('simTotalPnl', (pnlPct >= 0 ? '+' : '') + pnlPct + '%', pnlPct >= 0)
    setEl('simWinRate', stats.winRate)
    setEl('simTrades', stats.total + '笔')
    setEl('simPF', stats.profitFactor)
    setEl('simMaxDD', stats.maxDrawdown)

    // ── 多空分析 ──
    setEl('simLongRate', `${stats.longWinRate}（${stats.longTrades || 0}笔）`)
    setEl('simShortRate', `${stats.shortWinRate}（${stats.shortTrades || 0}笔）`)
    setColor('simAvgWin', '+' + parseFloat(stats.avgWin).toFixed(3) + 'U', true)
    setColor('simAvgLoss', '-' + parseFloat(stats.avgLoss).toFixed(3) + 'U', false)
    setEl('simFinalBal', finalBal.toFixed(2) + 'U')
    setEl('simTotalFee', '手续费消耗: -' + parseFloat(stats.totalFee).toFixed(3) + 'U')
    const dirCard = document.getElementById('simDirectionCard')
    if (dirCard) dirCard.style.display = 'block'

    // ── 交易记录渲染 ──
    const tradesList = document.getElementById('simTradesList')
    const tradesSection = document.getElementById('simTradesSection')
    const trades = stats.completedTrades

    // ★ 周月统计卡
    const periodCard = document.getElementById('simPeriodStatsCard')
    if (periodCard && stats.week) {
      periodCard.innerHTML = `
        <div class="sim-period-stats">
          <div class="period-item">
            <div class="period-label">📅 本周</div>
            <div class="period-vals">
              <span class="pv-trades">${stats.week.trades || 0}笔</span>
              <span class="pv-rate" style="color: ${parseFloat(stats.week.winRate || 0) >= 50 ? '#22c55e' : '#ef4444'}">
                ${stats.week.winRate} (${stats.week.wins || 0}胜)
              </span>
              <span class="pv-pnl" style="color: ${parseFloat(stats.week.pnl || 0) >= 0 ? '#22c55e' : '#ef4444'}">
                ${parseFloat(stats.week.pnl || 0) >= 0 ? '+' : ''}${parseFloat(stats.week.pnl || 0).toFixed(3)}U
              </span>
            </div>
          </div>
          <div class="period-item">
            <div class="period-label">📆 本月</div>
            <div class="period-vals">
              <span class="pv-trades">${stats.month.trades || 0}笔</span>
              <span class="pv-rate" style="color: ${parseFloat(stats.month.winRate || 0) >= 50 ? '#22c55e' : '#ef4444'}">
                ${stats.month.winRate} (${stats.month.wins || 0}胜)
              </span>
              <span class="pv-pnl" style="color: ${parseFloat(stats.month.pnl || 0) >= 0 ? '#22c55e' : '#ef4444'}">
                ${parseFloat(stats.month.pnl || 0) >= 0 ? '+' : ''}${parseFloat(stats.month.pnl || 0).toFixed(3)}U
              </span>
            </div>
          </div>
        </div>
      `
      periodCard.style.display = 'block'
    }

    setEl('simTradesCount', `共${trades.length}笔  胜${stats.wins}负${stats.losses}`)
    if (tradesSection) tradesSection.style.display = 'block'

    if (tradesList) {
      // 倒序（最新在最前）
      tradesList.innerHTML = [...trades].reverse().map((t, idx) => {
        const isWin = t.win
        const winColor = isWin ? '#22c55e' : '#ef4444'
        const isLong = t.direction.includes('多')
        const dirColor = isLong ? '#ef4444' : '#22c55e'   // 中国习惯：涨红跌绿
        const pnlSign = t.totalPnl >= 0 ? '+' : ''
        const trendBadge = t.trend || ''
        const scoreStars = '⭐'.repeat(Math.min(Math.round((t.score || 0) / 2), 5))

        // 出场原因颜色
        const exitColor = t.exitReasonStr && t.exitReasonStr.includes('止损') ? '#ef4444'
                        : t.exitReasonStr && t.exitReasonStr.includes('TP3') ? '#f59e0b'
                        : '#22c55e'

        return `<div class="sim-trade-card ${isWin ? 'sim-win' : 'sim-loss'}" onclick="toggleTradeDetail(this)">
          <!-- 头部：方向+评分+盈亏 -->
          <div class="sim-trade-header">
            <span class="sim-trade-dir" style="color:${dirColor}">${t.direction} ${scoreStars}</span>
            <span class="sim-trade-trend">${trendBadge}</span>
            <span class="sim-trade-pnl" style="color:${winColor}">${pnlSign}${parseFloat(t.totalPnl).toFixed(3)}U</span>
          </div>
          <!-- 时间行 -->
          <div class="sim-trade-times">
            <span class="sim-t-label">开仓</span>
            <span class="sim-t-val">${t.entryTime}</span>
            <span class="sim-t-arrow">→</span>
            <span class="sim-t-label">平仓</span>
            <span class="sim-t-val">${t.exitTime}</span>
          </div>
          <!-- 价格行 -->
          <div class="sim-trade-prices">
            <span class="sim-p-entry">入 ${t.entryPrice}</span>
            <span class="sim-p-sl">止损 ${t.sl}</span>
            <span class="sim-p-exit" style="color:${exitColor}">出 ${t.exitPrice}</span>
          </div>
          <!-- 出场原因 -->
          <div class="sim-trade-exit-row">
            <span class="sim-exit-reason" style="color:${exitColor}">📌 ${t.exitReasonStr || t.reason}</span>
            <span class="sim-trade-bal">余额 ${parseFloat(t.balance).toFixed(2)}U</span>
          </div>
          <!-- 折叠详情 -->
          <div class="sim-trade-detail" style="display:none;">
            <div class="sim-detail-row">
              <span class="sim-dl">RSI</span><span class="sim-dv">${t.rsi || '--'}</span>
              <span class="sim-dl">TP1</span><span class="sim-dv">${t.tp1}</span>
              <span class="sim-dl">TP2</span><span class="sim-dv">${t.tp2}</span>
              <span class="sim-dl">TP3</span><span class="sim-dv">${t.tp3}</span>
            </div>
            <div class="sim-reasons">
              <div class="sim-reasons-hit">✅ ${t.entryReasons || '未记录'}</div>
              ${t.misses ? `<div class="sim-reasons-miss">❌ ${t.misses}</div>` : ''}
            </div>
          </div>
        </div>`
      }).join('')
    }

    // ── K线标注 ──
    if (result.signals && window.CanvasChart) {
      window._chartSignals = result.signals
      if (window.CanvasChart.redraw) window.CanvasChart.redraw()
    }

  } catch(e) {
    console.error('[SimTrader]', e)
    alert('回测失败: ' + e.message + '\n' + e.stack)
  } finally {
    if (btn) btn.disabled = false
    if (loading) loading.style.display = 'none'
  }
}

// 展开/收起交易详情
function toggleTradeDetail(card) {
  const detail = card.querySelector('.sim-trade-detail')
  if (detail) detail.style.display = detail.style.display === 'none' ? 'block' : 'none'
}
window.toggleTradeDetail = toggleTradeDetail

// ══════════════════════════════════════════
// K线 BOLL/MACD 切换
// ══════════════════════════════════════════
function toggleBollMacd(type) {
  if (!window.CanvasChart) return
  if (type === 'boll') {
    window.CanvasChart.toggleBoll()
    const btn = document.getElementById('toggleBollBtn')
    if (btn) btn.style.opacity = btn.style.opacity === '0.4' ? '1' : '0.4'
  } else if (type === 'macd') {
    window.CanvasChart.toggleMacd()
    const btn = document.getElementById('toggleMacdBtn')
    if (btn) btn.style.opacity = btn.style.opacity === '0.4' ? '1' : '0.4'
  }
}

// ══════════════════════════════════════════
// 模拟账户 - 实时跟单
// ══════════════════════════════════════════
let _realSimMode = 'real'  // 'real' | 'back'

function switchSimMode(mode) {
  _realSimMode = mode
  document.getElementById('simRealPanel').style.display = mode === 'real' ? 'block' : 'none'
  document.getElementById('simBackPanel').style.display = mode === 'back' ? 'block' : 'none'
  // 按钮样式
  document.getElementById('simModeReal').style.background = mode === 'real' ? '#3b82f6' : 'rgba(148,163,184,0.15)'
  document.getElementById('simModeReal').style.color = mode === 'real' ? '#fff' : '#94a3b8'
  document.getElementById('simModeBack').style.background = mode === 'back' ? '#3b82f6' : 'rgba(148,163,184,0.15)'
  document.getElementById('simModeBack').style.color = mode === 'back' ? '#fff' : '#94a3b8'
  if (mode === 'real') _renderRealSimPage()
}

function _getRealSimState() {
  const saved = localStorage.getItem('real_sim_state')
  if (saved) return JSON.parse(saved)
  const initBal = parseFloat(document.getElementById('realSimBalance')?.value || 100)
  return {
    balance: initBal,
    initBalance: initBal,
    trades: [],
    currentPos: null,
  }
}

function _saveRealSimState(state) {
  localStorage.setItem('real_sim_state', JSON.stringify(state))
}

function resetRealSim() {
  const initBal = parseFloat(document.getElementById('realSimBalance')?.value || 100)
  const state = { balance: initBal, initBalance: initBal, trades: [], currentPos: null }
  _saveRealSimState(state)
  _renderRealSimPage()
}

// 信号触发时，自动开仓（在 autoSaveSignalRecord 里调用）
function _openRealSimPos(result, price) {
  const state = _getRealSimState()
  if (state.currentPos) return  // 已有持仓，不重复开
  const leverage = parseInt(document.getElementById('realSimLeverage')?.value || 10)
  const isLong = result.type === 'long'
  const tl = result.tradeLevels || {}
  const sl = tl.stopLoss || (isLong ? price * 0.995 : price * 1.005)
  const tp1 = tl.takeProfits?.[0] || (isLong ? price * 1.008 : price * 0.992)
  const tp2 = tl.takeProfits?.[1] || (isLong ? price * 1.015 : price * 0.985)
  state.currentPos = {
    id: 'pos_' + Date.now(),
    direction: result.type,
    entry: price,
    sl, tp1, tp2,
    leverage,
    size: state.balance * 0.5 * leverage,  // 50%仓位
    openTime: new Date().toLocaleString('zh-CN'),
    signalId: result.id || '',
    score: result.signalConfidence || 0,  // 正数=做多，负数=做空
  }
  _saveRealSimState(state)
  _renderRealSimPage()
}

function closeRealPos(closeType) {
  const state = _getRealSimState()
  if (!state.currentPos) return
  const pos = state.currentPos
  const entry = pos.entry
  const isLong = pos.direction === 'long'
  let exitPrice
  if (closeType === 'tp1') exitPrice = pos.tp1
  else if (closeType === 'tp2') exitPrice = pos.tp2
  else exitPrice = pos.sl  // sl
  const pricePct = isLong ? (exitPrice - entry) / entry : (entry - exitPrice) / entry
  const pnl = pos.size / pos.leverage * pos.leverage * pricePct * 0.9992  // 含手续费
  state.balance += pnl
  state.currentPos = null
  const trade = {
    id: pos.id,
    direction: pos.direction,
    entry: pos.entry,
    exit: exitPrice,
    closeType,
    pnl: parseFloat(pnl.toFixed(2)),
    openTime: pos.openTime,
    closeTime: new Date().toLocaleString('zh-CN'),
    score: pos.score,
  }
  state.trades.unshift(trade)
  _saveRealSimState(state)
  // 同步到历史记录的盈亏
  _renderRealSimPage()
  _updateSimAccount(state)
}

function _syncToRealSim(rec) {
  if (!rec.closePnl) return
  const state = _getRealSimState()
  state.balance += rec.closePnl
  _saveRealSimState(state)
  _renderRealSimPage()
  _updateSimAccount(state)
}

function _updateSimAccount(state) {
  const trades = state.trades || []
  const wins = trades.filter(t => t.pnl > 0)
  const total = trades.length
  const winRate = total > 0 ? Math.round(wins.length / total * 100) : '--'
  const totalPnl = ((state.balance - state.initBalance) / state.initBalance * 100).toFixed(1)
  const totalPnlAbs = (state.balance - state.initBalance).toFixed(2)
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const losses = trades.filter(t => t.pnl <= 0)
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0
  const pf = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '--'
  // 最大回撤
  let peak = state.initBalance, maxDD = 0
  let runBal = state.initBalance
  ;[...trades].reverse().forEach(t => { runBal += t.pnl; if (runBal > peak) peak = runBal; const dd = (peak - runBal) / peak * 100; if (dd > maxDD) maxDD = dd })

  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v }
  setEl('simBalance', state.balance.toFixed(2))
  const pnlEl = document.getElementById('simTotalPnl')
  if (pnlEl) {
    pnlEl.textContent = (totalPnl >= 0 ? '+' : '') + totalPnl + '%'
    pnlEl.style.color = totalPnl >= 0 ? '#4ade80' : '#ef4444'
  }
  setEl('simWinRate', winRate + (typeof winRate === 'number' ? '%' : ''))
  setEl('simTrades', total)
  setEl('simPF', pf)
  setEl('simMaxDD', maxDD.toFixed(1) + '%')
}

function _renderRealSimPage() {
  const state = _getRealSimState()
  _updateSimAccount(state)

  // 当前持仓
  const posSection = document.getElementById('realCurrentPos')
  const posContent = document.getElementById('realCurrentPosContent')
  if (state.currentPos && posSection && posContent) {
    posSection.style.display = 'block'
    const p = state.currentPos
    const isLong = p.direction === 'long'
    posContent.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <div><span style="color:#64748b;">方向</span> <b style="color:${isLong?'#ef4444':'#22c55e'}">${isLong?'📈 做多':'📉 做空'}</b></div>
        <div><span style="color:#64748b;">入场价</span> <b>$${p.entry.toFixed(0)}</b></div>
        <div><span style="color:#64748b;">止损</span> <b style="color:#ef4444;">$${p.sl.toFixed(0)}</b></div>
        <div><span style="color:#64748b;">TP1</span> <b style="color:#4ade80;">$${p.tp1.toFixed(0)}</b></div>
        <div><span style="color:#64748b;">TP2</span> <b style="color:#4ade80;">$${p.tp2.toFixed(0)}</b></div>
        <div><span style="color:#64748b;">开仓时间</span> ${p.openTime}</div>
      </div>
    `
  } else if (posSection) {
    posSection.style.display = 'none'
  }

  // 交易记录
  const listEl = document.getElementById('realTradesList')
  const countEl = document.getElementById('realTradesCount')
  if (!listEl) return
  const trades = state.trades || []
  if (countEl) countEl.textContent = '共' + trades.length + '笔'
  if (trades.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;color:#475569;font-size:13px;padding:30px;">等待信号触发，自动记录...</div>'
    return
  }
  listEl.innerHTML = trades.map((t, i) => {
    const isLong = t.direction === 'long'
    const isWin = t.pnl > 0
    return `
    <div style="background:rgba(${isWin?'74,222,128':'239,68,68'},0.05);border:1px solid rgba(${isWin?'74,222,128':'239,68,68'},0.2);border-radius:12px;padding:12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:13px;font-weight:700;color:${isLong?'#ef4444':'#22c55e'}">${isLong?'▲ 做多':'▼ 做空'}</span>
        <span style="font-size:15px;font-weight:700;color:${isWin?'#4ade80':'#ef4444'}">${isWin?'+':''}${t.pnl.toFixed(2)} U</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:11px;color:#94a3b8;">
        <div>入场 $${t.entry.toFixed(0)}</div>
        <div>出场 $${t.exit.toFixed(0)}</div>
        <div>${t.closeType==='sl'?'🛑止损':t.closeType==='tp2'?'🎯TP2':'🎯TP1'}</div>
        <div colspan="3" style="font-size:10px;color:#475569;">${t.openTime}</div>
      </div>
    </div>`
  }).join('')
}

window.switchTab = switchTab
window.filterHistory = filterHistory
window.markRecord = markRecord
window.deleteRecord = deleteRecord
window.renderHistoryPage = renderHistoryPage
window.runSimulation = runSimulation
window.toggleBollMacd = toggleBollMacd
window.switchSimMode = switchSimMode
window.resetRealSim = resetRealSim
window.closeRealPos = closeRealPos

// ═══════════════════════════════════════════════════════
// 模拟账户面板更新函数
// ═══════════════════════════════════════════════════════

function updateSimulatorPanel() {
  if (!window.Simulator) return
  
  const stats = window.Simulator.getStats()
  const equity = window.Simulator.equity
  const balance = window.Simulator.balance
  const positions = window.Simulator.positions.length
  
  // 更新数值
  document.getElementById('simEquity').textContent = `$${equity.toFixed(2)}`
  document.getElementById('simBalance').textContent = `$${balance.toFixed(2)}`
  document.getElementById('simPositions').textContent = positions
  document.getElementById('simTotalTrades').textContent = stats.totalTrades
  
  // 性能指标
  const pnl = stats.totalPnL
  const roi = stats.roi
  
  const pnlEl = document.getElementById('simPnL')
  pnlEl.textContent = `$${pnl.toFixed(2)}`
  pnlEl.classList.remove('negative')
  if (pnl < 0) pnlEl.classList.add('negative')
  
  const roiEl = document.getElementById('simROI')
  roiEl.textContent = `${roi.toFixed(1)}%`
  roiEl.style.color = roi >= 0 ? '#10b981' : '#ef4444'
  
  const wrEl = document.getElementById('simWinRate')
  wrEl.textContent = stats.winRate > 0 ? `${stats.winRate}% (${stats.wins}/${stats.totalTrades})` : '--'
  
  // 分数统计
  const scoreStats = stats.byScore
  const scoreSummary = [
    scoreStats.excellent.count > 0 ? `优85+: ${scoreStats.excellent.count}/${scoreStats.excellent.winRate}%` : null,
    scoreStats.strong.count > 0 ? `强70+: ${scoreStats.strong.count}/${scoreStats.strong.winRate}%` : null,
    scoreStats.normal.count > 0 ? `中50+: ${scoreStats.normal.count}/${scoreStats.normal.winRate}%` : null
  ].filter(Boolean).join(' | ') || '--'
  
  document.getElementById('simScoreStat').textContent = scoreSummary
  
  console.log('[Sim] 面板已更新:', stats)
}

// ═══════════════════════════════════════════════════════
// 交易系统V1 - 新UI更新函数
// ═══════════════════════════════════════════════════════

// 交易会话状态
let tradeSessionActive = false
let sessionInitialBalance = 100 // 本轮初始余额

// 获取保存的余额设置
function getSavedBalance() {
  const saved = localStorage.getItem('trade_balance')
  return saved ? parseFloat(saved) : 100
}

// 获取保存的杠杆设置
function getSavedLeverage() {
  const saved = localStorage.getItem('trade_leverage')
  return saved ? parseInt(saved) : 20
}

// 保存余额设置
function saveBalance(value) {
  localStorage.setItem('trade_balance', value.toString())
}

// 保存杠杆设置
function saveLeverage(value) {
  localStorage.setItem('trade_leverage', value.toString())
}

// 切换交易会话（开始/重新开始）
function toggleTradeSession() {
  const btn = document.getElementById('startTradeBtn')
  const btnText = document.getElementById('startBtnText')
  
  if (!tradeSessionActive) {
    // 开始新会话
    const balanceInput = document.getElementById('tradeBalance')
    const leverageInput = document.getElementById('tradeLeverage')
    
    const newBalance = parseFloat(balanceInput.value) || 100
    const leverage = parseInt(leverageInput.value) || 20
    
    // 保存设置
    saveBalance(newBalance)
    saveLeverage(leverage)
    
    // 设置Simulator余额
    if (window.Simulator) {
      window.Simulator.balance = newBalance
      window.Simulator.equity = newBalance
      window.Simulator.positions = []
      window.Simulator.save()
    }
    
    sessionInitialBalance = newBalance
    tradeSessionActive = true
    
    btn.classList.add('active')
    btnText.textContent = '⏹ 停止'
    
    // 更新SimTrader的杠杆设置
    if (window.SimTrader) {
      window.SimTrader.PARAMS.LEVERAGE = leverage
    }
    
    console.log(`[Trade] 会话开始 - 余额: ${newBalance}U, 杠杆: ${leverage}×`)
  } else {
    // 停止会话（不重置数据，累计统计）
    tradeSessionActive = false
    
    btn.classList.remove('active')
    btnText.textContent = '🚀 开始'
    
    console.log('[Trade] 会话暂停 - 数据已累计保存')
  }
  
  updateTradeV1UI()
}

// 加钱弹窗
function addMoney() {
  const modal = document.getElementById('addMoneyModal')
  const input = document.getElementById('addMoneyInput')
  if (modal) {
    modal.classList.add('show')
    if (input) {
      input.value = ''
      input.focus()
    }
  }
}

// 确认加钱
function confirmAddMoney() {
  const input = document.getElementById('addMoneyInput')
  const amount = parseFloat(input.value) || 0
  
  if (amount <= 0) {
    alert('请输入有效金额')
    return
  }
  
  if (window.Simulator) {
    window.Simulator.balance += amount
    window.Simulator.equity += amount
    window.Simulator.save()
    
    // 同时更新会话初始余额
    sessionInitialBalance += amount
    
    // 更新余额输入框
    const balanceInput = document.getElementById('tradeBalance')
    if (balanceInput) {
      balanceInput.value = window.Simulator.balance.toFixed(2)
      saveBalance(window.Simulator.balance)
    }
    
    updateTradeV1UI()
    console.log(`[Trade] 加钱成功: +${amount}U, 当前余额: ${window.Simulator.balance.toFixed(2)}U`)
  }
  
  closeAddMoneyModal()
}

// 关闭加钱弹窗
function closeAddMoneyModal() {
  const modal = document.getElementById('addMoneyModal')
  if (modal) {
    modal.classList.remove('show')
  }
}

// 初始化交易设置UI
function initTradeSettings() {
  // 读取保存的设置
  const savedBalance = getSavedBalance()
  const savedLeverage = getSavedLeverage()
  
  const balanceInput = document.getElementById('tradeBalance')
  const leverageInput = document.getElementById('tradeLeverage')
  
  if (balanceInput) {
    balanceInput.value = savedBalance
  }
  
  if (leverageInput) {
    leverageInput.value = savedLeverage
  }
  
  // 如果Simulator已加载，设置其余额
  if (window.Simulator) {
    window.Simulator.balance = savedBalance
    window.Simulator.equity = savedBalance
    sessionInitialBalance = savedBalance
  }
  
  // 设置杠杆
  if (window.SimTrader) {
    window.SimTrader.PARAMS.LEVERAGE = savedLeverage
  }
}

// 更新交易系统V1界面
function updateTradeV1UI() {
  if (!window.Simulator) return
  
  // 获取统计数据
  const stats = window.Simulator.getStats()
  
  // 获取当前余额
  const balance = window.Simulator.balance
  const pnl = balance - sessionInitialBalance
  const pnlPercent = sessionInitialBalance > 0 ? (pnl / sessionInitialBalance * 100) : 0
  
  // 更新余额
  const balanceEl = document.getElementById('simBalance')
  if (balanceEl) {
    balanceEl.textContent = balance.toFixed(2)
  }
  
  // 更新盈亏
  const pnlEl = document.getElementById('simPnL')
  if (pnlEl) {
    pnlEl.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + 'U'
    pnlEl.style.color = pnl >= 0 ? '#22c55e' : '#ef4444'
  }
  
  // 更新盈亏百分比
  const pnlPercentEl = document.getElementById('simPnLPercent')
  if (pnlPercentEl) {
    pnlPercentEl.textContent = (pnlPercent >= 0 ? '+' : '') + pnlPercent.toFixed(2) + '%'
    pnlPercentEl.style.color = pnlPercent >= 0 ? '#22c55e' : '#ef4444'
  }
  
  // 更新统计数据
  const totalTradesEl = document.getElementById('totalTrades')
  if (totalTradesEl) {
    totalTradesEl.textContent = stats.totalTrades || 0
  }
  
  const winRateEl = document.getElementById('winRate')
  if (winRateEl) {
    winRateEl.textContent = stats.winRate > 0 ? stats.winRate + '%' : '--%'
  }
  
  const totalWinEl = document.getElementById('totalWin')
  if (totalWinEl) {
    const wins = stats.wins || 0
    const avgWin = stats.avgWin || 0
    totalWinEl.textContent = '+' + (wins * avgWin).toFixed(2) + 'U'
  }
  
  const totalLossEl = document.getElementById('totalLoss')
  if (totalLossEl) {
    const losses = stats.losses || 0
    const avgLoss = stats.avgLoss || 0
    totalLossEl.textContent = '-' + Math.abs(losses * avgLoss).toFixed(2) + 'U'
  }
  
  // 更新持仓状态
  updatePositionCard()
  
  // 更新信号指示器
  updateSignalIndicator()
}

// 更新持仓卡片
function updatePositionCard() {
  if (!window.Simulator) return
  
  const positions = window.Simulator.positions
  const emptyEl = document.getElementById('positionEmpty')
  const infoEl = document.getElementById('positionInfo')
  
  if (positions.length === 0) {
    // 无持仓
    if (emptyEl) emptyEl.style.display = 'flex'
    if (infoEl) infoEl.style.display = 'none'
  } else {
    // 有持仓
    if (emptyEl) emptyEl.style.display = 'none'
    if (infoEl) {
      infoEl.style.display = 'block'
      
      const pos = positions[0]
      const dir = pos.direction === 'long' ? '做多' : '做空'
      const dirEl = document.getElementById('posDirection')
      if (dirEl) {
        dirEl.textContent = dir
        dirEl.className = 'position-direction ' + pos.direction
      }
      
      const entryEl = document.getElementById('posEntryPrice')
      if (entryEl) entryEl.textContent = pos.entryPrice.toFixed(2)
      
      const currentEl = document.getElementById('posCurrentPrice')
      if (currentEl) currentEl.textContent = window.currentPrice?.toFixed(2) || '--'
      
      // 计算盈亏
      const currentPrice = window.currentPrice || pos.entryPrice
      const pnl = pos.direction === 'long' 
        ? (currentPrice - pos.entryPrice) * pos.size 
        : (pos.entryPrice - currentPrice) * pos.size
      const pnlEl = document.getElementById('posPnL')
      if (pnlEl) {
        pnlEl.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + 'U'
        pnlEl.className = 'detail-value pnl ' + (pnl >= 0 ? '' : 'loss')
      }
      
      const slEl = document.getElementById('posSL')
      if (slEl) slEl.textContent = pos.stopLoss?.toFixed(2) || '--'
      
      const tp1El = document.getElementById('posTP1')
      if (tp1El) tp1El.textContent = pos.takeProfit1?.toFixed(2) || '--'
      
      const tp2El = document.getElementById('posTP2')
      if (tp2El) tp2El.textContent = pos.takeProfit2?.toFixed(2) || '--'
    }
  }
}

// 更新信号指示器
function updateSignalIndicator() {
  const signalEl = document.getElementById('currentSignal')
  if (!signalEl) return
  
  const dotEl = signalEl.querySelector('.signal-dot')
  const textEl = signalEl.querySelector('.signal-text')
  
  // 从评分系统获取当前信号
  const score = window.lastScore || 50
  const direction = window.lastDirection || ''
  
  if (score >= 70) {
    if (dotEl) {
      dotEl.className = 'signal-dot buy'
    }
    if (textEl) {
      textEl.textContent = '做多信号 (' + score + '分)'
      textEl.style.color = '#ef4444'
    }
  } else if (score <= 30) {
    if (dotEl) {
      dotEl.className = 'signal-dot sell'
    }
    if (textEl) {
      textEl.textContent = '做空信号 (' + score + '分)'
      textEl.style.color = '#22c55e'
    }
  } else {
    if (dotEl) {
      dotEl.className = 'signal-dot waiting'
    }
    if (textEl) {
      textEl.textContent = '等待信号...'
      textEl.style.color = '#94a3b8'
    }
  }
}

// 绑定事件
document.addEventListener('DOMContentLoaded', () => {
  // 初始化交易设置
  initTradeSettings()
  
  // 初始化交易系统V1
  setTimeout(() => {
    updateTradeV1UI()
  }, 500)
  
  // 定期更新
  setInterval(updateTradeV1UI, 2000)
})

// 查看详细统计
function showSimulatorStats() {
  if (!window.Simulator) return
  const stats = window.Simulator.getStats()
  const msg = `
📊 模拟交易统计 (100U账户)
━━━━━━━━━━━━━━━━━
📈 总权益: $${window.Simulator.equity.toFixed(2)}
💰 可用: $${window.Simulator.balance.toFixed(2)}
📍 持仓: ${window.Simulator.positions.length}
━━━━━━━━━━━━━━━━━
🎯 总交易: ${stats.totalTrades}笔
✅ 胜场: ${stats.wins}
❌ 负场: ${stats.losses}
📊 胜率: ${stats.winRate}%
━━━━━━━━━━━━━━━━━
💹 总收益: $${stats.totalPnL.toFixed(2)}
📈 ROI: ${stats.roi.toFixed(1)}%
━━━━━━━━━━━━━━━━━
按分数统计:
  🔴 优质(85+): ${stats.byScore.excellent.count}笔 | 胜率${stats.byScore.excellent.winRate}%
  🟠 强信(70+): ${stats.byScore.strong.count}笔 | 胜率${stats.byScore.strong.winRate}%
  🟡 中信(50+): ${stats.byScore.normal.count}笔 | 胜率${stats.byScore.normal.winRate}%
  `
  alert(msg)
}

// 重置账户
function resetSimulator() {
  if (!confirm('⚠️ 确认重置100U账户？所有交易记录将被删除')) return
  window.Simulator.reset()
  updateSimulatorPanel()
  alert('✅ 账户已重置为100U')
}

// 🐱 猫咪等待计时器 - 持久化到localStorage
const WAIT_TIME_KEY = 'signal_wait_seconds'
const LAST_SIGNAL_KEY = 'last_signal_time'
let catWaitTimer = null
let catWaitSeconds = parseInt(localStorage.getItem(WAIT_TIME_KEY) || '0')

function startCatWaitTimer() {
  if (catWaitTimer) clearInterval(catWaitTimer)
  
  // 从持久化存储恢复计时
  updateWaitTimeDisplay()
  
  catWaitTimer = setInterval(() => {
    catWaitSeconds++
    localStorage.setItem(WAIT_TIME_KEY, catWaitSeconds.toString())
    updateWaitTimeDisplay()
  }, 1000)
}

function updateWaitTimeDisplay() {
  const waitTimeEl = document.getElementById('waitTime')
  if (waitTimeEl) {
    const minutes = Math.floor(catWaitSeconds / 60)
    const seconds = catWaitSeconds % 60
    waitTimeEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`
  }
}

function resetCatWaitTimer() {
  catWaitSeconds = 0
  localStorage.setItem(WAIT_TIME_KEY, '0')
  updateWaitTimeDisplay()
}

function stopCatWaitTimer() {
  if (catWaitTimer) {
    clearInterval(catWaitTimer)
    catWaitTimer = null
  }
}

function updateLastSignalTime() {
  const records = JSON.parse(localStorage.getItem('signal_records') || '[]')
  const lastSignalEl = document.getElementById('lastSignalTime')
  
  if (records.length > 0) {
    const lastTime = records[0].timestamp
    const now = Date.now()
    const diffMinutes = Math.floor((now - lastTime) / 60000)
    
    if (diffMinutes < 60) {
      lastSignalEl.textContent = `${diffMinutes}分钟前`
    } else {
      lastSignalEl.textContent = '>1小时前'
    }
  } else {
    lastSignalEl.textContent = '从未'
  }
}

// 🐱 初始化猫咪等待区
function initBearHibernate() {
  const noSignalCard = document.getElementById('noSignalCard')
  if (noSignalCard && noSignalCard.style.display !== 'none') {
    startCatWaitTimer()
    updateLastSignalTime()
  }
}

// 每次信号更新时更新猫咪状态
function updateBearState() {
  const noSignalCard = document.getElementById('noSignalCard')
  if (noSignalCard && noSignalCard.style.display !== 'none') {
    // 正在显示猫咪区域，启动计时器
    if (!catWaitTimer) startCatWaitTimer()
    updateLastSignalTime()
  } else {
    // 隐藏猫咪区域，停止计时器
    stopCatWaitTimer()
  }
}

// 初始化模拟交易按钮 + 小熊计时器
document.addEventListener('DOMContentLoaded', () => {
  const viewBtn = document.getElementById('viewSimStats')
  const resetBtn = document.getElementById('resetSimBtn')
  
  if (viewBtn) viewBtn.addEventListener('click', showSimulatorStats)
  if (resetBtn) resetBtn.addEventListener('click', resetSimulator)
  
  // 初始化显示
  updateSimulatorPanel()
  
  // 初始化小熊
  setTimeout(initBearHibernate, 1000)
  
  // 每次更新UI后检查小熊状态
  const originalProcessSignalResult = processSignalResult
  processSignalResult = function(...args) {
    const result = originalProcessSignalResult.call(this, ...args)
    setTimeout(updateBearState, 100) // 延迟100ms确保DOM已更新
    setTimeout(updateOptimizationPanel, 200) // 更新优化验证面板
    return result
  }
  
  // 初始化优化验证面板
  setTimeout(() => {
    updateOptimizationPanel()
    const refreshBtn = document.getElementById('refreshOptimizationBtn')
    if (refreshBtn) refreshBtn.addEventListener('click', updateOptimizationPanel)
  }, 500)
})

// ═══════════════════════════════════════════════════════
// 优化验证面板 - 胜率追踪和版本对比
// ═══════════════════════════════════════════════════════

// 胜率追踪管理器
class WinRateTracker {
  constructor() {
    this.storageKey = 'btc_winrate_history'
    this.versionKey = 'btc_version_winrate'
    this.load()
  }
  
  load() {
    try {
      this.history = JSON.parse(localStorage.getItem(this.storageKey) || '[]')
      this.versionWinRates = JSON.parse(localStorage.getItem(this.versionKey) || '{}')
    } catch(e) {
      this.history = []
      this.versionWinRates = {}
      console.warn('[WinRate] 加载失败:', e)
    }
  }
  
  save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.history))
    localStorage.setItem(this.versionKey, JSON.stringify(this.versionWinRates))
  }
  
  // 记录交易结果
  recordTrade(trade) {
    if (!trade || !trade.result) return
    
    const record = {
      timestamp: new Date().toISOString(),
      version: window.BTCSignal?.VersionSystem?.currentVersion || 'unknown',
      signalType: trade.type,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      result: trade.result,
      pnl: trade.pnl || 0,
      pnlPercent: trade.pnlPercent || 0,
      score: trade.score || 0,
      signalQuality: trade.signalQuality || ''
    }
    
    this.history.push(record)
    
    // 清理过旧记录（保留最近1000条）
    if (this.history.length > 1000) {
      this.history = this.history.slice(-500)
    }
    
    this.updateVersionWinRate()
    this.save()
    
    console.log(`[WinRate] 记录交易: ${trade.result} 版本:${record.version}`)
  }
  
  // 更新版本胜率
  updateVersionWinRate() {
    const currentVersion = window.BTCSignal?.VersionSystem?.currentVersion || 'unknown'
    const versionTrades = this.history.filter(t => t.version === currentVersion)
    
    if (versionTrades.length === 0) return
    
    const wins = versionTrades.filter(t => t.result === 'win').length
    const winRate = versionTrades.length > 0 ? (wins / versionTrades.length * 100).toFixed(1) : 0
    
    this.versionWinRates[currentVersion] = {
      winRate: parseFloat(winRate),
      totalTrades: versionTrades.length,
      wins,
      losses: versionTrades.length - wins,
      lastUpdate: new Date().toISOString()
    }
  }
  
  // 获取版本对比数据
  getVersionComparison() {
    const versions = Object.keys(this.versionWinRates)
    if (versions.length < 2) return null
    
    // 按时间排序，取最近2个版本
    const sorted = versions.sort((a, b) => {
      const dateA = new Date(this.versionWinRates[a].lastUpdate || 0)
      const dateB = new Date(this.versionWinRates[b].lastUpdate || 0)
      return dateB - dateA
    })
    
    const currentVersion = sorted[0]
    const previousVersion = sorted[1] || sorted[0]
    
    const current = this.versionWinRates[currentVersion]
    const previous = this.versionWinRates[previousVersion]
    
    return {
      current: {
        version: currentVersion,
        winRate: current.winRate,
        totalTrades: current.totalTrades
      },
      previous: {
        version: previousVersion,
        winRate: previous.winRate,
        totalTrades: previous.totalTrades
      },
      improvement: current.winRate - previous.winRate
    }
  }
  
  // 获取胜率历史图表数据
  getWinRateHistory() {
    const versions = Object.keys(this.versionWinRates)
    return versions.map(v => ({
      version: v,
      winRate: this.versionWinRates[v].winRate,
      totalTrades: this.versionWinRates[v].totalTrades,
      date: this.versionWinRates[v].lastUpdate
    })).sort((a, b) => new Date(a.date) - new Date(b.date))
  }
}

// 创建全局胜率追踪器
window.WinRateTracker = new WinRateTracker()

// 更新优化验证面板
function updateOptimizationPanel() {
  try {
    // 更新当前版本胜率
    if (window.Simulator) {
      const stats = window.Simulator.getStats()
      const currentWinRateEl = document.getElementById('currentWinRate')
      const currentVersionNameEl = document.getElementById('currentVersionName')
      
      if (currentWinRateEl) {
        currentWinRateEl.textContent = stats.winRate ? `${stats.winRate}%` : '--%'
        currentWinRateEl.style.color = stats.winRate >= 50 ? '#10b981' : stats.winRate >= 40 ? '#f59e0b' : '#ef4444'
      }
      
      if (currentVersionNameEl && window.BTCSignal?.VersionSystem) {
        currentVersionNameEl.textContent = window.BTCSignal.VersionSystem.currentVersion
      }
    }
    
    // 获取版本对比数据
    const comparison = window.WinRateTracker.getVersionComparison()
    if (comparison) {
      const previousWinRateEl = document.getElementById('previousWinRate')
      const previousVersionNameEl = document.getElementById('previousVersionName')
      const summaryEl = document.getElementById('optimizationSummary')
      const historyEl = document.getElementById('versionWinRateHistory')
      
      if (previousWinRateEl) {
        previousWinRateEl.textContent = `${comparison.previous.winRate}%`
        previousWinRateEl.style.color = comparison.previous.winRate >= 50 ? '#10b981' : comparison.previous.winRate >= 40 ? '#f59e0b' : '#ef4444'
      }
      
      if (previousVersionNameEl) {
        previousVersionNameEl.textContent = comparison.previous.version
      }
      
      // 更新优化总结
      if (summaryEl) {
        const improvement = comparison.improvement
        let summary = ''
        
        if (improvement > 5) {
          summary = `<div style="color:#10b981;">✅ <strong>显著提升</strong>: 胜率提升${improvement.toFixed(1)}%</div>`
        } else if (improvement > 0) {
          summary = `<div style="color:#f59e0b;">↗️ <strong>小幅提升</strong>: 胜率提升${improvement.toFixed(1)}%</div>`
        } else if (improvement < -5) {
          summary = `<div style="color:#ef4444;">⚠️ <strong>有所下降</strong>: 胜率下降${Math.abs(improvement).toFixed(1)}%</div>`
        } else {
          summary = `<div style="color:#94a3b8;">➡️ <strong>基本持平</strong>: 变化${improvement.toFixed(1)}%</div>`
        }
        
        summary += `<div style="margin-top:8px;font-size:12px;color:#94a3b8;">`
        summary += `• 当前版本交易: ${comparison.current.totalTrades}笔<br>`
        summary += `• 前一版本交易: ${comparison.previous.totalTrades}笔<br>`
        summary += `• 胜率对比: ${comparison.current.winRate}% vs ${comparison.previous.winRate}%`
        summary += `</div>`
        
        summaryEl.innerHTML = summary
      }
      
      // 更新历史记录
      if (historyEl) {
        const history = window.WinRateTracker.getWinRateHistory()
        if (history.length > 0) {
          const historyHTML = history.map(h => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
              <div>
                <div style="font-size:12px;color:#f8fafc;">${h.version}</div>
                <div style="font-size:11px;color:#94a3b8;">${h.totalTrades}笔交易</div>
              </div>
              <div style="font-size:14px;font-weight:bold;color:${h.winRate >= 50 ? '#10b981' : '#ef4444'}">
                ${h.winRate}%
              </div>
            </div>
          `).join('')
          
          historyEl.innerHTML = historyHTML
        }
      }
    }
    
    // 监听Simulator交易记录
    if (window.Simulator && !window._winRateHooked) {
      window._winRateHooked = true
      const originalOpen = window.Simulator.openPosition
      const originalClose = window.Simulator.closePosition
      
      // 钩子函数：记录开仓
      window.Simulator.openPosition = function(...args) {
        const result = originalOpen.apply(this, args)
        if (result) {
          setTimeout(() => window.WinRateTracker.recordTrade({
            ...result,
            result: 'open',
            timestamp: new Date().toISOString()
          }), 100)
        }
        return result
      }
      
      // 钩子函数：记录平仓
      window.Simulator.closePosition = function(...args) {
        const result = originalClose.apply(this, args)
        if (result) {
          setTimeout(() => window.WinRateTracker.recordTrade(result), 100)
        }
        return result
      }
      
      console.log('[WinRate] 胜率追踪已启用')
    }

  } catch(e) {
    console.warn('[Optimization] 更新失败:', e)
  }
}

// ═══════════════════════════════════════════════════════════════
// 自动化交易系统 v2.0 - 统一模块
// ═══════════════════════════════════════════════════════════════

// 自动化交易状态管理
const AutoTrade = {
  // 存储键名
  STORAGE_KEY: 'auto_trade_state',
  TRADES_KEY: 'auto_trade_history',

  // 获取状态
  getState() {
    const saved = localStorage.getItem(this.STORAGE_KEY)
    if (saved) return JSON.parse(saved)
    return {
      initBalance: 100,
      balance: 100,
      currentPos: null,
      trades: [],
      lastSignalTime: 0,
    }
  },

  // 保存状态
  saveState(state) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state))
  },

  // 重置账户
  reset() {
    const initBalance = parseFloat(document.getElementById('atInitBalance')?.value) || 100
    const state = {
      initBalance,
      balance: initBalance,
      currentPos: null,
      trades: [],
      lastSignalTime: 0,
    }
    this.saveState(state)
    this.render()
  },

  // 开仓
  openPosition(direction, entryPrice, sl, tp1, tp2, score) {
    const state = this.getState()
    if (state.currentPos) return false // 已有持仓

    const leverage = parseInt(document.getElementById('atLeverage')?.value) || 20
    const posSize = state.balance * 0.5 * leverage // 50%仓位

    state.currentPos = {
      id: Date.now().toString(),
      direction,
      entry: entryPrice,
      sl,
      tp1,
      tp2,
      leverage,
      size: posSize,
      score,
      openTime: new Date().toLocaleString('zh-CN'),
    }

    this.saveState(state)
    this.render()
    return true
  },

  // 平仓
  closePosition(closeType) {
    const state = this.getState()
    if (!state.currentPos) return false

    const pos = state.currentPos
    const isLong = pos.direction === 'long'
    let exitPrice, exitReason

    if (closeType === 'tp1') {
      exitPrice = pos.tp1
      exitReason = 'TP1止盈'
    } else if (closeType === 'tp2') {
      exitPrice = pos.tp2
      exitReason = 'TP2止盈'
    } else {
      exitPrice = pos.sl
      exitReason = '止损'
    }

    // 计算盈亏
    const pricePct = isLong
      ? (exitPrice - pos.entry) / pos.entry
      : (pos.entry - exitPrice) / pos.entry

    const feeRate = 0.0005 // 手续费0.05%
    const pnl = (pos.size / pos.leverage) * pricePct - feeRate * pos.size

    // 记录交易
    const trade = {
      id: pos.id,
      direction: pos.direction,
      entry: pos.entry,
      exit: exitPrice,
      sl: pos.sl,
      tp1: pos.tp1,
      tp2: pos.tp2,
      leverage: pos.leverage,
      pnl: parseFloat(pnl.toFixed(2)),
      score: pos.score,
      closeType,
      closeReason: exitReason,
      openTime: pos.openTime,
      closeTime: new Date().toLocaleString('zh-CN'),
    }

    state.trades.unshift(trade)
    state.balance = parseFloat((state.balance + pnl).toFixed(2))
    state.currentPos = null

    this.saveState(state)
    this.render()
    return true
  },

  // 处理信号
  onSignal(score, direction, entryPrice, sl, tp1, tp2) {
    const state = this.getState()
    const autoOpen = document.getElementById('atAutoOpen')?.checked
    const notify = document.getElementById('atNotify')?.checked

    // 检查是否已有持仓
    if (state.currentPos) {
      console.log('[AutoTrade] 已有持仓，跳过开仓')
      return
    }

    // 检查信号冷却（5分钟）
    const now = Date.now()
    if (now - state.lastSignalTime < 5 * 60 * 1000) {
      console.log('[AutoTrade] 信号冷却中')
      return
    }

    // 自动开仓
    if (autoOpen && this.shouldOpen(score, direction)) {
      state.lastSignalTime = now
      this.openPosition(direction, entryPrice, sl, tp1, tp2, score)

      if (notify) {
        this.sendNotification(direction, score, entryPrice)
      }
    }
  },

  // 判断是否应该开仓
  shouldOpen(score, direction) {
    const longThreshold = parseInt(document.getElementById('atLongThreshold')?.value) || 60
    const shortThreshold = parseInt(document.getElementById('atShortThreshold')?.value) || -60

    if (direction === 'long' && score >= longThreshold) return true
    if (direction === 'short' && score <= shortThreshold) return true
    return false
  },

  // 发送通知
  sendNotification(direction, score, price) {
    if (typeof Android !== 'undefined' && Android.showNotification) {
      const title = direction === 'long' ? '🟢 做多信号' : '🔴 做空信号'
      const body = `评分: ${score}分 | 价格: $${price.toFixed(0)}`
      Android.showNotification(title, body)
    }
    console.log('[AutoTrade] 通知已发送:', direction, score)
  },

  // 获取统计数据
  getStats() {
    const state = this.getState()
    const trades = state.trades
    const total = trades.length

    if (total === 0) {
      return {
        winRate: '--',
        profitFactor: '--',
        maxDrawdown: '--',
        totalPnl: 0,
        totalPnlPct: 0,
        longStats: { rate: '--', count: 0 },
        shortStats: { rate: '--', count: 0 },
      }
    }

    const wins = trades.filter(t => t.pnl > 0)
    const winRate = Math.round(wins.length / total * 100)

    // 盈亏比
    const avgWin = wins.length > 0
      ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length
      : 0
    const losses = trades.filter(t => t.pnl <= 0)
    const avgLoss = losses.length > 0
      ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length)
      : 0
    const profitFactor = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '--'

    // 最大回撤
    let peak = state.initBalance, maxDD = 0
    let runBal = state.initBalance
    ;[...trades].reverse().forEach(t => {
      runBal += t.pnl
      if (runBal > peak) peak = runBal
      const dd = (peak - runBal) / peak * 100
      if (dd > maxDD) maxDD = dd
    })

    // 多空统计
    const longTrades = trades.filter(t => t.direction === 'long')
    const shortTrades = trades.filter(t => t.direction === 'short')
    const longWins = longTrades.filter(t => t.pnl > 0)
    const shortWins = shortTrades.filter(t => t.pnl > 0)

    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
    const totalPnlPct = (totalPnl / state.initBalance * 100).toFixed(2)

    return {
      winRate,
      profitFactor,
      maxDrawdown: maxDD.toFixed(1) + '%',
      totalPnl,
      totalPnlPct,
      longStats: {
        rate: longTrades.length > 0 ? Math.round(longWins.length / longTrades.length * 100) : '--',
        count: longTrades.length,
      },
      shortStats: {
        rate: shortTrades.length > 0 ? Math.round(shortWins.length / shortTrades.length * 100) : '--',
        count: shortTrades.length,
      },
    }
  },

  // 渲染界面
  render() {
    const state = this.getState()
    const stats = this.getStats()

    // 更新账户信息
    document.getElementById('atBalance').textContent = state.balance.toFixed(2)
    document.getElementById('atPnlValue').textContent =
      (stats.totalPnl >= 0 ? '+' : '') + stats.totalPnl.toFixed(2)
    document.getElementById('atPnlValue').style.color =
      stats.totalPnl >= 0 ? '#22c55e' : '#ef4444'
    document.getElementById('atPnlPercent').textContent =
      (parseFloat(stats.totalPnlPct) >= 0 ? '+' : '') + stats.totalPnlPct + '%'

    // 更新统计
    document.getElementById('atWinRate').textContent = stats.winRate !== '--' ? stats.winRate + '%' : '--'
    document.getElementById('atTotalTrades').textContent = state.trades.length
    document.getElementById('atProfitFactor').textContent = stats.profitFactor
    document.getElementById('atMaxDD').textContent = stats.maxDrawdown

    // 更新多空统计
    document.getElementById('atLongStats').textContent =
      `${stats.longStats.rate}% (${stats.longStats.count}笔)`
    document.getElementById('atShortStats').textContent =
      `${stats.shortStats.rate}% (${stats.shortStats.count}笔)`
    document.getElementById('atTotalPnl').textContent =
      (stats.totalPnl >= 0 ? '+' : '') + stats.totalPnl.toFixed(2) + ' U'
    document.getElementById('atTotalPnl').style.color =
      stats.totalPnl >= 0 ? '#22c55e' : '#ef4444'

    // 更新持仓卡片
    this.renderPosition()

    // 更新交易记录
    this.renderTrades()
  },

  // 渲染持仓
  renderPosition() {
    const state = this.getState()
    const posCard = document.getElementById('atPositionCard')
    const posInfo = document.getElementById('atPositionInfo')
    const posLevels = document.getElementById('atPositionLevels')

    if (!state.currentPos) {
      posCard.style.display = 'none'
      return
    }

    const pos = state.currentPos
    const isLong = pos.direction === 'long'

    posCard.style.display = 'block'
    posInfo.innerHTML = `
      <span class="at-dir-tag ${pos.direction}">${isLong ? '▲ 做多' : '▼ 做空'}</span>
      <span>入场: $${pos.entry.toFixed(0)}</span>
      <span>时间: ${pos.openTime}</span>
    `

    posLevels.innerHTML = `
      <span class="at-level-tag sl">SL ${pos.sl.toFixed(0)}</span>
      <span class="at-level-tag tp">TP1 ${pos.tp1.toFixed(0)}</span>
      <span class="at-level-tag tp">TP2 ${pos.tp2.toFixed(0)}</span>
      <span>评分 ${pos.score}分</span>
    `
  },

  // 渲染交易记录
  renderTrades() {
    const state = this.getState()
    const list = document.getElementById('atTradesList')
    const count = document.getElementById('atTradesCount')

    count.textContent = `共 ${state.trades.length} 笔`

    if (state.trades.length === 0) {
      list.innerHTML = '<div class="at-empty-state">等待信号触发，自动记录交易...</div>'
      return
    }

    list.innerHTML = state.trades.slice(0, 50).map(trade => {
      const isWin = trade.pnl > 0
      const isLong = trade.direction === 'long'

      return `
        <div class="at-trade-item ${trade.direction} ${isWin ? 'win' : 'loss'}">
          <div class="at-trade-header">
            <div class="at-trade-direction">
              <span class="at-dir-tag ${trade.direction}">${isLong ? '▲' : '▼'}</span>
              <span class="at-score-tag">${trade.score}分</span>
            </div>
            <span class="at-trade-pnl ${isWin ? 'win' : 'loss'}">
              ${isWin ? '+' : ''}${trade.pnl.toFixed(2)} U
            </span>
          </div>
          <div class="at-trade-time">${trade.openTime} → ${trade.closeTime}</div>
          <div class="at-trade-details">
            <span class="at-trade-detail">
              <span class="at-detail-label">入场:</span>
              <span>$${trade.entry.toFixed(0)}</span>
            </span>
            <span class="at-trade-detail">
              <span class="at-detail-label">出场:</span>
              <span>$${trade.exit.toFixed(0)}</span>
            </span>
            <span class="at-trade-detail">
              <span class="at-detail-label">${trade.closeReason}</span>
            </span>
          </div>
        </div>
      `
    }).join('')
  },
}

// 全局函数
function atResetAccount() {
  if (confirm('确认重置账户？所有交易记录将被清空。')) {
    AutoTrade.reset()
  }
}

function atClosePos(type) {
  AutoTrade.closePosition(type)
}

// 信号触发时调用
function onSignalTrigger(result, price) {
  if (!result || !result.type) return

  const score = result.signalConfidence || 0
  const direction = result.type
  const isLong = direction === 'long'

  // 获取止损止盈
  const sl = result.stopLoss || (isLong ? price * 0.995 : price * 1.005)
  const tp1 = result.takeProfit1 || (isLong ? price * 1.008 : price * 0.992)
  const tp2 = result.takeProfit2 || (isLong ? price * 1.015 : price * 0.985)

  AutoTrade.onSignal(score, direction, price, sl, tp1, tp2)
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // 加载保存的设置
  const savedSettings = localStorage.getItem('auto_trade_settings')
  if (savedSettings) {
    const settings = JSON.parse(savedSettings)
    if (settings.initBalance) document.getElementById('atInitBalance').value = settings.initBalance
    if (settings.leverage) document.getElementById('atLeverage').value = settings.leverage
    if (settings.longThreshold) document.getElementById('atLongThreshold').value = settings.longThreshold
    if (settings.shortThreshold) document.getElementById('atShortThreshold').value = settings.shortThreshold
    if (settings.autoOpen !== undefined) document.getElementById('atAutoOpen').checked = settings.autoOpen
    if (settings.notify !== undefined) document.getElementById('atNotify').checked = settings.notify
    if (settings.trendFilter !== undefined) document.getElementById('atTrendFilter').checked = settings.trendFilter
  }

  // 保存设置变化
  const saveSettings = () => {
    const settings = {
      initBalance: document.getElementById('atInitBalance')?.value,
      leverage: document.getElementById('atLeverage')?.value,
      longThreshold: document.getElementById('atLongThreshold')?.value,
      shortThreshold: document.getElementById('atShortThreshold')?.value,
      autoOpen: document.getElementById('atAutoOpen')?.checked,
      notify: document.getElementById('atNotify')?.checked,
      trendFilter: document.getElementById('atTrendFilter')?.checked,
    }
    localStorage.setItem('auto_trade_settings', JSON.stringify(settings))
  }

  // 绑定事件
  document.querySelectorAll('#atInitBalance, #atLeverage, #atLongThreshold, #atShortThreshold').forEach(el => {
    el.addEventListener('change', saveSettings)
  })
  document.querySelectorAll('#atAutoOpen, #atNotify, #atTrendFilter').forEach(el => {
    el.addEventListener('change', saveSettings)
  })

  // 初始化显示
  AutoTrade.render()

  // 每秒更新持仓状态
  setInterval(() => {
    const state = AutoTrade.getState()
    if (state.currentPos) {
      // 可以添加实时盈亏计算
      AutoTrade.render()
    }
  }, 1000)

  console.log('[AutoTrade] 自动化交易系统已初始化')
})