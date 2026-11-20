/**
 * web2apk - 옵션 정규화/검증 모듈
 *
 * 워크플로우 입력(스네이크 케이스), CLI 플래그(케밥), JSON(카멜) 어느 쪽으로 들어와도
 * 하나의 정규화된 옵션 객체로 만들어 준다. 모든 검증 규칙은 이 파일 한 곳에 모아 둔다.
 */

export const ORIENTATIONS = ['portrait', 'landscape', 'sensor'];
export const BACK_BEHAVIORS = ['history_then_exit', 'exit_only'];
export const EXTERNAL_LINK_MODES = ['in_app', 'system_browser'];

export const DEFAULT_APP_ID_PREFIX = 'com.poeticecho';
export const DEFAULT_STATUS_BAR_COLOR = '#111827';
export const MAX_ICON_BASE64_LENGTH = 1_400_000; // ≈ 1MB PNG

export class OptionError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'OptionError';
    this.field = field;
  }
}

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null', 'var', 'record', 'yield', 'sealed', 'permits',
]);

const pick = (value, allowed, fallback, field) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return fallback;
  if (!allowed.includes(v)) {
    throw new OptionError(`${field} 값은 ${allowed.join(', ')} 중 하나여야 합니다. (받은 값: ${value})`, field);
  }
  return v;
};

const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on' || v === 'y';
};

/** 대상 URL: 스킴이 없으면 https:// 를 붙이고, http(s)만 허용한다. */
export function parseTargetUrl(raw) {
  let input = String(raw ?? '').trim();
  if (!input) throw new OptionError('포장할 웹페이지 주소(url)가 필요합니다.', 'url');
  if (/[\s]/.test(input)) throw new OptionError('URL에 공백이 들어 있습니다.', 'url');
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) input = `https://${input}`;

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new OptionError(`URL 형식이 올바르지 않습니다: ${raw}`, 'url');
  }
  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    throw new OptionError('http:// 또는 https:// 주소만 APK로 만들 수 있습니다.', 'url');
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    // localhost 개발 주소는 허용하되, 그 외 호스트 없는 값은 거부
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new OptionError(`호스트가 올바르지 않습니다: ${parsed.hostname || '(없음)'}`, 'url');
    }
  }
  return {
    url: parsed.toString(),
    origin: parsed.origin,
    host: parsed.hostname,
    scheme,
    isCleartext: scheme === 'http',
  };
}

/** 앱 이름: 제어문자 제거, 길이 제한. */
export function normalizeAppName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) throw new OptionError('앱 이름(app_name)이 필요합니다.', 'app_name');
  if (name.length > 60) throw new OptionError('앱 이름은 60자 이내로 줄여 주세요.', 'app_name');
  return name;
}

/** 앱 이름 -> 패키지명 조각. 한글 등 비ASCII만 있으면 이름 해시를 붙인다. */
export function slugifyAppName(appName) {
  const ascii = appName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^[0-9]+/, (digits) => `app${digits}`);
  if (ascii.length >= 2) return ascii.slice(0, 24);
  const hash = hashString(appName).toString(36).slice(0, 4).padStart(4, '0');
  return `app${hash}`;
}

export function suggestAppId(appName, prefix = DEFAULT_APP_ID_PREFIX) {
  return `${prefix}.${slugifyAppName(appName)}`;
}

export function validateAppId(appId) {
  const value = String(appId ?? '').trim();
  if (!value) throw new OptionError('패키지명(app_id)이 필요합니다.', 'app_id');
  if (value.length > 120) throw new OptionError('패키지명이 너무 깁니다(120자 이내).', 'app_id');
  const segments = value.split('.');
  if (segments.length < 2) {
    throw new OptionError('패키지명은 점(.)으로 구분된 2개 이상의 조각이어야 합니다. 예: com.poeticecho.myapp', 'app_id');
  }
  for (const segment of segments) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(segment)) {
      throw new OptionError(
        `패키지명 조각 "${segment}"이 올바르지 않습니다. 각 조각은 영문자로 시작하고 영문/숫자/밑줄만 쓸 수 있습니다.`,
        'app_id',
      );
    }
    if (JAVA_KEYWORDS.has(segment.toLowerCase())) {
      throw new OptionError(`패키지명에 Java 예약어 "${segment}"를 쓸 수 없습니다.`, 'app_id');
    }
  }
  return value;
}

