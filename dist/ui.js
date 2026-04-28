// UI交互逻辑 - 5维度100分制打分系统

// ★ 全局错误捕获 - 调试用
window.onerror = function(msg, url, line, col, err) {
  console.error('[全局错误]', msg, 'L' + line + ':' + col, err?.stack || '')
  const debugEl = document.getElementById('debugLog')
  if (debugEl) {
    debugEl.style.display = 'block'
    debugEl.textContent = '[ERROR L' + line + '] ' + msg
  }
}
window.addEventListener('unhandledrejection', function(e) {
  console.error('[未捕获Promise]', e.reason)
  const debugEl = document.getElementById('debugLog')
  if (debugEl) {
    debugEl.style.display = 'block'
    debugEl.textContent = '[Promise ERROR] ' + (e.reason?.message || e.reason)
  }
})

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

// ★ 自动推送记录系统（带历史记录和回测功能）
class AutoPushSystem {
  constructor() {
    // 推送历史记录 - 从localStorage加载
    const savedHistory = localStorage.getItem('push_history')
    this.pushHistory = savedHistory ? JSON.parse(savedHistory) : []
    
    // 清理过期记录（保留30天）
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    this.pushHistory = this.pushHistory.filter(push => push.time > monthAgo)
    
    // 保存到localStorage
    this.saveHistory()
  }
  
  // 保存历史记录到localStorage
  saveHistory() {
    localStorage.setItem('push_history', JSON.stringify(this.pushHistory))
  }
  
  // 记录推送
  recordPush(result, score, price) {
    const absScore = Math.abs(score)
    
    // 只记录60分以上的信号
    if (absScore < 60) {
      return
    }
    
    const isStrong = absScore >= 85
    
    // direction字段也区分级别：强信号=做多/做空，观察=偏多/偏空观察
    let dirText
    if (result.type === 'long') {
      dirText = isStrong ? '做多信号' : '偏多观察'
    } else {
      dirText = isStrong ? '做空信号' : '偏空观察'
    }
    
    const pushRecord = {
      id: Date.now().toString(),
      time: Date.now(),
      type: result.type,
      direction: dirText,
      score: score, // 保存原始分数，保留正负号
      price: price || result.bars?.[result.bars.length - 1]?.close,
      tradeLevels: result.tradeLevels,
      status: 'pending', // pending, success, failed
      result: null, // 后续可以记录交易结果
      profit: 0
    }
    
    this.pushHistory.unshift(pushRecord) // 添加到开头
    
    // 保留最近1000条记录
    if (this.pushHistory.length > 1000) {
      this.pushHistory = this.pushHistory.slice(0, 1000)
    }
    
    this.saveHistory()
    console.log(`[推送记录] 记录新信号: ${pushRecord.direction} ${pushRecord.score}分 @ ${pushRecord.price}`)
    
    // 触发通知
    this.sendNotification(pushRecord)
  }
  
  // 发送通知
  sendNotification(record) {
    const score = record.score || 0
    const absScore = Math.abs(score)
    const isLong = score > 0
    const isStrong = absScore >= 85
    
    // 根据分数确定通知标题 — 强信号🔥🔥突出，观察👁温和
    let title, emoji
    if (absScore >= 85) {
      emoji = isLong ? '🟢' : '🔴'
      title = isLong ? '🔥🔥 做多信号' : '🔥🔥 做空信号'
    } else if (absScore >= 60 && absScore < 85) {
      emoji = isLong ? '🔵' : '🟠'
      title = isLong ? '👁 偏多观察' : '👁 偏空观察'
    } else {
      // 60分以下不发送通知
      return
    }
    
    // 构建通知内容
    const content = `
📊 信号详情
分数: ${score}分
价格: $${record.price?.toFixed?.(2) || record.price}
时间: ${new Date(record.time).toLocaleString('zh-CN')}

🎯 交易计划
${record.tradeLevels?.entryZone ? `入场区间: $${record.tradeLevels.entryZone[0].toFixed(2)} - $${record.tradeLevels.entryZone[1].toFixed(2)}` : ''}
止损: $${record.tradeLevels?.stopLoss?.toFixed?.(2) || '--'}
${record.tradeLevels?.takeProfits?.[0] ? `止盈1: $${record.tradeLevels.takeProfits[0].toFixed(2)}` : ''}
${record.tradeLevels?.takeProfits?.[1] ? `止盈2: $${record.tradeLevels.takeProfits[1].toFixed(2)}` : ''}
${record.tradeLevels?.takeProfits?.[2] ? `止盈3: $${record.tradeLevels.takeProfits[2].toFixed(2)}` : ''}

📈 市场分析
支撑位: $${record.nearestSupport?.toFixed?.(2) || '无'}
阻力位: $${record.nearestResistance?.toFixed?.(2) || '无'}`
    
    console.log(`[通知] ${title}`)
    console.log(`[通知内容] ${content}`)
    
    // 浏览器环境：显示Toast
    if (typeof window !== 'undefined' && window.showToast) {
      window.showToast(`${title}\n${content}`)
    }
  }
  
