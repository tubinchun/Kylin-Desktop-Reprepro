const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { execSync, exec } = require('child_process');
const schedule = require('node-schedule');
const cron = require('cron');

// 鏂板锛歛pt-mirror閰嶇疆鐩綍
const mirrorConfigDir = path.join(__dirname, 'mirror-configs');
const mirrorSyncDir = path.join(__dirname, 'mirror-syncs');
const mirrorLogDir = path.join(__dirname, 'mirror-logs');

fs.ensureDirSync(mirrorConfigDir);
fs.ensureDirSync(mirrorSyncDir);
fs.ensureDirSync(mirrorLogDir);

const app = express();
const PORT = process.env.PORT || 3000;

// 閰嶇疆涓棿浠讹紙蹇呴』鍦ㄨ矾鐢变箣鍓嶏級
app.use(express.static('public'));
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads');
const reposRootDir = path.join(__dirname, 'repos');

fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(reposRootDir);

// 榛樿浠撳簱鍚嶇О
const DEFAULT_REPO_NAME = 'default';

// 鍒濆鍖栭粯璁や粨搴?function initializeDefaultRepo() {
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
Description: Kylin Desktop 鍖呯鐞嗕粨搴?`);
  }
  
  if (!fs.existsSync(optionsPath)) {
    fs.writeFileSync(optionsPath, `verbose
basedir .
`);
  }
  
  // 绉婚櫎SignWith閰嶇疆鏉ュ畬鍏ㄧ鐢ㄧ鍚?  let distributionsContent = fs.readFileSync(distributionsPath, 'utf8');
  distributionsContent = distributionsContent.replace(/SignWith:.*\n/g, '');
  fs.writeFileSync(distributionsPath, distributionsContent);
  console.log('Removed SignWith configuration to disable signing');
  
  console.log(`Default repository initialized at: ${defaultRepoDir}`);
}

// 鍒濆鍖栭粯璁や粨搴?initializeDefaultRepo();

// 鑾峰彇浠撳簱鐩綍
function getRepoDir(repoName) {
  return path.join(reposRootDir, repoName || DEFAULT_REPO_NAME);
}

// 璇诲彇浠撳簱鐨刢odename
function getRepoCodename(repoName) {
  try {
    const repoDir = getRepoDir(repoName);
    const distributionsPath = path.join(repoDir, 'conf', 'distributions');
    
    if (!fs.existsSync(distributionsPath)) {
      return 'focal'; // 榛樿鍊?    }
    
    const content = fs.readFileSync(distributionsPath, 'utf8');
    const codenameMatch = content.match(/Codename:\s*(\w+)/i);
    return codenameMatch ? codenameMatch[1] : 'focal';
  } catch (error) {
    console.warn('Error reading repo codename:', error.message);
    return 'focal'; // 鍑洪敊鏃惰繑鍥為粯璁ゅ€?  }
}

// 鐢熸垚GPG瀵嗛挜
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
    
    // 妫€鏌pg鍛戒护鏄惁瀛樺湪
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
    
    // 瀵煎嚭鍏挜
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

// 绛惧悕浠撳簱
function signRepository(repoName = DEFAULT_REPO_NAME) {
  try {
    console.log(`Signing repository: ${repoName}`);
    
    const repoDir = getRepoDir(repoName);
    
    // 妫€鏌pg鍛戒护鏄惁瀛樺湪
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
    // 绛惧悕澶辫触涓嶆姏鍑哄紓甯革紝鍏佽缁х画鎿嶄綔
  }
}

// 鍒涘缓鏂颁粨搴?function createRepository(repoName, codename = 'focal') {
  try {
    console.log(`Creating new repository: ${repoName} with codename: ${codename}`);
    
    const repoDir = getRepoDir(repoName);
    const confDir = path.join(repoDir, 'conf');
    
    fs.ensureDirSync(repoDir);
    fs.ensureDirSync(confDir);
    
    const distributionsPath = path.join(confDir, 'distributions');
    const optionsPath = path.join(confDir, 'options');
    
    fs.writeFileSync(distributionsPath, `Origin: Kylin Desktop
Label: Kylin Desktop
Codename: ${codename}
Architectures: amd64 i386 arm64 loongarch64 source
Components: main
Description: Kylin Desktop 鍖呯鐞嗕粨搴?- ${repoName}
`);
    
    fs.writeFileSync(optionsPath, `verbose
basedir .
`);
    
    // 涓嶆坊鍔燬ignWith閰嶇疆鏉ョ鐢ㄧ鍚?    console.log('Repository created without signing configuration');
    
    console.log(`Repository ${repoName} created successfully`);
    return repoDir;
  } catch (error) {
    console.error(`Failed to create repository ${repoName}:`, error.message);
    throw error;
  }
}

// 鑾峰彇鎵€鏈変粨搴撳垪琛?function getRepositories() {
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

// 鍒犻櫎浠撳簱
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

// 鍒濆鍖栭粯璁や粨搴撶鍚?console.log('Initializing GPG signing for default repository...');
generateGpgKey(DEFAULT_REPO_NAME);
signRepository(DEFAULT_REPO_NAME);
console.log('Repository initialization completed');

// 浠撳簱绠＄悊API
app.get('/repos', (req, res) => {
  try {
    const repos = getRepositories();
    res.json({
      success: true,
      repositories: repos
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
    // 杩囨护鏂囦欢鍚嶄腑鐨勭壒娈婂瓧绗︼紝閬垮厤shell璇硶閿欒
    const safeFilename = file.originalname.replace(/[()]/g, '_');
    cb(null, Date.now() + '-' + safeFilename);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    // 妫€鏌ユ枃浠舵墿灞曞悕锛屽拷鐣ュぇ灏忓啓
    const isDebFile = file.originalname.toLowerCase().endsWith('.deb');
    
    // 妫€鏌ユ枃浠禡IME绫诲瀷
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

// 浠撳簱璁块棶璺敱锛堟敮鎸佸浠撳簱锛?app.get('/repo/:repoName?', (req, res) => {
  const repoName = req.params.repoName || DEFAULT_REPO_NAME;
  const repoDir = getRepoDir(repoName);
  
  if (!fs.existsSync(repoDir)) {
    return res.status(404).send(`Repository ${repoName} not found`);
  }
  
  res.send(`
    <h1>Kylin Desktop 鍖呯鐞嗕粨搴?/h1>
    <p>浠撳簱鍚嶇О: <code>${repoName}</code></p>
    <p>浠撳簱鍦板潃: <code>http://${req.headers.host}/repo/${repoName}</code></p>
    <h2>鐩綍鍒楄〃</h2>
    <ul>
      <li><a href="/repo/${repoName}/dists">dists/</a> - 鍖呯储寮?/li>
      <li><a href="/repo/${repoName}/pool">pool/</a> - 鍖呮枃浠?/li>
    </ul>
    <h2>浣跨敤鏂规硶</h2>
    <pre>
