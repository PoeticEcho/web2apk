/**
 * web2apk 프로젝트 생성/패치 모듈.
 *
 * prepare : capacitor.config.json + www(오프라인 페이지) + assets/icon.png + .web2apk/options.json
 * patch   : `npx cap add android` 로 만들어진 네이티브 프로젝트에 옵션을 반영
 *           (MainActivity.java, AndroidManifest.xml, colors/styles/strings, build.gradle)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prepareIcon } from './icon.mjs';
import {
  assertNoUnresolvedTokens,
  escapeAndroidString,
  escapeHtml,
  escapeJavaString,
  render,
} from './render.mjs';

const readTemplate = (root, name) => readFileSync(path.join(root, 'templates', name), 'utf8');

const write = (filePath, content) => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return filePath;
};

const yesNo = (value) => (value ? 'ON' : 'OFF');const orientationLabel = { portrait: '세로', landscape: '가로', sensor: '자동' };
const backLabel = { history_then_exit: '히스토리→종료', exit_only: '바로 종료' };
const externalLabel = { in_app: '앱 안에서', system_browser: '시스템 브라우저' };

export function capacitorConfig(options) {
  // 외부 링크 처리:
  //  - system_browser: 같은 사이트(+서브도메인)만 앱 안에서 열고, 다른 도메인은 브라우저로 넘긴다.
  //  - in_app        : 모든 링크를 앱 안의 WebView 에서 연다(로그인 팝업 등이 앱 안에서 동작).
  const allowNavigation =
    options.externalLinks === 'in_app' ? ['*'] : [`*.${options.host}`];

  return {
    appId: options.appId,
    appName: options.appName,
    webDir: 'www',
    server: {
      url: options.url,
      cleartext: options.isCleartext,
      androidScheme: 'https',
      errorPath: 'index.html',
      allowNavigation,
    },
    android: {
      allowMixedContent: options.isCleartext,
      backgroundColor: options.statusBarColor,
      webContentsDebuggingEnabled: false,
      // 상태바/내비바는 MainActivity 에서 직접 제어한다.
    },
    plugins: {
      SplashScreen: {
        launchShowDuration: 450,
        launchAutoHide: true,
        backgroundColor: options.iconBackgroundColor,
        androidSplashResourceName: 'splash',
        androidScaleType: 'CENTER_CROP',
        showSpinner: false,
        splashFullScreen: options.fullscreen,
        splashImmersive: options.fullscreen,
      },
    },
  };
}

/** 옵션을 파일로 저장할 때: 아이콘 원본(base64/Buffer)은 빼고 메타만 남긴다. */
export function publicOptions(options) {
  const { iconBytes, iconBase64, ...rest } = options;
  return { ...rest, iconProvided: Boolean(iconBase64), iconBytes: undefined };
}
export function prepare({ options, root, log }) {
  const created = [];
  log?.step('프로젝트 준비 (capacitor.config.json · www · 아이콘)');

  const configPath = write(
    path.join(root, 'capacitor.config.json'),
    `${JSON.stringify(capacitorConfig(options), null, 2)}\n`,
  );
  created.push(configPath);
  log?.info(`  · capacitor.config.json  ${options.appId} / ${options.appName}`);

  const icon = prepareIcon({ options, root, log });
  log?.info(`  · assets/icon.png  (${icon.source}${icon.renderer ? `, ${icon.renderer}` : ''})`);

  const wwwDir = path.join(root, 'www');
  mkdirSync(wwwDir, { recursive: true });
  const indexHtml = render(readTemplate(root, 'www-index.html.tmpl'), {
    APP_NAME_HTML: escapeHtml(options.appName),
    URL_JSON: JSON.stringify(options.url),
    HOST: escapeHtml(options.host),
    ICON_BG: options.iconBackgroundColor,
  });
  assertNoUnresolvedTokens(indexHtml, 'www-index.html');
  created.push(write(path.join(wwwDir, 'index.html'), indexHtml));

  if (existsSync(icon.path)) {
    copyFileSync(icon.path, path.join(wwwDir, 'icon.png'));
  }
  created.push(path.join(wwwDir, 'icon.png'));

  const metaPath = write(
    path.join(root, '.web2apk', 'options.json'),
    `${JSON.stringify(publicOptions(options), null, 2)}\n`,
  );
  created.push(metaPath);

  log?.info(`  · 외부 링크: ${externalLabel[options.externalLinks]} (allowNavigation: ${JSON.stringify(capacitorConfig(options).server.allowNavigation)})`);
  return { created, icon };
}

