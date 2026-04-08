package com.btcai.radar.v2;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class SignalDetailActivity extends AppCompatActivity {
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_signal_detail);
        
        // 获取传递的数据
        Intent intent = getIntent();
        String direction = intent.getStringExtra("direction");
        int score = intent.getIntExtra("score", 0);
        String reason = intent.getStringExtra("reason");
        double price = intent.getDoubleExtra("price", 0);
        double stopLoss = intent.getDoubleExtra("stopLoss", 0);
        double takeProfit1 = intent.getDoubleExtra("takeProfit1", 0);
        double takeProfit2 = intent.getDoubleExtra("takeProfit2", 0);
        int leverage = intent.getIntExtra("leverage", 30);
        long timestamp = intent.getLongExtra("timestamp", System.currentTimeMillis());
        
        // 设置标题
        TextView titleText = findViewById(R.id.detailTitle);
        if (direction != null && direction.contains("做多")) {
            titleText.setText("🟢 做多信号详情");
            titleText.setTextColor(getResources().getColor(android.R.color.holo_green_dark));
        } else if (direction != null && direction.contains("做空")) {
            titleText.setText("🔴 做空信号详情");
            titleText.setTextColor(getResources().getColor(android.R.color.holo_red_dark));
        } else {
            titleText.setText("📊 信号详情");
        }
        
        // 设置分数
        TextView scoreText = findViewById(R.id.detailScore);
        scoreText.setText(String.valueOf(score) + "分");
        
        // 设置分数等级
        TextView scoreLevelText = findViewById(R.id.detailScoreLevel);
        String levelText;
        int levelColor;
        if (Math.abs(score) >= 85) {
            levelText = "🔥 强烈信号";
            levelColor = getResources().getColor(android.R.color.holo_orange_dark);
        } else if (Math.abs(score) >= 70) {
            levelText = "✅ 优质信号";
            levelColor = getResources().getColor(android.R.color.holo_green_dark);
        } else if (Math.abs(score) >= 60) {
            levelText = "⚠️ 基础信号";
            levelColor = getResources().getColor(android.R.color.holo_orange_light);
        } else {
            levelText = "💤 观望信号";
            levelColor = getResources().getColor(android.R.color.darker_gray);
        }
        scoreLevelText.setText(levelText);
        scoreLevelText.setTextColor(levelColor);
        
        // 设置时间
        TextView timeText = findViewById(R.id.detailTime);
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA);
        timeText.setText("信号时间: " + sdf.format(new Date(timestamp)));
        
        // 设置价格
        TextView priceText = findViewById(R.id.detailPrice);
        priceText.setText(String.format("当前价格: $%.2f", price));
        
        // 设置止损
        TextView slText = findViewById(R.id.detailStopLoss);
        if (stopLoss > 0) {
            slText.setText(String.format("止损价: $%.2f", stopLoss));
        } else {
            slText.setVisibility(View.GONE);
        }
        
        // 设置止盈
        TextView tp1Text = findViewById(R.id.detailTakeProfit1);
        TextView tp2Text = findViewById(R.id.detailTakeProfit2);
        if (takeProfit1 > 0) {
            tp1Text.setText(String.format("止盈1: $%.2f", takeProfit1));
        } else {
            tp1Text.setVisibility(View.GONE);
        }
        if (takeProfit2 > 0) {
            tp2Text.setText(String.format("止盈2: $%.2f", takeProfit2));
        } else {
            tp2Text.setVisibility(View.GONE);
        }
        
        // 设置杠杆倍数
        TextView leverageText = findViewById(R.id.detailLeverage);
        if (leverage > 0) {
            leverageText.setText(String.format("建议杠杆: %dx", leverage));
        } else {
            leverageText.setVisibility(View.GONE);
        }
        
        // 设置打分逻辑
        TextView logicText = findViewById(R.id.detailLogic);
        logicText.setText(buildScoreLogic(reason));
        
        // 设置指标详情
        TextView indicatorsText = findViewById(R.id.detailIndicators);
        indicatorsText.setText(reason != null ? reason : "暂无指标详情");
        
        // 清除通知按钮
        Button clearBtn = findViewById(R.id.btnClearNotification);
        clearBtn.setOnClickListener(v -> {
            // 清除通知
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancelAll();
            }
            finish();
        });
        
        // 查看详情按钮（打开主应用）
        Button viewBtn = findViewById(R.id.btnViewDetails);
        viewBtn.setOnClickListener(v -> {
            Intent mainIntent = new Intent(this, MainActivity.class);
            mainIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(mainIntent);
            finish();
        });
    }
    
    private String buildScoreLogic(String reason) {
        StringBuilder sb = new StringBuilder();
        sb.append("📊 打分逻辑:\n\n");
        
        // 基础条件评分
        sb.append("1️⃣ 基础条件评分 (0-8分)\n");
        sb.append("   - 插针形态确认\n");
        sb.append("   - 高低点确认\n");
        sb.append("   - MACD配合\n\n");
        
        // 多周期共振
        sb.append("2️⃣ 多周期共振 (0-15分)\n");
        sb.append("   - 趋势一致性\n");
        sb.append("   - RSI极端值\n");
        sb.append("   - MACD方向\n");
        sb.append("   - 成交量确认\n\n");
        
        // 趋势强度
        sb.append("3️⃣ 趋势强度 (0-6分)\n");
        sb.append("   - 强势多头/空头\n");
        sb.append("   - 一般趋势\n\n");
        
        // 波动率
        sb.append("4️⃣ 波动率评分 (0-6分)\n");
        sb.append("   - ATR百分比\n\n");
        
        // 成交量
        sb.append("5️⃣ 成交量评分 (0-3分)\n");
        sb.append("   - 相对20日均量\n\n");
        
        sb.append("总分 = 0-35分 → 映射到 60-100分(做多) 或 -100到-60分(做空)");
        
        return sb.toString();
    }
}
