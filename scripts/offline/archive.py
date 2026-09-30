#!/usr/bin/env python3
"""Create a flat ZIP or TAR.GZ archive; refuse links and special files."""
import os
import pathlib
import sys
import tarfile
import zipfile


def files(root):
    root = pathlib.Path(root).resolve(strict=True)
    result = []
    for parent, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if name != ".bin"]
        for name in list(dirs):
            path = pathlib.Path(parent, name)
            if path.is_symlink():
                raise ValueError("bundle tree contains a symlink")
        for name in names:
            path = pathlib.Path(parent, name)
            if path.is_symlink() or not path.is_file():
                raise ValueError("bundle tree contains a link or special file")
            relative = path.relative_to(root).as_posix()
            if any(part in ("", ".", "..") or ":" in part for part in relative.split("/")):
                raise ValueError("bundle tree contains an unsafe path")
            result.append((relative, path))
    return root, sorted(result)


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("zip", "tar.gz"):
        raise ValueError("usage: archive.py zip|tar.gz SOURCE DESTINATION")
    kind, source, destination = sys.argv[1:]
    _, entries = files(source)
    target = pathlib.Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    if kind == "zip":
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for relative, path in entries:
                archive.write(path, relative)
    else:
        with tarfile.open(target, "w:gz", compresslevel=6) as archive:
            for relative, path in entries:
                archive.add(path, arcname=relative, recursive=False)


if __name__ == "__main__":
    main()
