# Kylin Desktop Reprepro Package Manager

一个基于 Node.js 的 Debian/Ubuntu 软件包仓库管理系统，提供 Web UI 界面，支持包上传、镜像同步、计划任务等功能。

## 📋 目录

- [系统架构](#系统架构)
- [核心功能](#核心功能)
- [目录结构](#目录结构)
- [部署方式](#部署方式)
- [API 接口](#api-接口)
- [使用指南](#使用指南)
- [配置说明](#配置说明)

## 🏗️ 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        客户端层                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐   │
│  │   Web Browser   │  │     API Client  │  │   Crontab     │   │
│  └────────┬────────┘  └────────┬────────┘  └───────┬───────┘   │
└───────────┼────────────────────┼───────────────────┼───────────┘
            │                    │                   │
            ▼                    ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                        应用层                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Express Server                          │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │ │
│  │  │  Repo    │ │ Upload   │ │ Mirror   │ │ Schedule     │  │ │
│  │  │ Manager  │ │ Handler  │ │ Sync     │ │ Task Manager │  │ │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───────┬──────┘  │ │
│  └───────┼────────────┼────────────┼────────────────┼─────────┘ │
└───────────┼────────────┼────────────┼────────────────┼───────────┘
            │            │            │                │
            ▼            ▼            ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        工具层                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │   reprepro   │ │   apt-mirror │ │      cron            │    │
│  │  (包管理)    │ │  (镜像同步)  │ │   (定时任务)         │    │
│  └──────┬───────┘ └──────┬───────┘ └──────────┬───────────┘    │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        数据层                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │  repos/      │ │ mirror-syncs/│ │   *.json     │          │
│  │  (包仓库)    │ │  (镜像缓存)  │ │  (配置文件)   │          │
│  └──────────────┘ └──────────────┘ └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 架构说明

| 层级 | 组件 | 职责 |
|------|------|------|
| **客户端层** | Web Browser, API Client, Crontab | 用户交互、API 调用、定时任务触发 |
| **应用层** | Express Server | HTTP 服务、路由分发、业务逻辑处理 |
| **工具层** | reprepro, apt-mirror, cron | 包管理、镜像同步、定时调度 |
| **数据层** | 文件系统 | 存储仓库数据、镜像缓存、配置文件 |

### 核心组件

#### 1. Repository Manager（仓库管理器）
- 管理多个软件仓库
- 创建/删除仓库
- 配置仓库参数（发行版、架构、组件）

#### 2. Upload Handler（上传处理器）
- 接收 deb 包上传
- 校验包完整性
- 调用 reprepro 入库

#### 3. Mirror Sync（镜像同步）
- 配置上游镜像源
- 定时同步上游包
- 支持多架构同步

#### 4. Schedule Task Manager（计划任务管理器）
- 管理同步计划任务
- 基于 Linux Crontab 实现
- 支持多种频率设置（每分钟、每小时、每天、每周、每月）

## ✨ 核心功能

### 1. 仓库管理
- ✅ 创建/删除仓库
- ✅ 配置发行版（Codename）
- ✅ 配置支持的架构（amd64, arm64, i386, loongarch64）
- ✅ 配置组件（main, restricted, universe, multiverse）

### 2. 包上传
- ✅ 支持多文件同时上传
- ✅ 实时上传进度显示
- ✅ 自动校验和签名
- ✅ 支持拖放上传

### 3. 镜像同步
- ✅ 配置多个上游镜像源
- ✅ 支持多架构同步
- ✅ 带宽限制
- ✅ 同步日志记录

### 4. 计划任务
- ✅ 可视化任务配置
- ✅ 支持多种同步频率
- ✅ 任务启用/禁用
- ✅ 执行日志追踪

## 📁 目录结构

```
Kylin-Desktop-Reprepro/
├── conf/                    # 默认配置模板
│   ├── distributions        # 发行版配置模板
│   └── options              # 选项配置模板
├── mirror-configs/          # 镜像同步配置文件
│   └── *.conf               # 每个配置对应一个上游源
├── public/                  # 前端静态文件
│   └── index.html           # Web UI 界面
├── repos/                   # 软件仓库目录
│   └── {repo_name}/        # 每个仓库一个目录
│       ├── conf/            # 仓库配置
│       │   ├── distributions
│       │   └── options
│       └── db/              # reprepro 数据库
├── tools/                   # 辅助工具
│   ├── repo-manager.js      # 仓库管理工具
│   └── sign-repo.js         # GPG 签名工具
├── Dockerfile               # Docker 构建文件
├── docker-compose.yml       # Docker Compose 配置
├── package.json             # Node.js 依赖配置
└── server.js                # 主服务入口
```

## 🚀 部署方式

### 方式一：Docker 部署（推荐）

```bash
# 构建镜像
docker build -t kylin-reprepro .

# 运行容器
docker run -d \
  -p 3000:3000 \
  -v /path/to/repos:/app/repos \
  -v /path/to/mirror-syncs:/app/mirror-syncs \
  --name kylin-reprepro \
  kylin-reprepro
```

### 方式二：Docker Compose

```bash
# 启动服务
docker-compose up -d

# 停止服务
docker-compose down
```

### 方式三：直接运行

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

## 🌐 API 接口

### 仓库管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/repos` | 获取所有仓库列表 |
| POST | `/repos` | 创建新仓库 |
| GET | `/repos/:name` | 获取仓库详情 |
| DELETE | `/repos/:name` | 删除仓库 |

### 包上传

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/upload` | 上传 deb 包 |

### 镜像同步

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/mirrors` | 获取所有镜像配置 |
| POST | `/mirrors` | 创建镜像配置 |
| POST | `/mirrors/:configName/sync` | 手动触发同步 |
| GET | `/mirrors/tasks` | 获取同步任务状态 |

### 计划任务

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/schedule/tasks` | 获取所有计划任务 |
| POST | `/schedule/tasks` | 创建计划任务 |
| PUT | `/schedule/tasks/:taskId` | 更新计划任务 |
| DELETE | `/schedule/tasks/:taskId` | 删除计划任务 |
| GET | `/schedule/crontab/status` | 检查 crontab 状态 |
| POST | `/schedule/test/:configName` | 测试同步任务 |

## 📖 使用指南

### 1. 访问界面

启动服务后，访问 `http://localhost:3000` 即可打开 Web UI。

### 2. 创建仓库

1. 在左侧菜单点击"仓库管理"
2. 点击"创建仓库"
3. 输入仓库名称和发行版代号（如 focal）
4. 选择支持的架构和组件
5. 点击"创建"

### 3. 上传包

1. 在左侧菜单点击"包上传"
2. 选择目标仓库
3. 选择或拖放 deb 包文件
4. 点击"开始上传"

### 4. 配置镜像同步

1. 在左侧菜单点击"镜像同步"
2. 点击"创建镜像配置"
3. 填写镜像名称和上游源 URL
4. 选择要同步的架构
5. 点击"保存"

### 5. 设置计划任务

1. 在"镜像同步"页面找到"计划任务"区域
2. 点击"添加计划任务"
3. 选择镜像配置
4. 设置同步频率（如每天凌晨 2 点）
5. 点击"保存"

## ⚙️ 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务端口 |
| TZ | Asia/Shanghai | 时区设置 |

### 仓库配置

每个仓库的配置文件位于 `repos/{repo_name}/conf/`：

**distributions** - 发行版配置：
```
Origin: Kylin Desktop
Label: Kylin Desktop
Codename: focal
Architectures: amd64 i386 arm64 loongarch64
Components: main restricted
Description: Kylin Desktop Package Repository
```

**options** - 选项配置：
```
verbose
basedir .
```

### 镜像同步配置

镜像配置文件位于 `mirror-configs/{name}.conf`：

```
set base_path /app/mirror-syncs/test-config
set defaultarch amd64
set nthreads 4
set timeout 120

deb-amd64 http://archive.kylinos.cn/kylin/KYLIN-ALL/ 10.1 restricted
deb-arm64 http://archive.kylinos.cn/kylin/KYLIN-ALL/ 10.1 restricted
```

## 📝 License

MIT License

## 🤝 Contributing

欢迎提交 Issue 和 Pull Request！

## 📞 Support

如有问题，请提交 Issue 或联系维护者。