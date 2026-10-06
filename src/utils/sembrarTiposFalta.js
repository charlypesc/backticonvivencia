const { TIPOS_FALTA_PLANTILLA } = require('../constants/tiposFaltaPlantilla');

// Copia el catálogo base de tipos de falta al establecimiento que acaba de
// pasar a ser tenant.
//
// Recibe la conexión en vez de tomarla del pool para poder correr dentro de la
// transacción del alta: si el alta se revierte, la siembra se revierte con
// ella y no quedan tipos de falta huérfanos de un colegio que nunca existió.
//
// Es idempotente: si el establecimiento ya tiene tipos de falta no toca nada.
// Un colegio puede volver a marcarse como tenant después de una baja, y ahí lo
// que quiere es recuperar su catálogo editado, no que le vuelvan a aparecer los
// tipos de la plantilla que ya había borrado.
const sembrarTiposFalta = async (conn, id_establecimiento) => {
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM TIPO_FALTA WHERE id_establecimiento = ?`,
    [id_establecimiento]
  );
  if (n > 0) return 0;

  await conn.query(
    `INSERT INTO TIPO_FALTA (nombre, gravedad, descripcion, medida_sugerida, id_establecimiento)
     VALUES ?`,
    [
      TIPOS_FALTA_PLANTILLA.map((t) => [
        t.nombre,
        t.gravedad,
        t.descripcion,
        t.medida_sugerida,
        id_establecimiento,
      ]),
    ]
  );

  return TIPOS_FALTA_PLANTILLA.length;
};

/**
 * Vincula cada motivo de la plantilla con el protocolo que manda activar
 * (TIPO_FALTA_PROTOCOLO). Sin este vínculo el formulario de registros no
 * preselecciona ningún protocolo al elegir el motivo: el colegio tenía los
 * motivos y los protocolos, pero nadie los había unido a mano.
 *
 * El vínculo une dos cosas del colegio (su motivo y su copia del protocolo),
 * así que solo puede crearse cuando ya adoptó ese protocolo. Por eso corre en
 * dos momentos: al darse de alta y cada vez que adopta un genérico
 * (`id_protocolo` acota a ese).
 *
 * Solo toca motivos que todavía no tienen ningún protocolo vinculado: si el
 * colegio ya configuró los suyos en el mantenedor, eso manda. El motivo se
 * busca por nombre, así que uno renombrado por el colegio queda afuera.
 *
 * @returns {Promise<number>} vínculos creados
 */
const vincularProtocolosPlantilla = async (ejecutor, id_establecimiento, id_protocolo = null) => {
  const pares = TIPOS_FALTA_PLANTILLA
    .filter((t) => t.protocolo_generico && (id_protocolo === null || t.protocolo_generico === Number(id_protocolo)))
    .map((t) => [t.nombre, t.protocolo_generico]);
  if (pares.length === 0) return 0;

  const [r] = await ejecutor.query(
    `INSERT INTO TIPO_FALTA_PROTOCOLO
       (id_tipo_falta, id_protocolo_establecimiento, id_establecimiento, obligatorio)
     SELECT tf.id_tipo_falta, pe.id_protocolo_establecimiento, tf.id_establecimiento, 0
       FROM TIPO_FALTA tf
       JOIN PROTOCOLO_ESTABLECIMIENTO pe
         ON pe.id_establecimiento = tf.id_establecimiento
      WHERE tf.id_establecimiento = ?
        AND (tf.nombre, pe.id_protocolo) IN (?)
        AND NOT EXISTS (SELECT 1 FROM TIPO_FALTA_PROTOCOLO x WHERE x.id_tipo_falta = tf.id_tipo_falta)`,
    [id_establecimiento, pares]
  );
  return r.affectedRows;
};

module.exports = { sembrarTiposFalta, vincularProtocolosPlantilla };
