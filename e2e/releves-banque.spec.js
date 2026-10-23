/* =========================================================================
 * GATE « ÉCRAN RENDU » — Relevés banque (23/10/2026).
 *   - la page offre le sélecteur de banque (4 banques, lecteurs absents nommés), le dépôt
 *     PDF, et l'historique (une ligne par relevé importé) ;
 *   - un aperçu dont un contrôle échoue affiche le refus NOMMÉ et désactive « Importer » ;
 *   - un aperçu OK sans période lue demande la période et active « Importer » ;
 *   - l'écran Cautions signale « absente des deux derniers relevés » / « vue en banque ».
 * Visée PAR MARQUEUR ([data-releves], [data-vue-banque]), jamais par position.
 * ========================================================================= */
const { test, expect } = require('@playwright/test');

const LISTES = /\/api\/(aos|marches|cautions|paiements|indices|bordereaux|banques|avenants)/;
const RELEVES = [
  { id: 'r1', banque: 'BMCE Bank', periode: '2026-09', importe_le: '2026-10-01T08:00:00Z', totaux: { encours: 100 }, compteurs: { lignes: 2, a: 1, b: 1, c: 0, inconnues: 0 }, encours: { banque: 100, mp: 60, ecart: 40 } },
  { id: 'r2', banque: 'BMCE Bank', periode: '2026-10', importe_le: '2026-10-23T08:00:00Z', totaux: { encours: 90 }, compteurs: { lignes: 1, a: 1, b: 0, c: 1, inconnues: 0 }, encours: { banque: 90, mp: 60, ecart: 30 } }
];

test.beforeEach(async ({ page }) => {
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/releves-banque**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RELEVES) }));
  await page.route('**/api/**', (r) => LISTES.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.nav === 'function' && typeof window.pgReleves === 'function' && !!window.S && !!window.MPReleves);
  await page.evaluate((rel) => { S.releves = rel; S.marches = [{ id: 'm1', ref: 'MRC-1', titre: 'Travaux X' }]; S.cautions = []; S.aos = []; S.paiements = S.paiements || []; }, RELEVES);
});

test('la page Relevés banque : banques, dépôt, historique une ligne par relevé', async ({ page }) => {
  await page.evaluate(() => nav('releves'));
  const sel = page.locator('[data-releves="banque"]');
  await expect(sel).toHaveCount(1);
  await expect(sel.locator('option')).toHaveCount(5); // 4 banques + « choisir »
  await expect(sel.locator('option', { hasText: 'Attijariwafa Bank (relevé scanné : lecteur OCR à venir)' })).toHaveCount(1);
  await expect(sel.locator('option', { hasText: "Banque Populaire (en attente de l'état d'encours demandé à l'agence)" })).toHaveCount(1);
  await expect(page.locator('[data-releves="fichier"]')).toHaveAttribute('accept', /pdf/);
  await expect(page.locator('[data-releves="historique-ligne"]')).toHaveCount(2);
  await expect(page.locator('[data-releves="historique"]')).toContainText('octobre 2026');
  // aucune donnée rendue par un tiret nu (les replis sont nommés : « sans commissions », « non renseigné »)
  await expect(page.locator('[data-releves="historique-ligne"]').first()).not.toContainText('—');
  await expect(page.locator('[data-releves="historique-ligne"]').first()).toContainText('sans commissions');
});

test('un aperçu refusé montre le refus nommé et désactive Importer ; un aperçu OK sans période la demande', async ({ page }) => {
  await page.evaluate(() => {
    nav('releves');
    var st = relState(); st.banque = 'BMCE Bank'; st.fichier = { name: 'liste-test.pdf' };
    st.pages = [{ numero: 1, lignes: [{ y: 700, items: [{ x: 40, str: 'NATURE CAUTION : 22 CAUTION DEFINITIVE' }] }, { y: 690, items: [{ x: 40, str: 'REFERENCE' }, { x: 150, str: 'DATE DELIVRANCE' }, { x: 260, str: 'MONTANT' }, { x: 330, str: 'MONTANT' }, { x: 400, str: 'MONTANT' }, { x: 470, str: 'DESTINATAIRE' }, { x: 560, str: 'TYPE' }, { x: 600, str: 'NUMERO DE MARCHE / A' }] },
      { y: 670, items: [{ x: 40, str: '810019999000000002' }, { x: 150, str: '10/11/2020' }, { x: 330, str: '168 837,00' }, { x: 470, str: 'UNIVERSITE TEST' }, { x: 560, str: '0' }, { x: 600, str: 'N° 99/UNIV/2020' }] },
      { y: 640, items: [{ x: 40, str: 'TOTAL NATURE : 170 000,00 NOMBRE DOSSIER : 2' }] }] }];
    st.images = [null];
    st.lecture = MPReleves.lire(st.banque, st.pages); // 1 ligne pour 2 dossiers, Σ ≠ total -> TOTAL_DIFFERENT
    render();
  });
  const ctl = page.locator('[data-releves="controle"]');
  await expect(ctl).toHaveAttribute('data-etat', 'refus');
  await expect(ctl).toContainText('TOTAL_DIFFERENT');
  await expect(ctl).toContainText('1 ligne(s) lue(s) pour 2 dossier(s)');
  await expect(page.locator('[data-releves="importer"]')).toBeDisabled();
  // lignes en face de la page : cellule éditable
  await expect(page.locator('td[contenteditable="true"][data-champ="montant"]')).toHaveCount(1);

  // Corriger le document (fixture) : total cohérent -> OK, période non lue -> champ période demandé, Importer actif
  await page.evaluate(() => {
    var st = relState(); st.pages[0].lignes[3].items[0].str = 'TOTAL NATURE : 168 837,00 NOMBRE DOSSIER : 1';
    st.lecture = MPReleves.lire(st.banque, st.pages); render();
  });
  await expect(page.locator('[data-releves="controle"]')).toHaveAttribute('data-etat', 'ok');
  await expect(page.locator('[data-releves="periode"]')).toHaveCount(1);
  await expect(page.locator('[data-releves="importer"]')).toBeEnabled();
});

