// config.js - 小程序配置参数（浏览器版本）
var CONFIG = {
  ACCOUNT_BALANCE: 1000.0,
  RISK_PER_TRADE: 0.02,
  MAX_POSITION_PCT: 0.20,
  CONTRACT_SIZE: 0.001,
  DEFAULT_LEVERAGE: 20,
  DAILY_MAX_LOSS_PCT: 0.05,
  COOLDOWN_LOSS_COUNT: 3,
  COOLDOWN_HOURS: 2,

  // 数据源配置 - Binance Vision 优先
  DATA_SOURCES: [
    {
      name: 'BinanceVision',
      klineUrl: function(iv, lim) { 
        return 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=' + iv + '&limit=' + lim;
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
      name: 'Gate.io',
      klineUrl: function(iv, lim) {
        var m = { '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1h','2h':'2h','4h':'4h','6h':'6h','12h':'12h','1d':'1d','3d':'3d','1w':'1w','1s':'1m' };
        return 'https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=BTC_USDT&interval=' + (m[iv]||'15m') + '&limit=' + lim;
      },
      parse: function(raw) {
        if (!Array.isArray(raw)) throw new Error('格式错误');
        return raw.map(function(k) {
          return {
            time: +k[0] * 1000,
            open: +k[5],
            high: +k[3],
            low: +k[4],
            close: +k[2],
            volume: +k[6]
          };
        });
      }
    },
    {
      name: 'Huobi',
      klineUrl: function(iv, lim) {
        var m = { '1m':'1min','3m':'3min','5m':'5min','15m':'15min','30m':'30min','1h':'60min','2h':'2hour','4h':'4hour','6h':'6hour','12h':'12hour','1d':'1day','3d':'3day','1w':'1week','1s':'1min' };
        return 'https://api.huobi.pro/market/history/kline?symbol=btcusdt&period=' + (m[iv]||'15min') + '&size=' + lim;
      },
      parse: function(raw) {
        var d = raw.data || raw;
        if (!Array.isArray(d)) throw new Error('格式错误');
        return d.reverse().map(function(k) {
          return {
            time: k.id * 1000,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.vol
          };
        });
      }
    }
  ],

  FILTER_NIGHT_HOURS: true,
  NIGHT_HOURS_START: 0,
  NIGHT_HOURS_END: 6,
  FILTER_4H_CRASH: true,
  MAX_4H_DROP_PCT: -8,
  PIN_SHADOW_RATIO: 1.5,
  VOLUME_AMPLIFY_RATIO: 1.3,

  // 信号推送配置
  SIGNAL_NOTIFY: {
    enabled: false,
    minScore: 70,
    cooldownSec: 300,
  }
};

console.log('[Config] 配置已加载');
