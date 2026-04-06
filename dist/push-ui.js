// ══════════════════════════════════════════
// 推送管理UI模块 v1.0
// ══════════════════════════════════════════
let currentPushRecord = null

// 初始化推送管理界面
function initPushManagement() {
  // 初始化推送系统
  if (window.PushSystem) {
    window.PushSystem.init()
  }
  
  // 加载统计数据
  refreshPushStats()
  
  // 加载记录列表
  renderPushRecords()
  
  // 绑定事件
  bindPushEvents()
  
  console.log('推送管理界面已初始化')
}

// 刷新统计数据
function refreshPushStats() {
  if (!window.PushSystem) return
  
  const stats = window.PushSystem.getStatistics()
  
  // 更新统计卡片
  document.getElementById('totalPushes').textContent = stats.totalPushes
  document.getElementById('successCount').textContent = stats.successCount
  document.getElementById('failureCount').textContent = stats.failureCount
  document.getElementById('successRate').textContent = stats.successRate + '%'
  
  // 更新详细统计
  document.getElementById('pendingCount').textContent = stats.pendingCount
  document.getElementById('recentRate').textContent = stats.recentRate + '%'
  document.getElementById('longShortRatio').textContent = `${stats.longCount} / ${stats.shortCount}`
  document.getElementById('avgScore').textContent = stats.avgScore
  
  // 更新记录数量
  document.getElementById('recordsCount').textContent = `${stats.totalPushes} 条`
}

// 渲染推送记录列表
function renderPushRecords() {
  if (!window.PushSystem) return
  
  const records = window.PushSystem.getRecords()
  const container = document.getElementById('pushRecordsList')
  
  if (records.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无推送记录</div>'
    return
  }
  
  container.innerHTML = records.map(record => {
    const directionEmoji = record.direction === 'long' ? '📈' : '📉'
    const directionClass = record.direction === 'long' ? 'direction-long' : 'direction-short'
    const directionText = record.direction === 'long' ? '做多' : '做空'
    
    // 状态样式
    let statusClass = 'status-pending'
    let statusText = '等待中'
    
    if (record.status === window.PushSystem.STATUS.OPENED) {
      statusClass = 'status-opened'
      statusText = '已开单'
    } else if (record.status === window.PushSystem.STATUS.CLOSED) {
      if (record.result === window.PushSystem.RESULT.SUCCESS) {
        statusClass = 'status-closed-success'
        statusText = '成功'
      } else if (record.result === window.PushSystem.RESULT.FAILURE) {
        statusClass = 'status-closed-failure'
        statusText = '失败'
      } else {
        statusText = '已平仓'
      }
    } else if (record.status === window.PushSystem.STATUS.EXPIRED) {
      statusText = '已失效'
    }
    
    const timeStr = formatTimestamp(record.timestamp)
    
    return `
      <div class="push-record-item ${statusClass}" onclick="showPushDetail('${record.id}')">
        <div class="record-header">
          <div class="record-direction ${directionClass}">
            <span>${directionEmoji}</span>
            <span>${directionText}</span>
          </div>
          <div class="record-score">⭐ ${record.stars} / ${record.score}分</div>
        </div>
        <div class="record-content">
          <div class="record-field">
            <span class="field-label">开单</span>
            <span class="field-value">$${record.entryPrice?.toFixed(2) || '--'}</span>
          </div>
          <div class="record-field">
            <span class="field-label">目标</span>
            <span class="field-value">$${record.targetPrice?.toFixed(2) || '--'}</span>
          </div>
          <div class="record-field">
            <span class="field-label">止损</span>
            <span class="field-value">$${record.stopLoss?.toFixed(2) || '--'}</span>
          </div>
        </div>
        <div class="record-footer">
          <span class="record-time">${timeStr}</span>
          <span class="record-status ${statusClass}">${statusText}</span>
        </div>
      </div>
    `
  }).join('')
}

// 显示推送详情
function showPushDetail(recordId) {
  if (!window.PushSystem) return
  
  const records = window.PushSystem.getRecords()
  const record = records.find(r => r.id === recordId)
  
  if (!record) return
  
  currentPushRecord = record
  
  // 填充弹窗内容
  document.getElementById('modalTitle').textContent = '推送详情'
  
  const directionEmoji = record.direction === 'long' ? '📈' : '📉'
  const directionText = record.direction === 'long' ? '做多' : '做空'
  
  const modalBody = document.getElementById('modalBody')
  modalBody.innerHTML = `
    <div class="detail-section">
      <div class="detail-group">
        <div class="detail-label">方向</div>
        <div class="detail-value-large">${directionEmoji} ${directionText}</div>
      </div>
      <div class="detail-row">
        <div class="detail-item">
          <span class="detail-label">评分</span>
          <span class="detail-value">${record.score} / 100 ⭐${record.stars}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">时间</span>
          <span class="detail-value">${formatTimestamp(record.timestamp)}</span>
        </div>
      </div>
    </div>
    
    <div class="detail-section">
      <div class="detail-section-title">价格信息</div>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">开单价格</span>
          <span class="detail-value">$${record.entryPrice?.toFixed(2) || '--'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">目标价格</span>
          <span class="detail-value">$${record.targetPrice?.toFixed(2) || '--'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">止损价格</span>
          <span class="detail-value">$${record.stopLoss?.toFixed(2) || '--'}</span>
        </div>
      </div>
    </div>
    
    <div class="detail-section">
      <div class="detail-section-title">状态追踪</div>
      <div class="detail-row">
        <div class="detail-item">
          <span class="detail-label">当前状态</span>
          <span class="detail-value">${formatStatus(record.status, record.result)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">推送结果</span>
          <span class="detail-value">${formatResult(record.result)}</span>
        </div>
      </div>
    </div>
    
    ${record.userNotes ? `
      <div class="detail-section">
        <div class="detail-section-title">用户笔记</div>
        <div class="user-notes">${record.userNotes}</div>
      </div>
    ` : ''}
    
    <div class="detail-section">
      <div class="detail-section-title">推送消息</div>
      <div class="push-message">${record.pushMessage?.replace(/\n/g, '<br>') || '--'}</div>
    </div>
  `
  
  // 显示弹窗
  document.getElementById('pushDetailModal').classList.add('active')
}

