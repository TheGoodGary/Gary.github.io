// ============================================================================
// Lógica de clasificación del alfabeto ASL a partir de los 21 landmarks
// de una mano (MediaPipe Hands). Es la misma lógica que la versión de
// escritorio en Python, portada a JavaScript.
// ============================================================================

const WRIST = 0;
const THUMB_MCP = 2, THUMB_TIP = 4;
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_TIP = 12;
const RING_MCP = 13, RING_PIP = 14, RING_TIP = 16;
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_TIP = 20;

export function distancia(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dedoExtendido(lm, tipId, pipId, wristId = WRIST) {
  return distancia(lm[tipId], lm[wristId]) > distancia(lm[pipId], lm[wristId]);
}

function pulgarExtendido(lm) {
  const dTip = distancia(lm[THUMB_TIP], lm[PINKY_MCP]);
  const dMcp = distancia(lm[THUMB_MCP], lm[PINKY_MCP]);
  return dTip > dMcp * 1.1;
}

function escalaMano(lm) {
  return Math.max(distancia(lm[WRIST], lm[MIDDLE_MCP]), 1e-6);
}

function clasificarPunoCerrado(lm, escala) {
  const dPulgarIndice = distancia(lm[THUMB_TIP], lm[INDEX_TIP]) / escala;
  if (dPulgarIndice < 0.35) {
    return { letra: 'O', altaConfianza: false };
  }

  const dAIndice = distancia(lm[THUMB_TIP], lm[INDEX_MCP]) / escala;
  const dAMedio = distancia(lm[THUMB_TIP], lm[MIDDLE_MCP]) / escala;
  const dAAnular = distancia(lm[THUMB_TIP], lm[RING_MCP]) / escala;

  const candidatos = { T: dAIndice, N: dAMedio, M: dAAnular };
  let letra = Object.keys(candidatos).reduce((a, b) => (candidatos[a] < candidatos[b] ? a : b));

  if (Math.min(dAIndice, dAMedio, dAAnular) > 0.30) {
    letra = 'S';
  }

  return { letra, altaConfianza: false };
}

/**
 * Devuelve { letra, altaConfianza } según la forma actual de la mano,
 * o { letra: null, altaConfianza: false } si no reconoce ninguna letra.
 * `lm` es un arreglo de 21 puntos {x, y} normalizados (0..1).
 */
export function clasificarLetra(lm) {
  const escala = escalaMano(lm);

  const pulgar = pulgarExtendido(lm);
  const indice = dedoExtendido(lm, INDEX_TIP, INDEX_PIP);
  const medio = dedoExtendido(lm, MIDDLE_TIP, MIDDLE_PIP);
  const anular = dedoExtendido(lm, RING_TIP, RING_PIP);
  const menique = dedoExtendido(lm, PINKY_TIP, PINKY_PIP);

  const patron = [pulgar, indice, medio, anular, menique].join(',');

  const tabla = {
    'false,true,false,false,false': 'D',
    'false,true,true,true,false': 'W',
    'true,false,false,false,true': 'Y',
    'true,true,false,false,false': 'L',
    'false,false,false,false,true': 'I',
    'true,true,true,false,false': 'K',
    'false,false,true,true,true': 'F',
    'true,false,false,false,false': 'A',
  };
  if (tabla[patron]) {
    return { letra: tabla[patron], altaConfianza: true };
  }

  // B: 4 dedos juntos y extendidos, pulgar cruzado por delante
  if (!pulgar && indice && medio && anular && menique) {
    return { letra: 'B', altaConfianza: true };
  }

  // U / V / R: índice + medio extendidos, se diferencian por separación/cruce
  if (!pulgar && indice && medio && !anular && !menique) {
    const sep = distancia(lm[INDEX_TIP], lm[MIDDLE_TIP]) / escala;
    const ordenBase = lm[INDEX_MCP].x - lm[MIDDLE_MCP].x;
    const ordenPuntas = lm[INDEX_TIP].x - lm[MIDDLE_TIP].x;
    const cruzados = (ordenBase > 0) !== (ordenPuntas > 0);
    if (cruzados) {
      return { letra: 'R', altaConfianza: false };
    }
    return sep > 0.30
      ? { letra: 'V', altaConfianza: true }
      : { letra: 'U', altaConfianza: true };
  }

  // X: índice "ganchado", resto de dedos cerrados, pulgar sin extender
  if (!pulgar && !medio && !anular && !menique) {
    const rel = distancia(lm[INDEX_TIP], lm[WRIST]) / escala;
    const relPip = distancia(lm[INDEX_PIP], lm[WRIST]) / escala;
    if (!indice && rel > relPip * 0.75) {
      return { letra: 'X', altaConfianza: false };
    }
    // Puño cerrado -> A/O/S/E/M/N/T
    return clasificarPunoCerrado(lm, escala);
  }

  return { letra: null, altaConfianza: false };
}
