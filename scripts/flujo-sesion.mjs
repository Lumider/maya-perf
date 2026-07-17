/**
 * Flujo CON SESIÓN: el recorrido real de la auditoría, automatizado con
 * Lighthouse user flows (API Puppeteer).
 *
 *   1. Login en B2C con la cuenta de prueba (MAYA_USUARIO / MAYA_CLAVE — secrets del
 *      repo; NUNCA en el código). El login NO se mide: es el paso previo.
 *   2. Medición «inicio»: navegación a maya.yanbal.com/#/inicio ya autenticado.
 *   3. Medición «pedido-real»: clic en «Realizar pedido» — captura la derivación
 *      completa al dominio de Pase de Pedido, handoff de tokens incluido.
 *   4. Vuelta al portal y medición «reportes-real»: clic al enlace de Reportes.
 *
 * Se corre el flujo completo CORRIDAS_POR_FLUJO veces y se toma la mediana por
 * recorrido. Si faltan las credenciales, el script sale limpio con código 0
 * («desactivado») para que el workflow siga verde hasta que exista la cuenta.
 *
 * Uso local / prueba:
 *   MAYA_USUARIO=u MAYA_CLAVE=c node scripts/flujo-sesion.mjs
 *   node scripts/flujo-sesion.mjs --config /ruta/objetivos-prueba.mjs   # mini-sitio local
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { launch } from 'chrome-launcher';
import { startFlow } from 'lighthouse';
import { computeMedianRun } from 'lighthouse/core/lib/median-run.js';
import puppeteer from 'puppeteer-core';
import {
  HISTORIAL,
  REPORTES,
  extraerMetricas,
  guardarDiagnosticoFallo,
  guardarEnHistorial,
} from './metricas.mjs';

const { values: args } = parseArgs({
  options: {
    // Módulo de objetivos alternativo (pruebas contra un mini-sitio local).
    config: { type: 'string' },
    corridas: { type: 'string' },
  },
});

const conf = await import(
  args.config ? pathToFileURL(args.config).href : '../public/datos/objetivos.mjs'
);
const { RECORRIDOS_SESION, SESION, CORRIDAS_POR_FLUJO } = conf;

const usuario = process.env.MAYA_USUARIO;
const clave = process.env.MAYA_CLAVE;
if (!usuario || !clave) {
  console.log(
    'Flujo con sesión DESACTIVADO: faltan los secrets MAYA_USUARIO / MAYA_CLAVE. ' +
      'Se activa agregándolos en Settings → Secrets and variables → Actions.',
  );
  process.exit(0);
}

/** Mismo racional que el runner anónimo: defaults móviles = metodología de la auditoría. */
const CONFIG_LH = {
  extends: 'lighthouse:default',
  settings: { onlyCategories: ['performance'], formFactor: 'mobile' },
};

/** Vuelca a stderr (→ log del workflow) y a reportes/ un inventario de la página:
 *  inputs, botones e iframes presentes. Es el diagnóstico clave cuando el login falla
 *  con SELECTOR_NO_ENCONTRADO: dice qué selectores usar en SESION.selectores. */
async function volcarInventario(page, numero) {
  try {
    const inv = await page.evaluate(() => {
      const desc = (el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        name: el.getAttribute('name') || undefined,
        type: el.getAttribute('type') || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        texto: (el.textContent || '').trim().slice(0, 50) || undefined,
      });
      return {
        // Solo origen+ruta: la query de B2C lleva state/nonce que no pintan en un log.
        url: location.origin + location.pathname + location.hash,
        titulo: document.title,
        inputs: [...document.querySelectorAll('input')].map(desc),
        botones: [...document.querySelectorAll('button, [role="button"], input[type="submit"]')].map(desc),
        iframes: [...document.querySelectorAll('iframe')].map((f) => f.src?.split('?')[0] ?? ''),
      };
    });
    const json = JSON.stringify(inv, null, 2);
    process.stderr.write(`  inventario de la página (flujo ${numero}):\n${json}\n`);
    mkdirSync(REPORTES, { recursive: true });
    writeFileSync(`${REPORTES}/login-dom-${numero}.json`, json);
  } catch (e) {
    process.stderr.write(`  (no se pudo volcar el inventario: ${e?.message})\n`);
  }
}

