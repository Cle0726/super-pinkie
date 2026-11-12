"""碧琪的更新说明：一段简短摘要 + 若干条细节。

写法（desktop/windows/release-notes.md，最上面一节就是这次发的版本）::

    ## 2.5.48

    碧琪给自己来了一次大扫除：……（摘要：一段话，碧琪口吻）

    - 细节一（碧琪口吻，用户看得懂的话）
    - 细节二

    <!-- pinkie-notes-end -->

    ## 2.5.47
    ……（往期，只留作记录，App 不读）

GitHub 发布正文、国内线路 latest.json、Mac 应用内更新、Windows 更新卡和「装好了」卡都从这里取，
所以这个文件同时被 Windows 包（PyInstaller，--paths app）和 Mac 的 stage-git-update.py 引用。
发版前用 tools/release/release_notes.py check 检查格式和口吻，规则见 docs/RELEASE-NOTES.md。
"""
from __future__ import annotations

import re

END_MARK = "<!-- pinkie-notes-end -->"
_CUT = re.compile(r"^\s*(?:\*\*Full Changelog\*\*|## What's Changed|<!-- pinkie-notes-end -->)", re.IGNORECASE)
_HEADING = re.compile(r"^##\s+(.*)$")
_BULLET = re.compile(r"^(\s*)[-*]\s+(.+)$")
_VERSION = re.compile(r"v?(\d+(?:\.\d+){1,3})")

# 细节多到这个程度，界面就先只给摘要，细节收进碧琪的展开入口里。
SUMMARY_MAX = 90
DETAIL_MAX = 80
DETAILS_MAX = 8


def _plain(text):
    return re.sub(r"\s+", " ", str(text).replace("**", "").replace("`", "")).strip()


def current_section(text, version=None):
    """Return (heading version, markdown lines) of the section users should see.

    A document with ``##`` headings is a notes file: take the section for
    ``version`` when given, else the first one. Text without headings is
    already a single section (a GitHub body or latest.json ``notes``).
    """
    lines = str(text or "").replace("\r\n", "\n").lstrip("﻿").split("\n")
    starts = [i for i, line in enumerate(lines) if _HEADING.match(line)]
    if not starts:
        body, heading = lines, ""
    else:
        index = starts[0]
        if version:
            wanted = str(version).strip().removeprefix("v")
            for i in starts:
                match = _VERSION.search(_HEADING.match(lines[i]).group(1))
                if match and match.group(1) == wanted:
                    index = i
                    break
        heading = _HEADING.match(lines[index]).group(1).strip()
        following = [i for i in starts if i > index]
        body = lines[index + 1: following[0] if following else len(lines)]
    out = []
    for line in body:
        if _CUT.match(line):
            break
        out.append(line)
    match = _VERSION.search(heading)
    return (match.group(1) if match else ""), out


def parse(text, version=None):
    """{"version", "summary", "details"} for the update dialog."""
    found, lines = current_section(text, version)
    summary, details = [], []
    for raw in lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("<!--") or stripped.startswith("#"):
            continue
        bullet = _BULLET.match(raw)
        if bullet:
            item = _plain(bullet.group(2))
            if item:
                details.append(item)
        elif not details:
            summary.append(_plain(stripped))
        else:
            # 细节下面的续行接到上一条后面。
            details[-1] = f"{details[-1]}{_plain(stripped)}"
    return {"version": found, "summary": "".join(summary).strip(), "details": details}


def as_text(parts):
    """Plain-text form for old clients and logs: summary first, one detail per line."""
    return "\n".join([x for x in [parts.get("summary", "")] + list(parts.get("details") or []) if x])


def section_markdown(text, version=None):
    """The current section as markdown (GitHub release body / latest.json notes)."""
    found, lines = current_section(text, version)
    while lines and not lines[-1].strip():
        lines.pop()
    while lines and not lines[0].strip():
        lines.pop(0)
    return f"## {found}\n\n" + "\n".join(lines) + "\n"


# 写给用户看的话里不该出现的东西：代码、路径、开发者行话。
_JARGON = [
    (re.compile(r"`"), "反引号代码"),  # 读的是原文（_plain 已去掉反引号）
    (re.compile(r"\b[A-Za-z]+_[A-Za-z0-9_*]+\b"), "代码名（带下划线）"),
    (re.compile(r"[\w-]+\.(?:mjs|js|py|ps1|sh|json|md|yml|swift|css|html)\b", re.IGNORECASE), "文件名"),
    (re.compile(r"(?:^|[\s(（])(?:[\w.-]+/){1,}[\w.-]+"), "文件路径"),
    (re.compile(r"\b(?:PR|CLI|SDK|runtime|WebView2|UND_ERR\w*|commit|refactor|patch|hotfix|regression|stack ?trace|env|config|JSON|API)\b",
                re.IGNORECASE), "开发者用语"),
    (re.compile(r"补丁|重构|回归测试|代码库|网关|注入|进程|计划\s*[A-Z]|报错栈|快照"), "开发者用语"),
]


def lint(text, version):
    """Problems that block a release; empty list means the notes are fine."""
    problems = []
    version = str(version).strip().removeprefix("v")
    found, _ = current_section(text)
    if found != version:
        problems.append(f"最上面一节是「{found or '没有版本号'}」，要写成「## {version}」：这一节就是这次要发给用户的说明。")
        return problems
    parts = parse(text, version)
    summary, details = parts["summary"], parts["details"]
    if not summary:
        problems.append("缺摘要：版本标题下面先写一段碧琪口吻的话，再列细节。")
    elif "碧琪" not in summary:
        problems.append("摘要要用碧琪的口吻（以「碧琪……」来说），不要写成产品公告。")
    if len(summary) > SUMMARY_MAX:
        problems.append(f"摘要 {len(summary)} 字，最多 {SUMMARY_MAX} 字：挑最有感的一两件说，剩下的放进细节。")
    if len(details) > DETAILS_MAX:
        problems.append(f"细节 {len(details)} 条，最多 {DETAILS_MAX} 条：合并同类，开发者才关心的写进 CHANGELOG.md。")
    for item in details:
        if len(item) > DETAIL_MAX:
            problems.append(f"这条细节 {len(item)} 字，最多 {DETAIL_MAX} 字：{item[:24]}…")
    _, raw = current_section(text, version)
    if any("`" in line for line in raw):
        problems.append("用户看不懂反引号里的代码：换成用户自己会说的话。")
    for line in [summary] + details:
        for pattern, label in _JARGON[1:]:
            hit = pattern.search(line)
            if hit:
                problems.append(f"用户看不懂的{label}「{hit.group(0).strip()}」：{line[:30]}…")
    return problems