  // 更新推送状态
  updatePushStatus(id, status, profit = 0) {
    const record = this.pushHistory.find(push => push.id === id)
    if (record) {
      record.status = status
      record.result = status
      record.profit = profit
      record.updateTime = Date.now()
      this.saveHistory()
      console.log(`[推送记录] 更新状态: ${id} -> ${status}, 利润: ${profit}`)
    }
  }
  
  // 获取推送统计
  getStats() {
    const total = this.pushHistory.length
    const success = this.pushHistory.filter(push => push.status === 'success').length
    const failed = this.pushHistory.filter(push => push.status === 'failed').length
    const winRate = total > 0 ? (success / total * 100).toFixed(1) : 0
    
    const longCount = this.pushHistory.filter(push => push.type === 'long').length
    const shortCount = this.pushHistory.filter(push => push.type === 'short').length
    
    const avgScore = total > 0 ? 
      (this.pushHistory.reduce((sum, push) => sum + push.score, 0) / total).toFixed(1) : 0
    
    const last7Days = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recentPushes = this.pushHistory.filter(push => push.time > last7Days)
    const recentSuccess = recentPushes.filter(push => push.status === 'success').length
    const recentWinRate = recentPushes.length > 0 ? 
      (recentSuccess / recentPushes.length * 100).toFixed(1) : 0
    
    return {
      total,
      success,
      failed,
      winRate,
      longCount,
      shortCount,
      avgScore,
      recentWinRate
    }
  }
  
  // 清空历史记录
  clearHistory() {
    this.pushHistory = []
    this.saveHistory()
    console.log('[推送记录] 历史记录已清空')
  }
  
  // 获取历史记录
  getHistory(limit = 50) {
    return this.pushHistory.slice(0, limit)
  }
  
  // 回测功能
  runBacktest(signals) {
    let correct = 0
    let total = 0
    
    signals.forEach(signal => {
      if (signal.type && signal.score >= 85) {
        // 简单回测逻辑：根据后续价格走势判断信号是否正确
        // 这里需要根据实际情况实现更复杂的回测逻辑
        total++
        // 假设如果信号方向与价格走势一致，则认为正确
        // 实际回测需要根据具体的价格数据和时间周期来判断
        correct++
      }
    })
    
    return {
      total,
      correct,
      winRate: total > 0 ? (correct / total * 100).toFixed(1) : 0
    }
  }
}

// 创建推送系统实例
const pushSystem = new AutoPushSystem()

// 更新推送管理界面数据
function updatePushManagementUI() {
  // 使用新的getStats方法获取统计数据
  const stats = pushSystem.getStats()
  
  // 更新界面（带null保护）
  const el = id => document.getElementById(id)
  if (el('totalPushes')) el('totalPushes').textContent = stats.total
  if (el('winCount')) el('winCount').textContent = stats.success
  if (el('lossCount')) el('lossCount').textContent = stats.failed
  if (el('winRate')) el('winRate').textContent = `${stats.winRate}%`
  if (el('recentWinRate')) el('recentWinRate').textContent = `${stats.recentWinRate}%`
  if (el('longShortRatio')) el('longShortRatio').textContent = `${stats.longCount} / ${stats.shortCount}`
  if (el('avgScore')) el('avgScore').textContent = stats.avgScore
  
  // 更新历史记录列表
  updatePushHistoryList()
}

