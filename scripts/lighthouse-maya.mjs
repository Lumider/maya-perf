/**
 * Runner de Lighthouse contra la ENTRADA anónima de Maya (sin sesión).
 *
 * Corre N veces cada recorrido de `objetivos.mjs` (grupo RECORRIDOS), toma la corrida
 * MEDIANA (utilidad oficial de Lighthouse, más robusta que promediar métricas sueltas) y
 * añade una entrada al historial `public/datos/perf-historial.json`, que el dashboard
 * (public/index.html) consume como asset estático. Los reportes HTML de la corrida mediana
 * quedan en `reportes/` (gitignored — el workflow los sube como artifact).
 *
 * El recorrido REAL con sesión (login → #/inicio → clics) vive en `flujo-sesion.mjs`.
 *
 * Uso:
 *   npm run perf                                  # los 3 recorridos, 3 corridas c/u
 *   npm run perf -- --recorrido portal            # un solo recorrido
 *   npm run perf -- --recorrido portal --corridas 1 --url https://ejemplo.invalido
 *                                                 # prueba rápida / camino de error
 *
 * Un recorrido que falla (WAF, timeout, challenge al runner) se registra como
 * `{ ok: false, error }` sin abortar los demás — y deja reporte+screenshot de diagnóstico
 * en `reportes/<codigo>-fallo.*`. El proceso solo sale con código ≠ 0 si fallan TODOS.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { computeMedianRun } from 'lighthouse/core/lib/median-run.js';
import { CORRIDAS_POR_RECORRIDO, RECORRIDOS } from '../public/datos/objetivos.mjs';
import {
  HISTORIAL,
  REPORTES,
  extraerMetricas,
  guardarDiagnosticoFallo,
  guardarEnHistorial,
} from './metricas.mjs';

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
        guardarDiagnosticoFallo(recorrido.codigo, lhr, resultado?.report?.[0]);
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

  guardarEnHistorial(mediciones, version);
  console.log(`Historial actualizado: ${HISTORIAL}`);

  if (Object.values(mediciones).every((r) => r.ok === false)) {
    console.error('Ningún recorrido pudo medirse — revisar bloqueos o conectividad.');
    process.exit(1);
  }
} finally {
  await chrome.kill();
}
