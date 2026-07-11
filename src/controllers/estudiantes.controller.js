const pool = require('../db/connection');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, c.nombre AS curso_nombre, c.grado
       FROM ESTUDIANTE e
       JOIN CURSO c ON e.id_curso = c.id_curso
       WHERE e.id_establecimiento = ?
       ORDER BY e.apellido, e.nombre`,
      [req.user.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener estudiantes' });
  }
};

const create = async (req, res) => {
  const { run, dv, nombre, apellido, sexo, id_curso } = req.body;

  if (!run || !dv || !nombre || !apellido || !sexo || !id_curso)
    return res.status(400).json({ message: 'Complete todos los campos requeridos' });

  try {
    const [result] = await pool.query(
      `INSERT INTO ESTUDIANTE (run, dv, nombre, apellido, sexo, id_curso, id_establecimiento)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [run, dv, nombre, apellido, sexo, id_curso, req.user.id_establecimiento]
    );
    res.status(201).json({ id_estudiante: result.insertId, message: 'Estudiante creado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Ya existe un estudiante registrado con ese RUN' });
    res.status(500).json({ message: 'Error al crear estudiante' });
  }
};

const update = async (req, res) => {
  const { nombre, apellido, sexo, id_curso } = req.body;

  try {
    await pool.query(
      `UPDATE ESTUDIANTE SET nombre=?, apellido=?, sexo=?, id_curso=?
       WHERE id_estudiante=? AND id_establecimiento=?`,
      [nombre, apellido, sexo, id_curso, req.params.id, req.user.id_establecimiento]
    );
    res.json({ message: 'Estudiante actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const toggleActivo = async (req, res) => {
  try {
    await pool.query(
      `UPDATE ESTUDIANTE SET activo = NOT activo
       WHERE id_estudiante=? AND id_establecimiento=?`,
      [req.params.id, req.user.id_establecimiento]
    );
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar estado' });
  }
};

// GET cursos para el select del formulario
const getCursos = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM CURSO WHERE id_establecimiento=? ORDER BY nivel, grado`,
      [req.user.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener cursos' });
  }
};
const consultarRut = async (req, res) => {
  const rut = req.params.rut; // ej: 12345678-9
  const [run, dv] = rut.split('-');

  try {
    const [estudiantes] = await pool.query(
      `SELECT e.*, c.nombre AS curso_nombre, c.grado
       FROM ESTUDIANTE e
       JOIN CURSO c ON e.id_curso = c.id_curso
       WHERE e.run = ? AND e.dv = ? AND e.id_establecimiento = ?`,
      [run, dv, req.user.id_establecimiento]
    );

    if (estudiantes.length === 0)
      return res.status(404).json({ message: 'No se encontraron registros para el RUT ingresado' });

    const estudiante = estudiantes[0];

    const [registros] = await pool.query(
      `SELECT r.*, tf.nombre AS tipo_falta_nombre, tf.gravedad
       FROM REGISTRO_CONVIVENCIA r
       JOIN REGISTRO_ESTUDIANTE re ON r.id_registro = re.id_registro
       JOIN TIPO_FALTA tf ON r.id_tipo_falta = tf.id_tipo_falta
       WHERE re.id_estudiante = ?
       ORDER BY r.fecha_incidente DESC`,
      [estudiante.id_estudiante]
    );

    res.json({ estudiante, registros });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al consultar' });
  }
};
module.exports = { getAll, create, update, toggleActivo, getCursos, consultarRut };