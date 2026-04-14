package com.btcai.autotrade;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SignalMonitorService extends Service {
    private static final String TAG = "SignalMonitor";
    public static final String CHANNEL_ID = "btc_signal_channel";
    public static final String CHANNEL_NAME = "BTC信号监控";
    public static final int NOTIFICATION_ID = 1001;
    public static final long CHECK_INTERVAL = 30 * 1000; // 30秒检查一次（更及时）
    private static final long COOL_DOWN = 3 * 60 * 1000; // 3分钟通知冷却
    private static final long HEARTBEAT_INTERVAL = 60 * 1000; // 1分钟心跳

    private ExecutorService executor;
    private Handler handler;
    private Runnable checkRunnable;
    private Runnable heartbeatRunnable;
    private SharedPreferences prefs;
    private long lastNotifyTime = 0;
    private int lastSignalType = 0; // 0=无, 1=做多, 2=做空
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        executor = Executors.newSingleThreadExecutor();
        handler = new Handler(Looper.getMainLooper());
        prefs = getSharedPreferences("btc_radar", MODE_PRIVATE);
        createNotificationChannel();
        
        // ★ 获取WakeLock防止CPU休眠
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BTC:SignalMonitor");
            wakeLock.acquire(10 * 60 * 1000L); // 10分钟
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "SignalMonitorService started");

        // 创建前台通知
        Notification notification = createForegroundNotification();
        startForeground(NOTIFICATION_ID, notification);

        // 开始定期检查
        startPeriodicCheck();
        
        // ★ 开始心跳保活
        startHeartbeat();

        return START_STICKY;
    }
    
    // ★ 心跳保活机制
    private void startHeartbeat() {
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                Log.d(TAG, "💓 心跳检测 - 服务运行中");
                
                // 刷新WakeLock
                if (wakeLock != null && !wakeLock.isHeld()) {
                    wakeLock.acquire(10 * 60 * 1000L);
                }
                
                // 刷新前台通知
                Notification notification = createForegroundNotification();
                NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.notify(NOTIFICATION_ID, notification);
                }
                
                handler.postDelayed(this, HEARTBEAT_INTERVAL);
            }
        };
        handler.post(heartbeatRunnable);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.NotificationChannel channel = new android.app.NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("后台信号监控通知");
            channel.enableVibration(true);
            channel.enableLights(true);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification createForegroundNotification() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🔔 BTC三步法雷达")
            .setContentText("正在后台监控交易信号...")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void startPeriodicCheck() {
        checkRunnable = new Runnable() {
            @Override
            public void run() {
                checkForSignal();
                handler.postDelayed(this, CHECK_INTERVAL);
            }
        };
        handler.post(checkRunnable);
    }

    private void checkForSignal() {
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Log.d(TAG, "Checking for signals...");

                    // 从 Binance 获取K线数据
                    URL url = new URL("https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);

                    if (conn.getResponseCode() == 200) {
                        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                        StringBuilder response = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) {
                            response.append(line);
                        }
                        reader.close();

                        // 完整技术分析
                        SignalResult result = analyzeSignalFull(response.toString());

                        Log.d(TAG, "Signal analysis: rawScore=" + result.rawScore + ", mappedScore=" + result.score + ", direction=" + result.direction);

                        // 触发通知 - 使用映射后的分数（做多60-100，做空-100到-60）
                        boolean shouldNotify = false;
                        String direction = "";
                        int score = result.score;  // 使用映射后的分数

                        // 做多信号：分数 >= 60
                        if (score >= 60) {
                            direction = "做多";
                            shouldNotify = true;
                            lastSignalType = 1;
                        } 
                        // 做空信号：分数 <= -60
                        else if (score <= -60) {
                            direction = "做空";
                            shouldNotify = true;
                            lastSignalType = 2;
                        }

                        if (shouldNotify) {
                            long now = System.currentTimeMillis();
                            if (now - lastNotifyTime > COOL_DOWN) {
                                lastNotifyTime = now;
                                showSignalNotification(direction, score, result.reason, 
                                    result.price, result.stopLoss, result.takeProfit1, result.takeProfit2, result.leverage);
                                
                                // ★ 触发自动交易
                                String tradeDirection = score >= 60 ? "long" : "short";
                                triggerAutoTrade(tradeDirection, score, result.price, 
                                    result.stopLoss, result.takeProfit1, result.takeProfit2);
                            }
                        }
                    }
                    conn.disconnect();

                } catch (Exception e) {
                    Log.e(TAG, "Error checking signal: " + e.getMessage());
                }
            }
        });
    }

    // 完整信号分析结果
    private class SignalResult {
        int rawScore;      // 原始分数 0-35
        int score;         // 映射后分数 60-100(做多) 或 -100到-60(做空)
        String direction;
        String reason;
        double rsi;
        double jValue;
        double macdHist;
        double bollPercent;
        double price;      // 当前价格
        double stopLoss;   // 止损价
        double takeProfit1; // 止盈1
        double takeProfit2; // 止盈2
        int leverage;      // 建议杠杆倍数
    }

    // 完整技术分析
    private SignalResult analyzeSignalFull(String data) {
        SignalResult result = new SignalResult();
        result.score = 50;
        result.direction = "观望";
        result.reason = "指标正常";

        try {
            JSONArray klines = new JSONArray(data);
            int len = klines.length();
            if (len < 30) return result;

            // 提取数据
            List<Double> closes = new ArrayList<>();
            List<Double> highs = new ArrayList<>();
            List<Double> lows = new ArrayList<>();

            for (int i = 0; i < len; i++) {
                JSONArray k = klines.getJSONArray(i);
                closes.add(Double.parseDouble(k.getString(4)));
                highs.add(Double.parseDouble(k.getString(2)));
                lows.add(Double.parseDouble(k.getString(3)));
            }

            // 1. RSI (14)
            double rsi = calculateRSI(closes, 14);
            result.rsi = rsi;

            // 2. MACD (12, 26, 9)
            double[] macd = calculateMACD(closes);
            double macdHist = macd[2];
            result.macdHist = macdHist;

            // 3. KDJ (9, 3, 3)
            double[] kdj = calculateKDJ(highs, lows, closes, 9, 3, 3);
            double jValue = kdj[2];
            result.jValue = jValue;

            // 4. 布林带 (20)
            double[] boll = calculateBollinger(closes, 20);
            double currentPrice = closes.get(closes.size() - 1);
            double bollPercent = ((currentPrice - boll[2]) / (boll[0] - boll[2])) * 100;
            result.bollPercent = bollPercent;

            // 5. MA均线趋势
            double ma5 = calculateMA(closes, 5);
            double ma20 = calculateMA(closes, 20);

            // ========== 综合评分 (与前端算法保持一致) ==========
            // 前端算法：0-35分原始分数 → 映射到 60-100(做多) 或 -100到-60(做空)
            int rawScore = 0;
            boolean isLongSignal = false;
            boolean isShortSignal = false;

            // 1. 趋势评分 (0-6分)
            if (ma5 > ma20) {
                rawScore += 6;  // 强势多头
                isLongSignal = true;
            } else {
                rawScore += 1;  // 空头趋势
                isShortSignal = true;
            }

            // 2. RSI评分 (0-6分) - 超卖加分，超买减分
            if (rsi < 30) {
                rawScore += 6;  // 严重超卖，看多
                isLongSignal = true;
            } else if (rsi < 40) {
                rawScore += 4;
                isLongSignal = true;
            } else if (rsi > 70) {
                rawScore += 1;  // 严重超买，看空
                isShortSignal = true;
            } else if (rsi > 60) {
                rawScore += 2;
                isShortSignal = true;
            } else {
                rawScore += 3;  // 中性
            }

            // 3. MACD评分 (0-6分)
            if (macdHist > 0) {
                rawScore += 6;   // 多头
                isLongSignal = true;
            } else {
                rawScore += 2;    // 空头
                isShortSignal = true;
            }

            // 4. KDJ评分 (0-6分) - 超卖加分
            if (jValue < 20) {
                rawScore += 6;    // 严重超卖
                isLongSignal = true;
            } else if (jValue < 35) {
                rawScore += 4;
                isLongSignal = true;
            } else if (jValue > 80) {
                rawScore += 1;    // 严重超买
                isShortSignal = true;
            } else if (jValue > 65) {
                rawScore += 2;
                isShortSignal = true;
            } else {
                rawScore += 3;
            }

            // 5. BOLL评分 (0-6分) - 接近下轨加分，上轨减分
            if (bollPercent < 20) {
                rawScore += 6;    // 接近下轨，极度超卖
                isLongSignal = true;
            } else if (bollPercent < 30) {
                rawScore += 4;
                isLongSignal = true;
            } else if (bollPercent > 80) {
                rawScore += 1;    // 接近上轨
                isShortSignal = true;
            } else if (bollPercent > 70) {
                rawScore += 2;
                isShortSignal = true;
            } else {
                rawScore += 3;
            }

            // 确保原始分数在0-35范围内
            rawScore = Math.min(35, Math.max(0, rawScore));
            result.rawScore = rawScore;

            // 映射到最终分数：做多 60-100，做空 -100到-60
            if (isLongSignal && !isShortSignal) {
                // 纯多头信号
                result.score = (int) Math.round(60 + (rawScore / 35.0) * 40);
                result.direction = "做多";
            } else if (isShortSignal && !isLongSignal) {
                // 纯空头信号
                result.score = (int) Math.round(-100 + (rawScore / 35.0) * 40);
                result.direction = "做空";
            } else if (isLongSignal && isShortSignal) {
                // 混合信号，根据分数偏向决定
                if (rawScore >= 20) {
                    result.score = (int) Math.round(60 + (rawScore / 35.0) * 40);
                    result.direction = "做多";
                } else {
                    result.score = (int) Math.round(-100 + (rawScore / 35.0) * 40);
                    result.direction = "做空";
                }
            } else {
                // 观望
                result.score = 50;
                result.direction = "观望";
            }

            // 设置当前价格
            result.price = currentPrice;
            
            // 计算止损和止盈（基于ATR或固定百分比）
            double atr = calculateATR(highs, lows, closes, 14);
            double atrPercent = (atr / currentPrice) * 100;
            
            // 止损：做多时低于入场价，做空时高于入场价
            // 使用固定5%止损策略
            double stopLossPercent = 0.05; // 5%止损
            
            if (result.direction.equals("做多")) {
                result.stopLoss = currentPrice * (1 - stopLossPercent);
                result.takeProfit1 = currentPrice * 1.02;  // 止盈1: 2%
                result.takeProfit2 = currentPrice * 1.05;  // 止盈2: 5%
            } else if (result.direction.equals("做空")) {
                result.stopLoss = currentPrice * (1 + stopLossPercent);
                result.takeProfit1 = currentPrice * 0.98;  // 止盈1: 2%
                result.takeProfit2 = currentPrice * 0.95;  // 止盈2: 5%
            }
            
            // 计算建议杠杆倍数（基于信号强度和波动率）
            // 分数越高，建议杠杆越高；波动率越低，建议杠杆越高
            int baseLeverage = 30; // 基础杠杆30倍
            int scoreBonus = (int) ((Math.abs(result.score) - 60) / 40 * 20); // 最高加20倍
            int volatilityPenalty = (int) (atrPercent * 2); // 波动率惩罚
            result.leverage = Math.max(10, Math.min(50, baseLeverage + scoreBonus - volatilityPenalty));
            
            // 原因说明
            StringBuilder reason = new StringBuilder();
            reason.append("RSI:").append((int)rsi).append(" ");
            reason.append("KDJ:").append((int)jValue).append(" ");
            reason.append("BOLL:").append((int)bollPercent).append("%");
            result.reason = reason.toString();

            Log.d(TAG, "分析结果: rawScore=" + rawScore + ", mappedScore=" + result.score + ", direction=" + result.direction + ", price=" + currentPrice + ", SL=" + result.stopLoss + ", TP1=" + result.takeProfit1 + ", leverage=" + result.leverage + "x");

        } catch (Exception e) {
            Log.e(TAG, "Error analyzing: " + e.getMessage());
        }

        return result;
    }

    private double calculateRSI(List<Double> prices, int period) {
        if (prices.size() < period + 1) return 50;
        double gain = 0, loss = 0;
        for (int i = prices.size() - period; i < prices.size(); i++) {
            double change = prices.get(i) - prices.get(i - 1);
            if (change > 0) gain += change;
            else loss -= change;
        }
        if (loss == 0) return 100;
        return 100 - (100 / (1 + gain / loss));
    }

    private double[] calculateMACD(List<Double> prices) {
        double ema12 = calculateEMA(prices, 12);
        double ema26 = calculateEMA(prices, 26);
        double dif = ema12 - ema26;
        double dea = dif * 0.8;
        double macdHist = (dif - dea) * 2;
        return new double[]{dif, dea, macdHist};
    }

    private double calculateEMA(List<Double> prices, int period) {
        if (prices.size() < period) return prices.get(prices.size() - 1);
        double ema = prices.get(0);
        double multiplier = 2.0 / (period + 1);
        for (int i = 1; i < prices.size(); i++) {
            ema = (prices.get(i) - ema) * multiplier + ema;
        }
        return ema;
    }

    private double calculateATR(List<Double> highs, List<Double> lows, List<Double> closes, int period) {
        if (highs.size() < period + 1) return 0;
        double sumTR = 0;
        for (int i = highs.size() - period; i < highs.size(); i++) {
            double tr1 = highs.get(i) - lows.get(i);
            double tr2 = Math.abs(highs.get(i) - closes.get(i - 1));
            double tr3 = Math.abs(lows.get(i) - closes.get(i - 1));
            sumTR += Math.max(tr1, Math.max(tr2, tr3));
        }
        return sumTR / period;
    }

    private double[] calculateKDJ(List<Double> highs, List<Double> lows, List<Double> closes, int n, int m1, int m2) {
        int len = closes.size();
        if (len < n) return new double[]{50, 50, 50};

        double sumHigh = 0, sumLow = 0;
        for (int i = len - n; i < len; i++) {
            sumHigh += highs.get(i);
            sumLow += lows.get(i);
        }
        double highest = sumHigh / n;
        double lowest = sumLow / n;

        double close = closes.get(len - 1);
        double rsv = (close - lowest) / (highest - lowest) * 100;

        double k = 50, d = 50;
        k = (2 * k + rsv) / 3;
        d = (2 * d + k) / 3;
        double j = 3 * k - 2 * d;

        return new double[]{k, d, j};
    }

    private double[] calculateBollinger(List<Double> prices, int period) {
        if (prices.size() < period) {
            double last = prices.get(prices.size() - 1);
            return new double[]{last * 1.02, last, last * 0.98};
        }

        double sum = 0;
        for (int i = prices.size() - period; i < prices.size(); i++) {
            sum += prices.get(i);
        }
        double ma = sum / period;

        double variance = 0;
        for (int i = prices.size() - period; i < prices.size(); i++) {
            double diff = prices.get(i) - ma;
            variance += diff * diff;
        }
        double stdDev = Math.sqrt(variance / period);

        return new double[]{ma + 2 * stdDev, ma, ma - 2 * stdDev};
    }

    private double calculateMA(List<Double> prices, int period) {
        if (prices.size() < period) period = prices.size();
        double sum = 0;
        for (int i = prices.size() - period; i < prices.size(); i++) {
            sum += prices.get(i);
        }
        return sum / period;
    }

    private void showSignalNotification(String direction, int score, String reason, 
                                        double price, double stopLoss, double takeProfit1, 
                                        double takeProfit2, int leverage) {
        // 60分以下的信号不推送
        if (Math.abs(score) < 60) {
            Log.d(TAG, "信号分数低于60，不推送: " + direction + " " + score);
            return;
        }
        
        // 创建跳转到详情页面的Intent
        Intent detailIntent = new Intent(this, SignalDetailActivity.class);
        detailIntent.putExtra("direction", direction);
        detailIntent.putExtra("score", score);
        detailIntent.putExtra("reason", reason);
        detailIntent.putExtra("price", price);
        detailIntent.putExtra("stopLoss", stopLoss);
        detailIntent.putExtra("takeProfit1", takeProfit1);
        detailIntent.putExtra("takeProfit2", takeProfit2);
        detailIntent.putExtra("leverage", leverage);
        detailIntent.putExtra("timestamp", System.currentTimeMillis());
        detailIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(this, (int) System.currentTimeMillis(), 
            detailIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        String emoji = direction.equals("做多") ? "🟢" : "🔴";
        // 做空信号显示负分数
        String scoreDisplay = direction.equals("做空") ? "-" + Math.abs(score) : String.valueOf(score);
        String content = emoji + " " + direction + "信号 | " + scoreDisplay + "分 | " + leverage + "x杠杆\n价格: $" + String.format("%.2f", price);
        
        // 构建大文本通知内容
        StringBuilder bigText = new StringBuilder(content);
        bigText.append("\n\n📊 交易计划:");
        if (stopLoss > 0) bigText.append(String.format("\n止损: $%.2f", stopLoss));
        if (takeProfit1 > 0) bigText.append(String.format("\n止盈1: $%.2f", takeProfit1));
        if (takeProfit2 > 0) bigText.append(String.format("\n止盈2: $%.2f", takeProfit2));
        bigText.append("\n\n点击通知查看完整详情");

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🚨 BTC信号: " + direction + "!")
            .setContentText(content)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(bigText.toString()))
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentIntent(pendingIntent)
            .setAutoCancel(false)  // 不自动消失，需要用户手动清除
            .setOngoing(true)      // 设置为持续通知
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .addAction(android.R.drawable.ic_menu_info_details, "查看详情", pendingIntent)
            .build();

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify((int) System.currentTimeMillis(), notification);
        }

        Log.d(TAG, "Signal notification: " + direction + " " + scoreDisplay);
    }

    // ★ 触发自动交易
    private void triggerAutoTrade(String direction, int score, double price, 
                                  double stopLoss, double takeProfit1, double takeProfit2) {
        try {
            MainActivity mainActivity = MainActivity.getInstance();
            if (mainActivity != null) {
                mainActivity.triggerAutoTrade(direction, score, price, stopLoss, takeProfit1, takeProfit2);
                Log.d(TAG, "✅ 自动交易已触发: " + direction + " " + score + "分");
            } else {
                Log.w(TAG, "⚠️ MainActivity未运行，无法触发自动交易");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ 触发自动交易失败: " + e.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (handler != null) {
            if (checkRunnable != null) handler.removeCallbacks(checkRunnable);
            if (heartbeatRunnable != null) handler.removeCallbacks(heartbeatRunnable);
        }
        if (executor != null) {
            executor.shutdown();
        }
        // ★ 释放WakeLock
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        Log.d(TAG, "SignalMonitorService destroyed");
        
        // ★ 服务被杀死后自动重启
        Intent restartIntent = new Intent(this, SignalMonitorService.class);
        startService(restartIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static void start(Context context) {
        Intent intent = new Intent(context, SignalMonitorService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, SignalMonitorService.class);
        context.stopService(intent);
    }
}