const pool = require('../db/connection');
const { puedeVerConfidencial } = require('../utils/confidencial');

const getResumen = async (req, res) => {
  const id_est = req.id_establecimiento;

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

    // Los estudiantes se agrupan por registro a propósito. Antes el JOIN
    // devolvía una fila por estudiante y el LIMIT 5 contaba esas filas, no los
    // registros: un registro con 5 involucrados se comía la lista entera y los
    // registros anteriores desaparecían del dashboard.
    const [ultimos] = await pool.query(
      `SELECT r.id_registro, r.asunto, r.estado_validacion, r.fecha_creacion,
              r.id_usuario, r.es_confidencial, r.nota_confidencial,
              r.fecha_modificacion,
              u.correo AS autor_correo, um.correo AS editor_correo,
              GROUP_CONCAT(DISTINCT CONCAT(e.nombre, ' ', e.apellido)
                           ORDER BY e.nombre SEPARATOR ', ') AS alumno_nombre
       FROM REGISTRO_CONVIVENCIA r
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       LEFT JOIN USUARIO um ON r.id_usuario_modificacion = um.id_usuario
       LEFT JOIN REGISTRO_ESTUDIANTE re ON r.id_registro = re.id_registro
       LEFT JOIN ESTUDIANTE e ON re.id_estudiante = e.id_estudiante
       WHERE u.id_establecimiento = ?
       GROUP BY r.id_registro
       ORDER BY r.fecha_creacion DESC
       LIMIT 5`,
      [id_est]
    );

    // Lo que un registro confidencial oculta es el asunto (el contenido del
    // caso), no quiénes están involucrados: el equipo necesita saber que esos
    // estudiantes tienen un caso abierto para no tratarlos a ciegas. Por eso
    // alumno_nombre se conserva y solo se reemplaza el asunto por la nota.
    //
    // Acá no aplica la reducción genérica porque este widget tiene su propia
    // forma (alumno_nombre en vez de la lista de estudiantes).
    const ultimosFiltrados = ultimos.map((r) => {
      const { id_usuario, ...resto } = r;
      if (!r.es_confidencial || puedeVerConfidencial(req, r)) return resto;
      return {
        ...resto,
        asunto: r.nota_confidencial || 'Sin nota',
        contenido_oculto: true,
      };
    });

    res.json({ registros_mes, pendientes, estudiantes_activos, ultimos: ultimosFiltrados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener resumen' });
  }
};

module.exports = { getResumen };