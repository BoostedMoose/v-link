import os

import pytest
from flask import Flask

from backend.media import media_api


@pytest.fixture()
def media_root(tmp_path):
    root = tmp_path / 'Music'
    root.mkdir()
    return root


@pytest.fixture()
def media_client(media_root):
    app = Flask(__name__)
    app.config.update(TESTING=True, MEDIA_ROOTS=[media_root])
    app.register_blueprint(media_api)
    return app.test_client()


def test_server_registers_media_blueprint():
    from backend.server import server

    rules = {rule.rule for rule in server.url_map.iter_rules()}

    assert 'media' in server.blueprints
    assert {
        '/api/media/roots',
        '/api/media/browse',
        '/api/media/file',
    } <= rules


def test_roots_returns_existing_unique_directories(media_client, media_root):
    missing = media_root.parent / 'missing'
    media_client.application.config['MEDIA_ROOTS'] = [media_root, missing, media_root]

    response = media_client.get('/api/media/roots')

    assert response.status_code == 200
    assert response.get_json() == [{'name': 'Music', 'path': str(media_root)}]


def test_roots_accepts_a_single_configured_directory(media_client, media_root):
    media_client.application.config['MEDIA_ROOTS'] = media_root

    response = media_client.get('/api/media/roots')

    assert response.status_code == 200
    assert response.get_json() == [{'name': 'Music', 'path': str(media_root)}]


def test_browse_returns_directories_then_supported_audio_files(media_client, media_root):
    (media_root / 'zebra').mkdir()
    (media_root / 'Albums').mkdir()
    (media_root / 'Beta.FLAC').write_bytes(b'flac')
    (media_root / 'alpha.mp3').write_bytes(b'mp3')
    (media_root / 'notes.txt').write_text('not audio')
    (media_root / '.hidden.ogg').write_bytes(b'hidden')

    response = media_client.get('/api/media/browse', query_string={'path': str(media_root)})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['name'] == 'Music'
    assert payload['path'] == str(media_root)
    assert [(entry['kind'], entry['name']) for entry in payload['entries']] == [
        ('directory', 'Albums'),
        ('directory', 'zebra'),
        ('file', 'alpha.mp3'),
        ('file', 'Beta.FLAC'),
    ]


def test_browse_rejects_paths_outside_configured_roots(media_client, media_root):
    outside = media_root.parent / 'Music-backup'
    outside.mkdir()

    response = media_client.get('/api/media/browse', query_string={'path': str(outside)})

    assert response.status_code == 403


def test_browse_returns_not_found_for_missing_path_inside_root(media_client, media_root):
    response = media_client.get(
        '/api/media/browse',
        query_string={'path': str(media_root / 'missing')},
    )

    assert response.status_code == 404


def test_browse_maps_filesystem_errors_to_forbidden(media_client, media_root, monkeypatch):
    def denied_scandir(_path):
        raise PermissionError

    monkeypatch.setattr(os, 'scandir', denied_scandir)

    response = media_client.get('/api/media/browse', query_string={'path': str(media_root)})

    assert response.status_code == 403


def test_symlinks_cannot_escape_media_root(media_client, media_root):
    outside = media_root.parent / 'private.mp3'
    outside.write_bytes(b'private')
    link = media_root / 'linked.mp3'
    link.symlink_to(outside)

    browse_response = media_client.get(
        '/api/media/browse',
        query_string={'path': str(media_root)},
    )
    file_response = media_client.get(
        '/api/media/file',
        query_string={'path': str(link)},
    )

    assert all(entry['name'] != link.name for entry in browse_response.get_json()['entries'])
    assert file_response.status_code == 403


def test_file_serves_audio_and_supports_range_requests(media_client, media_root):
    track = media_root / 'track.mp3'
    track.write_bytes(b'0123456789')

    response = media_client.get('/api/media/file', query_string={'path': str(track)})
    range_response = media_client.get(
        '/api/media/file',
        query_string={'path': str(track)},
        headers={'Range': 'bytes=2-5'},
    )

    assert response.status_code == 200
    assert response.data == b'0123456789'
    assert response.mimetype == 'audio/mpeg'
    assert range_response.status_code == 206
    assert range_response.data == b'2345'
    assert range_response.headers['Content-Range'] == 'bytes 2-5/10'


def test_file_rejects_unsupported_extensions(media_client, media_root):
    unsupported = media_root / 'notes.txt'
    unsupported.write_text('not audio')

    response = media_client.get('/api/media/file', query_string={'path': str(unsupported)})

    assert response.status_code == 404
