/* Fixture SYNTHÉTIQUE de l'étude d'AO (aucun extrait d'un vrai DCE : le dépôt est public).
 * Un RC et un CPS inventés, une réponse « comme l'API Claude » (blocs texte + citations
 * char_location), un bordereau tableur, une fiche AO dont la date limite DIFFÈRE du dossier.
 * Partagée par les gates node (test/etude-*.test.js) et la gate écran (e2e/etude-ecran.spec.js). */
'use strict';
var M = require('../../public/etude-calc.js');

function avecPages(pages) {
  var texte = '', reperes = [];
  pages.forEach(function (t, i) {
    texte += (texte ? '\n\n' : '') + '=== Page ' + (i + 1) + ' ===\n';
    reperes.push({ num: i + 1, debut: texte.length });
    texte += t;
  });
  return { texte: texte, pages: reperes };
}

var RC = avecPages([
  'REGLEMENT DE CONSULTATION\nArticle 2 - Date limite\nLa date limite de remise des plis est fixée au 13/11/2026 à 10:00.\nArticle 5 - Cautionnement provisoire\nLe montant du cautionnement provisoire est fixé à trente-cinq mille dirhams (35 000,00 DH).',
  'Article 6 - Pièces des dossiers\nLe dossier administratif comprend : la déclaration sur l\'honneur ; l\'attestation de la CNSS ; l\'attestation fiscale ; le récépissé du cautionnement provisoire.\nLe dossier technique comprend une note méthodologique et les références de travaux similaires.\nArticle 10 - Éclaircissements\nTout concurrent peut demander des éclaircissements au plus tard sept (7) jours avant la date de remise des offres.\nArticle 11 - Offre financière\nL\'offre financière comprend l\'acte d\'engagement et le bordereau des prix - détail estimatif.'
]);
var CPS = avecPages([
  'CAHIER DES PRESCRIPTIONS SPECIALES\nArticle 8 - Délai\nLe délai d\'exécution des travaux est fixé à quatre (4) mois.',
  'Article 24 - Pénalités\nIl sera appliqué une pénalité journalière de deux pour mille (2 ‰) du montant initial du marché, plafonnée à dix pour cent (10 %).\nArticle 16 - Cautionnement définitif\nLe cautionnement définitif est fixé à trois pour cent (3 %) du montant initial du marché.'
]);
var DOCS = [
  { fichier: 'Fixture/RC fictif.pdf', titre: 'RC fictif.pdf', classe: 'rc', pages: RC.pages, texte: RC.texte },
  { fichier: 'Fixture/CPS fictif.pdf', titre: 'CPS fictif.pdf', classe: 'cps', pages: CPS.pages, texte: CPS.texte }
];

