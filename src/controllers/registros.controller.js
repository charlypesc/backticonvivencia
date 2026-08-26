const pool = require('../db/connection');
const { tienePermiso } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');
const {
  puedeVerConfidencial,
  puedeEditarConfidencialidad,
  reducirSiConfidencial,
} = require('../utils/confidencial');

// GET /api/registros
// Quien tenga registro.ver_todos ve todos; el resto, solo los suyos
const getAll = async (req, res) => {
  try {
    let query = `
      SELECT r.*,
        tf.nombre  AS tipo_falta_nombre,
        tf.gravedad,
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
      WHERE u.id_establecimiento = ?
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

    if (!registro)
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

    res.json({
      ...registro,
      estudiantes,
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

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO REGISTRO_CONVIVENCIA
        (fecha_incidente, asunto, antecedentes, acuerdos, id_tipo_falta, id_usuario,
         es_confidencial, nota_confidencial)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [fecha_incidente, asunto, antecedentes, acuerdos || null, id_tipo_falta, req.user.id,
       !!es_confidencial, es_confidencial ? nota_confidencial.trim() : null]
    );

    const id_registro = result.insertId;

    // Insertar estudiantes involucrados si vienen en el body
    if (Array.isArray(estudiantes) && estudiantes.length > 0) {
      const values = estudiantes.map(e => [id_registro, e.id_estudiante, e.rol_en_incidente]);
      await conn.query(
        'INSERT INTO REGISTRO_ESTUDIANTE (id_registro, id_estudiante, rol_en_incidente) VALUES ?',
        [values]
      );
    }

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

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

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