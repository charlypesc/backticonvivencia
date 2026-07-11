const pool = require('../db/connection');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM TIPO_FALTA 
       WHERE id_establecimiento = ?
       ORDER BY gravedad, nombre`,
      [req.user.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener tipos de falta' });
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
      [nombre, gravedad, descripcion || null, medida_sugerida || null, req.user.id_establecimiento]
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
      [nombre, gravedad, descripcion, medida_sugerida, req.params.id, req.user.id_establecimiento]
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
      [req.params.id, req.user.id_establecimiento]
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

module.exports = { getAll, create, update, remove };