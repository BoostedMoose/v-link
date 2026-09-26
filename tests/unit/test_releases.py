import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

import pytest

from updater import releases


SHA = "a" * 40
ROOT = Path(__file__).resolve().parents[2]


def release(release_id, tag, branch, prerelease=True, *, asset=True, draft=False):
    return {
        "id": release_id,
        "tag_name": tag,
        "name": tag,
        "target_commitish": branch,
        "prerelease": prerelease,
        "draft": draft,
        "published_at": f"2026-09-{release_id:02}T00:00:00Z",
        "assets": [{"name": "V-Link.zip", "state": "uploaded", "browser_download_url": "https://github.com/example.zip"}] if asset else [],
    }


def test_catalogue_keeps_stable_and_multiple_prerelease_branches(monkeypatch):
    data = [release(1, "v3.1.0", "master", False), release(2, "v3.2.0-dev.1", "dev"),
            release(3, "v3.2.0-factory.1", "factory-screen"), release(4, "draft", "dev", draft=True),
            release(5, "missing-zip", "dev", asset=False)]
    monkeypatch.setattr(releases, "_json", lambda _url: data)
    result = releases.list_releases()
    assert [(entry["tag"], entry["branch"]) for entry in result["releases"]] == [
        ("v3.2.0-factory.1", "factory-screen"), ("v3.2.0-dev.1", "dev"), ("v3.1.0", "stable")]


def test_prerelease_branch_marker_overrides_default_branch():
    item = release(2, "v3.2.0-factory.1", "master")
    item["body"] = "Changes in this release\nV-Link-Branch: factory-screen\n"
    assert releases._summary(item)["branch"] == "factory-screen"


def make_archive(path, commit=SHA):
    with zipfile.ZipFile(path, "w") as bundle:
        bundle.writestr("V-Link.py", "new app")
        bundle.writestr("requirements.txt", "")
        bundle.writestr("backend/version.py", 'VERSION = "new"')
        bundle.writestr("frontend/dist/index.html", "new frontend")
        bundle.writestr(".vlink-release.json", json.dumps({"commit": commit}))


def make_modern_archive(path, commit=SHA, *, patch=False, omit=(), schema=2):
    files = {
        "V-Link.py": "new app",
        "requirements.txt": "",
        "backend/version.py": 'VERSION = "new"',
        "frontend/dist/index.html": "new frontend",
        "updater/__init__.py": "",
        "updater/releases.py": "new updater",
        "updater/keepalive.py": "new keepalive",
        "Update.sh": "new update script",
        "lite/Install-Lite.sh": "new Lite installer",
        "lite/Check-Lite.sh": "new Lite check",
        "resources/dtoverlays/v-link.dtbo": "new overlay",
        "Check-Lite.sh": "new root Lite check",
        ".vlink-release.json": json.dumps(
            {"commit": commit, "payload_schema": schema}),
    }
    if patch:
        files["Patch.sh"] = "new patch"
    for name in omit:
        files.pop(name, None)
    with zipfile.ZipFile(path, "w") as bundle:
        for name, content in files.items():
            member = zipfile.ZipInfo(name)
            member.create_system = 3
            member.external_attr = 0o100644 << 16
            bundle.writestr(member, content)


def mock_release_download(monkeypatch, archive):
    monkeypatch.setattr(
        releases, "get_release", lambda _id: release(2, "v3.2.0-dev.1", "dev"))
    monkeypatch.setattr(releases, "commit_sha", lambda _tag: SHA)
    monkeypatch.setattr(
        releases, "_download",
        lambda _url, destination, _digest: shutil.copyfile(archive, destination))


