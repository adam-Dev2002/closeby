"""Prepare verified portable Android build tools in this workspace."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import sys
import urllib.request
import zipfile
import shutil
sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib import import_module
android = import_module('bootstrap-android')

def jdk(version=21):
    request = urllib.request.Request(f'https://api.github.com/repos/adoptium/temurin{version}-binaries/releases/latest', headers={'User-Agent': 'Closeby-local-build'})
    with urllib.request.urlopen(request, timeout=30) as response:
        release = json.load(response)
    asset = next(item for item in release['assets'] if item['name'].startswith(f'OpenJDK{version}U-jdk_x64_windows_hotspot_') and item['name'].endswith('.zip'))
    checksum = next(item for item in release['assets'] if item['name'] == asset['name'] + '.sha256.txt')
    with urllib.request.urlopen(checksum['browser_download_url'], timeout=30) as response:
        expected = response.read().decode().split()[0]
    archive = android.TOOLS / asset['name']
    for cached in (android.TOOLS / 'gradle-cache/jdks').glob(f'OpenJDK{version}U-jdk_x64_windows_hotspot_*.zip'):
        with cached.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() == expected:
                shutil.copy2(cached, archive)
                break
    if not archive.exists():
        print(f'Downloading portable JDK {version}', flush=True)
        urllib.request.urlretrieve(asset['browser_download_url'], archive)
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            raise RuntimeError('JDK checksum mismatch')
    with zipfile.ZipFile(archive) as bundle:
        root = bundle.namelist()[0].split('/')[0]
        if not (android.TOOLS / root / 'bin/javac.exe').exists():
            for entry in bundle.infolist():
                if not (android.TOOLS / entry.filename).resolve().is_relative_to(android.TOOLS.resolve()):
                    raise RuntimeError('Unsafe JDK archive entry')
            bundle.extractall(android.TOOLS)
    print(f'JDK ready: {root}', flush=True)

def sdk():
    base = 'https://dl.google.com/android/repository/'
    root = android.repository(base + 'repository2-3.xml')
    names = ['platforms;android-36', 'build-tools;36.0.0', 'cmdline-tools;19.0', 'ndk;27.1.12297006', 'cmake;3.22.1']
    def destination(name):
        category, folder = name.split(';')
        return android.SDK / category / folder
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(android.install, android.package(root, name), base, destination(name)) for name in names]
        for future in futures: future.result()
    for name in names:
        target = destination(name)
        if not (target / 'source.properties').exists():
            source = next(target.rglob('source.properties')).parent
            # Archive roots differ; copy only the package root into the SDK's canonical path.
            shutil.copytree(source, target, dirs_exist_ok=True)

if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        for future in [pool.submit(jdk, 21), pool.submit(jdk, 17), pool.submit(sdk)]: future.result()