/** Prueba una lista de selectores candidatos y devuelve el primero presente. */
async function buscarSelector(page, candidatos, timeoutMs = 30000) {
  const inicio = Date.now();
  for (;;) {
    for (const sel of candidatos) {
      const el = await page.$(sel).catch(() => null);
      if (el) return sel;
    }
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`SELECTOR_NO_ENCONTRADO: ${candidatos.join(' | ')}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Inicia sesión (sin medir). Da el login por bueno cuando la URL vuelve al portal. */
async function iniciarSesion(page) {
  await page.goto(SESION.urlLogin, { waitUntil: 'networkidle2', timeout: 90000 });
  const selUsuario = await buscarSelector(page, SESION.selectores.usuario);
  await page.type(selUsuario, usuario, { delay: 20 });
  const selClave = await buscarSelector(page, SESION.selectores.clave);
  await page.type(selClave, clave, { delay: 20 });
  const selEnviar = await buscarSelector(page, SESION.selectores.enviar);
  await page.click(selEnviar);
  const dominioPortal = new URL(SESION.urlPortal).host;
  await page.waitForFunction(
    (host) => location.host === host,
    { timeout: SESION.esperaPostLoginMs, polling: 1000 },
    dominioPortal,
  );
}

/** Una pasada completa del flujo; devuelve { codigo: {lhr}|{error} } por recorrido. */
async function correrFlujo(browser, numero) {
  const page = await browser.newPage();
  const resultados = {};
  try {
    process.stderr.write(`  flujo ${numero}: iniciando sesión…\n`);
    await iniciarSesion(page);

    const flow = await startFlow(page, { config: CONFIG_LH, name: `Maya con sesión #${numero}` });

    for (const rec of RECORRIDOS_SESION) {
      try {
        process.stderr.write(`  flujo ${numero}: midiendo ${rec.codigo}…\n`);
        if (rec.url) {
          // Navegación directa (el portal): recarga fría PERO con la sesión ya iniciada.
          await flow.navigate(rec.url, { name: rec.nombre });
        } else {
          // Navegación derivada de un clic (pedido, reportes) — el recorrido real.
          const sel = await buscarSelector(page, rec.selectorClic);
          await flow.navigate(async () => page.click(sel), { name: rec.nombre });
          // Volver al portal para el siguiente clic (fuera de medición).
          await page.goto(SESION.urlPortal, { waitUntil: 'networkidle2', timeout: 90000 });
        }
        const paso = (await flow.createFlowResult()).steps.at(-1);
        const lhr = paso.lhr;
        if (lhr.runtimeError || lhr.categories.performance.score == null) {
          resultados[rec.codigo] = { error: lhr.runtimeError?.code ?? 'SIN_SCORE', lhr };
        } else {
          resultados[rec.codigo] = { lhr };
        }
      } catch (e) {
        resultados[rec.codigo] = { error: e?.message?.slice(0, 120) ?? 'ERROR_DESCONOCIDO' };
      }
    }

    // Reporte HTML del flujo completo (todas las mediciones), para el artifact.
    mkdirSync(REPORTES, { recursive: true });
    writeFileSync(`${REPORTES}/flujo-sesion-${numero}.html`, await flow.generateReport());
  } catch (e) {
    const error = `LOGIN_FALLO: ${e?.message?.slice(0, 120)}`;
    for (const rec of RECORRIDOS_SESION) resultados[rec.codigo] ??= { error };
    // Diagnóstico: inventario de la página (al log del workflow) + screenshot (al artifact).
    await volcarInventario(page, numero);
    mkdirSync(REPORTES, { recursive: true });
    await page
      .screenshot({ path: `${REPORTES}/login-fallo-${numero}.png`, fullPage: true })
      .catch(() => {});
  } finally {
    await page.close().catch(() => {});
  }
  return resultados;
}

const corridas = Number(args.corridas ?? CORRIDAS_POR_FLUJO);
const chrome = await launch({
  chromeFlags: [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    ...(process.env.PERF_CHROME_FLAGS?.split(' ').filter(Boolean) ?? []),
  ],
});
const browser = await puppeteer.connect({
  browserURL: `http://127.0.0.1:${chrome.port}`,
  defaultViewport: null,
});

try {
  const pasadas = [];
  for (let i = 1; i <= corridas; i++) pasadas.push(await correrFlujo(browser, i));

  // Mediana por recorrido entre las pasadas exitosas; si ninguna midió, ok:false.
  const mediciones = {};
  let version = '';
  for (const rec of RECORRIDOS_SESION) {
    const exitosas = pasadas.map((p) => p[rec.codigo]).filter((r) => r?.lhr && !r.error);
    if (exitosas.length === 0) {
      const fallo = pasadas.map((p) => p[rec.codigo]).find((r) => r?.error);
      guardarDiagnosticoFallo(rec.codigo, fallo?.lhr, undefined);
      mediciones[rec.codigo] = { ok: false, error: fallo?.error ?? 'SIN_CORRIDAS' };
      process.stderr.write(`  ${rec.codigo}: FALLÓ (${mediciones[rec.codigo].error})\n`);
      continue;
    }
    const lhrs = exitosas.map((r) => r.lhr);
    const mediana = lhrs.length === 1 ? lhrs[0] : computeMedianRun(lhrs);
    mediciones[rec.codigo] = extraerMetricas(mediana);
    version = mediana.lighthouseVersion;
    process.stderr.write(
      `  ${rec.codigo}: score ${mediciones[rec.codigo].score}, LCP ${mediciones[rec.codigo].lcpMs} ms\n`,
    );
  }

  guardarEnHistorial(mediciones, version);
  console.log(`Historial actualizado (flujo con sesión): ${HISTORIAL}`);

  if (Object.values(mediciones).every((r) => r.ok === false)) {
    console.error('El flujo con sesión no pudo medir nada — revisar login/selectores.');
    process.exit(1);
  }
} finally {
  await browser.disconnect().catch(() => {});
  await chrome.kill();
}