def test_package_script_builds_complete_modern_zip(tmp_path):
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    for name in ("Package.sh", "V-Link.py", "requirements.txt", "Update.sh",
                 "Patch.sh", "Install.sh", "Uninstall.sh"):
        shutil.copy2(ROOT / name, checkout / name)
    for name in ("backend", "frontend", "updater", "lite", "resources"):
        shutil.copytree(ROOT / name, checkout / name,
                        ignore=shutil.ignore_patterns("node_modules", "__pycache__", "*.pyc"))

    subprocess.run(["git", "init", "-q"], cwd=checkout, check=True)
    subprocess.run(["git", "config", "user.name", "V-Link test"], cwd=checkout, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"],
                   cwd=checkout, check=True)
    subprocess.run(["git", "add", "."], cwd=checkout, check=True)
    subprocess.run(["git", "commit", "-qm", "package fixture"], cwd=checkout, check=True)

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_npm = fake_bin / "npm"
    fake_npm.write_text("#!/bin/sh\nexit 0\n")
    fake_npm.chmod(0o755)
    package_env = {
        **os.environ, "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"]}
    result = subprocess.run(
        ["bash", "Package.sh"], cwd=checkout, text=True, capture_output=True,
        env=package_env)
    assert result.returncode == 0, result.stderr

    archive = checkout / "dist/V-Link.zip"
    with zipfile.ZipFile(archive) as bundle:
        names = set(bundle.namelist())
        top_level = {Path(name).parts[0] for name in names}
        assert top_level == {
            "V-Link.py", "requirements.txt", "Update.sh", "Check-Lite.sh",
            "Patch.sh", "backend", "frontend", "updater", "lite", "resources",
            ".vlink-release.json",
        }
        for name in (
                "updater/__init__.py", "updater/releases.py", "updater/keepalive.py",
                "lite/Install-Lite.sh", "lite/Check-Lite.sh",
                "resources/dtoverlays/v-link.dtbo"):
            assert name in names
        manifest = json.loads(bundle.read(".vlink-release.json"))
        assert manifest["payload_schema"] == releases.PAYLOAD_SCHEMA
        assert bundle.read("Check-Lite.sh") == bundle.read("lite/Check-Lite.sh")

    shutil.rmtree(checkout / "dist")
    subprocess.run(["git", "rm", "-q", "Patch.sh"], cwd=checkout, check=True)
    subprocess.run(["git", "commit", "-qm", "remove optional patch"],
                   cwd=checkout, check=True)
    without_patch = subprocess.run(
        ["bash", "Package.sh"], cwd=checkout, text=True, capture_output=True,
        env=package_env)
    assert without_patch.returncode == 0, without_patch.stderr
    with zipfile.ZipFile(checkout / "dist/V-Link.zip") as bundle:
        assert "Patch.sh" not in bundle.namelist()


