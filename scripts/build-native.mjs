import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const platform = process.env.MOMOBOSE_TARGET_PLATFORM || process.platform;
const arch = process.env.MOMOBOSE_TARGET_ARCH || process.arch;
const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
const dest = path.resolve('native/bin', `${os}-${arch}`);
mkdirSync(dest, { recursive: true });
if (platform === 'darwin') {
  execFileSync('clang', ['-O2', '-fobjc-arc', '-arch', arch === 'arm64' ? 'arm64' : 'x86_64', '-mmacosx-version-min=12.0', '-framework', 'Foundation', '-framework', 'IOBluetooth', '-framework', 'CoreAudio', '-framework', 'AppKit', 'native/macos/main.m', '-o', path.join(dest, 'momobose-bluetooth')], { stdio: 'inherit' });
} else if (platform === 'win32') {
  execFileSync(process.env.MOMOBOSE_DOTNET || 'dotnet', ['publish', 'native/windows/MomoBose.Bluetooth.csproj', '-c', 'Release', '-r', `win-${arch}`, '--self-contained', 'true', '-p:PublishSingleFile=true', '-o', dest], { stdio: 'inherit' });
} else throw new Error('MomoBose supports macOS and Windows.');
