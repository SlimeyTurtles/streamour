const { spawn } = require('child_process');

function getTimestamp() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `[${hours}:${minutes}:${seconds}]`;
}

const nextDev = spawn('next', ['dev'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
  env: {
    ...process.env,
    FORCE_COLOR: '1' // Force colored output even when piping
  }
});

nextDev.stdout.on('data', (data) => {
  const lines = data.toString().split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      console.log(`${getTimestamp()} ${line}`);
    }
  });
});

nextDev.stderr.on('data', (data) => {
  const lines = data.toString().split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      console.error(`${getTimestamp()} ${line}`);
    }
  });
});

nextDev.on('close', (code) => {
  console.log(`${getTimestamp()} Next.js dev server exited with code ${code}`);
  process.exit(code);
});

// Handle termination signals
process.on('SIGINT', () => {
  console.log(`\n${getTimestamp()} Shutting down...`);
  nextDev.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log(`\n${getTimestamp()} Shutting down...`);
  nextDev.kill('SIGTERM');
});
