const pool = require('../db/connection');

// Protocolos que cada tipo de falta obliga (o sugiere) activar.
//
// La Ley 21.809 invierte la lógica del registro suelto: ante un hecho de cierta
// entidad no basta con anotarlo, hay que activar el protocolo que el reglamento
// interno tiene definido para ese tipo de situación. Este vínculo es lo que
// convierte "el encargado se acuerda de activarlo" en una regla del sistema.
//
// Es N:M y no una columna en TIPO_FALTA porque un mismo hecho puede exigir más
// de un protocolo a la vez (maltrato entre estudiantes + vulneración de
// derechos, por ejemplo).
const SELECT_VINCULOS = `
  SELECT tfp.id_tipo_falta,
         tfp.id_protocolo_establecimiento,
         tfp.obligatorio,
         COALESCE(pe.nombre, cp.nombre) AS protocolo_nombre
  FROM TIPO_FALTA_PROTOCOLO tfp
  JOIN PROTOCOLO_ESTABLECIMIENTO pe
    ON pe.id_protocolo_establecimiento = tfp.id_protocolo_establecimiento
  LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON cp.id_protocolo = pe.id_protocolo
  WHERE tfp.id_establecimiento = ?
`;

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      // Ordenar por el texto de gravedad los dejaba alfabéticos (grave,
      // gravísima, leve), que no es el orden en que se piensan las faltas.
      // FIELD() los devuelve de menor a mayor gravedad.
      `SELECT * FROM TIPO_FALTA
       WHERE id_establecimiento = ?
       ORDER BY FIELD(gravedad, 'leve', 'grave', 'gravísima'), nombre`,
      [req.id_establecimiento]
    );

    // Los vínculos van en una segunda consulta y se pegan en JS: con un JOIN se
    // multiplicaría la fila del tipo de falta por cada protocolo vinculado, que
    // es el mismo problema que ya resuelve con GROUP_CONCAT el listado de
    // registros. Acá hacen falta los ids, no un texto concatenado.
    const [vinculos] = await pool.query(SELECT_VINCULOS, [req.id_establecimiento]);
    const porFalta = new Map();
    for (const v of vinculos) {
      if (!porFalta.has(v.id_tipo_falta)) porFalta.set(v.id_tipo_falta, []);
      porFalta.get(v.id_tipo_falta).push({
        id_protocolo_establecimiento: v.id_protocolo_establecimiento,
        protocolo_nombre: v.protocolo_nombre,
        obligatorio: !!v.obligatorio,
      });
    }

    res.json(rows.map((r) => ({ ...r, protocolos: porFalta.get(r.id_tipo_falta) ?? [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener tipos de falta' });
  }
};

// PUT /api/tipos-falta/:id/protocolos
// Reemplaza el conjunto completo de vínculos de un tipo de falta. Se manda
// entero y no de a uno porque la pantalla edita la lista como una sola cosa:
// con altas y bajas sueltas, dos guardados simultáneos dejan un estado que no
// es ninguno de los dos.
const setProtocolos = async (req, res) => {
  const { protocolos } = req.body;

  if (!Array.isArray(protocolos))
    return res.status(400).json({ message: 'protocolos debe ser un arreglo' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[falta]] = await conn.query(
      'SELECT 1 AS ok FROM TIPO_FALTA WHERE id_tipo_falta = ? AND id_establecimiento = ?',
      [req.params.id, req.id_establecimiento]
    );
    if (!falta) {
      await conn.rollback();
      return res.status(404).json({ message: 'Tipo de falta no encontrado' });
    }

    // Cada protocolo tiene que ser del mismo establecimiento: sin este chequeo
    // se podría vincular el protocolo de otro colegio y el caso se activaría
    // con un grafo ajeno. Mismo criterio que tipoFaltaValido en registros.
    const ids = protocolos.map((p) => Number(p.id_protocolo_establecimiento)).filter(Boolean);
    if (ids.length > 0) {
      const [validos] = await conn.query(
        `SELECT id_protocolo_establecimiento FROM PROTOCOLO_ESTABLECIMIENTO
         WHERE id_establecimiento = ? AND id_protocolo_establecimiento IN (?)`,
        [req.id_establecimiento, ids]
      );
      if (validos.length !== new Set(ids).size) {
        await conn.rollback();
        return res.status(400).json({
          message: 'Alguno de los protocolos no pertenece a este establecimiento',
        });
      }
    }

    await conn.query('DELETE FROM TIPO_FALTA_PROTOCOLO WHERE id_tipo_falta = ?', [req.params.id]);

    if (protocolos.length > 0)
      await conn.query(
        `INSERT INTO TIPO_FALTA_PROTOCOLO
           (id_tipo_falta, id_protocolo_establecimiento, id_establecimiento, obligatorio)
         VALUES ?`,
        [protocolos.map((p) => [
          req.params.id, p.id_protocolo_establecimiento, req.id_establecimiento,
          p.obligatorio ? 1 : 0,
        ])]
      );

    await conn.commit();
    res.json({ message: 'Protocolos del tipo de falta actualizados' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar los protocolos del tipo de falta' });
  } finally {
    conn.release();
  }
};

const create = async (req, res) => {
  const { nombre, gravedad, descripcion, medida_sugerida } = req.body;

  if (!nombre || !gravedad)
    return res.status(400).json({ message: 'Nombre y gravedad son requeridos' });

  try {
    const [result] = await pool.query(
      `INSERT INTO TIPO_FALTA (nombre, gravedad, descripcion, medida_sugerida, id_establecimiento)
       VALUES (?, ?, ?, ?, ?)`,
      [nombre, gravedad, descripcion || null, medida_sugerida || null, req.id_establecimiento]
    );
    res.status(201).json({ id_tipo_falta: result.insertId, message: 'Tipo de falta creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear tipo de falta' });
  }
};

const update = async (req, res) => {
  const { nombre, gravedad, descripcion, medida_sugerida } = req.body;

  try {
    await pool.query(
      `UPDATE TIPO_FALTA SET nombre=?, gravedad=?, descripcion=?, medida_sugerida=?
       WHERE id_tipo_falta = ? AND id_establecimiento = ?`,
      [nombre, gravedad, descripcion, medida_sugerida, req.params.id, req.id_establecimiento]
    );
    res.json({ message: 'Tipo de falta actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM TIPO_FALTA 
       WHERE id_tipo_falta = ? AND id_establecimiento = ?`,
      [req.params.id, req.id_establecimiento]
    );
    res.json({ message: 'Tipo de falta eliminado' });
  } catch (err) {
    // FK constraint — está en uso
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({
        message: 'No es posible eliminar un tipo de falta en uso. Reasigne los registros asociados primero.'
      });
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = { getAll, create, update, remove, setProtocolos };