/* =========================================================================
 * GATE « ÉCRAN RENDU » — référence banque COMPLÈTE sur la fiche caution (23/10/2026).
 *   - la liste des cautions affiche la référence complète quand elle est saisie, et
 *     l'alias court en dessous ; sans référence complète, l'alias seul (jamais un tiret) ;
 *   - le formulaire « Modifier caution » porte le champ [data-champ="reference-banque"]
 *     pré-rempli ; une frappe dans ce champ est reprise dans l'objet envoyé à l'API.
 * Visée PAR MARQUEUR (data-champ), jamais par position (doctrine §10).
 *
 * Fichier Node (playwright) — syntaxe moderne OK.
 * ========================================================================= */
const { test, expect } = require('@playwright/test');

const LISTES = /\/api\/(aos|marches|cautions|paiements|indices|bordereaux|banques|avenants)/;

test.beforeEach(async ({ page }) => {
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', (r) => LISTES.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.nav === 'function' && typeof window.pgCautions === 'function' && !!window.S);
  await page.evaluate(() => {
    S.marches = [{ id: 'm1', ref: 'MRC-1', titre: 'Travaux X' }];
    S.cautions = [
      { id: 'c1', num: '694066', referenceBanque: '810012624000694066', type: 'retenue_garantie', banque: 'BMCE Bank', montant: 13088, statut: 'active', marche_id: 'm1', date_emission: '2026-01-02' },
      { id: 'c2', num: '133243', type: 'bonne_execution', banque: 'FINEA', montant: 105740, statut: 'active', marche_id: 'm1', date_emission: '2021-11-29' }
    ];
    S.aos = []; S.paiements = S.paiements || [];
    nav('cautions');
  });
});

test('la liste montre la référence complète + alias, ou l\'alias seul', async ({ page }) => {
  const ligneMigree = page.locator('tr', { hasText: '810012624000694066' }).first();
  await expect(ligneMigree).toHaveCount(1);
  await expect(ligneMigree).toContainText('alias 694066');
  const ligneNonMigree = page.locator('tr', { hasText: '133243' }).first();
  await expect(ligneNonMigree).toHaveCount(1);
  await expect(ligneNonMigree).not.toContainText('alias');
  await expect(ligneNonMigree).not.toContainText('—');
});

test("le formulaire porte le champ référence banque, pré-rempli, et l'envoie à l'API", async ({ page }) => {
  // Document tel que l'API le sert (forme Cosmos : marcheId) ; POST = ce que le formulaire envoie.
  const SERVI = { id: 'c1', num: '694066', referenceBanque: '810012624000694066', type: 'retenue_garantie', banque: 'BMCE Bank', montant: 13088, statut: 'active', marcheId: 'm1', date_emission: '2026-01-02' };
  let envoye = null;
  await page.route('**/mp_cautions**', (r) => {
    if (r.request().method() === 'POST') { envoye = r.request().postDataJSON(); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envoye) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SERVI) });
  });

  await page.evaluate(() => editCaution('c1'));
  const champ = page.locator('[data-champ="reference-banque"]');
  await expect(champ).toHaveCount(1);
  await expect(champ).toHaveValue('810012624000694066');
  await expect(page.locator('#cnum')).toHaveValue('694066'); // l'alias reste un champ distinct

  await champ.fill('810012624000694067');
  await page.locator('.mf .btn-prim', { hasText: 'Enregistrer' }).click();
  await expect.poll(() => envoye && envoye.referenceBanque, { timeout: 5000 }).toBe('810012624000694067');
  expect(envoye.num).toBe('694066');
  expect(envoye.marcheId).toBe('m1');
});