function cit(doc, extrait) {
  var t = DOCS[doc].texte, i = t.indexOf(extrait);
  if (i < 0) throw new Error('extrait absent de la fixture : ' + extrait);
  return { type: 'char_location', cited_text: extrait, document_index: doc, document_title: DOCS[doc].titre, start_char_index: i, end_char_index: i + extrait.length };
}
/* Réponse au format de l'API : du texte libre, et des blocs cités intercalés. */
var BLOCS = [
  { type: 'text', text: 'AVIS: ON_Y_VA | Le lot est dans le métier de Neurones.\nCONDITION: Accepter une pénalité plus lourde que d\'habitude | CPS art. 24 | ' },
  { type: 'text', text: 'pénalité journalière de deux pour mille', citations: [cit(1, 'Il sera appliqué une pénalité journalière de deux pour mille (2 ‰) du montant initial du marché')] },
  { type: 'text', text: '\nFAIT: caution_provisoire | 35 000,00 DH | RC art. 5 | ' },
  { type: 'text', text: 'fixé à trente-cinq mille dirhams', citations: [cit(0, 'Le montant du cautionnement provisoire est fixé à trente-cinq mille dirhams (35 000,00 DH).')] },
  { type: 'text', text: '\nFAIT: delai_execution | 4 mois | CPS art. 8 | ' },
  { type: 'text', text: 'quatre mois', citations: [cit(1, 'Le délai d\'exécution des travaux est fixé à quatre (4) mois.')] },
  /* Donnée SANS citation : elle doit s'afficher « à vérifier ». */
  { type: 'text', text: '\nFAIT: qualification | Classe 3, secteur 9 | RC art. 7\nFAIT: eclaircissements | 7 jours avant la date de remise | RC art. 10 | ' },
  { type: 'text', text: 'sept jours avant', citations: [cit(0, 'Tout concurrent peut demander des éclaircissements au plus tard sept (7) jours avant la date de remise des offres.')] },
  { type: 'text', text: '\nFAIT: date_limite | 13/11/2026 | RC art. 2 | ' },
  { type: 'text', text: 'le 13/11/2026', citations: [cit(0, 'La date limite de remise des plis est fixée au 13/11/2026 à 10:00.')] },
  { type: 'text', text: '\nFAIT: heure_limite | 10:00 | RC art. 2 | ' },
  { type: 'text', text: 'à 10:00', citations: [cit(0, 'La date limite de remise des plis est fixée au 13/11/2026 à 10:00.')] },
  { type: 'text', text: '\nCLAUSE: penalites | 2 ‰ par jour, plafond 10 % | DEFAVORABLE | CPS art. 24 | Le taux habituel est de 1 ‰. ' },
  { type: 'text', text: 'deux pour mille, plafond dix pour cent', citations: [cit(1, 'Il sera appliqué une pénalité journalière de deux pour mille (2 ‰) du montant initial du marché, plafonnée à dix pour cent (10 %).')] },
  { type: 'text', text: '\nCLAUSE: caution_definitive | 3 % du montant initial | HABITUEL | CPS art. 16 | Taux habituel. ' },
  { type: 'text', text: 'trois pour cent', citations: [cit(1, 'Le cautionnement définitif est fixé à trois pour cent (3 %) du montant initial du marché.')] },
  { type: 'text', text: '\nCLAUSE: delai_paiement | ABSENT | A_DEMANDER | - | Aucun article ne fixe le délai de paiement.\n' },
  { type: 'text', text: 'PIECE: ADMINISTRATIF | Déclaration sur l\'honneur | RC art. 6 | original signé ' },
  { type: 'text', text: 'la déclaration sur l\'honneur', citations: [cit(0, 'Le dossier administratif comprend : la déclaration sur l\'honneur ; l\'attestation de la CNSS ; l\'attestation fiscale ; le récépissé du cautionnement provisoire.')] },
  { type: 'text', text: '\nPIECE: ADMINISTRATIF | Attestation de la CNSS | RC art. 6 | ' },
  { type: 'text', text: 'l\'attestation de la CNSS', citations: [cit(0, 'Le dossier administratif comprend : la déclaration sur l\'honneur ; l\'attestation de la CNSS ; l\'attestation fiscale ; le récépissé du cautionnement provisoire.')] },
  { type: 'text', text: '\nPIECE: ADMINISTRATIF | Attestation fiscale | RC art. 6 | ' },
  { type: 'text', text: 'l\'attestation fiscale', citations: [cit(0, 'Le dossier administratif comprend : la déclaration sur l\'honneur ; l\'attestation de la CNSS ; l\'attestation fiscale ; le récépissé du cautionnement provisoire.')] },
  { type: 'text', text: '\nPIECE: ADMINISTRATIF | Récépissé du cautionnement provisoire | RC art. 6 | original\nPIECE: TECHNIQUE | Note méthodologique | RC art. 6 | \nPIECE: TECHNIQUE | Références de travaux similaires | RC art. 6 | \nPIECE: FINANCIER | Acte d\'engagement | RC art. 11 | ' },
  { type: 'text', text: 'l\'acte d\'engagement', citations: [cit(0, 'L\'offre financière comprend l\'acte d\'engagement et le bordereau des prix - détail estimatif.')] },
  { type: 'text', text: '\nPIECE: FINANCIER | Bordereau des prix - détail estimatif | RC art. 11 | \nQUESTION: Le CPS ne fixe pas le délai de paiement : merci de le préciser. | Clause absente du CPS. | CPS\n' }
];

var FEUILLES = [
  { nom: 'METRE LOT A', lignes: [['N° PRIX', 'DESIGNATIONS', 'UNITE', 'TOTAL'], ['1', 'Prise RJ45', 'U', 10]] },
  { nom: 'BP', lignes: [['N° PRIX', 'DESIGNATIONS', 'UNITE', 'QUANTITEE'], ['1', 'Article d\'un autre projet', 'M3', 5]] },
  { nom: 'BPDE', lignes: [
    ['Bordereau des prix - détail estimatif'], [],
    ['N° Prix', 'Désignation des ouvrages', 'Unité', 'Quantité', 'Prix unitaire HT', 'Prix total HT'],
    ['', 'PRECABLAGE', '', '', '', ''],
    [1, 'Prise RJ45 catégorie 6A blindée', 'U', 380, '', ''],
    [2, 'Câble F/FTP catégorie 6A', 'ML', 12000, '', ''],
    ['', 'TOTAL PRECABLAGE', '', '', '', ''],
    [3, 'Baie de brassage 42U', 'U', 2, '', ''],
    ['', 'TOTAL H.T', '', '', '', ''], ['', 'TVA 20%', '', '', '', '']
  ] }
];
var CATALOGUE = [
  { designation: 'Prise RJ45 cat 6A blindée', pa: 85, origine: "conditions d'achat (article RJ45-6A)" },
  { designation: 'Câble F/FTP cat 6A LSOH', pa: 9.5, origine: 'bon de commande BC-26-001' }
];

