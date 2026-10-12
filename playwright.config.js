// Config playwright MP — gates « écran rendu » uniquement (e2e/). Sert public/ en
// local (e2e/serve.js, http natif, zéro dépendance côté serveur) et pilote l'écran
// rendu. AUCUN accès prod, aucune authentification : on teste le DOM de l'app servie
// localement, pas rh.neurones.ma (ça, c'est le skill playwright-neurones de btp).
'use strict';
var pw = require('@playwright/test');
var PORT = process.env.PORT || 4321;

module.exports = pw.defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  reporter: process.env.CI ? 'list' : 'line',
  use: { baseURL: 'http://127.0.0.1:' + PORT },
  webServer: {
    command: 'node e2e/serve.js',
    url: 'http://127.0.0.1:' + PORT + '/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20000
  },
  projects: [{ name: 'chromium', use: pw.devices['Desktop Chrome'] }]
});
