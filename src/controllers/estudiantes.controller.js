const pool = require('../db/connection');
const { reducirSiConfidencial } = require('../utils/confidencial');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, c.nombre AS curso_nombre, c.grado,
        (SELECT COUNT(*) FROM REGISTRO_ESTUDIANTE re WHERE re.id_estudiante = e.id_estudiante) AS n_registros
       FROM ESTUDIANTE e
       JOIN CURSO c ON e.id_curso = c.id_curso
       WHERE e.id_establecimiento = ?
       ORDER BY e.apellido, e.nombre`,
      [req.id_establecimiento]
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
      [run, dv, nombre, apellido, sexo, id_curso, req.id_establecimiento]
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
      [nombre, apellido, sexo, id_curso, req.params.id, req.id_establecimiento]
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
      [req.params.id, req.id_establecimiento]
    );
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar estado' });
  }
};

const remove = async (req, res) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM ESTUDIANTE WHERE id_estudiante = ? AND id_establecimiento = ?`,
      [req.params.id, req.id_establecimiento]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Estudiante no encontrado' });
    res.json({ message: 'Estudiante eliminado' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({ message: 'No es posible eliminar un estudiante con registros de convivencia asociados' });
    res.status(500).json({ message: 'Error al eliminar estudiante' });
  }
};

const buscar = async (req, res) => {
  const q = (req.query.q || '').trim();

  if (q.length < 2) return res.json([]);

  let condiciones;
  let valores;

  // Si lo escrito parece un RUT (solo dígitos, puntos, guion o K) se busca por
  // RUT en vez de por nombre, para que el buscador vaya sugiriendo mientras se
  // escribe: "12", "12345", "12345678", "12.345.678-9" y "123456789" llegan
  // todos al mismo estudiante.
  if (/^[\d.\-kK]+$/.test(q)) {
    const rut = q.replace(/[.\-]/g, '').toUpperCase();
    // Se compara contra el RUT completo (run + dv) y también contra el run solo,
    // porque mientras el usuario escribe todavía no ingresó el dígito verificador.
    condiciones = `(CONCAT(e.run, e.dv) LIKE ? OR CAST(e.run AS CHAR) LIKE ?)`;
    valores = [`${rut}%`, `${rut}%`];
  } else {
    // Cada palabra escrita se busca por separado (AND), sin importar el orden
    // ni qué haya en el medio — así "rodrigo paredes" encuentra a "Rodrigo
    // Andrés Paredes Escobar" aunque tenga un segundo nombre entre medio.
    const tokens = q.split(/\s+/).filter(Boolean);
    condiciones = tokens.map(() => `CONCAT(e.nombre, ' ', e.apellido) LIKE ?`).join(' AND ');
    valores = tokens.map((t) => `%${t}%`);
  }

  try {
    const [rows] = await pool.query(
      `SELECT e.id_estudiante, e.run, e.dv, e.nombre, e.apellido, c.nombre AS curso_nombre, c.grado
       FROM ESTUDIANTE e
       JOIN CURSO c ON e.id_curso = c.id_curso
       WHERE e.id_establecimiento = ?
         AND ${condiciones}
         AND e.activo = 1
       ORDER BY e.apellido, e.nombre
       LIMIT 10`,
      [req.id_establecimiento, ...valores]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al buscar estudiantes' });
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
      [run, dv, req.id_establecimiento]
    );

    if (estudiantes.length === 0)
      return res.status(404).json({ message: 'No se encontraron registros para el RUT ingresado' });

    const estudiante = estudiantes[0];

    const [registros] = await pool.query(
      `SELECT r.*, tf.nombre AS tipo_falta_nombre, tf.gravedad, re.rol_en_incidente,
              u.correo AS autor_correo, um.correo AS editor_correo
       FROM REGISTRO_CONVIVENCIA r
       JOIN REGISTRO_ESTUDIANTE re ON r.id_registro = re.id_registro
       JOIN TIPO_FALTA tf ON r.id_tipo_falta = tf.id_tipo_falta
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       LEFT JOIN USUARIO um ON r.id_usuario_modificacion = um.id_usuario
       WHERE re.id_estudiante = ?
       ORDER BY r.fecha_incidente DESC`,
      [estudiante.id_estudiante]
    );

    res.json({ estudiante, registros: registros.map((r) => reducirSiConfidencial(req, r)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al consultar' });
  }
};
module.exports = { getAll, create, update, toggleActivo, consultarRut, remove, buscar };