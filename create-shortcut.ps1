# ============================================================ 
# FuckUOOC - 创建桌面快捷方式
# 运行此脚本创建无CMD窗口启动的桌面快捷方式
# ============================================================

$ErrorActionPreference = "Stop"

# 获取当前目录
$currentDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# VBScript 启动器路径
$vbsPath = Join-Path $currentDir "launch-hidden.vbs"

# 检查 VBScript 是否存在
if (-not (Test-Path $vbsPath)) {
    Write-Error "找不到启动器文件: $vbsPath"
    exit 1
}

# 桌面路径
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "FuckUOOC.lnk"

# 创建快捷方式
$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut($shortcutPath)

$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $currentDir
$shortcut.Description = "FuckUOOC - UOOC 自动刷课工具"
$shortcut.WindowStyle = 7  # 7 = 最小化运行

# 设置图标（如果存在）
$iconPath = Join-Path $currentDir "electron\renderer\icon.png"
if (Test-Path $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
}

$shortcut.Save()

Write-Host "========================================" -ForegroundColor Green
Write-Host "快捷方式创建成功！" -ForegroundColor Green
Write-Host "位置: $shortcutPath" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "使用说明:" -ForegroundColor Yellow
Write-Host "  - 双击桌面快捷方式启动（无CMD窗口）" -ForegroundColor White
Write-Host "  - 双击 launch-hidden.vbs 启动（无CMD窗口）" -ForegroundColor White
Write-Host "  - 运行 npm run gui 启动（会显示CMD窗口）" -ForegroundColor White
Write-Host ""

# 清理 COM 对象
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($shortcut) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($WshShell) | Out-Null