/* Étude d'AO — appels à l'API Claude par LOTS (Message Batches) : l'étude dure plusieurs
 * minutes, l'API MP (Static Web Apps) coupe à 45 s. On soumet, puis on relève au tick.
 *
 * Seuls les documents du DCE partent (origine « dce », contrôlée ici : un document d'une autre
 * origine fait échouer la construction — gate test/etude-coffre-hors-api.test.js). Les pièces
 * du coffre de la société ne sont JAMAIS lues ni envoyées.
 *
 * Doc relue le 01/11/2026 (platform.claude.com) : citations sur documents texte (char_location),
 * citations incompatibles avec les sorties structurées → une ligne par donnée, analysée en code ;
 * lots : 50 % du prix, la plupart finis en moins d'une heure, 24 h au plus.
 */
"use strict";

const MODELE_DEFAUT = "claude-opus-5-5";
// Clé de l'API Claude déjà posée sur mp-neurones-web (décision du DG, 01/11/2026 : on réutilise
// la clé existante, partagée avec l'OCR des actes). Paramètre d'application de l'API seulement,
// jamais le front, un journal ou un commit.
const NOM_CLE = "ANTHROPIC_API_KEY";

function client() {
  const cle = process.env[NOM_CLE];
  if (!cle) return null;
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: cle, maxRetries: 2, timeout: 30000 });
}

const ORDRE = { avis: 0, rc: 1, cps: 2, bordereau: 3, modele: 4, autres: 5 };

const SYSTEME = [
  "Tu es l'ingénieur d'études de NEURONES TECHNOLOGIES (Casablanca), entreprise de travaux et d'intégration :",
  "précâblage informatique cuivre et fibre, réseaux, vidéosurveillance, sonorisation, contrôle d'accès, téléphonie,",
  "électricité courants forts et courants faibles. Tu étudies le dossier d'appel d'offres public marocain joint (DCE).",
  "",
  "Règles absolues :",
  "- Tu ne t'appuies QUE sur les documents joints. Chaque donnée que tu donnes s'appuie sur une citation exacte du dossier.",
  "- Tu n'inventes rien : si une information n'est pas dans le dossier, tu écris ABSENT ou « non précisé ».",
  "- Tu réponds en français, UNE ligne par donnée, au format demandé, sans JSON, sans tableau Markdown, sans titre.",
  "- Chaque ligne commence par son étiquette en majuscules suivie de « : », les champs sont séparés par « | ».",
  "- Les articles se notent comme dans le dossier : « RC art. 5 », « CPS art. 24 », « Bordereau prix n° 12 ».",
  "- Ce travail est un brouillon relu par un humain avant tout dépôt."
].join("\n");

const REPERES = [
  "Repères habituels de Neurones pour juger les clauses (ne pas les citer, ils servent au verdict) :",
  "pénalité de retard 1 ‰ par jour plafonnée à 10 % ; retenue de garantie 7 % remplaçable par une caution ;",
  "caution définitive 3 % du montant initial ; délai de paiement 60 jours ; réception définitive 12 mois après la provisoire ;",
  "prix révisables pour un délai long, fermes acceptables pour un délai court."
].join("\n");

function consigneAnalyse(complete) {
  const l = [
    "Étudie le dossier et réponds avec les lignes suivantes, dans cet ordre.",
    "",
    "1. L'avis : une ligne",
    "AVIS: ON_Y_VA ou ON_N_Y_VA_PAS ou A_DISCUTER | une phrase de synthèse",
    "puis une ligne par condition et une ligne par raison :",
    "CONDITION: ce qu'il faut réunir ou accepter pour y aller | article",
    "RAISON: raison de l'avis tirée du dossier (métier, délai, exigences, risques) | article",
    "",
    "2. La fiche synthèse : une ligne par clé, avec la valeur telle que le dossier la donne :",
    "FAIT: caution_provisoire | montant | article",
    "FAIT: delai_execution | délai | article",
    "FAIT: visite_lieux | date, heure, caractère obligatoire ou facultatif (ou ABSENT) | article",
    "FAIT: qualification | qualification et classification exigées, secteur, classe (ou ABSENT) | article",
    "FAIT: criteres_attribution | mode d'attribution et critères | article",
    "FAIT: eclaircissements | délai pour demander des éclaircissements (ex. « 7 jours avant la séance d'ouverture ») | article",
    "FAIT: estimation | montant de l'estimation du maître d'ouvrage, en précisant HT ou TTC | article",
    "FAIT: date_limite | date limite de remise des plis (JJ/MM/AAAA) | article",
    "FAIT: heure_limite | heure limite (HH:MM) | article",
    "FAIT: lieu_depot | lieu et mode de dépôt (papier, électronique) | article",
    "",
    "3. Les clauses : une ligne pour CHACUNE des clés penalites, retenue_garantie, caution_definitive, revision_prix, delai_paiement, reception, assurances :",
    "CLAUSE: clé | ce que dit le dossier (ou ABSENT) | DEFAVORABLE ou HABITUEL ou A_SURVEILLER ou A_DEMANDER | article | pourquoi ce verdict",
    "Une clause absente du dossier s'écrit ABSENT avec le verdict A_DEMANDER.",
    REPERES
  ];
  if (complete) {
    l.push(
      "",
      "4. La liste COMPLÈTE des pièces exigées par le règlement de consultation, sans en oublier aucune, une ligne par pièce :",
      "PIECE: ADMINISTRATIF ou TECHNIQUE ou ADDITIF ou OFFRE_TECHNIQUE ou FINANCIER | pièce exigée | article | précision (original, copie certifiée, signé, paraphé…)",
      "Parcours tout le RC (dossier administratif, dossier technique, dossier additif, offre technique s'il y en a, offre financière).",
      "",
      "5. Les questions à poser au maître d'ouvrage : incohérences entre le CPS et le bordereau (quantités, désignations, articles",
      "présents d'un côté et pas de l'autre), clauses absentes, ambiguïtés. Une ligne par question :",
      "QUESTION: la question, rédigée pour être envoyée | pourquoi elle est posée | articles concernés",
      "",
      "6. Si le RC demande un sous-détail des prix pour certains articles, une ligne par article demandé :",
      "SOUSDETAIL: numéro du prix | ce que dit le RC"
    );
  }
  return l.join("\n");
}

