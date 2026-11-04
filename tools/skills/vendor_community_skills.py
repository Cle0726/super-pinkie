"""按 skills/community-skills.json 把社区技能收进 skills/：带上原许可证、来源和版本。
用法：python3 -I tools/skills/vendor_community_skills.py [--cache 已克隆的目录]
已存在的同名目录会整个换成上游版本（社区技能不在本仓库里改；要改就在 SOURCE.md 里记）。"""
import fnmatch, json, pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SKILLS = ROOT / "skills"
manifest = json.loads((SKILLS / "community-skills.json").read_text(encoding="utf-8"))
cache = pathlib.Path(sys.argv[sys.argv.index("--cache") + 1]) if "--cache" in sys.argv else ROOT / ".cache" / "community-skills"
cache.mkdir(parents=True, exist_ok=True)
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".DS_Store"}
# 样片视频只是上游的成品展示，碧琪用不上（旁边有同名 .html 源文件）；不随安装包发。
SKIP_SUFFIXES = {".mp4", ".mov", ".webm", ".mkv"}
MAX_FILE = 8 * 1024 * 1024

def pinned(target):
    """GitHub 网页下载的文件夹（git 一直断时用）：里面的 .pinned-commit 记着版本。"""
    marker = target / ".pinned-commit"
    return marker.read_text().strip() if marker.is_file() else ""

def fetch_raw(info, wanted, target):
    """不用 git：查 GitHub 文件树，只下要用的那几个文件夹里的文件（跳过样片视频）。"""
    import time, urllib.request
    def get(url, binary=False):
        for attempt in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "pinkie-vendor"}), timeout=60) as r:
                    return r.read()
            except Exception:
                if attempt == 4: raise
                time.sleep(2 + attempt * 2)
    sha = json.loads(get(f"https://api.github.com/repos/{info['repo']}/commits/{info['commit']}"))["sha"]
    tree = json.loads(get(f"https://api.github.com/repos/{info['repo']}/git/trees/{sha}?recursive=1"))["tree"]
    roots = [w for w in wanted if w not in (".", "")]
    whole = len(roots) < len(wanted)
    for entry in tree:
        path = entry["path"]
        if entry["type"] != "blob" or pathlib.PurePosixPath(path).suffix.lower() in SKIP_SUFFIXES:
            continue
        top = "/" not in path and path.split(".")[0].upper() in ("LICENSE", "NOTICE", "README")
        if not (whole or top or any(path == r or path.startswith(r + "/") for r in roots)):
            continue
        out = target / path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(get(f"https://raw.githubusercontent.com/{info['repo']}/{sha}/{path}", True))
    (target / ".pinned-commit").write_text(sha)
    print(f"  {info['repo']}: 用文件树下载（git 没拉下来）")