const escapeGradle = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** android/app/build.gradle 에 namespace/applicationId/버전과 의존성을 반영한다. */
function patchAppGradle(content, options) {
  let next = content;

  const namespaceRe = /namespace\s*=\s*["'][^"']+["']/;
  if (namespaceRe.test(next)) {
    next = next.replace(namespaceRe, `namespace = "${escapeGradle(options.appId)}"`);
  } else {
    next = next.replace(/android\s*\{/, `android {\n    namespace = "${escapeGradle(options.appId)}"`);
  }

  const appIdRe = /applicationId\s+["'][^"']+["']/;
  if (appIdRe.test(next)) {
    next = next.replace(appIdRe, `applicationId "${escapeGradle(options.appId)}"`);
  } else {
    next = next.replace(/defaultConfig\s*\{/, `defaultConfig {\n        applicationId "${escapeGradle(options.appId)}"`);
  }

  next = next.replace(/versionCode\s+\d+/, `versionCode ${options.versionCode}`);
  next = next.replace(/versionName\s+["'][^"']*["']/, `versionName "${escapeGradle(options.versionName)}"`);

  if (!next.includes('androidx.swiperefreshlayout')) {
    next += `
// web2apk: 당겨서 새로고침(SwipeRefreshLayout) - 옵션과 무관하게 항상 포함해 빌드를 단순하게 유지한다.
dependencies {
    implementation "androidx.swiperefreshlayout:swiperefreshlayout:1.1.0"
}
`;
  }
  return next;
}

function patchGradleProperties(content) {
  let next = content;
  const jvmArgs = 'org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8';
  if (/org\.gradle\.jvmargs=.*/.test(next)) {
    next = next.replace(/org\.gradle\.jvmargs=.*/, jvmArgs);
  } else {
    next += `\n# web2apk\n${jvmArgs}\n`;
  }
  if (!next.includes('android.nonTransitiveRClass')) {
    next += 'android.nonTransitiveRClass=true\n';
  }
  return next;
}

/** java 디렉터리에서 예전 패키지의 MainActivity 등 잔여물을 정리한다. */
function resetJavaSources(javaRoot) {
  if (!existsSync(javaRoot)) return;
  for (const entry of readdirSync(javaRoot)) {
    rmSync(path.join(javaRoot, entry), { recursive: true, force: true });
  }
}

/** 2단계: 네이티브 프로젝트에 옵션 반영 */
export function patch({ options, root, log }) {
  log?.step('안드로이드 프로젝트에 옵션 반영');
  const androidDir = path.join(root, 'android');
  if (!existsSync(androidDir)) {
    throw new Error(
      'android/ 디렉터리가 없습니다. 먼저 `npx cap add android` 를 실행한 뒤 patch 단계를 돌려 주세요.',
    );
  }

  const mainDir = path.join(androidDir, 'app', 'src', 'main');
  const javaRoot = path.join(mainDir, 'java');
  resetJavaSources(javaRoot);

  const javaFile = path.join(javaRoot, ...options.packagePath.split('/'), 'MainActivity.java');
  const mainActivity = render(readTemplate(root, 'MainActivity.java.tmpl'), {
    PACKAGE_NAME: options.appId,
    APP_NAME_COMMENT: String(options.appName).replace(/\*\//g, ''),
    URL_COMMENT: String(options.url).replace(/\*\//g, ''),
    FULLSCREEN: String(options.fullscreen),
    FULLSCREEN_LABEL: yesNo(options.fullscreen),
    ORIENTATION: `${options.orientation}(${orientationLabel[options.orientation]})`,
    ALLOW_ZOOM: String(options.allowZoom),
    ZOOM_LABEL: yesNo(options.allowZoom),
    BACK_HISTORY_FIRST: String(options.backHistoryFirst),
    BACK_LABEL: backLabel[options.backButton],
    EXTERNAL_LABEL: externalLabel[options.externalLinks],
    PULL_TO_REFRESH: String(options.pullToRefresh),
    REFRESH_LABEL: yesNo(options.pullToRefresh),
    STATUS_BAR_COLOR: escapeJavaString(options.statusBarColor),
    NAVIGATION_BAR_COLOR: escapeJavaString(options.navigationBarColor),
  });
  assertNoUnresolvedTokens(mainActivity, 'MainActivity.java');
  write(javaFile, mainActivity);

  const manifest = render(readTemplate(root, 'AndroidManifest.xml.tmpl'), {
    CLEARTEXT: String(options.isCleartext),
    SCREEN_ORIENTATION: options.androidOrientation,
  });
  assertNoUnresolvedTokens(manifest, 'AndroidManifest.xml');
  write(path.join(mainDir, 'AndroidManifest.xml'), manifest);

  const valuesDir = path.join(mainDir, 'res', 'values');
  const styles = render(readTemplate(root, 'styles.xml.tmpl'), {
    LIGHT_STATUS_BAR: String(options.lightSystemBars),
  });
  assertNoUnresolvedTokens(styles, 'styles.xml');
  write(path.join(valuesDir, 'styles.xml'), styles);

  const colors = render(readTemplate(root, 'colors.xml.tmpl'), {
    STATUS_BAR_COLOR: options.statusBarColor,
    STATUS_BAR_COLOR_DARK: options.statusBarColorDark,
    NAVIGATION_BAR_COLOR: options.navigationBarColor,
    WINDOW_BACKGROUND_COLOR: options.statusBarColor,
  });
  assertNoUnresolvedTokens(colors, 'colors.xml');
  write(path.join(valuesDir, 'colors.xml'), colors);

  const strings = render(readTemplate(root, 'strings.xml.tmpl'), {
    APP_NAME: escapeAndroidString(options.appName),
    APP_ID: escapeXmlText(options.appId),
  });
  assertNoUnresolvedTokens(strings, 'strings.xml');
  write(path.join(valuesDir, 'strings.xml'), strings);

  const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
  write(appGradlePath, patchAppGradle(readFileSync(appGradlePath, 'utf8'), options));

  const gradlePropsPath = path.join(androidDir, 'gradle.properties');
  if (existsSync(gradlePropsPath)) {
    write(gradlePropsPath, patchGradleProperties(readFileSync(gradlePropsPath, 'utf8')));
  }

  // 템플릿이 남긴 예제 테스트(패키지 불일치)는 지운다.
  for (const dir of ['test', 'androidTest']) {
    rmSync(path.join(androidDir, 'app', 'src', dir), { recursive: true, force: true });
  }

  const summary = {
    appId: options.appId,
    appName: options.appName,
    url: options.url,
    fullscreen: options.fullscreen,
    orientation: options.androidOrientation,
    allowZoom: options.allowZoom,
    backButton: options.backButton,
    externalLinks: options.externalLinks,
    pullToRefresh: options.pullToRefresh,
    statusBarColor: options.statusBarColor,
    lightSystemBars: options.lightSystemBars,
    patchedAt: new Date().toISOString(),
    files: [
      path.relative(root, javaFile),
      path.relative(root, path.join(mainDir, 'AndroidManifest.xml')),
      path.relative(root, path.join(valuesDir, 'styles.xml')),
      path.relative(root, path.join(valuesDir, 'colors.xml')),
      path.relative(root, path.join(valuesDir, 'strings.xml')),
      path.relative(root, appGradlePath),
    ],
  };
  write(path.join(root, '.web2apk', 'patch.json'), `${JSON.stringify(summary, null, 2)}\n`);

  log?.info(`  · MainActivity.java → ${summary.files[0]}`);
  log?.info(`  · 화면방향 ${summary.orientation} / 전체화면 ${yesNo(options.fullscreen)} / 당겨서새로고침 ${yesNo(options.pullToRefresh)}`);
  return summary;
}

/** XML 텍스트 노드용(따옴표는 그대로 둬도 되지만 일관되게 처리) */
function escapeXmlText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function readOptionsFile(root) {
  const file = path.join(root, '.web2apk', 'options.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}
