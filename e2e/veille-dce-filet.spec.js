/* =========================================================================
 * GATE « ÉCRAN RENDU » — Veille AO, filet DCE sans réponse (29/10/2026).
 * Incident : 99/2026/CM resté en « downloading » du 28/09 au 29/10 (run annulé) :
 * sablier sans fin, aucun moyen de relancer. Sur l'écran MONTÉ :
 *   - une demande sans réponse depuis plus que le délai montre un bouton « interrompu »
 *     avec son motif daté, et un clic relance réellement le téléchargement (POST) ;
 *   - une demande récente reste un sablier, sans bouton (pas de doublon).
 * Visée PAR MARQUEUR ([data-dce]), jamais par position.
 * ========================================================================= */
const { test, expect } = require('@playwright/test');

const LISTES = /\/api\/(aos|marches|cautions|paiements|indices|bordereaux|banques|avenants|veille)/;

test('demande DCE sans réponse : bouton interrompu relançable ; demande récente : sablier', async ({ page }) => {
  const declenches = [];
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', (r) => LISTES.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  // routes : la DERNIÈRE déclarée répond en premier, d'où le déclencheur après le repli
  await page.route('**/api/dce-trigger', (r) => { declenches.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  page.on('dialog', (d) => d.accept());
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.nav === 'function' && typeof window.pgVeille === 'function' && !!window.S && !!window.MPDce);
  await page.evaluate(() => {
    var il_y_a = function (min) { return new Date(Date.now() - min * 60000).toISOString(); };
    var base = { source: 'marchespublics_gov_ma', statut: 'go', score: 40, date_limite: '30/12/2099', heure_limite: '10:00', acheteur: 'COMMUNE TEST', objet: 'Objet test' };
    S.veille = [
      Object.assign({}, base, { id: 'veille_test_1', reference_ao: '99/TEST/2026', ref_consultation: '9000001', org_acronyme: 'zz1', dce_status: 'downloading', dce_started_at: il_y_a(60 * 24 * 31) }),
      Object.assign({}, base, { id: 'veille_test_2', reference_ao: '12/ESSAI/2026', ref_consultation: '9000002', org_acronyme: 'zz2', dce_status: 'queued', dce_started_at: il_y_a(5) })
    ];
    S._vurgence = ''; S._vstatut = ''; S._vscoremin = 0;
    nav('veille');
  });

  const interrompu = page.locator('[data-dce="interrompu"]');
  await expect(interrompu).toHaveCount(1);
  await expect(interrompu).toHaveAttribute('title', /sans reponse depuis plus de \d+ min : telechargement interrompu/);
  await expect(interrompu).toHaveAttribute('title', /Demande du \d\d\/\d\d\/\d{4} à \d\d:\d\d/);
  const enCours = page.locator('[data-dce="en_cours"]');
  await expect(enCours).toHaveCount(1);
  await expect(enCours).toHaveJSProperty('tagName', 'SPAN'); // pas de bouton : aucune relance possible

  await interrompu.click();
  await expect.poll(() => declenches.length).toBe(1);
  expect(declenches[0]).toEqual({ ref_consultation: '9000001', org_acronyme: 'zz1', cosmos_doc_id: 'veille_test_1' });
  await expect(page.locator('[data-dce="interrompu"]')).toHaveCount(0); // repasse en cours
  await expect(page.locator('[data-dce="en_cours"]')).toHaveCount(2);
});
