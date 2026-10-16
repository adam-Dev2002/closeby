"""Set up Google's Android preview tools within this project, without an IDE."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse
import hashlib
import json
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

PROJECT = Path(__file__).resolve().parent.parent
TOOLS = PROJECT / '.tools'
SDK = TOOLS / 'android-sdk'
DOWNLOADS = TOOLS / 'android-downloads'
AVDS = TOOLS / 'android-avd'
AVD_NAME = 'Closeby_Phone_API_36'
GOOGLE_AVDS = TOOLS / 'android-avd-google'
GOOGLE_AVD_NAME = 'Closeby_Phone_Google_API_36'


def repository(url: str) -> ET.Element:
    with urllib.request.urlopen(url, timeout=60) as response:
        return ET.fromstring(response.read())


def package(root: ET.Element, name: str) -> ET.Element:
    for candidate in root.findall('remotePackage'):
        channel = candidate.find('channelRef')
        if candidate.get('path') == name and (channel is None or channel.get('ref') == 'channel-0'):
            return candidate
    raise RuntimeError(f'Official stable Android package not found: {name}')


def install(remote: ET.Element, base_url: str, destination: Path) -> None:
    selected = next(
        archive for archive in remote.findall('archives/archive')
        if archive.findtext('host-os') in (None, 'windows')
    )
    complete = selected.find('complete')
    if complete is None:
        raise RuntimeError('Package has no complete archive')
    relative_url = complete.findtext('url')
    checksum_element = complete.find('checksum')
    if not relative_url or checksum_element is None or not checksum_element.text:
        raise RuntimeError('Package archive URL or checksum missing')
    expected = checksum_element.text.strip()
    algorithm = checksum_element.get('type', 'sha1')
    size = int(complete.findtext('size', '0'))
    url = urllib.request.urljoin(base_url, relative_url)
    archive = DOWNLOADS / Path(relative_url).name
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    destination.mkdir(parents=True, exist_ok=True)
    valid = archive.exists() and archive.stat().st_size == size
    if valid:
        with archive.open('rb') as stream:
            valid = hashlib.file_digest(stream, algorithm).hexdigest() == expected
    if not valid:
        print(f'Downloading {remote.get("path")}: {size / 1_000_000:.0f} MB', flush=True)
        downloaded = 0
        last_progress = time.monotonic()
        with urllib.request.urlopen(url, timeout=60) as response, archive.open('wb') as output:
            while block := response.read(1024 * 1024):
                output.write(block)
                downloaded += len(block)
                if time.monotonic() - last_progress >= 10:
                    print(f'{archive.name}: {downloaded / 1_000_000:.0f}/{size / 1_000_000:.0f} MB', flush=True)
                    last_progress = time.monotonic()
    with archive.open('rb') as stream:
        actual = hashlib.file_digest(stream, algorithm).hexdigest()
    if actual != expected or archive.stat().st_size != size:
        raise RuntimeError(f'Official archive checksum mismatch: {archive.name}')
    marker = destination / f'.installed-{archive.stem}'
    if not marker.exists():
        print(f'Verified {archive.name}; extracting', flush=True)
        with zipfile.ZipFile(archive) as bundle:
            for entry in bundle.infolist():
                if not (destination / entry.filename).resolve().is_relative_to(destination.resolve()):
                    raise RuntimeError('Unsafe archive entry')
            bundle.extractall(destination)
        marker.write_text(expected, encoding='utf-8')
    print(f'Ready: {remote.get("path")}', flush=True)


def create_avd(
    avd_root: Path = AVDS,
    avd_name: str = AVD_NAME,
    tag: str = 'default',
    tag_display: str = 'Default',
) -> None:
    avd_root.mkdir(parents=True, exist_ok=True)
    avd_directory = avd_root / f'{avd_name}.avd'
    avd_directory.mkdir(exist_ok=True)
    pointer = '\n'.join([
        'avd.ini.encoding=UTF-8', f'path={avd_directory}', 'target=android-36', '',
    ])
    (avd_root / f'{avd_name}.ini').write_text(pointer, encoding='utf-8')
    configuration = {
        'avd.ini.encoding': 'UTF-8', 'AvdId': avd_name,
        'avd.name': 'Closeby Android Phone' + (' Google APIs' if tag == 'google_apis' else ''), 'abi.type': 'x86_64',
        'tag.id': tag, 'tag.display': tag_display,
        'image.sysdir.1': f'system-images\\android-36\\{tag}\\x86_64\\',
        'hw.cpu.arch': 'x86_64', 'hw.cpu.ncore': '2', 'hw.ramSize': '2048',
        'vm.heapSize': '256', 'disk.dataPartition.size': '4G',
        'hw.lcd.width': '1080', 'hw.lcd.height': '2400', 'hw.lcd.density': '420',
        'hw.keyboard': 'yes', 'hw.mainKeys': 'no', 'hw.gpu.enabled': 'yes',
        'hw.gpu.mode': 'auto', 'hw.audioInput': 'no',
        'hw.camera.back': 'none', 'hw.camera.front': 'none',
        'showDeviceFrame': 'no', 'skin.dynamic': 'yes', 'skin.name': '1080x2400',
        'fastboot.forceColdBoot': 'yes', 'fastboot.forceFastBoot': 'no',
    }
    (avd_directory / 'config.ini').write_text(
        '\n'.join(f'{key}={value}' for key, value in configuration.items()) + '\n',
        encoding='utf-8',
    )
    print(json.dumps({'avd': avd_name, 'sdk': str(SDK), 'avdHome': str(avd_root)}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['tools', 'image', 'all', 'avd', 'google'], default='all', nargs='?')
    stage = parser.parse_args().stage
    jobs = []
    if stage in ('tools', 'all'):
        base = 'https://dl.google.com/android/repository/'
        root = repository(base + 'repository2-3.xml')
        jobs.extend((package(root, name), base, SDK) for name in ('platform-tools', 'emulator'))
    if stage in ('image', 'all'):
        base = 'https://dl.google.com/android/repository/sys-img/android/'
        root = repository(base + 'sys-img2-3.xml')
        jobs.append((package(root, 'system-images;android-36;default;x86_64'), base, SDK / 'system-images' / 'android-36' / 'default'))
    if stage == 'google':
        base = 'https://dl.google.com/android/repository/sys-img/google_apis/'
        root = repository(base + 'sys-img2-3.xml')
        jobs.append((package(root, 'system-images;android-36;google_apis;x86_64'), base, SDK / 'system-images' / 'android-36' / 'google_apis'))
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(install, *job) for job in jobs]
        for future in futures:
            future.result()
    if stage in ('image', 'all', 'avd'):
        create_avd()
    if stage == 'google':
        create_avd(GOOGLE_AVDS, GOOGLE_AVD_NAME, 'google_apis', 'Google APIs')


if __name__ == '__main__':
    main()
