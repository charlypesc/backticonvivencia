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
       LEFT JOIN ESTABLECIMIENTO e ON u.id_establecimiento = e.id_establecimiento
       WHERE u.correo = ? AND u.activo = 1`,
      [correo]
    );

    if (rows.length === 0)
      return res.status(401).json({ message: 'Credenciales incorrectas' });

    const usuario = rows[0];
    const passwordOk = await bcrypt.compare(password, usuario.password_hash);

    if (!passwordOk)
      return res.status(401).json({ message: 'Credenciales incorrectas' });

    const [rolesRows] = await pool.query(
      `SELECT r.codigo
       FROM USUARIO_ROLES ur
       JOIN ROLES r ON r.rol_id = ur.rol_id AND r.activo = TRUE
       WHERE ur.id_usuario = ?
         AND (ur.expira_at IS NULL OR ur.expira_at > NOW())`,
      [usuario.id_usuario]
    );
    let roles = rolesRows.map((r) => r.codigo);

    // Sin filas en USUARIO_ROLES el usuario quedaría sin permisos y todo le
    // respondería 403 sin explicación. Se cae a la columna legacy y se avisa:
    // es un bug de datos (usuario sin migrar), no una denegación legítima.
    if (roles.length === 0 && usuario.rol) {
      console.warn(`Usuario ${usuario.correo} sin filas en USUARIO_ROLES; usando USUARIO.rol`);
      roles = [usuario.rol];
    }

    const esAdmin = roles.includes('ADMIN');

    // El ADMIN no lleva permisos en el token: pasa por bypass en el middleware.
    // Enumerarle los 73 códigos infla el JWT y lo dejaría sin los permisos que
    // se creen después de emitido el token.
    // Van como ids numéricos (ver src/constants/permisos.js): el frontend
    // compara contra las mismas constantes, y el token queda mucho más chico
    // que con 77 códigos de texto.
    let permisos = [];
    if (!esAdmin) {
      const [permRows] = await pool.query(
        `SELECT permiso_id FROM VW_PERMISOS_EFECTIVOS WHERE id_usuario = ?`,
        [usuario.id_usuario]
      );
      permisos = permRows.map((p) => p.permiso_id);
    }

    const token = jwt.sign(
      {
        id:                 usuario.id_usuario,
        correo:             usuario.correo,
        id_establecimiento: usuario.id_establecimiento,
        roles,
        permisos,
        // `rol` se mantiene por compatibilidad con el frontend actual, que
        // asume un rol único. Quitarlo recién cuando ese repo migre a `roles`.
        rol: roles[0] ?? usuario.rol,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      usuario: {
        id:                   usuario.id_usuario,
        correo:               usuario.correo,
        rol:                  roles[0] ?? usuario.rol,
        roles,
        permisos,
        // El ADMIN pasa por bypass en el backend, así que su lista de permisos
        // viaja vacía. El frontend usa esta bandera para no ocultarle nada.
        es_admin:             esAdmin,
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

// Cualquier usuario autenticado puede cambiar su propia clave: no lleva permiso
// asociado. El control de acceso es la clave actual, no el rol — por eso el id
// sale del token y nunca del body: aceptarlo de afuera convertiría esto en un
// "cambiar la contraseña de cualquiera".
const cambiarPassword = async (req, res) => {
  const { actual, nueva } = req.body;

  if (!actual || !nueva)
    return res.status(400).json({ message: 'Contraseña actual y nueva son requeridas' });

  // El mínimo se valida acá y no solo en el frontend: el endpoint es alcanzable
  // sin pasar por la pantalla.
  if (nueva.length < 8)
    return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres' });

  if (actual === nueva)
    return res.status(400).json({ message: 'La nueva contraseña debe ser distinta de la actual' });

  try {
    const [[usuario]] = await pool.query(
      `SELECT id_usuario, password_hash FROM USUARIO WHERE id_usuario = ? AND activo = 1`,
      [req.user.id]
    );
    if (!usuario) return res.status(404).json({ message: 'Usuario no encontrado' });

    // Se pide la actual aunque la sesión ya esté iniciada: sin esto, un equipo
    // dejado abierto alcanza para que alguien se apropie de la cuenta.
    if (!(await bcrypt.compare(actual, usuario.password_hash)))
      return res.status(401).json({ message: 'La contraseña actual no es correcta' });

    await pool.query(
      `UPDATE USUARIO SET password_hash = ? WHERE id_usuario = ?`,
      [await bcrypt.hash(nueva, 10), usuario.id_usuario]
    );

    // El token sigue siendo válido hasta que expire: no hay lista de revocación.
    // Cerrar sesión en el resto de los dispositivos exigiría versionar el token,
    // que es un cambio bastante más grande que este.
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al cambiar la contraseña' });
  }
};

module.exports = { login, me, cambiarPassword };