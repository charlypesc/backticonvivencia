const pool = require('../db/connection');
const { CODIGO_POR_ID, codigoDe } = require('../constants/permisos');
const { esAdmin } = require('../middleware/auth');

// Catálogo de roles. Con roles dinámicos, esta lista es la fuente de verdad
// para el selector de roles al crear/editar usuarios: ya no hay lista dura.
//
// Alcance: `roles.id_establecimiento = NULL` es un rol global (sirve para todos
// los colegios); con valor, es propio de ese establecimiento. Así un colegio
// puede tener su propia variante de ENCARGADO sin afectar a los demás.
//
// El rol ADMIN se le oculta a todo el que no sea ADMIN: nadie más puede
// asignarlo (lo bloquea usuarios.controller) ni editarlo, así que mostrarlo
// solo sirve para exponer de qué está hecha la cuenta más privilegiada del
// sistema. Ver también getPermisos, que niega su detalle por el mismo motivo.
const getAll = async (req, res) => {
  try {
    const est = req.id_establecimiento;
    const [rows] = await pool.query(
      `SELECT r.rol_id, r.codigo, r.nombre, r.descripcion, r.es_sistema,
              r.id_establecimiento, e.nombre AS nombre_establecimiento,
              COUNT(rp.permiso_id) AS cantidad_permisos
       FROM ROLES r
       LEFT JOIN ROL_PERMISOS rp ON rp.rol_id = r.rol_id
       LEFT JOIN ESTABLECIMIENTO e ON e.id_establecimiento = r.id_establecimiento
       WHERE r.activo = TRUE
         ${esAdmin(req) ? '' : "AND r.codigo <> 'ADMIN'"}
         AND (r.id_establecimiento IS NULL ${est == null ? '' : 'OR r.id_establecimiento = ?'})
       GROUP BY r.rol_id
       ORDER BY r.id_establecimiento IS NULL DESC, r.nombre`,
      est == null ? [] : [est]
    );

    // `editable` se calcula acá y no en el frontend: la regla de quién puede
    // tocar qué rol es la misma que aplican update() y setPermisos(), y
    // reescribirla del otro lado garantiza que las dos se vayan separando.
    // Con esto la pantalla puede opacar los roles que igual le serían negados,
    // en vez de dejar que la persona edite y choque contra un 403 al guardar.
    res.json(rows.map((r) => ({
      ...r,
      editable: puedeAdministrarRol(req, r) && r.codigo !== 'ADMIN',
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los roles' });
  }
};

// Un rol solo puede tocarse desde su propio alcance: si no, un admin parado en
// un colegio podría editar el rol de otro sin darse cuenta.
const alcanceValido = (rol, est) => rol.id_establecimiento === null || rol.id_establecimiento === est;

// ─── Delegación "aguas abajo" ──────────────────────────────────────────
//
// Definir roles dejó de ser exclusivo del ADMIN: quien tenga rol.crear puede
// hacerlo, pero solo hacia abajo. La regla es una sola y vale para todo lo de
// acá: NADIE PUEDE OTORGAR UN PERMISO QUE NO TIENE.
//
// Sin eso, cualquiera con rol.crear se fabricaría un rol con los 77 permisos,
// se lo asignaría con usuario.asignar_rol y sería ADMIN de hecho. La guardia
// que impide otorgar el rol ADMIN no serviría de nada: se escalaría por la
// puerta de al lado.
//
// El ADMIN queda exento porque ya los tiene todos por bypass.

/** Los permisos que el solicitante puede repartir. `null` = todos (ADMIN). */
const permisosOtorgables = (req) => (esAdmin(req) ? null : new Set(req.user.permisos));

/**
 * Un rol que no sea ADMIN solo puede administrar roles de SU establecimiento.
 *
 * Los roles globales (id_establecimiento = NULL) quedan fuera: los comparten
 * todos los colegios, y dejar que un encargado los edite le daría alcance sobre
 * establecimientos que no son el suyo. Puede verlos y asignarlos, no cambiarlos.
 */
const puedeAdministrarRol = (req, rol) =>
  esAdmin(req)
    ? alcanceValido(rol, req.id_establecimiento)
    : rol.id_establecimiento !== null && rol.id_establecimiento === req.id_establecimiento;

/**
 * Verifica que todos los ids estén dentro de lo que el solicitante puede
 * otorgar. Devuelve los códigos que se le negarían, o [] si está todo bien.
 */
const permisosFueraDeAlcance = (req, ids) => {
  const propios = permisosOtorgables(req);
  if (propios === null) return [];
  return ids.filter((id) => !propios.has(id)).map(codigoDe);
};

const getPermisos = async (req, res) => {
  try {
    const [[rol]] = await pool.query(
      `SELECT codigo, id_establecimiento FROM ROLES WHERE rol_id = ?`, [req.params.id]);
    if (!rol) return res.status(404).json({ message: 'Rol no encontrado' });
    if (!alcanceValido(rol, req.id_establecimiento))
      return res.status(403).json({ message: 'Ese rol pertenece a otro establecimiento' });

    // El detalle del ADMIN es solo para el ADMIN. Se responde 404 y no 403
    // porque para quien no es ADMIN ese rol directamente no existe: getAll ya
    // no se lo lista, y un 403 acá le confirmaría el id que el listado le oculta.
    if (rol.codigo === 'ADMIN' && !esAdmin(req))
      return res.status(404).json({ message: 'Rol no encontrado' });

    const [rows] = await pool.query(
      `SELECT p.permiso_id, p.codigo, p.recurso, p.accion, p.descripcion
       FROM ROL_PERMISOS rp
       JOIN PERMISOS p ON p.permiso_id = rp.permiso_id
       WHERE rp.rol_id = ?
       ORDER BY p.recurso, p.accion`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los permisos del rol' });
  }
};

// Catálogo de permisos disponibles, para armar la pantalla de configuración de
// un rol.
//
// A quien no es ADMIN se le recortan los que no tiene: son permisos que el
// backend le rechazaría igual al guardar, y mostrárselos solo sirve para que
// marque casilleros que después no se guardan.
const getCatalogoPermisos = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT permiso_id, codigo, recurso, accion, descripcion
       FROM PERMISOS ORDER BY recurso, accion`
    );
    const propios = permisosOtorgables(req);
    res.json(propios === null ? rows : rows.filter((p) => propios.has(p.permiso_id)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el catálogo de permisos' });
  }
};

// Deriva el código a partir del nombre: "Psicólogo de turno" -> PSICOLOGO_DE_TURNO.
// Quita tildes (el código se compara en el backend y viaja en el token: una tilde
// ahí es una fuente de bugs silenciosos el día que alguien lo escriba sin ella).
const derivarCodigo = (nombre) =>
  String(nombre)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

const create = async (req, res) => {
  const { nombre, codigo, descripcion, ambito } = req.body;
  if (!nombre)
    return res.status(400).json({ message: 'El nombre es requerido' });

  // El código es opcional: si no viene, se deduce del nombre.
  const cod = codigo ? String(codigo).trim().toUpperCase() : derivarCodigo(nombre);
  if (!cod)
    return res.status(400).json({
      message: 'No se pudo generar un código a partir del nombre. Indicá uno a mano.',
    });
  if (cod === 'ADMIN')
    return res.status(409).json({ message: 'El código ADMIN está reservado' });

  // 'global' = sirve para todos los colegios; 'establecimiento' = solo para el
  // que está seleccionado, y sus permisos se pueden cambiar sin afectar al resto.
  //
  // Solo el ADMIN crea roles globales: un rol global lo heredan todos los
  // colegios, así que dejarlo en manos de un encargado le daría efecto fuera
  // del suyo. Se ignora el `ambito` que venga del cliente en vez de responder
  // 403, porque el rol acotado es lo que quiso crear de todas formas.
  const esGlobal = esAdmin(req) && ambito !== 'establecimiento';
  const est = esGlobal ? null : req.id_establecimiento;
  if (!esGlobal && est == null)
    return res.status(400).json({
      message: 'Para crear un rol de establecimiento hay que indicar cuál (?id_establecimiento=)',
    });

  try {
    // MySQL considera cada NULL distinto en un UNIQUE, así que el índice
    // (codigo, id_establecimiento) NO impide dos roles globales con el mismo
    // código. Ese caso se valida acá a mano.
    const [dup] = await pool.query(
      `SELECT rol_id FROM ROLES WHERE codigo = ? AND ${est == null ? 'id_establecimiento IS NULL' : 'id_establecimiento = ?'}`,
      est == null ? [cod] : [cod, est]
    );
    if (dup.length > 0) {
      const donde = esGlobal ? 'un rol global' : 'un rol en este establecimiento';
      return res.status(409).json({
        message: codigo
          ? `Ya existe ${donde} con el código ${cod}`
          : `Ya existe ${donde} con el código ${cod} (generado a partir del nombre). Usá otro nombre o indicá un código distinto.`,
      });
    }

    // es_sistema = FALSE: los roles creados desde la UI sí se pueden editar y
    // borrar, a diferencia de los que vinieron del enum original.
    const [r] = await pool.query(
      `INSERT INTO ROLES (nombre, codigo, descripcion, id_establecimiento, es_sistema, activo)
       VALUES (?, ?, ?, ?, FALSE, TRUE)`,
      [nombre, cod, descripcion || null, est]
    );
    res.status(201).json({ rol_id: r.insertId, message: 'Rol creado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Ya existe un rol con ese código' });
    console.error(err);
    res.status(500).json({ message: 'Error al crear el rol' });
  }
};

const update = async (req, res) => {
  const { nombre, descripcion } = req.body;
  if (!nombre) return res.status(400).json({ message: 'El nombre es requerido' });

  try {
    const [[rol]] = await pool.query(
      `SELECT es_sistema, id_establecimiento FROM ROLES WHERE rol_id = ?`, [req.params.id]);
    if (!rol) return res.status(404).json({ message: 'Rol no encontrado' });
    if (!puedeAdministrarRol(req, rol))
      return res.status(403).json({
        message: esAdmin(req)
          ? 'Ese rol pertenece a otro establecimiento'
          : 'Solo puedes editar los roles propios de tu establecimiento',
      });
    if (rol.es_sistema)
      return res.status(409).json({ message: 'Los roles de sistema no se pueden editar' });

    await pool.query(`UPDATE ROLES SET nombre = ?, descripcion = ? WHERE rol_id = ?`,
      [nombre, descripcion || null, req.params.id]);
    res.json({ message: 'Rol actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar el rol' });
  }
};

// Reemplaza el set completo de permisos del rol.
//
// Acá llega cualquiera con rol.asignar_permiso, no solo el ADMIN. Lo que impide
// que eso sea una escalada es la regla "aguas abajo": solo se pueden otorgar
// permisos que el solicitante ya tiene (ver permisosFueraDeAlcance arriba).
const setPermisos = async (req, res) => {
  const { permisos } = req.body;
  if (!Array.isArray(permisos))
    return res.status(400).json({ message: 'Se espera un array de ids de permiso' });

  // Los ids se validan contra el catálogo antes de tocar la tabla. Sin esto,
  // un id inexistente se descartaría solo (el INSERT ... SELECT no encuentra
  // fila) y el rol quedaría con menos permisos de los que la UI muestra como
  // guardados, sin ningún error.
  const ids = permisos.map(Number);
  const invalidos = ids.filter((id) => !Number.isInteger(id) || !CODIGO_POR_ID[id]);
  if (invalidos.length > 0)
    return res.status(400).json({
      message: `Estos permisos no existen: ${invalidos.join(', ')}`,
    });

  const conn = await pool.getConnection();
  try {
    const [[rol]] = await conn.query(
      `SELECT codigo, id_establecimiento FROM ROLES WHERE rol_id = ?`, [req.params.id]);
    if (!rol) { conn.release(); return res.status(404).json({ message: 'Rol no encontrado' }); }
    if (!puedeAdministrarRol(req, rol)) {
      conn.release();
      return res.status(403).json({
        message: esAdmin(req)
          ? 'Ese rol pertenece a otro establecimiento'
          : 'Solo puedes configurar los roles propios de tu establecimiento',
      });
    }
    if (rol.codigo === 'ADMIN') {
      conn.release();
      return res.status(409).json({ message: 'Los permisos del ADMIN no se editan' });
    }

    // Aguas abajo, al otorgar: nadie da lo que no tiene.
    const negados = permisosFueraDeAlcance(req, ids);
    if (negados.length > 0) {
      conn.release();
      return res.status(403).json({
        message: `No puedes otorgar permisos que no tienes: ${negados.join(', ')}`,
      });
    }

    // Aguas abajo, al quitar: este endpoint reemplaza el set completo, así que
    // guardar un rol que ya tenía permisos fuera del alcance del solicitante se
    // los borraría sin que él los haya visto siquiera (el catálogo se los
    // recorta). Se bloquea en vez de degradar el rol en silencio.
    const [actuales] = await conn.query(
      `SELECT permiso_id FROM ROL_PERMISOS WHERE rol_id = ?`, [req.params.id]);
    const invisibles = permisosFueraDeAlcance(req, actuales.map((r) => r.permiso_id));
    if (invisibles.length > 0) {
      conn.release();
      return res.status(403).json({
        message:
          `Ese rol tiene permisos que vos no tenés (${invisibles.join(', ')}), ` +
          'así que no podés reconfigurarlo. Pedíselo a un administrador.',
      });
    }

    await conn.beginTransaction();
    await conn.query(`DELETE FROM ROL_PERMISOS WHERE rol_id = ?`, [req.params.id]);
    if (ids.length > 0)
      await conn.query(
        `INSERT INTO ROL_PERMISOS (rol_id, permiso_id) VALUES ?`,
        [ids.map((id) => [req.params.id, id])]
      );
    await conn.commit();

    // Los permisos viajan dentro del JWT: este cambio no afecta a las sesiones
    // ya abiertas hasta que el token expire y el usuario vuelva a entrar.
    res.json({
      message: 'Permisos actualizados',
      advertencia: 'Los usuarios con sesión abierta mantienen sus permisos anteriores hasta volver a iniciar sesión',
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar los permisos' });
  } finally {
    conn.release();
  }
};

module.exports = { getAll, getPermisos, getCatalogoPermisos, create, update, setPermisos };
