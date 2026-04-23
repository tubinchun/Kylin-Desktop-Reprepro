# Kylin Desktop Reprepro

基于reprepro的APT仓库管理系统，专为Kylin桌面系统设计，提供直观的Web界面用于管理软件包仓库。

## 项目简介

Kylin Desktop Reprepro是一个功能完整的APT仓库管理系统，支持：
- 多仓库创建和管理
- 软件包批量上传和删除
- 仓库镜像同步
- 基于Docker的容器化部署
- 响应式Web界面

## 核心功能

### 1. 多仓库管理
- 创建多个独立的仓库
- 自定义仓库配置（codename、架构等）
- 每个仓库独立的GPG签名

### 2. 软件包管理
- 批量上传多个.deb包
- 支持按包名、版本、架构检索
- 批量删除软件包
- 实时显示包信息和状态

### 3. 仓库镜像同步
- 支持从官方源同步镜像
- 实时同步进度显示
- 支持暂停和继续同步任务
- 同步日志查看

### 4. 系统特性
- Docker容器化部署
- 响应式Web界面
- 仓库访问地址自动生成
- 支持LoongArch和arm64架构
- 客户端无需导入公钥即可使用

## 系统要求

- Docker 19.03+
- Docker Compose 1.25+
- 至少2GB内存
- 至少10GB磁盘空间（根据仓库大小调整）

## 快速开始

### 1. 克隆项目
```bash
git clone https://github.com/tubinchun/Kylin-Desktop-Reprepro.git
cd Kylin-Desktop-Reprepro
```

### 2. 启动服务
```bash
docker-compose up -d
```

### 3. 访问系统
打开浏览器访问：http://localhost:3000

## 详细部署指南

### 环境变量配置
在`docker-compose.yml`文件中可以配置以下环境变量：
- `NODE_ENV`: 运行环境（默认：production）
- `TZ`: 时区设置（默认：Asia/Shanghai）

### 数据持久化
项目使用以下卷进行数据持久化：
- `./repos`: 存储仓库数据
- `./uploads`: 临时上传文件
- `./mirror-logs`: 同步日志
- `./mirror-configs`: 镜像配置
- `./mirror-syncs`: 同步数据
- `./backups`: 备份数据

### 网络配置
默认配置了DNS服务器和网络设置，确保容器能够正常访问外部源。

## 使用指南

### 创建仓库
1. 登录系统后，点击左侧导航栏的"仓库管理"
2. 点击"新建仓库"按钮
3. 填写仓库名称、codename、架构等信息
4. 点击"创建"按钮

### 上传软件包
1. 进入仓库管理页面
2. 选择目标仓库
3. 点击"上传软件包"按钮
4. 选择一个或多个.deb文件
5. 等待上传完成

### 镜像同步
1. 点击左侧导航栏的"仓库镜像同步"
2. 点击"创建配置任务"按钮
3. 填写同步源URL、仓库名称、架构等信息
4. 点击"创建"按钮
5. 在任务列表中点击"执行"开始同步
6. 查看同步进度和日志

### 删除软件包
1. 进入仓库管理页面
2. 选择目标仓库
3. 勾选要删除的软件包
4. 点击"批量删除"按钮

## 常见问题

### 1. 同步任务卡住
- 检查网络连接
- 查看同步日志了解具体错误
- 尝试暂停后重新开始同步

### 2. 软件包上传失败
- 确保上传的是有效的.deb文件
- 检查文件大小是否超过限制
- 查看服务器日志了解具体错误

### 3. 仓库访问地址
- 系统会自动生成仓库访问地址
- 格式：http://服务器IP:3000/repos/仓库名称

### 4. GPG签名问题
- 系统会自动生成GPG密钥对
- 首次使用时可能需要等待密钥生成完成

## 技术架构

- **后端**：Node.js + Express
- **前端**：HTML5 + CSS3 + JavaScript
- **容器化**：Docker + Docker Compose
- **仓库管理**：reprepro
- **镜像同步**：apt-mirror

## 项目结构

```
├── conf/                # 全局配置文件
├── public/              # 前端静态文件
├── repos/               # 仓库存储目录
├── tools/               # 工具脚本
├── Dockerfile           # Docker构建文件
├── docker-compose.yml   # Docker Compose配置
├── package.json         # Node.js项目配置
├── server.js            # 主服务器文件
└── README.md            # 项目说明
```

## 贡献指南

1. Fork本项目
2. 创建功能分支
3. 提交修改
4. 推送到分支
5. 开启Pull Request

## 许可证

本项目采用MIT许可证 - 详见LICENSE文件

## 联系方式

- 项目地址：https://github.com/tubinchun/Kylin-Desktop-Reprepro
- 作者：tubinchun

---

**Kylin Desktop Reprepro** - 为Kylin桌面系统提供专业的APT仓库管理解决方案