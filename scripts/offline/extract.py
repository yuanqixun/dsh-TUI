#!/usr/bin/env python3
"""Extract offline updates into an empty directory with bounded flat-file entries."""
import pathlib
import shutil
import stat
import sys
import tarfile
import zipfile

MAX_FILES = 500_000
MAX_BYTES = 8 * 1024 ** 3


def safe_path(name):
    if not name or "\\" in name or name.startswith("/"):
        raise ValueError("archive has an unsafe path")
    parts = name.rstrip("/").split("/")
    if not parts or any(part in ("", ".", "..") or ":" in part or part.endswith((".", " ")) for part in parts):
        raise ValueError("archive has an unsafe path")
    if any(part.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))} for part in parts):
        raise ValueError("archive has a reserved filename")
    return pathlib.PurePosixPath(*parts)


def extract_zip(archive, destination):
    total = 0
    count = 0
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            relative = safe_path(entry.filename)
            mode = (entry.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode) or (mode and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode))):
                raise ValueError("archive contains a link or special file")
            if entry.flag_bits & 1:
                raise ValueError("encrypted archive entries are unsupported")
            if entry.is_dir():
                (destination / pathlib.Path(*relative.parts)).mkdir(parents=True, exist_ok=True)
                continue
            count += 1
            total += entry.file_size
            if count > MAX_FILES or total > MAX_BYTES:
                raise ValueError("archive exceeds the extraction limits")
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(entry) as reader, target.open("xb") as writer:
                shutil.copyfileobj(reader, writer, 1024 * 1024)
            if mode & 0o111:
                target.chmod(target.stat().st_mode | 0o111)


def extract_tar(archive, destination):
    total = 0
    count = 0
    with tarfile.open(archive, "r:gz") as source:
        for entry in source:
            relative = safe_path(entry.name)
            if entry.isdir():
                destination.joinpath(*relative.parts).mkdir(parents=True, exist_ok=True)
                continue
            if not entry.isfile():
                raise ValueError("archive contains a link or special file")
            count += 1
            total += entry.size
            if count > MAX_FILES or total > MAX_BYTES:
                raise ValueError("archive exceeds the extraction limits")
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            reader = source.extractfile(entry)
            if reader is None:
                raise ValueError("archive entry could not be read")
            with reader, target.open("xb") as writer:
                shutil.copyfileobj(reader, writer, 1024 * 1024)
            target.chmod((entry.mode & 0o755) or 0o644)


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("zip", "tar.gz"):
        raise ValueError("usage: extract.py zip|tar.gz ARCHIVE EMPTY_DESTINATION")
    kind, archive, path = sys.argv[1:]
    destination = pathlib.Path(path)
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError("destination must be empty")
    if kind == "zip":
        extract_zip(archive, destination)
    else:
        extract_tar(archive, destination)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"offline extraction failed: {error}", file=sys.stderr)
        sys.exit(1)
