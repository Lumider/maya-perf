# maya-perf

Seguimiento continuo de la **Auditoría de Performance Móvil de Maya (Yanbal, jun 2026)**:
un workflow corre Lighthouse a diario contra producción, acumula el historial en el repo y
publica un dashboard estático en GitHub Pages que responde una sola pregunta:
**¿mejoramos desde la auditoría?**

**Dashboard:** https://lumider.github.io/maya-perf/

## Qué mide

Los 3 recorridos de la auditoría, con su **misma metodología** (perfil estándar de
Lighthouse móvil: CPU 4× + 4G lenta simulada — sin throttling custom, para que cada
corrida sea comparable con la línea base):

| Recorrido | URL | Línea base jun-2026 |
| --- | --- | --- |
| Ingresar a Maya | maya.yanbal.com | 37/100 · LCP 17.9 s |
| Pase de Pedido | pedidos.yanbal.com | 50/100 · LCP 15.8 s |
| Mis Reportes | misreportes.yanbal.com | 52/100 (solo el spinner) |

Metas de la auditoría: **LCP < 2.5 s** y **score > 50**. Cada punto del historial es la
**mediana de 3 corridas**. Además de las Web Vitals se registran las dos palancas P0:
**JS sin usar** y **tiempo en cadenas de redirección** de login.

La misma URL sirve a México, Perú, Bolivia y Guatemala (el país se elige dentro de la
app), así que toda mejora medida aquí aplica a los 4 mercados.

### Limitaciones (honestidad metodológica)

- Se mide **sin sesión** (Azure AD B2C): cada recorrido captura su entrada real —
  redirecciones de login incluidas — pero no el interior post-login.
- En **Mis Reportes**, Lighthouse solo ve el spinner; el reporte SSRS real no cargó en
  >90 s en la auditoría. La meta «reporte < 5 s» requiere medición de campo.
- TBT es la métrica más ruidosa en CI: leer tendencias, no puntos sueltos.

## Estructura

```
scripts/lighthouse-maya.mjs     # runner: N corridas × recorrido, mediana, historial
public/datos/objetivos.mjs      # config compartida runner+dashboard: recorridos, metas, línea base
public/datos/perf-historial.json# historial commiteado por el workflow (tope 400 corridas)
public/index.html               # dashboard estático (GitHub Pages)
.github/workflows/perf.yml      # cron diario 15:15 UTC + manual + deploy a Pages
```

## Uso local

```bash
npm ci
npm run perf                                   # los 3 recorridos, 3 corridas c/u
npm run perf -- --recorrido portal --corridas 1  # prueba rápida
npx http-server public   # (o python3 -m http.server -d public) para ver el dashboard
```

Los reportes HTML completos de Lighthouse quedan en `reportes/` (local) y como artifact
del workflow (30 días).

## Operación

- **Cron diario 15:15 UTC** (≈ media mañana en los 4 mercados) + `workflow_dispatch` manual.
- El workflow commitea `public/datos/perf-historial.json` a `main` y despliega Pages en el
  mismo run (los pushes con `GITHUB_TOKEN` no disparan otros workflows).
- Si un recorrido falla (WAF, timeout), queda registrado como `ok: false` con su código de
  error y visible en el dashboard; el workflow solo falla si **ningún** recorrido midió.
- Para cambiar recorridos, metas o número de corridas: `public/datos/objetivos.mjs`.
