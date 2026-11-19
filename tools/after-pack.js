'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 如果仓库根目录存在 bin/ffmpeg.exe 与 ffprobe.exe，自动打入成品包的 resources/bin/。
// 开源克隆用户本地没有 bin/ 时静默跳过，不影响正常构建。
exports.default = async function afterPack(context) {
  const root = context.packager.projectDir;
  const binSrc = path.join(root, 'bin');
  const ffmpeg = path.join(binSrc, 'ffmpeg.exe');
  const ffprobe = path.join(binSrc, 'ffprobe.exe');
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) return;

  const resources = path.join(context.appOutDir, 'resources');
  const binDst = path.join(resources, 'bin');
  fs.mkdirSync(binDst, { recursive: true });
  for (const file of fs.readdirSync(binSrc)) {
    const srcPath = path.join(binSrc, file);
    if (file.endsWith('.exe') || file.endsWith('.dll')) {
      fs.copyFileSync(srcPath, path.join(binDst, file));
    }
  }

  const noticeSrc = path.join(binSrc, 'third-party');
  if (fs.existsSync(noticeSrc)) {
    const noticeDst = path.join(resources, 'third-party', 'ffmpeg');
    fs.mkdirSync(noticeDst, { recursive: true });
    for (const file of fs.readdirSync(noticeSrc)) {
      const srcPath = path.join(noticeSrc, file);
      if (fs.statSync(srcPath).isFile()) fs.copyFileSync(srcPath, path.join(noticeDst, file));
    }
  }
  console.log('  • bundled FFmpeg from bin/ into resources/bin/');
};
