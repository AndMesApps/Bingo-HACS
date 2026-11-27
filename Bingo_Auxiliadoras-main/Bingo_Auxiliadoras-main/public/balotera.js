// Sonidos del Bingo y voz que canta las balotas. Los sonidos se fabrican en el navegador (Web Audio):
// no hay archivos de audio que descargar ni derechos de autor.
const Balotera = (() => {
  const CLAVE = 'sorteo-sonido-2';
  // Cuánto se amplifican los efectos con el control de volumen al máximo (el compresor evita que se distorsione).
  const AMPLIFICACION = 4;
  const opciones = { efectos: true, voz: true, golpe: 'ambos', volumen: 1 };
  try { Object.assign(opciones, JSON.parse(localStorage.getItem(CLAVE) || '{}')); } catch { /* valores por defecto */ }

  let ctx = null;
  let salida = null;
  let ruidoBase = null;

  // El navegador solo deja sonar después de un toque: se llama desde los botones.
  function activar() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!ctx) {
      ctx = new Audio();
      const limitador = ctx.createDynamicsCompressor();
      limitador.threshold.value = -12;
      limitador.knee.value = 6;
      limitador.ratio.value = 20;
      limitador.attack.value = 0.002;
      limitador.release.value = 0.15;
      // recorte suave al final: sube la sensación de volumen sin chasquidos
      const tope = ctx.createWaveShaper();
      tope.curve = Float32Array.from({ length: 1025 }, (_, i) => Math.tanh(2 * (i / 512 - 1)) / Math.tanh(2));
      limitador.connect(tope).connect(ctx.destination);
      salida = ctx.createGain();
      salida.connect(limitador);
      ruidoBase = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const datos = ruidoBase.getChannelData(0);
      for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1;
    }
    salida.gain.value = opciones.volumen * AMPLIFICACION;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function ajustar(clave, valor) {
    opciones[clave] = valor;
    if (salida) salida.gain.value = opciones.volumen * AMPLIFICACION;
    if (clave === 'voz' && !valor) window.speechSynthesis?.cancel();
    try { localStorage.setItem(CLAVE, JSON.stringify(opciones)); } catch { /* sin almacenamiento */ }
  }

  // Envolvente: sube casi al instante hasta "pico" y se apaga en "dura" segundos.
  function envolvente(t, pico, dura, destino) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pico, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dura);
    g.connect(destino);
    return g;
  }

  function ruido(t, dura, tipo, frecuencia, q, pico, destino) {
    const fuente = ctx.createBufferSource();
    fuente.buffer = ruidoBase;
    const filtro = ctx.createBiquadFilter();
    filtro.type = tipo;
    filtro.frequency.value = frecuencia;
    filtro.Q.value = q;
    fuente.connect(filtro).connect(envolvente(t, pico, dura, destino));
    fuente.start(t, Math.random() * Math.max(0, 3 - dura), dura + 0.05);
  }

  function tono(t, dura, forma, desde, hasta, pico, destino) {
    const o = ctx.createOscillator();
    o.type = forma;
    o.frequency.setValueAtTime(desde, t);
    o.frequency.exponentialRampToValueAtTime(hasta, t + dura);
    o.connect(envolvente(t, pico, dura, destino));
    o.start(t);
    o.stop(t + dura + 0.05);
  }

  // Balotera rodando: golpecitos de las bolas entre sí y contra la jaula, sobre el retumbo del giro.
  // Devuelve la función que la detiene.
  function rodar() {
    if (!ctx || !opciones.efectos) return () => {};
    const canal = ctx.createGain();
    canal.connect(salida);

    const giro = ctx.createBufferSource();
    giro.buffer = ruidoBase;
    giro.loop = true;
    const grave = ctx.createBiquadFilter();
    grave.type = 'lowpass';
    grave.frequency.value = 320;
    const nivel = ctx.createGain();
    nivel.gain.value = 0.35;
    // el vaivén de la manivela
    const vaiven = ctx.createOscillator();
    vaiven.frequency.value = 3.2;
    const fondo = ctx.createGain();
    fondo.gain.value = 0.18;
    vaiven.connect(fondo).connect(nivel.gain);
    giro.connect(grave).connect(nivel).connect(canal);
    giro.start();
    vaiven.start();

    let siguiente = ctx.currentTime;
    const programar = () => {
      while (siguiente < ctx.currentTime + 0.15) {
        ruido(siguiente, 0.025 + Math.random() * 0.035, 'bandpass', 900 + Math.random() * 2800, 7, 0.5 + Math.random() * 0.9, canal);
        if (Math.random() < 0.3) tono(siguiente, 0.05, 'triangle', 500 + Math.random() * 700, 300, 0.12, canal);
        siguiente += 0.012 + Math.random() * 0.05;
      }
    };
    programar();
    const reloj = setInterval(programar, 50);

    return () => {
      clearInterval(reloj);
      const t = ctx.currentTime;
      canal.gain.setValueAtTime(1, t);
      canal.gain.linearRampToValueAtTime(0, t + 0.12);
      giro.stop(t + 0.15);
      vaiven.stop(t + 0.15);
      setTimeout(() => canal.disconnect(), 500);
    };
  }

  function bombo(t) {
    tono(t, 0.7, 'sine', 160, 42, 1.4, salida);
    ruido(t, 0.09, 'lowpass', 500, 1, 0.8, salida);
  }

  function platillo(t) {
    ruido(t, 1.8, 'highpass', 5200, 0.7, 0.55, salida);
    ruido(t, 0.7, 'bandpass', 3400, 0.8, 0.5, salida);
    // brillo metálico: tonos sin relación armónica entre sí
    for (const f of [3150, 4270, 5430, 6810]) tono(t, 0.9, 'square', f, f * 0.99, 0.025, salida);
  }

  // El golpe cuando sale la balota.
  function golpe() {
    if (!ctx || !opciones.efectos) return;
    const t = ctx.currentTime + 0.02;
    if (opciones.golpe !== 'platillo') bombo(t);
    if (opciones.golpe !== 'bombo') platillo(t);
  }

  // Número en palabras sueltas, para el "uno, dos" que se acostumbra al cantar.
  const DIGITOS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
  const frase = (letra, n) => {
    const nombre = { B: 'be', I: 'i', N: 'ene', G: 'ge', O: 'o' }[letra];
    return `Con la ${nombre}, el ${n}.${n > 9 ? ` ${String(n).split('').map(d => DIGITOS[d]).join(', ')}.` : ''}`;
  };

  // Voz en español disponible en el aparato; se prefiere la de Colombia o Latinoamérica.
  function elegirVoz() {
    const voces = window.speechSynthesis.getVoices().filter(v => /^es/i.test(v.lang));
    for (const patron of [/es[-_]CO/i, /es[-_](US|MX|419)/i, /es[-_](?!ES)/i, /es/i]) {
      const v = voces.find(x => patron.test(x.lang));
      if (v) return v;
    }
    return null;
  }

  let enCurso = null;

  // Canta la balota. La promesa se cumple al terminar de hablar (o enseguida si no hay voz).
  function cantar(letra, n) {
    const sintesis = window.speechSynthesis;
    if (!opciones.voz || !sintesis) return Promise.resolve();
    callar();
    return new Promise(listo => {
      const texto = new SpeechSynthesisUtterance(frase(letra, n));
      const voz = elegirVoz();
      if (voz) texto.voice = voz;
      texto.lang = voz?.lang || 'es-CO';
      texto.rate = 0.85;
      texto.volume = opciones.volumen;
      let reloj = null;
      const fin = () => { clearTimeout(reloj); clearTimeout(inicio); listo(); };
      texto.onend = fin;
      texto.onerror = fin;
      reloj = setTimeout(fin, 9000); // algunos navegadores no avisan que terminaron
      // deja sonar el golpe antes de hablar
      const inicio = setTimeout(() => sintesis.speak(texto), opciones.efectos ? 750 : 0);
      enCurso = fin;
    });
  }

  function callar() {
    const fin = enCurso;
    enCurso = null;
    fin?.();
    window.speechSynthesis?.cancel();
  }

  window.speechSynthesis?.getVoices(); // la lista de voces se carga en segundo plano

  return { opciones, activar, ajustar, rodar, golpe, cantar, callar };
})();
