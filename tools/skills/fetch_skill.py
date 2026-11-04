"""第一次用到一个大的社区技能时，把它下载到这台电脑（碧琪自带的 pinkie-skill-library 里有一份）。

用法：python3 fetch_skill.py <技能名>
- 版本、仓库、路径都按旁边的 community-skills.json，下到 <OpenClaw 状态目录>/pinkie-skills/<技能名>/。
- 已经下过同一版本就直接返回。先试 git 稀疏检出（只拉这个文件夹），没有 git 或拉不下来就下整个仓库的
  压缩包、只解出这个文件夹。只用 Python 标准库，Mac / Windows 一样。
- 最后一行打印 SKILL=<SKILL.md 的完整路径>。
"""
import io, json, os, pathlib, shutil, subprocess, sys, tarfile, tempfile, time, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SKIP_SUFFIXES = {".mp4", ".mov", ".webm", ".mkv"}


def state_dir():
    configured = os.environ.get("OPENCLAW_STATE_DIR", "").strip()
    return pathlib.Path(os.path.expanduser(configured)) if configured else pathlib.Path.home() / ".openclaw"


def say(text):
    print(text, flush=True)


def via_git(repo, commit, path, work):
    if not shutil.which("git"):
        return None
    clone = work / "git"
    run = lambda *args: subprocess.run(["git", *args], cwd=clone if clone.exists() else work, capture_output=True, text=True, timeout=1800)
    for attempt in range(3):
        shutil.rmtree(clone, ignore_errors=True)
        if run("clone", "-q", "--filter=blob:none", "--no-checkout", "--sparse", f"https://github.com/{repo}.git", str(clone)).returncode:
            time.sleep(3 + attempt * 3)
            continue
        steps = [("sparse-checkout", "set", "--no-cone", f"/{path}/", "/LICENSE*", "/NOTICE*"), ("checkout", "-q", commit)]
        if all(run(*step).returncode == 0 for step in steps) and (clone / path / "SKILL.md").is_file():
            return clone
        time.sleep(3 + attempt * 3)
    return None


def via_tarball(repo, commit, path, work):
    url = f"https://codeload.github.com/{repo}/tar.gz/{commit}"
    out = work / "tar"
    for attempt in range(3):
        try:
            shutil.rmtree(out, ignore_errors=True)
            request = urllib.request.Request(url, headers={"User-Agent": "pinkie-fetch-skill"})
            with urllib.request.urlopen(request, timeout=120) as response, tarfile.open(fileobj=response, mode="r|gz") as archive:
                for member in archive:
                    parts = member.name.split("/", 1)
                    if len(parts) < 2 or not member.isfile():
                        continue
                    rel = parts[1]
                    top = "/" not in rel and rel.split(".")[0].upper() in ("LICENSE", "NOTICE")
                    if not (top or rel.startswith(path + "/")) or pathlib.PurePosixPath(rel).suffix.lower() in SKIP_SUFFIXES:
                        continue
                    target = (out / rel).resolve()
                    if not str(target).startswith(str(out.resolve()) + os.sep):
                        continue  # 压缩包里不该有跳出目录的路径
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as source, open(target, "wb") as sink:
                        shutil.copyfileobj(source, sink)
            if (out / path / "SKILL.md").is_file():
                return out
        except Exception as error:  # 网络断了：重来
            say(f"  下载中断（{error}），重试……")
            time.sleep(5 + attempt * 5)
    return None


def main():
    if len(sys.argv) != 2:
        sys.exit("用法：python3 fetch_skill.py <技能名>")
    name = sys.argv[1]
    manifest = json.loads((HERE / "community-skills.json").read_text(encoding="utf-8"))
    item = next((i for i in manifest["skills"] if i["name"] == name), None)
    if not item:
        sys.exit(f"清单里没有 {name}")
    info = manifest["repos"][item["from"]]
    repo, commit, path = info["repo"], info["commit"], item["path"].strip("/")
    dest = state_dir() / "pinkie-skills" / name
    marker = dest / ".source-commit"
    if (dest / "SKILL.md").is_file() and marker.is_file() and marker.read_text().strip() == commit:
        say(f"已经下载过（{repo} {commit}）")
        say(f"SKILL={dest / 'SKILL.md'}")
        return
    say(f"正在下载 {name}：https://github.com/{repo}（{info['license']}，版本 {commit}），只取 {path}/ ……")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent, prefix=f".{name}-") as temp:
        work = pathlib.Path(temp)
        root = via_git(repo, commit, path, work) or via_tarball(repo, commit, path, work)
        if not root:
            sys.exit(f"下载失败：github.com/{repo} 连不上。告诉先生是这个网址下不动，先用别的技能把活做出来。")
        staged = work / "staged"
        shutil.copytree(root / path, staged, ignore=shutil.ignore_patterns(".git"))
        for extra in ("LICENSE", "LICENSE.txt", "LICENSE.md", "NOTICE"):
            if (root / extra).is_file() and not (staged / extra).exists():
                shutil.copy2(root / extra, staged / extra)
        (staged / ".source-commit").write_text(commit)
        old = dest.with_name(f".{name}-old")
        shutil.rmtree(old, ignore_errors=True)
        if dest.exists():
            dest.rename(old)
        staged.rename(dest)
        shutil.rmtree(old, ignore_errors=True)
    size = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file()) // (1024 * 1024)
    say(f"下载好了：{dest}（约 {size} MB）")
    say(f'记进下载账本：node <工作区>/playbooks/downloads.mjs add --path "{dest}" --what "{name} 技能（社区开源）" --for "<这件活>"')
    say(f"SKILL={dest / 'SKILL.md'}")


if __name__ == "__main__":
    main()
