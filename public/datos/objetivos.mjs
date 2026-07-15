/**
 * Objetivos del seguimiento de performance de Maya en producción.
 *
 * Da continuidad a la "Auditoría de Performance Móvil · Maya Yanbal Perú · jun 2026":
 * mismos recorridos y misma metodología (perfil ESTÁNDAR de Lighthouse móvil, es decir
 * CPU 4× + 4G lenta simulada — anexo metodológico de la auditoría). No se define
 * throttling custom a propósito: usar los defaults es lo que garantiza que cada corrida
 * sea comparable con la línea base 37/50/52 de la auditoría y con las metas fijadas.
 *
 * La misma URL sirve a los 4 mercados (México, Perú, Bolivia y Guatemala — el país se
 * elige dentro de la app), así que toda mejora medida aquí aplica a los 4 países.
 *
 * Se mide SIN sesión (Azure AD B2C): cada recorrido captura su entrada real — cadena de
 * redirecciones de login incluida, que es justamente uno de los P0 de la auditoría.
 */

/** Corridas de Lighthouse por recorrido; se reporta la mediana (reduce la varianza de CI). */
export const CORRIDAS_POR_RECORRIDO = 3;

/** Tope del historial commiteado (~2 KB por corrida → el JSON queda acotado en <1 MB). */
export const MAX_CORRIDAS_HISTORIAL = 400;

/** Metas fijadas por la auditoría (diapositiva de cierre): contenido <2.5 s, puntaje >50.
 *  La tercera meta ("reporte <5 s") no es medible sin sesión: requiere medición de campo. */
export const METAS = { score: 50, lcpMs: 2500 };

/**
 * Los 3 recorridos auditados. `base` es la línea base de jun-2026 (referencia fija para
 * el dashboard: responde "¿mejoramos desde la auditoría?").
 */
export const RECORRIDOS = [
  {
    codigo: 'portal',
    nombre: 'Ingresar a Maya',
    url: 'https://maya.yanbal.com',
    // Portal: 37/100, LCP 17.9 s, TBT 720 ms, 2.1 MB de JS sin usar.
    base: { score: 37, lcpMs: 17900 },
  },
  {
    codigo: 'pedido',
    nombre: 'Pase de Pedido',
    url: 'https://pedidos.yanbal.com',
    // Pedido: 50/100, LCP 15.8 s, ~17 s recuperables en redirecciones de login.
    base: { score: 50, lcpMs: 15800 },
  },
  {
    codigo: 'reportes',
    nombre: 'Mis Reportes',
    url: 'https://misreportes.yanbal.com',
    // Reportes: 52/100 pero Lighthouse solo midió el spinner — el reporte SSRS real
    // no cargó en >90 s. Sin LCP de referencia honesto.
    base: { score: 52, lcpMs: null },
  },
];
