// 단일 exe 빌드:
//  ① 헤드리스 봇(headless.js) → bot.exe(esbuild→pkg) + ffmpeg/yt-dlp/davey 를 스테이징
//  ② 스테이징을 bot.zip 으로 압축 → C# 에 내장 리소스로 포함
//  ③ dotnet publish 단일파일 → dist/YJ-MusicBot.exe (딱 하나)
// 실행 시 C# 이 내장 bot.zip 을 %LOCALAPPDATA% 로 풀고 bot.exe 를 구동한다.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'bot-stage');
const pub = path.join(dist, 'pub');
const bundle = path.join(dist, 'bot-bundle.cjs');
const botZip = path.join(root, 'ui', 'Resources', 'bot.zip');
const finalExe = path.join(dist, 'YJ-MusicBot.exe');

const NATIVE_EXTERNALS = ['@snazzah/davey', '@snazzah/davey-win32-x64-msvc'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(path.dirname(botZip), { recursive: true });

// ① 봇: ESM → 단일 CJS 번들
console.log('[1/6] 봇 번들링 (esbuild)...');
await build({
  entryPoints: [path.join(root, 'headless.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundle,
  external: ['zlib-sync', 'bufferutil', 'utf-8-validate', ...NATIVE_EXTERNALS],
  define: { 'import.meta.url': '__IMPORT_META_URL__' },
  banner: { js: "const __IMPORT_META_URL__ = require('url').pathToFileURL(__filename).href;" },
  logLevel: 'error',
});

// ② 번들 → bot.exe (스테이징)
console.log('[2/6] 봇 exe 생성 (pkg)...');
const pkgBin = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');
execFileSync(process.execPath, [pkgBin, bundle, '--targets', 'node22-win-x64', '--output', path.join(stage, 'bot.exe')], { stdio: 'inherit' });

// ③ ffmpeg / yt-dlp / davey 를 스테이징에
console.log('[3/6] ffmpeg / yt-dlp / davey 복사...');
fs.copyFileSync(require('ffmpeg-static'), path.join(stage, 'ffmpeg.exe'));
fs.copyFileSync(require('youtube-dl-exec').constants.YOUTUBE_DL_PATH, path.join(stage, 'yt-dlp.exe'));
for (const mod of NATIVE_EXTERNALS) {
  const src = path.join(root, 'node_modules', ...mod.split('/'));
  if (fs.existsSync(src)) fs.cpSync(src, path.join(stage, 'node_modules', ...mod.split('/')), { recursive: true });
}

// ④ 스테이징 → bot.zip (C# 내장 리소스)
console.log('[4/6] bot.zip 압축...');
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${botZip}' -Force`], { stdio: 'inherit' });

// ⑤ C# 단일 exe publish (bot.zip 내장)
console.log('[5/6] C# 단일 exe 빌드 (dotnet publish)...');
execFileSync('dotnet', ['publish', path.join(root, 'ui', 'YJMusicBot.csproj'), '-c', 'Release', '-o', pub], { stdio: 'inherit', shell: true });
fs.copyFileSync(path.join(pub, 'YJMusicBot.exe'), finalExe);

// ⑥ 정리
console.log('[6/6] 정리...');
fs.rmSync(bundle, { force: true });
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(pub, { recursive: true, force: true });
fs.rmSync(botZip, { force: true });
const mb = (fs.statSync(finalExe).size / 1048576).toFixed(0);
console.log(`\n완료 → ${finalExe} (${mb}MB, 단일 exe)`);
