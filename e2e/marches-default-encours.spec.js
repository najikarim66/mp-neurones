/* =========================================================================
 * GATE « ÉCRAN RENDU » — liste des marchés : affichage par défaut = EN COURS.
 * À l'entrée sur la page marchés, le filtre statut vaut « en_cours » et seuls les
 * marchés en cours s'affichent. L'utilisateur peut repasser à « Tous statuts ».
 * En quittant puis revenant, le défaut « en cours » est ré-appliqué.
 *
 * Fichier Node (playwright) — syntaxe moderne OK.
 * ========================================================================= */
const { test, expect } = require('@playwright/test');

const LISTES = /\/api\/(aos|marches|cautions|paiements|indices|bordereaux|banques|avenants)/;
const lignes = (page) => page.locator('#pb table tbody tr');

test.beforeEach(async ({ page }) => {
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', (r) => LISTES.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.nav === 'function' && typeof window.pgMarches === 'function' && !!window.S);
  await page.evaluate(() => {
    S.cautions = [];
    S.marches = [
      { id: 'm1', ref: 'MRC-2025-001', titre: 'Travaux A', maitre_ouvrage: 'ONEE', type: 'travaux', montant: 100000, avancement: 20, statut: 'en_cours' },
      { id: 'm2', ref: 'MRC-2025-002', titre: 'Travaux B', maitre_ouvrage: 'ANP', type: 'travaux', montant: 200000, avancement: 50, statut: 'en_cours' },
      { id: 'm3', ref: 'MRC-2024-010', titre: 'Fourniture C', maitre_ouvrage: 'OCP', type: 'fournitures', montant: 50000, avancement: 100, statut: 'termine' },
      { id: 'm4', ref: 'MRC-2024-011', titre: 'Service D', maitre_ouvrage: 'ADM', type: 'services', montant: 30000, avancement: 0, statut: 'suspendu' }
    ];
    nav('marches');
  });
});

test('par défaut la liste des marchés n\'affiche que les marchés en cours', async ({ page }) => {
  // défaut appliqué par nav()
  await expect(await page.evaluate(() => S.sf)).toBe('en_cours');
  await expect(lignes(page)).toHaveCount(2); // m1 + m2
  await expect(page.locator('#pb')).toContainText('MRC-2025-001');
  await expect(page.locator('#pb')).toContainText('MRC-2025-002');
  await expect(page.locator('#pb')).not.toContainText('MRC-2024-010'); // terminé masqué
  await expect(page.locator('#pb')).not.toContainText('MRC-2024-011'); // suspendu masqué

  // reste modifiable : « Tous statuts » -> tout s'affiche
  await page.evaluate(() => { S.sf = ''; render(); });
  await expect(lignes(page)).toHaveCount(4);
  await expect(page.locator('#pb')).toContainText('MRC-2024-010');

  // quitter puis revenir -> défaut « en cours » ré-appliqué
  await page.evaluate(() => { nav('dashboard'); nav('marches'); });
  await expect(await page.evaluate(() => S.sf)).toBe('en_cours');
  await expect(lignes(page)).toHaveCount(2);
});
