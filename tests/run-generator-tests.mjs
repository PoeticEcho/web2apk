#!/usr/bin/env node
/**
 * 생성기 매트릭스 테스트.
 *
 *   npm test            (또는 node tests/run-generator-tests.mjs)
 *
 * - 옵션 조합(전체화면/방향/줌/뒤로가기/외부링크/당겨서새로고침/색/스킴/아이콘)을 돌며
 *   capacitor.config.json · www · AndroidManifest.xml · MainActivity.java · colors/styles/strings · build.gradle
 *   이 기대대로 생성되는지 확인한다.
 * - JDK(javac)가 있으면 생성된 MainActivity.java 를 파싱 단계까지 실제로 컴파일해 문법 오류를 잡는다.
 * - XML 은 python3 로 well-formed 여부를 확인한다(없으면 건너뜀).
 */
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger } from '../scripts/lib/log.mjs';
import { capacitorConfig, patch, prepare } from '../scripts/lib/generate.mjs';
import { normalizeOptions, parseTargetUrl } from '../scripts/lib/options.mjs';
import { readPngSize } from '../scripts/lib/icon.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = path.join(repoRoot, '.tmp-tests');
const log = createLogger({ quiet: true });

const BASE = {
  url: 'https://example.com',
  app_name: '테스트 앱',
  app_id: 'com.poeticecho.testapp',
};

// ---------------------------------------------------------------- 도구 감지
const hasJavac = spawnSync('javac', ['-version']).status === 0;
const hasPython = spawnSync('python3', ['-c', 'print(1)']).status === 0;

// ---------------------------------------------------------------- 케이스 구성
function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCases() {
  const cases = [];
  const push = (name, overrides) => cases.push({ name, raw: { ...BASE, ...overrides } });

  push('기본값', {});
  push('전체화면 ON', { fullscreen: true });
  push('핀치 줌 ON', { allow_zoom: true });
  push('당겨서 새로고침 ON', { pull_to_refresh: true });
  push('뒤로가기 바로 종료', { back_button: 'exit_only' });
  push('외부 링크 in_app', { external_links: 'in_app' });
  push('가로', { orientation: 'landscape' });
  push('자동 방향', { orientation: 'sensor' });
  push('밝은 상태바', { status_bar_color: '#FFFFFF' });
  push('3자리 색상', { status_bar_color: '#abc' });
  push('http 대상(cleartext)', { url: 'http://neverssl.com' });
  push('경로/쿼리 포함 URL', { url: 'https://example.com/a/b?c=1&d=2#frag' });
  push('한글 앱 이름', { app_name: '수성구 맛집 지도' });
  push('이모지 앱 이름', { app_name: '🚀 로켓' });
  push('긴 앱 이름', { app_name: '아주 긴 이름의 테스트 애플리케이션 이름입니다 정말로' });
  push('모두 ON', {
    fullscreen: true, allow_zoom: true, pull_to_refresh: true,
    orientation: 'landscape', external_links: 'in_app', back_button: 'exit_only',
    status_bar_color: '#0EA5E9',
  });
  push('모두 OFF', {
    fullscreen: false, allow_zoom: false, pull_to_refresh: false,
    orientation: 'portrait', external_links: 'system_browser', back_button: 'history_then_exit',
    status_bar_color: '#111827',
  });

  const random = mulberry32(20261121);
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  for (let i = 0; i < 16; i += 1) {
    push(`랜덤 #${i + 1}`, {
      fullscreen: random() < 0.5,
      allow_zoom: random() < 0.5,
      pull_to_refresh: random() < 0.5,
      orientation: pick(['portrait', 'landscape', 'sensor']),
      external_links: pick(['in_app', 'system_browser']),
      back_button: pick(['history_then_exit', 'exit_only']),
      status_bar_color: pick(['#111827', '#FFFFFF', '#ABCDEF', '#0f0']),
      url: pick(['https://example.com', 'http://example.org/deep/path', 'https://m.sub.example.co.kr']),
    });
  }

  // 아이콘 base64 (1024 정사각 / 작은 이미지)
  const iconPath = path.join(tmpRoot, 'icon-1024.png');
  if (!existsSync(iconPath)) makePng(iconPath, 1024, 1024, [99, 102, 241]);
  push('아이콘 base64', { icon_file: iconPath });

  return cases;
}

