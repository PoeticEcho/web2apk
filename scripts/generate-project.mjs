#!/usr/bin/env node
/**
 * web2apk 프로젝트 생성기
 *
 * 사용법:
 *   node scripts/generate-project.mjs prepare --url https://example.com --app-name "내 앱" [옵션들]
 *   node scripts/generate-project.mjs patch
 *   node scripts/generate-project.mjs all --url ... --app-name ...
 *
 * 옵션(CLI):
 *   --app-id, --fullscreen[=true], --orientation portrait|landscape|sensor,
 *   --allow-zoom, --back-button history_then_exit|exit_only,
 *   --external-links in_app|system_browser, --pull-to-refresh,
 *   --status-bar-color '#111827', --icon-base64 <base64|@파일>, --icon-file <png 경로>,
 *   --release-tag v1.0.0, --root <프로젝트 루트>
 *
 * 환경변수(GitHub Actions)로도 동작한다: WEB2APK_INPUT_* (scripts/resolve-inputs.mjs 참고)
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patch, prepare, readOptionsFile } from './lib/generate.mjs';
import { createLogger } from './lib/log.mjs';
import { OptionError, normalizeOptions, optionsFromArgv } from './lib/options.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDefault = path.resolve(scriptDir, '..');

function parseArgs(argv) {
  const args = { stage: 'all', root: repoRootDefault, json: false, quiet: false, verbose: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') args.json = true;
    else if (token === '--quiet') args.quiet = true;
    else if (token === '--verbose') args.verbose = true;
    else if (token === '--root') args.root = path.resolve(argv[++i]);
    else if (token.startsWith('--root=')) args.root = path.resolve(token.split('=')[1]);
    else rest.push(token);
  }
  const [maybeStage, ...optionArgs] = rest;
  if (maybeStage && ['prepare', 'patch', 'all'].includes(maybeStage)) {
    args.stage = maybeStage;
    args.optionArgs = optionArgs;
  } else {
    args.stage = 'all';
    args.optionArgs = rest;
  }
  return args;
}

/** --icon-file <png> / --icon-base64 @<png> 를 읽어 raw.icon_base64 로 넣는다. */
function expandIconArgs(raw) {
  if (raw.icon_file) {
    raw.icon_base64 = readFileSync(path.resolve(raw.icon_file), 'base64');
    delete raw.icon_file;
  } else if (raw.icon_base64 && raw.icon_base64.startsWith('@')) {
    raw.icon_base64 = readFileSync(path.resolve(raw.icon_base64.slice(1)), 'base64');
  }
  return raw;
}

function loadOptions(args, log) {
  const raw = expandIconArgs(optionsFromArgv(args.optionArgs));
  const hasFlags = Object.keys(raw).length > 0;
  if (hasFlags) {
    return normalizeOptions(raw);
  }
  const stored = readOptionsFile(args.root);
  if (stored) {
    log?.debug(`저장된 옵션 사용: ${path.join(args.root, '.web2apk', 'options.json')}`);
    return stored;
  }
  throw new OptionError(
    '옵션이 없습니다. --url 과 --app-name 을 넘기거나, 먼저 prepare 단계로 .web2apk/options.json 을 만들어 주세요.',
    'url',
  );
}

function summarize(options) {
  return {
    appName: options.appName,
    appId: options.appId,
    url: options.url,
    fullscreen: options.fullscreen,
    orientation: options.orientation,
    allowZoom: options.allowZoom,
    backButton: options.backButton,
    externalLinks: options.externalLinks,
    pullToRefresh: options.pullToRefresh,
    statusBarColor: options.statusBarColor,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = createLogger({ quiet: args.quiet, verbose: args.verbose });
  const result = { stage: args.stage, root: args.root };

  try {
    if (args.stage === 'prepare' || args.stage === 'all') {
      const options = loadOptions(args, log);
      result.options = summarize(options);
      result.prepare = prepare({ options, root: args.root, log });
      if (args.stage === 'all') {
        if (!existsSync(path.join(args.root, 'android'))) {
          log.info('\n[web2apk] android/ 가 없어 patch 단계는 건너뜁니다. `npx cap add android` 후 다시 실행하세요.');
        } else {
          result.patch = patch({ options: readOptionsFile(args.root) ?? options, root: args.root, log });
        }
      }
      result.ok = true;
    } else if (args.stage === 'patch') {
      const options = readOptionsFile(args.root);
      if (!options) {
        throw new OptionError('patch 단계에는 .web2apk/options.json 이 필요합니다. 먼저 prepare 를 실행하세요.', 'root');
      }
      result.patch = patch({ options, root: args.root, log });
      result.ok = true;
    }

    log.plain(`\n[web2apk] 완료: ${args.stage}`);
    if (args.json) console.log(JSON.stringify(result, (key, value) => (key === 'options' && value?.iconBytes ? undefined : value), 2));
    return 0;
  } catch (error) {
    if (error instanceof OptionError) {
      log.error(`\n[web2apk] 입력 오류 (${error.field}): ${error.message}`);
    } else {
      log.error(`\n[web2apk] 실패: ${error.stack || error.message}`);
    }
    if (args.json) console.log(JSON.stringify({ ok: false, stage: args.stage, error: error.message, field: error.field }, null, 2));
    return 1;
  }
}

process.exitCode = main();
