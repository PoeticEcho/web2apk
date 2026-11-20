#!/usr/bin/env python3
"""워크플로 YAML 검증.

    python3 tests/validate_workflow.py [--actionlint PATH]

1. YAML 문법
2. 트리거/입력 정의(이름·타입·기본값·필수 여부) — docs/index.html 의 payload 키와 같은지
3. 권한·러너·필수 스텝 존재
4. (선택) actionlint 로 표현식/컨텍스트 검사
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW = os.path.join(ROOT, ".github", "workflows", "build-apk.yml")
DOCS = os.path.join(ROOT, "docs", "index.html")

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    print(("  ✓ " if condition else "  ✗ ") + message)
    if not condition:
        failures.append(message)


EXPECTED_INPUTS = {
    # 이름: (타입, 기본값, 필수)
    "url": ("string", None, True),
    "app_name": ("string", None, True),
    "app_id": ("string", "com.poeticecho.webapp", False),
    "fullscreen": ("boolean", False, False),
    "orientation": ("choice", "portrait", False),
    "allow_zoom": ("boolean", False, False),
    "back_button": ("choice", "history_then_exit", False),
    "external_links": ("choice", "system_browser", False),
    "pull_to_refresh": ("boolean", False, False),
    "status_bar_color": ("string", "#111827", False),
    "icon_base64": ("string", "", False),
    "release_tag": ("string", "", False),
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--actionlint", default=os.environ.get("ACTIONLINT", "actionlint"))
    args = parser.parse_args()

    print("워크플로 검증 —", os.path.relpath(WORKFLOW, ROOT))
    with open(WORKFLOW, encoding="utf-8") as fh:
        text = fh.read()

    try:
        data = yaml.safe_load(text)
        check(True, "YAML 문법 통과")
    except yaml.YAMLError as exc:
        print("  ✗ YAML 파싱 실패:", exc)
        return 1

    # YAML 의 `on` 은 불리언 True 로 파싱된다(PyYAML 1.1)
    triggers = data.get("on") or data.get(True)
    check(isinstance(triggers, dict), "on 절이 매핑")

    dispatch = triggers.get("workflow_dispatch", {})
    inputs = dispatch.get("inputs", {})
    check(set(inputs) == set(EXPECTED_INPUTS), f"입력 이름 12개 일치 (실제 {sorted(inputs)})")

    for name, (kind, default, required) in EXPECTED_INPUTS.items():
        spec = inputs.get(name, {})
        check(spec.get("type") == kind, f"{name}.type == {kind}")
        check(bool(spec.get("required", False)) == required, f"{name}.required == {required}")
        if default is not None:
            check(spec.get("default") == default, f"{name}.default == {default!r} (실제 {spec.get('default')!r})")

    check(inputs["orientation"].get("options") == ["portrait", "landscape", "sensor"], "orientation 선택지")
    check(inputs["back_button"].get("options") == ["history_then_exit", "exit_only"], "back_button 선택지")
    check(inputs["external_links"].get("options") == ["system_browser", "in_app"], "external_links 선택지")

    repo_dispatch = triggers.get("repository_dispatch") or {}
    check(repo_dispatch.get("types") == ["web2apk"], "repository_dispatch 트리거")

    check(data.get("permissions", {}).get("contents") == "write", "contents: write 권한(Release 업로드)")

    job = data["jobs"]["build"]
    check(job.get("runs-on") == "ubuntu-latest", "runs-on ubuntu-latest")
    check(isinstance(job.get("timeout-minutes"), int), "timeout 설정")

    steps = job["steps"]
    uses = [s.get("uses", "") for s in steps]
    runs = "\n".join(s.get("run", "") for s in steps)

    check(any(u.startswith("actions/checkout@") for u in uses), "checkout 스텝")
    check(any(u.startswith("actions/setup-node@") for u in uses), "setup-node 스텝")
    check(any(u.startswith("actions/setup-java@") for u in uses), "setup-java 스텝")
    check(any(u.startswith("android-actions/setup-android@") for u in uses), "setup-android 스텝")
    check(any(u.startswith("actions/upload-artifact@") for u in uses), "upload-artifact 스텝")
    check(any(u.startswith("softprops/action-gh-release@") for u in uses), "Release 스텝")

    for needle in [
        "node scripts/resolve-inputs.mjs",
        "node scripts/generate-project.mjs prepare",
        "npx cap add android",
        "node scripts/generate-project.mjs patch",
        "capacitor/assets generate",
        "npx cap sync android",
        "gradlew",
    ]:
        check(needle in runs, f"스텝 명령 포함: {needle}")

    java = next((s for s in steps if s.get("uses", "").startswith("actions/setup-java@")), {})
    check(java.get("with", {}).get("java-version") in ("21", 21), "Java 21")
    node = next((s for s in steps if s.get("uses", "").startswith("actions/setup-node@")), {})
    check(str(node.get("with", {}).get("node-version")) == "22", "Node 22")

    # 스텝 입력(uses)은 모두 키가 유효해야 한다 — actionlint 가 있으면 위임
    with open(DOCS, encoding="utf-8") as fh:
        docs = fh.read()
    missing = [name for name in inputs if not re.search(r"\b" + re.escape(name) + r"\b", docs)]
    check(not missing, f"docs/index.html payload 키가 워크플로 입력과 대응 (누락: {missing})")

    # 입력 이름이 셸에 직접 보간되지 않는지(인젝션 방지): run: 안에 ${{ inputs.* }} 금지
    unsafe = [s.get("name") for s in steps if re.search(r"run:\s*[\s\S]*?\$\{\{\s*inputs\.", str(s))]
    check(not unsafe, f"run: 안에 inputs 직접 보간 없음 ({unsafe})")

    actionlint_path = shutil.which(args.actionlint) if args.actionlint else None
    if actionlint_path:
        result = subprocess.run([actionlint_path, WORKFLOW], capture_output=True, text=True)
        check(result.returncode == 0, f"actionlint 통과 ({result.stdout.strip()[:200]})")
    else:
        print("  · actionlint 없음 — 건너뜀")

    print()
    print(f"검사 {checks}개 · 실패 {len(failures)}개")
    if failures:
        return 1
    print("워크플로 검증 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
