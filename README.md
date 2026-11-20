# 📱 web2apk

**웹페이지 주소 하나로 안드로이드 APK 를 만드는 도구.**
GitHub Actions + [Capacitor 8](https://capacitorjs.com) (targetSdk **36** / Android 16, minSdk 24) 조합이라
내 컴퓨터에 안드로이드 스튜디오가 없어도, 폰에서 버튼 한 번 누르면 APK 가 나옵니다.

- 옵션: 전체화면 · 화면 방향 · 핀치 줌 · 뒤로가기 동작 · 외부 링크 처리 · 당겨서 새로고침 · 상태바 색
- 아이콘: 이미지 업로드 / 내장 아이콘 생성기(배경색 + 글자·이모지) / 앱 이름으로 자동 생성
- 결과물: `{앱이름}-{실행번호}.apk` → Actions **Artifact**(30일) + 원하면 **GitHub Release** 태그까지

---

## 3분 세팅

### 1) 저장소 준비
이 폴더(`web2apk`)를 그대로 GitHub 저장소에 올립니다. 공개 저장소면 Actions·Pages 모두 무료입니다.

```bash
cd web2apk
git init -b main
git add .
git commit -m "web2apk: URL → APK 빌더"
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

> `android/`, `www/`, `node_modules/` 는 `.gitignore` 에 있어 올라가지 않습니다. 빌드 때마다 새로 만듭니다.

### 2) 옵션창(GitHub Pages) 켜기
저장소 → **Settings → Pages** → *Build and deployment*
- Source: **Deploy from a branch**
- Branch: **main** / 폴더: **`/docs`** → Save

1~2분 뒤 `https://<owner>.github.io/<repo>/` 에서 옵션창이 열립니다.

### 3) Fine-grained PAT 발급
GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

| 항목 | 값 |
| --- | --- |
| Repository access | Only select repositories → 이 저장소 |
| Permissions → **Actions** | **Read and write** (빌드 실행 + 진행 상황 읽기) |
| Permissions → **Contents** | **Read** (비공개 저장소일 때) |

만료일은 짧게(30일 등) 두고, 토큰은 옵션창의 PAT 칸에만 붙여 넣으세요.
**토큰은 그 브라우저의 `localStorage` 에만 저장**되고 `api.github.com` 외에는 전송되지 않습니다.

### 4) 첫 APK 빌드
옵션창에서
1. 웹페이지 주소 + 앱 이름 입력 (패키지명은 자동 제안)
2. 아이콘·옵션 선택
3. 저장소 `owner/repo`, PAT 입력
4. **🚀 APK 빌드 시작** → 상태 배지가 “빌드 중” → “성공” 으로 바뀌면 **APK 아티팩트 ↗** 링크로 이동

APK 는 실행 페이지 맨 아래 **Artifacts** 에서 내려받아 폰에서 설치합니다.
(설치 시 “출처를 알 수 없는 앱” 허용이 필요할 수 있습니다.)

> PAT 없이도 됩니다: **📋 JSON 파라미터 복사** → 저장소 **Actions → Build APK (web2apk) → Run workflow**
> 에 값을 붙여 넣고 실행하세요. 워크플로 파일은 **default 브랜치**에 있어야 API 로 실행됩니다.

---

## 입력 파라미터

| 이름 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `url` | string (필수) | – | 포장할 웹페이지 주소. `http://` 도 가능(cleartext 허용이 자동으로 켜짐) |
| `app_name` | string (필수) | – | 런처에 표시될 이름 (60자 이내) |
| `app_id` | string | `com.poeticecho.webapp` | 패키지명. 점으로 구분된 2개 이상, 각 조각은 영문자로 시작 |
| `fullscreen` | boolean | `false` | 상태바·내비바 숨김(스와이프로 잠깐 표시) |
| `orientation` | choice | `portrait` | `portrait` / `landscape` / `sensor` |
| `allow_zoom` | boolean | `false` | 핀치 줌 허용 |
| `back_button` | choice | `history_then_exit` | `history_then_exit`(웹 히스토리 → 앱 종료) / `exit_only` |
| `external_links` | choice | `system_browser` | `system_browser`(외부 도메인은 브라우저) / `in_app`(모두 앱 안) |
| `pull_to_refresh` | boolean | `false` | 당겨서 새로고침 |
| `status_bar_color` | string | `#111827` | 상태바 색 (`#RGB`/`#RRGGBB`) |
| `icon_base64` | string | – | PNG 아이콘 base64 (선택, 약 1MB 까지) |
| `release_tag` | string | – | 넣으면 GitHub Release 로도 배포 (예: `v1.0.0`) |

API 로 실행:

```bash
curl -X POST \
  -H "Authorization: Bearer $PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/actions/workflows/build-apk.yml/dispatches \
  -d '{"ref":"main","inputs":{"url":"https://example.com","app_name":"예제","fullscreen":true}}'
```

(`repository_dispatch` 이벤트도 같은 입력 이름으로 받습니다. 워크플로가 두 트리거를 모두 지원합니다.)

---

## 아이콘 3가지

| 방법 | 어떻게 | 비고 |
| --- | --- | --- |
| **만들기** | 옵션창에서 배경색 + 글자/이모지 → 실시간 미리보기 → base64 로 전송 | 가장 간편. 한글·이모지 OK |
| **업로드** | 이미지 파일을 끌어다 놓으면 가운데를 잘라 1024×1024 PNG 로 변환 | 사진은 용량이 커서 400KB 를 넘으면 경고 |
| **저장소 파일** | 저장소에 `assets/icon.png`(1024×1024) 를 커밋해 두면 자동으로 사용 | GitHub 웹 UI 로 빌드할 때 유용 (입력 길이 제한 없음) |
| **자동** | 아무 것도 안 보내면 앱 이름 첫 글자로 생성 (Pillow, 한글 폰트 지원) | 실패 시 순수 JS 로 대체 |

아이콘·스플래시 리소스는 [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets) 가
`assets/icon.png` 하나에서 mipmap/adaptive icon/스플래시 전체를 만들어 냅니다.

---

## 로컬에서 실행 (APK 까지)

필요: Node 20+, JDK 21, Android SDK(platform 36, build-tools 36.0.0)

```bash
npm ci
node scripts/generate-project.mjs prepare \
  --url https://example.com --app-name "예제 앱" \
  --app-id com.poeticecho.example --fullscreen --orientation landscape --pull-to-refresh
npx cap add android
node scripts/generate-project.mjs patch
npx @capacitor/assets generate --android --iconBackgroundColor "#111827" --splashBackgroundColor "#111827"
npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

`node scripts/generate-project.mjs all --url ... --app-name ...` 로 prepare+patch 를 한 번에 할 수도 있습니다
(`android/` 가 이미 있을 때).

---

## 릴리스 서명 (선택)

저장소 → **Settings → Secrets and variables → Actions** 에 아래를 넣으면 `assembleRelease` 로 빌드하고
서명된 APK 를 올립니다. 없으면 debug APK 로 빌드합니다.

| 시크릿 | 설명 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `.jks` 파일을 `base64 -w0 keystore.jks` 한 값 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | 키 별칭 |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 (없으면 키스토어 비밀번호 사용) |

```bash
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias web2apk
base64 -w0 release.jks   # → ANDROID_KEYSTORE_BASE64
```

---

## 무엇이 생성되나

| 파일 | 반영되는 옵션 |
| --- | --- |
| `capacitor.config.json` | 대상 URL, `allowNavigation`(외부 링크 정책), cleartext, 스플래시 |
| `android/.../MainActivity.java` | 전체화면, 뒤로가기, 핀치 줌, 당겨서 새로고침, 상태바/내비바 색, 인셋 |
| `android/.../AndroidManifest.xml` | INTERNET 권한, 화면 방향, cleartext 허용 |
| `android/.../res/values/{colors,styles,strings}.xml` | 상태바·배경 색, 라이트 아이콘 여부, 앱 이름 |
| `android/app/build.gradle` | namespace/applicationId, 버전, SwipeRefreshLayout 의존성 |
| `android/.../res/mipmap-*`, `drawable*` | 런처 아이콘, 어댑티브 아이콘, 스플래시 |

생성 파일은 모두 “자동 생성” 주석이 붙어 있습니다. 옵션을 바꾸려면 워크플로 입력을 바꿔 다시 빌드하세요.

---

## 검증

저장소에 테스트가 들어 있습니다. (CI 에 넣지 않아도 되고, 로컬에서 언제든 돌릴 수 있습니다.)

```bash
npm ci
npm test                          # 생성기: 34개 옵션 조합 + 입력 오류 10종 + CLI
python3 tests/validate_workflow.py  # 워크플로 YAML/입력/스텝 (actionlint 있으면 함께)
python3 tests/ui_test.py            # 옵션창 UI (Playwright, 71개 검사)
```

| 테스트 | 확인하는 것 |
| --- | --- |
| `tests/run-generator-tests.mjs` | 전체화면·방향·줌·뒤로가기·외부링크·새로고침·색·http/https·아이콘 조합에서 `capacitor.config.json`, `www`, `MainActivity.java`, `AndroidManifest.xml`, `colors/styles/strings`, `build.gradle` 이 기대대로 생성되는지. XML well-formed, Java 문법(javac), patch 멱등성, 잘못된 입력 거부 |
| `tests/validate_workflow.py` | YAML 문법, 12개 입력의 타입/기본값/필수 여부, 트리거 2종, 권한, 스텝 명령, 셸 인젝션 방지(`run:` 에 `inputs` 직접 보간 금지) |
| `tests/ui_test.py` | 콘솔/page error 0건, URL 검증·스킴 보정, 패키지명 자동 생성, 아이콘 캔버스(글자·색·랜덤·업로드 크롭), 토글→미리보기, localStorage 저장/복원, `workflow_dispatch` payload, API 호출·폴링·성공 배지, 403 안내, 모바일 레이아웃 |

`tests/screenshots/` 에 라이트/다크/모바일 화면 캡처가 있습니다.

## 알려진 한계

- **상태바 색**: Android 14 이하에서는 `setStatusBarColor` 로 그대로 칠해집니다. Android 15+ 는 edge-to-edge 가
  강제되어 시스템이 무시하므로, 같은 색을 `windowBackground` 로 깔아 상태바 자리에 같은 색이 보이게 했습니다
  (기기·제스처 설정에 따라 시스템 스크림이 살짝 다를 수 있음).
- **외부 링크 `system_browser`**: 같은 사이트와 그 서브도메인만 앱 안에서 열립니다. 구글·카카오 로그인처럼
  다른 도메인으로 넘어가는 흐름은 브라우저로 빠지므로, 그런 사이트는 `in_app` 을 쓰세요.
- **아이콘 base64**: GitHub API 입력 길이 제한 때문에 약 1MB 를 넘으면 실패할 수 있습니다. 큰 사진은
  `assets/icon.png` 로 커밋하는 방식을 권장합니다.
- APK 는 **debug 서명**(또는 직접 넣은 키)이며 Play 스토어 업로드용 AAB 는 만들지 않습니다.
- 웹페이지가 앱 전용 API(카메라·알림·결제 등 네이티브 기능)를 요구하면 동작하지 않습니다. 순수 웹페이지만 감쌉니다.
- `http://` 대상은 cleartext 를 허용하지만, Android 9+ 정책상 일부 페이지는 여전히 차단될 수 있습니다.

---

## 문제 해결

| 증상 | 확인 |
| --- | --- |
| `404` / “워크플로를 찾을 수 없습니다” | 저장소 이름·브랜치 확인, `.github/workflows/build-apk.yml` 이 **default 브랜치**에 있는지 |
| `403` | PAT 권한에 `Actions: Read and write` 추가 (비공개 저장소면 `Contents: Read` 도) |
| `422` | 아이콘이 너무 크거나 필수 입력 누락. 아이콘을 빼고 다시 시도 |
| 빌드는 성공했는데 앱이 흰 화면 | 대상 URL 이 WebView 에서 막히는지(iframe/X-Frame-Options, 로그인 리다이렉트) 확인 후 `external_links: in_app` 시도 |
| 앱이 인터넷 페이지를 못 여는 것 같다 | URL 에 `https://` 가 붙어 있는지, 사이트가 모바일 UA 를 막지 않는지 확인 |
| 아이콘이 작아 보인다 | 어댑티브 아이콘 안전 영역 때문에 여백이 생깁니다. 글자를 조금 크게/굵게 |

---

## 구조

```
web2apk/
├─ .github/workflows/build-apk.yml   # workflow_dispatch + repository_dispatch
├─ docs/index.html                   # 옵션창 (GitHub Pages, 의존성 없는 단일 파일)
├─ scripts/
│  ├─ generate-project.mjs           # CLI: prepare / patch / all
│  ├─ resolve-inputs.mjs             # 워크플로 입력 검증 → .web2apk/options.json + outputs
│  ├─ signing.mjs                    # (선택) release 서명 설정
│  ├─ make-icon.py                   # Pillow 기본 아이콘 생성
│  └─ lib/{options,generate,icon,render,log}.mjs
├─ templates/                        # MainActivity.java, AndroidManifest.xml, styles/colors/strings, www
├─ tests/                            # 생성기 매트릭스 테스트, UI(Playwright) 테스트
└─ package.json                      # Capacitor 8 · @capacitor/assets
```

## 라이선스

MIT
