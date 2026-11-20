/* =========================================================================
 * GATE « ÉCRAN RENDU » — PARCOURS COMPLET du cycle de mainlevée (constat DG 20/11 13h05 : après la lettre,
 * plus de bouton pour l'accusé). Sur l'écran monté, une caution traverse TOUT le cycle et, à CHAQUE état,
 * l'action qui mène au suivant est visible et fonctionne :
 *   active → Pièce reçue → piece_recue → Lettre banque (PDF) → Enregistrer le dépôt → demande_deposee
 *   → + Accusé de la banque → liberee → marché terminé (dernière caution, PV présent).
 * Variante : l'accusé arrive AVANT que le dépôt soit enregistré (piece_recue) : « + Accusé de la banque » est
 * présent et demande la date de dépôt dans la même modale. Même parcours pour une provisoire (aoId) et pour
 * une lettre regroupant deux cautions. Le serveur est SIMULÉ en Node (page.route) avec le MÊME module pur
 * que la production (public/pv-mainlevee.js) : les transitions jouées sont celles de l'API.
 * Fichier Node (playwright) — syntaxe moderne OK.
 * ========================================================================= */
const { test, expect } = require('@playwright/test');
const MPM = require('../public/pv-mainlevee.js');

const LISTES = /\/api\/data\/(mp_aos|mp_marches|mp_cautions|mp_paiements|mp_indices|mp_bordereau|mp_banques|mp_avenants)/;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const OBJET = 'Travaux de mise en place d\'un système de vidéosurveillance et de contrôle d\'accès pour les bâtiments administratifs de la province';

/* Etat « serveur » : documents tels que Cosmos les porte (marcheId côté caution, comme en prod). */
function etatInitial() {
  return {
    marches: [{ id: 'm1', ref: 'MAR201800146/2018', titre: OBJET, objet: OBJET, maitre_ouvrage: 'Province de Settat', statut: 'en_cours', reception_definitive_prononcee: true, montant: 500000 }],
    cautions: [
      { id: 'c1', marcheId: 'm1', num: '694066', referenceBanque: '810012624000694066', type: 'bonne_execution', banque: 'BMCE Bank', montant: 99072, statut: 'active', date_emission: '2018-06-12' },
      { id: 'c2', marcheId: 'm1', num: '2221776/S', type: 'retenue_garantie', banque: 'BMCE Bank', montant: 9000, statut: 'active', date_emission: '2019-01-03' }
    ],
    aos: [{ id: 'ao1', ref: '21/ANEF/2026', objet: 'Fourniture de matériel', maitre_ouvrage: 'ANEF', statut: 'infructueux', caution_prov: { num: 'P1', banque: 'BMCE Bank', montant: 50000, statut: 'active', date_emission: '2026-03-01' } }],
    banques: [{ id: 'bk1', nom: 'BMCE Bank', agences: [{ id: 'ag1', nom: 'Agence Casablanca Maarif', adresse: '140, boulevard Zerktouni', ville: 'Casablanca', destinataire: 'Service des engagements par signature', par_defaut: true, statut: 'confirmee' }] }]
  };
}