function etudeComplete() {
  var r = M.construireResultat(M.lireLignes(BLOCS, DOCS));
  var lecture = M.choisirFeuilles(M.lireBordereauFeuilles('Fixture/BPDE fictif.xlsx', FEUILLES));
  lecture.articles.forEach(function (a) { var m = M.chercherPA(a.designation, CATALOGUE); a.pa = m ? m.pa : null; a.pa_origine = m ? m.origine : null; a.marge = 0.3; });
  r.bordereau = { articles: lecture.articles, origine: 'tableur', fichier: 'Fixture/BPDE fictif.xlsx', feuilles: lecture.feuilles, exclues: lecture.exclues, catalogue: CATALOGUE.length };
  r.conformite = []; r.memoire = [];
  return r;
}
var FICHE = { id: 'ao_fixture', ref: '00/TEST/2026', objet: 'Travaux de précâblage fictifs pour la gate', maitre_ouvrage: "Maître d'ouvrage fictif", type: 'travaux', budget_estime: 3480000, date_limite: '2026-11-12', heure_limite: '10:00' };
var VEILLE = { id: 'veille_fixture', reference_ao: '00/TEST/2026', objet: FICHE.objet, acheteur: FICHE.maitre_ouvrage, dce_status: 'ready', dce_blob_name: 'fixture.zip', date_limite: '13/11/2026', heure_limite: '10:00', score: 70 };
var COFFRE = [
  { id: 'coffre_fiscale', type: 'attestation_fiscale', libelle: 'Attestation fiscale 2026', versions: [{ v: 1, date_emission: '2026-09-01', date_validite: '2027-03-12', depose_le: '2026-09-02T10:00:00Z' }] },
  { id: 'coffre_cnss', type: 'cnss', libelle: 'Attestation CNSS', versions: [{ v: 1, date_emission: '2026-07-20', date_validite: '2026-10-20', depose_le: '2026-07-21T10:00:00Z' }] }
];

/* Réponse de GET /api/etudes telle que l'écran la reçoit. */
function reponseApi(opts) {
  opts = opts || {};
  var r = etudeComplete();
  var faits = r.faits;
  var est = FICHE.budget_estime;
  return {
    veille: VEILLE, fiche: opts.sansFiche ? null : FICHE, coffre: COFFRE, cle_configuree: true,
    versions: [{ version: 1, type: 'complete', statut: 'prete' }],
    courante: {
      id: 'etude_veille_fixture_v1', veilleId: 'veille_fixture', type_doc: 'etude', version: 1, type: 'complete', statut: 'prete', statut_libelle: 'Étude prête',
      cree_le: '2026-11-01T08:10:00Z', terminee_le: '2026-11-01T08:20:00Z', cout_usd: 0.42, validations: {},
      dce: { telecharge_le: '2026-10-29T11:00:00Z', fichiers: [
        { fichier: 'Fixture/RC fictif.pdf', classe: 'rc', lecture: 'texte', pages_total: 2 },
        { fichier: 'Fixture/CPS fictif.pdf', classe: 'cps', lecture: 'texte', pages_total: 2 },
        { fichier: 'Fixture/BPDE fictif.xlsx', classe: 'bordereau', lecture: 'tableur' },
        { fichier: 'Fixture/Plan.dwg', classe: 'plans', lecture: 'non_lu', motif_lecture: 'plan ou image : non étudié' }
      ], ecartes: [{ chemin: 'Fixture/~$RC.docx', motif: 'fichier temporaire de Word ou Excel (~$)' }] },
      resultat: r
    },
    extras: {
      totaux: M.totauxBordereau(r.bordereau.articles, est),
      ecarts: M.ecartsFiche(faits, { date_limite: FICHE.date_limite, heure_limite: FICHE.heure_limite, estimation: est }),
      eclaircissements: M.dateEclaircissements(FICHE.date_limite, faits.eclaircissements && faits.eclaircissements.valeur),
      references: [{ ref: '23/2021', objet: 'Précâblage fictif', maitre_ouvrage: 'MO fictif', montant: 1000000, attestation: 'absente du coffre' }]
    }
  };
}

module.exports = { DOCS: DOCS, BLOCS: BLOCS, FEUILLES: FEUILLES, CATALOGUE: CATALOGUE, FICHE: FICHE, VEILLE: VEILLE, COFFRE: COFFRE, etudeComplete: etudeComplete, reponseApi: reponseApi, avecPages: avecPages };
