const fs = require('fs');

// 读取文件内容
const filePath = 'public/index.html';
const content = fs.readFileSync(filePath, 'utf8');

// 修复乱码字符
const fixedContent = content
  .replace(/[�?]/g, '')
  .replace(/鍖呯/ig, '包管理')
  .replace(/浠诲姟/ig, '任务')
  .replace(/鐘舵€?/ig, '状态')
  .replace(/澶勭悊/ig, '处理')
  .replace(/涓婁紶/ig, '上传')
  .replace(/杞崲/ig, '替换')
  .replace(/鏂囦欢/ig, '文件')
  .replace(/鐩稿悓/ig, '相同')
  .replace(/涓嶅悓/ig, '不同')
  .replace(/鐗堟湰/ig, '版本')
  .replace(/澶勭悊/ig, '处理')
  .replace(/鏃犳/ig, '无')
  .replace(/璁℃暟/ig, '数量')
  .replace(/閲忓寲/ig, '量化')
  .replace(/淇℃伅/ig, '信息')
  .replace(/鍧楁ā鍨嬪瓨鍌ㄥ潡/ig, '架构存储区')
  .replace(/鏂囨。/ig, '文件')
  .replace(/鐢ㄦ埛/ig, '用户')
  .replace(/鎻愬彇/ig, '提取')
  .replace(/鍏冩暟/ig, '参数')
  .replace(/璁℃暟/ig, '数据');

// 写入修复后的内容
fs.writeFileSync(filePath, fixedContent);

console.log('修复完成！');
