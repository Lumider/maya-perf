/**
 * Runner de Lighthouse contra Maya en producción (seguimiento de la auditoría jun-2026).
 *
 * Corre N veces cada recorrido de `objetivos.mjs`, toma la corrida MEDIANA (utilidad
 * oficial de Lighthouse, más robusta que promediar métricas sueltas) y añade una entrada
 * al historial `public/datos/perf-historial.json`, que el dashboard (public/index.html)
 * consume como asset estático. Los reportes HTML de la corrida mediana quedan en
 * `reportes/` (gitignored — el workflow los sube como artifact para diagnóstico profundo).
 *
 * Uso:
 *   npm run perf                                  # los 3 recorridos, 3 corridas c/u
 *   npm run perf -- --recorrido portal            # un solo recorrido
 *   npm run perf -- --recorrido portal --corridas 1 --url https://ejemplo.invalido
 *                                                 # prueba rápida / camino de error
 *
 * Un recorrido que falla (WAF, timeout, challenge al runner) se registra como
 * `{ ok: false, error }` sin abortar los demás; el proceso solo sale con código ≠ 0
 * si fallan TODOS (así el workflow queda en rojo cuando no se midió nada).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { computeMedianRun } from 'lighthouse/core/lib/median-run.js';
// La config vive en public/datos/ porque el dashboard (index.html) importa el MISMO
// módulo: una única fuente de verdad para recorridos, metas y línea base.
import {
  CORRIDAS_POR_RECORRIDO,
  MAX_CORRIDAS_HISTORIAL,
  RECORRIDOS,
} from '../public/datos/objetivos.mjs';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const HISTORIAL = `${RAIZ}/public/datos/perf-historial.json`;
const REPORTES = `${RAIZ}/reportes`;

const { values: args } = parseArgs({
  options: {
    // Limita a un recorrido por código (pruebas locales).
    recorrido: { type: 'string' },
    // Sobrescribe el número de corridas por recorrido.
    corridas: { type: 'string' },
    // Sobrescribe la URL (solo junto con --recorrido; para probar el camino de error).
    url: { type: 'string' },
  },
});

/**
 * Configuración de Lighthouse: SOLO `formFactor: 'mobile'` y la categoría performance.
 * Deliberadamente NO se fija throttling ni screenEmulation: los defaults móviles
 * (CPU 4×, 4G lenta simulada con lantern, viewport clase Moto G) son la metodología
 * exacta de la auditoría — tocarlos rompería la comparabilidad con la línea base.
 */
const CONFIG_LH = {
  extends: 'lighthouse:default',
  settings: { onlyCategories: ['performance'], formFactor: 'mobile' },
};

/** Extrae del LHR mediano las métricas que sigue el dashboard. Además de las Web Vitals,
 *  incluye las dos palancas P0 de la auditoría: JS sin usar y tiempo en redirecciones. */
function extraerMetricas(lhr) {
  const audit = (id) => lhr.audits[id]?.numericValue;
  const ms = (id) => Math.round(audit(id) ?? 0);
  return {
    ok: true,
    score: Math.round((lhr.categories.performance.score ?? 0) * 100),
    fcpMs: ms('first-contentful-paint'),
    lcpMs: ms('largest-contentful-paint'),
    tbtMs: ms('total-blocking-time'),
    cls: Math.round((audit('cumulative-layout-shift') ?? 0) * 1000) / 1000,
    speedIndexMs: ms('speed-index'),
    ttfbMs: ms('server-response-time'),
    pesoKb: Math.round((audit('total-byte-weight') ?? 0) / 1024),
    jsSinUsarKb: Math.round(
      (lhr.audits['unused-javascript']?.details?.overallSavingsBytes ?? 0) / 1024,
    ),
    redireccionesMs: Math.round(lhr.audits['redirects']?.details?.overallSavingsMs ?? 0),
  };
}

