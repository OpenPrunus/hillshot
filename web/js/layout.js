// Hillshot — choix de la mise en page selon la taille de la fenêtre.

/**
 * « desktop » : fenêtre Macintosh de 640 px mise à l'échelle ;
 * « portrait » : téléphone debout (ou fenêtre étroite), scène pleine largeur et commandes empilées dessous ;
 * « land » : téléphone couché (fenêtre basse et plus large que haute), scène à gauche et commandes à droite.
 */
export function layoutFor(width, height) {
  if (height <= 520 && width > height) return 'land';
  if (width <= 720) return 'portrait';
  return 'desktop';
}
