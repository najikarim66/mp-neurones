/* =========================================================================
 * GATE « ÉCRAN RENDU » — Cautions : blocs « À demander à la banque » et « En attente de la banque »
 * (règle DG 20/11/2026). Vise PAR MARQUEUR ([data-bloc], [data-action]), jamais par position :
 *   - bloc « à demander » : pièces reçues groupées par banque, une lettre par banque, cases cochées ;
 *   - bloc « en attente » : jours écoulés depuis le dépôt, alerte au-delà du délai (15 j par défaut) ;
 *   - états vides EXPLICITES (« 0 caution — … »), jamais un bloc absent ;
 *   - actions du cycle sur les lignes (Pièce reçue / Lettre banque / Accusé banque), plus de « Libérer » direct ;
 *   - modale « Pièce reçue » : type de pièce, date, scan ;
 *   - plancher 12 px dans les blocs, aucun identifiant technique ni chemin blob à l'écran.
 * Fichier Node (playwright) — syntaxe moderne OK.
 * ========================================================================= */
const { test, expect } = require('@playwright/test');

const LISTES = /\/api\/(aos|marches|cautions|paiements|indices|bordereaux|banques|avenants)/;
const OBJET = 'Travaux de mise en place d\'un systeme de videosurveillance et de controle d\'acces pour les batiments administratifs de la province, lot unique, tranche ferme et tranche conditionnelle';

async function monter(page, fixture) {
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', (r) => LISTES.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.nav === 'function' && typeof window.pgCautions === 'function' && !!window.S);
  await page.evaluate((f) => {
    S.marches = f.marches; S.cautions = f.cautions; S.aos = f.aos; S.paiements = []; S.banques = f.banques || [];
    nav('cautions');
  }, fixture);
}

const il_y_a = (j) => new Date(Date.now() - j * 86400000).toISOString().slice(0, 10);
const FIXTURE = {
  marches: [{ id: 'm1', ref: 'MAR201800146/2018', titre: OBJET, objet: OBJET, maitre_ouvrage: 'Province de Settat' }],
  banques: [
    { id: 'bk1', nom: 'BMCE Bank', agences: [{ id: 'ag1', nom: 'Agence Casablanca Maarif', adresse: '140, boulevard Zerktouni', ville: 'Casablanca', destinataire: 'Service des engagements par signature', par_defaut: true, statut: 'confirmee' }] },
    { id: 'bk2', nom: 'CIH Bank', agences: [] } // fiche sans agence : lettre refusée, fiche nommée
  ],
  cautions: [
    { id: 'c_act', num: 'A1', type: 'bonne_execution', banque: 'FINEA', montant: 100000, statut: 'active', marche_id: 'm1', date_emission: '2025-01-10' },
    { id: 'c_dem', num: 'D1', type: 'retenue_garantie', banque: 'FINEA', montant: 20000, statut: 'mainlevee_demandee', marche_id: 'm1', date_emission: '2025-01-10', date_demande_mainlevee: il_y_a(10) },
    { id: 'c_rec1', num: '694066', referenceBanque: '810012624000694066', type: 'bonne_execution', banque: 'BMCE Bank', montant: 99072, statut: 'piece_recue', marche_id: 'm1', date_emission: '2018-06-12', piece_liberation: { type: 'mainlevee_client', date: il_y_a(2), scan: { blob: 'm1/caution-c_rec1/mainlevee_client.pdf' } }, mainlevee_client: { blob: 'm1/caution-c_rec1/mainlevee_client.pdf' }, date_mainlevee_recue: il_y_a(2) },
    { id: 'c_rec2', num: '2221776/S', type: 'retenue_garantie', banque: 'BMCE Bank', montant: 9000, statut: 'piece_recue', marche_id: 'm1', date_emission: '2019-01-03', piece_liberation: { type: 'original_caution', date: il_y_a(1), scan: { blob: 'm1/caution-c_rec2/original_caution.pdf' } }, original_caution: { blob: 'm1/caution-c_rec2/original_caution.pdf' }, date_original_recu: il_y_a(1) },
    { id: 'c_rec3', num: 'R3', type: 'bonne_execution', banque: 'CIH Bank', montant: 5000, statut: 'piece_recue', marche_id: 'm1', date_emission: '2024-01-03', piece_liberation: { type: 'mainlevee_client', date: il_y_a(3), scan: { blob: 'm1/caution-c_rec3/mainlevee_client.pdf' } } },
    { id: 'c_dep_old', num: 'B1', type: 'bonne_execution', banque: 'FINEA', montant: 30000, statut: 'demande_deposee', marche_id: 'm1', date_emission: '2024-02-01', demande_banque: { date_depot: il_y_a(20) } },
    { id: 'c_dep_new', num: 'B2', type: 'retenue_garantie', banque: 'FINEA', montant: 7000, statut: 'demande_deposee', marche_id: 'm1', date_emission: '2024-02-01', demande_banque: { date_depot: il_y_a(3) } },
    { id: 'c_lib', num: 'L1', type: 'bonne_execution', banque: 'FINEA', montant: 8000, statut: 'liberee', marche_id: 'm1', date_emission: '2023-01-05', date_liberation: '2025-06-01', accuse_banque: { blob: 'm1/caution-c_lib/accuse_banque.pdf' } }
  ],
  aos: [
    { id: 'ao1', ref: '21/ANEF/2026', objet: 'Fourniture de materiel', maitre_ouvrage: 'ANEF', statut: 'infructueux', caution_prov: { num: 'P1', banque: 'CIH Bank', montant: 50000, statut: 'piece_recue', date_emission: '2026-03-01', piece_liberation: { type: 'original_caution', date: il_y_a(4), scan: { blob: 'ao-ao1/caution-prov/original_caution.pdf' } } } }
  ]
};

