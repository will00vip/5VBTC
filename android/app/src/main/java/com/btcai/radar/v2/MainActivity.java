package com.btcai.radar.v2;

import android.os.Build;
import android.os.Bundle;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.webkit.WebView;
import android.util.Log;
import android.Manifest;
import android.content.pm.PackageManager;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    public static final String CHANNEL_ID = "btc_signal_channel";
    public static final String CHANNEL_NAME = "BTC信号通知";
    private static final int REQ_NOTIFICATION = 1001;
    private static MainActivity instance;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;
        createNotificationChannel();

        // ★ 动态申请通知权限（Android 13+必须）
        requestNotificationPermission();

        // ★ 启动后台信号监控服务
        startSignalMonitor();

        // 设置自定义 WebViewClient
        WebView webView = findViewById(android.R.id.content).findViewWithTag("mainWebView");
        if (webView == null) {
            // Capacitor 方式获取 WebView
            try {
                java.lang.reflect.Field bridgeField = BridgeActivity.class.getDeclaredField("bridge");
                bridgeField.setAccessible(true);
                Object bridge = bridgeField.get(this);
                if (bridge != null) {
                    java.lang.reflect.Field webViewField = bridge.getClass().getDeclaredField("webView");
                    webViewField.setAccessible(true);
                    webView = (WebView) webViewField.get(bridge);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        if (webView != null) {
            webView.setWebViewClient(new NotificationWebViewClient());
        }
    }

    // ★ 启动后台监控服务
    private void startSignalMonitor() {
        try {
            SignalMonitorService.start(this);
            Log.d("MainActivity", "✅ SignalMonitorService 已启动");
        } catch (Exception e) {
            Log.e("MainActivity", "❌ 启动监控服务失败: " + e.getMessage());
        }
    }

    // ★ 申请通知权限（Android 13+ API 33+）
    private void requestNotificationPermission() {
        // Build.VERSION_CODES.TIRAMISU = 33，直接用数字兼容低版本SDK编译
        if (Build.VERSION.SDK_INT >= 33) {
            String POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
            if (ContextCompat.checkSelfPermission(this, POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                    new String[]{POST_NOTIFICATIONS},
                    REQ_NOTIFICATION);
                Log.d("MainActivity", "正在请求通知权限...");
            } else {
                Log.d("MainActivity", "✅ 通知权限已授予");
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Log.d("MainActivity", "✅ 通知权限已授予，重启监控服务");
                startSignalMonitor();
            } else {
                Log.w("MainActivity", "⚠️ 通知权限被拒绝，推送功能受限");
            }
        }
    }

    public static MainActivity getInstance() {
        return instance;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("BTC信号提醒通知");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    public void showNotification(String title, String body) {
        Context context = this;
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent != null) {
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true);

            NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager != null) {
                notificationManager.notify((int) System.currentTimeMillis(), builder.build());
            }
        }
    }
}