# 娣诲姞浠撳簱婧愶紙鏃犻渶瀵煎叆鍏挜锛?echo "deb [trusted=yes] http://${req.headers.host}/repo/${repoName} ${getRepoCodename(repoName)} main" | sudo tee -a /etc/apt/sources.list

# 鏇存柊鍖呭垪琛?sudo apt update

# 瀹夎鍖?sudo apt install package-name
    </pre>
  `);
});

// 鍏挜涓嬭浇璺敱锛堟敮鎸佸浠撳簱锛?app.get('/repo/:repoName/public.key', (req, res) => {
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

// 浠撳簱鏂囦欢璁块棶璺敱锛堟敮鎸佸浠撳簱锛?app.get('/repo/:repoName/:path(*)', (req, res) => {
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
        let html = `<h1>Kylin Desktop 鍖呯鐞?- 鐩綍鍒楄〃: ${baseUrl}</h1>`;
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
      // 澶勭悊鏂囦欢涓嬭浇锛屾敮鎸佽寖鍥磋姹?      res.sendFile(fullPath, {
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

// 鍒犻櫎鍖呯殑API锛堟敮鎸佸浠撳簱锛?app.delete('/packages/:packageName', (req, res) => {
  try {
    const packageName = req.params.packageName;
    const repoName = req.query.repo || DEFAULT_REPO_NAME;
    let architecture = req.query.architecture || 'all';
    
    // 楠岃瘉鍖呭悕鏈夋晥鎬?    if (!packageName || packageName === 'unknown') {
      console.warn('Invalid package name:', packageName);
      return res.status(400).json({ error: 'Invalid package name' });
    }
    
    // 浠庢牸寮?"focal|main|amd64:" 涓彁鍙栨灦鏋勪俊鎭?    if (architecture.includes('|')) {
      const parts = architecture.split('|');
      architecture = parts[2]?.replace(':', '') || 'all';
    }
    
    // 楠岃瘉鏋舵瀯鍙傛暟鏄惁鏈夋晥
    const validArchitectures = ['all', 'amd64', 'i386', 'arm64', 'loongarch64', 'source'];
    if (!validArchitectures.includes(architecture)) {
      console.warn('Invalid architecture:', architecture);
      architecture = 'all'; // 浣跨敤榛樿鏋舵瀯
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
    
    // 閲嶆柊绛惧悕浠撳簱
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
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const repoName = req.body.repo || DEFAULT_REPO_NAME;
    const repoDir = getRepoDir(repoName);
    
    if (!fs.existsSync(repoDir)) {
      return res.status(404).json({ error: `Repository ${repoName} not found` });
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
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      message: `${req.files.length} files processed for repository ${repoName}`,
      results: results
    });
  } catch (error) {
    console.error('Error processing deb files:', error);
    res.status(500).json({ error: error.message });
  }
});

function processDebFile(debFilePath, repoDir, repoName) {
  try {
    process.chdir(repoDir);
    
    const codename = getRepoCodename(repoName);
    const command = `reprepro --priority=optional --ignore=forbiddenchar --component=main --section=utils includedeb ${codename} ${debFilePath}`;
    console.log(`Running: ${command}`);
    
    execSync(command, { stdio: 'inherit' });
    
    console.log(`Deb package successfully added to repository ${repoName}`);
    
    // 閲嶆柊绛惧悕浠撳簱
    try {
      signRepository(repoName);
    } catch (signError) {
      console.warn(`Warning: Failed to sign repository ${repoName}:`, signError.message);
      // 绛惧悕澶辫触涓嶅奖鍝嶅寘娣诲姞
    }
  } catch (error) {
    console.error('Failed to add deb package:', error.message);
    throw error;
  } finally {
    process.chdir(__dirname);
    fs.unlinkSync(debFilePath);
  }
}

app.get('/packages', (req, res) => {
  try {
    const repoName = req.query.repo || DEFAULT_REPO_NAME;
    const repoDir = getRepoDir(repoName);
    
    if (!fs.existsSync(repoDir)) {
      return res.status(404).json({ error: `Repository ${repoName} not found` });
    }
    
    process.chdir(repoDir);
    
    const codename = getRepoCodename(repoName);
    const command = `reprepro list ${codename}`;
    const result = execSync(command, { encoding: 'utf8' });
    
    const allPackages = result.trim().split('\n').filter(line => line.trim() !== '').map(line => {
      const parts = line.split(' ');
      // reprepro list 杈撳嚭鏍煎紡: focal|main|amd64: package-name version
      const packageInfo = parts[0]; // focal|main|amd64:
      const packageName = parts[1];
      const version = parts[2];
      
      // 浠?focal|main|amd64: 涓彁鍙栨灦鏋勪俊鎭紝娣诲姞閿欒澶勭悊
      let architecture = 'all';
      try {
        architecture = packageInfo.split('|')[2]?.replace(':', '') || 'all';
      } catch (error) {
        console.warn('Error parsing architecture from line:', line);
        return null;
      }
      
      // 杩囨护鏃犳晥鐨勫寘鏉＄洰
      if (!packageName || packageName === 'unknown' || !version) {
        console.warn('Skipping invalid package entry:', line);
        return null;
      }
      
      return {
        package: packageName,
        version: version,
        architecture: architecture,
        repo: repoName
      };
    }).filter(Boolean);
    
    // 鍒嗛〉澶勭悊
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedPackages = allPackages.slice(startIndex, endIndex);
    
    res.json({ 
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

// 鏂板锛歛pt-mirror閰嶇疆绠＄悊
function createMirrorConfig(config) {
  try {
    const { name, url, codename, components, architectures, bandwidth, syncPath, schedule } = config;
    
    const configPath = path.join(mirrorConfigDir, `${name}.conf`);
    const syncDir = path.join(mirrorSyncDir, name);
    
    fs.ensureDirSync(syncDir);
    
    // 澶勭悊URL鏍煎紡锛岀‘淇濇牸寮忔纭?    let processedUrl = url;
    // 绉婚櫎URL涓殑閲嶅鏂滄潬
    const urlParts = processedUrl.split('://');
    if (urlParts.length === 2) {
      const protocol = urlParts[0] + '://';
      const rest = urlParts[1].replace(/\/+/g, '/');
      processedUrl = protocol + rest;
    } else {
      processedUrl = processedUrl.replace(/\/+/g, '/');
    }
    // 纭繚URL浠ユ枩鏉犵粨灏?    if (processedUrl && !processedUrl.endsWith('/')) {
      processedUrl += '/';
    }
    
    // 璋冭瘯锛氭墦鍗板鐞嗗悗鐨刄RL
    console.log(`Original URL: ${url}`);
    console.log(`Processed URL: ${processedUrl}`);
    
    // 纭繚URL鏍煎紡瀹屽叏姝ｇ‘
    let finalUrl = processedUrl;
    // 纭繚URL鍖呭惈鍗忚
    if (!finalUrl.includes('://')) {
      finalUrl = 'http://' + finalUrl;
    }
    // 鍐嶆纭繚娌℃湁閲嶅鏂滄潬
    const finalUrlParts = finalUrl.split('://');
    if (finalUrlParts.length === 2) {
      const protocol = finalUrlParts[0] + '://';
      const rest = finalUrlParts[1].replace(/\/+/g, '/');
      finalUrl = protocol + rest;
    }
    // 纭繚URL浠ユ枩鏉犵粨灏?    if (!finalUrl.endsWith('/')) {
      finalUrl += '/';
    }
    
    // 璋冭瘯锛氭墦鍗版渶缁圲RL
    console.log(`Final URL: ${finalUrl}`);
    
    const configContent = `