test('bloc « À demander à la banque » : pièces reçues groupées par banque, une lettre par banque, provisoire incluse', async ({ page }) => {
  await monter(page, FIXTURE);
  const bloc = page.locator('[data-bloc="a-demander-banque"]');
  await expect(bloc).toHaveCount(1);
  await expect(bloc).toHaveAttribute('data-nb', '4'); // c_rec1, c_rec2, c_rec3 + provisoire P1
  await expect(bloc).toContainText('À demander à la banque — 4');
  // Un groupe par banque, un bouton « Lettre » par groupe (une lettre = une banque)
  await expect(bloc.locator('div[data-banque]')).toHaveCount(2);
  await expect(bloc.locator('div[data-banque="BMCE Bank"] [data-action="lettre-banque"]')).toHaveCount(1);
  await expect(bloc.locator('div[data-banque="CIH Bank"] [data-action="lettre-banque"]')).toHaveCount(1);
  // Référentiel : BMCE complète (agence affichée, lettre active) ; CIH sans agence (lettre désactivée, fiche nommée, bouton « Ouvrir la fiche banque »)
  await expect(bloc.locator('div[data-banque="BMCE Bank"]')).toHaveAttribute('data-complet', 'oui');
  await expect(bloc.locator('div[data-banque="BMCE Bank"] [data-agence]')).toContainText('Agence Casablanca Maarif — 140, boulevard Zerktouni, Casablanca');
  await expect(bloc.locator('div[data-banque="CIH Bank"]')).toHaveAttribute('data-complet', 'non');
  await expect(bloc.locator('div[data-banque="CIH Bank"] [data-action="lettre-banque"]')).toBeDisabled();
  await expect(bloc.locator('div[data-banque="CIH Bank"] [data-agence-manquante]')).toContainText('fiche banque « CIH Bank »');
  await expect(bloc.locator('div[data-banque="CIH Bank"] [data-action="ouvrir-fiche"]')).toHaveCount(1);
  await expect(bloc).toHaveAttribute('data-nb-incomplets', '1');
  await expect(bloc.locator('div[data-banque="BMCE Bank"] [data-ligne-demande]')).toHaveCount(2);
  await expect(bloc.locator('div[data-banque="CIH Bank"] [data-ligne-demande]')).toHaveCount(2); // R3 + provisoire
  // Cases cochées par défaut ; la nature et la pièce sont dites en mots
  await expect(bloc.locator('input.cible-banque:checked')).toHaveCount(4);
  await expect(bloc.locator('div[data-banque="BMCE Bank"]')).toContainText('mainlevée du client');
  await expect(bloc.locator('div[data-banque="BMCE Bank"]')).toContainText('original restitué');
  await expect(bloc.locator('div[data-banque="CIH Bank"]')).toContainText('Caution provisoire');
  // La modale « Lettre » ne demande RIEN : destinataire résolu du référentiel, aucun champ de saisie
  await bloc.locator('div[data-banque="BMCE Bank"] [data-action="lettre-banque"]').click();
  await expect(page.locator('#mod [data-destinataire]')).toContainText('Agence Casablanca Maarif');
  await expect(page.locator('#mod [data-destinataire]')).toContainText('140, boulevard Zerktouni');
  await expect(page.locator('#mod [data-destinataire]')).toContainText('Service des engagements par signature');
  await expect(page.locator('#mod input, #mod textarea, #mod select')).toHaveCount(0);
  await expect(page.locator('#mod')).toContainText('Aucun envoi par courriel');
  await expect(page.locator('[data-action="generer-lettre"]')).toHaveCount(1);
  await page.evaluate(() => closeMod());
  // Depuis une ligne CIH (fiche sans agence) : la modale refuse, nomme la fiche et propose de l'ouvrir
  await page.locator('.cauv2 table').first().locator('tr', { hasText: 'R3' }).locator('[data-action="lettre-banque"]').click();
  await expect(page.locator('#mod [data-lettre-refusee]')).toContainText('fiche banque « CIH Bank »');
  await expect(page.locator('#mod [data-action="ouvrir-fiche"]')).toHaveCount(1);
  await page.locator('#mod [data-action="ouvrir-fiche"]').click();
  await expect(page.locator('[data-param="banques"] [data-fiche-banque="CIH Bank"]')).toHaveCount(1);
  await expect(page.locator('[data-param="banques"] [data-fiche-banque="CIH Bank"]')).toContainText('fiche à compléter : aucune agence');
  await page.evaluate(() => nav('cautions'));
  // « Enregistrer le dépôt » : date obligatoire
  await bloc.locator('div[data-banque="BMCE Bank"] [data-action="depot-banque"]').click();
  await expect(page.locator('#db_date')).toHaveCount(1);
  await expect(page.locator('#mod')).toContainText('2 caution(s)');
  await page.evaluate(() => closeMod());
});

