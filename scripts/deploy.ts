import { execFileSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [['run', 'build', '--workspace', '@versionguard/shared'], ['run', 'deploy:infra'], ['run', 'configure:frontend'], ['run', 'build', '--workspace', '@versionguard/frontend'], ['run', 'deploy:frontend']]) {
  execFileSync(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' });
}
