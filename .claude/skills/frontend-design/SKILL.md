---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults. Installé dans mp-neurones depuis erp-neurones (07/09), section « Style maison » RÉÉCRITE aux tokens réels de MP (charte cream/forest, PAS le bleu Tailwind RH/ERP).
---

# Frontend Design

Approach this as the design lead at a small studio known for giving every client a visual identity that could not be mistaken for anyone else's. This client has already rejected proposals that felt templated, and is paying for a distinctive point of view: make deliberate, opinionated choices about palette, typography, and layout that are specific to this brief, and take one real aesthetic risk you can justify.

## Ground it in the subject

If the brief does not pin down what the product or subject is, pin it yourself before designing: name one concrete subject, its audience, and the page's single job, and state your choice. If there's any information in your memory about the human's preferences, context about what they're building, or designs you've made before – use that as a hint. The subject's own world, its materials, instruments, artifacts, and vernacular, is where distinctive choices come from. Build with the brief's real content and subject matter throughout.

## Design principles

For web designs, the hero is a thesis. Open with the most characteristic thing in the subject's world, in whatever form makes sense for it: a headline, an image, an animation, a live demo, an interactive moment. Be deliberate with your choice: a big number with a small label, supporting stats, and a gradient accent is the template answer, only use if that's truly the best option.

Typography carries the personality of the page. Pair the display and body faces deliberately, and set a clear type scale with intentional weights, widths, and spacing.

Structure is information. Structural devices — numbering, eyebrows, dividers, labels — should encode something true about the content, not decorate it.

Match complexity to the vision. Minimal directions need precision in spacing, type, and detail. Elegance is executing the chosen vision well.

## Process: brainstorm, explore, plan, critique, build, critique again

Work in two passes. First, brainstorm a short design plan (color 4–6 named hex, type roles, layout concept with ASCII wireframes, and the single signature element). Then review that plan against the brief before building: revise anything that reads like a generic default, and say what you changed and why. Only then write code, deriving every color/type decision from the plan.

Be careful with CSS selector specificity (type-based `.section` vs element `.cta` can cancel paddings/margins). Do most iteration in your thinking; only show the user something once you have confidence it'll land.

## Restraint and self-critique

Spend your boldness in one place. Let the signature element be the one memorable thing, keep everything around it quiet and disciplined, and cut any decoration that does not serve the brief. Build to a quality floor: responsive to mobile, visible keyboard focus, reduced motion respected. Critique your own work as you build (screenshots help). Chanel: before leaving the house, remove one accessory.

## More on writing in design

Words are design material. Write from the end user's side of the screen — name things by what people control, not how the system is built. Active voice; a control keeps the same verb through the whole flow (a "Publier" button produces a "Publié" toast). Treat failure and emptiness as direction, not mood. Sentence case, plain verbs, no filler.

## Style maison NEURONES — MP (mp-neurones)

Règles locales (Karim) — elles PRIMENT sur tout parti pris du skill. Tokens vérifiés dans
`public/index.html` (`:root` + `<style>`) le 07/09/2026. **ATTENTION : MP n'a PAS la charte bleu
`#1F4E78` Tailwind de RH/ERP.** MP est une **app d'un seul fichier** (`public/index.html`, vanilla
JS/CSS, aucune dépendance build) avec une charte éditoriale chaude qui lui est propre :

- **Palette (variables `:root`)** : fond `--cream #F6F2EA`, encre `--ink #1A1815` / `--ink-soft #4A453F`
  / `--ink-muted #7A7369` ; accents `--forest #1F3A2E` (primaire, boutons `.btn-prim`), `--terra #B5543A`,
  `--gold #9C7A2C` ; argent/positif `--green-soft #1A5C3A` ; filets `--line #DDD5C4` ; rouge `--red-soft #8B2A1C`.
- **Typo** : `--F 'IBM Plex Sans'` (corps), `--FM 'IBM Plex Mono'` (chiffres/montants/réfs — TOUJOURS les
  montants en mono), `--FT 'Fraunces'` serif (titres display). C'est la signature — s'en servir, ne pas
  la remplacer par une autre paire.
- **Composants existants (réutiliser, ne pas réinventer)** : `.card` (fond cream, bord `--line`, radius 5px),
  `.kpi` (+ liseré `.k1` forest / `.k2` gold / `.k3` terra / `.k4` ink), `.badge` + pastille (`.bs` vert,
  `.bw` gold, `.bd` rouge, `.bi` forest, `.bn` neutre, `.bp` terra), `.btn`/`.btn-prim`/`.btn-sm`,
  `.si` (recherche), `.fl` (select), `.tw`/`table` pour les tables denses.
- **Icônes** : MP utilise des **glyphes/emoji en entité HTML** (`&#127970;`, `&#9998;`…) inline, PAS
  lucide-react. Rester dans cette convention.
- **Le skill ne redessine JAMAIS un écran existant sans demande explicite.** Une correction, un ajout de
  colonne/section adopte l'existant. Une refonte DEMANDÉE (ex. l'écran Cautions) suit le langage visuel
  ci-dessus et se juge sur maquette publiée avant code.
- **Les partis pris audacieux sont pour les NOUVEAUX écrans/prototypes** ; sur les écrans métier
  (cautions, marchés, paiements), la priorité est la LISIBILITÉ et le nombre de gestes, pas la signature.

### Contraintes dures (Karim — non négociables sur les écrans métier)

- **Plancher 12 px** : aucun texte de DONNÉE sous 12 px. NB dette MP : plusieurs sous-libellés et badges
  sont à 9–11px (`.badge` = 10.5px) — à remonter lors de toute refonte, pas à recopier.
- **Pas d'ellipse sur une DONNÉE** : ne jamais tronquer (`.substring(0,28)`, `truncate`) un intitulé de
  marché, une désignation, un nom. Wrap / 2 lignes / tooltip — jamais couper au milieu d'une info dont
  dépend une décision. (MP tronque aujourd'hui les intitulés à 28 car. — à corriger.)
- **Pas d'identifiant technique à l'écran** : jamais un `id` Cosmos brut (`prov_…`, `veille_…`), un
  timestamp, un id fabriqué. Montrer le libellé humain (réf marché, N° de caution bancaire, réf AO).
- **Un numéro attribué par le SERVEUR ne se présente JAMAIS comme un champ éditable** — le montrer en
  badge « attribué automatiquement », lecture seule.
- **Libellés exacts** : le mot à l'écran = le mot du métier, pas le nom du champ système.
- **Contraste WCAG** systématique (texte/fond ≥ 4.5:1, grands titres ≥ 3:1) — badges et pastilles inclus.
- **Méthode (obligatoire pour toute refonte)** : audit d'usage chiffré (gestes sur un cas réel) →
  **maquette avant/après sur données RÉELLES, publiée en artifact HTML** (lien ouvrable, vraies tailles
  de texte, sélecteur avant⇄après) → **arbitrage validé AVANT de coder**. Ne jamais coder une refonte
  sans arbitrage. C'est la méthode utilisée pour BSC / BRC / historique congés côté RH.
