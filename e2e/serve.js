// Serveur statique local pour les gates « écran rendu » : sert public/ sur 127.0.0.1.
// http natif, zéro dépendance. Toute route /api/* renvoie un JSON bénin (l'app boote,
// mais les gates ne testent que l'écran rendu, pas les données). Dev-only.
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

// Racine par défaut = public/. Override E2E_SERVE_ROOT utile pour prouver le ROUGE
// d'une gate en servant une version antérieure d'index.html (jamais en CI).
var ROOT = process.env.E2E_SERVE_ROOT ? path.resolve(process.env.E2E_SERVE_ROOT) : path.join(__dirname, '..', 'public');
var PORT = process.env.PORT || 4321;
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

http.createServer(function (req, res) {
  var u = (req.url || '/').split('?')[0];
  if (u === '/api' || u.indexOf('/api/') === 0) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
  var rel = (u === '/') ? '/index.html' : u;
  var file = path.normalize(path.join(ROOT, rel));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, function () { console.log('serve public/ on ' + PORT); });
