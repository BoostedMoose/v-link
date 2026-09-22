import json
import shutil
import zipfile

import pytest

from updater import releases


SHA = "a" * 40


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


def test_install_stages_and_preserves_updater_for_older_release(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    (app / "V-Link.py").write_text("old app")
    (app / "Update.sh").write_text("updater survives")
    (app / "updater").mkdir()
    (app / "updater" / "releases.py").write_text("updater survives")
    archive = tmp_path / "release.zip"
    make_archive(archive)
    monkeypatch.setattr(releases, "get_release", lambda _id: release(2, "v3.2.0-dev.1", "dev"))
    monkeypatch.setattr(releases, "commit_sha", lambda _tag: SHA)
    monkeypatch.setattr(releases, "_download", lambda _url, destination, _digest: shutil.copyfile(archive, destination))

    result = releases.install(2, app)

    assert (app / "V-Link.py").read_text() == "new app"
    assert (app / "Update.sh").read_text() == "updater survives"
    assert result["commit"] == SHA
    assert releases.installed_release(app)["branch"] == "dev"


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
