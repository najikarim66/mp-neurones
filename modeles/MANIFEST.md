# Kit AO — index (le contenu n'est PAS dans ce dépôt)

Le dépôt mp-neurones est **public** sur GitHub : le kit de réponse aux AO (mémoires, bordereaux de référence avec prix, méthodologie) n'y est donc pas copié. Il est versionné dans le **Blob privé** `mp-modeles` (compte de stockage du tenant), sous `kit-ao/<date de copie>/`. Ce fichier n'en garde que l'index : nom, taille, empreinte SHA-256 (16 premiers caractères), date du fichier source.

- Copie du **01/11/2026**, préfixe `kit-ao/2026-11-01/` — 24 fichiers.
- Source : OneDrive NEURONES TECHNOLOGIES, dossiers `neurones_AO/neurones-ao-kit` (kit, 9 chapitres) et `Bureau/AO FMI` (modèles administratifs 2022), plus deux modèles isolés (moyens humains et techniques 2020, sous-détail des prix 2021).
- Une nouvelle version du kit = une nouvelle copie datée (l'ancienne reste), puis une nouvelle section ici.
- Le kit ne contient pas de mémoire en 7 chapitres : la structure en 7 chapitres (fournitures et services) est celle de `api/etude/claude.js` (consigneMemoire).

| Fichier | Octets | SHA-256 (16) | Date source |
|---|---:|---|---|
| neurones-ao-kit/1_Prompts/Prompt_Demarrage_AO.txt | 7442 | 896daff1421807b2 | 2026-04-29 |
| neurones-ao-kit/2_Methodologie/Methodologie_Reponse_AO_Marocains.md | 16531 | 44a3c8ed2e40a479 | 2026-04-29 |
| neurones-ao-kit/3_Checklist/Checklist_Depot_AO.md | 6447 | 0a52170403c8528d | 2026-04-29 |
| neurones-ao-kit/4_Templates_Memoire/build_memoire.js | 6095 | da9a267b81dbf8dc | 2026-04-29 |
| neurones-ao-kit/4_Templates_Memoire/chapitre4_v2.js | 105170 | a171a1245d0321f7 | 2026-04-29 |
| neurones-ao-kit/4_Templates_Memoire/chapitres_1_3.js | 41504 | 32da86cab06e3133 | 2026-04-29 |
| neurones-ao-kit/4_Templates_Memoire/chapitres_4_5.js | 93239 | 970483894321d95c | 2026-04-29 |
| neurones-ao-kit/4_Templates_Memoire/chapitres_6_fin.js | 35398 | 5e61f4d1fd539172 | 2026-04-29 |
| neurones-ao-kit/4_Templates_Memoire/INSTRUCTIONS.md | 6453 | aadc7a5a8f4fe751 | 2026-04-29 |
| neurones-ao-kit/4_Templates_Memoire/lib_helpers.js | 11648 | 9921b7b780cfa66f | 2026-04-29 |
| neurones-ao-kit/5_Reference_Kenitra/Bordereau_100_Conforme_Kenitra_v4.xlsx | 67739 | 9ea555e213d1723f | 2026-04-29 |
| neurones-ao-kit/5_Reference_Kenitra/Memoire_Technique_Kenitra_v4.docx | 256306 | 35fa034e5df6a3e4 | 2026-04-30 |
| neurones-ao-kit/5_Reference_Kenitra/README.md | 4080 | 7687393a71ea3474 | 2026-04-29 |
| neurones-ao-kit/README.md | 7468 | 318eceea44e186d8 | 2026-04-29 |
| modeles-administratifs-AO-FMI-2022/Annexes.docx | 47483 | 67112970040e404e | 2022-11-23 |
| modeles-administratifs-AO-FMI-2022/dossier Administratif/Déclaration sur l'honneur.docx | 13642 | c8b0a5665d1379be | 2022-11-25 |
| modeles-administratifs-AO-FMI-2022/dossier Technique/Equipe projet.docx | 13258 | e1a31f1d12234ab1 | 2022-11-25 |
| modeles-administratifs-AO-FMI-2022/dossier Technique/Note sur les moyens humains.docx | 11141 | dee7df4f37b59b52 | 2022-11-25 |
| modeles-administratifs-AO-FMI-2022/dossier Technique/Tableau des références clients.docx | 11950 | 0625c48222abfd96 | 2022-11-25 |
| modeles-administratifs-AO-FMI-2022/Offre financière/Annexe 4 -Acte d'engagement.docx | 14379 | f19175bb064c7b70 | 2022-11-25 |
| modeles-administratifs-AO-FMI-2022/Offre financière/Bordereau des prix.xlsx | 11680 | 377bc2a64cf0283b | 2022-11-25 |
| modeles-administratifs-AO-FMI-2022/Offre Technique/Annexe 8 Matrice de Conformité.docx | 26892 | 8ef37f9a669a6c5d | 2022-11-25 |
| divers/Moyens humains et techniques version sept 2020.docx | 80578 | b43e96e557167a59 | 2020-09-02 |
| divers/Sous detail des prix avenant MARCHE N 02-2018- TPI MEKNES-09-12-2021.xls | 269312 | 1cc8c34ea60d8f99 | 2021-12-09 |

## Rapprochement avec Neurones_AO_Kit_Complet.zip (Téléchargements du DG, 01/11/2026)

Zip de 305 768 octets, 14 fichiers, tous dans `neurones-ao-kit/` (aucun modèle administratif, aucun mémoire en 7 chapitres).

- **13 fichiers identiques** octet pour octet (même SHA-256) à la copie `kit-ao/2026-11-01/` ci-dessus.
- **1 fichier différent** : `neurones-ao-kit/5_Reference_Kenitra/Memoire_Technique_Kenitra_v4.docx`, 149 792 octets, SHA-256 `fbb392d03770edde`, daté du 29/04/2026. La copie OneDrive (256 306 octets, 30/04/2026) est plus récente : elle reste la référence. La variante du zip est gardée à part, préfixe `kit-ao/2026-11-01-zip-telechargements/`.
- Le bordereau paramétrique du kit est `5_Reference_Kenitra/Bordereau_100_Conforme_Kenitra_v4.xlsx` (identique dans les deux sources).
