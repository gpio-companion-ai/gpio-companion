# Stockage amovible

Une carte SD ou une clé USB supplémentaire offre plus de place à Code pour les fichiers, références et projets. Il n’existe pas de page Stockage dans l’application : le support s’ouvre depuis Ouvrir Code.

## Trouver le support

1. Branchez le support supplémentaire sur la carte gpio-companion.
2. Attendez quelques secondes.
3. Ouvrez **Code** et accédez à :

   `~/storage`

4. Ouvrez le dossier portant le nom du support, par exemple `~/storage/MA-CLE`.

Sans nom de volume, gpio-companion attribue un nom commençant par `USB-` ou `SD-`. Un second support portant le même nom reçoit le suffixe `-2`.

## Quoi y placer

Le stockage amovible convient bien pour :

- les fiches techniques de composants et images de référence
- les exports volumineux ou sauvegardes
- les expériences que vous souhaitez ouvrir manuellement dans Code

Les projets du tableau de bord vivent normalement dans `~/projects/<nom>` et se synchronisent avec GitHub. Un dossier sous `~/storage` ne devient pas automatiquement un projet du tableau de bord. Créez les projets ordinaires depuis **Projet** pour bénéficier des aperçus et de la synchronisation automatique avec la carte.

## Le retirer en sécurité

Fermez les fichiers et arrêtez les croquis qui utilisent le support. Demandez à l’agent de le démonter en sécurité, attendez sa confirmation, puis débranchez-le.

Le raccourci disparaît lorsque vous retirez le support, mais le dossier `~/storage` reste présent. La carte SD ou l’eMMC qui fait démarrer la carte n’apparaît jamais comme stockage amovible.

## Si le support n’apparaît pas

1. Rebranchez-le et attendez dix secondes.
2. Vérifiez s’il demande plus d’énergie que le port USB ne peut fournir.
3. Essayez un système de fichiers courant : FAT, exFAT, NTFS ou ext4. Les systèmes chiffrés ou inhabituels peuvent ne pas s’ouvrir automatiquement.
4. Ouvrez **Appareils → Débogage** en mode Expert et vérifiez l’espace libre ou les messages récents.
5. Demandez à l’agent : `Aidez-moi à trouver le support amovible sans le formater ni l’effacer.`

Ne formatez jamais un support pour tenter de le réparer, sauf si ses fichiers sont sauvegardés et que vous souhaitez explicitement l’effacer.