function consigneMemoire(typeAo) {
  const neuf = typeAo !== "fournitures" && typeAo !== "services";
  const chapitres = neuf
    ? ["Présentation de l'entreprise", "Compréhension du projet", "Encadrement et organisation du chantier", "Méthodologie d'exécution",
      "Planning et phasage", "Moyens humains et matériels", "Hygiène, sécurité et environnement", "Plan d'assurance qualité", "Références"]
    : ["Présentation de l'entreprise", "Compréhension du besoin", "Solution proposée et conformité", "Méthodologie et planning",
      "Moyens humains et matériels", "Garantie, maintenance et qualité", "Références"];
  return [
    "Rédige la note méthodologique (mémoire technique) de Neurones pour ce dossier, en " + chapitres.length + " chapitres :",
    chapitres.map((c, i) => (i + 1) + ". " + c).join(" ; "),
    "",
    "Format : pour chaque chapitre une ligne",
    "CHAPITRE: numéro | titre",
    "puis ses paragraphes, une ligne chacun :",
    "PARA: texte du paragraphe",
    "",
    "Adapte chaque chapitre au CPS : périmètre, lots, prescriptions techniques, essais, réceptions, délais, documents à fournir.",
    "Cite le dossier pour chaque exigence reprise. N'invente AUCUN fait sur Neurones (chiffre d'affaires, effectifs, noms,",
    "références, certifications) : écris à la place « [à compléter : …] ». Style sobre, précis, phrases complètes."
  ].join("\n");
}

function consigneConformite(articles) {
  const liste = articles.map((a) => a.num + " — " + a.designation).join("\n");
  return [
    "Pour CHAQUE article du bordereau ci-dessous, donne l'exigence technique du CPS qui le décrit, une ligne par article :",
    "CONF: numéro du prix | exigence du CPS, résumée fidèlement (caractéristiques, normes, marques imposées) | Conforme | STANDARD ou OPTION | article du CPS",
    "La réponse est TOUJOURS « Conforme » (jamais « par équivalence »). STANDARD si la caractéristique est fournie en standard",
    "par les produits du marché, OPTION si elle demande une option ou un module à prévoir. Si le CPS ne décrit pas l'article,",
    "écris « non décrit dans le CPS » comme exigence et « - » comme article.",
    "",
    "Articles du bordereau :",
    liste
  ].join("\n");
}

const CONSIGNE_BORDEREAU = [
  "Relève TOUS les articles du bordereau des prix (détail estimatif) du dossier, une ligne par article, sans en sauter :",
  "ARTICLE: numéro du prix | désignation complète | unité | quantité (nombre seul)"
].join("\n");

const CONSIGNE_OCR = [
  "Ce document est une numérisation. Transcris fidèlement TOUT son texte, page par page, sans résumer ni corriger.",
  "Commence chaque page par une ligne « === Page N === » (N = numéro de page dans le fichier). Conserve les numéros",
  "d'articles et les tableaux (cellules séparées par « | »). N'ajoute aucun commentaire."
].join("\n");