function makePng(file, width, height, rgb) {
  // Pillow 없이도 돌도록 최소 PNG 인코더 사용
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 3] = rgb[0];
    pixels[i * 3 + 1] = rgb[1];
    pixels[i * 3 + 2] = rgb[2];
  }
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolor
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- 픽스처
function extractAndroidTemplate() {
  const tgz = path.join(repoRoot, 'node_modules', '@capacitor', 'cli', 'assets', 'android-template.tar.gz');
  if (!existsSync(tgz)) {
    throw new Error('node_modules 가 없습니다. 먼저 `npm ci` 를 실행하세요.');
  }
  const dir = mkdtempSync(path.join(tmpRoot, 'android-template-'));
  const result = spawnSync('tar', ['-xzf', tgz, '-C', dir], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`android 템플릿 압축 해제 실패: ${result.stderr}`);
  return dir;
}

// ---------------------------------------------------------------- 검증
function checkXml(files) {
  if (!hasPython || files.length === 0) return [];
  const script = [
    'import sys, xml.dom.minidom',
    'bad = []',
    'for f in sys.argv[1:]:',
    '    try:',
    '        xml.dom.minidom.parse(f)',
    '    except Exception as e:',
    "        bad.append(f + ': ' + str(e))",
    "print('\\n'.join(bad))",
    'sys.exit(1 if bad else 0)',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script, ...files], { encoding: 'utf8' });
  if (result.status === 0) return [];
  return (result.stdout || result.stderr).split('\n').filter(Boolean);
}

// 클래스패스 없이 javac 를 돌리면 "package android.os does not exist" 같은 해석 오류가 쏟아진다.
// 문법 오류(파싱 단계)만 골라내기 위한 패턴.
const SYNTAX_ERROR_PATTERNS = [
  /illegal start of (type|expression|statement)/,
  /';' expected/,
  /'\)' expected/,
  /'\}' expected/,
  /class, interface, enum, or record expected/,
  /reached end of file while parsing/,
  /illegal character/,
  /unclosed (string|character) literal/,
  /not a statement/,
  /invalid method declaration/,
  /(identifier|<identifier>) expected/,
  /orphaned (case|default)/,
  /malformed/,
];

function checkJavaSyntax(file) {
  if (!hasJavac) return [];
  const outDir = mkdtempSync(path.join(tmpRoot, 'javac-'));
  const args = ['-d', outDir, '-proc:none'];
  if (process.env.ANDROID_HOME) {
    const androidJar = path.join(process.env.ANDROID_HOME, 'platforms', 'android-36', 'android.jar');
    if (existsSync(androidJar)) args.push('-classpath', androidJar);
  }
  const result = spawnSync('javac', [...args, file], { encoding: 'utf8' });
  rmSync(outDir, { recursive: true, force: true });
  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  const lines = output.split('\n').filter((line) => line.includes('error:'));
  const syntaxErrors = lines.filter((line) => SYNTAX_ERROR_PATTERNS.some((re) => re.test(line)));
  if (syntaxErrors.length === 0) return [];
  return [`javac 문법오류: ${syntaxErrors.slice(0, 3).join(' | ')}`];
}

function expectContains(list, content, needle, label) {
  if (!content.includes(needle)) list.push(`${label} 에 "${needle}" 가 없습니다`);
}

/**
 * 한 케이스를 생성하고 검증한다.
 * @returns {string[]} 실패 메시지
 */
