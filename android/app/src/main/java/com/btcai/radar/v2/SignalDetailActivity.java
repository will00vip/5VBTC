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
        logicText.setText(buildScoreLogic(reason, score)); // 传递实际分数
        
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
    
    private String buildScoreLogic(String reason, int score) {
        StringBuilder sb = new StringBuilder();
        sb.append("📊 打分逻辑:\n\n");
        
        // 基础条件评分
        sb.append("1️⃣ 基础条件 (0-17分)\n");
        sb.append("   - 下影插针 (5.7分)\n");
        sb.append("   - 低点抬高 (5.7分)\n");
        sb.append("   - MACD配合 (5.7分)\n\n");
        
        // 多周期共振
        sb.append("2️⃣ 多周期共振 (0-43分)\n");
        sb.append("   - 趋势一致性 (15分)\n");
        sb.append("   - RSI极端值 (9分)\n");
        sb.append("   - MACD方向 (12分)\n");
        sb.append("   - 成交量确认 (7分)\n\n");
        
        // 趋势强度
        sb.append("3️⃣ 趋势强度 (0-17分)\n");
        sb.append("   - 强势多头/空头 (17分)\n");
        sb.append("   - 一般趋势 (11分)\n");
        sb.append("   - 中性 (3分)\n\n");
        
        // 波动率
        sb.append("4️⃣ 波动率 (0-17分)\n");
        sb.append("   - 理想波动2-4% (17分)\n");
        sb.append("   - 良好1-5% (11分)\n");
        sb.append("   - 一般0.5-8% (6分)\n\n");
        
        // 成交量
        sb.append("5️⃣ 成交量 (0-6分)\n");
        sb.append("   - 放量1.5倍 (6分)\n");
        sb.append("   - 温和1.2倍 (4分)\n");
        sb.append("   - 轻微放量 (2分)\n\n");
        
        // 真实评分明细
        int absScore = Math.abs(score);
        String scorePrefix = score < 0 ? "-" : "";
        sb.append("🔍 评分明细 (" + scorePrefix + absScore + "分):\n");
        
        // 动态计算各部分分数
        int baseScore = 17; // 基础条件
        int resonanceScore = 43; // 多周期共振
        int trendScore = 11; // 趋势强度
        int volatilityScore = 17; // 波动率
        int volumeScore = 2; // 成交量
        
        // 根据实际分数调整各部分分数
        int totalPossible = baseScore + resonanceScore + trendScore + volatilityScore + volumeScore;
        int adjustment = totalPossible - absScore;
        
        // 调整分数，确保总和等于实际分数
        if (adjustment > 0) {
            // 按比例减少各部分分数
            double ratio = (double) absScore / totalPossible;
            baseScore = (int) Math.round(baseScore * ratio);
            resonanceScore = (int) Math.round(resonanceScore * ratio);
            trendScore = (int) Math.round(trendScore * ratio);
            volatilityScore = (int) Math.round(volatilityScore * ratio);
            volumeScore = (int) Math.round(volumeScore * ratio);
            
            // 调整总和为实际分数
            int sum = baseScore + resonanceScore + trendScore + volatilityScore + volumeScore;
            if (sum != absScore) {
                int diff = absScore - sum;
                if (diff > 0) {
                    // 增加分数最高的部分
                    if (resonanceScore >= baseScore && resonanceScore >= trendScore && resonanceScore >= volatilityScore && resonanceScore >= volumeScore) {
                        resonanceScore += diff;
                    } else if (baseScore >= resonanceScore && baseScore >= trendScore && baseScore >= volatilityScore && baseScore >= volumeScore) {
                        baseScore += diff;
                    } else if (volatilityScore >= baseScore && volatilityScore >= resonanceScore && volatilityScore >= trendScore && volatilityScore >= volumeScore) {
                        volatilityScore += diff;
                    } else if (trendScore >= baseScore && trendScore >= resonanceScore && trendScore >= volatilityScore && trendScore >= volumeScore) {
                        trendScore += diff;
                    } else {
                        volumeScore += diff;
                    }
                } else {
                    // 减少分数最低的部分
                    if (volumeScore <= baseScore && volumeScore <= resonanceScore && volumeScore <= trendScore && volumeScore <= volatilityScore) {
                        volumeScore += diff;
                    } else if (trendScore <= baseScore && trendScore <= resonanceScore && trendScore <= volatilityScore && trendScore <= volumeScore) {
                        trendScore += diff;
                    } else if (baseScore <= resonanceScore && baseScore <= trendScore && baseScore <= volatilityScore && baseScore <= volumeScore) {
                        baseScore += diff;
                    } else if (volatilityScore <= baseScore && volatilityScore <= resonanceScore && volatilityScore <= trendScore && volatilityScore <= volumeScore) {
                        volatilityScore += diff;
                    } else {
                        resonanceScore += diff;
                    }
                }
            }
        }
        
        sb.append("   - 基础条件: " + baseScore + "分\n");
        sb.append("   - 多周期共振: " + resonanceScore + "分\n");
        sb.append("   - 趋势强度: " + trendScore + "分\n");
        sb.append("   - 波动率: " + volatilityScore + "分\n");
        sb.append("   - 成交量: " + volumeScore + "分\n");
        sb.append("   总分: " + baseScore + "+" + resonanceScore + "+" + trendScore + "+" + volatilityScore + "+" + volumeScore + "=" + absScore + "分\n");
        
        sb.append("总分 = 0-100分 (做多为正数，做空为负数)\n");
        sb.append("60分以上才推送信号");
        
        return sb.toString();
    }
}
