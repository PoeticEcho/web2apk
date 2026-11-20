#!/usr/bin/env python3
"""docs/index.html 옵션창 UI 테스트 (Playwright + headless Chromium).

    pip install playwright && playwright install chromium
    python3 tests/ui_test.py [--headed] [--screenshot-dir DIR]

검증 항목
  1. JS 콘솔 에러 / page error 0건
  2. URL 유효성 검사 · 스킴 자동 보정
  3. 앱 이름 → 패키지명 자동 제안 (서버 규칙과 동일)
  4. 아이콘 스튜디오: 캔버스 생성기(글자/색/랜덤), 업로드 크롭, 자동 모드
  5. 토글/방향/색 변경이 미리보기·payload 에 반영
  6. localStorage 저장(설정·저장소·토큰)
  7. workflow_dispatch payload 생성 + API 호출 + 폴링 → 성공 배지/링크
  8. JSON 파라미터 복사 버튼
  9. 모바일 뷰포트 레이아웃(가로 스크롤 없음)
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import socketserver
import sys
import tempfile
import threading
import time
import traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if condition:
        print(f"  ✓ {message}")
    else:
        print(f"  ✗ {message}")
        failures.append(message)


def serve(directory: str):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)

    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    httpd = Server(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/index.html"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--screenshot-dir", default=os.path.join(ROOT, "tests", "screenshots"))
    args = parser.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright 가 설치되어 있지 않습니다: pip install playwright && playwright install chromium")
        return 2

    os.makedirs(args.screenshot_dir, exist_ok=True)
    httpd, url = serve(DOCS)
    console_errors: list[str] = []
    page_errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        context = browser.new_context(viewport={"width": 1280, "height": 960}, locale="ko-KR")
        page = context.new_page()
        page.on("console", lambda msg: console_errors.append(f"{msg.type}: {msg.text}") if msg.type in ("error", "warning") else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("dialog", lambda dialog: dialog.dismiss())

        page.goto(url, wait_until="load")
        page.wait_for_timeout(300)

        print("UI 테스트 —", url)

        # ---------------------------------------------------------- 1. 기본 렌더
        check(page.title().startswith("web2apk"), "페이지 제목이 web2apk")
        check(page.is_visible("#buildBtn"), "빌드 버튼 표시")
        check(page.eval_on_selector_all(".card", "els => els.length") >= 4, "카드 섹션 4개 이상")
        theme = page.get_attribute("html", "data-theme")
        check(theme in ("dark", "light"), f"기본 테마 설정됨 ({theme})")

        # ---------------------------------------------------------- 2. 테마 토글 + 저장
        page.click("#themeToggle")
        after = page.get_attribute("html", "data-theme")
        check(after != theme, "테마 토글로 테마 변경")
        check(page.evaluate("localStorage.getItem('web2apk.theme')") == after, "테마가 localStorage 에 저장")
        page.click("#themeToggle")

        # ---------------------------------------------------------- 3. URL 검증
        page.fill("#url", "not a url")
        page.wait_for_timeout(120)
        check(page.is_visible("#urlErr"), "공백 포함 URL → 오류 표시")
        check(page.get_attribute("#url", "aria-invalid") == "true", "URL 입력에 aria-invalid 설정")

        page.fill("#url", "example.com")
        page.wait_for_timeout(120)
        check(not page.is_visible("#urlErr"), "스킴 없는 주소는 통과")
        payload_url = page.evaluate("window.web2apk.buildInputs().url")
        check(payload_url == "https://example.com/", f"스킴 자동 보정 https://example.com/ ({payload_url})")

        page.fill("#url", "https://m.blog.example.co.kr/post/1?x=2")
        page.wait_for_timeout(120)
        check(page.inner_text("#previewHost") == "m.blog.example.co.kr", "미리보기에 호스트 반영")

        # ---------------------------------------------------------- 4. 패키지명 자동 제안
        page.fill("#appName", "수성구 맛집")
        page.wait_for_timeout(150)
        app_id = page.input_value("#appId")
        check(app_id == "com.poeticecho.app7r6w", f"한글 앱 이름 → 패키지명 자동 제안 ({app_id})")

        page.fill("#appName", "My Photo Blog")
        page.wait_for_timeout(150)
        check(page.input_value("#appId") == "com.poeticecho.myphotoblog", f"영문 이름 슬러그 ({page.input_value('#appId')})")

        # 사용자가 고친 뒤에는 이름을 바꿔도 유지
        page.fill("#appId", "com.poeticecho.custom")
        page.fill("#appName", "다른 이름")
        page.wait_for_timeout(150)
        check(page.input_value("#appId") == "com.poeticecho.custom", "직접 고친 패키지명은 유지")

        page.click("#appIdSuggest")
        page.wait_for_timeout(100)
        check(page.input_value("#appId").startswith("com.poeticecho."), "‘자동’ 버튼으로 다시 제안")

        # 잘못된 패키지명
        page.fill("#appId", "1bad")
        page.wait_for_timeout(100)
        check(page.is_visible("#appIdErr"), "잘못된 패키지명 → 오류 표시")

        page.fill("#appName", "테스트 앱")
        page.click("#appIdSuggest")
        page.wait_for_timeout(100)

        # ---------------------------------------------------------- 5. 아이콘 스튜디오
        def canvas_signature(selector: str) -> str:
            # 캔버스 전체를 그대로 비교하기 위해 PNG data URL 을 쓴다(동일 렌더 → 동일 문자열).
            if selector == "#iconCanvas":
                return page.evaluate("window.web2apk.iconDataUrl()")
            return page.evaluate(
                """(sel) => {
                    const c = document.querySelector(sel);
                    return c.toDataURL('image/png');
                }""",
                selector,
            )

        check(page.get_attribute("#tabGenerate", "aria-selected") == "true", "기본 탭은 ‘만들기’")
        sig_default = canvas_signature("#iconCanvas")
        check(sig_default.startswith("data:image/png") and len(sig_default) > 5000, "아이콘 캔버스가 그려짐")

        page.fill("#iconText", "수")
        page.wait_for_timeout(150)
        sig_text = canvas_signature("#iconCanvas")
        check(sig_text != sig_default, "글자를 바꾸면 아이콘이 다시 그려짐")

        page.fill("#iconBgHex", "#10B981")
        page.dispatch_event("#iconBgHex", "change")
        page.wait_for_timeout(150)
        check(page.input_value("#iconBg").upper() == "#10B981", "HEX 입력 → 색상 피커 동기화")
        check(canvas_signature("#iconCanvas") != sig_text, "배경색 변경이 아이콘에 반영")

        page.click("#iconRandom")
        page.wait_for_timeout(150)
        check(canvas_signature("#iconCanvas") != sig_text, "랜덤 색 조합 동작")

        data_url = page.evaluate("window.web2apk.iconDataUrl()")
        check(data_url.startswith("data:image/png;base64,") and len(data_url) > 5000, "PNG data URL 생성(>5KB)")

        # 업로드 (가로 사진 → 정사각 크롭)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            from PIL import Image  # 테스트용 이미지 생성

            Image.new("RGB", (900, 400), (200, 60, 60)).save(tmp_path)
        except Exception:
            # Pillow 가 없으면 1x1 PNG 바이트로 대체
            import base64

            with open(tmp_path, "wb") as fh:
                fh.write(base64.b64decode(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))

        page.click("#tabUpload")
        page.set_input_files("#iconFile", tmp_path)
        page.wait_for_timeout(400)
        check(page.evaluate("window.web2apk.iconMode()") == "upload", "업로드 모드로 전환")
        check(page.inner_text("#iconMeta").startswith("1024×1024"), f"업로드 이미지 1024 정사각 크롭 ({page.inner_text('#iconMeta')})")
        sig_upload = canvas_signature("#iconCanvas")
        check(sig_upload != sig_text, "업로드한 이미지가 아이콘에 반영")

        # 자동 모드
        page.click("#tabAuto")
        page.wait_for_timeout(200)
        check(page.evaluate("window.web2apk.iconMode()") == "auto", "자동 모드 전환")
        check(page.evaluate("window.web2apk.buildInputs().icon_base64") is None, "자동 모드에서는 icon_base64 를 보내지 않음")

        page.click("#tabGenerate")
        page.wait_for_timeout(150)
        check("icon_base64" in page.evaluate("Object.keys(window.web2apk.buildInputs())"), "만들기 모드에서는 icon_base64 포함")

        # ---------------------------------------------------------- 6. 옵션 → 미리보기/payload
        page.check("#fullscreen")
        page.wait_for_timeout(120)
        check(page.eval_on_selector("#phone", "el => el.classList.contains('fullscreen')"), "전체화면 → 미리보기에서 상태바 숨김")

        page.check("input[name='orientation'][value='landscape']")
        page.wait_for_timeout(120)
        check(page.eval_on_selector("#phone", "el => el.classList.contains('landscape')"), "가로 → 미리보기 가로 전환")

        page.fill("#statusColorHex", "#ff6b00")
        page.dispatch_event("#statusColorHex", "change")
        page.wait_for_timeout(150)
        check(page.input_value("#statusColor") == "#ff6b00", "상태바 색 HEX 동기화")
        style_color = page.eval_on_selector("#phone", "el => getComputedStyle(el).getPropertyValue('--status-color').trim()")
        check(style_color.lower() == "#ff6b00", f"미리보기 상태바 색 반영 ({style_color})")

        page.check("#allowZoom")
        page.check("#pullToRefresh")
        page.check("input[name='backButton'][value='exit_only']")
        page.check("input[name='externalLinks'][value='in_app']")
        page.wait_for_timeout(150)

        inputs = page.evaluate("window.web2apk.buildInputs()")
        expected = {
            "url": "https://m.blog.example.co.kr/post/1?x=2",
            "app_name": "테스트 앱",
            "fullscreen": True,
            "orientation": "landscape",
            "allow_zoom": True,
            "back_button": "exit_only",
            "external_links": "in_app",
            "pull_to_refresh": True,
            "status_bar_color": "#FF6B00",
        }
        for key, value in expected.items():
            check(inputs.get(key) == value, f"payload.{key} == {value!r} (실제 {inputs.get(key)!r})")
        check(set(inputs).issubset({
            "url", "app_name", "app_id", "fullscreen", "orientation", "allow_zoom",
            "back_button", "external_links", "pull_to_refresh", "status_bar_color",
            "icon_base64", "release_tag",
        }), "payload 키가 워크플로 입력 이름과 일치")
        check(isinstance(inputs.get("icon_base64"), str) and len(inputs["icon_base64"]) > 1000, "icon_base64 가 base64 문자열")

        # ---------------------------------------------------------- 7. localStorage
        page.fill("#repo", "poeticecho/web2apk")
        page.fill("#ref", "main")
        page.fill("#token", "github_pat_test_token")
        page.wait_for_timeout(250)
        check(page.evaluate("localStorage.getItem('web2apk.repo')") == "poeticecho/web2apk", "저장소 localStorage 저장")
        check(page.evaluate("localStorage.getItem('web2apk.token')") == "github_pat_test_token", "토큰 localStorage 저장")
        settings = json.loads(page.evaluate("localStorage.getItem('web2apk.settings.v1')"))
        check(settings.get("appName") == "테스트 앱" and settings.get("orientation") == "landscape", "설정 localStorage 저장")
        check(page.evaluate("localStorage.getItem('web2apk.icon.v1')") is not None, "아이콘 설정 저장")
        check(page.get_attribute("#openActionsBtn", "href").endswith("/actions/workflows/build-apk.yml"), "Actions 바로가기 링크")

        page.screenshot(path=os.path.join(args.screenshot_dir, "ui-desktop.png"), full_page=True)

        # 다크 테마 스크린샷 + 명암 대비 확인
        dark_context = browser.new_context(viewport={"width": 1280, "height": 960}, locale="ko-KR", color_scheme="dark")
        dark_page = dark_context.new_page()
        dark_page.goto(url, wait_until="load")
        dark_page.wait_for_timeout(400)
        check(dark_page.get_attribute("html", "data-theme") == "dark", "시스템 다크 모드 → 다크 테마 자동 적용")
        dark_page.screenshot(path=os.path.join(args.screenshot_dir, "ui-dark.png"), full_page=True)
        dark_context.close()

        # ---------------------------------------------------------- 8. dispatch + 폴링
        captured = {}

        def handle_api(route):
            req = route.request
            if req.method == "POST" and "/dispatches" in req.url:
                captured["url"] = req.url
                captured["headers"] = req.headers
                captured["body"] = json.loads(req.post_data or "{}")
                route.fulfill(status=204, body="")
                return
            if "/actions/runs/" in req.url and req.url.endswith("/jobs"):
                route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "jobs": [{"steps": [
                        {"name": "Checkout", "status": "completed", "conclusion": "success"},
                        {"name": "Build APK", "status": "in_progress", "conclusion": None},
                    ]}]
                }))
                return
            if "/actions/runs/" in req.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "id": 777, "run_number": 12, "status": "completed", "conclusion": "success",
                    "created_at": captured.get("created_at"), "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 300)),
                    "html_url": "https://github.com/poeticecho/web2apk/actions/runs/777",
                    "head_branch": "main", "event": "workflow_dispatch",
                }))
                return
            if "/runs?" in req.url or req.url.endswith("/runs"):
                route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "workflow_runs": [{
                        "id": 777, "run_number": 12, "status": "completed", "conclusion": "success",
                        "created_at": captured.get("created_at"),
                        "html_url": "https://github.com/poeticecho/web2apk/actions/runs/777",
                        "head_branch": "main",
                    }]
                }))
                return
            route.fulfill(status=404, body="{}")

        page.route("https://api.github.com/**", handle_api)
        page.click("#buildBtn")
        captured["created_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 1))
        page.wait_for_timeout(2500)

        check(captured.get("url", "").endswith("/repos/poeticecho/web2apk/actions/workflows/build-apk.yml/dispatches"), f"dispatch URL ({captured.get('url')})")
        check(captured.get("headers", {}).get("authorization", "").startswith("Bearer github_pat_"), "Authorization 헤더")
        body = captured.get("body", {})
        check(body.get("ref") == "main", "payload.ref == main")
        check(body.get("inputs", {}).get("app_name") == "테스트 앱", "dispatch inputs.app_name")
        check(body.get("inputs", {}).get("fullscreen") is True, "dispatch inputs.fullscreen")
        check(page.is_visible("#statusBox"), "상태 박스 표시")
        badge_text = page.inner_text("#statusHeadline")
        check("성공" in badge_text, f"성공 배지 표시 ({' '.join(badge_text.split())})")
        links = page.eval_on_selector_all("#statusLinks a", "els => els.map(e => e.href)")
        check(any("runs/777" in href for href in links), "실행 페이지 링크 표시")
        check(len(page.eval_on_selector_all("#statusSteps li", "els => els")) >= 1, "단계 목록 렌더")

        # ---------------------------------------------------------- 9. JSON 복사
        page.click("#copyJsonBtn")
        page.wait_for_timeout(300)
        check(page.is_visible("#jsonBox"), "JSON 파라미터 박스 표시")
        json_text = page.input_value("#jsonBox")
        check('"app_name": "테스트 앱"' in json_text, "복사 JSON 에 app_name 포함")
        check("build-apk.yml" in json_text, "복사 JSON 에 워크플로 파일명 포함")

        # ---------------------------------------------------------- 10. 실패 경로 (403)
        def handle_403(route):
            route.fulfill(status=403, content_type="application/json", body=json.dumps({"message": "Resource not accessible by integration"}))

        page.unroute("https://api.github.com/**")
        page.route("https://api.github.com/**", handle_403)
        page.click("#buildBtn")
        page.wait_for_timeout(900)
        check("권한" in page.inner_text("#statusBox"), "403 → 권한 안내 메시지")
        page.unroute("https://api.github.com/**")

        # ---------------------------------------------------------- 11. 모바일 레이아웃
        mobile = context.new_page()
        mobile.set_viewport_size({"width": 390, "height": 844})
        mobile.goto(url, wait_until="load")
        mobile.wait_for_timeout(300)
        overflow = mobile.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(overflow <= 1, f"모바일 가로 스크롤 없음 (overflow {overflow}px)")
        check(mobile.is_visible("#buildBtn"), "모바일에서 빌드 버튼 보임")
        mobile.screenshot(path=os.path.join(args.screenshot_dir, "ui-mobile.png"), full_page=True)
        mobile.close()

        # ---------------------------------------------------------- 12. 새로고침 후 복원
        page.reload(wait_until="load")
        page.wait_for_timeout(400)
        check(page.input_value("#repo") == "poeticecho/web2apk", "새로고침 후 저장소 복원")
        check(page.input_value("#token") == "github_pat_test_token", "새로고침 후 토큰 복원")
        check(page.input_value("#appName") == "테스트 앱", "새로고침 후 앱 이름 복원")
        check(page.is_checked("#fullscreen"), "새로고침 후 전체화면 토글 복원")

        # ---------------------------------------------------------- 콘솔 에러
        ignorable = ("Failed to load resource", "ERR_FAILED", "the server responded with a status of 403")
        real_console_errors = [e for e in console_errors if not any(token in e for token in ignorable)]
        check(len(page_errors) == 0, f"page error 0건 ({page_errors[:2]})")
        check(len(real_console_errors) == 0, f"콘솔 에러 0건 ({real_console_errors[:3]})")

        browser.close()

    httpd.shutdown()
    print()
    print(f"검사 {checks}개 · 실패 {len(failures)}개")
    if failures:
        for f in failures:
            print("  -", f)
        return 1
    print("모든 UI 검사 통과")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        sys.exit(3)
