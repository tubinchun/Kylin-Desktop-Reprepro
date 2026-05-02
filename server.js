const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { execSync, exec } = require('child_process');
// 暂时注释掉这些依赖，以便能够启动服务器
// const schedule = require('node-schedule');
// const cron = require('cron');

// 新增：apt-mirror配置目录
const mirrorConfigDir = path.join(__dirname, 'mirror-configs');
const mirrorSyncDir = path.join(__dirname, 'mirror-syncs');
const mirrorLogDir = path.join(__dirname, 'mirror-logs');

// 同步超时配置（默认24小时，单位：毫秒）
// 大型镜像同步可能需要数小时甚至数天，设置较长的超时时间
// 用户可以通过环境变量 SYNC_TIMEOUT_MS 自定义超时时间
const SYNC_TIMEOUT = process.env.SYNC_TIMEOUT_MS ? parseInt(process.env.SYNC_TIMEOUT_MS) : 24 * 60 * 60 * 1000; // 默认24小时

fs.ensureDirSync(mirrorConfigDir);
fs.ensureDirSync(mirrorSyncDir);
fs.ensureDirSync(mirrorLogDir);

const app = express();
const PORT = process.env.PORT || 3000;

// 配置中间件（必须在路由之前）
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 添加CORS头（允许跨域）
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

const uploadsDir = path.join(__dirname, 'uploads');
const reposRootDir = path.join(__dirname, 'repos');

fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(reposRootDir);

// 默认仓库名称
const DEFAULT_REPO_NAME = 'default';

// 初始化默认仓库
function initializeDefaultRepo() {
  const defaultRepoDir = path.join(reposRootDir, DEFAULT_REPO_NAME);
  const confDir = path.join(defaultRepoDir, 'conf');
  
  fs.ensureDirSync(defaultRepoDir);
  fs.ensureDirSync(confDir);
  
  const distributionsPath = path.join(confDir, 'distributions');
  const optionsPath = path.join(confDir, 'options');
  
  if (!fs.existsSync(distributionsPath)) {
    fs.writeFileSync(distributionsPath, `Origin: Kylin Desktop
Label: Kylin Desktop
Codename: focal
Architectures: amd64 i386 arm64 loongarch64 source
Components: main
Description: Kylin Desktop 包管理仓库
`);
  }
  
  if (!fs.existsSync(optionsPath)) {
    fs.writeFileSync(optionsPath, `verbose
basedir .
`);
  }
  
  // 移除SignWith配置来完全禁用签名
  let distributionsContent = fs.readFileSync(distributionsPath, 'utf8');
  distributionsContent = distributionsContent.replace(/SignWith:.*\n/g, '');
  fs.writeFileSync(distributionsPath, distributionsContent);
  console.log('Removed SignWith configuration to disable signing');
  
  console.log(`Default repository initialized at: ${defaultRepoDir}`);
}

// 初始化默认仓库
initializeDefaultRepo();

// 获取仓库目录
function getRepoDir(repoName) {
  return path.join(reposRootDir, repoName || DEFAULT_REPO_NAME);
}

// 读取仓库的codename
function getRepoCodename(repoName) {
  try {
    const repoDir = getRepoDir(repoName);
    const distributionsPath = path.join(repoDir, 'conf', 'distributions');
    
    if (!fs.existsSync(distributionsPath)) {
      return 'focal'; // 默认值
    }

    const content = fs.readFileSync(distributionsPath, 'utf8');
    const codenameMatch = content.match(/Codename:\s*(\w+)/i);
    return codenameMatch ? codenameMatch[1] : 'focal';
  } catch (error) {
    console.warn('Error reading repo codename:', error.message);
    return 'focal'; // 出错时返回默认值
  }
}

// 生成GPG密钥
function generateGpgKey(repoName = DEFAULT_REPO_NAME) {
  try {
    console.log(`Generating GPG key for repository: ${repoName}`);
    
    const repoDir = getRepoDir(repoName);
    const keyGenScript = `
%no-protection
Key-Type: RSA
Key-Length: 4096
Subkey-Type: RSA
Subkey-Length: 4096
Name-Real: Kylin Desktop Package Manager
Name-Email: repo@kylin-desktop.com
Expire-Date: 0
%commit
%echo done
`;
    
    // 检查gpg命令是否存在
    try {
      execSync('gpg --version', { stdio: 'ignore' });
    } catch (error) {
      console.warn('GPG command not found. Skipping GPG key generation.');
      return null;
    }
    
    execSync(`echo "${keyGenScript}" | gpg --batch --generate-key`, { 
      stdio: 'inherit',
      cwd: repoDir
    });
    
    console.log('GPG key generated successfully');
    
    // 导出公钥
    const pubkeyPath = path.join(repoDir, 'public.key');
    execSync(`gpg --armor --export repo@kylin-desktop.com > ${pubkeyPath}`, { 
      stdio: 'inherit',
      cwd: repoDir
    });
    
    console.log(`Public key exported to: ${pubkeyPath}`);
    return pubkeyPath;
  } catch (error) {
    console.warn('Failed to generate GPG key:', error.message);
    return null;
  }
}

// 签名仓库
function signRepository(repoName = DEFAULT_REPO_NAME) {
  try {
    console.log(`Signing repository: ${repoName}`);
    
    const repoDir = getRepoDir(repoName);
    
    // 检查gpg命令是否存在
    try {
      execSync('gpg --version', { stdio: 'ignore' });
    } catch (error) {
      console.warn('GPG command not found. Skipping repository signing.');
      return;
    }
    
    const codename = getRepoCodename(repoName);
    execSync(`reprepro --ask-passphrase export ${codename}`, { 
      stdio: 'inherit',
      cwd: repoDir
    });
    
    console.log('Repository signed successfully');
  } catch (error) {
    console.warn('Failed to sign repository:', error.message);
    // 签名失败不抛出异常，允许继续操作
  }
}

// 创建新仓库
function createRepository(repoName, codename = 'focal') {
  try {
    console.log(`Creating new repository: ${repoName} with codename: ${codename}`);

    const repoDir = getRepoDir(repoName);
    const confDir = path.join(repoDir, 'conf');

    // 确保目录存在（如果已存在也会正常继续）
    fs.ensureDirSync(repoDir);
    fs.ensureDirSync(confDir);

    const distributionsPath = path.join(confDir, 'distributions');
    const optionsPath = path.join(confDir, 'options');

    // 总是写入配置文件（覆盖已存在的配置）
    fs.writeFileSync(distributionsPath, `Origin: Kylin Desktop Mirror
Label: ${repoName}
Codename: ${codename}
Architectures: amd64 i386 arm64 loongarch64 source
Components: main
Description: Kylin Desktop 包管理仓库 - ${repoName}
`);

    fs.writeFileSync(optionsPath, `verbose
basedir .
`);

    // 不添加SignWith配置来禁用签名
    console.log('Repository created without signing configuration');

    console.log(`Repository ${repoName} created successfully`);
    return repoDir;
  } catch (error) {
    console.error(`Failed to create repository ${repoName}:`, error.message);
    throw error;
  }
}

// 获取所有仓库列表
function getRepositories() {
  try {
    const repos = [];
    const dirs = fs.readdirSync(reposRootDir);
    
    dirs.forEach(dir => {
      const repoPath = path.join(reposRootDir, dir);
      if (fs.statSync(repoPath).isDirectory()) {
        repos.push({
          name: dir,
          path: repoPath
        });
      }
    });
    
    return repos;
  } catch (error) {
    console.error('Failed to get repositories:', error.message);
    throw error;
  }
}

// 删除仓库
function deleteRepository(repoName) {
  try {
    if (repoName === DEFAULT_REPO_NAME) {
      throw new Error('Cannot delete default repository');
    }
    
    const repoDir = getRepoDir(repoName);
    fs.removeSync(repoDir);
    console.log(`Repository ${repoName} deleted successfully`);
  } catch (error) {
    console.error(`Failed to delete repository ${repoName}:`, error.message);
    throw error;
  }
}

// 初始化默认仓库签名
console.log('Initializing GPG signing for default repository...');
generateGpgKey(DEFAULT_REPO_NAME);
signRepository(DEFAULT_REPO_NAME);
console.log('Repository initialization completed');

