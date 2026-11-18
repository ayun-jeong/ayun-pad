import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}public/ayun-pad-sidepanel.zip`;
rmSync(output, { force: true });
execFileSync('/usr/bin/zip', ['-q', '-r', output, 'manifest.json', 'background.js', 'sidepanel.html', 'sidepanel.css', 'sidepanel.js'], { cwd: `${root}extension` });
console.log('사이드 패널 확장 프로그램 패키지 생성');
