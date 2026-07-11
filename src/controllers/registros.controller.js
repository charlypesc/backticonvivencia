const pool = require('../db/connection');

// GET /api/registros
// DIRECTOR ve todos, ENCARGADO solo los suyos
const getAll = async (req, res) => {
  try {
    let query = `
      SELECT r.*,
        tf.nombre  AS tipo_falta_nombre,
        tf.gravedad,
        u.correo   AS encargado_correo
      FROM REGISTRO_CONVIVENCIA r
      JOIN TIPO_FALTA tf ON r.id_tipo_falta = tf.id_tipo_falta
      JOIN USUARIO    u  ON r.id_usuario    = u.id_usuario
      WHERE u.id_establecimiento = ?
    `;
    const params = [req.user.id_establecimiento];

    if (req.user.rol === 'ENCARGADO') {
      query += ' AND r.id_usuario = ?';
      params.push(req.user.id);
    }

    query += ' ORDER BY r.fecha_creacion DESC';

    const [rows] = await pool.query(query, params);
    res.json(rows);
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
        tf.nombre AS tipo_falta_nombre, tf.gravedad, tf.medida_sugerida
       FROM REGISTRO_CONVIVENCIA r
       JOIN TIPO_FALTA tf ON r.id_tipo_falta = tf.id_tipo_falta
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

    res.json({ ...registro, estudiantes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error del servidor' });
  }
};

// POST /api/registros — Solo ENCARGADO
const create = async (req, res) => {
  const { fecha_incidente, tematica, antecedentes, acuerdos, id_tipo_falta, estudiantes } = req.body;

  if (!fecha_incidente || !tematica || !antecedentes || !id_tipo_falta)
    return res.status(400).json({ message: 'Faltan campos obligatorios' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO REGISTRO_CONVIVENCIA
        (fecha_incidente, tematica, antecedentes, acuerdos, id_tipo_falta, id_usuario)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fecha_incidente, tematica, antecedentes, acuerdos || null, id_tipo_falta, req.user.id]
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
      `UPDATE REGISTRO_CONVIVENCIA
       SET estado_validacion = 'validado'
       WHERE id_registro = ?`,
      [req.params.id]
    );
    res.json({ message: 'Registro validado' });
  } catch (err) {
    res.status(500).json({ message: 'Error al validar' });
  }
};

// PUT /api/registros/:id — ENCARGADO o DIRECTOR
const update = async (req, res) => {
  const { fecha_incidente, tematica, antecedentes, acuerdos, id_tipo_falta, estudiantes } = req.body;

  if (!fecha_incidente || !tematica || !antecedentes || !id_tipo_falta)
    return res.status(400).json({ message: 'Faltan campos obligatorios' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `UPDATE REGISTRO_CONVIVENCIA
       SET fecha_incidente = ?, tematica = ?, antecedentes = ?, acuerdos = ?, id_tipo_falta = ?
       WHERE id_registro = ?`,
      [fecha_incidente, tematica, antecedentes, acuerdos || null, id_tipo_falta, req.params.id]
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

// DELETE /api/registros/:id — Solo ENCARGADO dueño del registro
const remove = async (req, res) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM REGISTRO_CONVIVENCIA WHERE id_registro = ? AND id_usuario = ?`,
      [req.params.id, req.user.id]
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
  const { fecha_incidente, tematica, antecedentes, acuerdos, id_tipo_falta } = req.body;
  try {
    await pool.query(
      `UPDATE REGISTRO_CONVIVENCIA
       SET fecha_incidente=?, tematica=?, antecedentes=?, acuerdos=?,
           id_tipo_falta=?, estado_validacion='validado'
       WHERE id_registro=?`,
      [fecha_incidente, tematica, antecedentes, acuerdos, id_tipo_falta, req.params.id]
    );
    res.json({ message: 'Registro confirmado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al confirmar' });
  }
};

module.exports = { getAll, getById, create, validar, update, remove, confirmar };