const bcrypt = require('bcryptjs');
const pool   = require('../db/connection');
const { rolesDe } = require('../middleware/auth');
const { resolverEstablecimiento, establecimientoRequerido } = require('../middleware/scope');
const { generarPassword } = require('../utils/password');
const { sembrarTiposFalta } = require('../utils/sembrarTiposFalta');

// Solo un ADMIN puede otorgar o quitar el rol ADMIN. Se valida en el servidor:
// esconder la opción en el frontend no es un control de acceso.
//
// No se generaliza a "solo ADMIN toca roles con es_sistema": esa columna marca
// los roles que no se pueden renombrar, no los que son sensibles de asignar.
// Hoy la lleva únicamente ADMIN, pero atarse a ella dejaría la guardia a merced
// de un cambio de datos en vez de una regla explícita.
const puedeTocarRol = (req, codigoRol) =>
  codigoRol !== 'ADMIN' || rolesDe(req).includes('ADMIN');

const getAll = async (req, res) => {
  try {
    const id_est = resolverEstablecimiento(req);
    // null = ADMIN sin acotar: ve los usuarios de todos los establecimientos.
    // La cláusula se omite; comparar contra NULL devolvería siempre vacío.
    const where  = id_est === null || id_est === undefined ? '' : 'WHERE u.id_establecimiento = ?';
    const params = where ? [id_est] : [];

    const [rows] = await pool.query(
      `SELECT u.id_usuario, u.correo, u.nombre, u.activo, u.id_establecimiento,
              GROUP_CONCAT(r.codigo ORDER BY r.codigo) AS roles
       FROM USUARIO u
       LEFT JOIN USUARIO_ROLES ur ON ur.id_usuario = u.id_usuario
       LEFT JOIN ROLES r ON r.rol_id = ur.rol_id AND r.activo = TRUE
       ${where}
       GROUP BY u.id_usuario
       ORDER BY u.correo`,
      params
    );
    res.json(rows.map((r) => ({ ...r, roles: r.roles ? r.roles.split(',') : [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
};

const create = async (req, res) => {
  const { correo, roles } = req.body;
  const codigos = Array.isArray(roles) ? roles : roles ? [roles] : [];
  // El nombre encabeza el documento de credenciales que se entrega en mano: sin
  // él, quien reparte varias hojas seguidas solo tiene el correo para saber
  // cuál es de quién. Por eso se pide en el alta y no queda opcional.
  const nombre = (req.body.nombre || '').trim();

  if (!correo || !nombre || codigos.length === 0)
    return res.status(400).json({
      message: 'Nombre, correo y al menos un rol son requeridos',
    });

  const prohibido = codigos.find((c) => !puedeTocarRol(req, c));
  if (prohibido)
    return res.status(403).json({ message: `No puedes asignar el rol ${prohibido}` });

  const id_est = establecimientoRequerido(req);
  // Un ADMIN puede crear usuarios en cualquier colegio, pero tiene que decir en
  // cuál. Nunca insertar con NULL por omisión: el usuario quedaría sin scope.
  const esAdminGlobal = codigos.includes('ADMIN');
  if (!esAdminGlobal && (id_est === null || id_est === undefined))
    return res.status(400).json({ message: 'Falta indicar el establecimiento del usuario' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // El catálogo manda: un rol nuevo creado desde la UI tiene que poder
    // asignarse sin tocar código. Por eso no hay lista dura de roles válidos.
    // Solo roles globales o del mismo establecimiento del usuario: asignarle el
    // rol de otro colegio sería darle acceso cruzado entre establecimientos.
    const [rolesRows] = await conn.query(
      `SELECT rol_id, codigo FROM ROLES
       WHERE codigo IN (?) AND activo = TRUE
         AND (id_establecimiento IS NULL OR id_establecimiento <=> ?)`,
      [codigos, esAdminGlobal ? null : id_est]
    );
    if (rolesRows.length !== codigos.length) {
      await conn.rollback();
      const validos = rolesRows.map((r) => r.codigo);
      return res.status(400).json({
        message: `Rol inválido: ${codigos.filter((c) => !validos.includes(c)).join(', ')}`,
      });
    }

    // La clave la genera el servidor, no quien da de alta al usuario: es la
    // única forma de que sea fuerte y distinta en cada alta. Viaja en claro una
    // sola vez, en esta respuesta, para armar el documento que se entrega en
    // mano. Después queda solo el hash: no se puede recuperar, hay que
    // restablecerla.
    const password = generarPassword();
    const hash = await bcrypt.hash(password, 10);
    const [ins] = await conn.query(
      `INSERT INTO USUARIO (correo, nombre, password_hash, rol, id_establecimiento)
       VALUES (?, ?, ?, ?, ?)`,
      [correo, nombre, hash, codigos[0], esAdminGlobal ? null : id_est]
    );

    // En la misma transacción: si esto falla, el usuario no puede quedar creado
    // sin roles, porque sería un usuario que no puede hacer absolutamente nada.
    for (const r of rolesRows)
      await conn.query(
        `INSERT INTO USUARIO_ROLES (id_usuario, rol_id, asignado_por) VALUES (?, ?, ?)`,
        [ins.insertId, r.rol_id, req.user.id]
      );

    // Un colegio con usuarios es un colegio que usa el sistema: pasa a ser
    // tenant. Importa para las altas hechas desde Geo, donde se elige un
    // establecimiento del directorio nacional que todavía no lo era; sin esto
    // el usuario quedaría creado pero su colegio no aparecería en el selector
    // del ADMIN, y nadie podría entrar a operarlo.
    //
    // Desde la pantalla de Usuarios es un no-op: ahí el establecimiento ya es
    // tenant. El `AND es_tenant = FALSE` evita escribir de más.
    if (!esAdminGlobal) {
      await conn.query(
        `UPDATE ESTABLECIMIENTO SET es_tenant = TRUE
          WHERE id_establecimiento = ? AND es_tenant = FALSE`,
        [id_est]
      );

      // Igual que en el alta desde Establecimientos: sin catálogo de faltas el
      // colegio no puede registrar nada. La función es idempotente, así que
      // desde la pantalla de Usuarios (donde el colegio ya opera y tiene su
      // catálogo editado) es un no-op.
      await sembrarTiposFalta(conn, id_est);
    }

    await conn.commit();
    // El correo y la clave vuelven en la respuesta porque el frontend arma con
    // ellos el documento a entregar. Es la única oportunidad: no hay endpoint
    // que las relea.
    res.status(201).json({
      id_usuario: ins.insertId,
      correo,
      nombre,
      password,
      message: 'Usuario creado',
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'El correo ya está registrado' });
    console.error(err);
    res.status(500).json({ message: 'Error al crear usuario' });
  } finally {
    conn.release();
  }
};

const toggleActivo = async (req, res) => {
  try {
    // Nadie puede desactivarse a sí mismo: se quedaría sin poder volver a entrar.
    if (Number(req.params.id) === Number(req.user.id))
      return res.status(409).json({ message: 'No puedes desactivar tu propio usuario' });

    const id_est = resolverEstablecimiento(req);
    const where  = id_est === null || id_est === undefined ? '' : 'AND id_establecimiento = ?';
    const params = where ? [req.params.id, id_est] : [req.params.id];

    const [r] = await pool.query(
      `UPDATE USUARIO SET activo = NOT activo WHERE id_usuario = ? ${where}`, params
    );
    if (r.affectedRows === 0)
      return res.status(404).json({ message: 'Usuario no encontrado' });
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar usuario' });
  }
};

// Restablecer NO es lo mismo que cambiar la propia contraseña: acá no se pide
// la clave actual, porque justamente el caso de uso es que la persona la
// perdió. Por eso está detrás de un permiso propio y no lo puede hacer
// cualquiera que administre usuarios.
const resetPassword = async (req, res) => {
  try {
    // Sobre uno mismo no: cambiar la propia clave exige la actual
    // (/auth/cambiar-password). Permitir restablecerse a sí mismo sería un
    // atajo para saltarse esa verificación desde una sesión robada.
    if (Number(req.params.id) === Number(req.user.id))
      return res.status(409).json({
        message: 'Para cambiar tu propia contraseña usa la opción de cambiar contraseña',
      });

    // Mismo acotamiento por establecimiento que toggleActivo: un ENCARGADO no
    // puede tocarle la clave a alguien de otro colegio.
    const id_est = resolverEstablecimiento(req);
    const where  = id_est === null || id_est === undefined ? '' : 'AND id_establecimiento = ?';
    const params = where ? [req.params.id, id_est] : [req.params.id];

    const [[destino]] = await pool.query(
      `SELECT id_usuario, correo, nombre FROM USUARIO WHERE id_usuario = ? ${where}`, params
    );
    if (!destino) return res.status(404).json({ message: 'Usuario no encontrado' });

    // Solo un ADMIN le restablece la clave a otro ADMIN. Sin esta guardia,
    // cualquiera con el permiso podría tomar control de la cuenta más
    // privilegiada del sistema simplemente pidiendo un "restablecimiento".
    const [rolesDestino] = await pool.query(
      `SELECT r.codigo FROM USUARIO_ROLES ur
       JOIN ROLES r ON r.rol_id = ur.rol_id
       WHERE ur.id_usuario = ?`,
      [destino.id_usuario]
    );
    if (rolesDestino.some((r) => !puedeTocarRol(req, r.codigo)))
      return res.status(403).json({
        message: 'No puedes restablecer la contraseña de un ADMIN',
      });

    const password = generarPassword();
    await pool.query(
      `UPDATE USUARIO SET password_hash = ? WHERE id_usuario = ?`,
      [await bcrypt.hash(password, 10), destino.id_usuario]
    );

    res.json({
      id_usuario: destino.id_usuario,
      correo:     destino.correo,
      // Puede venir null en los usuarios creados antes de que existiera la
      // columna; el documento cae al correo en ese caso.
      nombre:     destino.nombre,
      password,
      message:    'Contraseña restablecida',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al restablecer la contraseña' });
  }
};

const getRoles = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.rol_id, r.codigo, r.nombre, ur.asignado_at, ur.expira_at
       FROM USUARIO_ROLES ur
       JOIN ROLES r ON r.rol_id = ur.rol_id
       WHERE ur.id_usuario = ?
       ORDER BY r.codigo`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los roles del usuario' });
  }
};

const asignarRol = async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ message: 'El código de rol es requerido' });

  if (!puedeTocarRol(req, codigo))
    return res.status(403).json({ message: 'No puedes asignar el rol ADMIN' });

  try {
    const [[destino]] = await pool.query(
      `SELECT id_establecimiento FROM USUARIO WHERE id_usuario = ?`, [req.params.id]
    );
    if (!destino) return res.status(404).json({ message: 'Usuario no encontrado' });

    // El rol tiene que ser global o del mismo colegio que el usuario: si no, se
    // le estaría dando acceso a otro establecimiento por la puerta de atrás.
    const [[rol]] = await pool.query(
      `SELECT rol_id FROM ROLES
       WHERE codigo = ? AND activo = TRUE
         AND (id_establecimiento IS NULL OR id_establecimiento <=> ?)`,
      [codigo, destino.id_establecimiento]
    );
    if (!rol)
      return res.status(404).json({
        message: 'Rol no encontrado o no disponible para el establecimiento del usuario',
      });

    await pool.query(
      `INSERT IGNORE INTO USUARIO_ROLES (id_usuario, rol_id, asignado_por) VALUES (?, ?, ?)`,
      [req.params.id, rol.rol_id, req.user.id]
    );
    res.json({ message: 'Rol asignado' });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2')
      return res.status(404).json({ message: 'Usuario no encontrado' });
    console.error(err);
    res.status(500).json({ message: 'Error al asignar el rol' });
  }
};

const quitarRol = async (req, res) => {
  try {
    const [[rol]] = await pool.query(
      `SELECT codigo FROM ROLES WHERE rol_id = ?`, [req.params.rolId]
    );
    if (!rol) return res.status(404).json({ message: 'Rol no encontrado' });

    // La guardia aplica igual al quitar: si no, cualquiera con usuario.asignar_rol
    // podría dejar el sistema sin ningún administrador.
    if (!puedeTocarRol(req, rol.codigo))
      return res.status(403).json({ message: 'No puedes quitar el rol ADMIN' });

    if (rol.codigo === 'ADMIN') {
      const [[{ n }]] = await pool.query(
        `SELECT COUNT(*) n FROM USUARIO_ROLES ur
         JOIN ROLES r ON r.rol_id = ur.rol_id
         JOIN USUARIO u ON u.id_usuario = ur.id_usuario AND u.activo = TRUE
         WHERE r.codigo = 'ADMIN'`
      );
      if (n <= 1)
        return res.status(409).json({
          message: 'No puedes quitar el último ADMIN activo del sistema',
        });
    }

    const [r] = await pool.query(
      `DELETE FROM USUARIO_ROLES WHERE id_usuario = ? AND rol_id = ?`,
      [req.params.id, req.params.rolId]
    );
    if (r.affectedRows === 0)
      return res.status(404).json({ message: 'El usuario no tiene ese rol' });
    res.json({ message: 'Rol quitado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al quitar el rol' });
  }
};

module.exports = {
  getAll, create, toggleActivo, resetPassword,
  getRoles, asignarRol, quitarRol,
};
