const pool = require('../db/connection');

// Feriados que hacen inhábil un día.
//
// Existe porque los plazos que fija la Ley 21.809 se cuentan en días hábiles
// (15 para la suspensión, 5 para informar a la Superintendencia y a la SEREMI)
// y hasta ahora `calcularFechaLimite` solo salteaba sábados y domingos. Una
// semana con feriado devolvía una fecha límite corrida, y un plazo mal contado
// es exactamente lo que después no se puede defender en una fiscalización.
//
// Los feriados NO se consultan a una API en tiempo de cálculo: se siembran en
// la tabla FERIADO. Se conocen con años de anticipación y solo cambian por ley,
// así que depender de un servicio externo en runtime agrega un modo de falla
// (API caída = fecha límite silenciosamente mal) sin ganar nada.
//
// Un feriado con id_region NULL es nacional; con valor, rige solo en esa región
// (p. ej. el 7 de junio en Arica y Parinacota). Por eso el set depende del
// establecimiento y no es uno solo para todo el sistema.

// La tabla cambia una vez al año. Se cachea por región para no consultarla en
// cada paso que arranca, con un TTL corto para que una corrección entre sin
// tener que reiniciar el proceso.
const TTL_MS = 60 * 60 * 1000;
const cache = new Map();

const aISO = (fecha) =>
  fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10);

/**
 * Región del establecimiento, o null si no se puede resolver (sin comuna
 * asignada). En ese caso se usan solo los feriados nacionales: es la respuesta
 * correcta por defecto, no una falla.
 */
const regionDe = async (id_establecimiento) => {
  if (!id_establecimiento) return null;
  const [[fila]] = await pool.query(
    `SELECT p.id_region
     FROM ESTABLECIMIENTO e
     JOIN COMUNA c    ON c.id_comuna    = e.id_comuna
     JOIN PROVINCIA p ON p.id_provincia = c.id_provincia
     WHERE e.id_establecimiento = ?`,
    [id_establecimiento]
  );
  return fila?.id_region ?? null;
};

/**
 * Set de fechas 'YYYY-MM-DD' inhábiles para ese establecimiento: los feriados
 * nacionales más los de su región.
 *
 * @param {number|null} id_establecimiento
 * @returns {Promise<Set<string>>}
 */
const cargarFeriados = async (id_establecimiento) => {
  const id_region = await regionDe(id_establecimiento);
  const clave = id_region ?? 'nacional';

  const guardado = cache.get(clave);
  if (guardado && guardado.expira > Date.now()) return guardado.set;

  const [filas] = await pool.query(
    'SELECT fecha FROM FERIADO WHERE id_region IS NULL OR id_region = ?',
    [id_region]
  );
  const set = new Set(filas.map((f) => aISO(f.fecha)));
  cache.set(clave, { set, expira: Date.now() + TTL_MS });
  return set;
};

/** Para usar después de editar la tabla desde el mantenedor de feriados. */
const invalidarCache = () => cache.clear();

module.exports = { cargarFeriados, invalidarCache, aISO };
