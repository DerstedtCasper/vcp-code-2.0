# Snow CLI - onUserMessage Windows 通知脚本
# 用途：显示 Windows 系统通知（任务结束通知）

# # 设置控制台输入输出编码为 UTF-8（修复中文乱码）
# [Console]::InputEncoding = [System.Text.Encoding]::UTF8
# [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# $OutputEncoding = [System.Text.Encoding]::UTF8

# # 从 stdin 读取所有输入（原始内容）
# $message = [Console]::In.ReadToEnd()

$message = 'Snow CLI 任务已完成'

# 异步显示通知，避免超时（启动独立进程）
$script = @"
Add-Type -AssemblyName System.Windows.Forms
`$n = New-Object System.Windows.Forms.NotifyIcon
`$n.Icon = [System.Drawing.SystemIcons]::Information
`$n.BalloonTipTitle = 'Snow CLI'
`$n.BalloonTipText = '$message'
`$n.Visible = `$true
`$n.ShowBalloonTip(5000)
Start-Sleep -Seconds 3
`$n.Dispose()
"@
Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command',$script -WindowStyle Hidden

# 返回退出码 0
exit 0
