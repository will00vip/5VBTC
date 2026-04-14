package com.btcai.autotrade;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * ★ 服务重启接收器
 * 当服务被杀死后，通过广播自动重启
 */
public class ServiceRestartReceiver extends BroadcastReceiver {
    private static final String TAG = "ServiceRestart";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.d(TAG, "收到广播: " + action);
        
        // 重启信号监控服务
        if (action != null) {
            switch (action) {
                case Intent.ACTION_BOOT_COMPLETED:
                case "android.intent.action.QUICKBOOT_POWERON":
                case "android.intent.action.REBOOT":
                    Log.d(TAG, "系统启动完成，启动信号监控服务");
                    SignalMonitorService.start(context);
                    break;
                    
                case "com.btcai.radar.RESTART_SERVICE":
                    Log.d(TAG, "收到重启服务广播");
                    SignalMonitorService.start(context);
                    break;
                    
                default:
                    // 其他情况也尝试启动服务
                    Log.d(TAG, "尝试启动信号监控服务");
                    SignalMonitorService.start(context);
                    break;
            }
        }
    }
}