function runCase(testCase, ctx) {
  const failures = [];
  const raw = { ...testCase.raw };
  if (raw.icon_file) {
    raw.icon_base64 = readFileSync(raw.icon_file).toString('base64');
    delete raw.icon_file;
  }
  let options;
  try {
    options = normalizeOptions(raw);
  } catch (error) {
    return [`옵션 정규화 실패: ${error.message}`];
  }

  const caseRoot = mkdtempSync(path.join(tmpRoot, 'case-'));
  try {
    symlinkSync(path.join(repoRoot, 'templates'), path.join(caseRoot, 'templates'), 'dir');
    symlinkSync(path.join(repoRoot, 'scripts'), path.join(caseRoot, 'scripts'), 'dir');
    cpSync(ctx.androidTemplate, path.join(caseRoot, 'android'), { recursive: true });

    const prepared = prepare({ options, root: caseRoot, log });
    const patched = patch({ options, root: caseRoot, log });

    // --- capacitor.config.json
    const config = JSON.parse(readFileSync(path.join(caseRoot, 'capacitor.config.json'), 'utf8'));
    const expected = capacitorConfig(options);
    if (config.appId !== options.appId) failures.push(`appId 불일치: ${config.appId}`);
    if (config.appName !== options.appName) failures.push(`appName 불일치: ${config.appName}`);
    if (config.server.url !== options.url) failures.push(`server.url 불일치: ${config.server.url}`);
    if (config.server.cleartext !== options.isCleartext) failures.push('server.cleartext 불일치');
    if (JSON.stringify(config.server.allowNavigation) !== JSON.stringify(expected.server.allowNavigation)) {
      failures.push(`allowNavigation 불일치: ${JSON.stringify(config.server.allowNavigation)}`);
    }
    if (config.android.backgroundColor !== options.statusBarColor) failures.push('android.backgroundColor 불일치');
    if (config.plugins.SplashScreen.backgroundColor !== options.iconBackgroundColor) failures.push('splash 색 불일치');
    if (config.plugins.SplashScreen.splashFullScreen !== options.fullscreen) failures.push('splashFullScreen 불일치');

    // --- www
    const indexHtml = readFileSync(path.join(caseRoot, 'www', 'index.html'), 'utf8');
    expectContains(failures, indexHtml, JSON.stringify(options.url), 'www/index.html');
    expectContains(failures, indexHtml, options.appName.replace(/&/g, '&amp;').replace(/</g, '&lt;'), 'www/index.html');
    if (/__[A-Z0-9_]+__/.test(indexHtml)) failures.push('www/index.html 에 치환되지 않은 토큰');

    // --- 아이콘
    const iconBytes = readFileSync(path.join(caseRoot, 'assets', 'icon.png'));
    const iconSize = readPngSize(iconBytes);
    if (!iconSize) failures.push('assets/icon.png 가 PNG 가 아닙니다');
    else if (prepared.icon.source === 'generated' && (iconSize.width !== 1024 || iconSize.height !== 1024)) {
      failures.push(`자동 생성 아이콘 크기가 1024x1024 가 아닙니다: ${iconSize.width}x${iconSize.height}`);
    } else if (prepared.icon.source === 'base64' && raw.icon_base64) {
      const original = readPngSize(Buffer.from(raw.icon_base64, 'base64'));
      if (!original || iconSize.width !== original.width) failures.push('base64 아이콘 크기가 원본과 다릅니다');
    }

    // --- MainActivity.java
    const javaFile = path.join(caseRoot, 'android', 'app', 'src', 'main', 'java', ...options.packagePath.split('/'), 'MainActivity.java');
    if (!existsSync(javaFile)) {
      failures.push('MainActivity.java 가 생성되지 않았습니다');
    } else {
      const java = readFileSync(javaFile, 'utf8');
      if (/__[A-Z0-9_]+__/.test(java)) failures.push('MainActivity.java 에 치환되지 않은 토큰');
      expectContains(failures, java, `package ${options.appId};`, 'MainActivity.java');
      expectContains(failures, java, `FULLSCREEN = ${options.fullscreen};`, 'MainActivity.java');
      expectContains(failures, java, `ALLOW_ZOOM = ${options.allowZoom};`, 'MainActivity.java');
      expectContains(failures, java, `PULL_TO_REFRESH = ${options.pullToRefresh};`, 'MainActivity.java');
      expectContains(failures, java, `BACK_HISTORY_FIRST = ${options.backHistoryFirst};`, 'MainActivity.java');
      expectContains(failures, java, `"${options.statusBarColor}"`, 'MainActivity.java');
      expectContains(failures, java, `"${options.navigationBarColor}"`, 'MainActivity.java');
      const opens = (java.match(/\{/g) || []).length;
      const closes = (java.match(/\}/g) || []).length;
      if (opens !== closes) failures.push(`MainActivity.java 중괄호 불균형 ${opens}/${closes}`);
      failures.push(...checkJavaSyntax(javaFile));
    }

    // --- AndroidManifest.xml
    const manifestFile = path.join(caseRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    const manifest = readFileSync(manifestFile, 'utf8');
    if (/__[A-Z0-9_]+__/.test(manifest)) failures.push('AndroidManifest.xml 에 치환되지 않은 토큰');
    expectContains(failures, manifest, `android:screenOrientation="${options.androidOrientation}"`, 'AndroidManifest.xml');
    expectContains(failures, manifest, `android:usesCleartextTraffic="${options.isCleartext}"`, 'AndroidManifest.xml');
    expectContains(failures, manifest, 'android.permission.INTERNET', 'AndroidManifest.xml');
    expectContains(failures, manifest, 'android:name=".MainActivity"', 'AndroidManifest.xml');

    // --- 리소스
    const valuesDir = path.join(caseRoot, 'android', 'app', 'src', 'main', 'res', 'values');
    const colorsXml = readFileSync(path.join(valuesDir, 'colors.xml'), 'utf8');
    const stylesXml = readFileSync(path.join(valuesDir, 'styles.xml'), 'utf8');
    const stringsXml = readFileSync(path.join(valuesDir, 'strings.xml'), 'utf8');
    expectContains(failures, colorsXml, options.statusBarColor, 'colors.xml');
    expectContains(failures, stylesXml, `<item name="android:windowLightStatusBar">${options.lightSystemBars}</item>`, 'styles.xml');
    expectContains(failures, stringsXml, options.appId, 'strings.xml');
    if (!stringsXml.includes(options.appName.replace(/&/g, '&amp;'))) failures.push('strings.xml 에 앱 이름이 없습니다');

    const xmlFiles = [
      manifestFile,
      path.join(valuesDir, 'colors.xml'),
      path.join(valuesDir, 'styles.xml'),
      path.join(valuesDir, 'strings.xml'),
    ];
    failures.push(...checkXml(xmlFiles));

    // --- build.gradle
    const gradle = readFileSync(path.join(caseRoot, 'android', 'app', 'build.gradle'), 'utf8');
    expectContains(failures, gradle, `applicationId "${options.appId}"`, 'build.gradle');
    expectContains(failures, gradle, `namespace = "${options.appId}"`, 'build.gradle');
    if ((gradle.match(/androidx\.swiperefreshlayout/g) || []).length !== 1) {
      failures.push('build.gradle SwipeRefreshLayout 의존성이 정확히 1개가 아닙니다');
    }

    // --- 멱등성: 같은 옵션으로 한 번 더 patch
    const before = readFileSync(javaFile, 'utf8');
    patch({ options, root: caseRoot, log });
    if (readFileSync(javaFile, 'utf8') !== before) failures.push('patch 를 두 번 실행했을 때 결과가 달라집니다');
    const gradleAfter = readFileSync(path.join(caseRoot, 'android', 'app', 'build.gradle'), 'utf8');
    if ((gradleAfter.match(/androidx\.swiperefreshlayout/g) || []).length !== 1) {
      failures.push('build.gradle 이 두 번 패치되며 의존성이 중복되었습니다');
    }

    // --- patch 요약
    if (patched.appId !== options.appId) failures.push('patch 요약 appId 불일치');
    if (patched.orientation !== options.androidOrientation) failures.push('patch 요약 orientation 불일치');
  } catch (error) {
    failures.push(`예외: ${error.message}`);
  } finally {
    rmSync(caseRoot, { recursive: true, force: true });
  }
  return failures;
}

// ---------------------------------------------------------------- 입력 오류 케이스
function runInvalidCases() {
  const cases = [
    ['주소 없음', { app_name: 'x' }, 'url'],
    ['ftp 주소', { url: 'ftp://example.com', app_name: 'x' }, 'url'],
    ['빈 앱 이름', { url: 'https://a.com', app_name: '   ' }, 'app_name'],
    ['잘못된 패키지명', { url: 'https://a.com', app_name: 'x', app_id: 'com.1bad.app' }, 'app_id'],
    ['한 조각 패키지명', { url: 'https://a.com', app_name: 'x', app_id: 'myapp' }, 'app_id'],
    ['예약어 패키지명', { url: 'https://a.com', app_name: 'x', app_id: 'com.class.app' }, 'app_id'],
    ['잘못된 색', { url: 'https://a.com', app_name: 'x', status_bar_color: 'blue' }, 'status_bar_color'],
    ['잘못된 방향', { url: 'https://a.com', app_name: 'x', orientation: 'diagonal' }, 'orientation'],
    ['너무 긴 앱 이름', { url: 'https://a.com', app_name: 'a'.repeat(70) }, 'app_name'],
    ['잘못된 아이콘', { url: 'https://a.com', app_name: 'x', icon_base64: 'not-base64!!' }, 'icon_base64'],
  ];
  const failures = [];
  for (const [label, raw, field] of cases) {
    try {
      normalizeOptions(raw);
      failures.push(`${label}: 오류가 나야 하는데 통과했습니다`);
    } catch (error) {
      if (error.field !== field) failures.push(`${label}: field=${error.field} (기대: ${field})`);
    }
  }

  // URL 정규화
  const fixed = parseTargetUrl('example.com/path');
  if (fixed.url !== 'https://example.com/path') failures.push(`스킴 자동 보정 실패: ${fixed.url}`);
  const local = parseTargetUrl('http://localhost:3000');
  if (!local.isCleartext) failures.push('localhost http 판별 실패');
  return failures;
}

// ---------------------------------------------------------------- CLI 스모크 테스트
function runCliSmoke() {
  const failures = [];
  const dir = mkdtempSync(path.join(tmpRoot, 'cli-'));
  try {
    symlinkSync(path.join(repoRoot, 'templates'), path.join(dir, 'templates'), 'dir');
    symlinkSync(path.join(repoRoot, 'scripts'), path.join(dir, 'scripts'), 'dir');
    const env = { ...process.env, WEB2APK_CLI_ROOT: dir };
    const ok = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts', 'generate-project.mjs'), 'prepare',
      '--url', 'https://cli.example.com', '--app-name', 'CLI 앱', '--root', dir, '--json',
    ], { encoding: 'utf8', env });
    if (ok.status !== 0) failures.push(`CLI prepare 실패: ${ok.stderr || ok.stdout}`);
    else if (!existsSync(path.join(dir, 'capacitor.config.json'))) failures.push('CLI prepare 결과물 없음');

    const bad = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts', 'generate-project.mjs'), 'prepare',
      '--url', 'not a url', '--app-name', 'x', '--root', dir,
    ], { encoding: 'utf8', env });
    if (bad.status === 0) failures.push('CLI 가 잘못된 URL 을 통과시켰습니다');
    else if (!/입력 오류/.test(bad.stdout + bad.stderr)) failures.push('CLI 오류 메시지가 부족합니다');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failures;
}

