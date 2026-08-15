const pool = require('../db/connection');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM PROVINCIA ORDER BY nombre`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las provincias' });
  }
};

const create = async (req, res) => {
  const { nombre, id_region } = req.body;

  if (!nombre || !id_region)
    return res.status(400).json({ message: 'Nombre y región son requeridos' });

  try {
    const [result] = await pool.query(
      `INSERT INTO PROVINCIA (nombre, id_region) VALUES (?, ?)`,
      [nombre, id_region]
    );
    res.status(201).json({ id_provincia: result.insertId, message: 'Provincia creada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear la provincia' });
  }
};

const update = async (req, res) => {
  const { nombre, id_region } = req.body;

  if (!nombre || !id_region)
    return res.status(400).json({ message: 'Nombre y región son requeridos' });

  try {
    await pool.query(
      `UPDATE PROVINCIA SET nombre=?, id_region=? WHERE id_provincia = ?`,
      [nombre, id_region, req.params.id]
    );
    res.json({ message: 'Provincia actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(`DELETE FROM PROVINCIA WHERE id_provincia = ?`, [req.params.id]);
    res.json({ message: 'Provincia eliminada' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({
        message: 'No es posible eliminar una provincia con comunas asociadas. Elimine o reasigne esas comunas primero.',
      });
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = { getAll, create, update, remove };
