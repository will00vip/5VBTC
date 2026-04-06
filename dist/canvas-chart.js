// ═══════════════════════════════════════════════
// Canvas K线图引擎 v2.0 - 含BOLL+MACD，完全自绘
// ═══════════════════════════════════════════════

const CanvasChart = (() => {
  let _canvas = null
  let _ctx = null
  let _bars = []        // 原始K线数据
  let _volBars = []     // 成交量数据
  let _viewStart = 0    // 显示起始索引
  let _viewCount = 80   // 显示根数
  let _containerId = null
  let _interval = '15m'
  let _showBoll = true   // 是否显示BOLL
  let _showMacd = true   // 是否显示MACD副图

  // 触控状态
  let _touch = { startX: 0, startY: 0, lastX: 0, pinchDist: 0, isDragging: false, isPinching: false }

  const UP_COLOR = '#ef4444'    // 涨（中国红）
  const DOWN_COLOR = '#22c55e'  // 跌（绿）
  const BG_COLOR = '#0a0e17'
  const GRID_COLOR = 'rgba(148,163,184,0.08)'
  const TEXT_COLOR = '#94a3b8'
  const AXIS_COLOR = 'rgba(148,163,184,0.3)'

  // ── 计算BOLL（20,2） ──
  function _calcBoll(bars, n = 20) {
    const result = []
    for (let i = 0; i < bars.length; i++) {
      if (i < n - 1) { result.push(null); continue }
      const slice = bars.slice(i - n + 1, i + 1)
      const mid = slice.reduce((s, b) => s + b.close, 0) / n
      const std = Math.sqrt(slice.reduce((s, b) => s + (b.close - mid) ** 2, 0) / n)
      result.push({ mid, upper: mid + 2 * std, lower: mid - 2 * std })
    }
    return result
  }

  // ── 计算MACD（12,26,9） ──
  function _calcMacd(bars) {
    const closes = bars.map(b => b.close)
    const n = closes.length
    const ema = (arr, period, startIdx) => {
      const k = 2 / (period + 1)
      let e = arr[startIdx]
      const out = new Array(arr.length).fill(null)
      out[startIdx] = e
      for (let i = startIdx + 1; i < arr.length; i++) {
        e = arr[i] * k + e * (1 - k)
        out[i] = e
      }
      return out
    }
    const ema12 = ema(closes, 12, 11)
    const ema26 = ema(closes, 26, 25)
    const dif = ema12.map((v, i) => (v !== null && ema26[i] !== null) ? v - ema26[i] : null)
    // DEA = 9日EMA of DIF
    const difValid = dif.filter(v => v !== null)
    const deaFull = new Array(n).fill(null)
    let firstDifIdx = dif.findIndex(v => v !== null)
    if (firstDifIdx >= 0) {
      const k = 2 / 10
      let e = dif[firstDifIdx]
      deaFull[firstDifIdx] = e
      for (let i = firstDifIdx + 1; i < n; i++) {
        if (dif[i] === null) continue
        e = dif[i] * k + e * (1 - k)
        deaFull[i] = e
      }
    }
    const macd = dif.map((d, i) => (d !== null && deaFull[i] !== null) ? (d - deaFull[i]) * 2 : null)
    return bars.map((_, i) => (dif[i] !== null ? { dif: dif[i], dea: deaFull[i], macd: macd[i] } : null))
  }

  // ── 初始化 ──
  function init(containerId) {
    _containerId = containerId
    const container = document.getElementById(containerId)
    if (!container) { console.error('[Canvas] 找不到容器', containerId); return }

    // 清空容器，创建 canvas
    container.innerHTML = ''
    _canvas = document.createElement('canvas')
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;'
    container.appendChild(_canvas)

    // 设置真实像素尺寸（高DPI屏清晰）
    _resize()

    // 绑定事件
    _bindEvents()

    // 监听容器尺寸变化
    if (window.ResizeObserver) {
      new ResizeObserver(_resize).observe(container)
    }

    console.log('[Canvas] K线图初始化完成', container.clientWidth, 'x', container.clientHeight)
    return true
  }

  function _resize() {
    const container = document.getElementById(_containerId)
    if (!container || !_canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || 280
    _canvas.width = w * dpr
    _canvas.height = h * dpr
    _ctx = _canvas.getContext('2d')
    _ctx.scale(dpr, dpr)
    _canvas._logicalW = w
    _canvas._logicalH = h
    if (_bars.length > 0) _draw()
  }

  // ── 设置数据 ──
  function setData(bars) {
    _bars = bars.slice()
    _volBars = bars.slice()
    // 默认显示最后80根
    _viewCount = Math.min(80, bars.length)
    _viewStart = Math.max(0, bars.length - _viewCount)
    _draw()
  }

  // ── 实时更新最后一根 ──
  function updateLastBar(bar) {
    if (_bars.length === 0) return
    const last = _bars[_bars.length - 1]
    if (bar.time === last.time) {
      _bars[_bars.length - 1] = { ...bar }
    } else {
      _bars.push({ ...bar })
      if (_viewStart + _viewCount >= _bars.length - 1) {
        _viewStart = Math.max(0, _bars.length - _viewCount)
      }
    }
    _draw()
  }

  // ── 核心绘制函数 ──
  function _draw() {
    if (!_ctx || !_canvas || _bars.length === 0) return

    const W = _canvas._logicalW || _canvas.width
    const H = _canvas._logicalH || _canvas.height
    const LEFT_PAD = 8
    const RIGHT_PAD = 52       // 价格轴宽度

    // ─── 区域高度分配 ───
    const MACD_H = _showMacd ? H * 0.18 : 0
    const PRICE_H = H * (_showMacd ? 0.57 : 0.73)
    const VOL_H = H * 0.14
    const TIME_H = 14  // 时间轴高度(px)

    // 区域Y起始（从上到下：K线 → 成交量 → MACD → 时间轴）
    const KLINE_TOP = 0
    const KLINE_BOT = KLINE_TOP + PRICE_H
    const VOL_TOP = KLINE_BOT
    const VOL_BOT = VOL_TOP + VOL_H
    const MACD_TOP = VOL_BOT
    const MACD_BOT = MACD_TOP + MACD_H
    const TIME_TOP = H - TIME_H

    const usableW = W - LEFT_PAD - RIGHT_PAD
    const visibleBars = _bars.slice(_viewStart, _viewStart + _viewCount)
    if (visibleBars.length === 0) return

    // 背景
    _ctx.fillStyle = BG_COLOR
    _ctx.fillRect(0, 0, W, H)

    // 计算价格范围（含BOLL线）
    const bollAll = _showBoll ? _calcBoll(_bars) : null
    const macdAll = _showMacd ? _calcMacd(_bars) : null
    const visibleBoll = bollAll ? bollAll.slice(_viewStart, _viewStart + _viewCount) : null
    const visibleMacd = macdAll ? macdAll.slice(_viewStart, _viewStart + _viewCount) : null

    let maxH = -Infinity, minL = Infinity
    visibleBars.forEach((b, i) => {
      if (b.high > maxH) maxH = b.high
      if (b.low < minL) minL = b.low
      if (visibleBoll && visibleBoll[i]) {
        if (visibleBoll[i].upper > maxH) maxH = visibleBoll[i].upper
        if (visibleBoll[i].lower < minL) minL = visibleBoll[i].lower
      }
    })
    const priceRange = maxH - minL || 1
    const paddedMax = maxH + priceRange * 0.03
    const paddedMin = minL - priceRange * 0.03
    const pRange = paddedMax - paddedMin

    // 成交量范围
    let maxVol = 0
    visibleBars.forEach(b => { if (b.volume > maxVol) maxVol = b.volume })

    const barW = usableW / Math.max(visibleBars.length, 1)
    const candleW = Math.max(barW * 0.7, 1)

    const priceToY = (p) => KLINE_TOP + PRICE_H * (1 - (p - paddedMin) / pRange)
    const volToY = (v) => VOL_BOT - VOL_H * (v / (maxVol || 1))

    // ─── MACD范围计算 ───
    let macdMax = 0, macdMin = 0
    if (visibleMacd) {
      visibleMacd.forEach(m => {
        if (!m) return
        if (m.dif > macdMax) macdMax = m.dif
        if (m.dea > macdMax) macdMax = m.dea
        if (m.macd > macdMax) macdMax = m.macd
        if (m.dif < macdMin) macdMin = m.dif
        if (m.dea < macdMin) macdMin = m.dea
        if (m.macd < macdMin) macdMin = m.macd
      })
    }
    const macdRange = (macdMax - macdMin) || 1
    const macdZeroY = MACD_TOP + MACD_H * (macdMax / macdRange)
    const macdToY = (v) => MACD_TOP + MACD_H * ((macdMax - v) / macdRange)

    // ─── 绘制K线区网格 ───
    _ctx.strokeStyle = GRID_COLOR
    _ctx.lineWidth = 0.5
    for (let i = 0; i <= 4; i++) {
      const y = KLINE_TOP + PRICE_H * i / 4
      _ctx.beginPath(); _ctx.moveTo(LEFT_PAD, y); _ctx.lineTo(W - RIGHT_PAD, y); _ctx.stroke()
      const price = paddedMax - pRange * i / 4
      _ctx.fillStyle = TEXT_COLOR; _ctx.font = '9px -apple-system,sans-serif'
      _ctx.textAlign = 'right'; _ctx.fillText(price.toFixed(0), W - 2, y + 3)
    }

    // ─── 分隔线 ───
    _ctx.strokeStyle = 'rgba(148,163,184,0.15)'; _ctx.lineWidth = 0.5
    _ctx.beginPath(); _ctx.moveTo(LEFT_PAD, VOL_TOP); _ctx.lineTo(W - RIGHT_PAD, VOL_TOP); _ctx.stroke()
    if (_showMacd) {
      _ctx.beginPath(); _ctx.moveTo(LEFT_PAD, MACD_TOP); _ctx.lineTo(W - RIGHT_PAD, MACD_TOP); _ctx.stroke()
      // MACD零线
      _ctx.strokeStyle = 'rgba(148,163,184,0.3)'
      _ctx.beginPath(); _ctx.moveTo(LEFT_PAD, macdZeroY); _ctx.lineTo(W - RIGHT_PAD, macdZeroY); _ctx.stroke()
    }

    // ─── 绘制BOLL线（先画，K线在上层） ───
    if (visibleBoll) {
      const bollColors = { upper: 'rgba(251,191,36,0.7)', mid: 'rgba(99,179,237,0.6)', lower: 'rgba(251,191,36,0.7)' }
      ;['upper', 'mid', 'lower'].forEach(key => {
        _ctx.strokeStyle = bollColors[key]
        _ctx.lineWidth = key === 'mid' ? 1 : 0.8
        _ctx.setLineDash(key === 'mid' ? [3, 2] : [])
        _ctx.beginPath()
        let started = false
        visibleBoll.forEach((boll, i) => {
          if (!boll) return
          const x = LEFT_PAD + i * barW + barW / 2
          const y = priceToY(boll[key])
          if (!started) { _ctx.moveTo(x, y); started = true } else { _ctx.lineTo(x, y) }
        })
        _ctx.stroke()
        _ctx.setLineDash([])
      })
    }

    // ─── 绘制K线 ───
    visibleBars.forEach((bar, idx) => {
      const x = LEFT_PAD + idx * barW + barW / 2
      const isUp = bar.close >= bar.open
      const color = isUp ? UP_COLOR : DOWN_COLOR
      _ctx.strokeStyle = color; _ctx.fillStyle = color; _ctx.lineWidth = 1
      _ctx.beginPath(); _ctx.moveTo(x, priceToY(bar.high)); _ctx.lineTo(x, priceToY(bar.low)); _ctx.stroke()
      const bodyTop = Math.min(priceToY(bar.open), priceToY(bar.close))
      const bodyH = Math.max(Math.abs(priceToY(bar.close) - priceToY(bar.open)), 1)
      _ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH)
    })

    // ─── 绘制成交量 ───
    visibleBars.forEach((bar, idx) => {
      const x = LEFT_PAD + idx * barW
      const isUp = bar.close >= bar.open
      const color = isUp ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'
      const top = volToY(bar.volume)
      _ctx.fillStyle = color
      _ctx.fillRect(x, top, barW * 0.7, Math.max(VOL_BOT - top, 1))
    })

    // ─── 绘制MACD副图 ───
    if (_showMacd && visibleMacd) {
      // MACD柱（2倍DIF-DEA）
      visibleMacd.forEach((m, idx) => {
        if (!m || m.macd == null) return
        const x = LEFT_PAD + idx * barW
        const y0 = macdZeroY
        const y1 = macdToY(m.macd / 2 + (macdMax - macdMin > 0 ? 0 : 0))
        const isPos = m.macd >= 0
        _ctx.fillStyle = isPos ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)'
        const top = Math.min(macdZeroY, macdToY(m.macd))
        const ht = Math.max(Math.abs(macdZeroY - macdToY(m.macd)), 1)
        _ctx.fillRect(x + barW * 0.1, top, barW * 0.8, ht)
      })
      // DIF线（白/黄）
      _ctx.strokeStyle = 'rgba(251,191,36,0.9)'; _ctx.lineWidth = 1; _ctx.setLineDash([])
      _ctx.beginPath(); let s1 = false
      visibleMacd.forEach((m, i) => {
        if (!m) return
        const x = LEFT_PAD + i * barW + barW / 2
        const y = macdToY(m.dif)
        if (!s1) { _ctx.moveTo(x, y); s1 = true } else { _ctx.lineTo(x, y) }
      })
      _ctx.stroke()
      // DEA线（橙）
      _ctx.strokeStyle = 'rgba(251,146,60,0.9)'; _ctx.lineWidth = 1
      _ctx.beginPath(); let s2 = false
      visibleMacd.forEach((m, i) => {
        if (!m) return
        const x = LEFT_PAD + i * barW + barW / 2
        const y = macdToY(m.dea)
        if (!s2) { _ctx.moveTo(x, y); s2 = true } else { _ctx.lineTo(x, y) }
      })
      _ctx.stroke()
      // MACD标签
      _ctx.fillStyle = 'rgba(148,163,184,0.6)'; _ctx.font = '8px sans-serif'; _ctx.textAlign = 'left'
      _ctx.fillText('MACD', LEFT_PAD + 2, MACD_TOP + 9)
    }

    // ─── 绘制时间轴标签 ───
    const step = Math.max(1, Math.floor(visibleBars.length / 5))
    _ctx.fillStyle = TEXT_COLOR; _ctx.font = '9px -apple-system,sans-serif'; _ctx.textAlign = 'center'
    for (let i = 0; i < visibleBars.length; i += step) {
      const bar = visibleBars[i]
      const x = LEFT_PAD + i * barW + barW / 2
      const d = new Date(bar.time * 1000)
      let label = (_interval.endsWith('m') || _interval.endsWith('h'))
        ? `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
        : `${d.getMonth()+1}/${d.getDate()}`
      _ctx.fillText(label, x, H - 2)
    }

    // ─── 绘制最新价线 ───
    const lastBar = visibleBars[visibleBars.length - 1]
    if (lastBar) {
      const y = priceToY(lastBar.close)
      const isUp = lastBar.close >= lastBar.open
      _ctx.strokeStyle = isUp ? UP_COLOR : DOWN_COLOR
      _ctx.lineWidth = 0.8; _ctx.setLineDash([4, 3])
      _ctx.beginPath(); _ctx.moveTo(LEFT_PAD, y); _ctx.lineTo(W - RIGHT_PAD, y); _ctx.stroke()
      _ctx.setLineDash([])
      _ctx.fillStyle = isUp ? UP_COLOR : DOWN_COLOR
      _ctx.beginPath(); _ctx.roundRect(W - RIGHT_PAD + 1, y - 8, RIGHT_PAD - 2, 16, 3); _ctx.fill()
      _ctx.fillStyle = '#fff'; _ctx.font = 'bold 10px -apple-system,sans-serif'; _ctx.textAlign = 'center'
      _ctx.fillText(lastBar.close.toFixed(0), W - RIGHT_PAD / 2, y + 4)
    }

    // ─── 插针信号标注 ───
    if (window._chartSignals && window._chartSignals.length > 0) {
      window._chartSignals.forEach(sig => {
        const barIdx = visibleBars.findIndex(b => b.time === sig.time)
        if (barIdx < 0) return
        const x = LEFT_PAD + barIdx * barW + barW / 2
        const isLong = sig.direction === 'long'
        const y = isLong ? priceToY(visibleBars[barIdx].low) + 14 : priceToY(visibleBars[barIdx].high) - 14
        _ctx.fillStyle = isLong ? UP_COLOR : DOWN_COLOR
        _ctx.font = '12px sans-serif'; _ctx.textAlign = 'center'
        _ctx.fillText(isLong ? '▲' : '▼', x, y)
      })
    }
  }

  // ── 触控事件 ──
  function _bindEvents() {
    if (!_canvas) return

    _canvas.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (e.touches.length === 1) {
        _touch.isDragging = true
        _touch.startX = e.touches[0].clientX
        _touch.lastX = _touch.startX
      } else if (e.touches.length === 2) {
        _touch.isPinching = true
        _touch.isDragging = false
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        _touch.pinchDist = Math.sqrt(dx*dx + dy*dy)
      }
    }, { passive: false })

    _canvas.addEventListener('touchmove', (e) => {
      e.preventDefault()
      if (_touch.isDragging && e.touches.length === 1) {
        const dx = e.touches[0].clientX - _touch.lastX
        _touch.lastX = e.touches[0].clientX
        const W = _canvas._logicalW || _canvas.width
        const RIGHT_PAD = 55
        const usableW = W - 8 - RIGHT_PAD
        const barW = usableW / Math.max(_viewCount, 1)
        const shift = Math.round(-dx / barW)
        _viewStart = Math.max(0, Math.min(_bars.length - _viewCount, _viewStart + shift))
        _draw()
      } else if (_touch.isPinching && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const newDist = Math.sqrt(dx*dx + dy*dy)
        const ratio = _touch.pinchDist / newDist
        _touch.pinchDist = newDist
        const newCount = Math.round(_viewCount * ratio)
        _viewCount = Math.max(20, Math.min(200, newCount))
        _viewStart = Math.max(0, Math.min(_bars.length - _viewCount, _viewStart))
        _draw()
      }
    }, { passive: false })

    _canvas.addEventListener('touchend', () => {
      _touch.isDragging = false
      _touch.isPinching = false
    })

    // ★ 鼠标滚轮支持（桌面访问用户）
    _canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const deltaY = e.deltaY
      const W = _canvas._logicalW || _canvas.width
      const RIGHT_PAD = 55
      const usableW = W - 8 - RIGHT_PAD
      const barW = usableW / Math.max(_viewCount, 1)
      // 滚轮向下 = 向右（看新的数据），向上 = 向左（看老的数据）
      const shift = Math.ceil(deltaY / barW / 10)  // 10像素滚动 ≈ 1根K线
      _viewStart = Math.max(0, Math.min(_bars.length - _viewCount, _viewStart + shift))
      _draw()
    }, { passive: false })
  }

  // 暴露接口
  return {
    init,
    setData,
    updateLastBar,
    redraw: _draw,
    setInterval: (iv) => { _interval = iv },
    getBars: () => _bars,
    toggleBoll: (v) => { _showBoll = (v !== undefined ? v : !_showBoll); _draw() },
    toggleMacd: (v) => { _showMacd = (v !== undefined ? v : !_showMacd); _draw() },
  }
})()

// 兼容旧 window.LWChart 接口
window.LWChart = {
  initLWChart: (id) => CanvasChart.init(id),
  loadChartData: async (interval, limit) => {
    CanvasChart.setInterval(interval)
    // fetchKlines 来自 app.js（在 body 底部加载），通过 window.fetchKlines 访问
    const fn = window.fetchKlines || (window.BTCKlines && window.BTCKlines.fetchKlines)
    if (!fn) throw new Error('fetchKlines 未加载，请检查 app.js')
    const bars = await fn(interval, limit)
    if (bars && bars.length > 0) CanvasChart.setData(bars)
    return bars
  },
  updateBar: (bar) => CanvasChart.updateLastBar(bar),
  switchChartInterval: async (interval) => {
    // 会被 app.js 覆盖为含 WS 版本；这里是兜底
    CanvasChart.setInterval(interval)
    const fn = window.fetchKlines || (window.BTCKlines && window.BTCKlines.fetchKlines)
    if (!fn) return
    const bars = await fn(interval, 200)
    if (bars && bars.length > 0) CanvasChart.setData(bars)
  },
  state: { lastBar: null, ws: null },
}

// 也暴露 CanvasChart 本身
window.CanvasChart = CanvasChart

