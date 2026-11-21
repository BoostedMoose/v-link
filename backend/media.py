import os

from flask import Blueprint, abort, current_app, jsonify, request, send_file


media_api = Blueprint('media', __name__, url_prefix='/api/media')

MEDIA_EXTENSIONS = {'.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.webm'}
DEFAULT_MEDIA_ROOTS = ('~/Music', '/media', '/mnt')


def _media_roots():
    candidates = current_app.config.get('MEDIA_ROOTS', DEFAULT_MEDIA_ROOTS)
    if isinstance(candidates, (str, os.PathLike)):
        candidates = (candidates,)
    roots = []
    for candidate in candidates:
        path = os.path.realpath(os.path.expanduser(os.fspath(candidate)))
        if os.path.isdir(path) and path not in roots:
            roots.append(path)
    return roots


def _is_within_root(path, root):
    try:
        return os.path.commonpath((path, root)) == root
    except ValueError:
        return False


def _safe_media_path(value):
    path = os.path.realpath(value or '')
    if not any(_is_within_root(path, root) for root in _media_roots()):
        abort(403)
    return path


@media_api.get('/roots')
def media_roots():
    return jsonify([
        {'name': os.path.basename(path) or path, 'path': path}
        for path in _media_roots()
    ])


@media_api.get('/browse')
def media_browse():
    path = _safe_media_path(request.args.get('path'))
    if not os.path.isdir(path):
        abort(404)

    entries = []
    try:
        with os.scandir(path) as iterator:
            for entry in iterator:
                if entry.name.startswith('.'):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    entries.append({'kind': 'directory', 'name': entry.name, 'path': entry.path})
                elif (
                    entry.is_file(follow_symlinks=False)
                    and os.path.splitext(entry.name)[1].lower() in MEDIA_EXTENSIONS
                ):
                    entries.append({'kind': 'file', 'name': entry.name, 'path': entry.path})
    except OSError:
        abort(403)

    entries.sort(key=lambda item: (item['kind'] != 'directory', item['name'].lower()))
    return jsonify({
        'name': os.path.basename(path) or path,
        'path': path,
        'entries': entries,
    })


@media_api.get('/file')
def media_file():
    path = _safe_media_path(request.args.get('path'))
    if not os.path.isfile(path) or os.path.splitext(path)[1].lower() not in MEDIA_EXTENSIONS:
        abort(404)
    return send_file(path, conditional=True)