test('résultat : une provisoire sans fiche propose « Créer l\'AO et sa caution provisoire » pré-rempli', async ({ page }) => {
  await page.evaluate(() => {
    nav('releves');
    var st = relState();
    st.resultat = { id: 'rX', banque: 'BMCE Bank', periode: '2026-10', importe_le: '2026-10-23T10:00:00Z', rapprochement: { compteurs: { lignes: 1, a: 0, b: 0, c: 0, inconnues: 1, fiches: 0 }, encours: { banque: 50000, mp: 0, ecart: 50000, reste: 0, explication: [] }, a: [], b: [], c: [],
      inconnues: [{ ligne: { type: 'CP', reference: '780009999900000001', beneficiaire: 'AGENCE TEST DES EAUX', marche: '99/TEST/2026 lot 3', lot: '3', date_echeance: '2026-11-03', heure_echeance: '11:00', date_delivrance: '2026-10-06', montant: 50000 }, motif: 'aucune fiche chez nous' }] } };
    render();
  });
  const btn = page.locator('[data-releves="creer-ao"]');
  await expect(btn).toHaveCount(1);
  await expect(page.locator('[data-releves="groupe-inconnues"]')).toContainText('remise le 03/11/2026 à 11:00');
  await btn.click();
  await expect(page.locator('#aref')).toHaveValue('99/TEST/2026');
  await expect(page.locator('#amo')).toHaveValue('AGENCE TEST DES EAUX');
  await expect(page.locator('#adlim')).toHaveValue('2026-11-03');
  await expect(page.locator('#cp_num')).toHaveValue('780009999900000001');
  await expect(page.locator('#cp_montant')).toHaveValue('50000');
  await expect(page.locator('#cp_emission')).toHaveValue('2026-10-06');
  await expect(page.locator('#aobjet')).toHaveValue(''); // l'objet n'est pas deviné
});

test('écran Cautions : « absente des deux derniers relevés » et « vue en banque »', async ({ page }) => {
  await page.evaluate(() => {
    S.cautions = [
      { id: 'c1', num: '694066', type: 'retenue_garantie', banque: 'BMCE Bank', montant: 13088, statut: 'active', marche_id: 'm1', date_emission: '2026-01-02', derniere_vue_banque: { periode: '2026-10', releveId: 'r2' } },
      { id: 'c2', num: '191999', type: 'bonne_execution', banque: 'BMCE Bank', montant: 168837, statut: 'active', marche_id: 'm1', date_emission: '2020-11-12' },
      { id: 'c3', num: '133243', type: 'bonne_execution', banque: 'FINEA', montant: 105740, statut: 'active', marche_id: 'm1', date_emission: '2021-11-29' }
    ];
    nav('cautions');
  });
  await expect(page.locator('[data-vue-banque="vue"]')).toHaveCount(1);
  await expect(page.locator('[data-vue-banque="vue"]')).toContainText('vue en banque octobre 2026');
  await expect(page.locator('[data-vue-banque="absente"]')).toHaveCount(1);
  await expect(page.locator('[data-vue-banque="absente"]')).toContainText('absente des deux derniers relevés');
  // FINEA : aucun relevé importé -> aucun signal (on ne signale pas une absence sans relevé)
  const ligneFinea = page.locator('tr', { hasText: '133243' }).first();
  await expect(ligneFinea.locator('[data-vue-banque]')).toHaveCount(0);
});
