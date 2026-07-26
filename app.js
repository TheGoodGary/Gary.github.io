import { clasificarLetra } from "./asl_classifier.js";

const MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Conexiones estándar entre los 21 puntos de la mano, para dibujar el esqueleto
const CONEXIONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const FRAMES_ESTABLES = 15; // cuadros seguidos que una letra debe sostenerse para confirmarse
const UMBRAL_ESTABLE = 0.8; // 80% de esos cuadros deben coincidir

const elPermiso = document.getElementById("pantalla-permiso");
const elApp = document.getElementById("app");
const elVideo = document.getElementById("video");
const elOverlay = document.getElementById("overlay");
const elLetra = document.getElementById("etiqueta-letra");
const elBarra = document.getElementById("barra-progreso-relleno");
const elPalabra = document.getElementById("palabra");
const elBtnIniciar = document.getElementById("btn-iniciar");
const elTextoError = document.getElementById("texto-error");
const ctx = elOverlay.getContext("2d");

let palabra = "";
let ultimaConfirmada = null;
const historial = [];

function actualizarPalabra() {
  elPalabra.textContent = palabra.length ? palabra : "\u00a0";
}

document.getElementById("btn-espacio").addEventListener("click", () => {
  palabra += " ";
  actualizarPalabra();
});
document.getElementById("btn-borrar").addEventListener("click", () => {
  palabra = palabra.slice(0, -1);
  actualizarPalabra();
});
document.getElementById("btn-limpiar").addEventListener("click", () => {
  palabra = "";
  actualizarPalabra();
});

elBtnIniciar.addEventListener("click", iniciar);

function mostrarError(mensaje) {
  elTextoError.textContent = mensaje;
  elTextoError.classList.remove("oculto");
  elBtnIniciar.disabled = false;
  elBtnIniciar.textContent = "Reintentar";
}

function volverAPermisoConError(mensaje) {
  if (elVideo.srcObject) {
    elVideo.srcObject.getTracks().forEach((t) => t.stop());
    elVideo.srcObject = null;
  }
  elApp.classList.add("oculto");
  elPermiso.classList.remove("oculto");
  mostrarError(mensaje);
}

async function iniciar() {
  elBtnIniciar.disabled = true;
  elTextoError.classList.add("oculto");

  // 1) Cámara: esto NO depende de internet, solo del hardware del dispositivo.
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (err) {
    mostrarError("No se pudo acceder a la cámara: " + err.message);
    return;
  }

  elVideo.srcObject = stream;
  await elVideo.play();

  elPermiso.classList.add("oculto");
  elApp.classList.remove("oculto");

  // 2) Motor de MediaPipe: esto SÍ se descarga desde internet la primera vez.
  //    Se carga de forma dinámica (no al abrir la página) para que el resto
  //    de la app funcione aunque este paso falle por falta de conexión.
  let HandLandmarker, FilesetResolver;
  try {
    ({ HandLandmarker, FilesetResolver } = await import(MEDIAPIPE_CDN));
  } catch (err) {
    volverAPermisoConError(
      "No se pudo cargar el motor de reconocimiento de manos. Revisa tu " +
      "conexión a internet e intenta de nuevo."
    );
    return;
  }

  let handLandmarker;
  try {
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN + "/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
  } catch (err) {
    volverAPermisoConError("No se pudo iniciar el modelo de detección de manos: " + err.message);
    return;
  }

  let ultimoTiempo = -1;
  function loop() {
    if (elApp.classList.contains("oculto")) return; // se detuvo por un error
    if (elVideo.readyState >= 2 && elVideo.currentTime !== ultimoTiempo) {
      ultimoTiempo = elVideo.currentTime;
      ajustarTamano();
      const resultado = handLandmarker.detectForVideo(elVideo, performance.now());
      procesarResultado(resultado);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function ajustarTamano() {
  if (elOverlay.width !== elVideo.videoWidth || elOverlay.height !== elVideo.videoHeight) {
    elOverlay.width = elVideo.videoWidth;
    elOverlay.height = elVideo.videoHeight;
  }
}

function procesarResultado(resultado) {
  ctx.clearRect(0, 0, elOverlay.width, elOverlay.height);

  let letraActual = null;
  let altaConfianza = false;

  if (resultado.landmarks && resultado.landmarks.length > 0) {
    const lm = resultado.landmarks[0];
    dibujarMano(lm);
    const r = clasificarLetra(lm);
    letraActual = r.letra;
    altaConfianza = r.altaConfianza;
  }

  // --- Estabilización: se confirma una letra solo si se sostiene un rato ---
  historial.push(letraActual);
  if (historial.length > FRAMES_ESTABLES) historial.shift();

  let estabilidad = 0;
  if (historial.length === FRAMES_ESTABLES) {
    const conteo = {};
    historial.forEach((l) => {
      const clave = l === null ? "null" : l;
      conteo[clave] = (conteo[clave] || 0) + 1;
    });
    let top = null;
    let frecuencia = 0;
    for (const [clave, cnt] of Object.entries(conteo)) {
      if (cnt > frecuencia) {
        frecuencia = cnt;
        top = clave === "null" ? null : clave;
      }
    }
    estabilidad = frecuencia;
    const estable = frecuencia >= FRAMES_ESTABLES * UMBRAL_ESTABLE;
    if (estable && top !== null) {
      if (top !== ultimaConfirmada) {
        palabra += top;
        ultimaConfirmada = top;
        actualizarPalabra();
      }
    } else if (top === null) {
      ultimaConfirmada = null;
    }
  }

  actualizarUI(letraActual, altaConfianza, estabilidad);
}

function actualizarUI(letra, altaConfianza, estabilidad) {
  elLetra.textContent = letra ? letra + (altaConfianza ? "" : " (aprox.)") : "-";
  elLetra.style.color = !letra ? "#999" : altaConfianza ? "#2ecc71" : "#f39c12";
  const progreso = Math.min(estabilidad / FRAMES_ESTABLES, 1) * 100;
  elBarra.style.width = progreso + "%";
  elBarra.style.background = !letra ? "#999" : altaConfianza ? "#2ecc71" : "#f39c12";
}

function dibujarMano(lm) {
  const w = elOverlay.width;
  const h = elOverlay.height;

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#2ecc71";
  CONEXIONES.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  });

  ctx.fillStyle = "#fff";
  lm.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}