test('bloc « Libérations à justifier » : libérée sans accusé affichée distinctement, comptée dans l\'engagé, marché terminé listé', async ({ page }) => {
  const fx = JSON.parse(JSON.stringify(FIXTURE));
  fx.marches.push({ id: 'm40', ref: '40/2024', titre: 'Travaux ONP', objet: 'Travaux ONP', maitre_ouvrage: 'ONP', statut: 'termine', termine_le: '2026-10-09', reception_definitive_prononcee: true });
  fx.cautions.push({ id: 'c_sa1', num: '186921', type: 'bonne_execution', banque: 'FINEA', montant: 36249, statut: 'liberee', marche_id: 'm40', date_emission: '2024-11-22', date_liberation_effective: '2026-08-03', liberation_motif: 'Regularisation' });
  fx.cautions.push({ id: 'c_sa2', num: '194056', type: 'retenue_garantie', banque: 'FINEA', montant: 84580, statut: 'liberee', marche_id: 'm40', date_emission: '2025-03-28', date_liberation_effective: '2026-08-03' });
  await monter(page, fx);
  const bloc = page.locator('[data-bloc="liberations-a-justifier"]');
  await expect(bloc).toHaveCount(1);
  await expect(bloc).toHaveAttribute('data-nb', '2');
  await expect(bloc).toContainText('Libérations à justifier — 2');
  await expect(bloc).toContainText('120');  // 120 829 MAD
  await expect(bloc.locator('[data-etat="liberee-sans-accuse"]')).toHaveCount(2);
  await expect(bloc.locator('[data-etat="liberee-sans-accuse"]').first()).toContainText('Libérée — accusé de la banque manquant');
  await expect(bloc.locator('[data-ligne-justifier]').first()).toContainText('passée à cet état le 03/08/2026');
  await expect(bloc.locator('[data-ligne-justifier]').first()).toContainText('auteur non enregistré');
  await expect(bloc.locator('[data-marches-termines]')).toContainText('40/2024');
  await expect(bloc.locator('[data-marches-termines]')).toContainText('sans être rouvert');
  await expect(bloc.locator('button', { hasText: '+ Accusé' })).toHaveCount(2);
  // la libérée AVEC accusé (L1) n'y est pas ; l'engagé FINEA inclut les 120 829 : 157 000 + 120 829 = 277 829
  await expect(bloc).not.toContainText('L1');
  await expect(page.locator('.cauv2')).toContainText('277');
  // état vide explicite
  await monter(page, FIXTURE);
  await expect(page.locator('[data-bloc="liberations-a-justifier"]')).toHaveAttribute('data-nb', '0');
  await expect(page.locator('[data-bloc="liberations-a-justifier"] [data-vide]')).toContainText('0 caution');
});

