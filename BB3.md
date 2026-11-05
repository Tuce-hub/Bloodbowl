# Blood Bowl 3 : collecte en arrière-plan (API officielle Cyanide)

Comme Spike, le serveur du club **collecte les matchs à l'avance** ; l'appli les lit instantanément.

- `bb3Register` (appelée par l'appli) : un coach saisit son pseudo, il est inscrit.
- `bb3Collect` (toutes les 10 min) : récupère l'historique des nouveaux inscrits (toutes ligues, en plusieurs passages),
  puis les nouveaux matchs de chaque inscrit une fois par heure. Notification « Vos matchs sont prêts » à la fin de l'historique.
- Base : `bb3coaches/{id}` (avancement), `bb3matches/{id}/{match}` (matchs), lisibles par l'appli, écrites seulement par le serveur.
- Quota : 700 requêtes Cyanide par heure au maximum pour tout le club (limite Cyanide : 1 000/h).
- La clé est un **secret Firebase** (`CYANIDE_KEY`) : jamais dans l'appli ni dans ce dépôt public.

Prérequis : offre **Blaze** (voir NOTIFICATIONS.md, étape 1). Coût attendu : 0 €.

## Mise en ligne (une fois, Google Cloud Shell)
console.cloud.google.com › projet horloge-bloodbowl › icône **>_**. Une commande à la fois :

1. Code à jour (`git clone https://github.com/Tuce-hub/Bloodbowl.git` la première fois) :
   ```
   cd Bloodbowl && git pull
   ```
2. Clé Cyanide en secret (collez la clé quand c'est demandé ; elle ne s'affiche pas) :
   ```
   npx firebase-tools functions:secrets:set CYANIDE_KEY --project horloge-bloodbowl
   ```
3. Fonctions :
   ```
   cd functions-bb3 && npm install && cd ..
   npx firebase-tools deploy --only functions:bb3 --project horloge-bloodbowl
   ```
   Le premier déploiement active Cloud Scheduler (tâche toutes les 10 min). Résultat attendu : `bb3Register`, `bb3Collect`
   et les fonctions de notifications.
4. Règles : console Firebase › Realtime Database › Règles › contenu de `firebase-regles-v17.json` › Publier.

## Pour chaque coach
Réglages › Blood Bowl 3 › son pseudo › « Rechercher mes matchs Blood Bowl 3 ».
- 1re fois : inscription, puis récupération en arrière-plan (de quelques minutes à ~1 h pour 300 équipes).
  On peut fermer l'appli ; avec les notifications activées, un message prévient quand c'est prêt.
- Ensuite : « Importer mes matchs Blood Bowl 3 » est immédiat (confirmation avant import).

## Conditions Cyanide
Clé personnelle, à ne communiquer à personne. Déclarez l'appli à Cyanide : https://tuce-hub.github.io/Bloodbowl/
