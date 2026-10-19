// El paso de acogida de relatos con el que nace todo protocolo nuevo.
//
// Todos los protocolos acogen los relatos de los involucrados, así que en vez
// de que cada uno lo escriba a su manera (y después no se pueda comparar), el
// paso se crea solo al crear el protocolo, ya armado y como paso inicial. Se
// puede editar o mover como cualquier otro. Los textos son los mismos que
// precarga el editor al elegir el tipo "Acogida de relatos" (PLANTILLAS en
// protocolo-flujo.ts del front).
const PASO_ACOGIDA_RELATOS = {
  nombre: 'Acogida de relatos',
  descripcion:
    'Escuchar y registrar el relato de cada involucrado del caso. Primero se indica a quién se le ' +
    'acogerá el relato y, si a alguien no, por qué. Cada relato queda guardado con la fecha y hora ' +
    'en que se ingresó, y cada corrección queda en el expediente.',
  tipo_paso: 'acogida_relatos',
};

/**
 * Crea el paso en el flujo recién creado de un protocolo, con el coordinador
 * de convivencia (ENCARGADO) como ejecutor: es quien conduce las entrevistas.
 *
 * @param conn conexión dentro de la transacción que creó el protocolo
 * @param nivel 'catalogo' | 'establecimiento'
 * @param id id del protocolo genérico o del protocolo del establecimiento
 */
const insertarPasoRelatos = async (conn, nivel, id) => {
  const { nombre, descripcion, tipo_paso } = PASO_ACOGIDA_RELATOS;
  const [r] = nivel === 'catalogo'
    ? await conn.query(
        `INSERT INTO CATALOGO_PROTOCOLO_PASO
           (id_protocolo, nombre, descripcion, tipo_paso, es_paso_inicial, es_paso_final, orden_visual)
         VALUES (?, ?, ?, ?, 1, 0, 10)`,
        [id, nombre, descripcion, tipo_paso])
    : await conn.query(
        `INSERT INTO PROTOCOLO_ESTABLECIMIENTO_PASO
           (id_protocolo_establecimiento, nombre, descripcion, tipo_paso, es_paso_inicial, es_paso_final, orden_visual)
         VALUES (?, ?, ?, ?, 1, 0, 10)`,
        [id, nombre, descripcion, tipo_paso]);

  const [[encargado]] = await conn.query(
    "SELECT rol_id FROM ROLES WHERE codigo = 'ENCARGADO' AND id_establecimiento IS NULL LIMIT 1"
  );
  if (encargado)
    await conn.query(
      nivel === 'catalogo'
        ? "INSERT INTO CATALOGO_PROTOCOLO_PASO_ROL (id_paso, rol_id, tipo_participacion) VALUES (?, ?, 'ejecutor')"
        : "INSERT INTO PROTOCOLO_ESTABLECIMIENTO_PASO_ROL (id_paso_estab, rol_id, tipo_participacion) VALUES (?, ?, 'ejecutor')",
      [r.insertId, encargado.rol_id]
    );
  return r.insertId;
};

module.exports = { PASO_ACOGIDA_RELATOS, insertarPasoRelatos };
