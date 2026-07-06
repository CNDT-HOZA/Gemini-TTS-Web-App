/**
 * Gemini TTS - Local Server
 * Máy chủ HTTP nhỏ gọn, không cần cài thêm gì
 * Double-click file Gemini-TTS.bat để chạy
 */

var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = 5500;
var ROOT = __dirname;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

var server = http.createServer(function (req, res) {
  var parsedUrl = new URL(req.url, 'http://localhost:' + PORT);
  var pathname = decodeURIComponent(parsedUrl.pathname);

  // Default to index.html
  if (pathname === '/') pathname = '/index.html';

  var filePath = path.join(ROOT, pathname);

  // Security: prevent directory traversal
  if (filePath.indexOf(ROOT) !== 0) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, function (err, stats) {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    var ext = path.extname(filePath).toLowerCase();
    var contentType = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });

    var stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', function () {
      res.writeHead(500);
      res.end('Server Error');
    });
  });
});

server.listen(PORT, function () {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║     🎙️  Gemini TTS - Voice Studio           ║');
  console.log('  ║                                              ║');
  console.log('  ║     Đang chạy tại:                           ║');
  console.log('  ║     👉 http://localhost:' + PORT + '                 ║');
  console.log('  ║                                              ║');
  console.log('  ║     Nhấn Ctrl+C để dừng                      ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});