set base_path ${syncDir}
set mirror_path ${syncDir}/mirror
set skel_path ${syncDir}/skel
set var_path ${syncDir}/var
set cleanscript ${syncDir}/clean.sh
set defaultarch ${architectures[0] || 'amd64'}
set postmirror_script ${syncDir}/postmirror.sh
set run_postmirror 0
set nthreads 4
set _tilde 0
set timeout 120
set retries 2
set no_check_certificate 1

${bandwidth ? `set limit_rate ${bandwidth}` : ''}

deb ${finalUrl} ${codename} ${components.join(' ')}
deb-src ${finalUrl} ${codename} ${components.join(' ')}

`;
    
    fs.writeFileSync(configPath, configContent);
    
    // 璁剧疆瀹氭椂浠诲姟
    if (schedule) {
      setScheduledSync(name, schedule);
    }
    
    return {
      success: true,
      message: `Mirror configuration ${name} created successfully`,
      config: {
        name,
        url,
        codename,
        components,
        architectures,
        bandwidth,
        syncPath: syncDir,
        schedule
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

// 鏂板锛氬悓姝ヤ换鍔＄姸鎬佺鐞?const syncTasksFile = path.join(__dirname, 'sync-tasks.json');
let syncTasks = {};

// 鍔犺浇淇濆瓨鐨勪换鍔＄姸鎬?function loadSyncTasks() {
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

// 淇濆瓨浠诲姟鐘舵€佸埌纾佺洏
function saveSyncTasks() {
  try {
    fs.writeFileSync(syncTasksFile, JSON.stringify(syncTasks, null, 2));
    console.log(`Saved ${Object.keys(syncTasks).length} sync tasks to disk`);
  } catch (error) {
    console.error('Failed to save sync tasks:', error.message);
  }
}

// 鍔犺浇浠诲姟鐘舵€?loadSyncTasks();

// 鏂板锛氭墽琛宎pt-mirror鍚屾
function runMirrorSync(configName) {
  return new Promise((resolve, reject) => {
    try {
      const configPath = path.join(mirrorConfigDir, `${configName}.conf`);
      const logPath = path.join(mirrorLogDir, `${configName}-${Date.now()}.log`);
      
      if (!fs.existsSync(configPath)) {
        reject(new Error(`Mirror configuration ${configName} not found`));
        return;
      }
      
      // 鐢熸垚浠诲姟ID
      const taskId = `${configName}-${Date.now()}`;
      
      // 鍒濆鍖栦换鍔＄姸鎬?      syncTasks[taskId] = {
        id: taskId,
        configName,
        status: 'running',
        progress: 0,
        logPath,
        startTime: new Date().toISOString()
      };
      
      // 淇濆瓨浠诲姟鐘舵€佸埌纾佺洏
      saveSyncTasks();
      
      const command = `apt-mirror ${configPath} > ${logPath} 2>&1`;
      console.log(`Running mirror sync: ${command}`);
      
      // 鍚姩鍚庡彴杩涚▼
      const child = exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Mirror sync failed: ${error.message}`);
          console.error(`Command stdout: ${stdout}`);
          console.error(`Command stderr: ${stderr}`);
          
          // 璇诲彇鏃ュ織鏂囦欢鑾峰彇鏇村閿欒淇℃伅
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
          
          // 淇濆瓨浠诲姟鐘舵€佸埌纾佺洏
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
          
          // 淇濆瓨浠诲姟鐘舵€佸埌纾佺洏
          saveSyncTasks();
          
          // 鍚屾瀹屾垚鍚庯紝灏嗗悓姝ョ殑鍐呭娣诲姞鍒颁粨搴撶鐞嗕腑
          try {
            const syncDir = path.join(mirrorSyncDir, configName);
            const mirrorDir = path.join(syncDir, 'mirror');
            
            // 妫€鏌ュ悓姝ョ洰褰曟槸鍚﹀瓨鍦?            if (fs.existsSync(mirrorDir)) {
              // 鍒涘缓鏂扮殑浠撳簱
              const repoName = configName;
              createRepository(repoName);
              
              // 鑾峰彇浠撳簱鐩綍
              const repoDir = getRepoDir(repoName);
              
              // 澶嶅埗鍚屾鐨勫唴瀹瑰埌浠撳簱鐩綍
              const mirrorContents = fs.readdirSync(mirrorDir);
              mirrorContents.forEach(item => {
                const sourcePath = path.join(mirrorDir, item);
                const targetPath = path.join(repoDir, item);
                
                if (fs.statSync(sourcePath).isDirectory()) {
                  fs.copySync(sourcePath, targetPath, { overwrite: true });
                }
              });
              
              console.log(`Mirror sync content added to repository: ${repoName}`);
            }
          } catch (repoError) {
            console.error('Failed to add mirror sync to repository:', repoError.message);
            // 涓嶅奖鍝嶅悓姝ョ粨鏋滐紝缁х画杩斿洖鎴愬姛
          }
          
          resolve({
            success: true,
            message: `Mirror sync completed successfully`,
            logPath,
            taskId
          });
        }
      });
      
      // 淇濆瓨child杩涚▼寮曠敤鍒颁换鍔＄姸鎬佷腑
      syncTasks[taskId].childProcess = child;
      
      // 瀹氭湡鏇存柊杩涘害锛堥€氳繃璇诲彇鏃ュ織鏂囦欢鍜岀粺璁＄洰褰曞ぇ灏忥級
      const progressInterval = setInterval(() => {
        if (syncTasks[taskId] && (syncTasks[taskId].status === 'running' || syncTasks[taskId].status === 'paused')) {
          try {
            // 瑙ｆ瀽鏃ュ織鏂囦欢锛岃绠楄繘搴?            let progress = syncTasks[taskId].progress;
            let hasProgressUpdate = false;
            
            // 璇诲彇鏃ュ織鏂囦欢
            if (fs.existsSync(logPath)) {
              const logContent = fs.readFileSync(logPath, 'utf8');
              
              // 妫€鏌ユ槸鍚﹀紑濮嬩笅杞界储寮曟枃浠?              if (logContent.includes('Downloading index files')) {
                progress = 10;
                hasProgressUpdate = true;
              }
              
              // 妫€鏌ユ槸鍚﹀紑濮嬩笅杞藉寘鏂囦欢
              if (logContent.includes('Downloading packages')) {
                progress = 30;
                hasProgressUpdate = true;
              }
              
              // 鎻愬彇鎬讳笅杞藉ぇ灏?              const totalSizeMatch = logContent.match(/([\d.]+)\s*GiB will be downloaded/);
              if (totalSizeMatch) {
                const totalSize = parseFloat(totalSizeMatch[1]);
                syncTasks[taskId].totalSize = totalSize;
                console.log(`Total download size: ${totalSize} GiB`);
              }
              
              // 妫€鏌ユ槸鍚﹀紑濮嬫竻鐞?              if (logContent.includes('Cleaning up')) {
                progress = 80;
                hasProgressUpdate = true;
              }
              
              // 妫€鏌ユ槸鍚﹀畬鎴?              if (logContent.includes('End time:')) {
                progress = 95;
                hasProgressUpdate = true;
              }
              
              // 妫€鏌ユ槸鍚︽湁閿欒
              if (logContent.includes('error') || logContent.includes('failed') || logContent.includes('Error')) {
                console.error('Mirror sync error detected in log');
                // 涓嶇珛鍗冲け璐ワ紝缁х画瑙傚療
              }
              
              // 濡傛灉鏈夋€讳笅杞藉ぇ灏忥紝浣跨敤du鍛戒护缁熻宸蹭笅杞藉ぇ灏?              if (syncTasks[taskId].totalSize) {
                try {
                  const syncDir = path.join(mirrorSyncDir, configName);
                  if (fs.existsSync(syncDir)) {
                    // 浣跨敤du鍛戒护缁熻鐩綍澶у皬
                    const duResult = execSync(`du -sh ${syncDir}`, { encoding: 'utf8' });
                    const sizeMatch = duResult.match(/([\d.]+)([GM])/);
                    if (sizeMatch) {
                      let downloadedSize = parseFloat(sizeMatch[1]);
                      const unit = sizeMatch[2];
                      
                      // 杞崲涓篏iB
                      if (unit === 'M') {
                        downloadedSize = downloadedSize / 1024;
                      }
                      
                      const totalSize = syncTasks[taskId].totalSize;
                      if (totalSize > 0) {
                        // 璁＄畻瀹為檯杩涘害鐧惧垎姣旓紙0-100%锛?                        const actualProgress = (downloadedSize / totalSize) * 100;
                        // 灏嗗疄闄呰繘搴︽槧灏勫埌30-95%涔嬮棿锛堜笅杞介樁娈碉級
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
                  // 缁х画浣跨敤鍏朵粬鏂规硶璁＄畻杩涘害
                }
              }
              
              // 鎻愬彇宸蹭笅杞藉ぇ灏忥紙濡傛灉apt-mirror杈撳嚭涓寘鍚級
              const downloadedMatch = logContent.match(/Downloaded\s+([\d.]+)\s*GiB/);
              if (downloadedMatch && syncTasks[taskId].totalSize && !hasProgressUpdate) {
                const downloadedSize = parseFloat(downloadedMatch[1]);
                const totalSize = syncTasks[taskId].totalSize;
                const calculatedProgress = Math.min((downloadedSize / totalSize) * 70 + 30, 95); // 30-95% 鏄笅杞介樁娈?                progress = calculatedProgress;
                hasProgressUpdate = true;
                syncTasks[taskId].downloadedSize = downloadedSize;
                console.log(`Downloaded: ${downloadedSize} GiB, Total: ${totalSize} GiB, Progress: ${progress.toFixed(2)}%`);
              }
            }
            
            // 濡傛灉浠诲姟姝ｅ湪杩愯锛屼笖娌℃湁浠庢棩蹇椾腑鏇存柊杩涘害锛屼娇鐢ㄦā鎷熻繘搴?            if (syncTasks[taskId].status === 'running' && !hasProgressUpdate) {
              progress = Math.min(progress + Math.random() * 2, 95);
            }
            
            // 鏇存柊杩涘害
            syncTasks[taskId].progress = progress;
            
            // 淇濆瓨浠诲姟鐘舵€佸埌纾佺洏
            saveSyncTasks();
          } catch (error) {
            console.error('Failed to read log file:', error.message);
            // 濡傛灉璇诲彇鏃ュ織澶辫触锛屼笖浠诲姟姝ｅ湪杩愯锛岀户缁娇鐢ㄦā鎷熻繘搴?            if (syncTasks[taskId].status === 'running') {
              syncTasks[taskId].progress = Math.min(syncTasks[taskId].progress + Math.random() * 2, 95);
            }
            saveSyncTasks();
          }
        } else if (syncTasks[taskId] && (syncTasks[taskId].status === 'completed' || syncTasks[taskId].status === 'failed')) {
          clearInterval(progressInterval);
        }
      }, 5000);
      
      // 娣诲姞浠诲姟瓒呮椂鏈哄埗
      const timeoutId = setTimeout(() => {
        if (syncTasks[taskId] && syncTasks[taskId].status === 'running') {
          console.error('Mirror sync timeout after 30 minutes');
          syncTasks[taskId].status = 'failed';
          syncTasks[taskId].error = 'Sync operation timed out after 30 minutes';
          syncTasks[taskId].endTime = new Date().toISOString();
          
          // 灏濊瘯缁堟瀛愯繘绋?          try {
            child.kill('SIGTERM');
            console.log('Sync process terminated due to timeout');
          } catch (killError) {
            console.error('Failed to kill sync process:', killError.message);
          }
          
          resolve({
            success: false,
            error: 'Sync operation timed out after 30 minutes',
            taskId
          });
        }
      }, 30 * 60 * 1000); // 30鍒嗛挓瓒呮椂
      
      // 娓呴櫎瓒呮椂瀹氭椂鍣?      child.on('exit', () => {
        clearTimeout(timeoutId);
      });
      
    } catch (error) {
      console.error('Failed to run mirror sync:', error.message);
      reject(error);
    }
  });
}

