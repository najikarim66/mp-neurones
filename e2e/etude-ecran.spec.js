/* =========================================================================
 * GATE « ÉCRAN RENDU » — Étude d'AO et Documents de la société (01/11/2026).
 * Sur l'écran MONTÉ (Chromium), avec la fixture synthétique test/fixtures/etude-fixture.js :
 *  - aucun texte sous 12 px, aucune troncature (ellipse, débordement caché, line-clamp) ;
 *  - chaque fait / clause / pièce porte son bouton source ; un clic affiche l'extrait EXACT
 *    surligné dans le panneau Source ; une donnée sans citation affiche « à vérifier » ;
 *  - l'écart de date limite fiche ↔ dossier est en rouge ;
 *  - l'onglet Bordereau affiche l'écart à droite du total TTC ;
 *  - le coffre affiche la rubrique « à traiter » et la CNSS expirée en rouge dans le dossier.
 * Visée PAR MARQUEUR ([data-…]), jamais par position.
 * ========================================================================= */
const { test, expect } = require('@playwright/test');
const F = require('../test/fixtures/etude-fixture.js');

const LISTES = /\/api\/(aos|marches|cautions|paiements|indices|bordereaux|banques|avenants|veille)/;

async function monter(page) {
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', (r) => LISTES.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/etudes?**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.reponseApi()) }));
  await page.route('**/api/coffre', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: F.COFFRE }) }));
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.etudeOuvrir === 'function' && !!window.MPEtudeUI && !!window.S);
}

/* Contrôle de lisibilité sur tout ce qui est rendu dans la page : taille ≥ 12 px, rien de tronqué. */
async function controlerLisibilite(page) {
  return page.evaluate(() => {
    const pb = document.getElementById('pb');
    const petits = [], tronques = [];
    const walker = document.createTreeWalker(pb, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const el = n.parentElement;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (parseFloat(cs.fontSize) < 12) petits.push(cs.fontSize + ' « ' + t.slice(0, 40) + ' »');
    }
    pb.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (!el.textContent.trim()) return;
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) tronques.push('ellipse : ' + el.textContent.trim().slice(0, 40));
      if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') tronques.push('line-clamp : ' + el.textContent.trim().slice(0, 40));
      if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0) tronques.push('caché : ' + el.textContent.trim().slice(0, 40));
    });
    return { petits, tronques };
  });
}

test('Étude : sources, à vérifier, écart en rouge, lisibilité', async ({ page }) => {
  await monter(page);
  await page.evaluate(() => window.etudeOuvrir('veille_fixture'));
  await expect(page.locator('[data-ecran="etude"]')).toBeVisible();
  await expect(page.locator('[data-section="avis"] .et-stamp')).toContainText('On y va');

  // Chaque fait, clause et pièce affichés portent un bouton source (ou « à vérifier »).
  for (const sel of ['[data-fait]', '[data-clause]', '[data-piece]']) {
    const n = await page.locator(sel).count();
    expect(n, sel).toBeGreaterThan(0);
    const sans = await page.locator(sel).evaluateAll((els) => els.filter((e) => !e.querySelector('[data-src]')).length);
    expect(sans, sel + ' sans bouton source').toBe(0);
  }
  // Donnée sans citation : « à vérifier ».
  await expect(page.locator('[data-fait="qualification"] [data-averifier]')).toContainText('à vérifier');
  // Clic sur la source de la caution : extrait exact, surligné, avec sa page.
  await page.locator('[data-fait="caution_provisoire"] [data-src]').first().click();
  await expect(page.locator('[data-panneau-source] mark')).toHaveText('Le montant du cautionnement provisoire est fixé à trente-cinq mille dirhams (35 000,00 DH).');
  await expect(page.locator('[data-source-doc]')).toContainText('page 1');
  // Clic sur une donnée « à vérifier » : le panneau le dit, sans extrait inventé.
  await page.locator('[data-fait="qualification"] [data-src]').click();
  await expect(page.locator('[data-panneau-source] h2')).toContainText('à vérifier');
  await expect(page.locator('[data-panneau-source] mark')).toHaveCount(0);
  // Écart de date limite fiche (12/11) ↔ dossier (13/11) en rouge.
  const ecart = page.locator('tr[data-ecart="date_limite"][data-rouge="1"] .et-ecart').first();
  await expect(ecart).toHaveText('13/11/2026');
  expect(await ecart.evaluate((e) => getComputedStyle(e).color)).toBe('rgb(179, 38, 30)');
  // CNSS expirée du coffre : rouge dans le dossier, avec l'action.
  await expect(page.locator('tr[data-piece="cnss"][data-etat="expiree"] .et-tag.bad')).toHaveText('Expirée');
  await expect(page.locator('tr[data-piece="cnss"] button[data-coffre]')).toHaveText('Demander la nouvelle');
  // Compteurs du dossier.
  await expect(page.locator('[data-compteurs] [data-c="exigees"]')).toHaveText('8');

  const l = await controlerLisibilite(page);
  expect(l.petits, 'textes sous 12 px').toEqual([]);
  expect(l.tronques, 'textes tronqués').toEqual([]);

  // Onglet Bordereau : écart à droite du total TTC.
  await page.locator('[data-onglet="bordereau"]').click();
  await expect(page.locator('tr[data-article]')).toHaveCount(3);
  await expect(page.locator('tr[data-ttc] [data-ecart-ttc]')).toContainText('Écart avec l\'estimation');
  const pos = await page.evaluate(() => {
    const row = document.querySelector('tr[data-ttc]');
    const cells = row.querySelectorAll('td');
    return { ttc: cells[1].getBoundingClientRect().right, ecart: row.querySelector('[data-ecart-ttc]').getBoundingClientRect().left };
  });
  expect(pos.ecart).toBeGreaterThanOrEqual(pos.ttc - 1);
  await expect(page.locator('tr[data-article] .et-tag.neg')).toHaveText('à consulter');
  const l2 = await controlerLisibilite(page);
  expect(l2.petits).toEqual([]);
  expect(l2.tronques).toEqual([]);
});

test('Documents de la société : rubrique à traiter, lisibilité', async ({ page }) => {
  await monter(page);
  await page.evaluate(() => window.nav('coffre'));
  await expect(page.locator('[data-ecran="coffre"]')).toBeVisible();
  await expect(page.locator('[data-a-traiter="1"]')).toContainText('Attestation CNSS');
  await expect(page.locator('tr[data-type="cnss"][data-coffre-etat="expire"] .et-tag.bad')).toContainText('Expirée le 20/10/2026');
  const l = await controlerLisibilite(page);
  expect(l.petits).toEqual([]);
  expect(l.tronques).toEqual([]);
});
