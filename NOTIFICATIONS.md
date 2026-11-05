# Notifications Dugout : installation (une seule fois)

L'appli sait recevoir les notifications, mais l'envoi se fait par 3 petites fonctions Firebase
(`functions/index.js`) : début d'un direct, résultat, message du tchat.

## 1. Passer le projet Firebase en offre « Blaze » (5 min)
1. https://console.firebase.google.com › projet **horloge-bloodbowl**.
2. En bas à gauche : **Spark › Mettre à niveau** › Blaze. Une carte bancaire est demandée.
3. Créez une **alerte budget à 1 €** (proposée pendant la mise à niveau, sinon dans Google Cloud › Facturation › Budgets et alertes).
   Pour un club, l'usage reste dans la part gratuite : 0 € attendu.

## 2. Créer la clé « Web Push » (2 min)
1. ⚙️ **Paramètres du projet › Cloud Messaging**.
2. Rubrique **Configuration Web › Certificats Web Push › Générer une paire de clés**.
3. Copiez la **clé publique** (longue suite de caractères) et collez-la dans `index.html`,
   ligne `const VAPID_KEY="";` (ou envoyez-la à Claude). Cette clé est publique, sans risque.

## 3. Mettre à jour les règles de la base (2 min)
**Realtime Database › Règles** › remplacez tout par le contenu de `firebase-regles-v17.json` › **Publier**.
(Ajout : la rubrique `push`, où chaque téléphone enregistre son jeton et ses favoris.)

## 4. Mettre en ligne les fonctions (10 min, depuis un ordinateur)
Le plus simple : **Google Cloud Shell** (rien à installer).
1. https://console.cloud.google.com › projet horloge-bloodbowl › icône **>_** (Activer Cloud Shell) en haut à droite.
2. Collez, une ligne à la fois :
   ```
   git clone https://github.com/Tuce-hub/Bloodbowl.git && cd Bloodbowl
   cd functions && npm install && cd ..
   npx firebase-tools login --no-localhost
   npx firebase-tools deploy --only functions --project horloge-bloodbowl
   ```
3. Le premier déploiement active tout seul les services nécessaires (quelques minutes). S'il demande de réessayer, relancez la dernière commande.

## 5. Sur chaque téléphone
Réglages › **Notifications** › activez « Recevoir les notifications », puis ajoutez vos coachs favoris
(ou touchez ☆ à côté d'un coach dans l'onglet Direct). Sur iPhone : appli ajoutée à l'écran d'accueil, iOS 16.4 ou plus.