/** Corre Lighthouse `corridas` veces contra `url` y devuelve la medición del recorrido. */
async function medirRecorrido(chrome, recorrido, url, corridas) {
  const exitosas = [];
  let ultimoError = 'SIN_CORRIDAS';
  for (let i = 1; i <= corridas; i++) {
    process.stderr.write(`  ${recorrido.codigo}: corrida ${i}/${corridas}…\n`);
    try {
      const resultado = await lighthouse(
        url,
        { port: chrome.port, output: ['html'], logLevel: 'error' },
        CONFIG_LH,
      );
      const lhr = resultado?.lhr;
      if (!lhr || lhr.runtimeError || lhr.categories.performance.score == null) {
        ultimoError = lhr?.runtimeError?.code ?? 'SIN_SCORE';
        continue;
      }
      exitosas.push({ lhr, html: resultado.report[0] });
    } catch (e) {
      // Un fallo puntual (Chrome se colgó, la página nunca respondió) no aborta el resto.
      ultimoError = e?.code ?? e?.message?.slice(0, 120) ?? 'ERROR_DESCONOCIDO';
    }
  }
  if (exitosas.length === 0) return { ok: false, error: ultimoError };

  const mediana =
    exitosas.length === 1
      ? exitosas[0]
      : exitosas.find((c) => c.lhr === computeMedianRun(exitosas.map((c) => c.lhr)));
  mkdirSync(REPORTES, { recursive: true });
  writeFileSync(`${REPORTES}/${recorrido.codigo}.html`, mediana.html);
  return { metricas: extraerMetricas(mediana.lhr), version: mediana.lhr.lighthouseVersion };
}

/** Añade la corrida al historial commiteado, recortando al tope configurado. */
function guardarEnHistorial(entrada) {
  let historial = { version: 1, corridas: [] };
  try {
    historial = JSON.parse(readFileSync(HISTORIAL, 'utf8'));
  } catch {
    // Primer uso: se crea el archivo desde cero.
  }
  historial.corridas.push(entrada);
  historial.corridas = historial.corridas.slice(-MAX_CORRIDAS_HISTORIAL);
  mkdirSync(dirname(HISTORIAL), { recursive: true });
  writeFileSync(HISTORIAL, JSON.stringify(historial, null, 2) + '\n');
}

const recorridos = args.recorrido
  ? RECORRIDOS.filter((r) => r.codigo === args.recorrido)
  : RECORRIDOS;
if (recorridos.length === 0) {
  console.error(`Recorrido desconocido: ${args.recorrido}`);
  process.exit(2);
}
const corridas = Number(args.corridas ?? CORRIDAS_POR_RECORRIDO);

// --no-sandbox y --disable-dev-shm-usage evitan fallos de Chrome en contenedores de CI;
// PERF_CHROME_FLAGS permite flags extra en entornos especiales (p. ej. un proxy local).
const chrome = await launch({
  chromeFlags: [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    ...(process.env.PERF_CHROME_FLAGS?.split(' ').filter(Boolean) ?? []),
  ],
});

try {
  const mediciones = {};
  let version = '';
  for (const recorrido of recorridos) {
    const url = args.recorrido && args.url ? args.url : recorrido.url;
    const medicion = await medirRecorrido(chrome, recorrido, url, corridas);
    if (medicion.ok === false) {
      mediciones[recorrido.codigo] = medicion;
      process.stderr.write(`  ${recorrido.codigo}: FALLÓ (${medicion.error})\n`);
    } else {
      mediciones[recorrido.codigo] = medicion.metricas;
      version = medicion.version;
      process.stderr.write(
        `  ${recorrido.codigo}: score ${medicion.metricas.score}, LCP ${medicion.metricas.lcpMs} ms\n`,
      );
    }
  }

  guardarEnHistorial({
    fecha: new Date().toISOString(),
    lighthouse: version || 'desconocida',
    recorridos: mediciones,
  });
  console.log(`Historial actualizado: ${HISTORIAL}`);

  if (Object.values(mediciones).every((r) => r.ok === false)) {
    console.error('Ningún recorrido pudo medirse — revisar bloqueos o conectividad.');
    process.exit(1);
  }
} finally {
  await chrome.kill();
}