// 更新推送历史记录列表
function updatePushHistoryList() {
  const historyList = document.getElementById('pushRecordsList')
  if (!historyList) return
  
  const history = pushSystem.getHistory(50)
  
  if (history.length === 0) {
    historyList.innerHTML = '<div class="push-history-empty">暂无推送记录</div>'
    return
  }
  
  historyList.innerHTML = history.map(record => {
    const time = new Date(record.time).toLocaleString('zh-CN')
    const statusClass = record.status === 'success' ? 'status-success' : record.status === 'failed' ? 'status-failure' : 'status-pending'
    
    return `
      <div class="push-record-item ${statusClass}">
        <div class="record-header">
          <div class="record-direction">
            <span class="direction-${record.type}">${record.direction}</span>
            <span class="record-score">${record.score}分</span>
          </div>
          <span class="record-time">${time}</span>
        </div>
        <div class="record-body">
          <div class="detail-row">
            <span class="detail-label">价格</span>
            <span class="detail-value">${record.price?.toFixed?.(2) || record.price}</span>
          </div>
          ${record.tradeLevels ? `
          <div class="detail-row">
            <span class="detail-label">止损</span>
            <span class="detail-value">${record.tradeLevels.stopLoss?.toFixed?.(2) || '--'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">止盈1</span>
            <span class="detail-value">${record.tradeLevels.takeProfits?.[0]?.toFixed?.(2) || '--'}</span>
          </div>
          ` : ''}
        </div>
      </div>
    `
  }).join('')
}

// 清空推送历史
function clearPushHistory() {
  pushSystem.clearHistory()
  updatePushManagementUI()
  showToast('推送历史已清空', 'success')
}

// 切换推送管理界面
function togglePushSection() {
  const content = document.getElementById('pushContent')
  const icon = document.getElementById('pushToggleIcon')
  if (content.style.display === 'none') {
    content.style.display = 'block'
    icon.textContent = '▼'
    updatePushManagementUI() // 显示时更新数据
  } else {
    content.style.display = 'none'
    icon.textContent = '▶'
  }
}

// 初始化推送管理界面
document.addEventListener('DOMContentLoaded', function() {
  // 绑定刷新按钮
  const refreshBtn = document.querySelector('.push-actions .btn-primary')
  if (refreshBtn) {
    refreshBtn.addEventListener('click', updatePushManagementUI)
  }
  
  // 绑定清空按钮
  const clearBtn = document.querySelector('.push-actions .btn-danger')
  if (clearBtn) {
    clearBtn.addEventListener('click', clearPushHistory)
  }
  
  // 初始更新
  updatePushManagementUI()
})

// ★ 变盘信号处理函数
window.onReversalSignal = function(reversalData) {
  console.log('[变盘提醒] 检测到变盘信号:', reversalData);
  
  // 触发强烈震动提醒
  if (typeof triggerVibration === 'function') {
    triggerVibration('TRIPLE_ALERT', 'Heavy');
  }
  
  // 创建变盘特别提醒
  showReversalAlert(reversalData);
  
  // 推送变盘通知
  pushReversalNotification(reversalData);
};

// 显示变盘特别提醒
function showReversalAlert(reversalData) {
  try {
    const alert = document.createElement('div');
    alert.className = 'reversal-alert';
    
    const directionText = reversalData.type === 'long' ? '做多' : '做空';
    const lastDirectionText = reversalData.lastType === 'long' ? '做多' : '做空';
    const directionIcon = reversalData.type === 'long' ? '📈' : '📉';
    const lastDirectionIcon = reversalData.lastType === 'long' ? '📈' : '📉';
    const score = Math.abs(reversalData.score);
    const scoreStars = '⭐'.repeat(Math.min(Math.ceil(score / 20), 5));
    
    alert.innerHTML = `
      <div class="reversal-header">
        <span class="reversal-icon">🚨</span>
        <span class="reversal-title">变盘信号</span>
        <span class="reversal-priority">紧急</span>
        <button class="reversal-close">×</button>
      </div>
      <div class="reversal-body">
        <div class="reversal-info">
          <span class="info-label">方向变化:</span>
          <span class="info-value">${lastDirectionIcon} ${lastDirectionText} → ${directionIcon} ${directionText}</span>
        </div>
        <div class="reversal-info">
          <span class="info-label">信号强度:</span>
          <span class="info-value">${score}分 ${scoreStars}</span>
        </div>
        <div class="reversal-info">
          <span class="info-label">时间:</span>
          <span class="info-value">${new Date(reversalData.timestamp).toLocaleString()}</span>
        </div>
        <div class="reversal-tips">
          <strong>操作建议:</strong>
          <ul>
            <li>🚨 立即检查当前持仓</li>
            <li>🛡️ 设置止损保护</li>
            <li>📊 准备反向开仓</li>
            <li>📈 关注成交量变化</li>
            <li>⏰ 密切关注市场动向</li>
          </ul>
        </div>
        <div class="reversal-warning">
          <strong>⚠️ 重要提醒:</strong> 变盘信号可能带来较大的价格波动，请谨慎操作！
        </div>
      </div>
      <div class="reversal-actions">
        <button class="reversal-action-btn primary" onclick="window.location.href='#trade'">交易面板</button>
        <button class="reversal-action-btn" onclick="window.location.href='#chart'">查看图表</button>
        <button class="reversal-action-btn" onclick="alert.remove()">关闭</button>
      </div>
    `;
    
    // 添加到页面
    document.body.appendChild(alert);
    
    // 添加关闭按钮事件
    const closeBtn = alert.querySelector('.reversal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        alert.style.opacity = '0';
        alert.style.transform = 'translateY(-50px)';
        setTimeout(() => alert.remove(), 300);
      });
    }
    
    // 添加动画效果
    setTimeout(() => {
      alert.style.opacity = '1';
      alert.style.transform = 'translateY(0)';
    }, 100);
    
    console.log('[变盘提醒] 特别提醒已显示');
  } catch (e) {
    console.warn('[变盘提醒] 显示失败:', e.message);
  }
}

