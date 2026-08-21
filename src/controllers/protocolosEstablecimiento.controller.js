const pool = require('../db/connection');

// Un protocolo del establecimiento viene por una de dos vías:
//
//  1. Adoptado del catálogo genérico (id_protocolo con valor). Puede
//     reescribirse para la realidad local en las columnas `nombre`/`descripcion`;
//     el catálogo genérico solo lo edita el ADMIN. NULL en esas columnas
//     significa "sin personalizar" y la fila hereda el texto del genérico vía
//     COALESCE. Por eso no se copia el texto al adoptar: así una corrección del
//     admin llega a todos los colegios que no lo reescribieron, en vez de quedar
//     congelada en cada copia.
//
//  2. Propio del establecimiento (id_protocolo NULL), creado desde cero por el
//     colegio. Ahí `nombre` es obligatorio, porque no hay genérico del que heredar.
//
// El LEFT JOIN es lo que permite que convivan ambos casos en la misma consulta.
const SELECT_EFECTIVO = `
  SELECT pe.id_protocolo_establecimiento,
         pe.id_establecimiento,
         pe.id_protocolo,
         COALESCE(pe.nombre, cp.nombre)           AS nombre,
         COALESCE(pe.descripcion, cp.descripcion) AS descripcion,
         cp.nombre                                AS nombre_generico,
         cp.descripcion                           AS descripcion_generica,
         (pe.id_protocolo IS NULL)                AS propio,
         (pe.id_protocolo IS NOT NULL AND (pe.nombre IS NOT NULL OR pe.descripcion IS NOT NULL)) AS personalizado
  FROM PROTOCOLO_ESTABLECIMIENTO pe
  LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON pe.id_protocolo = cp.id_protocolo
`;

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${SELECT_EFECTIVO} WHERE pe.id_establecimiento = ? ORDER BY nombre`,
      [req.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener protocolos del establecimiento' });
  }
};

// Adopta un protocolo del catálogo genérico. La ruta exige
// protocolo_establecimiento.crear.
const create = async (req, res) => {
  const { id_protocolo, nombre, descripcion } = req.body;

  if (!id_protocolo)
    return res.status(400).json({ message: 'id_protocolo es requerido' });

  try {
    const [generico] = await pool.query(
      `SELECT 1 FROM CATALOGO_PROTOCOLOS_GENERICOS WHERE id_protocolo = ?`,
      [id_protocolo]
    );
    if (generico.length === 0)
      return res.status(404).json({ message: 'Protocolo genérico no encontrado' });

    const [result] = await pool.query(
      `INSERT INTO PROTOCOLO_ESTABLECIMIENTO (id_establecimiento, id_protocolo, nombre, descripcion)
       VALUES (?, ?, ?, ?)`,
      [req.id_establecimiento, id_protocolo, nombre || null, descripcion || null]
    );
    res.status(201).json({ id_protocolo_establecimiento: result.insertId, message: 'Protocolo adoptado por el establecimiento' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Este protocolo ya fue adoptado por el establecimiento' });
    console.error(err);
    res.status(500).json({ message: 'Error al adoptar protocolo' });
  }
};

// Crea un protocolo propio del establecimiento, sin origen en el catálogo
// genérico (id_protocolo NULL). Va por su propio permiso
// (protocolo_establecimiento.crear_propio) y no por el de adoptar: escribir un
// protocolo desde cero es una responsabilidad distinta de elegir uno ya
// redactado, y así se puede habilitar una sin la otra.
const createPropio = async (req, res) => {
  const { nombre, descripcion } = req.body;

  // Sin genérico detrás no hay texto que heredar: el nombre es obligatorio.
  if (!nombre?.trim())
    return res.status(400).json({ message: 'Nombre es requerido' });

  try {
    const [result] = await pool.query(
      `INSERT INTO PROTOCOLO_ESTABLECIMIENTO (id_establecimiento, id_protocolo, nombre, descripcion)
       VALUES (?, NULL, ?, ?)`,
      [req.id_establecimiento, nombre.trim(), descripcion?.trim() || null]
    );
    res.status(201).json({ id_protocolo_establecimiento: result.insertId, message: 'Protocolo propio creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear el protocolo' });
  }
};

// Solo toca la versión local. `id_protocolo` no se puede cambiar: para apuntar a
// otro genérico se elimina la adopción y se adopta el otro, en vez de dejar un
// texto personalizado colgando de un protocolo que ya no le corresponde. Un
// protocolo propio tampoco puede convertirse en adoptado por esta vía.
//
// En un protocolo adoptado, enviar nombre/descripcion vacíos vuelve la fila al
// texto del genérico. En uno propio no hay a qué volver, así que el nombre
// sigue siendo obligatorio.
const update = async (req, res) => {
  const { nombre, descripcion } = req.body;

  try {
    const [filas] = await pool.query(
      `SELECT id_protocolo FROM PROTOCOLO_ESTABLECIMIENTO
       WHERE id_protocolo_establecimiento = ? AND id_establecimiento = ?`,
      [req.params.id, req.id_establecimiento]
    );
    if (filas.length === 0)
      return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const esPropio = filas[0].id_protocolo === null;
    if (esPropio && !nombre?.trim())
      return res.status(400).json({ message: 'Nombre es requerido' });

    await pool.query(
      `UPDATE PROTOCOLO_ESTABLECIMIENTO SET nombre = ?, descripcion = ?
       WHERE id_protocolo_establecimiento = ? AND id_establecimiento = ?`,
      [nombre?.trim() || null, descripcion?.trim() || null, req.params.id, req.id_establecimiento]
    );
    res.json({ message: 'Protocolo de establecimiento actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM PROTOCOLO_ESTABLECIMIENTO
       WHERE id_protocolo_establecimiento = ? AND id_establecimiento = ?`,
      [req.params.id, req.id_establecimiento]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });
    res.json({ message: 'Protocolo de establecimiento eliminado' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({ message: 'No es posible eliminar: tiene activaciones asociadas.' });
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = { getAll, create, createPropio, update, remove };
