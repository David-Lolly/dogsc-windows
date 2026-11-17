# DogSC · Windows 适配版

> **原创作者：神烦老狗（[@laogou717](https://github.com/laogou717)）· 原仓库：[laogou717/dogsc](https://github.com/laogou717/dogsc)**
>
> DogSC 由原作者设计、开发并以 MIT License 开源。本仓库是在原版基础上重写的 Windows 适配版：产品形态、界面布局、功能定义，以及 `src/core/` 中的核心算法和默认参数均源自原版。它不是原作者的官方发布，使用中的问题请在本仓库反馈，不要提交到原仓库。

DogSC 原版是 macOS 原生应用（Swift + AppKit / ScreenCaptureKit / AVFoundation）。本项目使用 **Electron + FFmpeg + WebCodecs** 在 Windows 上实现完整录屏、轻量剪辑、自动缩放/3D 运镜与导出工作流。

![悬浮录制条](docs/images/recorder.png)

![编辑器：预览、运镜设置与时间线](docs/images/editor.png)

<sub>截图素材为自测色卡，不含个人录制内容。</sub>

---

## 环境与依赖说明

### 1. 开发与构建环境
- **操作系统**：Windows 10 / Windows 11（推荐 Windows 11，独立窗口采集需 Windows Graphics Capture 支持）
- **Node.js**：`>= 22.0.0`（含 `npm`，运行单元测试和开发启动）

### 2. 项目依赖（已通过 `package.json` 锁定）
运行 `npm install` 会自动安装以下全部 JS 与原生依赖（无需手动配置编译环境）：

| 依赖 | 版本 | 用途 | 开源协议 |
|---|---|---|---|
| `koffi` | `^3.3.2` | Windows Win32 API FFI 调用（显示器/窗口句柄、坐标与指针状态） | MIT |
| `electron` | `44.7.0` | 桌面应用运行时与窗口渲染框架（开发依赖） | MIT |
| `electron-builder` | `^26.18.0` | 打包免安装目录、ZIP 与 NSIS 安装包（开发依赖） | MIT |

### 3. 外部运行时依赖（需自行准备）
- **FFmpeg 与 ffprobe（完整版）**：用于屏幕采集、编码器探测、音频波形及音视频导出混流。
  - **关键要求**：必须包含 **`gfxcapture`**（Windows.Graphics.Capture，用于独立窗口/多屏原生录制）和 **`ddagrab`** 滤镜，普通精简版 FFmpeg 无法完成原生窗口录制。
  - **加载方式（任选其一）**：
    1. 将 `ffmpeg.exe` 与 `ffprobe.exe` 加入系统环境变量 `PATH`；
    2. 或直接放入仓库根目录新建的 `bin/` 文件夹中（`bin/ffmpeg.exe`、`bin/ffprobe.exe`，该目录已在 `.gitignore` 中忽略）。
  - **检查命令**：
    ```powershell
    ffmpeg -version
    ffprobe -version
    ffmpeg -hide_banner -filters | Select-String "gfxcapture|ddagrab"
    ```

### 4. 内置静态资源
- `resources/AppIconMaster.png`：应用图标
- `resources/Fonts/`：阿里巴巴普惠体 3.0 字体文件（字体许可见 `resources/Fonts/LICENSE.txt`）

---

## 快速开始（克隆即用）

### 1. 克隆并安装依赖
```powershell
git clone https://github.com/David-Lolly/dogsc-windows.git
cd dogsc-windows
npm install
```

### 2. 开发模式启动
```powershell
npm start
```
启动后会直接弹出悬浮录制条（可点击右侧 `−` 或按 `Ctrl+Alt+R` 收起为悬浮胶囊）。

### 3. 运行单元测试
```powershell
npm test
```
包含 77 项核心逻辑单元测试（工程模型、时间线、3D 投影、缩放动画、聚焦、导出事务、悬浮胶囊坐标等）。

### 4. 打包构建发布物
- **生成免安装目录**（输出到 `dist/win-unpacked/DogSC.exe`）：
  ```powershell
  npm run build:dir
  ```
- **生成安装包与便携压缩包**（输出 NSIS `.exe` 安装器与 `.zip` 便携包到 `dist/`）：
  ```powershell
  npm run build
  ```
> **提示**：如果需要分发**自带 FFmpeg 的免环境绿色包**，将 `ffmpeg.exe` 和 `ffprobe.exe` 复制到打包输出目录的 `resources/bin/` 下即可，程序打包态会自动优先读取 `process.resourcesPath/bin/`。

---

## 目录结构

```text
dogsc-windows/
├─ src/
│  ├─ core/          # 纯逻辑与算法层（工程契约、时间线、缩放、3D 投影、聚焦、遮罩等）
│  ├─ main/          # Electron 主进程（窗口、快捷键、WGC 采集、FFmpeg 封装、项目读写）
│  └─ renderer/      # 渲染进程 UI（录制条/悬浮胶囊、编辑器、项目库、摄像头浮窗、选区）
├─ resources/        # 静态资源（应用图标、阿里巴巴普惠体与许可）
├─ tests/            # 单元测试（*.test.js）与真实 Electron/GPU 探针脚本（*-probe.*）
├─ tools/            # 可选的本地用户安装/卸载 PowerShell 脚本
├─ docs/             # 截图与各阶段 Windows 验证记录（docs/validation/）
├─ package.json      # 依赖清单、脚本与 electron-builder 打包配置
├─ package-lock.json # 依赖版本锁文件
└─ LICENSE           # MIT 开源许可证
```

---

## 当前功能与已知边界

- **采集**：显示器 / 区域 / 独立窗口（Windows Graphics Capture）、摄像头、麦克风、系统声音分轨、录制标记、备忘录、原生光标轨迹记录。
- **剪辑与特效**：片段分割/重排/恢复/变速、分段音量与波形、自动/手动缩放、自定义曲线、屏幕 3D 运镜、径向/线性聚焦模糊、贴图与马赛克/突出区域、动态与视频背景、场景预设、多选批量编辑与撤销重做。
- **导出**：MP4（H.264+AAC）/ M4A，30/60 FPS，原始/1080p/1440p/4K，硬件编码探测与软件回退，事务化防覆盖写入。
- **已知边界**：工程文件保存在 `%USERPROFILE%\Videos\DogSC` 下，与 macOS 版工程不互通；iPhone/iPad 有线接入未适配；界面目前为中文；安装包默认未签名。详情可参考 [docs/validation/16-windows-delivery.md](docs/validation/16-windows-delivery.md)。