// 格式化状态
function formatStatus(status, result) {
  if (!window.PushSystem) return status
  
  const statusMap = {
    [window.PushSystem.STATUS.PENDING]: '等待中',
    [window.PushSystem.STATUS.OPENED]: '已开单',
    [window.PushSystem.STATUS.CLOSED]: '已平仓',
    [window.PushSystem.STATUS.EXPIRED]: '已失效'
  }
  
  return statusMap[status] || status
}

// 格式化结果
function formatResult(result) {
  if (!window.PushSystem) return result
  
  const resultMap = {
    [window.PushSystem.RESULT.SUCCESS]: '✅ 成功',
    [window.PushSystem.RESULT.FAILURE]: '❌ 失败',
    [window.PushSystem.RESULT.PENDING]: '⏳ 待定'
  }
  
  return resultMap[result] || result
}

// 格式化时间戳
function formatTimestamp(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  
  // 小于1分钟
  if (diff < 60000) {
    return '刚刚'
  }
  
  // 小于1小时
  if (diff < 3600000) {
    return Math.floor(diff / 60000) + '分钟前'
  }
  
  // 小于1天
  if (diff < 86400000) {
    return Math.floor(diff / 3600000) + '小时前'
  }
  
  // 大于1天
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 标记推送结果
function markPushResult(result) {
  if (!currentPushRecord || !window.PushSystem) return
  
  const updated = window.PushSystem.markPushResult(currentPushRecord.id, result)
  
  if (updated) {
    // 关闭弹窗
    document.getElementById('pushDetailModal').classList.remove('active')
    
    // 刷新界面
    refreshPushStats()
    renderPushRecords()
    
    console.log('标记推送结果:', result)
  }
}

// 切换推送区域展开/折叠
function togglePushSection() {
  const content = document.getElementById('pushContent')
  const icon = document.getElementById('pushToggleIcon')
  
  content.classList.toggle('collapsed')
  
  if (content.classList.contains('collapsed')) {
    icon.textContent = '▶'
  } else {
    icon.textContent = '▼'
  }
}

// 创建测试推送
function createTestPush() {
  if (!window.PushSystem) return
  
  // 模拟推送信号
  const testSignal = {
    direction: Math.random() > 0.5 ? 'long' : 'short',
    entryPrice: 65000 + Math.random() * 1000,
    targetPrice: 65000 + (Math.random() > 0.5 ? 2000 : -2000),
    stopLoss: 65000 + (Math.random() > 0.5 ? -500 : 500),
    score: Math.floor(60 + Math.random() * 40),
    stars: Math.floor(3 + Math.random() * 2)
  }
  
  const record = window.PushSystem.createPushRecord(testSignal)
  
  if (record) {
    console.log('创建测试推送:', record)
    refreshPushStats()
    renderPushRecords()
  }
}

// 清空所有推送记录
function clearAllPushes() {
  if (!window.PushSystem) return
  
  if (confirm('确定要清空所有推送记录吗？此操作不可恢复！')) {
    window.PushSystem.clearAllRecords()
    refreshPushStats()
    renderPushRecords()
    console.log('已清空所有推送记录')
  }
}

// 绑定事件
function bindPushEvents() {
  // 刷新统计按钮
  document.getElementById('refreshStatsBtn')?.addEventListener('click', () => {
    refreshPushStats()
    renderPushRecords()
  })
  
  // 创建推送按钮
  document.getElementById('createPushBtn')?.addEventListener('click', createTestPush)
  
  // 清空记录按钮
  document.getElementById('clearPushesBtn')?.addEventListener('click', clearAllPushes)
  
  // 弹窗关闭按钮
  document.getElementById('modalClose')?.addEventListener('click', () => {
    document.getElementById('pushDetailModal').classList.remove('active')
  })
  
  // 标记成功按钮
  document.getElementById('markSuccessBtn')?.addEventListener('click', () => {
    markPushResult(window.PushSystem.RESULT.SUCCESS)
  })
  
  // 标记失败按钮
  document.getElementById('markFailureBtn')?.addEventListener('click', () => {
    markPushResult(window.PushSystem.RESULT.FAILURE)
  })
  
  // 取消按钮
  document.getElementById('cancelModalBtn')?.addEventListener('click', () => {
    document.getElementById('pushDetailModal').classList.remove('active')
  })
  
  // 点击弹窗背景关闭
  document.getElementById('pushDetailModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'pushDetailModal') {
      document.getElementById('pushDetailModal').classList.remove('active')
    }
  })
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  // 延迟初始化，确保其他模块已加载
  setTimeout(() => {
    initPushManagement()
  }, 500)
})

console.log('推送管理UI模块已加载')
