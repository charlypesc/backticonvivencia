const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../db/connection');

const login = async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password)
    return res.status(400).json({ message: 'Correo y contraseña requeridos' });

  try {
    const [rows] = await pool.query(
      `SELECT u.*, e.nombre AS nombre_establecimiento
       FROM USUARIO u
       JOIN ESTABLECIMIENTO e ON u.id_establecimiento = e.id_establecimiento
       WHERE u.correo = ? AND u.activo = 1`,
      [correo]
    );

    if (rows.length === 0)
      return res.status(401).json({ message: 'Credenciales incorrectas' });

    const usuario = rows[0];
    const passwordOk = await bcrypt.compare(password, usuario.password_hash);

    if (!passwordOk)
      return res.status(401).json({ message: 'Credenciales incorrectas' });

    const token = jwt.sign(
      {
        id:                usuario.id_usuario,
        correo:            usuario.correo,
        rol:               usuario.rol,
        id_establecimiento: usuario.id_establecimiento,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      usuario: {
        id:                   usuario.id_usuario,
        correo:               usuario.correo,
        rol:                  usuario.rol,
        id_establecimiento:   usuario.id_establecimiento,
        nombre_establecimiento: usuario.nombre_establecimiento,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error del servidor' });
  }
};

const me = (req, res) => res.json({ usuario: req.user });

module.exports = { login, me };