/* Serveur simulé : mêmes règles pures que api/index.js. Renvoie { appels } pour vérifier ce qui a été envoyé. */
async function serveurSimule(page, E) {
  const appels = [];
  const cible = (b) => {
    if (b.aoId) { const ao = E.aos.find((a) => a.id === b.aoId); return ao ? { ao, caution: Object.assign({}, ao.caution_prov, { type: 'provisoire', _provisoire: true, ref: ao.ref, objet: ao.objet, maitre_ouvrage: ao.maitre_ouvrage }) } : null; }
    const c = E.cautions.find((x) => x.id === b.cautionId); return c ? { caution: c } : null;
  };
  const ecrire = (t, maj) => {
    if (t.ao) { const cp = Object.assign({}, maj); ['type', '_provisoire', 'ref', 'objet', 'maitre_ouvrage'].forEach((k) => delete cp[k]); t.ao.caution_prov = cp; }
    else { const i = E.cautions.findIndex((x) => x.id === maj.id); E.cautions[i] = maj; }
  };
  const recalculMarche = (marcheId, dateISO) => {
    const m = E.marches.find((x) => x.id === marcheId); if (!m) return null;
    const maj = MPM.appliquerStatutMarche(m, E.cautions.filter((c) => c.marcheId === marcheId), dateISO);
    if (maj) { E.marches[E.marches.indexOf(m)] = maj; return maj.statut; } return null;
  };
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', async (r) => {
    const req = r.request(), url = req.url(), m = req.method();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m === 'GET' && LISTES.test(url)) {
      const nom = LISTES.exec(url)[1];
      const map = { mp_aos: E.aos, mp_marches: E.marches, mp_cautions: E.cautions, mp_banques: E.banques };
      return json(200, map[nom] || []);
    }
    if (m === 'GET' && /\/api\/version/.test(url)) return json(200, { apiContract: 2, build: '1', commit: 'test', gardeVersionActive: true, delaiAlerteBanqueJours: 15 });
    if (m === 'GET' && /\/api\/role/.test(url)) return json(200, { isDg: true, role: 'dg' });
    if (m === 'GET' && /\/api\/(data\/|releves-banque)/.test(url)) return json(200, []);
    if (m === 'GET') return json(200, {});
    const body = req.postDataJSON ? (req.postDataJSON() || {}) : JSON.parse(req.postData() || '{}');
    appels.push({ url: url.replace(/^.*\/api\//, '/api/'), body });
    if (/\/api\/caution-piece$/.test(url)) {
      const t = cible(body); if (!t) return json(404, { error: 'Caution introuvable' });
      let c = t.caution;
      const ref = { blob: 'x/' + body.piece_type + '.png', nom_original: body.nom_original, content_type: body.content_type };
      let maj;
      if (MPM.PIECES_LIBERATION[body.piece_type]) maj = MPM.appliquerPieceLiberation(c, body.piece_type, ref, body.date, 'u');
      else {
        if (body.piece_type === 'accuse_banque' && MPM.etatCycle(c) === 'piece_recue') {
          if (!MPM.dateReceptionValide(body.date_depot)) return json(409, { error: 'date de depot requise' });
          if (!MPM.accuseAvecDepotRecevable(c)) return json(409, { error: 'depot refuse' });
          c = MPM.appliquerDepotBanque(c, body.date_depot, 'u', c.lettre_mainlevee || null);
        }
        if (!MPM.pieceRecevable(c, body.piece_type)) return json(409, { error: 'Transition non recevable (' + c.statut + ')' });
        maj = MPM.appliquerPiece(c, body.piece_type, ref, body.date);
      }
      if (!maj) return json(409, { error: 'non recevable' });
      ecrire(t, maj);
      const ms = (!t.ao && maj.statut === 'liberee') ? recalculMarche(maj.marcheId, body.date) : null;
      return json(200, { ok: true, caution: maj.num, nouveau_statut: maj.statut, marche_statut: ms });
    }
    if (/\/api\/caution-demande-banque$/.test(url)) {
      const ts = (body.cibles || []).map(cible); if (ts.some((t) => !t)) return json(404, { error: 'Caution introuvable' });
      const gm = (id) => E.marches.find((x) => x.id === id) || {};
      if (body.action === 'lettre') {
        const L = MPM.lignesLettre(ts.map((t) => t.caution), gm, (x) => x, E.banques);
        if (!L.ok) return json(409, { error: 'Lettre refusee : ' + L.erreurs.map((e) => e.motif).join(' ; '), erreurs: L.erreurs, fiches: L.fiches });
        const lettreRef = { blob: 'lettres-mainlevee/test.pdf', nom_original: 'lettre.pdf', genere_le: new Date().toISOString(), agence: L.destinataire.agence, nb_cautions: L.lignes.length };
        ts.forEach((t) => { const maj = Object.assign({}, t.caution, { lettre_mainlevee: lettreRef, date_lettre: '2026-11-20' }); ecrire(t, maj); });
        return r.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'inline; filename="Demande de mainlevee - test.pdf"' }, body: Buffer.from('%PDF-1.4 test') });
      }
      if (body.action === 'depot') {
        if (!MPM.dateReceptionValide(body.date_depot)) return json(400, { error: 'date requise' });
        const refus = ts.filter((t) => !MPM.depotBanqueRecevable(t.caution).ok); if (refus.length) return json(409, { error: 'Depot refuse' });
        ts.forEach((t) => ecrire(t, MPM.appliquerDepotBanque(t.caution, body.date_depot, 'u', t.caution.lettre_mainlevee || null)));
        return json(200, { ok: true, nb: ts.length, statut: 'demande_deposee', date_depot: body.date_depot });
      }
    }
    return json(200, { ok: true });
  });
  return appels;
}

