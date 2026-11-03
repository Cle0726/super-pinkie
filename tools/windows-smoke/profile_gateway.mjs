// Optional Windows smoke diagnostic. The gateway inspector listens only on
// the isolated runner's loopback interface; the profile is an evidence file.
import fs from 'node:fs';

const [, , url, output] = process.argv;
const socket = new WebSocket(url);
const pending = new Map();
let nextId = 0;

socket.addEventListener('message', ({data}) => {
  const response = JSON.parse(String(data));
  const waiter = pending.get(response.id);
  if (!waiter) return;
  pending.delete(response.id);
  if (response.error) waiter.reject(new Error(response.error.message));
  else waiter.resolve(response.result);
});

function command(method) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method}));
  });
}

socket.addEventListener('open', async () => {
  try {
    await command('Profiler.enable');
    await command('Profiler.start');
    process.stdin.resume();
    process.stdin.once('data', async () => {
      try {
        const {profile} = await command('Profiler.stop');
        fs.writeFileSync(output, JSON.stringify(profile));
      } catch (error) {
        fs.writeFileSync(`${output}.error.txt`, String(error));
      }
      socket.close();
      process.exit(0);
    });
  } catch (error) {
    fs.writeFileSync(`${output}.error.txt`, String(error));
    process.exit(1);
  }
});

socket.addEventListener('error', () => process.exit(1));
