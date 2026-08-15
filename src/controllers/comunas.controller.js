const pool = require('../db/connection');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM COMUNA ORDER BY nombre`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las comunas' });
  }
};

const create = async (req, res) => {
  const { nombre, id_provincia } = req.body;

  if (!nombre || !id_provincia)
    return res.status(400).json({ message: 'Nombre y provincia son requeridos' });

  try {
    const [result] = await pool.query(
      `INSERT INTO COMUNA (nombre, id_provincia) VALUES (?, ?)`,
      [nombre, id_provincia]
    );
    res.status(201).json({ id_comuna: result.insertId, message: 'Comuna creada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear la comuna' });
  }
};

const update = async (req, res) => {
  const { nombre, id_provincia } = req.body;

  if (!nombre || !id_provincia)
    return res.status(400).json({ message: 'Nombre y provincia son requeridos' });

  try {
    await pool.query(
      `UPDATE COMUNA SET nombre=?, id_provincia=? WHERE id_comuna = ?`,
      [nombre, id_provincia, req.params.id]
    );
    res.json({ message: 'Comuna actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(`DELETE FROM COMUNA WHERE id_comuna = ?`, [req.params.id]);
    res.json({ message: 'Comuna eliminada' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({
        message: 'No es posible eliminar una comuna en uso.',
      });
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = { getAll, create, update, remove };