async function monter(page, E) {
  const appels = await serveurSimule(page, E);
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.nav === 'function' && typeof window.pgCautions === 'function' && !!window.S);
  await page.evaluate(() => { window.open = function () { return null; }; });
  // Chargement « réel » par l'app (apiLoadAll lit les listes du serveur simulé) puis écran Cautions.
  await page.evaluate(() => apiLoadAll().then(() => { S._isDg = true; nav('cautions'); }));
  await page.waitForSelector('[data-bloc="a-demander-banque"]');
  return appels;
}
const ligne = (page, num) => page.locator('.cauv2 table').first().locator('tbody tr', { hasText: num }).first();
async function deposerFichier(page, idDate, idFile, date) {
  await page.fill('#' + idDate, date);
  await page.setInputFiles('#' + idFile, { name: 'scan.png', mimeType: 'image/png', buffer: PNG });
}
async function capture(page, nom) { await page.screenshot({ path: 'test-results/parcours-' + nom + '.png', fullPage: false }); }

test('définitive : active → pièce reçue → lettre → dépôt → accusé → libérée ; à chaque état l\'action suivante est visible', async ({ page }) => {
  const E = etatInitial();
  // c2 déjà libérée avec accusé : c1 sera la DERNIÈRE caution du marché -> le marché doit passer « terminé ».
  E.cautions[1] = Object.assign(E.cautions[1], { statut: 'liberee', accuse_banque: { blob: 'x' }, date_liberation: '2026-10-01' });
  const appels = await monter(page, E);

  // 1. active : « Pièce reçue » visible
  await expect(ligne(page, '694066').locator('[data-action="piece-recue"]')).toHaveCount(1);
  await capture(page, '1-active');
  await ligne(page, '694066').locator('[data-action="piece-recue"]').click();
  await page.check('input[name="pl_type"][value="original_caution"]');
  await deposerFichier(page, 'pl_date', 'pl_file', '2026-11-18');
  await page.click('[data-action="enregistrer-piece"]');
  await expect(ligne(page, '694066')).toContainText('Pièce reçue — à demander à la banque');
  expect(appels.filter((a) => a.url === '/api/caution-piece' && a.body.piece_type === 'original_caution').length).toBe(1);

  // 2. piece_recue : Lettre banque, Enregistrer le dépôt ET + Accusé de la banque (l'accusé peut arriver avant la saisie du dépôt)
  const l1 = ligne(page, '694066');
  await expect(l1.locator('[data-action="lettre-banque"]')).toHaveCount(1);
  await expect(l1.locator('[data-action="depot-banque"]')).toHaveText('Enregistrer le dépôt');
  await expect(l1.locator('[data-action="accuse-banque"]')).toHaveCount(1);
  await expect(l1.locator('[data-action="accuse-banque"]')).toContainText('Accusé de la banque');
  await capture(page, '2-piece-recue');
  // lettre
  await l1.locator('[data-action="lettre-banque"]').click();
  await expect(page.locator('#mod [data-destinataire]')).toContainText('Agence Casablanca Maarif');
  await page.click('[data-action="generer-lettre"]');
  await expect(page.locator('#mod')).not.toHaveClass(/show/);
  expect(appels.filter((a) => a.url === '/api/caution-demande-banque' && a.body.action === 'lettre').length).toBe(1);
  await expect(ligne(page, '694066')).toContainText('Lettre de demande');
  await capture(page, '3-lettre-generee');
  // après la lettre : toujours les trois actions (dont + Accusé de la banque)
  await expect(ligne(page, '694066').locator('[data-action="accuse-banque"]')).toHaveCount(1);
  // dépôt
  await ligne(page, '694066').locator('[data-action="depot-banque"]').click();
  await page.fill('#db_date', '2026-11-19');
  await page.click('[data-action="enregistrer-depot"]');
  await expect(ligne(page, '694066')).toContainText('Demande déposée à la banque');
  await capture(page, '4-depot-enregistre');

  // 3. demande_deposee : « + Accusé de la banque » dans la liste ET dans le bloc « En attente de la banque »
  await expect(ligne(page, '694066').locator('[data-action="accuse-banque"]')).toContainText('Accusé de la banque');
  const bloc = page.locator('[data-bloc="en-attente-banque"]');
  await expect(bloc).toHaveAttribute('data-nb', '1');
  await expect(bloc.locator('[data-action="accuse-banque"]')).toHaveCount(1);
  await bloc.locator('[data-action="accuse-banque"]').click();
  await expect(page.locator('#pc_date_depot')).toHaveCount(0); // dépôt déjà enregistré : pas de date de dépôt demandée
  await deposerFichier(page, 'pc_date', 'pc_file', '2026-11-20');
  await page.click('#pc_btn');

  // 4. liberee avec accusé ; dernière caution + PV -> marché terminé
  await expect(ligne(page, '694066')).toContainText('Libérée');
  await expect(page.locator('[data-bloc="liberations-a-justifier"]')).toHaveAttribute('data-nb', '0');
  await expect(page.locator('[data-bloc="en-attente-banque"]')).toHaveAttribute('data-nb', '0');
  const acc = appels.filter((a) => a.url === '/api/caution-piece' && a.body.piece_type === 'accuse_banque');
  expect(acc.length).toBe(1);
  expect(E.cautions[0].statut).toBe('liberee');
  expect(E.marches[0].statut).toBe('termine');
  await capture(page, '5-liberee-marche-termine');
});

