# Widget iPhone (Scriptable)

Un widget pour l'écran d'accueil qui affiche ton anneau de calories du jour, tes protéines, tes glucides, tes lipides et ton poids.

Une PWA ne peut pas créer de widget iOS natif. Ce widget passe donc par **Scriptable**, une appli gratuite de l'App Store. Il lit la copie de tes données que l'appli envoie déjà dans ton dépôt GitHub privé.

## Ce qu'il faut
- L'appli à jour (v13 ou plus).
- La **synchronisation GitHub** active dans Réglages. Elle crée le fichier `data.json` dans ton dépôt privé.
- L'appli **Scriptable** (App Store, gratuite).

## Installation (5 minutes)

### 1. Un jeton en lecture seule pour le widget
Utilise un jeton **différent** de celui de la synchronisation : le widget n'a besoin que de lire.
1. GitHub, puis Settings, Developer settings, Personal access tokens, **Fine-grained tokens**, Generate new token.
2. Repository access : **Only select repositories**, et choisis ton dépôt de données (celui qui contient `data.json`).
3. Permissions, Repository permissions : **Contents : Read-only**. Rien d'autre.
4. Génère le jeton et copie-le (`github_pat_…`).

### 2. Le script
1. Ouvre Scriptable, puis touche **+** pour créer un script.
2. Colle tout le contenu de `widget/suivi-widget.js`.
3. Nomme-le « Suivi ».
4. Lance-le (▶). Il te demande :
   - le **dépôt** (`compte/nom-du-depot`),
   - le **jeton** de l'étape 1.

   Ils sont rangés dans le **trousseau** de l'iPhone, pas dans le script.
5. Un menu propose un aperçu moyen ou petit : vérifie que tes chiffres du jour s'affichent.

### 3. Le widget sur l'écran d'accueil
1. Appui long sur l'écran d'accueil, puis **+**, puis **Scriptable**.
2. Choisis la taille **moyenne** (ou petite : anneau seul), puis « Ajouter le widget ».
3. Touche le widget pour le régler :
   - **Script** : Suivi
   - **When Interacting** : Open URL, ou Run Script.

## Comment il se met à jour
- L'appli envoie tes données environ **4 secondes après chaque modification**.
- Le widget demande un rafraîchissement toutes les 15 minutes, mais **c'est iOS qui décide** du moment réel. Compte entre 15 et 60 minutes selon l'usage et la batterie. Ce n'est pas du temps réel.
- Sans réseau, il affiche les dernières données connues avec la mention « Hors ligne ».

## Si ça ne marche pas
| Symptôme | Piste |
|---|---|
| « Ouvre le script dans Scriptable pour le configurer » | Lance le script une fois dans Scriptable (▶). |
| « Données introuvables » | La synchronisation n'a jamais réussi : vérifie Réglages, Synchronisation avec Claude, dans l'appli. |
| Chiffres à zéro | Tu n'as encore rien noté aujourd'hui, ou la synchro n'a pas encore tourné. |
| Jeton refusé (401/403) | Jeton expiré, ou droit « Contents : Read-only » manquant, ou dépôt non sélectionné. Reconfigure avec le menu du script. |

## Confidentialité
- Le jeton ne sort jamais de ton iPhone (trousseau). Il n'est envoyé qu'à `api.github.com`.
- Un jeton en lecture seule limité à un seul dépôt ne permet rien d'autre que de lire ce fichier. Révoque-le sur GitHub si tu perds ton téléphone.
