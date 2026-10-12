/* =========================================================================
 * GATE « ÉCRAN RENDU » — zone de dépôt du Rapprochement des actes.
 * Pilote le DOM réel de l'app servie en local (pas le module, pas la prod) :
 *   setInputFiles 3 -> 3 lignes ; drop 2 de plus -> 5 ; même fichier deux fois
 *   -> 1 ligne + doublon nommé ; 21 -> refus nommé ; « Analyser » -> 5 en revue.
 * Prouve le câblage événement -> DOM que la gate node (test/rappr-lot.test.js) ne
 * peut pas voir. Rouge sur l'ancien input mono-fichier, verte sur la zone multi.
 *
 * Fichier exécuté par Node (playwright) — syntaxe moderne OK ici ; l'ES5 strict
 * ne concerne que public/index.html et ses modules servis.
 *
 * Lancer : npx playwright test   (serveur public/ démarré par playwright.config.js)
 * ========================================================================= */
const { test, expect } = require('@playwright/test');

const pdf = (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% ' + name + '\n') });
const lignes = (page) => page.locator('#rappr-body table tbody tr');
const compteur = (page) => page.locator('#rappr_count');

test.beforeEach(async ({ page }) => {
  // boot déterministe hors-ligne : CDN (Chart/xlsx) et /api/* neutralisés.
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.ouvrirRapprochement === 'function' && window.MPMainlevee && typeof window.MPMainlevee.ajouterFichiersLot === 'function');
  await page.evaluate(() => window.ouvrirRapprochement());
  await expect(page.locator('#rappr_dz')).toBeVisible();
});

test('la zone accumule plusieurs PDF (dialogue + glisser), dédoublonne, et Analyser passe 5 en revue', async ({ page }) => {
  await expect(lignes(page)).toHaveCount(0);
  await expect(compteur(page)).toHaveText('0 fichier(s)');

  // dialogue : 3 PDF -> 3 lignes
  await page.locator('#rappr_files').setInputFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);
  await expect(lignes(page)).toHaveCount(3);
  await expect(compteur(page)).toHaveText('3 fichier(s)');

  // glisser-déposer : 2 de plus -> 5 (s'ajoute, n'écrase pas)
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['%PDF-1.4 d'], 'd.pdf', { type: 'application/pdf' }));
    dt.items.add(new File(['%PDF-1.4 e'], 'e.pdf', { type: 'application/pdf' }));
    document.getElementById('rappr_dz').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  await expect(lignes(page)).toHaveCount(5);
  await expect(compteur(page)).toHaveText('5 fichier(s)');

  // même fichier deux fois -> 1 ligne (pas 2), doublon NOMMÉ au toast
  await page.locator('#rappr_files').setInputFiles([pdf('a.pdf')]);
  await expect(page.locator('#toast')).toContainText('Doublon');
  await expect(page.locator('#toast')).toContainText('a.pdf');
  await expect(lignes(page)).toHaveCount(5);

  // « Retirer » enlève une ligne -> 4
  await lignes(page).filter({ hasText: 'e.pdf' }).getByText('Retirer').click();
  await expect(lignes(page)).toHaveCount(4);
  await expect(compteur(page)).toHaveText('4 fichier(s)');
  // on remet e.pdf -> 5 pour Analyser
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['%PDF-1.4 e'], 'e.pdf', { type: 'application/pdf' }));
    document.getElementById('rappr_dz').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  await expect(lignes(page)).toHaveCount(5);

  // Analyser -> phase revue, 5 lignes rendues, on a quitté la phase select
  await page.getByRole('button', { name: 'Analyser' }).click();
  await expect(lignes(page)).toHaveCount(5);
  await expect(page.locator('#rappr_dz')).toHaveCount(0);
});

test('le 21e fichier est refusé et nommé « 20 au plus par dépôt »', async ({ page }) => {
  const vingtUn = [];
  for (let i = 0; i < 21; i++) vingtUn.push(pdf('f' + i + '.pdf'));
  await page.locator('#rappr_files').setInputFiles(vingtUn);
  await expect(compteur(page)).toHaveText('20 fichier(s)');
  await expect(lignes(page)).toHaveCount(20);
  await expect(page.locator('#toast')).toContainText('20 au plus par dépôt');
  await expect(page.locator('#toast')).toContainText('f20.pdf');
});

test('un non-PDF est écarté nommé, sans entrer dans le lot', async ({ page }) => {
  await page.locator('#rappr_files').setInputFiles([pdf('ok.pdf'), { name: 'scan.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('notpdf') }]);
  await expect(page.locator('#toast')).toContainText('non-PDF');
  await expect(page.locator('#toast')).toContainText('scan.jpg');
  await expect(lignes(page)).toHaveCount(1);
  await expect(compteur(page)).toHaveText('1 fichier(s)');
});
