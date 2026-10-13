/* =========================================================================
 * GATE « ÉCRAN RENDU » — liens « voir l'acte » dans la liste des cautions.
 * Cause racine corrigée : unify transporte désormais `acte`. On vérifie sur le DOM :
 *   - définitive avec acte -> lien /api/piece?type=acte&marcheId&cautionId
 *   - provisoire avec acte -> lien /api/piece?type=acte&aoId (blob porté par l'AO)
 *   - caution SANS acte -> aucun lien
 *   - libellé humain « Acte de caution du … », nouvel onglet, jamais le blob nu.
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
      { id: 'c1', num: 'A', type: 'bonne_execution', banque: 'FINEA', montant: 100000, statut: 'active', marche_id: 'm1', date_emission: '2025-01-10', acte: { blob: 'actes/a.pdf' } },
      { id: 'c2', num: 'B', type: 'bonne_execution', banque: 'BMCE', montant: 5000, statut: 'active', marche_id: 'm1', date_emission: '2025-02-01' },
      { id: 'c3', num: 'RG', type: 'retenue_garantie', banque: 'CIH', montant: 30000, statut: 'active', marche_id: 'm1', date_emission: '2025-04-01', acte: { blob: 'actes/rg.pdf' } },
      { id: 'c4', num: 'LIB', type: 'bonne_execution', banque: 'FINEA', montant: 8000, statut: 'liberee', marche_id: 'm1', date_emission: '2025-01-05', date_liberation: '2025-06-01', accuse_banque: { blob: 'preuves/acc.pdf' } }
    ];
    S.aos = [
      { id: 'ao1', ref: 'AO-1', statut: 'en_cours', marche_id: 'm1', caution_prov: { num: 'P1', banque: 'FINEA', montant: 20000, statut: 'active', date_emission: '2025-03-01', acte: { blob: 'actes/p1.pdf' } } },
      { id: 'ao2', ref: 'AO-2', statut: 'en_cours', marche_id: 'm1', caution_prov: { num: 'P2', banque: 'BMCE', montant: 3000, statut: 'active' } }
    ];
    S.paiements = S.paiements || [];
    nav('cautions');
  });
});

test('la liste expose « voir l\'acte » : définitive par cautionId, provisoire par aoId, rien sans acte', async ({ page }) => {
  const defLien = page.locator('a[href="/api/piece?type=acte&marcheId=m1&cautionId=c1"]');
  const provLien = page.locator('a[href="/api/piece?type=acte&aoId=ao1"]');

  const rgLien = page.locator('a[href="/api/piece?type=acte&marcheId=m1&cautionId=c3"]');

  await expect(defLien).toHaveCount(1);
  await expect(provLien).toHaveCount(1);
  await expect(rgLien).toHaveCount(1); // retenue de garantie : même lien (type-agnostique)

  // accusé bancaire d'une caution LIBÉRÉE -> lien visible dans la liste
  const accLien = page.locator('a[href="/api/piece?type=accuse_banque&marcheId=m1&cautionId=c4"]');
  await expect(accLien).toHaveCount(1);
  await expect(accLien).toContainText('Accus');
  await expect(accLien).toHaveAttribute('target', '_blank');

  // libellé humain + nouvel onglet (proxy authentifié)
  await expect(provLien).toContainText('Acte de caution');
  await expect(defLien).toHaveAttribute('target', '_blank');
  await expect(provLien).toHaveAttribute('target', '_blank');

  // cautions SANS acte -> aucun lien vers elles
  await expect(page.locator('a[href*="cautionId=c2"]')).toHaveCount(0);
  await expect(page.locator('a[href*="aoId=ao2"]')).toHaveCount(0);

  // jamais le chemin blob interne à l'écran (doctrine #1)
  await expect(page.locator('body')).not.toContainText('actes/');
  await expect(page.locator('body')).not.toContainText('preuves/');
});
