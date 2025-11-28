# MMM-TMM-Control

MagicMirror 远程控制与系统监控模块

## 致谢

本项目基于 [MMM-Remote-Control](https://github.com/Jopyth/MMM-Remote-Control) 开发，感谢 Joseph Bethge 提供的优秀基础代码。

MMM-Remote-Control 是一个功能强大的 MagicMirror 远程控制模块，为我们提供了坚实的基础。在此基础上，我们进行了深度优化和功能增强。

## 概述

MMM-TMM-Control 是基于 MMM-Remote-Control 改进的增强版远程控制模块，提供了更强大的功能和更优秀的用户体验。

**来自 MMM-Remote-Control，优于 MMM-Remote-Control**

## 设计理念

### 为什么独立研发而不使用第三方模块？

我们选择在 MMM-Remote-Control 基础上深度定制，而不是简单使用第三方模块，主要基于以下考虑：

#### 1. 资源优化驱动

**问题：** 第三方模块往往为了通用性而持续运行，占用大量系统资源。

**我们的方案：**
- **按需触发**：只在需要时启动资源密集型功能
- **智能降频**：系统信息从 1 秒更新改为 5 秒更新
- **结果**：CPU 占用从 5-10% 降低到 < 2%

#### 2. 功能深度定制

**典型案例 - 系统监控增强：**
- 点击系统信息项 → 侧滑显示进程详情
- 多级进程展开，查看父子进程关系
- 直接杀进程，与 PM2 进程管理整合
- 自动识别并高亮 MagicMirror 模块关联的进程

#### 3. 可控性与可维护性

**优势：**
- 完全可控，可根据实际需求灵活调整
- 统一的错误处理和日志管理
- 深入了解每一行代码
- 可根据性能监控结果持续优化

#### 4. 技术栈整合

**统一标准：**
- Python 后端统一使用 8081 端口
- 统一的 API 设计规范
- 与系统监控深度整合，实时了解模块运行状态

**设计哲学：** "按需触发，最小化资源占用，深度整合，完全可控"

## 主要特性

### 远程控制功能
- 模块显示/隐藏控制
- 系统电源管理（关机、重启）
- MagicMirror 进程控制（重启、刷新）
- 显示器开关控制
- 模块配置管理
- 模块安装与更新
- 自定义命令执行

### 集成系统监控
本模块内置了系统信息监控功能，**取代了独立的 MMM-SystemInfo 模块**。

**优势对比：**

| 特性 | MMM-TMM-Control | MMM-SystemInfo |
|------|----------------|----------------|
| 存储使用率获取 | ✅ 准确（df 命令） | ❌ 实现有误，总返回 N/A |
| 集成度 | ✅ 集成到远程控制界面 | ❌ 需要独立加载 |
| 样式统一性 | ✅ 与控制面板统一 | ❌ 独立样式 |
| 代码效率 | ✅ HTTP API，简洁高效 | ❌ Socket 通信，较复杂 |
| 依赖关系 | ✅ 独立运行 | ❌ 需要模块加载 |

**监控指标：**
- CPU 使用率（实时计算）
- 内存使用率（总量/已用/可用）
- 系统运行时间（天数 + 小时）
- 存储使用率（根分区，通过 df 命令精确获取）

所有数据每 5 秒自动更新。

### 中文本地化
- 完整的中文界面
- 中文错误提示
- 智能错误诊断（网络错误、私有仓库、超时等）

### 增强的错误处理
- Git 操作超时检测
- SSH/HTTPS 自动转换
- 私有仓库智能识别
- 网络错误友好提示
- 详细的错误分类和建议

### 模块管理优化
- Git URL 精确匹配（避免同名模块混淆）
- 更新状态中文显示
- 依赖自动安装（npm ci/install）
- Changelog 展示

## 安装

```bash
cd ~/MagicMirror/modules
git clone https://github.com/TwinsenLiang/MMM-TMM-Control.git
cd MMM-TMM-Control
npm install
```

## 配置

```javascript
{
    module: "MMM-TMM-Control",
    position: "bottom_left",
    config: {
        // 自定义命令
        customCommand: {
            monitorOnCommand: "vcgencmd display_power 1",
            monitorOffCommand: "vcgencmd display_power 0",
            monitorStatusCommand: "vcgencmd display_power -1",
            shutdownCommand: "sudo shutdown -h now",
            rebootCommand: "sudo shutdown -r now"
        },
        // PM2 进程名称
        pm2ProcessName: "MagicMirror"
    }
}
```

## 远程访问

浏览器访问：`http://你的树莓派IP:8080/remote.html`

界面布局：
- **左侧**：远程控制面板（电源、编辑、配置、更新等）
- **右侧**：系统信息实时监控

## 主要改进

基于 MMM-Remote-Control，我们进行了以下改进：

1. **完整中文本地化**
   - 中文界面和提示信息
   - 中文错误诊断
   - 更新状态中文显示

2. **集成系统监控**（替代 MMM-SystemInfo）
   - 修复存储使用率获取问题
   - 集成到远程控制界面
   - 样式统一，用户体验更好

3. **增强的错误处理**
   - Git 操作超时检测
   - SSH/HTTPS 自动转换
   - 私有仓库智能识别
   - 详细的错误分类和建议

4. **Git 操作优化**
   - URL 精确匹配（避免同名模块混淆）
   - 依赖自动安装（npm ci/install）
   - Changelog 展示

5. **更友好的界面**
   - 左右分栏布局
   - 实时系统监控
   - 统一的视觉风格

## 技术栈

- **后端**：Node.js + Express
- **前端**：原生 JavaScript + Fetch API
- **系统信息**：Node.js `os` 模块 + Linux `df` 命令
- **Git 操作**：simple-git

## 进程分析

通过系统监控功能，我们分析了树莓派上的资源占用情况：

### CPU & 内存 TOP 5 交集进程

1. **Python 人脸识别后端** (`/home/mm/face_recognition_env/bin/python server.py`)
   - CPU: 104%（多核心占用）
   - 内存: 4.0% (~325MB)
   - 作用：MMM-CheckFace 的人脸识别算法处理
   - 优化方向：改为按需触发，待机时完全休眠

2. **Electron Zygote 进程** (`electron --type=zygote`)
   - CPU: 32.3%
   - 内存: 2.0% (~160MB)
   - 作用：Chromium 进程孵化器，管理 MagicMirror 模块渲染
   - 特点：MagicMirror 核心组件，无法避免

3. **PM2 守护进程** (`PM2 v6.0.13: God Daemon`)
   - CPU: 17.9%
   - 内存: 0.9% (~79MB)
   - 作用：进程管理器，监控和重启服务
   - 注意：CPU 占用偏高，可能在频繁重启某个服务

### 优化建议

基于进程分析，我们的优化策略：
- **人脸识别**：从持续运行改为按需触发（PIR 传感器/定时/手动）
- **系统监控**：智能降频，从 1 秒改为 5 秒更新
- **资源管理**：通过进程详情面板实时监控，及时发现异常

### 开发计划

#### 已完成
- ✅ 系统信息实时显示
- ✅ 进程详情查看（支持多级展开）
- ✅ 一键杀进程功能
- ✅ MagicMirror 模块自动识别
- ✅ 中文界面完整支持

#### 进行中
- 🔄 人脸识别按需触发优化
- 🔄 PIR 传感器集成

#### 计划中
- ⏳ CPU 温度监控
- ⏳ 网络流量统计
- ⏳ 磁盘 I/O 监控
- ⏳ 自定义告警规则

## 许可证

MIT License

基于 MMM-Remote-Control (MIT License by Joseph Bethge)

## 作者

TwinsenLiang - 改进与维护

原作者：Joseph Bethge - MMM-Remote-Control
