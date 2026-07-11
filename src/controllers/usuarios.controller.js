const bcrypt = require('bcryptjs');
const pool   = require('../db/connection');

// GET /api/usuarios — Solo DIRECTOR
const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id_usuario, correo, rol, activo
       FROM USUARIO
       WHERE id_establecimiento = ?`,
      [req.user.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
};

// POST /api/usuarios — Solo DIRECTOR
const create = async (req, res) => {
  const { correo, password, rol } = req.body;

  if (!correo || !password || !rol)
    return res.status(400).json({ message: 'Correo, contraseña y rol son requeridos' });

  if (!['ENCARGADO', 'DIRECTOR'].includes(rol))
    return res.status(400).json({ message: 'Rol inválido' });

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO USUARIO (correo, password_hash, rol, id_establecimiento)
       VALUES (?, ?, ?, ?)`,
      [correo, hash, rol, req.user.id_establecimiento]
    );
    res.status(201).json({ message: 'Usuario creado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'El correo ya está registrado' });
    res.status(500).json({ message: 'Error al crear usuario' });
  }
};

// PATCH /api/usuarios/:id/toggle — Solo DIRECTOR
const toggleActivo = async (req, res) => {
  try {
    await pool.query(
      `UPDATE USUARIO SET activo = NOT activo WHERE id_usuario = ? AND id_establecimiento = ?`,
      [req.params.id, req.user.id_establecimiento]
    );
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar usuario' });
  }
};

module.exports = { getAll, create, toggleActivo };