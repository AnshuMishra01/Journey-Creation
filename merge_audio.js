const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Auto-detect ffmpeg path based on operating system
function getFFmpegPath() {
  const os = require('os');
  const { execSync } = require('child_process');
  
  try {
    // Try to find ffmpeg in PATH first
    const result = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
    if (result) {
      console.log(`[merge] Found ffmpeg at: ${result}`);
      return result;
    }
  } catch (error) {
    // ffmpeg not in PATH, try common locations
  }
  
  // Common ffmpeg locations by OS
  const commonPaths = {
    'darwin': ['/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'],
    'linux': ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'],
    'win32': ['C:\\ffmpeg\\bin\\ffmpeg.exe', 'ffmpeg.exe']
  };
  
  const platform = os.platform();
  const paths = commonPaths[platform] || [];
  
  for (const ffmpegPath of paths) {
    if (fs.existsSync(ffmpegPath)) {
      console.log(`[merge] Found ffmpeg at: ${ffmpegPath}`);
      return ffmpegPath;
    }
  }
  
  // Fallback to just 'ffmpeg' and hope it's in PATH
  console.log(`[merge] Using fallback ffmpeg command`);
  return 'ffmpeg';
}

const FFMPEG_PATH = getFFmpegPath();

// Requires ffmpeg installed and in PATH
function mergeAudiosInOrder(outputDir, outFile) {
  // Get all *_lineN.mp3 files and sort strictly by N (numeric order)
  const files = fs.readdirSync(outputDir)
    .filter(f => /_line\d+\.mp3$/.test(f))
    .sort((a, b) => {
      const getNum = s => parseInt(s.match(/line(\d+)/)?.[1] || '0', 10);
      return getNum(a) - getNum(b);
    });
  if (files.length === 0) {
    console.log(`[merge] No mp3 files in ${outputDir}`);
    return;
  }
  // Write file list for ffmpeg in strict numeric order
  const listPath = path.join(outputDir, 'merge_list.txt');
  fs.writeFileSync(listPath, files.map(f => `file '${f}'`).join('\n'));
  // Merge with ffmpeg
  const cmd = `${FFMPEG_PATH} -y -f concat -safe 0 -i "${listPath}" -c copy "${outFile}"`;
  console.log(`[merge] Merging ${files.length} files in ${outputDir} to ${outFile}`);
  execSync(cmd, { cwd: outputDir, stdio: 'inherit' });
  fs.unlinkSync(listPath);
}

function mergeAllOutputs(baseDir = path.join(__dirname, 'outputs')) {
  const outputDirs = fs.readdirSync(baseDir)
    .filter(f => f.startsWith('Output-'))
    .map(f => path.join(baseDir, f));
  outputDirs.forEach(dir => {
    const outFile = path.join(dir, 'merged.mp3');
    mergeAudiosInOrder(dir, outFile);
  });
}

if (require.main === module) {
  mergeAllOutputs();
}

module.exports = {
  mergeAudiosInOrder,
  mergeAllOutputs,
  getMergedAudioFiles: function(baseDir = path.join(__dirname, 'outputs')) {
    const outputDirs = fs.readdirSync(baseDir)
      .filter(f => f.startsWith('Output-'))
      .map(f => path.join(baseDir, f));
    return outputDirs.map(dir => ({
      dir,
      mergedPath: path.join(dir, 'merged.mp3'),
      journeyName: path.basename(dir)
    }));
  }
};
