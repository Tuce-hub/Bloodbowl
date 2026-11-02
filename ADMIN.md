# Code administrateur du direct

Le code n'est **plus jamais écrit dans les fichiers du dépôt** (public). Il est rangé dans la base Firebase,
dans la rubrique `secrets`, que personne ne peut lire ni modifier depuis l'appli. Les règles le comparent sans l'exposer.

## Mise en place (une fois, 5 min, console Firebase)
1. https://console.firebase.google.com › projet **horloge-bloodbowl** › **Realtime Database › Données**.
2. Survolez la racine › **+** › clé `secrets` ; dans `secrets`, **+** › clé `adminCode`, valeur = **votre nouveau code** (12 caractères minimum).
   ⚠️ Ne réutilisez pas l'ancien code : il est visible dans l'historique public du dépôt.
3. **Règles** › remplacez tout par le contenu de `firebase-regles-v16.json` › **Publier**.
4. **Données** › rubrique `admins` : supprimez toutes les entrées que vous ne reconnaissez pas
   (quiconque a lu l'ancien code a pu s'y ajouter). Supprimez aussi toute la rubrique `adminCodes` (elle contient l'ancien code).
5. Sur votre téléphone : Réglages › Direct › Accès administrateur › saisissez le nouveau code.

## Changer le code plus tard
Modifiez `secrets/adminCode` dans la console. Les administrateurs existants le restent ;
pour retirer quelqu'un, supprimez sa ligne dans `admins`.
