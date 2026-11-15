# Windows 可靠性验证（0.1.2-win.9-dev）

范围：Windows 自动保存、关闭收尾、中断录制恢复和长媒体索引。iPhone/iPad 与 Mac 互通不在范围。

已实现：串行自动保存与版本确认；关闭等待/失败保留窗口；工程原子替换和上次保存备份；中断录制检查点、光标日志、项目库恢复入口；恢复创建新工程并保持原目录不变；索引按输出流解析，避免保留整段 ffprobe 文本。

验证命令（仓库根目录）：

```powershell
npm --prefix windows test
node windows/tests/long-media-probe.js
python windows/tools/build-local.py --probe
$env:DOGSC_PROBE_OUTPUT = (Resolve-Path analysis/results).Path
$env:DOGSC_SAVE_CLOSE_PROBE = '1' # 或 DOGSC_RECOVERY_PROBE；每次只设置一种探针
Start-Process (Resolve-Path build/windows-probe/DogSC.exe).Path -WindowStyle Hidden -Wait
Remove-Item Env:DOGSC_SAVE_CLOSE_PROBE
```

结果：

- 66 项 Node 回归通过。
- 实际编辑器关闭测试通过：保存中继续编辑最终写入最新版本；模拟写盘失败时保持窗口，重试后关闭。
- 实际 FFmpeg 恢复测试通过：3 秒屏幕 + 麦克风、-250ms 偏移、标记、截断末行光标日志均可恢复，原素材散列不变。
- 一小时合成媒体：60fps、216,000 帧、近尾部解码通过；生成约 19 秒，索引/近尾检查约 2.7 秒，索引堆增长约 22.3MiB，观测进程 RSS 峰值约 92.6MiB。本机数据，**不代表一小时实机录制或设备时钟认证**。

报告位于工作区 `analysis/results/save-close-report.json`、`recovery-report.json` 和 `long-media/report.json`。后续 Windows 硬件矩阵、长录制及安装发行仍单独跟踪。
