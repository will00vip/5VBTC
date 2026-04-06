package com.btcai.radar.v2;

import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Log;

public class NotificationWebViewClient extends WebViewClient {
    private static final String TAG = "NotificationWebView";

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        // 拦截特殊的 URL scheme 来触发通知
        if (url.startsWith("btcnotify://show?")) {
            try {
                String query = url.substring("btcnotify://show?".length());
                String title = "BTC信号";
                String body = "";
                for (String param : query.split("&")) {
                    String[] kv = param.split("=");
                    if (kv.length == 2) {
                        if (kv[0].equals("title")) {
                            title = java.net.URLDecoder.decode(kv[1], "UTF-8");
                        } else if (kv[0].equals("body")) {
                            body = java.net.URLDecoder.decode(kv[1], "UTF-8");
                        }
                    }
                }
                MainActivity activity = MainActivity.getInstance();
                if (activity != null) {
                    activity.showNotification(title, body);
                    Log.d(TAG, "通知已显示: " + title);
                }
            } catch (Exception e) {
                Log.e(TAG, "处理通知失败: " + e.getMessage());
            }
            return true;
        }
        return super.shouldOverrideUrlLoading(view, url);
    }
}
