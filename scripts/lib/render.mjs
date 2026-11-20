/**
 * 아주 작은 템플릿 렌더러.
 * templates/*.tmpl 안의 __TOKEN__ 을 값으로 바꾼다. 값은 상황에 맞는 이스케이프 함수를 거친다.
 */

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function escapeJavaString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 안드로이드 문자열 리소스(<string>)에 넣을 때: XML + 작은따옴표 이스케이프 */
export function escapeAndroidString(value) {
  return escapeXml(String(value).replace(/\\/g, '\\\\'));
}

/**
 * 템플릿 렌더. vars 값이 함수면 (원본 값 없이) 그대로 호출한다.
 * @param {string} template
 * @param {Record<string, string|number|boolean>} vars
 */
export function render(template, vars) {
  const rendered = template.replace(/__([A-Z0-9_]+)__/g, (match, key) => {
    if (!(key in vars)) return match;
    const value = vars[key];
    return String(value);
  });
  return rendered;
}

/** 치환되지 않고 남은 __TOKEN__ 이 있으면 알려 준다(템플릿 오타 방지). */
export function findUnresolvedTokens(text) {
  return [...new Set((text.match(/__[A-Z0-9_]+__/g) ?? []))];
}

export function assertNoUnresolvedTokens(text, label) {
  const left = findUnresolvedTokens(text);
  if (left.length > 0) {
    throw new Error(`[${label}] 치환되지 않은 템플릿 토큰: ${left.join(', ')}`);
  }
}
