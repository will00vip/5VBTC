// config.js - 小程序配置参数（浏览器版本）
var CONFIG = {
  // 当前交易的交易对
  SYMBOL: 'BTCUSDT',
  
  // 支持的交易对列表
  SYMBOLS: {
    'BTCUSDT': {
      name: '比特币',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      contractSize: 0.001,
      tickSize: 0.01
    },
    'ETHUSDT': {
      name: '以太坊',
      symbol: 'ETHUSDT',
      baseAsset: 'ETH',
      quoteAsset: 'USDT',
      contractSize: 0.001,
      tickSize: 0.01
    }
  },
  ACCOUNT_BALANCE: 1000.0,
  RISK_PER_TRADE: 0.02,
  MAX_POSITION_PCT: 0.20,
  CONTRACT_SIZE: 0.001,
  DEFAULT_LEVERAGE: 20,
  DAILY_MAX_LOSS_PCT: 0.05,
  COOLDOWN_LOSS_COUNT: 3,
  COOLDOWN_HOURS: 2,

// 数据源配置 - 使用动态symbol
  DATA_SOURCES: function(symbol) {
    symbol = symbol || 'BTCUSDT';
    var s = symbol.toUpperCase();
    return [
      {
        name: 'BinanceVision',
        klineUrl: function(iv, lim) { 
          return 'https://data-api.binance.vision/api/v3/klines?symbol=' + s + '&interval=' + iv + '&limit=' + lim;
        },
        parse: function(raw) {
          if (!Array.isArray(raw)) throw new Error('格式错误');
          return raw.map(function(k) {
            return {
              time: +k[0],
              open: +k[1],
              high: +k[2],
              low: +k[3],
              close: +k[4],
              volume: +k[5]
            };
          });
        }
      },
      {
        name: 'Binance',
        klineUrl: function(iv, lim) {
          return 'https://api.binance.com/api/v3/klines?symbol=' + s + '&interval=' + iv + '&limit=' + lim;
        },
        parse: function(raw) {
          if (!Array.isArray(raw)) throw new Error('格式错误');
          return raw.map(function(k) {
            return {
              time: +k[0],
              open: +k[1],
              high: +k[2],
              low: +k[3],
              close: +k[4],
              volume: +k[5]
            };
          });
        }
      }
    ];
  },

  FILTER_NIGHT_HOURS: true,
  NIGHT_HOURS_START: 0,
  NIGHT_HOURS_END: 6,
  FILTER_4H_CRASH: true,
  MAX_4H_DROP_PCT: -8,
  PIN_SHADOW_RATIO: 1.5,
  VOLUME_AMPLIFY_RATIO: 1.3,

  // 信号推送配置
  SIGNAL_NOTIFY: {
    enabled: true,
    minScore: 60,
    cooldownSec: 300,
  }
};

console.log('[Config] 配置已加载');
