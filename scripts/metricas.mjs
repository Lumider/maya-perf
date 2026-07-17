/**
 * Utilidades compartidas por los dos runners (entrada anónima y flujo con sesión):
 * extracción de métricas de un LHR y persistencia en el historial commiteado.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_CORRIDAS_HISTORIAL } from '../public/datos/objetivos.mjs';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
export const HISTORIAL = `${RAIZ}/public/datos/perf-historial.json`;
export const REPORTES = `${RAIZ}/reportes`;

/** Extrae del LHR las métricas que sigue el dashboard. Además de las Web Vitals,
 *  incluye las dos palancas P0 de la auditoría: JS sin usar y tiempo en redirecciones. */
export function extraerMetricas(lhr) {
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

/** Guarda diagnóstico de un recorrido fallido: el reporte HTML (si Lighthouse alcanzó a
 *  producirlo) y el último screenshot — sin esto, un NO_FCP no deja evidencia de qué
 *  pinta la página. Solo viajan como artifact del workflow (reportes/ está gitignored). */
export function guardarDiagnosticoFallo(codigo, lhr, html) {
  mkdirSync(REPORTES, { recursive: true });
  if (html) writeFileSync(`${REPORTES}/${codigo}-fallo.html`, html);
  const captura = lhr?.audits?.['final-screenshot']?.details?.data;
  if (captura?.startsWith('data:image/')) {
    writeFileSync(
      `${REPORTES}/${codigo}-fallo.png`,
      Buffer.from(captura.split(',')[1], 'base64'),
    );
  }
}

/**
 * Añade mediciones al historial. Si la última corrida es reciente (mismo run del
 * workflow: los dos scripts corren seguidos), las FUSIONA en esa entrada en vez de crear
 * otra — así cada día queda una sola corrida con recorridos anónimos + de sesión, y las
 * series del dashboard no se llenan de huecos alternados.
 */
export function guardarEnHistorial(recorridos, version) {
  let historial = { version: 1, corridas: [] };
  try {
    historial = JSON.parse(readFileSync(HISTORIAL, 'utf8'));
  } catch {
    // Primer uso: se crea el archivo desde cero.
  }
  const ultima = historial.corridas.at(-1);
  const DOS_HORAS = 2 * 60 * 60 * 1000;
  if (ultima && Date.now() - Date.parse(ultima.fecha) < DOS_HORAS) {
    Object.assign(ultima.recorridos, recorridos);
    if (version) ultima.lighthouse = version;
  } else {
    historial.corridas.push({
      fecha: new Date().toISOString(),
      lighthouse: version || 'desconocida',
      recorridos,
    });
  }
  historial.corridas = historial.corridas.slice(-MAX_CORRIDAS_HISTORIAL);
  mkdirSync(dirname(HISTORIAL), { recursive: true });
  writeFileSync(HISTORIAL, JSON.stringify(historial, null, 2) + '\n');
}