test('bloc « En attente de la banque » : jours écoulés, alerte au-delà de 15 jours, accusé comme seule sortie', async ({ page }) => {
  await monter(page, FIXTURE);
  const bloc = page.locator('[data-bloc="en-attente-banque"]');
  await expect(bloc).toHaveCount(1);
  await expect(bloc).toHaveAttribute('data-nb', '2');
  await expect(bloc).toHaveAttribute('data-nb-alerte', '1');
  await expect(bloc).toContainText('Alerte au-delà de 15 jours');
  const lignes = bloc.locator('[data-ligne-attente]');
  await expect(lignes).toHaveCount(2);
  await expect(lignes.nth(0)).toContainText('B1'); // la plus ancienne d'abord
  await expect(lignes.nth(0)).toContainText('20 j');
  await expect(lignes.nth(0).locator('[data-alerte]')).toHaveCount(1);
  await expect(lignes.nth(0)).toContainText('la banque prélève encore ses commissions');
  await expect(lignes.nth(1)).toContainText('3 j');
  await expect(lignes.nth(1).locator('[data-alerte]')).toHaveCount(0);
  await expect(bloc.locator('[data-action="accuse-banque"]')).toHaveCount(2);
  // Les cautions en attente restent dans l'engagé par banque : FINEA = 100 000 + 20 000 + 30 000 + 7 000
  await expect(page.locator('.cauv2')).toContainText('157');
});

test('actions du cycle sur la liste : Pièce reçue / Lettre banque / Accusé banque ; plus de libération directe', async ({ page }) => {
  await monter(page, FIXTURE);
  const table = page.locator('.cauv2 table').first();
  await expect(table.locator('[data-action="piece-recue"]')).toHaveCount(2); // c_act + c_dem
  await expect(table.locator('[data-action="lettre-banque"]')).toHaveCount(4); // 3 définitives + provisoire
  await expect(table.locator('[data-action="accuse-banque"]')).toHaveCount(6); // 2 déposées + 4 pièces reçues (l'accusé peut arriver avant la saisie du dépôt)
  await expect(page.locator('.cauv2 button', { hasText: /^Libérer$/ })).toHaveCount(0);
  await expect(page.locator('.cauv2 button', { hasText: /Restituer$/ })).toHaveCount(0);
  // États en mots (badges) : plus jamais « Mainlevee recue »
  await expect(page.locator('.cauv2')).toContainText('Pièce reçue — à demander à la banque');
  await expect(page.locator('.cauv2')).toContainText('Demande déposée à la banque');
  await expect(page.locator('.cauv2')).toContainText('Mainlevée demandée au client');
  // Modale « Pièce reçue » : type de pièce (2 radios), date, scan obligatoire
  await table.locator('[data-action="piece-recue"]').first().click();
  await expect(page.locator('input[name="pl_type"]')).toHaveCount(2);
  await expect(page.locator('#pl_date')).toHaveCount(1);
  await expect(page.locator('#pl_file')).toHaveAttribute('accept', /pdf/);
  await expect(page.locator('#mod')).toContainText('Le scan est obligatoire');
  await page.evaluate(() => closeMod());
  // Liens vers les pièces : original restitué (définitive) et provisoire par aoId ; jamais le blob nu
  await expect(page.locator('a[href="/api/piece?type=original_caution&marcheId=m1&cautionId=c_rec2"]')).toHaveCount(1);
  await expect(page.locator('a[href="/api/piece?type=mainlevee_client&marcheId=m1&cautionId=c_rec1"]')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText('caution-c_rec');
  await expect(page.locator('body')).not.toContainText('ao-ao1/');
});

test('états vides explicites, plancher 12 px, aucun identifiant technique', async ({ page }) => {
  await monter(page, { marches: FIXTURE.marches, banques: [], aos: [], cautions: [FIXTURE.cautions[0], FIXTURE.cautions[7]] });
  const a = page.locator('[data-bloc="a-demander-banque"]'), b = page.locator('[data-bloc="en-attente-banque"]');
  await expect(a).toHaveAttribute('data-nb', '0');
  await expect(a.locator('[data-vide]')).toContainText('0 caution — aucune pièce reçue');
  await expect(b).toHaveAttribute('data-nb', '0');
  await expect(b.locator('[data-vide]')).toContainText('0 caution — aucune demande déposée');
  await expect(b).toContainText('0 en alerte');
  await monter(page, FIXTURE);
  const tailles = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-bloc] *').forEach((el) => { if (el.children.length === 0 && (el.textContent || '').trim()) out.push(parseFloat(getComputedStyle(el).fontSize)); });
    return out;
  });
  expect(tailles.length).toBeGreaterThan(10);
  expect(Math.min(...tailles)).toBeGreaterThanOrEqual(12);
  const texte = await page.locator('[data-bloc]').allInnerTexts();
  expect(texte.join(' ')).not.toMatch(/\bc_rec|\bc_dep|\bprov_|\bao1\b|m1\b|ag1\b|bk1\b/);
});
