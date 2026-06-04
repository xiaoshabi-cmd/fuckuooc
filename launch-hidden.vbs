' ============================================================ 
' FuckUOOC - 隐藏CMD窗口启动器
' 双击此文件可无CMD窗口启动应用
' ============================================================

Set WshShell = CreateObject("WScript.Shell")

' 获取脚本所在目录
Dim scriptDir
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' 切换到应用目录
WshShell.CurrentDirectory = scriptDir

' 隐藏窗口启动 Electron (0 = 隐藏窗口)
WshShell.Run "npx electron . --hidden", 0, False

Set WshShell = Nothing