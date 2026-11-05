# Import Blood Bowl 3 (API officielle Cyanide)

L'appli appelle la fonction Firebase `bb3Import`, qui interroge l'API de Cyanide avec **votre clé personnelle**.
La clé est rangée dans un **secret Firebase** : elle n'apparaît ni dans l'appli ni dans ce dépôt public.

Prérequis : projet Firebase en offre **Blaze** (voir NOTIFICATIONS.md, étape 1).

## Mise en ligne (une fois, Google Cloud Shell)
console.cloud.google.com › projet horloge-bloodbowl › icône **>_** (Cloud Shell). Une commande à la fois :

1. Récupérer la dernière version du code (ou `git clone https://github.com/Tuce-hub/Bloodbowl.git` la première fois) :
   ```
   cd Bloodbowl && git pull
   ```
2. Enregistrer la clé comme secret (la commande demande la valeur : collez la clé, puis Entrée ; elle ne s'affiche pas) :
   ```
   npx firebase-tools functions:secrets:set CYANIDE_KEY --project horloge-bloodbowl
   ```
3. Installer et mettre en ligne les fonctions :
   ```
   cd functions && npm install && cd ..
   npx firebase-tools deploy --only functions --project horloge-bloodbowl
   ```
   Résultat attendu : 4 fonctions, dont `bb3Import`.

## Utilisation
- **Premier import** : le plus rapide est d'importer le fichier `dugout-bb3-…json` fourni
  (Réglages › Sauvegarde et installation › Importer). Sinon, le bouton lance un import complet (jusqu'à 10 min).
- **Ensuite** : Réglages › Blood Bowl 3 › « Mettre à jour mes matchs Blood Bowl 3 ». Seules vos équipes récentes
  et les compétitions en cours de vos ligues privées sont vérifiées (~40 requêtes, ~30 s).

## Garde-fous (quotas Cyanide : 1 000 requêtes/h, 10 000/jour)
- une mise à jour toutes les 2 min par appareil, un import complet par heure ;
- plafond de 6 000 requêtes par jour pour tout le club ;
- appareil connecté à Firebase obligatoire.

## Rappel des conditions Cyanide
La clé est personnelle : ne la communiquez à personne. Cyanide demande que lui soient déclarées les applis qui
utilisent l'API : https://tuce-hub.github.io/Bloodbowl/
