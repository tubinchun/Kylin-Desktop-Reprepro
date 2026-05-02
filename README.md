# Kylin Desktop Reprepro

基于 reprepro 和 apt-mirror 的 APT 仓库管理系统，专为 Kylin 桌面系统及 Debian/Ubuntu 系发行版设计，提供直观的 Web 界面用于管理软件包仓库和镜像同步。

## 功能特性

### 核心功能

- **多仓库管理** - 创建和管理多个独立的 APT 仓库
- **软件包管理** - 批量上传、删除和检索 .deb 软件包
- **镜像同步** - 支持同步官方源，支持多 deb 源配置
- **多架构支持** - amd64、arm64、i386、loongarch64、source
- **主题切换** - 支持深色/浅色主题，自动保存偏好
- **响应式界面** - 适配桌面和移动设备

### 技术特性

- Docker 容器化部署
- 基于 reprepro 的仓库管理
- 基于 apt-mirror 的镜像同步
- GPG 签名支持（可选）
- 客户端无需导入公钥即可使用

## 系统要求

| 组件 | 要求 |
|------|------|
| Docker | 19.03+ |
| Docker Compose | 1.25+ |
| 内存 | 至少 2GB |
| 磁盘 | 至少 10GB（根据仓库大小调整） |
| 网络 | 可访问互联网以下载包和同步镜像 |

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/tubinchun/Kylin-Desktop-Reprepro.git
cd Kylin-Desktop-Reprepro
```

### 2. 构建并启动服务

```bash
docker-compose build
docker-compose up -d
```

### 3. 访问系统

打开浏览器访问：<http://localhost:3000>

默认创建一个名为 `default` 的仓库，可直接上传软件包使用。

## 安装部署

### Docker 部署（推荐）

```bash
# 克隆项目
git clone https://github.com/tubinchun/Kylin-Desktop-Reprepro.git
cd Kylin-Desktop-Reprepro

# 构建镜像
docker-compose build

# 启动容器
docker-compose up -d

# 查看日志
docker-compose logs -f
```

### 本地开发部署

```bash
# 克隆项目
git clone https://github.com/tubinchun/Kylin-Desktop-Reprepro.git
cd Kylin-Desktop-Reprepro

# 安装依赖
npm install

# 启动服务
npm start
```

访问 <http://localhost:3000>

## 数据持久化

项目使用以下卷进行数据持久化：

| 目录 | 说明 |
|------|------|
| `./repos` | 仓库数据存储 |
| `./uploads` | 临时上传文件 |
| `./mirror-logs` | 同步日志 |
| `./mirror-configs` | 镜像配置文件 |
| `./mirror-syncs` | 同步的镜像数据 |
| `./backups` | 备份数据 |

## 使用指南

### 仓库管理

#### 创建仓库

1. 在左侧导航栏点击"仓库信息"
2. 在仓库列表下方点击"新建仓库"
3. 填写仓库名称和 Codename（如 focal、bookworm）
4. 点击"创建"按钮

#### 查看仓库

在仓库列表中，点击任意仓库名称可直接在新标签页中打开仓库访问地址。

仓库访问地址格式：`http://服务器IP:3000/repo/仓库名称`

### 软件包管理

#### 上传软件包

1. 在左侧导航栏点击"包管理"
2. 选择目标仓库
3. 拖拽或点击上传区域选择 .deb 文件
4. 等待上传完成，系统会自动添加包到仓库

#### 删除软件包

1. 在包管理页面选择目标仓库
2. 勾选要删除的软件包
3. 点击"删除选中"按钮

### 镜像同步

#### 创建同步配置

1. 在左侧导航栏点击"镜像同步"
2. 点击"创建配置任务"按钮
3. 填写配置信息：
   - **配置名称**：标识配置的名称
   - **Deb 源地址**：支持添加多个源地址（格式：`deb <url> <codename> <components>`）
   - **带宽限制**：可选，限制同步速度
   - **架构选择**：选择要同步的架构
4. 点击"保存配置"

#### 执行同步

1. 在配置列表中找到要同步的配置
2. 点击操作列的"执行同步"按钮
3. 观察同步进度条和实时日志
4. 同步完成后，自动将数据添加到仓库管理

#### 同步任务控制

- **暂停**：暂停正在进行的同步任务
- **继续**：恢复已暂停的任务
- **停止**：终止同步任务

> **注意**：大型镜像同步可能需要数小时，默认超时时间为 24 小时，可通过环境变量 `SYNC_TIMEOUT_MS=0` 禁用超时限制。

### 主题切换

点击页面右上角的 🌙/☀️ 图标可在深色和浅色主题之间切换。主题偏好会自动保存到浏览器。

## 客户端使用

### 添加仓库源

```bash
# 添加仓库（无需导入公钥）
echo "deb [trusted=yes] http://服务器IP:3000/repo/default focal main" | sudo tee -a /etc/apt/sources.list

# 更新包列表
sudo apt update

# 安装软件包
sudo apt install package-name
```

### 仓库访问地址说明

| 类型 | 地址格式 |
|------|----------|
| HTTP 访问 | `http://服务器IP:3000/repo/仓库名称` |
| 客户端源 | `deb [trusted=yes] http://服务器IP:3000/repo/仓库名称 codename components` |

