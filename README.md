# Suivi nutrition

Appli perso (PWA pour iPhone) de suivi des calories et macros, avec stock du frigo. Aucune installation, aucun serveur : les données restent sur l'appareil (IndexedDB) et s'exportent en JSON.

## Étapes
1. Catalogue d'aliments, journal du jour, budget, thème, export/import (fait)
2. Frigo : stock, déduction automatique, mode « + Courses » (fait)
3. Scan de code-barres + Open Food Facts (fait, à valider sur iPhone)
4. Suivi du poids, tour de taille, moyennes sur 7 jours, idées de repas selon le frigo (fait)

## Développement
- `npm test` : tests de la logique (`js/logic.js`), sans dépendance.
- Pas d'étape de build : ouvrir `index.html` via un petit serveur statique (`python3 -m http.server`).
- À chaque déploiement, incrémenter `VERSION` dans `sw.js` ET `APP_VERSION` dans `js/version.js`.

Données produits : [Open Food Facts](https://world.openfoodfacts.org) (licence ODbL).

## Scan
- Lecteur : [ZXing](https://github.com/zxing-js/library) 0.21.3 (licence dans `vendor/`), car Safari iOS n'a pas `BarcodeDetector`.
- Un code déjà connu est retrouvé dans le catalogue local, sans appel réseau ; sinon requête Open Food Facts, puis fiche à vérifier avant enregistrement.
