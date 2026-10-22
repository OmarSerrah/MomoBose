import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { existsSync } from 'node:fs';

export class NativeBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 0;
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private root: string, private platform = process.platform) { super(); }
  private start() {
    if (this.child) return;
    const executable = path.join(this.root, this.platform === 'win32' ? 'MomoBose.Bluetooth.exe' : 'momobose-bluetooth');
    if (!existsSync(executable)) throw new Error('Bluetooth helper is missing. Build the native helper or reinstall MomoBose.');
    const child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.event) {
          if (message.event === 'data' && typeof message.hex === 'string' && /^[a-f0-9]*$/i.test(message.hex)) this.emit('data', message.hex);
          if (message.event === 'disconnected') this.emit('disconnected');
          return;
        }
        const pending = this.waiting.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.waiting.delete(message.id);
        if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
      } catch { this.emit('diagnostic', 'Bluetooth helper returned an invalid message.'); }
    });
    child.stderr.on('data', data => this.emit('diagnostic', String(data).slice(0, 1000)));
    const failed = () => {
      if (this.child !== child) return;
      this.child = null;
      for (const entry of this.waiting.values()) { clearTimeout(entry.timer); entry.reject(new Error('Bluetooth helper stopped. Reopen MomoBose and check Bluetooth permissions.')); }
      this.waiting.clear(); this.emit('disconnected');
    };
    child.on('error', failed); child.on('exit', failed);
  }
  async request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error('Bluetooth is taking too long. Check permissions and make sure your headphones are on.'));
        this.stop();
      }, method === 'connect' || method === 'reconnectAudio' ? 25000 : 12000);
      this.waiting.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ id, method, ...params })}\n`, error => {
        if (error) { clearTimeout(timer); this.waiting.delete(id); reject(error); }
      });
    });
  }
  stop() {
    const child = this.child; this.child = null;
    for (const p of this.waiting.values()) { clearTimeout(p.timer); p.reject(new Error('Bluetooth connection closed.')); }
    this.waiting.clear(); child?.kill();
    if (child) this.emit('disconnected');
  }
}
