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

module.exports = { sembrarTiposFalta };
