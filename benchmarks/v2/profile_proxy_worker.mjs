import { createProxyServer } from '../../dist/proxy/server.js';

const upstream = process.env.BENCH_UPSTREAM;
if (!upstream) throw new Error('BENCH_UPSTREAM is required');

const proxy = createProxyServer({
  host: '127.0.0.1',
  port: 0,
  upstreams: { openai: upstream, anthropic: upstream },
  semantic: { enabled: false, autoSpawn: false },
  optical: { enabled: false },
  logLevel: 'silent',
});
const address = await proxy.listen();
process.send?.({ type: 'ready', url: `http://${address.host}:${address.port}` });

process.on('message', (message) => {
  if (message !== 'shutdown') return;
  void proxy.close().finally(() => process.exit(0));
});