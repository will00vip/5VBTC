package com.btcai.radar.v2;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * 开机自启动接收器
 * 用户授权自启动权限后，App自动启动监控服务
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Log.d(TAG, "设备已启动，开始后台监控...");

            // 延迟启动，确保系统就绪
            android.os.Handler handler = new android.os.Handler(
                context.getMainLooper());
            handler.postDelayed(() -> {
                SignalMonitorService.start(context);
                Log.d(TAG, "SignalMonitorService 已启动");
            }, 3000); // 3秒延迟
        }
    }
}