test('accusé reçu AVANT l\'enregistrement du dépôt : « + Accusé de la banque » présent en pièce reçue, date de dépôt demandée, deux transitions', async ({ page }) => {
  const E = etatInitial();
  E.cautions[0] = Object.assign(E.cautions[0], { statut: 'piece_recue', piece_liberation: { type: 'mainlevee_client', date: '2026-11-18', scan: { blob: 'x' } }, mainlevee_client: { blob: 'x' }, lettre_mainlevee: { blob: 'l', genere_le: '2026-11-20T10:00:00Z' }, date_lettre: '2026-11-20' });
  const appels = await monter(page, E);
  const l1 = ligne(page, '694066');
  await expect(l1.locator('[data-action="accuse-banque"]')).toHaveCount(1);
  await l1.locator('[data-action="accuse-banque"]').click();
  await expect(page.locator('#mod [data-depot-avant]')).toContainText('n\'est pas encore enregistré');
  await expect(page.locator('#pc_date_depot')).toHaveCount(1);
  // sans date de dépôt : refus côté écran, rien d'envoyé
  await deposerFichier(page, 'pc_date', 'pc_file', '2026-11-20');
  await page.click('#pc_btn');
  expect(appels.filter((a) => a.url === '/api/caution-piece').length).toBe(0);
  await page.fill('#pc_date_depot', '2026-11-19');
  await page.click('#pc_btn');
  await expect(ligne(page, '694066')).toContainText('Libérée');
  const a = appels.find((x) => x.url === '/api/caution-piece');
  expect(a.body.date_depot).toBe('2026-11-19');
  expect(E.cautions[0].demande_banque.date_depot).toBe('2026-11-19');
  expect(E.cautions[0].statut).toBe('liberee');
  await capture(page, '6-accuse-avec-depot');
});

