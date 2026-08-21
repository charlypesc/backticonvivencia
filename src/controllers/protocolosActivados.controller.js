const pool = require('../db/connection');

// El nombre/descripción que se muestra es el del establecimiento cuando lo
// personalizó o cuando es un protocolo propio; si no, hereda el del catálogo
// genérico (ver protocolosEstablecimiento.controller.js). El LEFT JOIN al
// catálogo es necesario porque un protocolo propio no tiene genérico detrás:
// con JOIN simple, sus activaciones desaparecían del listado.
const BASE_SELECT = `
  SELECT pa.*,
         COALESCE(pe.nombre, cp.nombre)           AS nombre,
         COALESCE(pe.descripcion, cp.descripcion) AS descripcion
  FROM PROTOCOLO_ACTIVADO pa
  JOIN PROTOCOLO_ESTABLECIMIENTO pe ON pa.id_protocolo_establecimiento = pe.id_protocolo_establecimiento
  LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON pe.id_protocolo = cp.id_protocolo
  WHERE pe.id_establecimiento = ?
`;

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${BASE_SELECT} ORDER BY pa.fecha_activacion DESC`,
      [req.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener protocolos activados' });
  }
};

const getByRegistro = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${BASE_SELECT} AND pa.id_registro = ? ORDER BY pa.fecha_activacion DESC`,
      [req.id_establecimiento, req.params.id_registro]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener protocolos activados del registro' });
  }
};

const create = async (req, res) => {
  const { id_protocolo_establecimiento, id_registro } = req.body;

  if (!id_protocolo_establecimiento || !id_registro)
    return res.status(400).json({ message: 'id_protocolo_establecimiento e id_registro son requeridos' });

  try {
    const [pe] = await pool.query(
      `SELECT 1 FROM PROTOCOLO_ESTABLECIMIENTO WHERE id_protocolo_establecimiento = ? AND id_establecimiento = ?`,
      [id_protocolo_establecimiento, req.id_establecimiento]
    );
    if (pe.length === 0)
      return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const [result] = await pool.query(
      `INSERT INTO PROTOCOLO_ACTIVADO (id_protocolo_establecimiento, id_registro, fecha_activacion)
       VALUES (?, ?, NOW())`,
      [id_protocolo_establecimiento, id_registro]
    );
    res.status(201).json({ id_protocolo_activado: result.insertId, message: 'Protocolo activado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al activar protocolo' });
  }
};

const update = async (req, res) => {
  const { id_protocolo_establecimiento, id_registro } = req.body;

  try {
    if (id_protocolo_establecimiento) {
      const [pe] = await pool.query(
        `SELECT 1 FROM PROTOCOLO_ESTABLECIMIENTO WHERE id_protocolo_establecimiento = ? AND id_establecimiento = ?`,
        [id_protocolo_establecimiento, req.id_establecimiento]
      );
      if (pe.length === 0)
        return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });
    }

    const [result] = await pool.query(
      `UPDATE PROTOCOLO_ACTIVADO pa
       JOIN PROTOCOLO_ESTABLECIMIENTO pe ON pa.id_protocolo_establecimiento = pe.id_protocolo_establecimiento
       SET pa.id_protocolo_establecimiento = ?, pa.id_registro = ?
       WHERE pa.id_protocolo_activado = ? AND pe.id_establecimiento = ?`,
      [id_protocolo_establecimiento, id_registro, req.params.id, req.id_establecimiento]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Protocolo activado no encontrado' });
    res.json({ message: 'Protocolo activado actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM PROTOCOLO_ACTIVADO
       WHERE id_protocolo_activado = ?
         AND id_protocolo_establecimiento IN (
           SELECT id_protocolo_establecimiento FROM PROTOCOLO_ESTABLECIMIENTO WHERE id_establecimiento = ?
         )`,
      [req.params.id, req.id_establecimiento]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Protocolo activado no encontrado' });
    res.json({ message: 'Protocolo activado eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = { getAll, getByRegistro, create, update, remove };
