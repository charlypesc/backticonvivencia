/**
 * Columnas de estado de protocolo para un listado de registros.
 *
 * Van como subconsultas y no como JOIN porque las consultas que las usan ya
 * agrupan por registro (GROUP_CONCAT de involucrados) o lo multiplicarían por
 * cada fila de PROTOCOLO_ACTIVADO. Las tres se calculan contra `r`, así que la
 * consulta que las interpole tiene que tener REGISTRO_CONVIVENCIA aliasado
 * como `r`.
 *
 * Vive acá y no en un controller porque la usan dos pantallas distintas —la
 * lista de registros y el historial de la ficha del estudiante— y tienen que
 * decidir con exactamente el mismo criterio: si una contara los anulados y la
 * otra no, el mismo registro aparecería "con protocolo" en una pantalla y
 * "pendiente" en la otra.
 */
const COLUMNAS_ESTADO_PROTOCOLO = `
        -- Cuántos protocolos obligatorios de esta falta siguen sin activar.
        -- > 0 es lo que impide validar el registro.
        (SELECT COUNT(*)
           FROM TIPO_FALTA_PROTOCOLO tfp
           LEFT JOIN PROTOCOLO_ACTIVADO pa
             ON pa.id_registro = r.id_registro
            AND pa.id_protocolo_establecimiento = tfp.id_protocolo_establecimiento
            AND pa.estado <> 'anulado'
          WHERE tfp.id_tipo_falta = r.id_tipo_falta
            AND tfp.obligatorio = 1
            AND pa.id_protocolo_activado IS NULL) AS protocolos_pendientes,
        -- Protocolos ya activados sobre este registro (los anulados no cuentan).
        (SELECT COUNT(*)
           FROM PROTOCOLO_ACTIVADO pa2
          WHERE pa2.id_registro = r.id_registro
            AND pa2.estado <> 'anulado') AS protocolos_activos,
        -- A cuál lleva el botón: se prefiere uno todavía abierto y, entre
        -- varios, el más reciente. Si todos están cerrados igual se puede
        -- entrar a leerlo.
        (SELECT pa3.id_protocolo_activado
           FROM PROTOCOLO_ACTIVADO pa3
          WHERE pa3.id_registro = r.id_registro
            AND pa3.estado <> 'anulado'
          ORDER BY (pa3.estado = 'activo') DESC, pa3.fecha_activacion DESC
          LIMIT 1) AS id_protocolo_activado,
        -- En qué está ese mismo protocolo ('activo' o 'cerrado'). Mismo ORDER
        -- BY que la subconsulta de arriba a propósito: las dos tienen que
        -- describir la misma fila, o el badge diría "cerrado" mientras el
        -- botón lleva a otro protocolo que sigue abierto.
        (SELECT pa4.estado
           FROM PROTOCOLO_ACTIVADO pa4
          WHERE pa4.id_registro = r.id_registro
            AND pa4.estado <> 'anulado'
          ORDER BY (pa4.estado = 'activo') DESC, pa4.fecha_activacion DESC
          LIMIT 1) AS estado_protocolo`;

module.exports = { COLUMNAS_ESTADO_PROTOCOLO };
