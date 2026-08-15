const pool = require('../db/connection');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM PAIS ORDER BY nombre`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los países' });
  }
};

const create = async (req, res) => {
  const { nombre, codigo } = req.body;

  if (!nombre)
    return res.status(400).json({ message: 'Nombre es requerido' });

  try {
    const [result] = await pool.query(
      `INSERT INTO PAIS (nombre, codigo) VALUES (?, ?)`,
      [nombre, codigo || null]
    );
    res.status(201).json({ id_pais: result.insertId, message: 'País creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear el país' });
  }
};

const update = async (req, res) => {
  const { nombre, codigo } = req.body;

  if (!nombre)
    return res.status(400).json({ message: 'Nombre es requerido' });

  try {
    await pool.query(
      `UPDATE PAIS SET nombre=?, codigo=? WHERE id_pais = ?`,
      [nombre, codigo || null, req.params.id]
    );
    res.json({ message: 'País actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(`DELETE FROM PAIS WHERE id_pais = ?`, [req.params.id]);
    res.json({ message: 'País eliminado' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({
        message: 'No es posible eliminar un país con regiones asociadas. Elimine o reasigne esas regiones primero.',
      });
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = { getAll, create, update, remove };
