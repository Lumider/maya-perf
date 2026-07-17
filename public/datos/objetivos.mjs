/**
 * Objetivos del seguimiento de performance de Maya en producción.
 *
 * Da continuidad a la "Auditoría de Performance Móvil · Maya Yanbal Perú · jun 2026":
 * mismos recorridos y misma metodología (perfil ESTÁNDAR de Lighthouse móvil, es decir
 * CPU 4× + 4G lenta simulada — anexo metodológico de la auditoría). No se define
 * throttling custom a propósito: usar los defaults es lo que garantiza que cada corrida
 * sea comparable con la línea base 37/50/52 de la auditoría y con las metas fijadas.
 *
 * Hay DOS grupos de recorridos:
 *
 * 1. RECORRIDOS_SESION — el recorrido REAL de la auditoría, con sesión iniciada:
 *    login → Portal Maya (#/inicio) → clic «Realizar pedido» → clic a Reportes.
 *    Las líneas base 37/50/52 pertenecen a ESTE grupo (así midió la auditoría).
 *    Requiere una cuenta de prueba: se activa cuando existen los secrets
 *    MAYA_USUARIO / MAYA_CLAVE en el repo; mientras tanto queda apagado.
 *
 * 2. RECORRIDOS — la ENTRADA anónima a cada plataforma (rebote al login de B2C):
 *    mide TTFB, bundle de la pantalla de login y cadenas de redirección frías.
 *    Sin línea base: la auditoría no midió la entrada sin sesión.
 *
 * La misma URL sirve a los 4 mercados (México, Perú, Bolivia y Guatemala — el país se
 * elige dentro de la app), así que toda mejora medida aquí aplica a los 4 países.
 */

/** Corridas de Lighthouse por recorrido anónimo; se reporta la mediana. */
export const CORRIDAS_POR_RECORRIDO = 3;

/** Corridas del flujo CON sesión (cada una recorre login→inicio→pedido→reportes;
 *  es más caro que una navegación suelta, por eso 2 y no 3). */
export const CORRIDAS_POR_FLUJO = 2;

/** Tope del historial commiteado (~2-4 KB por corrida → el JSON queda acotado en <2 MB). */
export const MAX_CORRIDAS_HISTORIAL = 400;

/** Metas fijadas por la auditoría (diapositiva de cierre): contenido <2.5 s, puntaje >50. */
export const METAS = { score: 50, lcpMs: 2500 };

/** Recorrido real de la auditoría (con sesión). `selectorClic` admite varios candidatos:
 *  el flujo prueba en orden hasta encontrar uno (los `::-p-text()` son de Puppeteer). */
export const RECORRIDOS_SESION = [
  {
    codigo: 'inicio',
    nombre: 'Portal Maya (#/inicio)',
    corto: 'Portal',
    url: 'https://maya.yanbal.com/#/inicio',
    // Portal: 37/100, LCP 17.9 s, TBT 720 ms, 2.1 MB de JS sin usar.
    base: { score: 37, lcpMs: 17900 },
  },
  // Decisión (jul-2026): por ahora SOLO se mide #/inicio. Para reactivar las derivaciones
  // por clic (Pase de Pedido en pedidos.yanbal.com y Mis Reportes), descomentar:
  // {
  //   codigo: 'pedido-real',
  //   nombre: 'Realizar pedido (desde el portal)',
  //   corto: 'Pedido',
  //   selectorClic: ['a[href*="pedidos.yanbal"]', '::-p-text(Realizar pedido)'],
  //   base: { score: 50, lcpMs: 15800 },
  // },
  // {
  //   codigo: 'reportes-real',
  //   nombre: 'Mis Reportes (desde el portal)',
  //   corto: 'Reportes',
  //   selectorClic: ['a[href*="misreportes.yanbal"]', '::-p-text(Mis Reportes)'],
  //   base: { score: 52, lcpMs: null },
  // },
];

/** Parámetros del login B2C para el flujo con sesión. Los selectores son los típicos de
 *  Azure AD B2C; se ajustan aquí si el formulario real difiere (primera activación =
 *  una iteración de depuración esperada, los errores quedan visibles en el historial). */
export const SESION = {
  urlLogin: 'https://maya.yanbal.com',
  urlPortal: 'https://maya.yanbal.com/#/inicio',
  selectores: {
    usuario: ['#signInName', '#email', 'input[type="email"]', 'input[name="Username"]'],
    clave: ['#password', 'input[type="password"]'],
    enviar: ['#next', 'button[type="submit"]', 'input[type="submit"]'],
  },
  /** El login se da por bueno cuando la URL vuelve al dominio del portal. */
  esperaPostLoginMs: 60000,
};

/** Entrada anónima (sin sesión) — DESACTIVADA por decisión de jul-2026: el seguimiento
 *  se concentra en el recorrido real. Para reactivarla, añadir aquí los recorridos
 *  (p. ej. { codigo: 'portal', nombre: 'Entrada a Maya (login)', corto: 'Maya',
 *  url: 'https://maya.yanbal.com' }) y devolver el paso al workflow. */
export const RECORRIDOS = [];
