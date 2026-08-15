const pool = require('../db/connection');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM SOSTENEDOR ORDER BY representante_legal`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los sostenedores' });
  }
};

const getById = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM SOSTENEDOR WHERE id_sostenedor = ?`,
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: 'Sostenedor no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el sostenedor' });
  }
};

const create = async (req, res) => {
  const { rut, representante_legal, direccion, mail } = req.body;

  if (!rut || !representante_legal)
    return res.status(400).json({ message: 'RUT y representante legal son requeridos' });

  try {
    const [result] = await pool.query(
      `INSERT INTO SOSTENEDOR (rut, representante_legal, direccion, mail)
       VALUES (?, ?, ?, ?)`,
      [rut, representante_legal, direccion || null, mail || null]
    );
    res.status(201).json({ id_sostenedor: result.insertId, message: 'Sostenedor creado' });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'RUT ya registrado' });
    res.status(500).json({ message: 'Error al crear el sostenedor' });
  }
};

const update = async (req, res) => {
  const { rut, representante_legal, direccion, mail } = req.body;

  if (!rut || !representante_legal)
    return res.status(400).json({ message: 'RUT y representante legal son requeridos' });

  try {
    await pool.query(
      `UPDATE SOSTENEDOR SET rut=?, representante_legal=?, direccion=?, mail=?
       WHERE id_sostenedor = ?`,
      [rut, representante_legal, direccion || null, mail || null, req.params.id]
    );
    res.json({ message: 'Sostenedor actualizado' });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'RUT ya registrado' });
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(`DELETE FROM SOSTENEDOR WHERE id_sostenedor = ?`, [req.params.id]);
    res.json({ message: 'Sostenedor eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

// GET establecimientos vinculados a un sostenedor
const getEstablecimientos = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM ESTABLECIMIENTO WHERE id_sostenedor = ? ORDER BY nombre`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los establecimientos' });
  }
};

// Vincular un establecimiento a un sostenedor
const asignarEstablecimiento = async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE ESTABLECIMIENTO SET id_sostenedor = ? WHERE id_establecimiento = ?`,
      [req.params.id, req.params.idEstablecimiento]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Establecimiento no encontrado' });
    res.json({ message: 'Establecimiento vinculado al sostenedor' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al vincular el establecimiento' });
  }
};

// Desvincular un establecimiento del sostenedor
const desasignarEstablecimiento = async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE ESTABLECIMIENTO SET id_sostenedor = NULL
       WHERE id_establecimiento = ? AND id_sostenedor = ?`,
      [req.params.idEstablecimiento, req.params.id]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Establecimiento no encontrado' });
    res.json({ message: 'Establecimiento desvinculado del sostenedor' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al desvincular el establecimiento' });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getEstablecimientos,
  asignarEstablecimiento,
  desasignarEstablecimiento,
};
