/* =========================================================================
 * GATE « ÉCRAN RENDU » — dépôt a posteriori d'un justificatif sur caution libérée.
 * Sur une caution libérée SANS pièce : boutons « + Mainlevée » / « + Accusé ».
 * Le dépôt poste a_posteriori=true et affiche « Justificatif joint (statut inchangé) ».
 * Une caution libérée qui a déjà ses pièces n'affiche pas ces boutons.
 * ========================================================================= */
const { test, expect } = require('@playwright/test');

const LISTES = /\/api\/data\//; // listes = /api/data/mp_* -> tableau vide
const lignes = (page) => page.locator('#pb table tbody tr');

test.beforeEach(async ({ page }) => {
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', (r) => LISTES.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.nav === 'function' && typeof window.pgCautions === 'function' && !!window.S);
  await page.evaluate(() => {
    S.marches = [{ id: 'm1', ref: '40/2024', titre: 'Sécurisation accès ONP' }];
    S.paiements = [];
    S.aos = [];
    S.cautions = [
      { id: 'cReg', num: '194056', type: 'retenue_garantie', banque: 'FINEA', montant: 84580, statut: 'liberee', marche_id: 'm1', date_emission: '2025-03-28', acte: { blob: 'actes/x.pdf' } }, // régularisée : ni mainlevée ni accusé
      { id: 'cFull', num: '200000', type: 'bonne_execution', banque: 'BMCE', montant: 10000, statut: 'liberee', marche_id: 'm1', date_emission: '2025-01-01', mainlevee_client: { blob: 'preuves/ml.pdf' }, accuse_banque: { blob: 'preuves/acc.pdf' } } // déjà complète
    ];
    nav('cautions');
  });
});

test('caution libérée sans pièce : boutons + Mainlevée / + Accusé ; le dépôt poste a_posteriori', async ({ page }) => {
  const rowReg = lignes(page).filter({ hasText: '194056' });
  await expect(rowReg.getByRole('button', { name: '+ Mainlevée' })).toHaveCount(1);
  await expect(rowReg.getByRole('button', { name: '+ Accusé' })).toHaveCount(1);

  // la caution déjà complète n'a aucun de ces boutons
  const rowFull = lignes(page).filter({ hasText: '200000' });
  await expect(rowFull.getByRole('button', { name: '+ Mainlevée' })).toHaveCount(0);
  await expect(rowFull.getByRole('button', { name: '+ Accusé' })).toHaveCount(0);

  // dépôt a posteriori de l'accusé -> le POST porte a_posteriori=true + piece_type accuse_banque
  let posted = null;
  await page.route('**/api/caution-piece', (r) => {
    posted = JSON.parse(r.request().postData() || '{}');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, a_posteriori: true, caution: '194056', nouveau_statut: 'liberee' }) });
  });
  await rowReg.getByRole('button', { name: '+ Accusé' }).click();
  await expect(page.locator('#pc_btn')).toBeVisible();
  await expect(page.locator('.mb2')).toContainText('statut ne change pas');
  await page.locator('#pc_date').fill('2025-06-01');
  await page.locator('#pc_file').setInputFiles({ name: 'accuse.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 acc') });
  await page.locator('#pc_btn').click();

  await expect.poll(() => posted && posted.a_posteriori).toBe(true);
  expect(posted.piece_type).toBe('accuse_banque');
  expect(posted.date).toBe('2025-06-01');
  await expect(page.locator('#toast')).toContainText('Justificatif joint');
});