test('provisoire (aoId) : même parcours complet, et fiche du marché : actions du cycle présentes', async ({ page }) => {
  const E = etatInitial();
  const appels = await monter(page, E);
  const lp = ligne(page, 'P1');
  await lp.locator('[data-action="piece-recue"]').click();
  await deposerFichier(page, 'pl_date', 'pl_file', '2026-11-10');
  await page.click('[data-action="enregistrer-piece"]');
  await expect(ligne(page, 'P1')).toContainText('Pièce reçue — à demander à la banque');
  expect(appels.find((a) => a.url === '/api/caution-piece').body.aoId).toBe('ao1');
  await ligne(page, 'P1').locator('[data-action="lettre-banque"]').click();
  await page.click('[data-action="generer-lettre"]');
  await expect(page.locator('#mod')).not.toHaveClass(/show/);
  expect(appels.find((a) => a.body.action === 'lettre').body.cibles[0].aoId).toBe('ao1');
  await ligne(page, 'P1').locator('[data-action="depot-banque"]').click();
  await page.fill('#db_date', '2026-11-12');
  await page.click('[data-action="enregistrer-depot"]');
  await expect(ligne(page, 'P1')).toContainText('Demande déposée à la banque');
  await ligne(page, 'P1').locator('[data-action="accuse-banque"]').click();
  await deposerFichier(page, 'pc_date', 'pc_file', '2026-11-20');
  await page.click('#pc_btn');
  await expect(ligne(page, 'P1')).toContainText('Libérée');
  expect(E.aos[0].caution_prov.statut).toBe('liberee');
  expect(!!E.aos[0].caution_prov.accuse_banque).toBe(true);
  await capture(page, '7-provisoire-liberee');
  // Fiche du marché : les cautions y portent les actions du cycle
  await page.evaluate(() => editMarche('m1'));
  await expect(page.locator('#mod [data-actions-cycle] [data-action="piece-recue"]')).toHaveCount(2);
  await capture(page, '8-fiche-marche-actions');
  await page.evaluate(() => closeMod());
});

test('lettre regroupant deux cautions : un seul PDF, un seul dépôt, les deux passent « demande déposée » puis chacune reçoit son accusé', async ({ page }) => {
  const E = etatInitial();
  E.cautions.forEach((c, i) => Object.assign(c, { statut: 'piece_recue', piece_liberation: { type: i ? 'original_caution' : 'mainlevee_client', date: '2026-11-18', scan: { blob: 'x' } } }));
  const appels = await monter(page, E);
  const bloc = page.locator('[data-bloc="a-demander-banque"]');
  await expect(bloc).toHaveAttribute('data-nb', '2');
  await expect(bloc.locator('input.cible-banque:checked')).toHaveCount(2);
  await bloc.locator('div[data-banque="BMCE Bank"] [data-action="lettre-banque"]').click();
  await expect(page.locator('#mod')).toContainText('2 caution(s)');
  await page.click('[data-action="generer-lettre"]');
  await expect(page.locator('#mod')).not.toHaveClass(/show/);
  const lettre = appels.find((a) => a.body.action === 'lettre');
  expect(lettre.body.cibles.length).toBe(2);
  await bloc.locator('div[data-banque="BMCE Bank"] [data-action="depot-banque"]').click();
  await page.fill('#db_date', '2026-11-19');
  await page.click('[data-action="enregistrer-depot"]');
  await expect(page.locator('[data-bloc="en-attente-banque"]')).toHaveAttribute('data-nb', '2');
  await expect(page.locator('[data-bloc="en-attente-banque"] [data-action="accuse-banque"]')).toHaveCount(2);
  await capture(page, '9-deux-cautions-en-attente');
  for (const num of ['694066', '2221776/S']) {
    await ligne(page, num).locator('[data-action="accuse-banque"]').click();
    await deposerFichier(page, 'pc_date', 'pc_file', '2026-11-20');
    await page.click('#pc_btn');
    await expect(ligne(page, num)).toContainText('Libérée');
  }
  expect(E.marches[0].statut).toBe('termine');
  await capture(page, '10-deux-cautions-liberees');
});