/* Document texte avec citations. Le titre est court (limité par l'API), le contexte nomme la classe. */
function blocDocument(d, i, dernier) {
  if (d.origine !== "dce") throw new Error("Document refusé : seul le DCE est envoyé à l'API (origine « " + d.origine + " », " + d.fichier + ").");
  const b = {
    type: "document",
    source: { type: "text", media_type: "text/plain", data: d.texte },
    title: String(d.fichier).split("/").pop().slice(0, 180),
    context: "Pièce du DCE n° " + (i + 1) + " — classe : " + d.classe + (d.lecture === "ocr" ? " — texte lu par OCR" : "") + (d.lecture === "tableur" ? " — tableur, une ligne par ligne de feuille" : ""),
    citations: { enabled: true }
  };
  // Pas de cache : les requêtes d'un lot tournent en parallèle, le cache s'écrit (au double du prix)
  // sans jamais être relu (recette du 01/11/2026 : 703 419 jetons écrits, 0 relu).
  return b;
}

/* Choix et ordre des documents envoyés pour l'étude. Pré-étude : avis, RC, CPS seulement. */
function documentsEtudies(docs, pre) {
  const garde = docs.filter((d) => d.lecture !== "non_lu" && d.texte && d.classe !== "plans" && (!pre || d.classe === "avis" || d.classe === "rc" || d.classe === "cps"));
  garde.sort((a, b) => (ORDRE[a.classe] - ORDRE[b.classe]) || (a.fichier < b.fichier ? -1 : 1));
  return garde;
}

/* Requêtes du lot. type = 'pre' | 'complete'. ctx = { typeAo, articles (bordereau tableur) }. */
function requetesEtude(docs, type, ctx) {
  ctx = ctx || {};
  const modele = ctx.modele || MODELE_DEFAUT;
  const pre = type === "pre";
  const env = documentsEtudies(docs, pre);
  if (!env.length) throw new Error("Aucun document lisible dans le DCE (avis, RC, CPS).");
  const blocs = env.map((d, i) => blocDocument(d, i, i === env.length - 1));
  const req = (id, consigne, max) => ({
    custom_id: id,
    params: { model: modele, max_tokens: max, system: SYSTEME, messages: [{ role: "user", content: blocs.concat([{ type: "text", text: consigne }]) }] }
  });
  const out = [req("analyse", consigneAnalyse(!pre), pre ? 8000 : 16000)];
  if (!pre) {
    out.push(req("memoire", consigneMemoire(ctx.typeAo), 24000));
    const arts = ctx.articles || [];
    if (!arts.length) out.push(req("bordereau", CONSIGNE_BORDEREAU, 32000));
    else out.push(req("conformite", consigneConformite(arts), 32000));
  }
  return { requetes: out, documents: env };
}

/* Transcription d'un PDF numérisé (sans citations : le texte transcrit servira de document cité ensuite). */
function requeteOcr(d, i, modele) {
  if (d.origine !== "dce") throw new Error("Document refusé : seul le DCE est envoyé à l'API (" + d.fichier + ").");
  return {
    custom_id: "ocr_" + i,
    params: {
      model: modele || MODELE_DEFAUT, max_tokens: 64000, system: SYSTEME,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(d.octets).toString("base64") }, title: String(d.fichier).split("/").pop().slice(0, 180) },
        { type: "text", text: CONSIGNE_OCR }
      ] }]
    }
  };
}

function caracteresEnvoyes(requetes) {
  let n = 0;
  for (const r of requetes) for (const m of r.params.messages) for (const c of m.content) {
    if (c.type === "text") n += c.text.length;
    else if (c.source && c.source.type === "text") n += c.source.data.length;
    else if (c.source && c.source.type === "base64") n += Math.round(c.source.data.length * 0.75 / 1000) * 2500; // ~2 500 jetons par page estimés
  }
  return n + SYSTEME.length * requetes.length;
}
function sortieMax(requetes) { return requetes.reduce((a, r) => a + r.params.max_tokens, 0); }

async function soumettre(requetes) {
  const c = client();
  if (!c) throw new Error("Clé de l'étude d'AO non configurée côté API (" + NOM_CLE + ").");
  const b = await c.messages.batches.create({ requests: requetes });
  return { id: b.id, statut: b.processing_status, cree: b.created_at };
}
async function etatLot(id) {
  const c = client();
  if (!c) throw new Error("Clé de l'étude d'AO non configurée côté API (" + NOM_CLE + ").");
  const b = await c.messages.batches.retrieve(id);
  return { id: b.id, statut: b.processing_status, compte: b.request_counts, fini: b.ended_at, expire: b.expires_at };
}
async function resultatsLot(id) {
  const c = client();
  const out = {};
  for await (const r of await c.messages.batches.results(id)) out[r.custom_id] = r.result;
  return out;
}

module.exports = {
  MODELE_DEFAUT, NOM_CLE, client, SYSTEME, consigneAnalyse, consigneMemoire, consigneConformite, CONSIGNE_BORDEREAU, CONSIGNE_OCR,
  blocDocument, documentsEtudies, requetesEtude, requeteOcr, caracteresEnvoyes, sortieMax, soumettre, etatLot, resultatsLot
};
