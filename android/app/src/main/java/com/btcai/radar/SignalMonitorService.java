package com.btcai.radar.v2;

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

    private ExecutorService executor;
    private Handler handler;
    private Runnable checkRunnable;
    private SharedPreferences prefs;
    private long lastNotifyTime = 0;
    private int lastSignalType = 0; // 0=无, 1=做多, 2=做空

    @Override
    public void onCreate() {
        super.onCreate();
        executor = Executors.newSingleThreadExecutor();
        handler = new Handler(Looper.getMainLooper());
        prefs = getSharedPreferences("btc_radar", MODE_PRIVATE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "SignalMonitorService started");

        // 创建前台通知
        Notification notification = createForegroundNotification();
        startForeground(NOTIFICATION_ID, notification);

        // 开始定期检查
        startPeriodicCheck();

        return START_STICKY;
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

                        Log.d(TAG, "Signal analysis: score=" + result.score + ", direction=" + result.direction);

                        // 触发通知
                        boolean shouldNotify = false;
                        String direction = "";
                        int score = result.score;

                        if (result.score >= 60) {
                            direction = "做多";
                            shouldNotify = true;
                            lastSignalType = 1;
                        } else if (result.score <= 40) {
                            direction = "做空";
                            shouldNotify = true;
                            lastSignalType = 2;
                        }

                        if (shouldNotify) {
                            long now = System.currentTimeMillis();
                            if (now - lastNotifyTime > COOL_DOWN) {
                                lastNotifyTime = now;
                                showSignalNotification(direction, score, result.reason);
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
        int score;
        String direction;
        String reason;
        double rsi;
        double jValue;
        double macdHist;
        double bollPercent;
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

            // ========== 综合评分 ==========
            // 与前端 calculateOverallScore() 函数保持同步
            int score = 0;

            // 1. 趋势 (20分)
            if (ma5 > ma20) {
                score += 16;  // 多头
            } else {
                score += 4;   // 空头
            }

            // 2. RSI (20分)
            if (rsi < 35) score += 20;       // 超卖，看多
            else if (rsi < 45) score += 15;  // 偏低
            else if (rsi > 65) score += 0;    // 超买
            else if (rsi > 55) score += 5;    // 偏高
            else score += 10;                 // 中性

            // 3. MACD (20分)
            if (macdHist > 0) score += 18;   // 多头
            else score += 2;                  // 空头

            // 4. KDJ (20分)
            if (jValue < 30) score += 20;    // 超卖
            else if (jValue < 45) score += 15;
            else if (jValue > 70) score += 0;  // 超买
            else if (jValue > 55) score += 5;
            else score += 10;

            // 5. BOLL (20分)
            if (bollPercent < 30) score += 20;   // 接近下轨，看多
            else if (bollPercent < 40) score += 15;
            else if (bollPercent > 70) score += 0;  // 接近上轨，看空
            else if (bollPercent > 60) score += 5;
            else score += 10;

            result.score = Math.min(100, Math.max(0, score));

            // 原因说明
            StringBuilder reason = new StringBuilder();
            reason.append("RSI:").append((int)rsi).append(" ");
            reason.append("KDJ:").append((int)jValue).append(" ");
            reason.append("BOLL:").append((int)bollPercent).append("%");
            result.reason = reason.toString();

            if (result.score >= 60) result.direction = "做多";
            else if (result.score <= 40) result.direction = "做空";
            else result.direction = "观望";

            Log.d(TAG, "分析结果: score=" + result.score + ", RSI=" + rsi + ", KDJ=" + jValue + ", BOLL%=" + bollPercent);

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

    private void showSignalNotification(String direction, int score, String reason) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE);

        String emoji = direction.equals("做多") ? "🟢" : "🔴";
        String content = emoji + " " + direction + "信号 | " + score + "分\n" + reason;

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🚨 BTC信号: " + direction + "!")
            .setContentText(content)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(content))
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .build();

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify((int) System.currentTimeMillis(), notification);
        }

        Log.d(TAG, "Signal notification: " + direction + " " + score);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (handler != null && checkRunnable != null) {
            handler.removeCallbacks(checkRunnable);
        }
        if (executor != null) {
            executor.shutdown();
        }
        Log.d(TAG, "SignalMonitorService destroyed");
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