/** #RGB / #RRGGBB / RRGGBB 모두 허용하고 #RRGGBB 로 통일한다. */
export function normalizeColor(raw, field = 'status_bar_color', fallback = DEFAULT_STATUS_BAR_COLOR) {
  let value = String(raw ?? '').trim();
  if (!value) value = fallback;
  if (!value.startsWith('#')) value = `#${value}`;
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [, r, g, b] = value;
    value = `#${r}${r}${g}${g}${b}${b}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new OptionError(`${field}는 #RRGGBB 형식이어야 합니다. (받은 값: ${raw})`, field);
  }
  return value.toUpperCase();
}

export function hexToRgb(hex) {
  const value = normalizeColor(hex);
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** amount<1 이면 어둡게, >1 이면 밝게. */
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: r * amount, g: g * amount, b: b * amount });
}

export function isLightColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6;
}

export function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 파일명/아티팩트 이름으로 쓸 수 있게 정리한다. */
export function safeFileName(name, { asciiOnly = false, fallback = 'webapp' } = {}) {
  let value = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  if (asciiOnly) {
    const ascii = value.replace(/[^A-Za-z0-9._-]/g, '').replace(/^[._-]+|[._-]+$/g, '');
    value = ascii.length >= 2 ? ascii : fallback;
  }
  if (!value) value = fallback;
  return value.slice(0, 48);
}

export function orientationToAndroid(orientation) {
  switch (orientation) {
    case 'landscape':
      return 'landscape';
    case 'sensor':
      return 'fullSensor';
    case 'portrait':
    default:
      return 'portrait';
  }
}

/** 아이콘 base64(data URL 허용) 검증 + 정규화. 빈 값이면 null. */
export function normalizeIconBase64(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return null;
  value = value.replace(/^data:image\/png;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new OptionError('icon_base64가 올바른 base64 문자열이 아닙니다.', 'icon_base64');
  }
  if (value.length > MAX_ICON_BASE64_LENGTH) {
    throw new OptionError(
      `아이콘이 너무 큽니다(base64 ${Math.round(value.length / 1024)}KB, 최대 ${Math.round(MAX_ICON_BASE64_LENGTH / 1024)}KB). ` +
        '아이콘을 512×512로 줄이거나 저장소의 assets/icon.png 파일로 넣어 주세요.',
      'icon_base64',
    );
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes.toString('latin1', 1, 4) !== 'PNG') {
    throw new OptionError('icon_base64는 PNG 이미지여야 합니다.', 'icon_base64');
  }
  return { base64: value, bytes };
}

const readAny = (raw, keys) => {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key];
  }
  return undefined;
};

/**
 * 모든 입력을 검증해 빌드에 바로 쓰는 옵션 객체로 만든다.
 * @param {Record<string, unknown>} raw
 */