// 鏂板锛氳幏鍙栧悓姝ヤ换鍔＄姸鎬?function getSyncTaskStatus(taskId) {
  const task = syncTasks[taskId] || null;
  if (task) {
    // 纭繚杩斿洖鎵€鏈夊繀瑕佺殑淇℃伅
    return {
      ...task,
      totalSize: task.totalSize || 0,
      downloadedSize: task.downloadedSize || 0
    };
  }
  return null;
}

// 鏂板锛氳幏鍙栨墍鏈夊悓姝ヤ换鍔?function getAllSyncTasks() {
  return Object.values(syncTasks);
}

// 鏂板锛氳幏鍙栨墍鏈夐暅鍍忛厤缃?function getMirrorConfigs() {
  try {
    const configs = [];
    const files = fs.readdirSync(mirrorConfigDir);
    
    files.forEach(file => {
      if (file.endsWith('.conf')) {
        const configName = file.replace('.conf', '');
        const configPath = path.join(mirrorConfigDir, file);
        const content = fs.readFileSync(configPath, 'utf8');
        
        // 瑙ｆ瀽閰嶇疆鏂囦欢
        const urlMatch = content.match(/deb\s+(https?:\/\/[^\s]+)\s+/);
        const codenameMatch = content.match(/deb\s+https?:\/\/[^\s]+\s+(\w+)\s+/);
        const componentsMatch = content.match(/deb\s+https?:\/\/[^\s]+\s+\w+\s+([^\n]+)/);
        const bandwidthMatch = content.match(/set limit_rate\s+(\d+)/);
        
        configs.push({
          name: configName,
          url: urlMatch ? urlMatch[1] : '',
          codename: codenameMatch ? codenameMatch[1] : '',
          components: componentsMatch ? componentsMatch[1].split(' ').filter(Boolean) : [],
          bandwidth: bandwidthMatch ? bandwidthMatch[1] : '',
          syncPath: path.join(mirrorSyncDir, configName)
        });
      }
    });
    
    return configs;
  } catch (error) {
    console.error('Failed to get mirror configs:', error.message);
    return [];
  }
}