## 配置指南

### 环境变量

在 `docker-compose.yml` 中可以配置以下环境变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | 运行环境 | production |
| `TZ` | 时区设置 | Asia/Shanghai |
| `SYNC_TIMEOUT_MS` | 同步超时时间（毫秒） | 86400000 (24小时) |

### 超时配置示例

```yaml
# 禁用超时限制（适用于超大型镜像）
environment:
  - SYNC_TIMEOUT_MS=0

# 设置为 48 小时
environment:
  - SYNC_TIMEOUT_MS=172800000
```

### 网络配置

默认配置了 DNS 服务器和 hosts 映射，确保能够正常访问官方源。如需修改，编辑 `docker-compose.yml` 中的 `extra_hosts` 部分。

## API 参考

### 仓库接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/repos` | 获取所有仓库列表 |
| POST | `/repos` | 创建新仓库 |
| GET | `/repos/:repoName` | 获取仓库详情 |
| DELETE | `/repos/:repoName` | 删除仓库 |

### 软件包接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/packages` | 获取软件包列表 |
| POST | `/upload` | 上传软件包 |

### 镜像同步接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/mirrors` | 获取镜像配置列表 |
| POST | `/mirrors` | 创建镜像配置 |
| POST | `/mirrors/:configName/sync` | 执行同步 |
| GET | `/sync/status` | 获取同步状态 |
| POST | `/mirrors/tasks/:taskId/pause` | 暂停任务 |
| POST | `/mirrors/tasks/:taskId/resume` | 恢复任务 |
| POST | `/mirrors/tasks/:taskId/cancel` | 取消任务 |

## 常见问题

### 1. 同步任务失败

- 检查网络连接是否正常
- 查看同步日志了解具体错误原因
- 确认镜像源地址是否可用
- 检查磁盘空间是否充足

### 2. 软件包上传失败

- 确保上传的是有效的 .deb 文件
- 检查文件大小是否超过服务器限制
- 查看服务器日志了解具体错误

### 3. 仓库访问报错 404

- 确认仓库名称拼写正确
- 检查仓库是否已创建
- 确认 Codename 与客户端配置一致

### 4. 同步进度显示不正确

- 同步过程中前端可能显示预估进度
- 以实际下载完成情况为准
- 大型镜像同步时间较长，请耐心等待

### 5. 如何处理超大型镜像？

对于 100GB 以上的超大型镜像，建议：

1. 设置 `SYNC_TIMEOUT_MS=0` 禁用超时
2. 确保有足够的磁盘空间
3. 使用有线网络连接
4. 预留充足的时间（可能需要数天）

## 项目结构

```
Kylin-Desktop-Reprepro/
├── conf/                     # 全局配置文件
│   ├── distributions
│   └── options
├── public/                   # 前端静态文件
│   └── index.html            # 主页面
├── repos/                     # 仓库存储目录
│   └── default/               # 默认仓库
├── tools/                     # 工具脚本
│   ├── repo-manager.js
│   └── sign-repo.js
├── mirror-configs/            # 镜像配置文件
├── mirror-syncs/              # 同步数据存储
├── mirror-logs/                # 同步日志
├── uploads/                    # 上传文件临时目录
├── backups/                    # 备份目录
├── Dockerfile                  # Docker 构建文件
├── docker-compose.yml          # Docker Compose 配置
├── package.json                # Node.js 项目配置
├── server.js                   # 主服务器文件
└── README.md                   # 项目说明文档
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 前端 | HTML5 + CSS3 + JavaScript (原生) |
| 容器化 | Docker + Docker Compose |
| 仓库管理 | reprepro |
| 镜像同步 | apt-mirror |
| 签名 | GPG (可选) |

## 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程

1. Fork 本项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交修改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### 开发环境

```bash
# 克隆 fork 的仓库
git clone https://github.com/YOUR_USERNAME/Kylin-Desktop-Reprepro.git

# 添加上游仓库
git remote add upstream https://github.com/tubinchun/Kylin-Desktop-Reprepro.git

# 创建功能分支
git checkout -b feature/my-feature

# 本地开发
npm install
npm run dev

# 提交并推送
git add .
git commit -m '描述'
git push origin feature/my-feature
```

## 版本历史

### v1.2

- 支持多 deb 源配置
- 优化同步超时机制（默认 24 小时）
- 添加主题切换功能
- 仓库列表支持点击跳转
- 优化 Deb 源输入 UI
- 镜像同步完成后自动添加到仓库管理

### v1.1

- 支持暂停/继续同步任务
- 添加同步进度显示
- 优化错误处理

### v1.0

- 基础仓库管理功能
- 软件包上传和删除
- 基础镜像同步功能

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 联系方式

- 项目地址：<https://github.com/tubinchun/Kylin-Desktop-Reprepro>
- 问题反馈：<https://github.com/tubinchun/Kylin-Desktop-Reprepro/issues>

---

**Kylin Desktop Reprepro** - 为 Kylin 桌面系统及 Debian/Ubuntu 系发行版提供专业的 APT 仓库管理解决方案
