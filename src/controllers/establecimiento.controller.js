const bcrypt = require('bcryptjs');
const pool = require('../db/connection');

const getMine = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM ESTABLECIMIENTO WHERE id_establecimiento = ?`,
      [req.user.id_establecimiento]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: 'Establecimiento no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el establecimiento' });
  }
};

const updateMine = async (req, res) => {
  const { nombre, rbd, region, comuna } = req.body;

  if (!nombre || !rbd)
    return res.status(400).json({ message: 'Nombre y RBD son requeridos' });

  try {
    await pool.query(
      `UPDATE ESTABLECIMIENTO SET nombre=?, rbd=?, region=?, comuna=?
       WHERE id_establecimiento = ?`,
      [nombre, rbd, region || null, comuna || null, req.user.id_establecimiento]
    );
    res.json({ message: 'Establecimiento actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

// --- Administración de todos los establecimientos ---

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM ESTABLECIMIENTO ORDER BY nombre`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los establecimientos' });
  }
};

const getById = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM ESTABLECIMIENTO WHERE id_establecimiento = ?`,
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: 'Establecimiento no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el establecimiento' });
  }
};

const create = async (req, res) => {
  const { nombre, rbd, region, comuna, correo, password } = req.body;

  if (!nombre || !rbd || !region || !comuna || !correo || !password)
    return res.status(400).json({
      message: 'Nombre, RBD, región, comuna, correo y password son requeridos',
    });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [estResult] = await conn.query(
      `INSERT INTO ESTABLECIMIENTO (nombre, rbd, region, comuna) VALUES (?, ?, ?, ?)`,
      [nombre, rbd, region, comuna]
    );
    const id_establecimiento = estResult.insertId;

    const password_hash = await bcrypt.hash(password, 10);
    const [userResult] = await conn.query(
      `INSERT INTO USUARIO (correo, password_hash, rol, id_establecimiento)
       VALUES (?, ?, 'DIRECTOR', ?)`,
      [correo, password_hash, id_establecimiento]
    );

    await conn.commit();
    res.status(201).json({
      id_establecimiento,
      id_usuario: userResult.insertId,
      message: 'Establecimiento y director creados',
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'RBD o correo ya registrados' });
    res.status(500).json({ message: 'Error al crear el establecimiento' });
  } finally {
    conn.release();
  }
};

const update = async (req, res) => {
  const { nombre, rbd, region, comuna } = req.body;

  if (!nombre || !rbd)
    return res.status(400).json({ message: 'Nombre y RBD son requeridos' });

  try {
    await pool.query(
      `UPDATE ESTABLECIMIENTO SET nombre=?, rbd=?, region=?, comuna=?
       WHERE id_establecimiento = ?`,
      [nombre, rbd, region || null, comuna || null, req.params.id]
    );
    res.json({ message: 'Establecimiento actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(`DELETE FROM ESTABLECIMIENTO WHERE id_establecimiento = ?`, [req.params.id]);
    res.json({ message: 'Establecimiento eliminado' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({
        message: 'No es posible eliminar un establecimiento en uso.',
      });
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = { getMine, updateMine, getAll, getById, create, update, remove };