def test_install_stages_and_preserves_updater_for_older_release(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    (app / "V-Link.py").write_text("old app")
    (app / "Update.sh").write_text("updater survives")
    (app / "updater").mkdir()
    (app / "updater" / "releases.py").write_text("updater survives")
    (app / "lite").mkdir()
    (app / "lite/Install-Lite.sh").write_text("Lite source survives")
    (app / "resources").mkdir()
    (app / "resources/existing.txt").write_text("resources survive")
    (app / "Check-Lite.sh").write_text("Lite check survives")
    archive = tmp_path / "release.zip"
    make_archive(archive)
    mock_release_download(monkeypatch, archive)

    result = releases.install(2, app)

    assert (app / "V-Link.py").read_text() == "new app"
    assert (app / "Update.sh").read_text() == "updater survives"
    assert (app / "updater/releases.py").read_text() == "updater survives"
    assert (app / "lite/Install-Lite.sh").read_text() == "Lite source survives"
    assert (app / "resources/existing.txt").read_text() == "resources survive"
    assert (app / "Check-Lite.sh").read_text() == "Lite check survives"
    assert result["commit"] == SHA
    assert releases.installed_release(app)["branch"] == "dev"


def test_complete_modern_release_installs_all_versioned_payload(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    archive = tmp_path / "release.zip"
    make_modern_archive(archive, patch=True)
    mock_release_download(monkeypatch, archive)

    result = releases.install(2, app)

    expected = (
        "V-Link.py", "requirements.txt", "backend/version.py",
        "frontend/dist/index.html", "updater/__init__.py", "updater/releases.py",
        "updater/keepalive.py", "Update.sh", "lite/Install-Lite.sh",
        "lite/Check-Lite.sh", "resources/dtoverlays/v-link.dtbo",
        "Check-Lite.sh", "Patch.sh", ".vlink-release.json",
    )
    assert all((app / name).exists() for name in expected)
    assert (app / "Patch.sh").read_text() == "new patch"
    assert result["payload_schema"] == releases.PAYLOAD_SCHEMA
    installed_manifest = json.loads((app / releases.MANIFEST).read_text())
    assert installed_manifest["payload_schema"] == releases.PAYLOAD_SCHEMA


def test_extracted_release_normalizes_only_critical_script_modes(tmp_path):
    archive = tmp_path / "release.zip"
    stage = tmp_path / "stage"
    stage.mkdir()
    make_modern_archive(archive)

    releases._extract(archive, stage)

    for name in ("V-Link.py", "Update.sh", "Check-Lite.sh"):
        assert (stage / name).stat().st_mode & 0o777 == 0o755
    assert not ((stage / "requirements.txt").stat().st_mode & 0o111)


def test_v_link_launches_update_script_through_bin_sh():
    source = (ROOT / "V-Link.py").read_text()
    launch = source.split("logger.info('Starting update...')", 1)[1].split(
        "], check=True)", 1)[0]
    assert launch.index("'/bin/sh'") < launch.index("script_path")
    assert launch.index("script_path") < launch.index("'--release-id'")


def run_update_script(tmp_path, *, lite):
    app = tmp_path / ("lite" if lite else "desktop")
    python = app / "venv/bin/python"
    (app / "updater").mkdir(parents=True)
    python.parent.mkdir(parents=True)
    shutil.copy2(ROOT / "Update.sh", app / "Update.sh")
    (app / "updater/releases.py").write_text("test updater\n")
    log = tmp_path / ("lite.log" if lite else "desktop.log")
    python.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$*\" >'{log}'\nexit 1\n")
    python.chmod(0o755)
    if lite:
        (app / ".v-link-lite-runtime").touch()
    result = subprocess.run(
        ["/bin/sh", str(app / "Update.sh"), "--release-id", "7"],
        text=True, capture_output=True)
    return result, log


def test_standalone_updater_allows_desktop_and_blocks_lite_marker(tmp_path):
    desktop, desktop_log = run_update_script(tmp_path, lite=False)
    assert desktop.returncode != 0
    assert desktop_log.read_text().strip().endswith("--release-id 7")

    lite, lite_log = run_update_script(tmp_path, lite=True)
    assert lite.returncode != 0
    assert not lite_log.exists()
    assert "Use Install-Lite.sh" in lite.stderr
    update_script = (ROOT / "Update.sh").read_text()
    lite_guard = update_script.split('APP_DIR=', 1)[1].split(
        'if [ ! -f "$APP_DIR/updater/releases.py" ]', 1)[0]
    assert '.v-link-lite-runtime' in lite_guard
    for heuristic in ("hostname", "/proc/device-tree", "labwc"):
        assert heuristic not in lite_guard


def test_partial_updater_payloads_are_rejected_before_install(tmp_path):
    cases = (
        ("updater without Update.sh", ("Update.sh",)),
        ("Update.sh without updater", (
            "updater/__init__.py", "updater/releases.py", "updater/keepalive.py")),
        ("updater without releases.py", ("updater/releases.py",)),
    )
    for label, omitted in cases:
        archive = tmp_path / f"{label.replace(' ', '-')}.zip"
        stage = tmp_path / f"stage-{label.replace(' ', '-')}"
        stage.mkdir()
        make_modern_archive(archive, omit=omitted)
        with pytest.raises(releases.UpdateError, match="incomplete updater"):
            releases._extract(archive, stage)


def test_partial_modern_lite_payloads_are_rejected_before_install(tmp_path):
    for omitted in (
            "lite/Install-Lite.sh", "lite/Check-Lite.sh",
            "resources/dtoverlays/v-link.dtbo", "Check-Lite.sh"):
        archive = tmp_path / (omitted.replace("/", "-") + ".zip")
        stage = tmp_path / ("stage-" + omitted.replace("/", "-"))
        stage.mkdir()
        make_modern_archive(archive, omit=(omitted,))
        with pytest.raises(releases.UpdateError, match="incomplete Lite payload"):
            releases._extract(archive, stage)


def test_incomplete_modern_payload_is_rejected_before_pip_or_app_swap(
        tmp_path, monkeypatch):
    app = tmp_path / "app"
    python = app / "venv/bin/python"
    python.parent.mkdir(parents=True)
    marker = tmp_path / "pip-was-called"
    python.write_text(f"#!/bin/sh\ntouch '{marker}'\n")
    python.chmod(0o755)
    (app / "V-Link.py").write_text("old app")
    archive = tmp_path / "incomplete.zip"
    make_modern_archive(archive, omit=("Check-Lite.sh",))
    mock_release_download(monkeypatch, archive)

    with pytest.raises(releases.UpdateError, match="incomplete Lite payload"):
        releases.install(2, app)

    assert not marker.exists()
    assert (app / "V-Link.py").read_text() == "old app"


def test_payload_schema_distinguishes_legacy_modern_and_unknown(tmp_path):
    legacy = tmp_path / "legacy.zip"
    make_archive(legacy)
    legacy_stage = tmp_path / "legacy"
    legacy_stage.mkdir()
    assert "payload_schema" not in releases._extract(legacy, legacy_stage)

    modern = tmp_path / "modern.zip"
    make_modern_archive(modern)
    modern_stage = tmp_path / "modern"
    modern_stage.mkdir()
    assert releases._extract(modern, modern_stage)["payload_schema"] == 2

    future = tmp_path / "future.zip"
    make_modern_archive(future, schema=3)
    future_stage = tmp_path / "future"
    future_stage.mkdir()
    with pytest.raises(releases.UpdateError, match="Unsupported release payload schema"):
        releases._extract(future, future_stage)


def test_modern_release_without_patch_removes_previous_patch(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    (app / "Patch.sh").write_text("old patch")
    archive = tmp_path / "release.zip"
    make_modern_archive(archive)
    mock_release_download(monkeypatch, archive)

    releases.install(2, app)

    assert not (app / "Patch.sh").exists()


def test_invalid_archive_never_removes_installed_app(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    (app / "V-Link.py").write_text("old app")
    archive = tmp_path / "release.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("../outside", "bad")
        bundle.writestr("V-Link.py", "new app")
    monkeypatch.setattr(releases, "get_release", lambda _id: release(2, "v3.2.0-dev.1", "dev"))
    monkeypatch.setattr(releases, "commit_sha", lambda _tag: SHA)
    monkeypatch.setattr(releases, "_download", lambda _url, destination, _digest: shutil.copyfile(archive, destination))

    with pytest.raises(releases.UpdateError, match="unsafe path"):
        releases.install(2, app)
    assert (app / "V-Link.py").read_text() == "old app"
    assert not (tmp_path / "outside").exists()


def test_manifest_mismatch_never_removes_installed_app(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    (app / "V-Link.py").write_text("old app")
    archive = tmp_path / "release.zip"
    make_archive(archive, "b" * 40)
    monkeypatch.setattr(releases, "get_release", lambda _id: release(2, "v3.2.0-dev.1", "dev"))
    monkeypatch.setattr(releases, "commit_sha", lambda _tag: SHA)
    monkeypatch.setattr(releases, "_download", lambda _url, destination, _digest: shutil.copyfile(archive, destination))

    with pytest.raises(releases.UpdateError, match="different commit"):
        releases.install(2, app)
    assert (app / "V-Link.py").read_text() == "old app"


def test_file_swap_failure_restores_previous_app(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    (app / "V-Link.py").write_text("old app")
    stage = tmp_path / "stage"
    stage.mkdir()
    (stage / "V-Link.py").write_text("new app")
    real_replace = releases.os.replace

    def fail_new_app(source, destination):
        if source == stage / "V-Link.py":
            raise OSError("simulated disk error")
        return real_replace(source, destination)

    monkeypatch.setattr(releases.os, "replace", fail_new_app)
    with pytest.raises(releases.UpdateError, match="previous version restored"):
        releases._replace(stage, app, {"commit": SHA})
    assert (app / "V-Link.py").read_text() == "old app"


def test_modern_swap_failure_restores_all_previous_versioned_components(
        tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    old_files = {
        "V-Link.py": "old app",
        "backend/version.py": "old backend",
        "frontend/dist/index.html": "old frontend",
        "updater/releases.py": "old updater",
        "lite/Install-Lite.sh": "old Lite source",
        "resources/dtoverlays/v-link.dtbo": "old resources",
    }
    for name, content in old_files.items():
        destination = app / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content)

    archive = tmp_path / "modern.zip"
    make_modern_archive(archive)
    stage = tmp_path / "stage"
    stage.mkdir()
    releases._extract(archive, stage)
    real_replace = releases.os.replace

    def fail_resources(source, destination):
        if source == stage / "resources":
            raise OSError("simulated resources swap error")
        return real_replace(source, destination)

    monkeypatch.setattr(releases.os, "replace", fail_resources)
    with pytest.raises(releases.UpdateError, match="previous version restored"):
        releases._replace(
            stage, app, {"commit": SHA, "payload_schema": releases.PAYLOAD_SCHEMA})

    for name, content in old_files.items():
        assert (app / name).read_text() == content
