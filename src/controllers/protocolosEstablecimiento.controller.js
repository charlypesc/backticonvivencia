const pool = require('../db/connection');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pe.*, cp.nombre, cp.descripcion
       FROM PROTOCOLO_ESTABLECIMIENTO pe
       JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON pe.id_protocolo = cp.id_protocolo
       WHERE pe.id_establecimiento = ?
       ORDER BY cp.nombre`,
      [req.user.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener protocolos del establecimiento' });
  }
};

const create = async (req, res) => {
  const { id_protocolo } = req.body;

  if (!id_protocolo)
    return res.status(400).json({ message: 'id_protocolo es requerido' });

  try {
    const [result] = await pool.query(
      `INSERT INTO PROTOCOLO_ESTABLECIMIENTO (id_establecimiento, id_protocolo)
       VALUES (?, ?)`,
      [req.user.id_establecimiento, id_protocolo]
    );
    res.status(201).json({ id_protocolo_establecimiento: result.insertId, message: 'Protocolo adoptado por el establecimiento' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Este protocolo ya fue adoptado por el establecimiento' });
    console.error(err);
    res.status(500).json({ message: 'Error al adoptar protocolo' });
  }
};

const update = async (req, res) => {
  const { id_protocolo } = req.body;

  try {
    await pool.query(
      `UPDATE PROTOCOLO_ESTABLECIMIENTO SET id_protocolo=?
       WHERE id_protocolo_establecimiento = ? AND id_establecimiento = ?`,
      [id_protocolo, req.params.id, req.user.id_establecimiento]
    );
    res.json({ message: 'Protocolo de establecimiento actualizado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Este protocolo ya fue adoptado por el establecimiento' });
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM PROTOCOLO_ESTABLECIMIENTO
       WHERE id_protocolo_establecimiento = ? AND id_establecimiento = ?`,
      [req.params.id, req.user.id_establecimiento]
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

module.exports = { getAll, create, update, remove };