// 推送变盘通知
function pushReversalNotification(reversalData) {
  const directionText = reversalData.type === 'long' ? '做多' : '做空';
  const lastDirectionText = reversalData.lastType === 'long' ? '做多' : '做空';
  const score = Math.abs(reversalData.score);
  const price = window._wsLastBar?.close || 0;
  const scoreStars = '⭐'.repeat(Math.min(Math.ceil(score / 20), 5));
  
  // 创建变盘信号对象
  const reversalSignal = {
    type: reversalData.type,
    signalStrength: reversalData.score,
    signalConfidence: reversalData.score,
    trend: reversalData.type === 'long' ? 'up' : 'down',
    bars: window._wsLastBar ? [window._wsLastBar] : [],
    isReversal: true,
    lastType: reversalData.lastType
  };
  
  // 构建变盘通知标题和内容
  const title = `🚨 变盘信号：${lastDirectionText} → ${directionText} ${score}分 ${scoreStars}`;
  const content = `
📊 变盘详情：
方向变化：${lastDirectionText} → ${directionText}
信号强度：${score}分 ${scoreStars}
当前价格：${price?.toFixed?.(2) || price}
时间：${new Date(reversalData.timestamp).toLocaleString()}

⚠️ 重要提醒：
变盘信号可能带来较大的价格波动，请立即检查持仓并设置止损保护！

操作建议：
1. 立即检查当前持仓
2. 设置止损保护
3. 准备反向开仓
4. 关注成交量变化
5. 密切关注市场动向`;
  
  // 使用新的推送系统记录变盘信号
  if (typeof pushSystem !== 'undefined' && pushSystem.recordPush) {
    pushSystem.recordPush(
      reversalSignal,
      `变盘信号：${directionText}`,
      reversalData.score,
      price
    );
  }
}

// 全局变量
let currentInterval = '15m'
let _wsChart = null  // 图表更新定时器
let _wsLastBar = null  // 最新K线数据
let _wsLastKlineTime = 0  // 上次K线时间戳
let countdownTimer = null

// 信号缓存，用于同步推送和UI显示
let signalCache = null
const SIGNAL_CACHE_DURATION = 60 * 1000 // 60秒缓存

