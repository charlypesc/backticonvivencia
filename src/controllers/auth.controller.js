const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../db/connection');

const login = async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password)
    return res.status(400).json({ message: 'Correo y contraseña requeridos' });

  try {
    const [rows] = await pool.query(
      `SELECT u.*, e.nombre AS nombre_establecimiento, e.rbd, e.acceso_bloqueado
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
      `SELECT r.codigo, r.nombre
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

    // Establecimiento con el acceso suspendido (se activa desde Geo): nadie de
    // ese colegio entra, aunque su usuario siga activo y la clave sea correcta.
    // No borra ni desactiva nada — al desbloquearlo vuelven a entrar tal cual
    // estaban. El ADMIN queda exento: es global y tiene que poder seguir
    // administrando (y desbloqueando) ese establecimiento.
    if (usuario.acceso_bloqueado && !esAdmin)
      return res.status(403).json({
        message: 'El acceso de este establecimiento está suspendido. Contacte al administrador.',
      });

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
        // Mientras sea true, verifyToken solo deja cambiar la contraseña: la
        // clave actual es temporal y la conoce quien la entregó.
        debe_cambiar_password: Boolean(usuario.debe_cambiar_password),
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      usuario: {
        id:                   usuario.id_usuario,
        correo:               usuario.correo,
        // El nombre encabeza el saludo del navbar; puede venir null en cuentas
        // creadas antes de que el alta lo pidiera, y ahí se cae al correo.
        nombre:               usuario.nombre,
        rol:                  roles[0] ?? usuario.rol,
        // El nombre del rol, no su código: es el cargo que se imprime bajo la
        // firma del acta de notificación. Va sólo en la respuesta y no en el
        // token — es un texto editable que quedaría congelado hasta el próximo
        // login, igual que el nombre de la persona.
        rol_nombre:           rolesRows[0]?.nombre ?? null,
        roles,
        permisos,
        // El ADMIN pasa por bypass en el backend, así que su lista de permisos
        // viaja vacía. El frontend usa esta bandera para no ocultarle nada.
        es_admin:             esAdmin,
        id_establecimiento:   usuario.id_establecimiento,
        nombre_establecimiento: usuario.nombre_establecimiento,
        // El RBD identifica al colegio ante el Mineduc: va junto al nombre en
        // el navbar para saber sin dudar en cuál se está trabajando.
        rbd_establecimiento:  usuario.rbd,
        debe_cambiar_password: Boolean(usuario.debe_cambiar_password),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error del servidor' });
  }
};

/**
 * Los datos de la sesión, con lo que no viaja en el token.
 *
 * El JWT lleva id, roles y permisos, pero no el nombre de la persona ni el de su
 * establecimiento: son textos que además pueden cambiar (se corrige el apellido
 * mal escrito) y quedarían congelados hasta el próximo login. Se leen de la base
 * en cada llamada, que es una consulta por arranque de la app.
 */
const me = async (req, res) => {
  try {
    const [[fila]] = await pool.query(
      `SELECT u.nombre, u.correo, u.id_establecimiento,
              e.nombre AS nombre_establecimiento, e.rbd,
              -- El cargo se lee acá y no del token por lo mismo que el nombre:
              -- es un texto que puede corregirse y se imprime en el acta de
              -- notificación. Se resuelve por los roles vigentes del usuario y
              -- no por un JOIN sobre ROLES.codigo, que no es único entre
              -- establecimientos y multiplicaría la fila.
              (SELECT r.nombre
                 FROM USUARIO_ROLES ur
                 JOIN ROLES r ON r.rol_id = ur.rol_id AND r.activo = TRUE
                WHERE ur.id_usuario = u.id_usuario
                  AND r.codigo = ?
                  AND (ur.expira_at IS NULL OR ur.expira_at > NOW())
                LIMIT 1) AS rol_nombre
       FROM USUARIO u
       LEFT JOIN ESTABLECIMIENTO e ON e.id_establecimiento = u.id_establecimiento
       WHERE u.id_usuario = ?`,
      [req.user.rol ?? null, req.user.id]
    );
    res.json({
      usuario: {
        ...req.user,
        // Si la cuenta se borró entremedio, al menos vuelve lo del token.
        ...(fila ?? {}),
        rbd_establecimiento: fila?.rbd ?? null,
      },
    });
  } catch (err) {
    console.error(err);
    res.json({ usuario: req.user });
  }
};

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
      `UPDATE USUARIO SET password_hash = ?, debe_cambiar_password = 0 WHERE id_usuario = ?`,
      [await bcrypt.hash(nueva, 10), usuario.id_usuario]
    );

    // Si venía con clave temporal, su token la trae marcada y verifyToken le
    // bloquea todo lo demás: se le emite uno nuevo sin la marca, con los mismos
    // datos, para que siga trabajando sin volver a iniciar sesión.
    let token;
    if (req.user.debe_cambiar_password) {
      const { iat, exp, ...payload } = req.user;
      token = jwt.sign(
        { ...payload, debe_cambiar_password: false },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );
    }

    // El token sigue siendo válido hasta que expire: no hay lista de revocación.
    // Cerrar sesión en el resto de los dispositivos exigiría versionar el token,
    // que es un cambio bastante más grande que este.
    res.json({ message: 'Contraseña actualizada', ...(token ? { token } : {}) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al cambiar la contraseña' });
  }
};

module.exports = { login, me, cambiarPassword };