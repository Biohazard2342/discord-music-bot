// 빌드: ① 헤드리스 봇(headless.js) → bot.exe(esbuild 번들 → pkg) + ffmpeg/yt-dlp/davey 사이드카
//       ② C# WinForms UI → YJ-MusicBot.exe (dotnet publish)
// 결과: dist/YJ-MusicBot/ { YJ-MusicBot.exe, bot/ { bot.exe, ffmpeg.exe, yt-dlp.exe, node_modules/... } }
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const appDir = path.join(dist, 'YJ-MusicBot');
const botDir = path.join(appDir, 'bot');
const bundle = path.join(dist, 'bot-bundle.cjs');

const NATIVE_EXTERNALS = ['@snazzah/davey', '@snazzah/davey-win32-x64-msvc'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(botDir, { recursive: true });

// ① 봇: ESM → 단일 CJS 번들
console.log('[1/5] 봇 번들링 (esbuild)...');
await build({
  entryPoints: [path.join(root, 'headless.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundle,
  external: ['zlib-sync', 'bufferutil', 'utf-8-validate', ...NATIVE_EXTERNALS],
  // CJS 로 만들면 import.meta.url 이 undefined 가 되어 일부 의존성의
  // createRequire(import.meta.url) 가 크래시한다 → 실제 파일 URL 로 주입.
  define: { 'import.meta.url': '__IMPORT_META_URL__' },
  banner: { js: "const __IMPORT_META_URL__ = require('url').pathToFileURL(__filename).href;" },
  logLevel: 'error',
});

// ② 번들 → bot.exe
console.log('[2/5] 봇 exe 생성 (pkg)...');
const pkgBin = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');
execFileSync(
  process.execPath,
  [pkgBin, bundle, '--targets', 'node22-win-x64', '--output', path.join(botDir, 'bot.exe')],
  { stdio: 'inherit' },
);

// ③ 네이티브 바이너리 + davey 사이드카
console.log('[3/5] ffmpeg / yt-dlp / davey 복사...');
fs.copyFileSync(require('ffmpeg-static'), path.join(botDir, 'ffmpeg.exe'));
fs.copyFileSync(require('youtube-dl-exec').constants.YOUTUBE_DL_PATH, path.join(botDir, 'yt-dlp.exe'));
for (const mod of NATIVE_EXTERNALS) {
  const src = path.join(root, 'node_modules', ...mod.split('/'));
  if (fs.existsSync(src)) fs.cpSync(src, path.join(botDir, 'node_modules', ...mod.split('/')), { recursive: true });
}

// ④ C# UI → appDir 로 직접 publish (프레임워크 의존, .NET 8 데스크톱 런타임 필요)
console.log('[4/5] C# UI 빌드 (dotnet publish)...');
execFileSync(
  'dotnet',
  ['publish', path.join(root, 'ui', 'YJMusicBot.csproj'), '-c', 'Release', '-o', appDir],
  { stdio: 'inherit', shell: true },
);

// ⑤ 정리
console.log('[5/5] 정리...');
fs.rmSync(bundle, { force: true });
const mb = (p) => (fs.statSync(p).size / 1048576).toFixed(0);
console.log(`\n완료 → ${appDir}`);
console.log(`  YJMusicBot.exe (네이티브 창) + bot/bot.exe (${mb(path.join(botDir, 'bot.exe'))}MB) + ffmpeg + yt-dlp`);
