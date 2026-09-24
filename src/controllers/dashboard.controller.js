const pool = require('../db/connection');
const { puedeVerConfidencial } = require('../utils/confidencial');

const getResumen = async (req, res) => {
  const id_est = req.id_establecimiento;

  try {
    const [[{ registros_mes }]] = await pool.query(
      `SELECT COUNT(*) AS registros_mes
       FROM REGISTRO_CONVIVENCIA r
       WHERE r.id_establecimiento = ?
         AND MONTH(r.fecha_creacion) = MONTH(CURDATE())
         AND YEAR(r.fecha_creacion)  = YEAR(CURDATE())`,
      [id_est]
    );

    // Cuántos estudiantes tienen al menos un registro, no cuántos están
    // activos. Con el padrón entero cargado, "estudiantes activos" contaba la
    // matrícula —un número que no dice nada del trabajo de convivencia— y desde
    // que el alta entra inactiva contaría exactamente lo mismo que esta
    // consulta, pero por un rodeo: el estado de la ficha en vez del hecho.
    // Se cuenta sobre REGISTRO_ESTUDIANTE, que es el hecho.
    const [[{ estudiantes_con_registro }]] = await pool.query(
      `SELECT COUNT(DISTINCT re.id_estudiante) AS estudiantes_con_registro
       FROM REGISTRO_ESTUDIANTE re
       JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = re.id_registro
       WHERE r.id_establecimiento = ?`,
      [id_est]
    );

    // Los protocolos hoy en curso. Es el mismo número que traía `casos_activos`
    // dentro de cumplimiento: sube a las tarjetas de actividad, donde se lee
    // junto a los registros del mes, y deja de estar repetido abajo.
    const [[{ protocolos_activados }]] = await pool.query(
      `SELECT COUNT(*) AS protocolos_activados
       FROM PROTOCOLO_ACTIVADO
       WHERE id_establecimiento = ? AND estado = 'activo'`,
      [id_est]
    );

    // Los estudiantes se agrupan por registro a propósito. Antes el JOIN
    // devolvía una fila por estudiante y el LIMIT 5 contaba esas filas, no los
    // registros: un registro con 5 involucrados se comía la lista entera y los
    // registros anteriores desaparecían del dashboard.
    const [ultimos] = await pool.query(
      `SELECT r.id_registro, r.asunto, r.fecha_creacion,
              r.id_usuario, r.es_confidencial, r.nota_confidencial,
              r.fecha_modificacion,
              u.nombre AS autor_nombre, u.correo AS autor_correo,
              um.nombre AS editor_nombre, um.correo AS editor_correo,
              GROUP_CONCAT(DISTINCT CONCAT(e.nombre, ' ', e.apellido)
                           ORDER BY e.nombre SEPARATOR ', ') AS alumno_nombre
       FROM REGISTRO_CONVIVENCIA r
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       LEFT JOIN USUARIO um ON r.id_usuario_modificacion = um.id_usuario
       LEFT JOIN REGISTRO_ESTUDIANTE re ON r.id_registro = re.id_registro
       LEFT JOIN ESTUDIANTE e ON re.id_estudiante = e.id_estudiante
       WHERE r.id_establecimiento = ?
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

    // ── Cumplimiento (Ley 21.809) ───────────────────────────────────────────
    // El dashboard medía actividad (cuántos registros, cuántos estudiantes).
    // Lo que la ley obliga a poder mostrar es otra cosa: si los procedimientos
    // se están ejecutando dentro de plazo. Un caso vencido no aparecía en
    // ninguna pantalla, así que solo se enteraba quien abría el caso.
    const [[cumplimiento]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO
           WHERE id_establecimiento = ? AND estado = 'activo') AS casos_activos,

         (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO_PASO p
            JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = p.id_protocolo_activado
           WHERE p.id_establecimiento = ? AND pa.estado = 'activo'
             AND p.estado IN ('en_curso','vencido')
             AND p.fecha_limite IS NOT NULL AND p.fecha_limite < NOW()) AS pasos_vencidos,

         (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO_PASO p
            JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = p.id_protocolo_activado
           WHERE p.id_establecimiento = ? AND pa.estado = 'activo' AND p.estado = 'en_curso'
             AND p.fecha_limite BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 48 HOUR)) AS pasos_por_vencer,

         -- Medidas de protección vigentes cuyo término ya pasó: son las que
         -- obligan a adoptar otra medida y dejan a alguien sin resguardo.
         (SELECT COUNT(*) FROM MEDIDA_PROTECCION
           WHERE id_establecimiento = ? AND estado IN ('vigente','vencida')
             AND fecha_termino IS NOT NULL AND fecha_termino < CURDATE()) AS medidas_vencidas,

         -- Investigaciones que se pasaron del techo legal (2 meses, o el
         -- término de una segunda suspensión).
         (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO
           WHERE id_establecimiento = ? AND estado = 'activo'
             AND fecha_limite_investigacion IS NOT NULL
             AND fecha_limite_investigacion < CURDATE()) AS investigaciones_fuera_de_plazo,

         -- Registros cuyo tipo de falta obliga a un protocolo que nadie activó.
         -- Es la métrica que mide si el colegio está cumpliendo la lógica de
         -- protocolo, no solo la de registro.
         (SELECT COUNT(DISTINCT r.id_registro)
            FROM REGISTRO_CONVIVENCIA r
            JOIN TIPO_FALTA_PROTOCOLO tfp
              ON tfp.id_tipo_falta = r.id_tipo_falta AND tfp.obligatorio = 1
            LEFT JOIN PROTOCOLO_ACTIVADO pa
              ON pa.id_registro = r.id_registro
             AND pa.id_protocolo_establecimiento = tfp.id_protocolo_establecimiento
             AND pa.estado <> 'anulado'
           WHERE r.id_establecimiento = ? AND pa.id_protocolo_activado IS NULL)
           AS registros_sin_protocolo,

         -- Suspensiones cautelares cuyo plazo de diez días hábiles para
         -- resolver ya venció (art. 6 letra d). Es la infracción más cara de
         -- las que el sistema puede detectar: hay un estudiante suspendido y
         -- un procedimiento que debió cerrarse y no se cerró.
         --
         -- Las que están 'ampliada_por_reconsideracion' quedan fuera a
         -- propósito: interponer la reconsideración amplía la suspensión hasta
         -- culminar su tramitación, así que ahí no hay infracción.
         (SELECT COUNT(*) FROM SUSPENSION_CAUTELAR
           WHERE id_establecimiento = ? AND estado = 'vigente'
             AND fecha_resolucion IS NULL
             AND fecha_limite_resolucion < CURDATE()) AS cautelares_sin_resolver,

         -- Pasos dados por hechos sin constancia de haber notificado a la
         -- persona. Falta de constancia no detiene el protocolo (fase 12.3),
         -- así que sin esta métrica solo se ve abriendo el caso — y es lo
         -- primero que se pregunta en una fiscalización: a quién se le avisó,
         -- cuándo y por qué vía. No se pide firma, se pide constancia.
         (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
            JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
            JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = p.id_protocolo_activado
           WHERE p.id_establecimiento = ? AND pa.estado = 'activo'
             AND p.requiere_notificacion = 1 AND pi.estado <> 'no_aplica'
             AND pi.fecha_notificacion IS NULL) AS notificaciones_pendientes`,
      [id_est, id_est, id_est, id_est, id_est, id_est, id_est, id_est]
    );

    // El "% de pasos cerrados en plazo" salió del tablero: era un acumulado
    // histórico y un solo atraso viejo lo dejaba en 99% para siempre, sin
    // decir nada de cómo se está trabajando hoy.
    res.json({
      registros_mes, estudiantes_con_registro, protocolos_activados,
      ultimos: ultimosFiltrados,
      cumplimiento,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener resumen' });
  }
};

module.exports = { getResumen };