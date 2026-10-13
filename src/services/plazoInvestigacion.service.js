const { calcularLimiteInvestigacion } = require('../utils/flujoProtocolo');
const { cargarFeriados } = require('./feriados.service');

// Plazo legal de la investigación de un caso, contado desde el registro.
//
// Antes fecha_limite_investigacion se calculaba desde la activación del
// protocolo: un registro del 25-07 cuyo protocolo se activó el 02-09 quedaba
// con límite el 02-11, más de tres meses después de que el colegio supo del
// hecho, y el sistema lo daba por "en plazo".

/**
 * Cuándo supo el establecimiento del hecho: lo primero entre la denuncia del
 * canal (si el registro salió de una) y la creación del registro. Si no, el
 * tiempo que la denuncia esperó en la bandeja se le regalaría al caso.
 *
 * @param {object} db conn de la transacción, o el pool
 * @returns {Promise<Date|null>}
 */
const momentoDelRegistro = async (db, id_registro) => {
  const [[fila]] = await db.query(
    `SELECT LEAST(r.fecha_creacion,
                  COALESCE((SELECT MIN(d.fecha_creacion) FROM DENUNCIA d
                            WHERE d.id_registro = r.id_registro), r.fecha_creacion)) AS desde
     FROM REGISTRO_CONVIVENCIA r
     WHERE r.id_registro = ?`,
    [id_registro]
  );
  return fila?.desde ?? null;
};

/**
 * Fecha límite de la investigación para un caso sobre este registro.
 *
 * @returns {Promise<{desde: Date|null, limite: string|null}>} limite 'YYYY-MM-DD'
 */
const limiteDelRegistro = async (db, { id_registro, id_establecimiento, ambito }) => {
  const desde = await momentoDelRegistro(db, id_registro);
  if (!desde) return { desde: null, limite: null };
  // Los feriados solo cuentan para el plazo en días hábiles del personal.
  const feriados = ambito === 'personal' ? await cargarFeriados(id_establecimiento) : undefined;
  return { desde, limite: calcularLimiteInvestigacion(desde, ambito, feriados) };
};

module.exports = { momentoDelRegistro, limiteDelRegistro };
