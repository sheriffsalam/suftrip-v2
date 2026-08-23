import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT ?? 3000);
const apiPort = Number(process.env.INTERNAL_API_PORT ?? 3001);
const webRoot = join(process.cwd(), 'web');

const api = spawn(process.execPath, ['dist/src/http/server.js'], {
  env: { ...process.env, PORT: String(apiPort) },
  stdio: 'inherit',
});

api.once('exit', (code, signal) => {
  if (!signal && code === 0) process.exit(0);
  console.error(`Suftrip API stopped: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  process.exit(code ?? 1);
});

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;

  if (pathname.startsWith('/api/') || pathname === '/health') {
    proxy(request, response);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Method Not Allowed');
    return;
  }

  const requested = pathname === '/' ? '/index.html' : pathname;
  const safe = normalize(requested).replace(/^([.][.][/\\])+/, '');
  const file = join(webRoot, safe);

  if (!file.startsWith(webRoot)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': contentType(extname(file)),
      'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  }
});

function proxy(request: IncomingMessage, response: ServerResponse): void {
  const upstream = httpRequest({
    hostname: '127.0.0.1',
    port: apiPort,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, host: `127.0.0.1:${apiPort}` },
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on('error', error => {
    console.error('API proxy error', error);
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'BAD_GATEWAY', message: 'API unavailable' } }));
  });

  request.pipe(upstream);
}

function contentType(extension: string): string {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

process.once('SIGTERM', () => { api.kill('SIGTERM'); server.close(); });
process.once('SIGINT', () => { api.kill('SIGINT'); server.close(); });

server.listen(port, '0.0.0.0', () => {
  console.log(`Suftrip public app listening on port ${port}; API on ${apiPort}`);
});
