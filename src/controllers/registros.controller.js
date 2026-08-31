const pool = require('../db/connection');
const { tienePermiso } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');
const {
  puedeVerConfidencial,
  puedeEditarConfidencialidad,
  reducirSiConfidencial,
} = require('../utils/confidencial');
const { ROLES_INVOLUCRADO } = require('../utils/flujoProtocolo');
const { COLUMNAS_ESTADO_PROTOCOLO } = require('../utils/sqlProtocolos');

// El id_tipo_falta llega en el body, no del scope: hay que confirmar que ese
// tipo de falta sea del mismo establecimiento en que se está guardando el
// registro. TIPO_FALTA es por establecimiento, así que un ID ajeno deja el
// registro apuntando al catálogo de otro colegio — el listado lo muestra igual,
// porque filtra los registros por establecimiento pero hace el JOIN a
// TIPO_FALTA sin filtrar.
//
// El caso realista no es un ataque sino el ADMIN que cambia de establecimiento
// con el formulario abierto: el <select> conserva los IDs del colegio anterior
// y esos IDs también existen en el nuevo, apuntando a otra falta distinta.
//
// Recibe el ejecutor de consultas (pool o conexión) para poder validar dentro
// de la transacción que ya abrió el llamador.
const tipoFaltaValido = async (db, id_tipo_falta, id_establecimiento) => {
  const [[fila]] = await db.query(
    `SELECT 1 AS ok FROM TIPO_FALTA
      WHERE id_tipo_falta = ? AND id_establecimiento = ?`,
    [id_tipo_falta, id_establecimiento]
  );
  return !!fila;
};

const MSG_TIPO_FALTA_INVALIDO =
  'El tipo de falta indicado no pertenece al establecimiento del registro';

// El rol viaja hasta un enum de MySQL, y con STRICT_ALL_TABLES un valor fuera
// de la lista revienta el INSERT: sin esta comprobación el cliente recibe un
// 500 genérico y el motivo real se queda en la consola del servidor. Se valida
// contra la misma constante que usa el motor de protocolos para que las dos
// listas no puedan separarse.
const rolInvolucradoInvalido = (estudiantes) => {
  if (!Array.isArray(estudiantes)) return null;
  for (const e of estudiantes) {
    const rol = e?.rol_en_incidente;
    if (rol !== undefined && rol !== null && !ROLES_INVOLUCRADO.includes(rol))
      return `'${rol}' no es un rol válido para un estudiante del registro. ` +
             `Debe ser uno de: ${ROLES_INVOLUCRADO.join(', ')}.`;
  }
  return null;
};

// Protocolos que el tipo de falta del registro obliga a activar y que todavía
// no se activaron (Ley 21.809).
//
// Se calcula con un LEFT JOIN y no se guarda en una columna: una bandera
// denormalizada quedaría desincronizada apenas alguien active o anule un
// protocolo por otra vía, y el estado real siempre es esta consulta.
//
// Un protocolo anulado NO cuenta como activado: el caso quedó sin tramitar.
const protocolosObligatoriosPendientes = async (db, id_registro) => {
  const [filas] = await db.query(
    `SELECT tfp.id_protocolo_establecimiento,
            COALESCE(pe.nombre, cp.nombre) AS protocolo_nombre
     FROM REGISTRO_CONVIVENCIA r
     JOIN TIPO_FALTA_PROTOCOLO tfp
       ON tfp.id_tipo_falta = r.id_tipo_falta AND tfp.obligatorio = 1
     JOIN PROTOCOLO_ESTABLECIMIENTO pe
       ON pe.id_protocolo_establecimiento = tfp.id_protocolo_establecimiento
     LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON cp.id_protocolo = pe.id_protocolo
     LEFT JOIN PROTOCOLO_ACTIVADO pa
       ON pa.id_registro = r.id_registro
      AND pa.id_protocolo_establecimiento = tfp.id_protocolo_establecimiento
      AND pa.estado <> 'anulado'
     WHERE r.id_registro = ? AND pa.id_protocolo_activado IS NULL`,
    [id_registro]
  );
  return filas;
};

