const bcrypt = require('bcryptjs');
const pool   = require('../db/connection');
const { rolesDe, tienePermiso, esAdmin } = require('../middleware/auth');
const { Permiso, codigoDe, CODIGO_POR_ID } = require('../constants/permisos');
// Compartidas con la pantalla de Roles a propósito: la derivación del código y
// la guardia de "nadie otorga un permiso que no tiene" tienen que ser las mismas
// acá que allá, o con el tiempo se separan. Ver roles.controller.
const { derivarCodigo, permisosFueraDeAlcance } = require('./roles.controller');
const { resolverEstablecimiento, establecimientoRequerido } = require('../middleware/scope');
const { generarPassword } = require('../utils/password');
const { credencialesPdfParaRespuesta } = require('../services/pdf/credenciales.pdf');
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
      `SELECT rol_id, codigo, nombre FROM ROLES
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

    // Para encabezar el documento de credenciales. Antes del commit: si esto
    // fallara después, respondería error con el usuario ya creado.
    const [[est]] = esAdminGlobal
      ? [[null]]
      : await conn.query('SELECT nombre FROM ESTABLECIMIENTO WHERE id_establecimiento = ?', [id_est]);

    await conn.commit();

    // El documento a entregar se arma acá, en el mismo request que generó la
    // clave: es la única oportunidad, no hay endpoint que la relea. Viaja
    // junto al correo y la clave (que el modal sigue mostrando en pantalla).
    // En el orden en que se pidieron, con el nombre del catálogo: el documento
    // dice "Encargado de convivencia", no "ENCARGADO".
    const rolLegible = codigos
      .map((c) => rolesRows.find((r) => r.codigo === c)?.nombre || c)
      .join(', ');

    res.status(201).json({
      id_usuario: ins.insertId,
      correo,
      nombre,
      password,
      ...credencialesPdfParaRespuesta({
        correo, nombre, password,
        establecimiento: est?.nombre,
        rol: rolLegible,
        variante: 'creacion',
      }),
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

/**
 * PUT /usuarios/:id — corregir nombre, correo y roles de una cuenta existente.
 *
 * No estrena permiso propio: editar la ficha va con `usuario.crear` (quien da
 * de alta a alguien puede corregirle el apellido mal escrito) y tocar sus roles
 * exige además `usuario.asignar_rol`, que es el mismo par de permisos que ya
 * gobierna el alta. Inventar un `usuario.editar` habría dejado a todos los
 * roles sin poder usar la pantalla hasta repartirlo a mano en ROL_PERMISOS.
 *
 * La contraseña no se toca acá: para eso está resetPassword, que emite una
 * nueva y devuelve el documento a entregar.
 */
const update = async (req, res) => {
  const { correo, roles } = req.body;
  const nombre = (req.body.nombre || '').trim();
  const codigos = Array.isArray(roles) ? roles : roles ? [roles] : [];
  const cambiaRoles = roles !== undefined;

  if (!correo || !nombre)
    return res.status(400).json({ message: 'Nombre y correo son requeridos' });
  if (cambiaRoles && codigos.length === 0)
    return res.status(400).json({ message: 'El usuario tiene que conservar al menos un rol' });
  if (cambiaRoles && !tienePermiso(req, Permiso.UsuarioAsignarRol))
    return res.status(403).json({ message: 'No tienes permiso para cambiar los roles de un usuario' });

  const prohibido = codigos.find((c) => !puedeTocarRol(req, c));
  if (prohibido)
    return res.status(403).json({ message: `No puedes asignar el rol ${prohibido}` });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // El scope se valida sobre la fila, no sobre lo que venga en el body: un
    // ADMIN acotado a un colegio no puede editar cuentas de otro.
    const [[destino]] = await conn.query(
      'SELECT id_usuario, id_establecimiento FROM USUARIO WHERE id_usuario = ?',
      [req.params.id]
    );
    if (!destino) {
      await conn.rollback();
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    const id_est = resolverEstablecimiento(req);
    if (id_est !== null && id_est !== undefined && destino.id_establecimiento !== id_est) {
      await conn.rollback();
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    let rolesRows = [];
    if (cambiaRoles) {
      // Mismo criterio que el alta: el rol tiene que ser global o del propio
      // colegio del usuario, si no se le abre acceso cruzado entre colegios.
      const [rows] = await conn.query(
        `SELECT rol_id, codigo FROM ROLES
         WHERE codigo IN (?) AND activo = TRUE
           AND (id_establecimiento IS NULL OR id_establecimiento <=> ?)`,
        [codigos, destino.id_establecimiento]
      );
      if (rows.length !== codigos.length) {
        await conn.rollback();
        const validos = rows.map((r) => r.codigo);
        return res.status(400).json({
          message: `Rol inválido: ${codigos.filter((c) => !validos.includes(c)).join(', ')}`,
        });
      }
      rolesRows = rows;

      // Los que se le quitan pasan por la misma guardia que quitarRol: nadie
      // puede dejar el sistema sin ADMIN activo por la vía de una edición.
      const [actuales] = await conn.query(
        `SELECT r.rol_id, r.codigo FROM USUARIO_ROLES ur
         JOIN ROLES r ON r.rol_id = ur.rol_id
         WHERE ur.id_usuario = ?`,
        [req.params.id]
      );
      const quitados = actuales.filter((a) => !codigos.includes(a.codigo));
      const prohibidoQuitar = quitados.find((q) => !puedeTocarRol(req, q.codigo));
      if (prohibidoQuitar) {
        await conn.rollback();
        return res.status(403).json({ message: `No puedes quitar el rol ${prohibidoQuitar.codigo}` });
      }
      if (quitados.some((q) => q.codigo === 'ADMIN')) {
        const [[{ n }]] = await conn.query(
          `SELECT COUNT(*) n FROM USUARIO_ROLES ur
           JOIN ROLES r ON r.rol_id = ur.rol_id
           JOIN USUARIO u ON u.id_usuario = ur.id_usuario AND u.activo = TRUE
           WHERE r.codigo = 'ADMIN'`
        );
        if (n <= 1) {
          await conn.rollback();
          return res.status(409).json({ message: 'No puedes quitar el último ADMIN activo del sistema' });
        }
      }

      await conn.query(
        `DELETE FROM USUARIO_ROLES WHERE id_usuario = ? AND rol_id NOT IN (?)`,
        [req.params.id, rolesRows.map((r) => r.rol_id)]
      );
      for (const r of rolesRows)
        await conn.query(
          `INSERT IGNORE INTO USUARIO_ROLES (id_usuario, rol_id, asignado_por) VALUES (?, ?, ?)`,
          [req.params.id, r.rol_id, req.user.id]
        );
    }

    // `USUARIO.rol` es la columna vieja de rol único; se mantiene alineada con
    // el primero de la lista, igual que en el alta, para no dejar dos verdades.
    await conn.query(
      `UPDATE USUARIO SET correo = ?, nombre = ?${cambiaRoles ? ', rol = ?' : ''}
       WHERE id_usuario = ?`,
      cambiaRoles
        ? [correo, nombre, codigos[0], req.params.id]
        : [correo, nombre, req.params.id]
    );

    await conn.commit();
    res.json({ message: 'Usuario actualizado' });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'El correo ya está registrado' });
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar el usuario' });
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
    const where  = id_est === null || id_est === undefined ? '' : 'AND u.id_establecimiento = ?';
    const params = where ? [req.params.id, id_est] : [req.params.id];

    const [[destino]] = await pool.query(
      `SELECT u.id_usuario, u.correo, u.nombre, e.nombre AS establecimiento_nombre
       FROM USUARIO u
       LEFT JOIN ESTABLECIMIENTO e ON e.id_establecimiento = u.id_establecimiento
       WHERE u.id_usuario = ? ${where}`, params
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
      ...credencialesPdfParaRespuesta({
        correo: destino.correo,
        nombre: destino.nombre,
        password,
        establecimiento: destino.establecimiento_nombre,
        variante: 'restablecimiento',
      }),
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

// ─── Permisos por persona ─────────────────────────────────────────────────
//
// Los roles útiles del sistema (INSPECTORIA, PSICOLOGO, ORIENTADOR…) son
// globales: los comparten todos los colegios, así que nadie salvo el ADMIN
// puede cambiarles los permisos — hacerlo se los cambiaría a todo el país.
// Eso dejaba a un encargado sin ninguna forma de decir "esta inspectora mía,
// además, exporta expedientes".
//
// USUARIO_PERMISOS es esa forma: una capa fina POR PERSONA encima del rol, con
// dos efectos posibles.
//
//   permisos efectivos = permisos del rol + concedidos - denegados
//
// Es lo que calcula la vista VW_PERMISOS_EFECTIVOS, la misma que ya leía el
// login: por eso nada aguas abajo (JWT, requirePermission, el frontend) cambia.
// La PK es (id_usuario, permiso_id), así que una persona no puede tener el
// mismo permiso concedido y denegado a la vez.
//
// Se usa con cuentagotas: si a media docena de personas hay que darles lo
// mismo, lo que corresponde es un rol propio del establecimiento, no seis
// excepciones que nadie va a recordar por qué existen. Por eso `motivo` se
// guarda junto al override.

/**
 * Localiza al usuario destino dentro del alcance de quien pregunta y verifica
 * que no sea un ADMIN. Devuelve `{ error }` con el status a responder, o
 * `{ destino }`.
 *
 * Que un no-ADMIN no pueda tocar los permisos de un ADMIN es la misma guardia
 * de resetPassword: sin ella, quien tenga usuario.asignar_permiso podría
 * DENEGARLE permisos al administrador y dejar el sistema sin quién lo gobierne.
 */
const destinoAdministrable = async (req) => {
  const id_est = resolverEstablecimiento(req);
  const where  = id_est === null || id_est === undefined ? '' : 'AND id_establecimiento = ?';
  const params = where ? [req.params.id, id_est] : [req.params.id];

  const [[destino]] = await pool.query(
    `SELECT id_usuario, correo, nombre, id_establecimiento
       FROM USUARIO WHERE id_usuario = ? ${where}`, params
  );
  if (!destino) return { error: { status: 404, message: 'Usuario no encontrado' } };

  const [rolesDestino] = await pool.query(
    `SELECT r.codigo FROM USUARIO_ROLES ur
     JOIN ROLES r ON r.rol_id = ur.rol_id
     WHERE ur.id_usuario = ?`,
    [destino.id_usuario]
  );
  if (rolesDestino.some((r) => !puedeTocarRol(req, r.codigo)))
    return { error: { status: 403, message: 'No puedes cambiar los permisos de un ADMIN' } };

  return { destino };
};

/**
 * GET /usuarios/:id/permisos — de dónde le viene cada permiso a esta persona.
 *
 * Devuelve las tres capas por separado en vez de una lista plana: la pantalla
 * tiene que poder mostrar "esto lo trae el rol" distinto de "esto se lo
 * agregamos a mano", que es justamente la información que se pierde si se
 * entrega todo mezclado.
 */
const getPermisos = async (req, res) => {
  try {
    const { error } = await destinoAdministrable(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const [heredados] = await pool.query(
      `SELECT DISTINCT rp.permiso_id, r.codigo AS rol_codigo, r.nombre AS rol_nombre
         FROM USUARIO_ROLES ur
         JOIN ROLES r         ON r.rol_id = ur.rol_id AND r.activo = TRUE
         JOIN ROL_PERMISOS rp ON rp.rol_id = ur.rol_id
        WHERE ur.id_usuario = ?
          AND (ur.expira_at IS NULL OR ur.expira_at > NOW())
        ORDER BY rp.permiso_id`,
      [req.params.id]
    );

    const [overrides] = await pool.query(
      `SELECT up.permiso_id, up.efecto, up.motivo, up.asignado_at, up.expira_at,
              a.nombre AS asignado_por_nombre
         FROM USUARIO_PERMISOS up
         LEFT JOIN USUARIO a ON a.id_usuario = up.asignado_por
        WHERE up.id_usuario = ?
        ORDER BY up.permiso_id`,
      [req.params.id]
    );

    const [efectivos] = await pool.query(
      `SELECT permiso_id FROM VW_PERMISOS_EFECTIVOS WHERE id_usuario = ?`,
      [req.params.id]
    );

    res.json({
      // Un mismo permiso puede venir de más de un rol: se agrupa para poder
      // decir "de Inspectoría, Docente" en el tooltip sin repetir la fila.
      heredados: [...heredados.reduce((m, h) => {
        const prev = m.get(h.permiso_id);
        if (prev) prev.roles.push(h.rol_nombre);
        else m.set(h.permiso_id, { permiso_id: h.permiso_id, roles: [h.rol_nombre] });
        return m;
      }, new Map()).values()],
      overrides,
      efectivos: efectivos.map((e) => e.permiso_id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los permisos del usuario' });
  }
};

/**
 * PUT /usuarios/:id/permisos — reemplaza TODOS los overrides de la persona.
 *
 * Body: `{ conceder: [ids], denegar: [ids], motivo? }`. Es un reemplazo y no un
 * parche porque la pantalla edita la lista completa: mandar altas y bajas por
 * separado obligaría al frontend a llevar el diff, y un refresh a destiempo
 * dejaría overrides fantasma que nadie pidió.
 *
 * Vale la misma regla que gobierna los roles: NADIE PUEDE OTORGAR UN PERMISO
 * QUE NO TIENE. Sin eso, cualquiera con usuario.asignar_permiso se concedería
 * a sí mismo (o a un cómplice) los 114 permisos y sería ADMIN de hecho — la
 * misma escalada que roles.controller ya bloquea del otro lado.
 */
const setPermisos = async (req, res) => {
  const conceder = [...new Set((req.body.conceder ?? []).map(Number).filter(Number.isInteger))];
  const denegar  = [...new Set((req.body.denegar  ?? []).map(Number).filter(Number.isInteger))];
  const motivo   = (req.body.motivo || '').trim() || null;

  const enAmbas = conceder.filter((id) => denegar.includes(id));
  if (enAmbas.length)
    return res.status(400).json({
      message: `No se puede conceder y denegar a la vez: ${enAmbas.map(codigoDe).join(', ')}`,
    });

  // Denegar no necesita tenerlo (quitar es siempre "hacia abajo"), pero
  // conceder sí: es exactamente el permiso que se está repartiendo.
  if (!esAdmin(req)) {
    const propios = new Set(req.user.permisos ?? []);
    const fuera = conceder.filter((id) => !propios.has(id));
    if (fuera.length)
      return res.status(403).json({
        message: `No puedes conceder permisos que no tienes: ${fuera.map(codigoDe).join(', ')}`,
      });
  }

  const conn = await pool.getConnection();
  try {
    const { error, destino } = await destinoAdministrable(req);
    // No se sueltan las conexiones a mano en los early-return: el `finally`
    // de abajo lo hace, y liberarla dos veces revienta el pool.
    if (error) return res.status(error.status).json({ message: error.message });

    // Un id inexistente reventaría con un error de FK a mitad del reemplazo,
    // cuando los overrides viejos ya se borraron. Se valida antes de tocar nada.
    const todos = [...conceder, ...denegar];
    if (todos.length) {
      const [validos] = await conn.query(
        'SELECT permiso_id FROM PERMISOS WHERE permiso_id IN (?)', [todos]
      );
      if (validos.length !== todos.length) {
        const ok = new Set(validos.map((v) => v.permiso_id));
        return res.status(400).json({
          message: `Permiso inexistente: ${todos.filter((id) => !ok.has(id)).join(', ')}`,
        });
      }
    }

    await conn.beginTransaction();
    await conn.query('DELETE FROM USUARIO_PERMISOS WHERE id_usuario = ?', [destino.id_usuario]);

    const filas = [
      ...conceder.map((id) => [destino.id_usuario, id, 'conceder', motivo, req.user.id]),
      ...denegar .map((id) => [destino.id_usuario, id, 'denegar',  motivo, req.user.id]),
    ];
    if (filas.length)
      await conn.query(
        `INSERT INTO USUARIO_PERMISOS (id_usuario, permiso_id, efecto, motivo, asignado_por)
         VALUES ?`,
        [filas]
      );

    await conn.commit();
    res.json({
      message: 'Permisos de la persona actualizados',
      concedidos: conceder.length,
      denegados:  denegar.length,
      // Los permisos viajan dentro del JWT: los que ya tienen sesión abierta
      // siguen con los de antes hasta volver a entrar. Mismo aviso que da
      // roles.controller al guardar un rol, por el mismo motivo.
      advertencia: 'Los cambios se aplican cuando la persona vuelva a iniciar sesión.',
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error(err);
    res.status(500).json({ message: 'Error al guardar los permisos de la persona' });
  } finally {
    conn.release();
  }
};

/**
 * POST /usuarios/:id/permisos/rol — convierte los permisos ajustados de una
 * persona en un ROL propio del establecimiento, que después se le puede asignar
 * a cualquier otro.
 *
 * Por qué existe además de los overrides: una excepción por persona no se
 * hereda. Si la inspectora necesita exportar expedientes, y en marzo entra otra
 * inspectora igual, con overrides hay que rehacerle la lista a mano una por
 * una. Un rol se marca en el alta y listo. Los overrides quedan para lo
 * genuinamente irrepetible ("cubre una licencia hasta noviembre").
 *
 * Qué hace, en una sola transacción:
 *   1. crea el rol acotado al establecimiento de la persona (nunca global: un
 *      rol global lo heredan todos los colegios del país),
 *   2. le carga exactamente los permisos que vinieron,
 *   3. se lo asigna a la persona REEMPLAZANDO sus roles anteriores,
 *   4. le borra los overrides.
 *
 * El paso 3 reemplaza y no suma a propósito. El rol nuevo ya contiene el
 * resultado completo que se veía en pantalla; dejarle además el rol viejo haría
 * que todo lo que se había QUITADO volviera a entrar por esa puerta, y la
 * persona terminaría con permisos que quien guardó acababa de sacarle.
 */
const guardarPermisosComoRol = async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  const descripcion = (req.body.descripcion || '').trim() || null;
  const ids = [...new Set((req.body.permisos ?? []).map(Number))];

  if (!nombre)
    return res.status(400).json({ message: 'El nombre del rol es requerido' });
  if (ids.some((id) => !Number.isInteger(id) || !CODIGO_POR_ID[id]))
    return res.status(400).json({ message: 'Hay permisos que no existen en el catálogo' });
  if (ids.length === 0)
    return res.status(400).json({ message: 'Un rol sin permisos dejaría a la persona sin poder entrar a nada' });

  // Crear un rol y asignarlo son facultades propias, con su permiso cada una:
  // llegar acá con usuario.asignar_permiso no las incluye. Se chequean adentro
  // y no en la ruta porque la ruta ya exige el permiso de la pantalla, y así el
  // mensaje puede decir cuál de los tres falta.
  if (!tienePermiso(req, Permiso.RolCrear))
    return res.status(403).json({ message: 'No tienes permiso para crear roles (rol.crear)' });
  if (!tienePermiso(req, Permiso.UsuarioAsignarRol))
    return res.status(403).json({ message: 'No tienes permiso para cambiarle el rol a un usuario (usuario.asignar_rol)' });

  // La misma guardia que gobierna los roles y los overrides: nadie reparte lo
  // que no tiene. Sin esto, "guardar como rol" sería el atajo para fabricarse
  // un rol con los 114 permisos y asignárselo.
  const negados = permisosFueraDeAlcance(req, ids);
  if (negados.length > 0)
    return res.status(403).json({
      message: `No puedes otorgar permisos que no tienes: ${negados.join(', ')}`,
    });

  const conn = await pool.getConnection();
  try {
    const { error, destino } = await destinoAdministrable(req);
    if (error) return res.status(error.status).json({ message: error.message });

    // Sin establecimiento no hay dónde acotar el rol, y crearlo global le
    // cambiaría los permisos a todos los colegios: es justo lo que esta
    // pantalla existe para evitar.
    if (destino.id_establecimiento == null)
      return res.status(400).json({
        message: 'Esta persona no pertenece a un establecimiento, así que no se le puede crear un rol propio de uno.',
      });

    const codigo = derivarCodigo(nombre);
    if (!codigo)
      return res.status(400).json({ message: 'El nombre no genera un código válido. Usá letras o números.' });
    if (codigo === 'ADMIN')
      return res.status(409).json({ message: 'El código ADMIN está reservado' });

    const [dup] = await conn.query(
      `SELECT rol_id FROM ROLES WHERE codigo = ? AND id_establecimiento = ?`,
      [codigo, destino.id_establecimiento]
    );
    if (dup.length > 0)
      return res.status(409).json({
        message: `Tu establecimiento ya tiene un rol llamado así (${codigo}). Usá otro nombre.`,
      });

    await conn.beginTransaction();

    const [rol] = await conn.query(
      `INSERT INTO ROLES (nombre, codigo, descripcion, id_establecimiento, es_sistema, activo)
       VALUES (?, ?, ?, ?, FALSE, TRUE)`,
      [nombre, codigo, descripcion, destino.id_establecimiento]
    );

    await conn.query(
      `INSERT INTO ROL_PERMISOS (rol_id, permiso_id) VALUES ?`,
      [ids.map((id) => [rol.insertId, id])]
    );

    // Reemplaza: ver el comentario de arriba sobre por qué no se suma.
    await conn.query('DELETE FROM USUARIO_ROLES WHERE id_usuario = ?', [destino.id_usuario]);
    await conn.query(
      `INSERT INTO USUARIO_ROLES (id_usuario, rol_id, asignado_por) VALUES (?, ?, ?)`,
      [destino.id_usuario, rol.insertId, req.user.id]
    );

    // Las excepciones ya no hacen falta: el rol nuevo las contiene. Dejarlas
    // sería tener el mismo permiso escrito en dos lados, y al editar el rol
    // después nadie entendería por qué la persona sigue con algo distinto.
    await conn.query('DELETE FROM USUARIO_PERMISOS WHERE id_usuario = ?', [destino.id_usuario]);

    // `USUARIO.rol` es la columna vieja de rol único; se mantiene alineada,
    // igual que en el alta y en update.
    await conn.query('UPDATE USUARIO SET rol = ? WHERE id_usuario = ?', [codigo, destino.id_usuario]);

    await conn.commit();
    res.status(201).json({
      rol_id: rol.insertId,
      codigo,
      message: `Rol "${nombre}" creado y asignado`,
      advertencia: 'Ya podés asignárselo a otras personas desde el alta o la edición de usuarios. ' +
        'Los cambios se aplican cuando cada una vuelva a iniciar sesión.',
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Ya existe un rol con ese código' });
    console.error(err);
    res.status(500).json({ message: 'Error al guardar los permisos como rol' });
  } finally {
    conn.release();
  }
};

module.exports = {
  getAll, create, update, toggleActivo, resetPassword,
  getRoles, asignarRol, quitarRol,
  getPermisos, setPermisos, guardarPermisosComoRol,
};
