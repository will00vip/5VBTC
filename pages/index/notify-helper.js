// notify-helper.js - Capacitor Android 通知助手
// 用于在 Capacitor Android App 中显示原生通知

const Notify = {
  enabled: false,
  lastTime: 0,
  cooldownSec: 300, // 5分钟冷却

  init() {
    // 标记为已启用
    this.enabled = true
    console.log('通知助手已初始化')
  },

  send(title, body) {
    if (!this.enabled) return

    const now = Date.now()
    const cooldownMs = this.cooldownSec * 1000
    if (now - this.lastTime < cooldownMs) {
      console.log('通知冷却中...')
      return
    }
    this.lastTime = now

    // 使用 URL scheme 触发原生通知
    try {
      const encodedTitle = encodeURIComponent(title)
      const encodedBody = encodeURIComponent(body)
      const url = `btcnotify://show?title=${encodedTitle}&body=${encodedBody}`
      window.location.href = url
      console.log('通知请求已发送:', title)
    } catch(e) {
      console.log('通知发送失败:', e.message)
    }
  }
}

module.exports = Notify
