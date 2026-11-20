#!/usr/bin/env node
/**
 * GitHub Actions 입력 정규화.
 *
 * - workflow_dispatch / repository_dispatch 이벤트의 페이로드 파일($GITHUB_EVENT_PATH)에서 입력을 읽는다.
 *   (아이콘 base64 처럼 큰 값도 환경변수 길이 제한에 걸리지 않는다)
 * - 로컬 테스트용으로 WEB2APK_INPUT_* 환경변수도 받는다.
 * - 검증된 옵션을 .web2apk/options.json 과 $GITHUB_OUTPUT 에 남긴다.
 */
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { OptionError, normalizeOptions } from './lib/options.mjs';
import { publicOptions } from './lib/generate.mjs';

const KEY_MAP = {
  url: 'url',
  app_name: 'app_name',
  app_id: 'app_id',
  fullscreen: 'fullscreen',
  orientation: 'orientation',
  allow_zoom: 'allow_zoom',
  back_button: 'back_button',
  external_links: 'external_links',
  pull_to_refresh: 'pull_to_refresh',
  status_bar_color: 'status_bar_color',
  icon_base64: 'icon_base64',
  release_tag: 'release_tag',
  version_name: 'version_name',
  version_code: 'version_code',
};

function inputsFromEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
    if (process.env.GITHUB_EVENT_NAME === 'repository_dispatch') {
      return payload.client_payload ?? null;
    }
    return payload.inputs ?? null;
  } catch (error) {
    console.error(`[web2apk] 이벤트 페이로드를 읽지 못했습니다: ${error.message}`);
    return null;
  }
}

function inputsFromEnv() {
  const raw = {};
  let found = false;
  for (const key of Object.keys(KEY_MAP)) {
    const envKey = `WEB2APK_INPUT_${key.toUpperCase()}`;
    if (process.env[envKey] !== undefined) {
      raw[key] = process.env[envKey];
      found = true;
    }
  }
  return found ? raw : null;
}

function main() {
  const raw = inputsFromEvent() ?? inputsFromEnv() ?? {};
  const eventName = process.env.GITHUB_EVENT_NAME ?? 'local';

  let options;
  try {
    options = normalizeOptions(raw);
  } catch (error) {
    const message = error instanceof OptionError ? `입력 오류 (${error.field}): ${error.message}` : error.message;
    console.error(`\n[web2apk] ${message}`);
    // GitHub Actions 요약에 그대로 남겨 사용자가 원인을 바로 알 수 있게 한다.
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      appendFileSync(
        summaryPath,
        `## ❌ APK 빌드 실패 — 입력 오류\n\n${message}\n\n필수 입력: \`url\`, \`app_name\` · 패키지명은 \`com.example.myapp\` 형식이어야 합니다.\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const root = process.cwd();
  mkdirSync(path.join(root, '.web2apk'), { recursive: true });
  writeFileSync(
    path.join(root, '.web2apk', 'options.json'),
    `${JSON.stringify(publicOptions(options), null, 2)}\n`,
  );

  const outputs = {
    event_name: eventName,
    app_name: options.appName,
    app_id: options.appId,
    safe_name: options.safeFileName,
    artifact_name: options.artifactName,
    url: options.url,
    host: options.host,
    orientation: options.androidOrientation,
    fullscreen: String(options.fullscreen),
    allow_zoom: String(options.allowZoom),
    back_button: options.backButton,
    external_links: options.externalLinks,
    pull_to_refresh: String(options.pullToRefresh),
    status_bar_color: options.statusBarColor,
    icon_bg: options.iconBackgroundColor,
    icon_source: options.iconBase64 ? 'base64' : 'auto-or-assets',
    release_tag: options.releaseTag,
  };

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    for (const [key, value] of Object.entries(outputs)) {
      appendFileSync(outputPath, `${key}=${String(value).replace(/\r?\n/g, ' ')}\n`);
    }
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(
      summaryPath,
      [
        '## 📱 web2apk 빌드 시작',
        '',
        '| 항목 | 값 |',
        '| --- | --- |',
        `| 앱 이름 | ${options.appName} |`,
        `| 패키지명 | \`${options.appId}\` |`,
        `| 대상 URL | ${options.url} |`,
        `| 전체화면 | ${options.fullscreen ? 'ON' : 'OFF'} |`,
        `| 화면 방향 | ${options.orientation} |`,
        `| 핀치 줌 | ${options.allowZoom ? 'ON' : 'OFF'} |`,
        `| 뒤로가기 | ${options.backButton} |`,
        `| 외부 링크 | ${options.externalLinks} |`,
        `| 당겨서 새로고침 | ${options.pullToRefresh ? 'ON' : 'OFF'} |`,
        `| 상태바 색 | \`${options.statusBarColor}\` |`,
        `| 아이콘 | ${outputs.icon_source} |`,
        '',
      ].join('\n'),
    );
  }

  console.log(JSON.stringify(outputs, null, 2));
}

main();