document.addEventListener('DOMContentLoaded', function() {
  console.log('[DOMContentLoaded-2] 触发')
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
  console.log('BTC 5维度100分制交易系统 启动')
  
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
    const result = await fetchSignalData()
    if (result) {
      // 使用5维度打分系统的信号数据
      const score = result.signalConfidence || 0
      // 判断是否有信号
      const hasSignal = result.signalConfidence && result.signalConfidence !== 0
      
      // ★ 更新全局分数和方向（供updateSignalIndicator使用）
      window.lastScore = score
      window.lastDirection = result.type || ''
      
      console.log('[Data] 指标数据预热完成', hasSignal ? '有信号' : '无信号', '分数:', score)
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
    // 尝试Binance API
    const url = 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'
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
  if (!window.CanvasChart) {
    console.error('[Chart] CanvasChart 未加载，可能 canvas-chart.js 加载失败')
    _showChartError('图表库加载失败，请重启应用')
    return
  }
  try {
    window.CanvasChart.init('lwChartContainer')
    // 延迟一帧，等数据准备完毕
    setTimeout(async () => {
      try {
        if (window.fetchKlines) {
          const bars = await window.fetchKlines(currentInterval, 200)
          if (bars && bars.length > 0) {
            window.CanvasChart.setData(bars)
            console.log('[Chart] 数据加载成功，共', bars.length, '根K线')
          } else {
            _showChartError('数据加载失败：无数据')
          }
        } else {
          _showChartError('数据加载失败：fetchKlines 未定义')
        }
      } catch (e) {
        console.error('[Chart] 数据加载异常:', e)
        _showChartError('数据加载异常: ' + e.message)
      }
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
  console.log('[bindEvents] 开始绑定事件')
  // 免责声明同意按钮
  const agreeBtn = document.getElementById('agreeBtn')
  console.log('[bindEvents] agreeBtn:', agreeBtn ? 'FOUND' : 'NOT FOUND')
  agreeBtn.addEventListener('click', function() {
    console.log('[agreeBtn] 点击了！')
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

// 获取信号数据（5维度打分系统版本）
async function fetchSignalData() {
  const loadingEl = document.getElementById('loadingSection')
  const errorEl   = document.getElementById('errorSection')
  try {
    if (loadingEl) loadingEl.style.display = 'block'
    if (errorEl)   errorEl.style.display   = 'none'

    // 使用5维度打分系统
    if (!window.detectSignal) throw new Error('5维度检测器未加载，请重启App')
    const result = await window.detectSignal(currentInterval)

    processSignalResult(result)
    return result

  } catch (error) {
    console.error('数据获取失败:', error)
    showError('数据获取失败: ' + error.message)
    return null
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
    const score = result.signalConfidence || 0
    // 判断是否有信号
    const hasSignal = result.signalConfidence && result.signalConfidence !== 0
    
    // ★ 更新全局分数和方向（供updateSignalIndicator使用）
    window.lastScore = score
    window.lastDirection = result.type || ''
    
    if (window.updateScoreDial) {
      window.updateScoreDial(score, hasSignal, result.trend, result)
    }
  } catch(e) { console.warn('[score]', e) }

  // ── 更新猫咪表情状态 ──
  try { updateCatMood(result) } catch(e) { console.warn('[catMood]', e) }

  // ── 重要信息监控（插针、波动率等） ──
  try { updateImportantInfo(result) } catch(e) { console.warn('[importantInfo]', e) }

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
    
    // ★ 推送通知
    try {
      if (result.bars) {
        const price = result.bars[result.bars.length - 1].close
        const score = result.signalConfidence || 0
        const direction = result.type
        const isLong = direction === 'long'
        
        // 推送通知
        if (typeof pushSystem !== 'undefined' && pushSystem.recordPush) {
          pushSystem.recordPush(result, score, price)
        }
      }
    } catch(e) { console.warn('[Push] 推送失败:', e) }
    
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
        // 使用新的executeTrade方法（带随机间隔和委托拆分）
        window.Simulator.executeTrade(result, price).then(pos => {
          if (pos) {
            console.log('[Sim] 自动交易执行成功')
            updateSimulatorPanel()
          }
        }).catch(e => {
          console.warn('[Sim] 交易执行失败:', e)
        })
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

  // ── 启动倒计时 ──
  const score = Math.abs(result.signalConfidence || 0)
  if (isRealSignal && score >= 60) {
    startCountdown(result)
  } else {
    // 检查是否有有效的缓存信号
    const cache = getValidSignalCache()
    if (cache && Math.abs(cache.signalConfidence) >= 60) {
      startCountdown(cache)
    } else {
      // 无信号或分数低于60，隐藏倒计时
      const countdownEl = document.getElementById('signalCountdown')
      if (countdownEl) countdownEl.style.display = 'none'
      if (countdownTimer) {
        clearInterval(countdownTimer)
        countdownTimer = null
      }
    }
  }
  
  // ── 更新信号状态显示 ──
  try { displaySignalInfo(result) } catch(e) { console.warn('[displaySignal]', e) }
}

// 启动倒计时
function startCountdown(result) {
  // 清除之前的计时器
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  
  const startTime = Date.now()
  const duration = 120 * 1000 // 120秒
  
  // 显示倒计时元素
  const countdownEl = document.getElementById('signalCountdown')
  const countdownText = document.getElementById('countdownText')
  const countdownProgress = document.getElementById('countdownProgress')
  
  if (countdownEl) countdownEl.style.display = 'block'
  
  // 更新倒计时
  function updateCountdown() {
    const elapsed = Date.now() - startTime
    const remaining = Math.max(0, duration - elapsed)
    const seconds = Math.floor(remaining / 1000)
    const percentage = (remaining / duration) * 100
    
    // 更新文本和进度条
    if (countdownText) {
      countdownText.textContent = `信号有效期：${seconds}秒`
    }
    if (countdownProgress) {
      countdownProgress.style.width = `${percentage}%`
    }
    
    // 显示信号状态和止盈止损信息
    displaySignalInfo(result)
    
    // 倒计时结束
    if (remaining <= 0) {
      if (countdownEl) countdownEl.style.display = 'none'
      if (countdownTimer) {
        clearInterval(countdownTimer)
        countdownTimer = null
      }
    }
  }
  
  // 立即执行一次
  updateCountdown()
  
  // 设置计时器
  countdownTimer = setInterval(updateCountdown, 1000)
}

// 显示信号信息
function displaySignalInfo(result) {
  // 显示信号状态（做多/做空/观察）
  const directionIcon = document.getElementById('directionIcon')
  const directionText = document.getElementById('directionText')
  
  console.log('[DisplaySignal] signalConfidence:', result.signalConfidence, 'signalStrength:', result.signalStrength)
  
  if (directionIcon && directionText) {
    const signalConfidence = result.signalConfidence || 0
    const score = Math.abs(signalConfidence)
    const isLong = signalConfidence > 0
    
    console.log('[DisplaySignal] score:', score, 'isLong:', isLong)
    
    // 安全处理：确保分数在有效范围内
    if (score >= 85 && score <= 100) {
      // 85-100分：显示做多/做空信号
      directionIcon.textContent = isLong ? '🟢' : '🔴'
      directionText.textContent = isLong ? '做多信号' : '做空信号'
      console.log('[DisplaySignal] 显示: 做多/做空信号')
    } else if (score >= 60 && score < 85) {
      // 60-84分：显示偏多/偏空观察
      directionIcon.textContent = isLong ? '🟢' : '🔴'
      directionText.textContent = isLong ? '偏多观察' : '偏空观察'
      console.log('[DisplaySignal] 显示: 偏多/偏空观察')
    } else {
      // 60分以下：无信号或信号弱
      directionIcon.textContent = '⚪'
      directionText.textContent = '无信号'
      console.log('[DisplaySignal] 显示: 无信号')
    }
  }
  
  // 显示止盈止损信息
  const tradeLevels = result.tradeLevels
  if (tradeLevels) {
    // 入场区间
    const entryZone = document.getElementById('entryZone')
    if (entryZone && tradeLevels.entryZone && tradeLevels.entryZone.length === 2) {
      entryZone.textContent = `${tradeLevels.entryZone[0]} - ${tradeLevels.entryZone[1]}`
    } else if (entryZone && tradeLevels.entryLevel) {
      entryZone.textContent = tradeLevels.entryLevel
    }
    
    // 止损位
    const stopLoss = document.getElementById('stopLoss')
    if (stopLoss && tradeLevels.stopLoss) {
      stopLoss.textContent = tradeLevels.stopLoss
    }
    
    // 波动率
    const atrPercent = document.getElementById('atrPercent')
    if (atrPercent && tradeLevels.atrPercent) {
      atrPercent.textContent = tradeLevels.atrPercent + '%'
    }
    
    // 止盈目标
    if (tradeLevels.takeProfits && tradeLevels.takeProfits.length >= 3) {
      const tp1 = document.getElementById('tp1')
      const tp2 = document.getElementById('tp2')
      const tp3 = document.getElementById('tp3')
      
      if (tp1) tp1.textContent = tradeLevels.takeProfits[0]
      if (tp2) tp2.textContent = tradeLevels.takeProfits[1]
      if (tp3) tp3.textContent = tradeLevels.takeProfits[2]
    }
    
    // 支撑位 / 压力位
    if (result.nearestSupport !== undefined && result.nearestSupport !== null) {
      const supportEl = document.getElementById('nearestSupport')
      if (supportEl) supportEl.textContent = Math.round(result.nearestSupport * 100) / 100
    }
    if (result.nearestResistance !== undefined && result.nearestResistance !== null) {
      const resistanceEl = document.getElementById('nearestResistance')
      if (resistanceEl) resistanceEl.textContent = Math.round(result.nearestResistance * 100) / 100
    }
  }
  
  // 确保信号卡片显示
  const signalCard = document.getElementById('signalCard')
  if (signalCard) signalCard.style.display = 'block'
  
  // 隐藏无信号卡片
  const noSignalCard = document.getElementById('noSignalCard')
  if (noSignalCard) noSignalCard.style.display = 'none'
}

// 更新信号缓存
function updateSignalCache(result) {
  if (result.signalConfidence && result.signalConfidence !== 0) {
    signalCache = {
      signalConfidence: result.signalConfidence,
      type: result.type,
      timestamp: Date.now(),
      tradeLevels: result.tradeLevels,
      price: result.bars ? result.bars[result.bars.length - 1].close : 0
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

// 启动自动刷新
function startAutoRefresh() {
  // 每30秒自动刷新一次
  setInterval(() => {
    fetchSignalData()
  }, 30000)
}

// 初始化监控状态
function initMonitorStatus() {
  console.log('[Monitor] 初始化监控状态')
}

// 初始化猫咪表情
function initCatMood() {
  console.log('[CatMood] 初始化猫咪表情')
}

// 重置猫咪等待时间
function resetCatWaitTimer() {
  console.log('[CatMood] 重置等待时间')
}

// 更新猫咪表情
function updateCatMood(result) {
  console.log('[CatMood] 更新猫咪表情')
}

// 更新重要信息
function updateImportantInfo(result) {
  console.log('[Info] 更新重要信息')
}

// 更新趋势信息
function updateTrendInfo(result) {
  console.log('[Trend] 更新趋势信息')
}

// 更新信号信息
function updateSignalInfo(result) {
  console.log('[Signal] 更新信号信息')
}

// 更新指标
function updateIndicators(result) {
  console.log('[Indicators] 更新指标')
}

// 生成信号分析
function generateSignalAnalysis(result) {
  console.log('[Analysis] 生成信号分析')
}

// 自动保存信号记录
function autoSaveSignalRecord(result) {
  console.log('[AutoSave] 保存信号记录')
}

// 显示设置
function showSettings() {
  console.log('[Settings] 显示设置')
}

// 切换详情
function toggleDetails() {
  console.log('[Details] 切换详情')
}

// 显示错误
function showError(msg) {
  console.error('[Error]', msg)
  const errorEl = document.getElementById('errorSection')
  if (errorEl) {
    errorEl.style.display = 'block'
    errorEl.textContent = msg
  }
}

// 显示Toast
function showToast(msg, type = 'info') {
  console.log('[Toast]', msg)
}

// 更新模拟器面板
function updateSimulatorPanel() {
  console.log('[Simulator] 更新面板')
}

console.log('[UI] 5维度100分制交易系统UI已加载')
