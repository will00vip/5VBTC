# 编译APK的PowerShell脚本
# 绕过Gradle配置问题，直接使用正确的Java路径

# 进入Android目录
Set-Location "d:\btc\btcforme\android"

# 生成时间戳
$timestamp = Get-Date -Format "yyyyMMddHHmmss"

# 设置正确的Java路径
$javaHome = "C:\Program Files\Eclipse Adoptium\jdk-11.0.30.7-hotspot"
$env:JAVA_HOME = $javaHome
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

Write-Host "开始编译APK..."
Write-Host "Java路径: $env:JAVA_HOME"
Write-Host "时间戳: $timestamp"

# 执行Gradle编译
try {
    & "$env:JAVA_HOME\bin\java.exe" -version

    & .\gradlew.bat assembleDebug

    if ($LASTEXITCODE -eq 0) {
        Write-Host "编译成功!"

        # 复制APK文件到根目录
        $sourceApk = "d:\btc\btcforme\android\app\build\outputs\apk\debug\app-debug.apk"
        $destApk = "d:\btc\btcforme\autotrade-debug-$timestamp.apk"

        if (Test-Path $sourceApk) {
            Copy-Item -Path $sourceApk -Destination $destApk -Force
            Write-Host "APK已复制到: $destApk"
            Write-Host "文件大小: $((Get-Item $destApk).Length) 字节"
        } else {
            Write-Host "警告: 未找到编译的APK文件: $sourceApk"
            # 列出目录内容
            Write-Host "目录内容:"
            Get-ChildItem "d:\btc\btcforme\android\app\build\outputs\apk\debug\" | Format-List
        }
    } else {
        Write-Host "编译失败，退出码: $LASTEXITCODE"
    }
} catch {
    Write-Host "编译过程中出现错误: $($_.Exception.Message)"
}

Write-Host "编译完成"