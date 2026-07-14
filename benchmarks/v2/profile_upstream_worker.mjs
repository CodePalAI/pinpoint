import http from 'node:http';

const server = http.createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'mock',
      choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      content: [{ type: 'text', text: 'OK' }],
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }],
    }));
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address == null || typeof address === 'string') process.exit(1);
  process.send?.({ type: 'ready', url: `http://127.0.0.1:${address.port}` });
});

process.on('message', (message) => {
  if (message !== 'shutdown') return;
  server.close(() => process.exit(0));
});