// GET /api/registros
// Quien tenga registro.ver_todos ve todos; el resto, solo los suyos
const getAll = async (req, res) => {
  try {
    let query = `
      SELECT r.*,
        tf.nombre  AS tipo_falta_nombre,
        tf.gravedad,
        ${COLUMNAS_ESTADO_PROTOCOLO},
        u.correo   AS encargado_correo,
        um.correo  AS editor_correo,
        -- Los involucrados se listan también en los registros confidenciales
        -- (ver reducirSiConfidencial), por eso van en la consulta general.
        -- GROUP_CONCAT + GROUP BY para no multiplicar la fila del registro por
        -- cada estudiante involucrado.
        GROUP_CONCAT(DISTINCT CONCAT(e.nombre, ' ', e.apellido)
                     ORDER BY e.nombre SEPARATOR ', ') AS alumno_nombre
      FROM REGISTRO_CONVIVENCIA r
      JOIN TIPO_FALTA tf ON r.id_tipo_falta = tf.id_tipo_falta
      JOIN USUARIO    u  ON r.id_usuario    = u.id_usuario
      -- LEFT: un registro nunca editado no tiene id_usuario_modificacion
      LEFT JOIN USUARIO um ON r.id_usuario_modificacion = um.id_usuario
      LEFT JOIN REGISTRO_ESTUDIANTE re ON r.id_registro = re.id_registro
      LEFT JOIN ESTUDIANTE e ON re.id_estudiante = e.id_estudiante
      -- El tenant sale de la columna propia del registro, no del autor. Cuando
      -- se derivaba del autor (u.id_establecimiento), todo registro creado por
      -- un ADMIN — que es global y tiene id_establecimiento NULL — quedaba
      -- invisible en la lista, y la persona lo volvía a crear creyendo que no
      -- se había guardado.
      WHERE r.id_establecimiento = ?
    `;
    const params = [req.id_establecimiento];

    // Antes esto era `rol === 'ENCARGADO'`, un chequeo restrictivo. Con
    // multi-rol, traducirlo literal habría restringido a quien tuviera
    // ENCARGADO *y* DIRECTOR, al revés de lo que se espera. Y con roles
    // dinámicos, listar roles obligaría a editar este archivo por cada rol
    // nuevo que deba ver todo: por eso va por permiso.
    if (!tienePermiso(req, Permiso.RegistroVerTodos)) {
      query += ' AND r.id_usuario = ?';
      params.push(req.user.id);
    }

    query += ' GROUP BY r.id_registro ORDER BY r.fecha_creacion DESC';

    const [rows] = await pool.query(query, params);
    res.json(rows.map((r) => reducirSiConfidencial(req, r)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener registros' });
  }
};

// GET /api/registros/:id — incluye estudiantes involucrados
const getById = async (req, res) => {
  try {
    const [[registro]] = await pool.query(
      `SELECT r.*,
        tf.nombre AS tipo_falta_nombre, tf.gravedad, tf.medida_sugerida,
        u.correo AS autor_correo,
        um.correo AS editor_correo
       FROM REGISTRO_CONVIVENCIA r
       JOIN TIPO_FALTA tf ON r.id_tipo_falta = tf.id_tipo_falta
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       LEFT JOIN USUARIO um ON r.id_usuario_modificacion = um.id_usuario
       WHERE r.id_registro = ?`,
      [req.params.id]
    );

    // 404 y no 403 si es de otro colegio: quien pregunta no tiene por qué
    // enterarse de que el registro existe.
    if (!registro || registro.id_establecimiento !== req.id_establecimiento)
      return res.status(404).json({ message: 'Registro no encontrado' });

    const [estudiantes] = await pool.query(
      `SELECT e.id_estudiante, e.nombre, e.apellido, e.run, e.dv,
              re.rol_en_incidente
       FROM REGISTRO_ESTUDIANTE re
       JOIN ESTUDIANTE e ON re.id_estudiante = e.id_estudiante
       WHERE re.id_registro = ?`,
      [req.params.id]
    );

    // El 403 va después de traer los involucrados: quien no puede leer el caso
    // igual necesita ver a quiénes involucra (y a quién pedirle acceso). Lo
    // reservado es el contenido del registro, no la lista de estudiantes.
    if (registro.es_confidencial && !puedeVerConfidencial(req, registro))
      return res.status(403).json({
        message: 'Este registro es confidencial',
        nota_confidencial: registro.nota_confidencial,
        autor_correo: registro.autor_correo,
        fecha_creacion: registro.fecha_creacion,
        editor_correo: registro.editor_correo,
        fecha_modificacion: registro.fecha_modificacion,
        estudiantes,
      });

    // La ficha los lista con nombre (no solo el conteo, como el listado): es
    // acá donde la persona tiene que poder ver cuál le falta activar.
    const protocolos_pendientes = await protocolosObligatoriosPendientes(pool, req.params.id);

    res.json({
      ...registro,
      estudiantes,
      protocolos_pendientes,
      puede_editar_confidencialidad: puedeEditarConfidencialidad(req, registro),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error del servidor' });
  }
};

// POST /api/registros — Solo ENCARGADO
const create = async (req, res) => {
  const { fecha_incidente, asunto, antecedentes, acuerdos, id_tipo_falta, estudiantes,
          es_confidencial, nota_confidencial } = req.body;

  if (!fecha_incidente || !asunto || !antecedentes || !id_tipo_falta)
    return res.status(400).json({ message: 'Faltan campos obligatorios' });

  if (es_confidencial && !nota_confidencial?.trim())
    return res.status(400).json({ message: 'Debes indicar la nota de confidencialidad' });

  const rolInvalido = rolInvolucradoInvalido(estudiantes);
  if (rolInvalido) return res.status(400).json({ message: rolInvalido });

  const hayEstudiantes = Array.isArray(estudiantes) && estudiantes.length > 0;

  // El alta y la validación del tipo de falta van en una sola consulta. El
  // `WHERE EXISTS` inserta la fila solo si la falta pertenece al
  // establecimiento — la misma garantía que daba el SELECT aparte, porque se
  // evalúa en el mismo statement — pero sin una segunda ida y vuelta a la
  // base. La base es remota (Aiven): cada consulta cuesta ~150 ms de red se
  // haga lo que se haga, así que los viajes son el costo real del guardado, no
  // el trabajo del motor. `affectedRows === 0` significa que el EXISTS no se
  // cumplió: tipo de falta inexistente o de otro establecimiento.
  //
  // El establecimiento se guarda en el registro: derivarlo del autor deja
  // huérfano todo lo que cree un ADMIN (id_establecimiento NULL).
  const sqlRegistro = `
    INSERT INTO REGISTRO_CONVIVENCIA
      (fecha_incidente, asunto, antecedentes, acuerdos, id_tipo_falta, id_usuario,
       id_establecimiento, es_confidencial, nota_confidencial)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM DUAL
     WHERE EXISTS (SELECT 1 FROM TIPO_FALTA
                    WHERE id_tipo_falta = ? AND id_establecimiento = ?)`;
  const paramsRegistro = [
    fecha_incidente, asunto, antecedentes, acuerdos || null, id_tipo_falta, req.user.id,
    req.id_establecimiento,
    !!es_confidencial, es_confidencial ? nota_confidencial.trim() : null,
    id_tipo_falta, req.id_establecimiento,
  ];

  // Sin estudiantes involucrados el alta es una sola consulta, y una consulta
  // suelta ya es atómica: envolverla en una transacción eran dos viajes más
  // (BEGIN y COMMIT) sin ninguna garantía extra a cambio.
  if (!hayEstudiantes) {
    try {
      const [result] = await pool.query(sqlRegistro, paramsRegistro);
      if (result.affectedRows === 0)
        return res.status(400).json({ message: MSG_TIPO_FALTA_INVALIDO });
      return res
        .status(201)
        .json({ id_registro: result.insertId, message: 'Registro creado exitosamente' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Error al crear registro' });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(sqlRegistro, paramsRegistro);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(400).json({ message: MSG_TIPO_FALTA_INVALIDO });
    }

    const id_registro = result.insertId;

    const values = estudiantes.map(e => [id_registro, e.id_estudiante, e.rol_en_incidente]);
    await conn.query(
      'INSERT INTO REGISTRO_ESTUDIANTE (id_registro, id_estudiante, rol_en_incidente) VALUES ?',
      [values]
    );

    await conn.commit();
    res.status(201).json({ id_registro, message: 'Registro creado exitosamente' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al crear registro' });
  } finally {
    conn.release();
  }
};

// PATCH /api/registros/:id/validar — Solo DIRECTOR
const validar = async (req, res) => {
  try {
    // El corte está acá y no al crear el registro, a propósito. Bloquear la
    // creación rompería la captura rápida del hecho (y la activación es un
    // endpoint aparte que puede fallar por su cuenta), mientras que validar es
    // el acto por el que el director hace suyo el caso: es el momento en que
    // corresponde exigir que el protocolo que la falta obliga esté activado.
    const pendientes = await protocolosObligatoriosPendientes(pool, req.params.id);
    if (pendientes.length > 0)
      return res.status(409).json({
        message:
          'No se puede validar: el tipo de falta obliga a activar un protocolo que todavía no fue activado',
        protocolos_pendientes: pendientes,
      });

    await pool.query(
      // Validar también es tocar el registro: si no se anotara acá, un registro
      // validado por el director seguiría mostrando solo al autor original.
      `UPDATE REGISTRO_CONVIVENCIA
       SET estado_validacion = 'validado',
           fecha_modificacion = CURRENT_TIMESTAMP, id_usuario_modificacion = ?
       WHERE id_registro = ?`,
      [req.user.id, req.params.id]
    );
    res.json({ message: 'Registro validado' });
  } catch (err) {
    res.status(500).json({ message: 'Error al validar' });
  }
};

// PUT /api/registros/:id — ENCARGADO o DIRECTOR
const update = async (req, res) => {
  const { fecha_incidente, asunto, antecedentes, acuerdos, id_tipo_falta, estudiantes,
          es_confidencial, nota_confidencial } = req.body;

  if (!fecha_incidente || !asunto || !antecedentes || !id_tipo_falta)
    return res.status(400).json({ message: 'Faltan campos obligatorios' });

  // Quien no puede tocar la confidencialidad conserva la que ya tenía el
  // registro, mande lo que mande en el body: el front le deshabilita el check,
  // pero la decisión no puede depender de que el front se porte bien. Un body
  // sin el campo tampoco desmarca por omisión (clientes viejos).
  const actual = req.registroActual;
  const puedeTocar = puedeEditarConfidencialidad(req, actual);
  const confidencial = puedeTocar && es_confidencial !== undefined
    ? !!es_confidencial
    : !!actual.es_confidencial;
  const nota = puedeTocar && es_confidencial !== undefined
    ? (confidencial ? nota_confidencial?.trim() : null)
    : actual.nota_confidencial;

  if (confidencial && !nota)
    return res.status(400).json({ message: 'Debes indicar la nota de confidencialidad' });

  const rolInvalido = rolInvolucradoInvalido(estudiantes);
  if (rolInvalido) return res.status(400).json({ message: rolInvalido });

  const conn = await pool.getConnection();
  try {
    // El BEGIN y la validación del tipo de falta no dependen uno del otro:
    // antes iban en fila y eran dos viajes a una base remota (~150 ms cada
    // uno), ahora se superponen. La validación va por el pool y no por `conn`
    // justamente para poder correr en paralelo; se pierde leerla dentro de la
    // transacción, que acá no aporta nada: es un SELECT sobre una fila que
    // esta transacción no escribe, y la FK impide que otro proceso borre un
    // TIPO_FALTA en uso mientras tanto. Las dos promesas se esperan antes de
    // tocar ninguna fila, así que una falta inválida sigue sin escribir nada.
    const [, faltaValida] = await Promise.all([
      conn.beginTransaction(),
      // bloquearEscrituraConfidencial ya garantizó que el registro es de
      // req.id_establecimiento, así que validar contra el scope equivale a
      // validar contra el establecimiento del propio registro.
      tipoFaltaValido(pool, id_tipo_falta, req.id_establecimiento),
    ]);

    if (!faltaValida) {
      await conn.rollback();
      return res.status(400).json({ message: MSG_TIPO_FALTA_INVALIDO });
    }

    const [result] = await conn.query(
      // fecha_modificacion se escribe explícita aunque la columna tenga
      // ON UPDATE CURRENT_TIMESTAMP: MySQL no dispara el ON UPDATE si ninguna
      // columna cambió de valor, y una edición que solo toca los estudiantes
      // involucrados (otra tabla) quedaría sin fecha.
      `UPDATE REGISTRO_CONVIVENCIA
       SET fecha_incidente = ?, asunto = ?, antecedentes = ?, acuerdos = ?, id_tipo_falta = ?,
           es_confidencial = ?, nota_confidencial = ?,
           fecha_modificacion = CURRENT_TIMESTAMP, id_usuario_modificacion = ?
       WHERE id_registro = ?`,
      [fecha_incidente, asunto, antecedentes, acuerdos || null, id_tipo_falta,
       confidencial, nota, req.user.id, req.params.id]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Registro no encontrado' });
    }

    await conn.query('DELETE FROM REGISTRO_ESTUDIANTE WHERE id_registro = ?', [req.params.id]);

    if (Array.isArray(estudiantes) && estudiantes.length > 0) {
      const values = estudiantes.map(e => [req.params.id, e.id_estudiante, e.rol_en_incidente]);
      await conn.query(
        'INSERT INTO REGISTRO_ESTUDIANTE (id_registro, id_estudiante, rol_en_incidente) VALUES ?',
        [values]
      );
    }

    await conn.commit();
    res.json({ message: 'Registro actualizado exitosamente' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar registro' });
  } finally {
    conn.release();
  }
};

// DELETE /api/registros/:id —
const remove = async (req, res) => {
  try {

        await pool.query(
      `DELETE FROM REGISTRO_ESTUDIANTE WHERE id_registro = ?`,
      [req.params.id]
    );

    await pool.query(
      `DELETE FROM DOCUMENTO_DIGITALIZADO WHERE id_registro = ?`,
      [req.params.id]
    );

    const [result] = await pool.query(
      `DELETE FROM REGISTRO_CONVIVENCIA WHERE id_registro = ?`,
      [req.params.id]
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Registro no encontrado' });

    res.json({ message: 'Registro eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar registro' });
  }
};
const confirmar = async (req, res) => {
  const { fecha_incidente, asunto, antecedentes, acuerdos, id_tipo_falta } = req.body;
  try {
    if (!(await tipoFaltaValido(pool, id_tipo_falta, req.id_establecimiento)))
      return res.status(400).json({ message: MSG_TIPO_FALTA_INVALIDO });

    await pool.query(
      `UPDATE REGISTRO_CONVIVENCIA
       SET fecha_incidente=?, asunto=?, antecedentes=?, acuerdos=?,
           id_tipo_falta=?, estado_validacion='validado'
       WHERE id_registro=?`,
      [fecha_incidente, asunto, antecedentes, acuerdos, id_tipo_falta, req.params.id]
    );
    res.json({ message: 'Registro confirmado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al confirmar' });
  }
};

module.exports = { getAll, getById, create, validar, update, remove, confirmar };