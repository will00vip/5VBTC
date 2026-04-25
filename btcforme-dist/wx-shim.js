// wx-shim.js - 微信小程序 API 浏览器兼容层
(function() {
  // 模拟 wx.request 为 fetch
  window.wx = window.wx || {};
  
  wx.request = function(options) {
    const url = options.url;
    const timeout = options.timeout || 6000;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    fetch(url, { signal: controller.signal })
      .then(response => {
        clearTimeout(timeoutId);
        if (response.ok) {
          return response.json();
        } else {
          throw new Error('HTTP ' + response.status);
        }
      })
      .then(data => {
        if (options.success) {
          options.success({ statusCode: 200, data: data });
        }
        if (options.complete) {
          options.complete();
        }
      })
      .catch(error => {
        clearTimeout(timeoutId);
        if (options.fail) {
          options.fail({ errMsg: error.message || 'request fail' });
        }
        if (options.complete) {
          options.complete();
        }
      });
    
    return {};
  };

  // 模拟 wx.showToast
  wx.showToast = function(options) {
    console.log('[Toast]', options.title || options.content);
    // 可以用 DOM 创建一个简单的 toast
  };

  // 模拟 wx.showLoading
  wx.showLoading = function(options) {
    console.log('[Loading]', options.title || options.content);
  };

  // 模拟 wx.hideLoading
  wx.hideLoading = function() {
    console.log('[Loading Hide]');
  };

  // 模拟微信 storage
  const _storage = {};
  wx.getStorage = function(options) {
    const key = options.key;
    if (_storage[key]) {
      try {
        options.success({ data: JSON.parse(_storage[key]) });
      } catch(e) {
        options.success({ data: _storage[key] });
      }
    } else {
      options.fail && options.fail({ errMsg: 'data not found' });
    }
  };

  wx.setStorage = function(options) {
    const key = options.key;
    const value = typeof options.data === 'string' ? options.data : JSON.stringify(options.data);
    _storage[key] = value;
    options.success && options.success();
  };

  wx.removeStorage = function(options) {
    delete _storage[options.key];
    options.success && options.success();
  };

  // 模拟 App 和 Page
  window.App = function(config) {
    if (config.onLaunch) {
      setTimeout(config.onLaunch.bind({}), 0);
    }
  };

  window.Page = function(config) {
    // 保存 config 供后续使用
    window.__pageConfig = config;
  };

  // 模拟 getApp
  window.getApp = function() {
    return { globalData: {} };
  };

  console.log('[WX Shim] 微信小程序兼容层已加载');
})();