// 鏂板锛氬垹闄ら暅鍍忛厤缃?function deleteMirrorConfig(configName) {
  try {
    const configPath = path.join(mirrorConfigDir, `${configName}.conf`);
    const syncDir = path.join(mirrorSyncDir, configName);
    
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    
    if (fs.existsSync(syncDir)) {
      fs.removeSync(syncDir);
    }
    
    // 鍙栨秷瀹氭椂浠诲姟
    if (scheduledJobs[configName]) {
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

// 鏂板锛氬畾鏃朵换鍔＄鐞?const scheduledJobs = {}; // 瀛樺偍瀹氭椂浠诲姟锛屾牸寮? { configName: { jobId: job, ... } }
let jobIdCounter = 0;

// 鏂板锛氬垱寤哄悓姝ヤ换鍔?function createSyncTask(configName, scheduleExpression, taskName) {
  try {
    const jobId = `job_${++jobIdCounter}`;
    
    // 纭繚閰嶇疆鍚嶇О瀵瑰簲鐨勪换鍔″璞″瓨鍦?    if (!scheduledJobs[configName]) {
      scheduledJobs[configName] = {};
    }
    
    // 鍒涘缓鏂扮殑瀹氭椂浠诲姟
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

// 鏂板锛氬垹闄ゅ悓姝ヤ换鍔?function deleteSyncTask(configName, jobId) {
  try {
    if (!scheduledJobs[configName] || !scheduledJobs[configName][jobId]) {
      return {
        success: false,
        error: 'Task not found'
      };
    }
    
    // 鍙栨秷浠诲姟
    scheduledJobs[configName][jobId].job.cancel();
    
    // 鍒犻櫎浠诲姟
    delete scheduledJobs[configName][jobId];
    
    // 濡傛灉閰嶇疆娌℃湁浠诲姟浜嗭紝鍒犻櫎閰嶇疆鏉＄洰
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

// 鏂板锛氳幏鍙栧悓姝ヤ换鍔″垪琛?function getSyncTasks(configName) {
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

// 鏂板锛氳缃畾鏃跺悓姝ヤ换鍔★紙鍏煎鏃ф帴鍙ｏ級
function setScheduledSync(configName, scheduleExpression) {
  try {
    // 鍙栨秷鐜版湁鐨勪换鍔?    if (scheduledJobs[configName]) {
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
    
    // 鍒涘缓鏂扮殑瀹氭椂浠诲姟
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

// 鏂板锛歛pt-mirror API
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

app.post('/mirrors', (req, res) => {
  try {
    const config = req.body;
    
    if (!config.name || !config.url || !config.codename || !config.components || !config.architectures) {
      return res.status(400).json({ error: 'Missing required configuration parameters' });
    }
    
    const result = createMirrorConfig(config);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
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

// 鏂板锛氳幏鍙栧悓姝ヤ换鍔＄姸鎬丄PI
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

// 鏂板锛氳幏鍙栨墍鏈夊悓姝ヤ换鍔PI
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

// 鏂板锛氭殏鍋滃悓姝ヤ换鍔PI
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
    
    // 鏆傚仠浠诲姟
    if (task.childProcess) {
      try {
        const isWindows = process.platform === 'win32';
        
        if (isWindows) {
          // 鍦╓indows涓婁娇鐢ㄦ洿鏈夋晥鐨勬柟娉曟殏鍋滆繘绋嬪強鍏舵墍鏈夌浉鍏宠繘绋?          const { execSync } = require('child_process');
          
          // 鏂规硶1锛氭殏鍋滀富杩涚▼鍙婂叾鐩存帴瀛愯繘绋?          execSync(`taskkill /SUSPEND /PID ${task.childProcess.pid}`, { stdio: 'ignore' });
          console.log(`Paused process ${task.childProcess.pid} on Windows`);
          
          // 鏂规硶2锛氬皾璇曟煡鎵惧苟鏆傚仠鎵€鏈変笌apt-mirror鐩稿叧鐨勮繘绋?          try {
            // 鏌ユ壘鎵€鏈塧pt-mirror杩涚▼
            const wmicResult = execSync(`wmic process where "CommandLine like '%apt-mirror%'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 璺宠繃鏍囬琛?              const pid = lines[i].trim();
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
          
          // 鏂规硶3锛氬皾璇曟煡鎵惧苟鏆傚仠鎵€鏈墂get杩涚▼锛坅pt-mirror浣跨敤wget涓嬭浇锛?          try {
            const wmicResult = execSync(`wmic process where "Name='wget.exe'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 璺宠繃鏍囬琛?              const pid = lines[i].trim();
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
          // 鍦↙inux/Unix绯荤粺涓婁娇鐢ㄦ洿鏈夋晥鐨勬柟娉曟殏鍋滆繘绋嬪強鍏舵墍鏈夌浉鍏宠繘绋?          const { execSync } = require('child_process');
          
          // 鏂规硶1锛氭殏鍋滀富杩涚▼
          task.childProcess.kill('SIGSTOP');
          console.log(`Paused process ${task.childProcess.pid} with SIGSTOP`);
          
          // 鏂规硶2锛氫娇鐢╬stree鍛戒护鑾峰彇鎵€鏈夊瓙杩涚▼锛堝寘鎷灞傜骇锛?          try {
            const pstreeResult = execSync(`pstree -p ${task.childProcess.pid}`, { encoding: 'utf8' });
            // 鎻愬彇鎵€鏈塒ID
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
            
            // 澶囬€夋柟娉曪細浣跨敤ps鍛戒护閫掑綊鑾峰彇鎵€鏈夊瓙杩涚▼
            try {
              const psResult = execSync(`ps -ef | grep -E "^.*\s+${task.childProcess.pid}\s+" | awk '{print $2}'`, { encoding: 'utf8' });
              const pids = psResult.trim().split('\n').filter(pid => pid);
              pids.forEach(pid => {
                try {
                  process.kill(parseInt(pid), 'SIGSTOP');
                  console.log(`Paused child process ${pid} on Linux`);
                } catch (e) {
                  console.error(`Failed to pause child process ${pid}:`, e.message);
                }
              });
            } catch (e2) {
              console.error('Failed to get child processes with ps:', e2.message);
            }
          }
          
          // 鏂规硶3锛氬皾璇曟煡鎵惧苟鏆傚仠鎵€鏈変笌apt-mirror鐩稿叧鐨勮繘绋?          try {
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
          
          // 鏂规硶4锛氬皾璇曟煡鎵惧苟鏆傚仠鎵€鏈墂get杩涚▼锛坅pt-mirror浣跨敤wget涓嬭浇锛?          try {
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
          message: 'Task paused successfully'
        });
      } catch (error) {
        console.error('Failed to pause task:', error.message);
        res.status(500).json({ error: 'Failed to pause task' });
      }
    } else {
      res.status(400).json({ error: 'No process to pause' });
    }
  } catch (error) {
    console.error('Failed to pause task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氭仮澶嶅悓姝ヤ换鍔PI
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
    
    // 鎭㈠浠诲姟
    if (task.childProcess) {
      try {
        const isWindows = process.platform === 'win32';
        
        if (isWindows) {
          // 鍦╓indows涓婁娇鐢ㄦ洿鏈夋晥鐨勬柟娉曟仮澶嶈繘绋嬪強鍏舵墍鏈夌浉鍏宠繘绋?          const { execSync } = require('child_process');
          
          // 鏂规硶1锛氭仮澶嶄富杩涚▼鍙婂叾鐩存帴瀛愯繘绋?          execSync(`taskkill /RESUME /PID ${task.childProcess.pid}`, { stdio: 'ignore' });
          console.log(`Resumed process ${task.childProcess.pid} on Windows`);
          
          // 鏂规硶2锛氬皾璇曟煡鎵惧苟鎭㈠鎵€鏈変笌apt-mirror鐩稿叧鐨勮繘绋?          try {
            // 鏌ユ壘鎵€鏈塧pt-mirror杩涚▼
            const wmicResult = execSync(`wmic process where "CommandLine like '%apt-mirror%'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 璺宠繃鏍囬琛?              const pid = lines[i].trim();
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
          
          // 鏂规硶3锛氬皾璇曟煡鎵惧苟鎭㈠鎵€鏈墂get杩涚▼锛坅pt-mirror浣跨敤wget涓嬭浇锛?          try {
            const wmicResult = execSync(`wmic process where "Name='wget.exe'" get ProcessId`, { encoding: 'utf8' });
            const lines = wmicResult.trim().split('\n');
            for (let i = 1; i < lines.length; i++) { // 璺宠繃鏍囬琛?              const pid = lines[i].trim();
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
          // 鍦↙inux/Unix绯荤粺涓婁娇鐢ㄦ洿鏈夋晥鐨勬柟娉曟仮澶嶈繘绋嬪強鍏舵墍鏈夌浉鍏宠繘绋?          const { execSync } = require('child_process');
          
          // 鏂规硶1锛氭仮澶嶄富杩涚▼
          task.childProcess.kill('SIGCONT');
          console.log(`Resumed process ${task.childProcess.pid} with SIGCONT`);
          
          // 鏂规硶2锛氫娇鐢╬stree鍛戒护鑾峰彇鎵€鏈夊瓙杩涚▼锛堝寘鎷灞傜骇锛?          try {
            const pstreeResult = execSync(`pstree -p ${task.childProcess.pid}`, { encoding: 'utf8' });
            // 鎻愬彇鎵€鏈塒ID
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
            
            // 澶囬€夋柟娉曪細浣跨敤ps鍛戒护閫掑綊鑾峰彇鎵€鏈夊瓙杩涚▼
            try {
              const psResult = execSync(`ps -ef | grep -E "^.*\s+${task.childProcess.pid}\s+" | awk '{print $2}'`, { encoding: 'utf8' });
              const pids = psResult.trim().split('\n').filter(pid => pid);
              pids.forEach(pid => {
                try {
                  process.kill(parseInt(pid), 'SIGCONT');
                  console.log(`Resumed child process ${pid} on Linux`);
                } catch (e) {
                  console.error(`Failed to resume child process ${pid}:`, e.message);
                }
              });
            } catch (e2) {
              console.error('Failed to get child processes with ps:', e2.message);
            }
          }
          
          // 鏂规硶3锛氬皾璇曟煡鎵惧苟鎭㈠鎵€鏈変笌apt-mirror鐩稿叧鐨勮繘绋?          try {
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
          
          // 鏂规硶4锛氬皾璇曟煡鎵惧苟鎭㈠鎵€鏈墂get杩涚▼锛坅pt-mirror浣跨敤wget涓嬭浇锛?          try {
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
          message: 'Task resumed successfully'
        });
      } catch (error) {
        console.error('Failed to resume task:', error.message);
        res.status(500).json({ error: 'Failed to resume task' });
      }
    } else {
      res.status(400).json({ error: 'No process to resume' });
    }
  } catch (error) {
    console.error('Failed to resume task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/mirrors/:configName/logs', (req, res) => {
  try {
    const configName = req.params.configName;
    const logs = [];
    
    const files = fs.readdirSync(mirrorLogDir);
    files.forEach(file => {
      if (file.startsWith(configName)) {
        logs.push({
          filename: file,
          path: path.join(mirrorLogDir, file),
          size: fs.statSync(path.join(mirrorLogDir, file)).size,
          created: fs.statSync(path.join(mirrorLogDir, file)).birthtime
        });
      }
    });
    
    // 鎸夊垱寤烘椂闂存帓搴?    logs.sort((a, b) => b.created - a.created);
    
    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Failed to get mirror logs:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/mirrors/:configName/logs/:logFile', (req, res) => {
  try {
    const configName = req.params.configName;
    const logFile = req.params.logFile;
    const logPath = path.join(mirrorLogDir, logFile);
    
    if (!fs.existsSync(logPath)) {
      return res.status(404).json({ error: 'Log file not found' });
    }
    
    const content = fs.readFileSync(logPath, 'utf8');
    res.json({
      success: true,
      content
    });
  } catch (error) {
    console.error('Failed to read log file:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氳缃畾鏃跺悓姝ヤ换鍔PI
app.post('/mirrors/:configName/schedule', (req, res) => {
  try {
    const configName = req.params.configName;
    const { scheduleExpression } = req.body;
    
    const result = setScheduledSync(configName, scheduleExpression);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Failed to set scheduled sync:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氳幏鍙栧畾鏃朵换鍔＄姸鎬丄PI
app.get('/mirrors/:configName/schedule', (req, res) => {
  try {
    const configName = req.params.configName;
    const jobs = scheduledJobs[configName];
    
    res.json({
      success: true,
      hasScheduledJob: !!jobs,
      tasks: getSyncTasks(configName)
    });
  } catch (error) {
    console.error('Failed to get schedule status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氬垱寤哄悓姝ヤ换鍔PI
app.post('/mirrors/:configName/tasks', (req, res) => {
  try {
    const configName = req.params.configName;
    const { scheduleExpression, taskName } = req.body;
    
    if (!scheduleExpression || !taskName) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const result = createSyncTask(configName, scheduleExpression, taskName);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Failed to create sync task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氬垹闄ゅ悓姝ヤ换鍔PI
app.delete('/mirrors/:configName/tasks/:taskId', (req, res) => {
  try {
    const configName = req.params.configName;
    const taskId = req.params.taskId;
    
    const result = deleteSyncTask(configName, taskId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Failed to delete sync task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氬仠姝㈠悓姝ヤ换鍔PI
app.post('/mirrors/:configName/tasks/:taskId/stop', (req, res) => {
  try {
    const configName = req.params.configName;
    const taskId = req.params.taskId;
    
    if (!scheduledJobs[configName] || !scheduledJobs[configName][taskId]) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // 鍙栨秷浠诲姟
    scheduledJobs[configName][taskId].job.cancel();
    
    // 鏇存柊浠诲姟鐘舵€?    scheduledJobs[configName][taskId].status = 'stopped';
    
    res.json({
      success: true,
      message: `Sync task stopped for ${configName}`
    });
  } catch (error) {
    console.error('Failed to stop sync task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氬紑濮嬪悓姝ヤ换鍔PI
app.post('/mirrors/:configName/tasks/:taskId/start', (req, res) => {
  try {
    const configName = req.params.configName;
    const taskId = req.params.taskId;
    
    if (!scheduledJobs[configName] || !scheduledJobs[configName][taskId]) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const task = scheduledJobs[configName][taskId];
    
    // 閲嶆柊鍒涘缓瀹氭椂浠诲姟
    const newJob = schedule.scheduleJob(task.schedule, async () => {
      console.log(`Running scheduled sync task ${task.name} for ${configName}`);
      try {
        await runMirrorSync(configName);
        console.log(`Scheduled sync task ${task.name} completed for ${configName}`);
      } catch (error) {
        console.error(`Scheduled sync task ${task.name} failed for ${configName}:`, error.message);
      }
    });
    
    // 鏇存柊浠诲姟
    scheduledJobs[configName][taskId].job = newJob;
    scheduledJobs[configName][taskId].status = 'running';
    
    res.json({
      success: true,
      message: `Sync task started for ${configName}`
    });
  } catch (error) {
    console.error('Failed to start sync task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氳幏鍙栧悓姝ヤ换鍔″垪琛ˋPI
app.get('/mirrors/:configName/tasks', (req, res) => {
  try {
    const configName = req.params.configName;
    const tasks = getSyncTasks(configName);
    
    res.json({
      success: true,
      tasks
    });
  } catch (error) {
    console.error('Failed to get sync tasks:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氶厤缃浠紸PI
app.get('/mirrors/backup', (req, res) => {
  try {
    const backupDir = path.join(__dirname, 'backups');
    fs.ensureDirSync(backupDir);
    
    const backupFileName = `mirror-configs-${Date.now()}.json`;
    const backupPath = path.join(backupDir, backupFileName);
    
    const configs = getMirrorConfigs();
    const backupData = {
      timestamp: new Date().toISOString(),
      configs: configs
    };
    
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    
    res.download(backupPath, backupFileName, (err) => {
      if (err) {
        console.error('Failed to download backup:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  } catch (error) {
    console.error('Failed to create backup:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 鏂板锛氶厤缃仮澶岮PI
app.post('/mirrors/restore', (req, res) => {
  try {
    const { backupData } = req.body;
    
    if (!backupData || !backupData.configs) {
      return res.status(400).json({ error: 'Invalid backup data' });
    }
    
    // 鎭㈠閰嶇疆
    backupData.configs.forEach(config => {
      createMirrorConfig(config);
    });
    
    res.json({
      success: true,
      message: `Successfully restored ${backupData.configs.length} mirror configurations`
    });
  } catch (error) {
    console.error('Failed to restore backup:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});