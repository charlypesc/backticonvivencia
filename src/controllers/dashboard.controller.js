const pool = require('../db/connection');

const getResumen = async (req, res) => {
  const id_est = req.user.id_establecimiento;

  try {
    const [[{ registros_mes }]] = await pool.query(
      `SELECT COUNT(*) AS registros_mes
       FROM REGISTRO_CONVIVENCIA r
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       WHERE u.id_establecimiento = ?
         AND MONTH(r.fecha_creacion) = MONTH(CURDATE())
         AND YEAR(r.fecha_creacion)  = YEAR(CURDATE())`,
      [id_est]
    );

    const [[{ pendientes }]] = await pool.query(
      `SELECT COUNT(*) AS pendientes
       FROM REGISTRO_CONVIVENCIA r
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       WHERE u.id_establecimiento = ?
         AND r.estado_validacion = 'pendiente'`,
      [id_est]
    );

    const [[{ estudiantes_activos }]] = await pool.query(
      `SELECT COUNT(*) AS estudiantes_activos
       FROM ESTUDIANTE
       WHERE id_establecimiento = ? AND activo = 1`,
      [id_est]
    );

    const [ultimos] = await pool.query(
      `SELECT r.id_registro, r.tematica, r.estado_validacion,
              CONCAT(e.nombre, ' ', e.apellido) AS alumno_nombre
       FROM REGISTRO_CONVIVENCIA r
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       LEFT JOIN REGISTRO_ESTUDIANTE re ON r.id_registro = re.id_registro
       LEFT JOIN ESTUDIANTE e ON re.id_estudiante = e.id_estudiante
       WHERE u.id_establecimiento = ?
       ORDER BY r.fecha_creacion DESC
       LIMIT 5`,
      [id_est]
    );

    res.json({ registros_mes, pendientes, estudiantes_activos, ultimos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener resumen' });
  }
};

module.exports = { getResumen };