// 仓库管理API
app.get('/repos', (req, res) => {
  try {
    const repos = getRepositories();
    // 为每个仓库添加codename字段
    const reposWithCodename = repos.map(repo => ({
      ...repo,
      codename: getRepoCodename(repo.name)
    }));
    res.json({
      success: true,
      repos: reposWithCodename
    });
  } catch (error) {
    console.error('Failed to get repositories:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/repos', (req, res) => {
  try {
    const { name, codename } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Repository name is required' });
    }
    
    const repoName = name.trim();
    const repoCodename = codename && typeof codename === 'string' ? codename.trim() : 'focal';
    
    createRepository(repoName, repoCodename);
    
    res.json({
      success: true,
      message: `Repository ${repoName} created successfully with codename: ${repoCodename}`
    });
  } catch (error) {
    console.error('Failed to create repository:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/repos/:repoName', (req, res) => {
  try {
    const repoName = req.params.repoName;
    deleteRepository(repoName);
    
    res.json({
      success: true,
      message: `Repository ${repoName} deleted successfully`
    });
  } catch (error) {
    console.error('Failed to delete repository:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/repos/:repoName', (req, res) => {
  try {
    const repoName = req.params.repoName;
    const repoDir = getRepoDir(repoName);
    
    if (!fs.existsSync(repoDir)) {
      return res.status(404).json({ error: `Repository ${repoName} not found` });
    }
    
    res.json({
      success: true,
      repository: {
        name: repoName,
        codename: getRepoCodename(repoName),
        isDefault: repoName === DEFAULT_REPO_NAME
      }
    });
  } catch (error) {
    console.error('Failed to get repository info:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // 过滤文件名中的特殊字符，避免shell语法错误
    const safeFilename = file.originalname.replace(/[()]/g, '_');
    cb(null, Date.now() + '-' + safeFilename);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: Infinity, // 不限制文件大小
    files: Infinity // 不限制文件数量
  },
  fileFilter: function (req, file, cb) {
    // 检查文件扩展名，忽略大小写
    const isDebFile = file.originalname.toLowerCase().endsWith('.deb');
    
    // 检查文件MIME类型
    const isDebMime = file.mimetype === 'application/x-deb' || 
                      file.mimetype === 'application/vnd.debian.binary-package' ||
                      file.mimetype === 'application/octet-stream';
    
    if (isDebFile || isDebMime) {
      cb(null, true);
    } else {
      cb(new Error('Only .deb files are allowed'));
    }
  }
});

// 仓库信息API（必须在 /repo/:repoName? 路由之前定义）
app.get('/repo/info', (req, res) => {
  try {
    const repoName = req.query.repo || DEFAULT_REPO_NAME;
    const repoDir = getRepoDir(repoName);
    
    if (!fs.existsSync(repoDir)) {
      return res.json({
        success: true,
        repoName: DEFAULT_REPO_NAME,
        codename: 'focal',
        components: 'main',
        architectures: 'amd64, arm64, i386, loongarch64, source',
        status: 'active'
      });
    }
    
    const codename = getRepoCodename(repoName);
    
    res.json({
      success: true,
      repoName: repoName,
      codename: codename || 'focal',
      components: 'main',
      architectures: 'amd64, arm64, i386, loongarch64, source',
      status: 'active'
    });
  } catch (error) {
    console.error('Failed to get repo info:', error.message);
    res.json({
      success: true,
      repoName: DEFAULT_REPO_NAME,
      codename: 'focal',
      components: 'main',
      architectures: 'amd64, arm64, i386, loongarch64, source',
      status: 'active'
    });
  }
});

// 仓库访问路由（支持多仓库）
app.get('/repo/:repoName?', (req, res) => {
  const repoName = req.params.repoName || DEFAULT_REPO_NAME;
  const repoDir = getRepoDir(repoName);
  
  if (!fs.existsSync(repoDir)) {
    return res.status(404).send(`Repository ${repoName} not found`);
  }
  
  res.send(`
    <h1>Kylin Desktop 包管理仓库</h1>
    <p>仓库名称: <code>${repoName}</code></p>
    <p>仓库地址: <code>http://${req.headers.host}/repo/${repoName}</code></p>
    <h2>目录列表</h2>
    <ul>
      <li><a href="/repo/${repoName}/dists">dists/</a> - 包索引</li>
      <li><a href="/repo/${repoName}/pool">pool/</a> - 包文件</li>
    </ul>
    <h2>使用方法</h2>
    <pre>
# 添加仓库源（无需导入公钥）
echo "deb [trusted=yes] http://${req.headers.host}/repo/${repoName} ${getRepoCodename(repoName)} main" | sudo tee -a /etc/apt/sources.list

# 更新包列表
sudo apt update

# 安装包
sudo apt install package-name
    </pre>
  `);
});

// 公钥下载路由（支持多仓库）
app.get('/repo/:repoName/public.key', (req, res) => {
  const repoName = req.params.repoName || DEFAULT_REPO_NAME;
  const repoDir = getRepoDir(repoName);
  const pubkeyPath = path.join(repoDir, 'public.key');
  
  if (!fs.existsSync(repoDir)) {
    return res.status(404).send(`Repository ${repoName} not found`);
  }
  
  if (fs.existsSync(pubkeyPath)) {
    res.sendFile(pubkeyPath);
  } else {
    res.status(404).send('Public key not found');
  }
});

// 仓库文件访问路由（支持多仓库）
app.get('/repo/:repoName/:path(*)', (req, res) => {
  const repoName = req.params.repoName;
  const requestedPath = req.params.path;
  const repoDir = getRepoDir(repoName);
  const fullPath = path.join(repoDir, requestedPath);
  
  if (!fs.existsSync(repoDir)) {
    return res.status(404).send(`Repository ${repoName} not found`);
  }
  
  fs.stat(fullPath, (err, stats) => {
    if (err) {
      return res.status(404).send('File not found');
    }
    
    if (stats.isDirectory()) {
      fs.readdir(fullPath, (err, files) => {
        if (err) {
          return res.status(500).send('Error reading directory');
        }
        
        const baseUrl = `/repo/${repoName}/${requestedPath}`;

        let html = `<h1>Kylin Desktop 包管理 - 目录列表: ${baseUrl}</h1>`;
        html += '<ul>';
        
        if (requestedPath) {
          html += `<li><a href="/repo/${repoName}/${requestedPath.split('/').slice(0, -1).join('/') || ''}">..</a></li>`;
        }
        
        files.forEach(file => {
          const filePath = path.join(fullPath, file);
          const isDir = fs.statSync(filePath).isDirectory();
          const displayPath = isDir ? file + '/' : file;
          html += `<li><a href="${baseUrl}/${file}">${displayPath}</a></li>`;
        });
        
        html += '</ul>';
        res.send(html);
      });
    } else {
      // 处理文件下载，支持范围请求
      res.sendFile(fullPath, {
        headers: {
          'Accept-Ranges': 'bytes'
        }
      });
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 删除包的API（支持多仓库）
app.delete('/packages/:packageName', (req, res) => {
  try {
    const packageName = req.params.packageName;
    const repoName = req.query.repo || DEFAULT_REPO_NAME;
    let architecture = req.query.architecture || 'all';
    
    // 验证包名有效性
    if (!packageName || packageName === 'unknown') {
      console.warn('Invalid package name:', packageName);
      return res.status(400).json({ error: 'Invalid package name' });
    }
    
    // 从格式"focal|main|amd64:" 中提取架构信息
    if (architecture.includes('|')) {
      const parts = architecture.split('|');
      architecture = parts[2]?.replace(':', '') || 'all';
    }
    
    // 验证架构参数是否有效
    const validArchitectures = ['all', 'amd64', 'i386', 'arm64', 'loongarch64', 'source'];
    if (!validArchitectures.includes(architecture)) {
      console.warn('Invalid architecture:', architecture);
      architecture = 'all'; // 使用默认架构
    }
    
    console.log(`Removing package: ${packageName} (${architecture}) from repository: ${repoName}`);
    
    const repoDir = getRepoDir(repoName);
    
    if (!fs.existsSync(repoDir)) {
      return res.status(404).json({ error: `Repository ${repoName} not found` });
    }
    
    process.chdir(repoDir);
    
    const codename = getRepoCodename(repoName);
    const command = `reprepro -A ${architecture} remove ${codename} ${packageName}`;
    console.log(`Running: ${command}`);
    
    execSync(command, { stdio: 'inherit' });
    
    // 重新签名仓库
    signRepository(repoName);
    
    res.json({
      success: true,
      message: `Package ${packageName} removed successfully from repository ${repoName}`
    });
  } catch (error) {
    console.error('Failed to remove package:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    process.chdir(__dirname);
  }
});

app.post('/upload', upload.array('debFiles'), (req, res) => {
  try {
    console.log('Upload request received');
    console.log('Request body:', req.body);
    console.log('Files:', req.files ? req.files.length : 'none');
    
    if (!req.files || req.files.length === 0) {
      console.error('No files uploaded');
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const repoName = req.body.repoName || DEFAULT_REPO_NAME;
    const repoDir = getRepoDir(repoName);
    
    console.log(`Uploading to repository: ${repoName}, directory: ${repoDir}`);
    
    // 检查仓库目录是否存在
    if (!fs.existsSync(repoDir)) {
      console.error(`Repository ${repoName} not found at ${repoDir}`);
      return res.status(404).json({ success: false, message: `Repository ${repoName} not found` });
    }
    
    // 检查必要的目录结构
    const confDir = path.join(repoDir, 'conf');
    const poolDir = path.join(repoDir, 'pool');
    const distsDir = path.join(repoDir, 'dists');
    
    console.log(`Checking repository structure for ${repoName}:`);
    console.log(`  - conf directory exists: ${fs.existsSync(confDir)}`);
    console.log(`  - pool directory exists: ${fs.existsSync(poolDir)}`);
    console.log(`  - dists directory exists: ${fs.existsSync(distsDir)}`);
    
    // 如果 pool 目录不存在，创建它
    if (!fs.existsSync(poolDir)) {
      console.log(`Creating pool directory for ${repoName}`);
      fs.ensureDirSync(poolDir);
    }
    
    // 如果 dists 目录不存在，创建它
    if (!fs.existsSync(distsDir)) {
      console.log(`Creating dists directory for ${repoName}`);
      fs.ensureDirSync(distsDir);
    }

    const results = [];
    
    for (const file of req.files) {
      try {
        const debFilePath = file.path;
        console.log(`Processing deb file: ${file.originalname} for repository: ${repoName}`);
        
        processDebFile(debFilePath, repoDir, repoName);
        
        results.push({
          filename: file.originalname,
          success: true,
          message: `Deb package added to repository ${repoName} successfully`
        });
      } catch (error) {
        console.error(`Failed to process ${file.originalname}:`, error);
        results.push({
          filename: file.originalname,
          success: false,
          message: error.message
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const message = `${successCount}/${req.files.length} files uploaded successfully to repository ${repoName}`;
    
    console.log(message);
    
    res.json({
      success: true,
      message: message,
      results: results
    });
  } catch (error) {
    console.error('Error processing deb files:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

function processDebFile(debFilePath, repoDir, repoName) {
  try {
    process.chdir(repoDir);
    
    const codename = getRepoCodename(repoName);
    const command = `reprepro --priority=optional --ignore=forbiddenchar --component=main --section=utils includedeb ${codename} ${debFilePath}`;
    console.log(`Running: ${command}`);
    
    try {
      execSync(command, { stdio: 'pipe' });
      console.log(`Deb package successfully added to repository ${repoName}`);
    } catch (execError) {
      console.error(`reprepro output: ${execError.stdout ? execError.stdout.toString() : ''}`);
      console.error(`reprepro error: ${execError.stderr ? execError.stderr.toString() : ''}`);
      throw new Error(`Failed to add deb package: ${execError.message}`);
    }
    
    // 重新签名仓库 - 如果需要的话
    try {
      signRepository(repoName);
    } catch (signError) {
      console.warn(`Warning: Failed to sign repository ${repoName}:`, signError.message);
    }
  } catch (error) {
    console.error('Failed to add deb package:', error.message);
    throw error;
  } finally {
    process.chdir(__dirname);
    try {
      fs.unlinkSync(debFilePath);
    } catch (e) {
      console.warn(`Warning: Failed to delete temp file ${debFilePath}:`, e.message);
    }
  }
}

app.get('/packages', (req, res) => {
  try {
    const repoName = req.query.repo || DEFAULT_REPO_NAME;
    const repoDir = getRepoDir(repoName);

    if (!fs.existsSync(repoDir)) {
      return res.status(404).json({ error: `Repository ${repoName} not found` });
    }

    // 首先尝试使用 reprepro list（适用于 reprepro 管理的仓库）
    let allPackages = [];
    let useReprepro = false;

    process.chdir(repoDir);
    const codename = getRepoCodename(repoName);
    const command = `reprepro list ${codename}`;

    try {
      const result = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (result && result.trim()) {
        useReprepro = true;
        allPackages = result.trim().split('\n').filter(line => line.trim() !== '').map(line => {
          const parts = line.trim().split(/\s+/);

          if (parts.length < 3) {
            return null;
          }

          const packageInfo = parts[0];
          const packageName = parts[1];
          const version = parts[2];

          let architecture = 'all';
          try {
            const archPart = packageInfo.split('|')[2];
            if (archPart) {
              architecture = archPart.replace(':', '') || 'all';
            }
          } catch (error) {
            // ignore
          }

          if (!packageName || !version) {
            return null;
          }

          return {
            name: packageName,
            version: version,
            architecture: architecture,
            repo: repoName
          };
        }).filter(Boolean);
      }
    } catch (execError) {
      // reprepro list 失败，尝试从镜像目录读取
      console.log('reprepro list not available or empty, trying to read from mirror directory');
    }

    // 如果 reprepro 没有返回包，尝试从 dists 目录读取（适用于镜像同步的仓库）
    if (!useReprepro || allPackages.length === 0) {
      console.log('Reading packages from mirror directory...');
      const distsDir = path.join(repoDir, 'dists');
      if (fs.existsSync(distsDir)) {
        try {
          allPackages = readPackagesFromMirror(repoDir, distsDir);
          console.log(`Found ${allPackages.length} packages in mirror directory`);
        } catch (mirrorError) {
          console.error('Error reading packages from mirror:', mirrorError.message);
        }
      }
    }

    // 分页处理
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    const paginatedPackages = allPackages.slice(startIndex, endIndex);

    res.json({
      success: true,
      packages: paginatedPackages,
      pagination: {
        page,
        limit,
        total: allPackages.length,
        totalPages: Math.ceil(allPackages.length / limit)
      }
    });
  } catch (error) {
    console.error('Error listing packages:', error);
    res.status(500).json({ error: error.message });
  } finally {
    process.chdir(__dirname);
  }
});

// 从镜像目录读取包列表（解析 dists/*/main/binary-*/Packages.gz 或 Packages 文件）
function readPackagesFromMirror(repoDir, distsDir) {
  const packages = [];
  const dists = fs.readdirSync(distsDir);

  dists.forEach(dist => {
    const distPath = path.join(distsDir, dist);
    if (!fs.statSync(distPath).isDirectory()) return;

    // 查找 main 目录（Debian 仓库的标准结构）
    const mainPath = path.join(distPath, 'main');
    if (!fs.existsSync(mainPath)) return;

    // 查找 binary-* 目录
    const mainContents = fs.readdirSync(mainPath);
    mainContents.forEach(item => {
      const binaryPath = path.join(mainPath, item);
      if (!fs.statSync(binaryPath).isDirectory()) return;
      if (!item.startsWith('binary-')) return;

      const architecture = item.replace('binary-', '');

      // 尝试读取 Packages.gz
      const packagesGzPath = path.join(binaryPath, 'Packages.gz');
      const packagesPath = path.join(binaryPath, 'Packages');

      let packagesContent = '';
      if (fs.existsSync(packagesGzPath)) {
        try {
          const zlib = require('zlib');
          const compressed = fs.readFileSync(packagesGzPath);
          packagesContent = zlib.gunzipSync(compressed).toString('utf8');
        } catch (gzError) {
          console.error('Error reading Packages.gz:', gzError.message);
        }
      } else if (fs.existsSync(packagesPath)) {
        try {
          packagesContent = fs.readFileSync(packagesPath, 'utf8');
        } catch (readError) {
          console.error('Error reading Packages:', readError.message);
        }
      }

      // 解析 Packages 文件
      if (packagesContent) {
        const packageBlocks = packagesContent.split('\n\n');
        packageBlocks.forEach(block => {
          const lines = block.split('\n');
          let packageName = '';
          let version = '';

          lines.forEach(line => {
            if (line.startsWith('Package: ')) {
              packageName = line.replace('Package: ', '').trim();
            } else if (line.startsWith('Version: ')) {
              version = line.replace('Version: ', '').trim();
            }
          });

          if (packageName && version) {
            packages.push({
              name: packageName,
              version: version,
              architecture: architecture,
              repo: path.basename(repoDir)
            });
          }
        });
      }
    });
  });

  return packages;
}

// 递归查找包含 dists 和 pool 目录的基础目录
function findSourceBaseDir(startDir) {
  // 检查当前目录是否同时包含 dists 和 pool
  const hasDists = fs.existsSync(path.join(startDir, 'dists'));
  const hasPool = fs.existsSync(path.join(startDir, 'pool'));
  
  if (hasDists && hasPool) {
    return startDir;
  }
  
  // 递归检查子目录
  if (fs.existsSync(startDir)) {
    const items = fs.readdirSync(startDir);
    for (const item of items) {
      const itemPath = path.join(startDir, item);
      if (fs.statSync(itemPath).isDirectory()) {
        const found = findSourceBaseDir(itemPath);
        if (found) return found;
      }
    }
  }
  
  return null;
}

// 列出目录树用于调试
function listDirectoryTree(dir, prefix) {
  if (!fs.existsSync(dir)) return;
  
  const items = fs.readdirSync(dir);
  items.forEach(item => {
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);
    console.log(`${prefix}${item}${stat.isDirectory() ? '/' : ''}`);
    if (stat.isDirectory()) {
      listDirectoryTree(itemPath, prefix + '  ');
    }
  });
}

// 清理镜像同步目录以节省空间
function cleanupMirrorSyncDir(configName) {
  try {
    const syncDir = path.join(mirrorSyncDir, configName);
    
    if (!fs.existsSync(syncDir)) {
      console.log(`镜像同步目录 ${syncDir} 不存在，无需清理`);
      return;
    }
    
    console.log(`正在清理镜像同步目录 ${syncDir} 以节省空间...`);
    
    // 删除同步目录下的所有内容
    fs.removeSync(syncDir);
    
    console.log(`镜像同步目录 ${syncDir} 已成功清理`);
  } catch (error) {
    console.error(`清理镜像同步目录失败: ${error.message}`);
    // 不影响同步成功的返回，继续执行
  }
}

// 新增：apt-mirror配置管理
function processUrl(originalUrl) {
  let processedUrl = originalUrl;

  // 移除URL中的重复斜杠
  const urlParts = processedUrl.split('://');
  if (urlParts.length === 2) {
    const protocol = urlParts[0] + '://';
    const rest = urlParts[1].replace(/\/+\//g, '/');
    processedUrl = protocol + rest;
  } else {
    processedUrl = processedUrl.replace(/\/+\//g, '/');
  }
  // 确保URL以斜杠结束
  if (processedUrl && !processedUrl.endsWith('/')) {
    processedUrl += '/';
  }

  // 确保URL包含协议
  if (!processedUrl.includes('://')) {
    processedUrl = 'http://' + processedUrl;
  }
  // 再次确保没有重复斜杠
  const finalUrlParts = processedUrl.split('://');
  if (finalUrlParts.length === 2) {
    const protocol = finalUrlParts[0] + '://';
    const rest = finalUrlParts[1].replace(/\/+\//g, '/');
    processedUrl = protocol + rest;
  }
  // 确保URL以斜杠结束
  if (!processedUrl.endsWith('/')) {
    processedUrl += '/';
  }

  return processedUrl;
}

function createMirrorConfig(config) {
  try {
    const { name, url, codename, components, architectures, bandwidth, syncPath, schedule, debLines } = config;

    const configPath = path.join(mirrorConfigDir, `${name}.conf`);
    const syncDir = path.join(mirrorSyncDir, name);

    fs.ensureDirSync(syncDir);

    // 对于 Docker 容器环境，使用容器内的绝对路径 /app/mirror-syncs/配置名
    const containerSyncDir = `/app/mirror-syncs/${name}`;

    let debLinesContent = '';
    let firstCodename = codename;

    // 处理多个 deb 源地址
    if (debLines && Array.isArray(debLines) && debLines.length > 0) {
      firstCodename = debLines[0].codename;

      debLines.forEach((deb, index) => {
        const processedUrl = processUrl(deb.url);
        console.log(`Deb line ${index + 1} - Original URL: ${deb.url}, Processed URL: ${processedUrl}`);
        debLinesContent += `deb ${processedUrl} ${deb.codename} ${deb.components.join(' ')}\n`;
      });
    } else {
      // 处理单个 deb 源（兼容旧格式）
      const processedUrl = processUrl(url);
      console.log(`Original URL: ${url}`);
      console.log(`Processed URL: ${processedUrl}`);
      debLinesContent = `deb ${processedUrl} ${codename} ${components.join(' ')}\n`;
    }

    const configContent = `
set base_path ${containerSyncDir}
set mirror_path ${containerSyncDir}/mirror
set skel_path ${containerSyncDir}/skel
set var_path ${containerSyncDir}/var
set cleanscript ${containerSyncDir}/clean.sh
set defaultarch ${architectures[0] || 'amd64'}
set postmirror_script ${containerSyncDir}/postmirror.sh
set run_postmirror 0
set nthreads 4
set _tilde 0
set timeout 120
set retries 2
set no_check_certificate 1

${bandwidth ? `set limit_rate ${bandwidth}` : ''}

${debLinesContent}
`;

    fs.writeFileSync(configPath, configContent);

    // 检查配置文件是否成功创建
    if (!fs.existsSync(configPath)) {
      console.error(`Failed to create mirror configuration file: ${configPath}`);
      return {
        success: false,
        error: `Failed to create mirror configuration file: ${configPath}`
      };
    }

    // 暂时注释掉定时任务设置，因为相关函数已被注释
    /*
    // 设置定时任务
    if (schedule) {
      setScheduledSync(name, schedule);
    }
    */

    return {
      success: true,
      message: `Mirror configuration ${name} created successfully`,
      config: {
        name,
        url: url || debLines?.[0]?.url,
        codename: codename || firstCodename,
        components: components || debLines?.[0]?.components,
        architectures,
        bandwidth,
        syncPath: syncDir,
        schedule,
        debLines: debLines || null
      }
    };
  } catch (error) {
    console.error('Failed to create mirror config:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// 新增：同步任务状态管理
const syncTasksFile = path.join(__dirname, 'sync-tasks.json');
let syncTasks = {};

// 加载保存的任务状态
function loadSyncTasks() {
  try {
    if (fs.existsSync(syncTasksFile)) {
      const tasksData = fs.readFileSync(syncTasksFile, 'utf8');
      syncTasks = JSON.parse(tasksData);
      console.log(`Loaded ${Object.keys(syncTasks).length} sync tasks from disk`);
    }
  } catch (error) {
    console.error('Failed to load sync tasks:', error.message);
    syncTasks = {};
  }
}

// 保存任务状态到磁盘
function saveSyncTasks() {
  try {
    fs.writeFileSync(syncTasksFile, JSON.stringify(syncTasks, null, 2));
    console.log(`Saved ${Object.keys(syncTasks).length} sync tasks to disk`);
  } catch (error) {
    console.error('Failed to save sync tasks:', error.message);
  }
}

// 加载任务状态
loadSyncTasks();

// 新增：执行apt-mirror同步
function runMirrorSync(configName) {
  return new Promise((resolve, reject) => {
    try {
      const configPath = path.join(mirrorConfigDir, `${configName}.conf`);
      const logPath = path.join(mirrorLogDir, `${configName}-${Date.now()}.log`);

      if (!fs.existsSync(configPath)) {
        reject(new Error(`Mirror configuration ${configName} not found`));
        return;
      }

      // 从配置文件读取并解析 deb 源信息
      let config = { name: configName, debLines: [] };
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const debLines = configContent.split('\n').filter(line => line.trim().startsWith('deb '));
        config.debLines = debLines.map(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            return {
              url: parts[1],
              codename: parts[2],
              components: parts.slice(3)
            };
          }
          return null;
        }).filter(Boolean);
        console.log(`Parsed config: ${JSON.stringify(config)}`);
      } catch (parseError) {
        console.error('Failed to parse config file:', parseError.message);
      }

      // 确保apt-mirror需要的目录存在并具有正确的权限
      const aptMirrorSpoolDir = '/var/spool/apt-mirror';
      console.log(`Checking apt-mirror spool directory: ${aptMirrorSpoolDir}`);
      
      if (!fs.existsSync(aptMirrorSpoolDir)) {
        console.log(`Directory does not exist, creating: ${aptMirrorSpoolDir}`);
        try {
          fs.mkdirSync(aptMirrorSpoolDir, { recursive: true });
          console.log(`Created directory: ${aptMirrorSpoolDir}`);
          // 尝试设置权限（仅在Linux环境下有效）
          try {
            fs.chmodSync(aptMirrorSpoolDir, 0o777);
            console.log(`Set permissions to 777 on: ${aptMirrorSpoolDir}`);
          } catch (chmodError) {
            console.log(`Warning: Could not set permissions on ${aptMirrorSpoolDir}: ${chmodError.message}`);
          }
        } catch (mkdirError) {
          console.error(`Failed to create apt-mirror spool directory ${aptMirrorSpoolDir}: ${mkdirError.message}`);
          reject(new Error(`无法创建apt-mirror工作目录: ${mkdirError.message}`));
          return;
        }
      } else {
        console.log(`Directory already exists: ${aptMirrorSpoolDir}`);
        // 检查目录权限
        try {
          const stats = fs.statSync(aptMirrorSpoolDir);
          console.log(`Directory permissions: ${stats.mode.toString(8)}`);
          // 尝试设置权限（仅在Linux环境下有效）
          try {
            fs.chmodSync(aptMirrorSpoolDir, 0o777);
            console.log(`Updated permissions to 777 on: ${aptMirrorSpoolDir}`);
          } catch (chmodError) {
            console.log(`Warning: Could not set permissions on ${aptMirrorSpoolDir}: ${chmodError.message}`);
          }
        } catch (statError) {
          console.error(`Failed to stat directory ${aptMirrorSpoolDir}: ${statError.message}`);
        }
      }
      
      // 生成任务ID
      const taskId = `${configName}-${Date.now()}`;
      
      // 尝试查找apt-mirror命令
      let aptMirrorPath = 'apt-mirror';
      try {
        const whichResult = execSync('which apt-mirror', { encoding: 'utf8', stdio: 'pipe' });
        aptMirrorPath = whichResult.trim();
        console.log('Found apt-mirror at:', aptMirrorPath);
      } catch (whichError) {
        console.log('apt-mirror not found in PATH, will try common locations');
        // 尝试常见的apt-mirror安装位置
        const commonPaths = ['/usr/bin/apt-mirror', '/usr/local/bin/apt-mirror', '/bin/apt-mirror'];
        for (const p of commonPaths) {
          if (fs.existsSync(p)) {
            aptMirrorPath = p;
            console.log('Found apt-mirror at:', aptMirrorPath);
            break;
          }
        }
      }
      
      // 初始化任务状态
      syncTasks[taskId] = {
        id: taskId,
        configName,
        status: 'running',
        progress: 0,
        logPath,
        startTime: new Date().toISOString()
      };
      
      // 保存任务状态到磁盘
      saveSyncTasks();
      
      const command = `${aptMirrorPath} ${configPath} > ${logPath} 2>&1`;
      console.log(`Running mirror sync: ${command}`);
      
      // 启动后台进程
      const child = exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Mirror sync failed: ${error.message}`);
          console.error(`Command stdout: ${stdout}`);
          console.error(`Command stderr: ${stderr}`);
          
          // 读取日志文件获取更多错误信息
          let logContent = '';
          try {
            if (fs.existsSync(logPath)) {
              logContent = fs.readFileSync(logPath, 'utf8');
              console.error(`Log file content: ${logContent}`);
            }
          } catch (readError) {
            console.error('Failed to read log file:', readError.message);
          }
          
          const fullError = `${error.message}\n${stderr}\n${logContent}`;
          syncTasks[taskId].status = 'failed';
          syncTasks[taskId].error = fullError;
          syncTasks[taskId].endTime = new Date().toISOString();
          
          // 保存任务状态到磁盘
          saveSyncTasks();
          
          resolve({
            success: false,
            error: fullError,
            taskId
          });
        } else {
          console.log(`Mirror sync completed successfully`);
          syncTasks[taskId].status = 'completed';
          syncTasks[taskId].progress = 100;
          syncTasks[taskId].endTime = new Date().toISOString();

          // 保存任务状态到磁盘
          saveSyncTasks();

          // 同步完成后，将同步的内容添加到仓库管理中
          try {
            const syncDir = path.join(mirrorSyncDir, configName);
            const mirrorDir = path.join(syncDir, 'mirror');

            console.log(`Checking mirror directory: ${mirrorDir}`);
            console.log(`syncDir exists: ${fs.existsSync(syncDir)}`);
            console.log(`mirrorDir exists: ${fs.existsSync(mirrorDir)}`);

            // 检查同步目录是否存在
            if (fs.existsSync(mirrorDir)) {
              // 查找包含 dists 和 pool 的目录
              const sourceBaseDir = findSourceBaseDir(mirrorDir);
              console.log(`Source base directory: ${sourceBaseDir}`);

              if (sourceBaseDir) {
                const sourceContents = fs.readdirSync(sourceBaseDir);
                console.log(`Source directory contents: ${JSON.stringify(sourceContents)}`);

                // 获取同步的 codename（从第一个 deb 源行解析）
                let codename = 'focal';
                if (config.debLines && config.debLines.length > 0) {
                  const firstDeb = config.debLines[0];
                  codename = firstDeb.codename || 'focal';
                  console.log(`Using codename from config: ${codename}`);
                }

                // 创建新的仓库（如果已存在会覆盖配置）
                createRepository(configName, codename);

                // 获取仓库目录
                const repoDir = getRepoDir(configName);
                console.log(`Repository directory: ${repoDir}`);

                // 复制同步的内容到仓库目录
                sourceContents.forEach(item => {
                  const sourcePath = path.join(sourceBaseDir, item);
                  const targetPath = path.join(repoDir, item);

                  try {
                    if (fs.statSync(sourcePath).isDirectory()) {
                      console.log(`Copying directory: ${item}`);
                      fs.copySync(sourcePath, targetPath, { overwrite: true });
                    } else {
                      console.log(`Copying file: ${item}`);
                      fs.copySync(sourcePath, targetPath, { overwrite: true });
                    }
                  } catch (copyError) {
                    console.error(`Error copying ${item}: ${copyError.message}`);
                  }
                });

                // 验证仓库是否创建成功
                const repoCheck = getRepoDir(configName);
                const distsCheck = path.join(repoCheck, 'dists');
                const poolCheck = path.join(repoCheck, 'pool');
                console.log(`Repository created at: ${repoCheck}, exists: ${fs.existsSync(repoCheck)}`);
                console.log(`dists directory: ${distsCheck}, exists: ${fs.existsSync(distsCheck)}`);
                console.log(`pool directory: ${poolCheck}, exists: ${fs.existsSync(poolCheck)}`);

                console.log(`Mirror sync content added to repository: ${configName}`);
                
                // 清理镜像同步目录以节省空间
                cleanupMirrorSyncDir(configName);
              } else {
                console.error(`Could not find dists and pool directories in ${mirrorDir}`);
                // 列出完整目录树帮助调试
                listDirectoryTree(mirrorDir, '');
              }
            } else {
              console.error(`Mirror directory not found: ${mirrorDir}`);
              // 列出 syncDir 的内容帮助调试
              if (fs.existsSync(syncDir)) {
                console.log(`Contents of syncDir: ${fs.readdirSync(syncDir)}`);
              }
            }
          } catch (repoError) {
            console.error('Failed to add mirror sync to repository:', repoError.message);
            console.error('Stack:', repoError.stack);
            // 不影响同步结果，继续返回成功
          }

          resolve({
            success: true,
            message: `Mirror sync completed successfully`,
            logPath,
            taskId
          });
        }
      });
      
      // 保存child进程引用到任务状态中
      syncTasks[taskId].childProcess = child;
      
      // 定期更新进度（通过读取日志文件和统计目录大小）
      const progressInterval = setInterval(() => {
        if (syncTasks[taskId] && syncTasks[taskId].status === 'running') {
          try {
            // 解析日志文件，计算进度
            let progress = syncTasks[taskId].progress;
            let hasProgressUpdate = false;
            
            // 读取日志文件
            if (fs.existsSync(logPath)) {
              const logContent = fs.readFileSync(logPath, 'utf8');
              
              // 检查是否开始下载索引文件
              if (logContent.includes('Downloading index files')) {
                progress = 10;
                hasProgressUpdate = true;
              }
              
              // 检查是否开始下载包文件
              if (logContent.includes('Downloading packages')) {
                progress = 30;
                hasProgressUpdate = true;
              }
              
              // 提取总下载大小
              const totalSizeMatch = logContent.match(/([\d.]+)\s*GiB will be downloaded/);
              if (totalSizeMatch) {
                const totalSize = parseFloat(totalSizeMatch[1]);
                syncTasks[taskId].totalSize = totalSize;
                console.log(`Total download size: ${totalSize} GiB`);
              }
              
              // 检查是否开始清理
              if (logContent.includes('Cleaning up')) {
                progress = 80;
                hasProgressUpdate = true;
              }
              
              // 检查是否完成
              if (logContent.includes('End time:')) {
                progress = 95;
                hasProgressUpdate = true;
              }
              
              // 检查是否有错误
              if (logContent.includes('error') || logContent.includes('failed') || logContent.includes('Error')) {
                console.error('Mirror sync error detected in log');
                // 不立即失败，继续观察
              }
              
              // 如果有总下载大小，使用du命令统计已下载大小
              if (syncTasks[taskId].totalSize) {
                try {
                  const syncDir = path.join(mirrorSyncDir, configName);
                  if (fs.existsSync(syncDir)) {
                    // 使用du命令统计目录大小
                    const duResult = execSync(`du -sh ${syncDir}`, { encoding: 'utf8' });
                    const sizeMatch = duResult.match(/([\d.]+)([GM])/);
                    if (sizeMatch) {
                      let downloadedSize = parseFloat(sizeMatch[1]);
                      const unit = sizeMatch[2];
                      
                      // 转换为GiB
                      if (unit === 'M') {
                        downloadedSize = downloadedSize / 1024;
                      }
                      
                      const totalSize = syncTasks[taskId].totalSize;
                      if (totalSize > 0) {
                        // 计算实际进度百分比（0-100%）
                        const actualProgress = (downloadedSize / totalSize) * 100;
                        // 将实际进度映射到30-95%之间（下载阶段）
                        const calculatedProgress = Math.min(actualProgress * 0.7 + 30, 95);
                        progress = calculatedProgress;
                        hasProgressUpdate = true;
                        syncTasks[taskId].downloadedSize = downloadedSize;
                        console.log(`Downloaded: ${downloadedSize.toFixed(2)} GiB, Total: ${totalSize.toFixed(2)} GiB, Actual Progress: ${actualProgress.toFixed(2)}%, Display Progress: ${progress.toFixed(2)}%`);
                      }
                    }
                  }
                } catch (duError) {
                  console.error('Failed to run du command:', duError.message);
                  // 继续使用其他方法计算进度
                }
              }
              
              // 提取已下载文件数量（apt-mirror日志格式）
              const downloadedFilesMatch = logContent.match(/(\d+)\s+files?\s+downloaded/i);
              const totalFilesMatch = logContent.match(/Downloading\s+(\d+)\s+archive\s+files/i);
              
              if (downloadedFilesMatch && totalFilesMatch && !hasProgressUpdate) {
                const downloadedFiles = parseInt(downloadedFilesMatch[1]);
                const totalFiles = parseInt(totalFilesMatch[1]);
                syncTasks[taskId].downloadedFiles = downloadedFiles;
                syncTasks[taskId].totalFiles = totalFiles;
                
                if (totalFiles > 0) {
                  // 根据已下载文件数量计算进度（30-95% 是下载阶段）
                  const calculatedProgress = Math.min((downloadedFiles / totalFiles) * 65 + 30, 95);
                  progress = calculatedProgress;
                  hasProgressUpdate = true;
                  console.log(`Downloaded: ${downloadedFiles}/${totalFiles} files, Progress: ${progress.toFixed(2)}%`);
                }
              }
              
              // 提取已下载大小（如果apt-mirror输出中包含）
              const downloadedMatch = logContent.match(/Downloaded\s+([\d.]+)\s*GiB/);
              if (downloadedMatch && syncTasks[taskId].totalSize) {
                const downloadedSize = parseFloat(downloadedMatch[1]);
                syncTasks[taskId].downloadedSize = downloadedSize;
                console.log(`Downloaded: ${downloadedSize.toFixed(2)} GiB, Total: ${syncTasks[taskId].totalSize.toFixed(2)} GiB`);
                
                if (!hasProgressUpdate && syncTasks[taskId].totalSize > 0) {
                  const calculatedProgress = Math.min((downloadedSize / syncTasks[taskId].totalSize) * 65 + 30, 95);
                  progress = calculatedProgress;
                  hasProgressUpdate = true;
                }
              }
              
              // 提取已下载大小（MB格式）
              const downloadedMBMatch = logContent.match(/Downloaded\s+([\d.]+)\s*MB/);
              if (downloadedMBMatch && syncTasks[taskId].totalSize && !hasProgressUpdate) {
                const downloadedMB = parseFloat(downloadedMBMatch[1]);
                const downloadedGiB = downloadedMB / 1024;
                syncTasks[taskId].downloadedSize = downloadedGiB;
                
                const calculatedProgress = Math.min((downloadedGiB / syncTasks[taskId].totalSize) * 65 + 30, 95);
                progress = calculatedProgress;
                hasProgressUpdate = true;
                console.log(`Downloaded: ${downloadedGiB.toFixed(2)} GiB (${downloadedMB} MB), Total: ${syncTasks[taskId].totalSize.toFixed(2)} GiB, Progress: ${progress.toFixed(2)}%`);
              }
            }
            
            // 如果任务正在运行，且没有从日志中更新进度，使用模拟进度
            if (syncTasks[taskId].status === 'running' && !hasProgressUpdate) {
              progress = Math.min(progress + Math.random() * 2, 95);
            }
            
            // 更新进度
            syncTasks[taskId].progress = progress;
            
            // 保存任务状态到磁盘
            saveSyncTasks();
          } catch (error) {
            console.error('Failed to read log file:', error.message);
            // 如果读取日志失败，且任务正在运行，继续使用模拟进度
            if (syncTasks[taskId].status === 'running') {
              syncTasks[taskId].progress = Math.min(syncTasks[taskId].progress + Math.random() * 2, 95);
            }
            saveSyncTasks();
          }
        } else if (syncTasks[taskId] && (syncTasks[taskId].status === 'completed' || syncTasks[taskId].status === 'failed')) {
          clearInterval(progressInterval);
        }
      }, 5000);
      
      // 添加任务超时机制（如果 SYNC_TIMEOUT <= 0 则不限制超时）
      let timeoutId = null;
      if (SYNC_TIMEOUT > 0) {
        timeoutId = setTimeout(() => {
          if (syncTasks[taskId] && syncTasks[taskId].status === 'running') {
            console.error(`Mirror sync timeout after ${SYNC_TIMEOUT / 1000 / 60} minutes`);
            syncTasks[taskId].status = 'failed';
            syncTasks[taskId].error = `Sync operation timed out after ${SYNC_TIMEOUT / 1000 / 60} minutes`;
            syncTasks[taskId].endTime = new Date().toISOString();

            // 尝试终止子进程
            try {
              child.kill('SIGTERM');
              console.log('Sync process terminated due to timeout');
            } catch (killError) {
              console.error('Failed to kill sync process:', killError.message);
            }

            resolve({
              success: false,
              error: `Sync operation timed out after ${SYNC_TIMEOUT / 1000 / 60} minutes`,
              taskId
            });
          }
        }, SYNC_TIMEOUT);
      } else {
        console.log('Sync timeout is disabled (SYNC_TIMEOUT <= 0), sync will run until completion');
      }

      // 清除超时定时器
      child.on('exit', () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });
      
    } catch (error) {
      console.error('Failed to run mirror sync:', error.message);
      reject(error);
    }
  });
}

// 新增：获取同步任务状态
function getSyncTaskStatus(taskId) {
  const task = syncTasks[taskId] || null;
  if (task) {
    // 确保返回所有必要的信息
    return {
      ...task,
      totalSize: task.totalSize || 0,
      downloadedSize: task.downloadedSize || 0,
      downloadedFiles: task.downloadedFiles || 0,
      totalFiles: task.totalFiles || 0
    };
  }
  return null;
}

// 新增：获取所有同步任务
function getAllSyncTasks() {
  return Object.values(syncTasks);
}

// 新增：获取所有镜像配置
function getMirrorConfigs() {
  try {
    const configs = [];
    const files = fs.readdirSync(mirrorConfigDir);

    files.forEach(file => {
      if (file.endsWith('.conf')) {
        const configName = file.replace('.conf', '');
        const configPath = path.join(mirrorConfigDir, file);
        const content = fs.readFileSync(configPath, 'utf8');

        // 解析配置文件 - 支持多个 deb 行
        const debMatches = content.match(/^deb\s+(https?:\/\/[^\s]+)\s+(\w+)\s+([^\n]+)/gm);
        const bandwidthMatch = content.match(/set limit_rate\s+(\d+)/);

        const debLines = [];
        let firstUrl = '';
        let firstCodename = '';
        let firstComponents = [];

        if (debMatches) {
          debMatches.forEach((match, index) => {
            const lineMatch = match.match(/^deb\s+(https?:\/\/[^\s]+)\s+(\w+)\s+([^\n]+)/);
            if (lineMatch) {
              const url = lineMatch[1];
              const codename = lineMatch[2];
              const components = lineMatch[3].split(' ').filter(Boolean);

              debLines.push({
                url: url,
                codename: codename,
                components: components
              });

              if (index === 0) {
                firstUrl = url;
                firstCodename = codename;
                firstComponents = components;
              }
            }
          });
        }

        const debLine = debLines.length > 0
          ? debLines.map(d => `deb ${d.url} ${d.codename} ${d.components.join(' ')}`).join('\n')
          : '';

        configs.push({
          name: configName,
          url: firstUrl,
          codename: firstCodename,
          components: firstComponents,
          bandwidth: bandwidthMatch ? bandwidthMatch[1] : '',
          syncPath: path.join(mirrorSyncDir, configName),
          debLine: debLines.length > 0 ? `deb ${firstUrl} ${firstCodename} ${firstComponents.join(' ')}` : '',
          debLines: debLines
        });
      }
    });

    return configs;
  } catch (error) {
    console.error('Failed to get mirror configs:', error.message);
    return [];
  }
}

// 新增：删除镜像配置
function deleteMirrorConfig(configName) {
  try {
    const configPath = path.join(mirrorConfigDir, `${configName}.conf`);
    const syncDir = path.join(mirrorSyncDir, configName);
    
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    
    if (fs.existsSync(syncDir)) {
      fs.removeSync(syncDir);
    }
    
    // 取消定时任务（如果定时任务功能已启用）
    if (typeof scheduledJobs !== 'undefined' && scheduledJobs[configName]) {
      scheduledJobs[configName].cancel();
      delete scheduledJobs[configName];
    }
    
    return {
      success: true,
      message: `Mirror configuration ${configName} deleted successfully`
    };
  } catch (error) {
    console.error('Failed to delete mirror config:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// 暂时注释掉定时任务相关代码，以便能够启动服务器
/*
// 新增：定时任务管理
const scheduledJobs = {}; // 存储定时任务，格式 { configName: { jobId: job, ... } }
let jobIdCounter = 0;

// 新增：创建同步任务
function createSyncTask(configName, scheduleExpression, taskName) {
  try {
    const jobId = `job_${++jobIdCounter}`;
    
    // 确保配置名称对应的任务对象存在
    if (!scheduledJobs[configName]) {
      scheduledJobs[configName] = {};
    }
    
    // 创建新的定时任务
    const job = schedule.scheduleJob(scheduleExpression, async () => {
      console.log(`Running scheduled sync task ${taskName} for ${configName}`);
      try {
        await runMirrorSync(configName);
        console.log(`Scheduled sync task ${taskName} completed for ${configName}`);
      } catch (error) {
        console.error(`Scheduled sync task ${taskName} failed for ${configName}:`, error.message);
      }
    });
    
    scheduledJobs[configName][jobId] = {
      id: jobId,
      name: taskName,
      schedule: scheduleExpression,
      job: job,
      createdAt: new Date().toISOString()
    };
    
    return {
      success: true,
      message: `Sync task ${taskName} created for ${configName}`,
      task: {
        id: jobId,
        name: taskName,
        schedule: scheduleExpression,
        configName,
        createdAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Failed to create sync task:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// 新增：删除同步任务
function deleteSyncTask(configName, jobId) {
  try {
    if (!scheduledJobs[configName] || !scheduledJobs[configName][jobId]) {
      return {
        success: false,
        error: 'Task not found'
      };
    }
    
    // 取消任务
    scheduledJobs[configName][jobId].job.cancel();
    
    // 删除任务
    delete scheduledJobs[configName][jobId];
    
    // 如果配置没有任务了，删除配置条目
    if (Object.keys(scheduledJobs[configName]).length === 0) {
      delete scheduledJobs[configName];
    }
    
    return {
      success: true,
      message: `Sync task deleted for ${configName}`
    };
  } catch (error) {
    console.error('Failed to delete sync task:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// 新增：获取同步任务列表
function getSyncTasks(configName) {
  try {
    if (!scheduledJobs[configName]) {
      return [];
    }
    
    return Object.values(scheduledJobs[configName]).map(task => ({
      id: task.id,
      name: task.name,
      schedule: task.schedule,
      status: task.status || 'running',
      createdAt: task.createdAt
    }));
  } catch (error) {
    console.error('Failed to get sync tasks:', error.message);
    return [];
  }
}

// 新增：设置定时同步任务（兼容旧接口）
function setScheduledSync(configName, scheduleExpression) {
  try {
    // 取消现有的任务
    if (scheduledJobs[configName]) {
      Object.values(scheduledJobs[configName]).forEach(task => {
        task.job.cancel();
      });
      delete scheduledJobs[configName];
    }
    
    if (!scheduleExpression) {
      return {
        success: true,
        message: `Scheduled sync disabled for ${configName}`
      };
    }
    
    // 创建新的定时任务
    const result = createSyncTask(configName, scheduleExpression, 'default');
    return result;
  } catch (error) {
    console.error('Failed to set scheduled sync:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}
*/

// 新增：apt-mirror API
app.get('/mirrors', (req, res) => {
  try {
    const configs = getMirrorConfigs();
    res.json({
      success: true,
      mirrors: configs
    });
  } catch (error) {
    console.error('Failed to get mirror configs:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 同步状态管理
let syncStatus = {
  lastSyncTime: null,
  status: 'never_synced',
  source: null,
  nextSyncTime: null
};

// 获取同步状态API
app.get('/sync/status', (req, res) => {
  try {
    const tasks = getAllSyncTasks();
    const runningTask = tasks.find(t => t.status === 'running' || t.status === 'paused');
    
    if (runningTask) {
      syncStatus.status = runningTask.status;
      syncStatus.source = runningTask.configName;
      res.json({
        success: true,
        ...syncStatus,
        progress: runningTask.progress || 0,
        downloadedSize: runningTask.downloadedSize || 0,
        totalSize: runningTask.totalSize || 0,
        downloadedFiles: runningTask.downloadedFiles || 0,
        totalFiles: runningTask.totalFiles || 0
      });
    } else if (tasks.length > 0) {
      const lastTask = tasks.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0];
      syncStatus.lastSyncTime = lastTask.endTime || lastTask.startTime;
      syncStatus.status = lastTask.status;
      syncStatus.source = lastTask.configName;
      res.json({
        success: true,
        ...syncStatus,
        progress: lastTask.progress || 0,
        downloadedSize: lastTask.downloadedSize || 0,
        totalSize: lastTask.totalSize || 0,
        downloadedFiles: lastTask.downloadedFiles || 0,
        totalFiles: lastTask.totalFiles || 0
      });
    } else {
      res.json({
        success: true,
        ...syncStatus,
        progress: 0,
        downloadedSize: 0,
        totalSize: 0,
        downloadedFiles: 0,
        totalFiles: 0
      });
    }
  } catch (error) {
    console.error('Failed to get sync status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 获取同步任务列表API
app.get('/sync/tasks', (req, res) => {
  try {
    const tasks = getAllSyncTasks();
    // 移除 childProcess 引用，避免序列化问题
    const tasksWithoutProcess = tasks.map(task => {
      const { childProcess, ...taskWithoutProcess } = task;
      return taskWithoutProcess;
    });
    res.json({
      success: true,
      tasks: tasksWithoutProcess
    });
  } catch (error) {
    console.error('Failed to get sync tasks:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 开始同步API
app.post('/sync/start', (req, res) => {
  try {
    let { configName } = req.body;
    
    // 如果没有提供configName，自动获取第一个配置
    if (!configName) {
      const configs = getMirrorConfigs();
      if (configs.length > 0) {
        configName = configs[0].name;
      } else {
        return res.status(400).json({ error: 'No mirror configuration found. Please create one first.' });
      }
    }
    
    const configPath = path.join(mirrorConfigDir, `${configName}.conf`);
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: `Configuration ${configName} not found` });
    }
    
    syncStatus.status = 'running';
    syncStatus.source = configName;
    
    runMirrorSync(configName)
      .then(result => {
        if (result.success) {
          syncStatus.lastSyncTime = new Date().toISOString();
          syncStatus.status = 'completed';
        } else {
          syncStatus.status = 'failed';
        }
        res.json(result);
      })
      .catch(error => {
        syncStatus.status = 'failed';
        res.status(500).json({ error: error.message });
      });
  } catch (error) {
    console.error('Failed to start sync:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 暂停同步API
app.post('/sync/pause', (req, res) => {
  try {
    const tasks = getAllSyncTasks();
    const runningTask = tasks.find(t => t.status === 'running');
    
    if (!runningTask) {
      return res.status(400).json({ success: false, error: 'No running sync task found' });
    }
    
    const taskId = runningTask.id;
    
    // 暂停进度更新定时器
    if (syncTasks[taskId] && syncTasks[taskId].progressInterval) {
      clearInterval(syncTasks[taskId].progressInterval);
      console.log(`Progress interval cleared for task ${taskId}`);
    }
    
    // 暂停子进程及其所有子进程
    if (syncTasks[taskId] && syncTasks[taskId].childProcess) {
      try {
        const pid = syncTasks[taskId].childProcess.pid;
        console.log(`Attempting to pause process group with PID: ${pid}`);
        
        // 尝试向整个进程组发送SIGSTOP信号
        try {
          process.kill(-pid, 'SIGSTOP');
          console.log(`Sent SIGSTOP to process group ${pid}`);
        } catch (groupError) {
          console.log(`Failed to send SIGSTOP to process group, trying individual process`);
          // 如果进程组操作失败，尝试单独暂停主进程
          syncTasks[taskId].childProcess.kill('SIGSTOP');
          console.log(`Sent SIGSTOP to individual process ${pid}`);
        }
        
        // 额外安全措施：使用pkill命令查找并暂停所有相关进程
        try {
          execSync(`pkill -STOP -P ${pid}`, { stdio: 'ignore' });
          console.log(`Sent SIGSTOP to all child processes of ${pid}`);
        } catch (pkillError) {
          console.log(`No child processes found or pkill failed: ${pkillError.message}`);
        }
        
        console.log(`Sync task ${taskId} paused successfully`);
      } catch (killError) {
        console.error('Failed to pause sync process:', killError.message);
        return res.status(500).json({ success: false, error: 'Failed to pause sync process: ' + killError.message });
      }
    }
    
    // 更新任务状态
    syncTasks[taskId].status = 'paused';
    syncTasks[taskId].pauseTime = new Date().toISOString();
    syncStatus.status = 'paused';
    
    saveSyncTasks();
    
    res.json({
      success: true,
      message: 'Sync task paused successfully',
      taskId: taskId,
      progress: syncTasks[taskId].progress
    });
  } catch (error) {
    console.error('Failed to pause sync:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 恢复同步API
app.post('/sync/resume', (req, res) => {
  try {
    const tasks = getAllSyncTasks();
    const pausedTask = tasks.find(t => t.status === 'paused');
    
    if (!pausedTask) {
      return res.status(400).json({ success: false, error: 'No paused sync task found' });
    }
    
    const taskId = pausedTask.id;
    
    // 恢复子进程及其所有子进程
    if (syncTasks[taskId] && syncTasks[taskId].childProcess) {
      try {
        const pid = syncTasks[taskId].childProcess.pid;
        console.log(`Attempting to resume process group with PID: ${pid}`);
        
        // 尝试向整个进程组发送SIGCONT信号
        try {
          process.kill(-pid, 'SIGCONT');
          console.log(`Sent SIGCONT to process group ${pid}`);
        } catch (groupError) {
          console.log(`Failed to send SIGCONT to process group, trying individual process`);
          // 如果进程组操作失败，尝试单独恢复主进程
          syncTasks[taskId].childProcess.kill('SIGCONT');
          console.log(`Sent SIGCONT to individual process ${pid}`);
        }
        
        // 额外安全措施：使用pkill命令查找并恢复所有相关进程
        try {
          execSync(`pkill -CONT -P ${pid}`, { stdio: 'ignore' });
          console.log(`Sent SIGCONT to all child processes of ${pid}`);
        } catch (pkillError) {
          console.log(`No child processes found or pkill failed: ${pkillError.message}`);
        }
        
        console.log(`Sync task ${taskId} resumed successfully`);
      } catch (killError) {
        console.error('Failed to resume sync process:', killError.message);
        return res.status(500).json({ success: false, error: 'Failed to resume sync process: ' + killError.message });
      }
    }
    
    // 更新任务状态
    syncTasks[taskId].status = 'running';
    syncTasks[taskId].resumeTime = new Date().toISOString();
    syncStatus.status = 'running';
    
    saveSyncTasks();
    
    res.json({
      success: true,
      message: 'Sync task resumed successfully',
      taskId: taskId,
      progress: syncTasks[taskId].progress
    });
  } catch (error) {
    console.error('Failed to resume sync:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 停止同步API
app.post('/sync/stop', (req, res) => {
  try {
    const tasks = getAllSyncTasks();
    const runningTask = tasks.find(t => t.status === 'running' || t.status === 'paused');
    
    if (!runningTask) {
      return res.status(400).json({ success: false, error: 'No sync task found to stop' });
    }
    
    const taskId = runningTask.id;
    
    // 清除进度更新定时器
    if (syncTasks[taskId] && syncTasks[taskId].progressInterval) {
      clearInterval(syncTasks[taskId].progressInterval);
      console.log(`Progress interval cleared for task ${taskId}`);
    }
    
    // 彻底终止所有相关进程
    if (syncTasks[taskId] && syncTasks[taskId].childProcess) {
      try {
        const pid = syncTasks[taskId].childProcess.pid;
        console.log(`Attempting to stop process group with PID: ${pid}`);
        
        // 方法1：尝试向整个进程组发送SIGKILL信号
        try {
          process.kill(-pid, 'SIGKILL');
          console.log(`Sent SIGKILL to process group ${pid}`);
        } catch (groupError) {
          console.log(`Failed to send SIGKILL to process group, trying individual process`);
          syncTasks[taskId].childProcess.kill('SIGKILL');
          console.log(`Sent SIGKILL to individual process ${pid}`);
        }
        
        // 方法2：使用pkill命令查找并杀死所有子进程
        try {
          execSync(`pkill -KILL -P ${pid}`, { stdio: 'ignore' });
          console.log(`Sent SIGKILL to all child processes of ${pid}`);
        } catch (pkillError) {
          console.log(`No child processes found or pkill failed: ${pkillError.message}`);
        }
        
        // 方法3：查找并杀死所有apt-mirror进程
        try {
          execSync(`pkill -KILL -f apt-mirror`, { stdio: 'ignore' });
          console.log('Killed all apt-mirror processes');
        } catch (e) {
          console.log(`No apt-mirror processes found or pkill failed: ${e.message}`);
        }
        
        // 方法4：查找并杀死所有wget进程（apt-mirror使用wget下载）
        try {
          execSync(`pkill -KILL -f wget`, { stdio: 'ignore' });
          console.log('Killed all wget processes');
        } catch (e) {
          console.log(`No wget processes found or pkill failed: ${e.message}`);
        }
        
        // 等待进程完全终止
        setTimeout(() => {
          // 验证是否还有apt-mirror进程在运行
          try {
            execSync(`pgrep apt-mirror`, { stdio: 'ignore' });
            console.warn('Warning: apt-mirror process still running after kill attempt');
          } catch (e) {
            console.log('All apt-mirror processes terminated successfully');
          }
        }, 1000);
        
        console.log(`Sync task ${taskId} stopped successfully`);
      } catch (killError) {
        console.error('Failed to stop sync process:', killError.message);
        return res.status(500).json({ success: false, error: 'Failed to stop sync process: ' + killError.message });
      }
    }
    
    // 更新任务状态
    syncTasks[taskId].status = 'stopped';
    syncTasks[taskId].endTime = new Date().toISOString();
    syncStatus.status = 'never_synced';
    syncStatus.lastSyncTime = null;
    
    saveSyncTasks();
    
    res.json({
      success: true,
      message: 'Sync task stopped successfully',
      taskId: taskId
    });
  } catch (error) {
    console.error('Failed to stop sync:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/mirrors', (req, res) => {
  try {
    const config = req.body;

    // 支持新的 debLines 格式（多个 deb 源）
    if (config.debLines && Array.isArray(config.debLines) && config.debLines.length > 0) {
      if (!config.name || !config.architectures) {
        return res.status(400).json({ error: 'Missing required configuration parameters' });
      }

      // 验证所有 debLines 的 codename 是否一致
      const codenames = [...new Set(config.debLines.map(d => d.codename))];
      if (codenames.length > 1) {
        return res.status(400).json({ error: 'All deb sources must have the same codename' });
      }

      const result = createMirrorConfig(config);

      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } else if (!config.name || !config.url || !config.codename || !config.components || !config.architectures) {
      // 兼容旧的单个 url/codename/components 格式
      return res.status(400).json({ error: 'Missing required configuration parameters' });
    } else {
      const result = createMirrorConfig(config);

      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    }
  } catch (error) {
    console.error('Failed to create mirror config:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/mirrors/:configName', (req, res) => {
  try {
    const configName = req.params.configName;
    const result = deleteMirrorConfig(configName);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Failed to delete mirror config:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/mirrors/:configName/sync', (req, res) => {
  try {
    const configName = req.params.configName;
    
    runMirrorSync(configName)
      .then(result => {
        res.json(result);
      })
      .catch(error => {
        res.status(500).json({ error: error.message });
      });
  } catch (error) {
    console.error('Failed to run mirror sync:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 新增：获取同步任务状态API
app.get('/mirrors/tasks/:taskId', (req, res) => {
  try {
    const taskId = req.params.taskId;
    const task = getSyncTaskStatus(taskId);
    
    if (task) {
      res.json({
        success: true,
        task
      });
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  } catch (error) {
    console.error('Failed to get task status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 新增：获取所有同步任务API
app.get('/mirrors/tasks', (req, res) => {
  try {
    const tasks = getAllSyncTasks();
    res.json({
      success: true,
      tasks
    });
  } catch (error) {
    console.error('Failed to get tasks:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 新增：暂停同步任务API
app.post('/mirrors/tasks/:taskId/pause', (req, res) => {
  try {
    const taskId = req.params.taskId;
    const task = syncTasks[taskId];
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    if (task.status !== 'running') {
      return res.status(400).json({ error: 'Task is not running' });
    }
    
    // 暂停任务
    if (task.childProcess) {
      try {
        const isWindows = process.platform === 'win32';
        
        if (isWindows) {
          // 在Windows上使用更有效的方法暂停进程及其所有相关进程
          const { execSync } = require('child_process');
          
          // 方法1：暂停主进程及其直接子进程
          execSync(`taskkill /SUSPEND /PID ${task.childProcess.pid}`, { stdio: 'ignore' });
          console.log(`Paused process ${task.childProcess.pid} on Windows`);
          
          // 方法2：尝试查找并暂停所有与apt-mirror相关的进程
          try {
            // 查找所有apt-mirror进程
            const wmicResult = execSync(`wmic process where "CommandLine like '%apt-mirror%'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 跳过标题行
              const pid = lines[i].trim();
              if (pid) {
                try {
                  execSync(`taskkill /SUSPEND /PID ${pid}`, { stdio: 'ignore' });
                  console.log(`Paused apt-mirror process ${pid} on Windows`);
                } catch (e) {
                  console.error(`Failed to pause apt-mirror process ${pid}:`, e.message);
                }
              }
            }
          } catch (e) {
            console.error('Failed to get apt-mirror processes:', e.message);
          }
          
          // 方法3：尝试查找并暂停所有wget进程（apt-mirror使用wget下载）
          try {
            const wmicResult = execSync(`wmic process where "Name='wget.exe'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 跳过标题行
              const pid = lines[i].trim();
              if (pid) {
                try {
                  execSync(`taskkill /SUSPEND /PID ${pid}`, { stdio: 'ignore' });
                  console.log(`Paused wget process ${pid} on Windows`);
                } catch (e) {
                  console.error(`Failed to pause wget process ${pid}:`, e.message);
                }
              }
            }
          } catch (e) {
            console.error('Failed to get wget processes:', e.message);
          }
        } else {
          // 在Linux/Unix系统上使用更有效的方法暂停进程及其所有相关进程
          const { execSync } = require('child_process');
          
          // 方法1：暂停主进程
          task.childProcess.kill('SIGSTOP');
          console.log(`Paused process ${task.childProcess.pid} with SIGSTOP`);
          
          // 方法2：使用pstree命令获取所有子进程（包括多层级）
          try {
            const pstreeResult = execSync(`pstree -p ${task.childProcess.pid}`, { encoding: 'utf8' });
            // 提取所有PID
            const pidMatches = pstreeResult.match(/\((\d+)\)/g);
            if (pidMatches) {
              const pids = pidMatches.map(match => match.replace(/[()]/g, '')).filter(pid => pid !== task.childProcess.pid.toString());
              pids.forEach(pid => {
                try {
                  process.kill(parseInt(pid), 'SIGSTOP');
                  console.log(`Paused child process ${pid} on Linux`);
                } catch (e) {
                  console.error(`Failed to pause child process ${pid}:`, e.message);
                }
              });
            }
          } catch (e) {
            console.error('Failed to get child processes with pstree:', e.message);
            
            // 备选方法：使用ps命令递归获取所有子进程
            try {
              const psResult = execSync(`ps -ef | grep -E "^.*\s+${task.childProcess.pid}\s+" | awk '{print $2}'`, { encoding: 'utf8' });
              const pids = psResult.trim().split('\n').filter(pid => pid);
              pids.forEach(pid => {
                try {
                  process.kill(parseInt(pid), 'SIGSTOP');
                  console.log(`Paused child process ${pid} on Linux`);
                } catch (e2) {
                  console.error(`Failed to pause child process ${pid}:`, e2.message);
                }
              });
            } catch (e2) {
              console.error('Failed to get child processes with ps:', e2.message);
            }
          }
          
          // 方法3：尝试查找并暂停所有与apt-mirror相关的进程
          try {
            const psResult = execSync(`ps -ef | grep -i apt-mirror | grep -v grep | awk '{print $2}'`, { encoding: 'utf8' });
            const pids = psResult.trim().split('\n').filter(pid => pid);
            pids.forEach(pid => {
              try {
                process.kill(parseInt(pid), 'SIGSTOP');
                console.log(`Paused apt-mirror process ${pid} on Linux`);
              } catch (e) {
                console.error(`Failed to pause apt-mirror process ${pid}:`, e.message);
              }
            });
          } catch (e) {
            console.error('Failed to get apt-mirror processes:', e.message);
          }
          
          // 方法4：尝试查找并暂停所有wget进程（apt-mirror使用wget下载）
          try {
            const psResult = execSync(`ps -ef | grep -i wget | grep -v grep | awk '{print $2}'`, { encoding: 'utf8' });
            const pids = psResult.trim().split('\n').filter(pid => pid);
            pids.forEach(pid => {
              try {
                process.kill(parseInt(pid), 'SIGSTOP');
                console.log(`Paused wget process ${pid} on Linux`);
              } catch (e) {
                console.error(`Failed to pause wget process ${pid}:`, e.message);
              }
            });
          } catch (e) {
            console.error('Failed to get wget processes:', e.message);
          }
        }
        
        task.status = 'paused';
        saveSyncTasks();
        res.json({
          success: true,
          message: 'Task paused successfully',
          taskId
        });
      } catch (error) {
        console.error('Failed to pause task:', error.message);
        res.status(500).json({ error: error.message });
      }
    } else {
      res.status(400).json({ error: 'No running process found for this task' });
    }
  } catch (error) {
    console.error('Failed to pause task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 新增：恢复同步任务API
app.post('/mirrors/tasks/:taskId/resume', (req, res) => {
  try {
    const taskId = req.params.taskId;
    const task = syncTasks[taskId];
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    if (task.status !== 'paused') {
      return res.status(400).json({ error: 'Task is not paused' });
    }
    
    // 恢复任务
    if (task.childProcess) {
      try {
        const isWindows = process.platform === 'win32';
        
        if (isWindows) {
          // 在Windows上使用更有效的方法恢复进程及其所有相关进程
          const { execSync } = require('child_process');
          
          // 方法1：恢复主进程及其直接子进程
          execSync(`taskkill /RESUME /PID ${task.childProcess.pid}`, { stdio: 'ignore' });
          console.log(`Resumed process ${task.childProcess.pid} on Windows`);
          
          // 方法2：尝试查找并恢复所有与apt-mirror相关的进程
          try {
            // 查找所有apt-mirror进程
            const wmicResult = execSync(`wmic process where "CommandLine like '%apt-mirror%'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 跳过标题行
              const pid = lines[i].trim();
              if (pid) {
                try {
                  execSync(`taskkill /RESUME /PID ${pid}`, { stdio: 'ignore' });
                  console.log(`Resumed apt-mirror process ${pid} on Windows`);
                } catch (e) {
                  console.error(`Failed to resume apt-mirror process ${pid}:`, e.message);
                }
              }
            }
          } catch (e) {
            console.error('Failed to get apt-mirror processes:', e.message);
          }
          
          // 方法3：尝试查找并恢复所有wget进程（apt-mirror使用wget下载）
          try {
            const wmicResult = execSync(`wmic process where "Name='wget.exe'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 跳过标题行
              const pid = lines[i].trim();
              if (pid) {
                try {
                  execSync(`taskkill /RESUME /PID ${pid}`, { stdio: 'ignore' });
                  console.log(`Resumed wget process ${pid} on Windows`);
                } catch (e) {
                  console.error(`Failed to resume wget process ${pid}:`, e.message);
                }
              }
            }
          } catch (e) {
            console.error('Failed to get wget processes:', e.message);
          }
        } else {
          // 在Linux/Unix系统上使用更有效的方法恢复进程及其所有相关进程
          const { execSync } = require('child_process');
          
          // 方法1：恢复主进程
          task.childProcess.kill('SIGCONT');
          console.log(`Resumed process ${task.childProcess.pid} with SIGCONT`);
          
          // 方法2：使用pstree命令获取所有子进程（包括多层级）
          try {
            const pstreeResult = execSync(`pstree -p ${task.childProcess.pid}`, { encoding: 'utf8' });
            // 提取所有PID
            const pidMatches = pstreeResult.match(/\((\d+)\)/g);
            if (pidMatches) {
              const pids = pidMatches.map(match => match.replace(/[()]/g, '')).filter(pid => pid !== task.childProcess.pid.toString());
              pids.forEach(pid => {
                try {
                  process.kill(parseInt(pid), 'SIGCONT');
                  console.log(`Resumed child process ${pid} on Linux`);
                } catch (e) {
                  console.error(`Failed to resume child process ${pid}:`, e.message);
                }
              });
            }
          } catch (e) {
            console.error('Failed to get child processes with pstree:', e.message);
            
            // 备选方法：使用ps命令递归获取所有子进程
            try {
              const psResult = execSync(`ps -ef | grep -E "^.*\s+${task.childProcess.pid}\s+" | awk '{print $2}'`, { encoding: 'utf8' });
              const pids = psResult.trim().split('\n').filter(pid => pid);
              pids.forEach(pid => {
                try {
                  process.kill(parseInt(pid), 'SIGCONT');
                  console.log(`Resumed child process ${pid} on Linux`);
                } catch (e2) {
                  console.error(`Failed to resume child process ${pid}:`, e2.message);
                }
              });
            } catch (e2) {
              console.error('Failed to get child processes with ps:', e2.message);
            }
          }
          
          // 方法3：尝试查找并恢复所有与apt-mirror相关的进程
          try {
            const psResult = execSync(`ps -ef | grep -i apt-mirror | grep -v grep | awk '{print $2}'`, { encoding: 'utf8' });
            const pids = psResult.trim().split('\n').filter(pid => pid);
            pids.forEach(pid => {
              try {
                process.kill(parseInt(pid), 'SIGCONT');
                console.log(`Resumed apt-mirror process ${pid} on Linux`);
              } catch (e) {
                console.error(`Failed to resume apt-mirror process ${pid}:`, e.message);
              }
            });
          } catch (e) {
            console.error('Failed to get apt-mirror processes:', e.message);
          }
          
          // 方法4：尝试查找并恢复所有wget进程（apt-mirror使用wget下载）
          try {
            const psResult = execSync(`ps -ef | grep -i wget | grep -v grep | awk '{print $2}'`, { encoding: 'utf8' });
            const pids = psResult.trim().split('\n').filter(pid => pid);
            pids.forEach(pid => {
              try {
                process.kill(parseInt(pid), 'SIGCONT');
                console.log(`Resumed wget process ${pid} on Linux`);
              } catch (e) {
                console.error(`Failed to resume wget process ${pid}:`, e.message);
              }
            });
          } catch (e) {
            console.error('Failed to get wget processes:', e.message);
          }
        }
        
        task.status = 'running';
        saveSyncTasks();
        res.json({
          success: true,
          message: 'Task resumed successfully',
          taskId
        });
      } catch (error) {
        console.error('Failed to resume task:', error.message);
        res.status(500).json({ error: error.message });
      }
    } else {
      res.status(400).json({ error: 'No paused process found for this task' });
    }
  } catch (error) {
    console.error('Failed to resume task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 新增：取消同步任务API
app.post('/mirrors/tasks/:taskId/cancel', (req, res) => {
  try {
    const taskId = req.params.taskId;
    const task = syncTasks[taskId];
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    if (task.status === 'completed' || task.status === 'failed') {
      return res.status(400).json({ error: 'Task is already completed or failed' });
    }
    
    // 取消任务
    if (task.childProcess) {
      try {
        const isWindows = process.platform === 'win32';
        
        if (isWindows) {
          // 在Windows上使用更有效的方法终止进程及其所有相关进程
          const { execSync } = require('child_process');
          
          // 方法1：终止主进程及其直接子进程
          execSync(`taskkill /F /PID ${task.childProcess.pid}`, { stdio: 'ignore' });
          console.log(`Terminated process ${task.childProcess.pid} on Windows`);
          
          // 方法2：尝试查找并终止所有与apt-mirror相关的进程
          try {
            // 查找所有apt-mirror进程
            const wmicResult = execSync(`wmic process where "CommandLine like '%apt-mirror%'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 跳过标题行
              const pid = lines[i].trim();
              if (pid) {
                try {
                  execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
                  console.log(`Terminated apt-mirror process ${pid} on Windows`);
                } catch (e) {
                  console.error(`Failed to terminate apt-mirror process ${pid}:`, e.message);
                }
              }
            }
          } catch (e) {
            console.error('Failed to get apt-mirror processes:', e.message);
          }
          
          // 方法3：尝试查找并终止所有wget进程（apt-mirror使用wget下载）
          try {
            const wmicResult = execSync(`wmic process where "Name='wget.exe'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 跳过标题行
              const pid = lines[i].trim();
              if (pid) {
                try {
                  execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
                  console.log(`Terminated wget process ${pid} on Windows`);
                } catch (e) {
                  console.error(`Failed to terminate wget process ${pid}:`, e.message);
                }
              }
            }
          } catch (e) {
            console.error('Failed to get wget processes:', e.message);
          }
        } else {
          // 在Linux/Unix系统上使用更有效的方法终止进程及其所有相关进程
          const { execSync } = require('child_process');
          
          // 方法1：终止主进程
          task.childProcess.kill('SIGTERM');
          console.log(`Terminated process ${task.childProcess.pid} with SIGTERM`);
          
          // 方法2：使用pstree命令获取所有子进程（包括多层级）
          try {
            const pstreeResult = execSync(`pstree -p ${task.childProcess.pid}`, { encoding: 'utf8' });
            // 提取所有PID
            const pidMatches = pstreeResult.match(/\((\d+)\)/g);
            if (pidMatches) {
              const pids = pidMatches.map(match => match.replace(/[()]/g, '')).filter(pid => pid !== task.childProcess.pid.toString());
              pids.forEach(pid => {
                try {
                  process.kill(parseInt(pid), 'SIGTERM');
                  console.log(`Terminated child process ${pid} on Linux`);
                } catch (e) {
                  console.error(`Failed to terminate child process ${pid}:`, e.message);
                }
              });
            }
          } catch (e) {
            console.error('Failed to get child processes with pstree:', e.message);
            
            // 备选方法：使用ps命令递归获取所有子进程
            try {
              const psResult = execSync(`ps -ef | grep -E "^.*\s+${task.childProcess.pid}\s+" | awk '{print $2}'`, { encoding: 'utf8' });
              const pids = psResult.trim().split('\n').filter(pid => pid);
              pids.forEach(pid => {
                try {
                  process.kill(parseInt(pid), 'SIGTERM');
                  console.log(`Terminated child process ${pid} on Linux`);
                } catch (e2) {
                  console.error(`Failed to terminate child process ${pid}:`, e2.message);
                }
              });
            } catch (e2) {
              console.error('Failed to get child processes with ps:', e2.message);
            }
          }
          
          // 方法3：尝试查找并终止所有与apt-mirror相关的进程
          try {
            const psResult = execSync(`ps -ef | grep -i apt-mirror | grep -v grep | awk '{print $2}'`, { encoding: 'utf8' });
            const pids = psResult.trim().split('\n').filter(pid => pid);
            pids.forEach(pid => {
              try {
                process.kill(parseInt(pid), 'SIGTERM');
                console.log(`Terminated apt-mirror process ${pid} on Linux`);
              } catch (e) {
                console.error(`Failed to terminate apt-mirror process ${pid}:`, e.message);
              }
            });
          } catch (e) {
            console.error('Failed to get apt-mirror processes:', e.message);
          }
          
          // 方法4：尝试查找并终止所有wget进程（apt-mirror使用wget下载）
          try {
            const psResult = execSync(`ps -ef | grep -i wget | grep -v grep | awk '{print $2}'`, { encoding: 'utf8' });
            const pids = psResult.trim().split('\n').filter(pid => pid);
            pids.forEach(pid => {
              try {
                process.kill(parseInt(pid), 'SIGTERM');
                console.log(`Terminated wget process ${pid} on Linux`);
              } catch (e) {
                console.error(`Failed to terminate wget process ${pid}:`, e.message);
              }
            });
          } catch (e) {
            console.error('Failed to get wget processes:', e.message);
          }
        }
      } catch (error) {
        console.error('Failed to terminate process:', error.message);
      }
    }
    
    task.status = 'canceled';
    task.endTime = new Date().toISOString();
    saveSyncTasks();
    
    res.json({
      success: true,
      message: 'Task canceled successfully',
      taskId
    });
  } catch (error) {
    console.error('Failed to cancel task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Repository root directory: ${reposRootDir}`);
  console.log(`Uploads directory: ${uploadsDir}`);
  console.log(`Mirror configs directory: ${mirrorConfigDir}`);
  console.log(`Mirror syncs directory: ${mirrorSyncDir}`);
  console.log(`Mirror logs directory: ${mirrorLogDir}`);
  console.log(`Access the application at: http://localhost:${PORT}`);
});