export function normalizeOptions(raw = {}) {
  const urlInfo = parseTargetUrl(readAny(raw, ['url', 'target_url', 'targetUrl']));
  const appName = normalizeAppName(readAny(raw, ['app_name', 'appName', 'name']));
  const appId = validateAppId(readAny(raw, ['app_id', 'appId', 'package_id']) ?? suggestAppId(appName));
  const statusBarColor = normalizeColor(readAny(raw, ['status_bar_color', 'statusBarColor']), 'status_bar_color');
  const orientation = pick(readAny(raw, ['orientation']), ORIENTATIONS, 'portrait', 'orientation');
  const backButton = pick(
    readAny(raw, ['back_button', 'backButton']),
    BACK_HISTORY_ALIASES,
    'history_then_exit',
    'back_button',
  );
  const externalLinks = pick(
    readAny(raw, ['external_links', 'externalLinks']),
    EXTERNAL_LINK_ALIASES,
    'system_browser',
    'external_links',
  );
  const fullscreen = toBool(readAny(raw, ['fullscreen']));
  const allowZoom = toBool(readAny(raw, ['allow_zoom', 'allowZoom']));
  const pullToRefresh = toBool(readAny(raw, ['pull_to_refresh', 'pullToRefresh']));
  const icon = normalizeIconBase64(readAny(raw, ['icon_base64', 'iconBase64']));
  const releaseTag = String(readAny(raw, ['release_tag', 'releaseTag']) ?? '').trim();
  if (releaseTag && !/^[A-Za-z0-9._/-]{1,80}$/.test(releaseTag)) {
    throw new OptionError('release_tag에는 영문/숫자/.-_/만 쓸 수 있습니다.', 'release_tag');
  }

  const iconBackground = normalizeColor(
    readAny(raw, ['icon_background_color']) ?? statusBarColor,
    'icon_background_color',
  );

  return {
    // 대상
    url: urlInfo.url,
    origin: urlInfo.origin,
    host: urlInfo.host,
    scheme: urlInfo.scheme,
    isCleartext: urlInfo.isCleartext,
    // 앱
    appName,
    appId,
    packagePath: appId.split('.').join('/'),
    safeFileName: safeFileName(appName),
    // Artifact 이름은 ASCII 만 허용되므로, 한글 앱 이름은 슬러그(해시)로 대체한다.
    artifactName: safeFileName(`${slugifyAppName(appName)}-apk`, { asciiOnly: true, fallback: 'web2apk-apk' }),
    // 화면/동작
    fullscreen,
    orientation,
    androidOrientation: orientationToAndroid(orientation),
    allowZoom,
    backButton,
    backHistoryFirst: backButton === 'history_then_exit',
    externalLinks,
    pullToRefresh,
    // 색
    statusBarColor,
    statusBarColorDark: shade(statusBarColor, 0.8),
    navigationBarColor: statusBarColor,
    lightSystemBars: isLightColor(statusBarColor),
    iconBackgroundColor: iconBackground,
    // 아이콘 / 배포
    iconBase64: icon ? icon.base64 : '',
    iconBytes: icon ? icon.bytes : null,
    releaseTag,
    versionName: String(readAny(raw, ['version_name', 'versionName']) ?? '1.0'),
    versionCode: Number(readAny(raw, ['version_code', 'versionCode']) ?? 1) || 1,
    generatedAt: new Date().toISOString(),
  };
}

// 별칭(사람이 쓸 법한 표현)도 받아 준다.
const BACK_HISTORY_ALIASES = [...BACK_BEHAVIORS, 'history', 'back_then_exit', 'history-first'];
const EXTERNAL_LINK_ALIASES = [...EXTERNAL_LINK_MODES, 'browser', 'external', 'inapp', 'system', 'system-browser'];

/** CLI 인자(--url, --app-name ...)를 raw 객체로 바꾼다. */
export function optionsFromArgv(argv) {
  const raw = {};
  const alias = {
    url: 'url',
    'app-name': 'app_name',
    appName: 'app_name',
    'app-id': 'app_id',
    appId: 'app_id',
    fullscreen: 'fullscreen',
    orientation: 'orientation',
    'allow-zoom': 'allow_zoom',
    'back-button': 'back_button',
    'external-links': 'external_links',
    'pull-to-refresh': 'pull_to_refresh',
    'status-bar-color': 'status_bar_color',
    'icon-base64': 'icon_base64',
    'icon-file': 'icon_file',
    'release-tag': 'release_tag',
    'icon-background': 'icon_background_color',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [flag, inline] = token.slice(2).split('=');
    const key = alias[flag];
    if (!key) continue;
    let value = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i += 1;
      } else {
        value = 'true';
      }
    }
    raw[key] = value;
  }
  return raw;
}
