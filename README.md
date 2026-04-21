# MP Neurones — Gestion des marchés publics

Application web pour la gestion des marchés publics de Neurones :
- Appels d'offres
- Marchés (suivi, statuts, ordres de service)
- Cautions bancaires (provisoire, définitive, retenue garantie)
- Paiements / décomptes

## Déploiement

Hébergé sur Azure Static Web Apps : **mp.neurones.ma**

## Architecture

- Frontend : HTML + JavaScript vanilla (pas de build)
- Backend : Azure Functions Node.js dans `api/`
- Data : Azure Cosmos DB (compte partagé `btp-pointage-db`)
- Containers utilisés : `mp_marches`, `mp_aos`, `mp_cautions`, `mp_paiements`

## Phases de développement

**Phase A (actuelle)** : Déploiement du HTML + API Cosmos avec structure en place
- ✅ SWA créée, custom domain `mp.neurones.ma`
- ✅ API Functions déployée
- ⏳ Frontend utilise encore localStorage (fallback)

**Phase B (prochaine)** : Migration du stockage vers Cosmos
- Remplacer `lsLoad()` / `lsSave()` par appels API
- Convertir IDs numériques en strings Cosmos
- Persistance en temps réel par entité

## Variables d'environnement requises

Configurer dans Azure Portal → SWA → Variables d'environnement :
- `COSMOS_CONNECTION_STRING` : connection string du Cosmos
- `COSMOS_DATABASE` : `btp-pointage`

## Endpoints API

- `GET    /api/data/mp_marches`           — Liste tous les marchés
- `GET    /api/data/mp_marches/{id}?pk={id}` — Lire un marché
- `POST   /api/data/mp_marches`           — Créer
- `PUT    /api/data/mp_marches/{id}`      — Modifier
- `DELETE /api/data/mp_marches/{id}?pk={id}` — Supprimer

Même pattern pour `mp_aos`, `mp_cautions`, `mp_paiements`.
