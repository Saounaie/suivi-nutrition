# Suivi nutrition

Appli perso (PWA pour iPhone) de suivi des calories et macros, avec stock du frigo. Aucune installation, aucun serveur : les données restent sur l'appareil (IndexedDB) et s'exportent en JSON.

## Étapes
1. Catalogue d'aliments, journal du jour, budget, thème, export/import (fait)
2. Frigo : stock, déduction automatique, mode « + Courses » (fait)
3. Scan de code-barres + Open Food Facts
4. Suivi du poids et idées de repas

## Développement
- `npm test` : tests de la logique (`js/logic.js`), sans dépendance.
- Pas d'étape de build : ouvrir `index.html` via un petit serveur statique (`python3 -m http.server`).
- À chaque déploiement, incrémenter `VERSION` dans `sw.js`.

Données produits : [Open Food Facts](https://world.openfoodfacts.org) (licence ODbL).