def checkout(key, info):
    """只拉需要的那几个文件夹（稀疏检出），不把整个仓库下下来。"""
    target = cache / info["repo"].replace("/", "_")
    if pinned(target):
        if not pinned(target).startswith(info["commit"]):
            sys.exit(f"{info['repo']}: 缓存是 {pinned(target)[:7]}，清单要 {info['commit']}")
        return target
    # 「第一次用时下载」的大技能这里只要它的 SKILL.md（写说明用）。
    wanted = [i["path"].removeprefix("./").strip("/") + ("/SKILL.md" if i.get("fetch") else "") for i in manifest["skills"] if i["from"] == key]
    paths = sorted({"/*" if w in (".", "") else (f"/{w}" if w.endswith(".md") else f"/{w}/") for w in wanted})
    def present(w):
        return w in (".", "") or (target / w).is_file() or (target / w / "SKILL.md").is_file()
    if target.exists() and all(present(w) for w in wanted) and any((target / w).exists() for w in wanted if w not in (".", "")) | (not [w for w in wanted if w not in (".", "")]):
        paths = []  # 已经检出过了
    for attempt in range(3):
        if not paths:
            break
        if not target.exists():
            subprocess.run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", f"https://github.com/{info['repo']}.git", str(target)], check=False)
        ok = target.exists() and subprocess.run(["git", "-C", str(target), "sparse-checkout", "set", "--no-cone", *paths, "/LICENSE*", "/NOTICE*", "/README*"]).returncode == 0 and all(present(w) for w in wanted)
        if ok:
            break
        shutil.rmtree(target, ignore_errors=True)  # 网络断了留下的半截仓库：删掉重来
    else:
        shutil.rmtree(target, ignore_errors=True)
        fetch_raw(info, wanted, target)  # git 一直断（大仓库常见）：按文件树只下需要的文件
        return target
    head = subprocess.run(["git", "-C", str(target), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    if not info["commit"].startswith(head) and not head.startswith(info["commit"]):
        subprocess.run(["git", "-C", str(target), "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", info["commit"]], check=False)
        subprocess.run(["git", "-C", str(target), "checkout", "-q", info["commit"]], check=True)
    return target

def hide_from_catalog(skill_md):
    """OpenClaw 的系统技能清单只有 18,000 字；四十多个长说明会把所有技能挤成「只剩名字」甚至挤掉。
    社区技能不进清单，碧琪按活儿自动把路径给模型（services/mode-architecture/skill-routes.mjs），
    清单里只放一份目录 pinkie-skill-library。"""
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        sys.exit(f"{skill_md}: 没有 frontmatter")
    head, _, rest = text[4:].partition("\n---")
    if "disable-model-invocation:" in head:
        return
    skill_md.write_text("---\ndisable-model-invocation: true\n" + head + "\n---" + rest, encoding="utf-8")

def write_fetch_stub(item, info, src, dst):
    """大技能（上万个文件、几十 MB）不进安装包：放一份说明，第一次用时碧琪自己下载到这台电脑。"""
    upstream = (src / "SKILL.md").read_text(encoding="utf-8")
    head = upstream[4:].partition("\n---")[0] if upstream.startswith("---\n") else ""
    desc = next((line.split(":", 1)[1].strip() for line in head.splitlines() if line.startswith("description:")), "")
    if desc in (">", "|", ">-", "|-", ""):
        lines = head.splitlines(); i = next(i for i, l in enumerate(lines) if l.startswith("description:"))
        desc = " ".join(l.strip() for l in lines[i + 1:] if l.startswith("  ")).strip()
    (dst / "SKILL.md").write_text(f"""---
name: {item['name']}
description: {item['zh']}。{desc[:300]}
---

# {item['name']}（第一次用时下载）

这个技能很大（{item.get('size', '几十 MB')}），不随安装包发。来源 https://github.com/{info['repo']}（{info['license']}，版本 {info['commit']}）。

1. 先看下载好了没有：运行
   `python3 "<本文件所在文件夹>/../pinkie-skill-library/fetch_skill.py" {item['name']}`
   （Windows 上把 `python3` 换成 `python`）。它会下载到这台电脑上碧琪的状态目录（已经下过就直接返回），最后一行打印 `SKILL=<路径>`，前面一行是记进下载账本的命令，照着跑。下载要几分钟，可以放后台跑，等的时候先做不依赖它的事。
2. 读 `SKILL=` 后面那个 SKILL.md，照它做。之后这个会话再用就直接读那个路径。
3. 下载失败（网络不通）就告诉先生是哪个网址下不动，先用别的技能做出来。
""", encoding="utf-8")

def write_library_index():
    """清单里唯一的一项：碧琪自带的社区技能目录（中文一句话 + 相对路径）。"""
    listed = [*manifest.get("own", []), *manifest["skills"]]
    rows = "\n".join(f"| {i['name']} | {i['zh']}{'（第一次用时下载）' if i.get('fetch') else ''} | `../{i['name']}/SKILL.md` |" for i in listed)
    out = SKILLS / "pinkie-skill-library"
    out.mkdir(exist_ok=True)
    (out / "community-skills.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    fetcher = ROOT / "tools" / "skills" / "fetch_skill.py"
    if fetcher.exists():
        shutil.copy2(fetcher, out / "fetch_skill.py")
    (out / "SKILL.md").write_text(f"""---
name: pinkie-skill-library
description: 碧琪自带的 {len(listed)} 个现成技能的目录（视频、动效、海报、小红书、电商详情页、logo、PPT、Word、Excel、PDF、图表、图解、网页、3D、小游戏、证件照、抠图、字帖口算、简历、文案营销、起名、排错……）。要做出一件成品、而系统这条消息没有给你配好技能时，先读这份目录挑最合适的一个。
---

# 碧琪自带的现成技能

前 {len(manifest.get('own', []))} 个是碧琪自己的薄技能（底下是开源工具），其余来自社区开源项目（来源和许可证见每个文件夹里的 SOURCE.md、LICENSE，总表在 `../THIRD_PARTY_SKILLS.md`）。
它们不在系统技能清单里，免得把清单挤满；系统通常会在消息里直接写好「这件活先用这些现成的技能」和路径。没写、而活儿像下面某一种时：

1. 在表里挑最贴近的 1–2 个（视频类先看 hyperframes，再看按片子类型分的那些）。
2. 路径相对于本文件所在的文件夹，换成绝对路径后完整读它的 SKILL.md，照它的做法和素材做。
3. 技能和碧琪的打法冲突时以打法为准：先做出来、不问一串问题、交付前亲眼验证；技能要的依赖自己装好，记进下载账本。

| 技能 | 干什么 | SKILL.md |
|---|---|---|
{rows}
""", encoding="utf-8")

def copy_tree(src, dst, patterns=None, exclude=()):
    for path in sorted(src.rglob("*") if patterns is None else [p for pat in patterns for p in src.glob(pat)]):
        if any(part in SKIP_DIRS for part in path.relative_to(src).parts) or path.is_dir() or path.suffix.lower() in SKIP_SUFFIXES or path.name == ".pinned-commit":
            continue
        rel = path.relative_to(src).as_posix()
        if any(fnmatch.fnmatch(rel, pat) for pat in exclude):
            continue
        if path.stat().st_size > MAX_FILE:
            print(f"  跳过大文件 {path.relative_to(src)}（{path.stat().st_size // 1024 // 1024} MB）")
            continue
        out = dst / path.relative_to(src)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, out)

repos = {key: checkout(key, info) for key, info in manifest["repos"].items()}
notices = ["# 随碧琪发布的社区技能\n", "由 `tools/skills/vendor_community_skills.py` 按 `skills/community-skills.json` 生成。每个技能文件夹里都有原许可证和 SOURCE.md。\n",
           "| 技能 | 来源 | 版本 | 许可证 |", "|---|---|---|---|"]
for item in manifest["skills"]:
    info = manifest["repos"][item["from"]]
    src = repos[item["from"]] / item["path"]
    dst = SKILLS / item["name"]
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    if item.get("fetch"):
        write_fetch_stub(item, info, src, dst)
    else:
        copy_tree(src, dst, item.get("files"), item.get("exclude", ()))
    if item.get("skillMd"):
        shutil.copy2(SKILLS / item["skillMd"], dst / "SKILL.md")
    if not (dst / "SKILL.md").exists():
        sys.exit(f"{item['name']}: 没有 SKILL.md")
    hide_from_catalog(dst / "SKILL.md")
    if not any((dst / n).exists() for n in ("LICENSE", "LICENSE.txt", "LICENSE.md")):
        root_license = next((repos[item["from"]] / n for n in ("LICENSE", "LICENSE.txt", "LICENSE.md") if (repos[item["from"]] / n).exists()), None)
        if root_license is None:
            sys.exit(f"{item['name']}: 找不到许可证文件，不能收录")
        shutil.copy2(root_license, dst / "LICENSE")
    for extra in ("NOTICE", "NOTICE.md", "NOTICE.txt"):
        if (repos[item["from"]] / extra).exists():
            shutil.copy2(repos[item["from"]] / extra, dst / extra)
    (dst / "SOURCE.md").write_text(
        f"# 来源\n\n- 仓库：https://github.com/{info['repo']}\n- 路径：`{item['path']}`\n- 版本：{info['commit']}\n- 许可证：{info['license']}\n- 收录：{('SKILL.md 由碧琪补写（上游没有），' if item.get('skillMd') else '')}只在 SKILL.md 头部加了一行 `disable-model-invocation: true`（不进系统技能清单，由碧琪按活儿自动挑；先生仍可用 /{item['name']} 直接调用），其余原样。\n",
        encoding="utf-8")
    size = sum(p.stat().st_size for p in dst.rglob("*") if p.is_file())
    notices.append(f"| {item['name']} | [{info['repo']}](https://github.com/{info['repo']}) | {info['commit']} | {info['license']} |")
    print(f"✓ {item['name']}  {size // 1024} KB")
(SKILLS / "THIRD_PARTY_SKILLS.md").write_text("\n".join(notices) + "\n", encoding="utf-8")
write_library_index()
print(f"共 {len(manifest['skills'])} 个")
