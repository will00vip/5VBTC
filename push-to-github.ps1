# BTC 3-Step Trading Push Script
# 运行前请先在 GitHub 上创建仓库：https://github.com/new
# Repository name: btc-3step-trading

Write-Host "======================================"
Write-Host "  BTC 3-Step Trading - Git Push"
Write-Host "======================================"
Write-Host ""

Set-Location $PSScriptRoot

# 检查远程仓库
$remote = git remote get-url origin 2>$null
if (-not $remote) {
    Write-Host "[ERROR] 远程仓库未设置"
    Write-Host "请先在 GitHub 上创建仓库，然后运行："
    Write-Host "  git remote add origin https://github.com/will00vip/btc-3step-trading.git"
    exit 1
}

Write-Host "[1/3] 推送到 main 分支..."
git push -u origin main

Write-Host ""
Write-Host "[2/3] 推送到 3step-trading 分支..."
git push -u origin 3step-trading

Write-Host ""
Write-Host "[3/3] 推送到其他分支..."
git push -u origin auto-trade
git push -u origin public-share

Write-Host ""
Write-Host "======================================"
Write-Host "  推送完成！"
Write-Host "======================================"
Write-Host ""
Write-Host "仓库地址：https://github.com/will00vip/btc-3step-trading"
Write-Host ""
Write-Host "分支说明："
Write-Host "  - main: 主分支"
Write-Host "  - 3step-trading: 三步交易法主分支"
Write-Host "  - auto-trade: 自动化交易分支"
Write-Host "  - public-share: 大众分享版"
