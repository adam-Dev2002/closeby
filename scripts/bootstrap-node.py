"""Download a checksum-verified portable Node LTS into this workspace only."""

from pathlib import Path
import hashlib
import platform
import re
import urllib.request
import zipfile


def main() -> None:
    project = Path(__file__).resolve().parent.parent
    destination = project / ".tools"
    destination.mkdir(exist_ok=True)
    architecture = "arm64" if platform.machine().lower() == "arm64" else "x64"
    base_url = "https://nodejs.org/dist/latest-v24.x/"
    with urllib.request.urlopen(base_url + "SHASUMS256.txt", timeout=30) as response:
        checksums = response.read().decode("utf-8")
    pattern = rf"^([a-f0-9]{{64}})\s+(node-v24\.[\d.]+-win-{architecture}\.zip)$"
    match = re.search(pattern, checksums, re.MULTILINE)
    if match is None:
        raise RuntimeError("The official Node LTS Windows archive was not found.")
    expected_hash, filename = match.groups()
    archive = destination / filename
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != expected_hash:
        print(f"Downloading {filename} from nodejs.org", flush=True)
        with urllib.request.urlopen(base_url + filename, timeout=60) as response:
            archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected_hash:
        raise RuntimeError("Node archive checksum mismatch; extraction stopped.")
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            target = (destination / entry.filename).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise RuntimeError("Archive entry points outside the tools directory.")
        bundle.extractall(destination)
    print(f"Portable Node ready: {destination / filename.removesuffix('.zip') / 'node.exe'}")


if __name__ == "__main__":
    main()