// ---------------------------------------------------------------- 실행
function main() {
  mkdirSync(tmpRoot, { recursive: true });
  console.log('web2apk 생성기 테스트');
  console.log(`  · javac: ${hasJavac ? '있음 (자바 문법 검사)' : '없음 (건너뜀)'} / python3: ${hasPython ? '있음 (XML 검사)' : '없음 (건너뜀)'}`);

  const androidTemplate = extractAndroidTemplate();
  const cases = buildCases();
  let failed = 0;

  cases.forEach((testCase, index) => {
    const failures = runCase(testCase, { androidTemplate });
    const label = `[${String(index + 1).padStart(2, '0')}/${cases.length}] ${testCase.name}`;
    if (failures.length === 0) {
      console.log(`  ✓ ${label}`);
    } else {
      failed += 1;
      console.log(`  ✗ ${label}`);
      failures.forEach((message) => console.log(`      - ${message}`));
    }
  });

  const invalidFailures = runInvalidCases();
  if (invalidFailures.length) {
    failed += 1;
    console.log('  ✗ 입력 오류 처리');
    invalidFailures.forEach((m) => console.log(`      - ${m}`));
  } else {
    console.log('  ✓ 입력 오류 10종 + URL 정규화');
  }

  const cliFailures = runCliSmoke();
  if (cliFailures.length) {
    failed += 1;
    console.log('  ✗ CLI 스모크 테스트');
    cliFailures.forEach((m) => console.log(`      - ${m}`));
  } else {
    console.log('  ✓ CLI (prepare 성공/실패 경로)');
  }

  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(androidTemplate, { recursive: true, force: true });

  console.log(failed === 0 ? `\n전부 통과: ${cases.length}개 조합 + 입력 검증` : `\n${failed}개 실패`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
