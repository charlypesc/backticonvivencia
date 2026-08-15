const pool = require('../db/connection');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM REGION ORDER BY nombre`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las regiones' });
  }
};

const create = async (req, res) => {
  const { nombre, id_pais } = req.body;

  if (!nombre || !id_pais)
    return res.status(400).json({ message: 'Nombre y país son requeridos' });

  try {
    const [result] = await pool.query(
      `INSERT INTO REGION (nombre, id_pais) VALUES (?, ?)`,
      [nombre, id_pais]
    );
    res.status(201).json({ id_region: result.insertId, message: 'Región creada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear la región' });
  }
};

const update = async (req, res) => {
  const { nombre, id_pais } = req.body;

  if (!nombre || !id_pais)
    return res.status(400).json({ message: 'Nombre y país son requeridos' });

  try {
    await pool.query(
      `UPDATE REGION SET nombre=?, id_pais=? WHERE id_region = ?`,
      [nombre, id_pais, req.params.id]
    );
    res.json({ message: 'Región actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(`DELETE FROM REGION WHERE id_region = ?`, [req.params.id]);
    res.json({ message: 'Región eliminada' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({
        message: 'No es posible eliminar una región con provincias asociadas. Elimine o reasigne esas provincias primero.',
      });
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = { getAll, create, update, remove };
