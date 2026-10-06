const pool = require('../db/connection');
const { puedeVerConfidencial, filtroRegistrosVisibles } = require('../utils/confidencial');
const { tienePermiso } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

// Qué cuenta como bullying para las alertas del dashboard: el motivo del
// registro o el protocolo activado. Por nombre porque los motivos son de cada
// establecimiento (no hay un código común); "acoso sexual" queda fuera a
// propósito, es otro procedimiento.
const REGEX_BULLYING = 'bullying|acoso escolar|ciberacoso|hostigamiento';

/** Registros que tocan bullying, por el motivo o por un protocolo activado sobre ellos. */
const ES_BULLYING_SQL = `(
  tf.nombre REGEXP '${REGEX_BULLYING}'
  OR EXISTS (SELECT 1 FROM PROTOCOLO_ACTIVADO pab
               JOIN PROTOCOLO_ESTABLECIMIENTO peb ON peb.id_protocolo_establecimiento = pab.id_protocolo_establecimiento
               LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cpb ON cpb.id_protocolo = peb.id_protocolo
              WHERE pab.id_registro = r.id_registro AND pab.estado <> 'anulado'
                AND COALESCE(peb.nombre, cpb.nombre) REGEXP '${REGEX_BULLYING}'))`;

/**
 * Lo que un confidencial no deja ver es el asunto, no quiénes están
 * involucrados (mismo criterio que `ultimos`).
 */
const ocultarAsunto = (req, r) => {
  const { id_usuario, nota_confidencial, ...resto } = r;
  if (!r.es_confidencial || puedeVerConfidencial(req, r)) return resto;
  return { ...resto, asunto: nota_confidencial || 'Sin nota', contenido_oculto: true };
};

const getResumen = async (req, res) => {
  const id_est = req.id_establecimiento;

  try {
    // ── Registros por atender (coordinador) ────────────────────────────────
    // Los que llenó otro funcionario y ningún coordinador tomó todavía. Es la
    // bandeja desde donde se "ataja" el registro para atenderlo o derivarlo.
    const puedeDerivar = tienePermiso(req, Permiso.RegistroDerivar);
    let por_atender = null;
    let derivaciones = null;
    if (puedeDerivar) {
      const [filas] = await pool.query(
        `SELECT r.id_registro, r.codigo, r.asunto, r.fecha_creacion, r.id_usuario,
                r.es_confidencial, r.nota_confidencial,
                COALESCE(u.nombre, u.correo) AS autor_nombre,
                tf.nombre AS tipo_falta_nombre, tf.gravedad,
                -- El protocolo que el reglamento asocia al motivo, si el
                -- registro todavía no tiene ninguno activado: es lo primero
                -- que el coordinador tiene que decidir al tomarlo.
                (SELECT COALESCE(pe.nombre, cp.nombre)
                   FROM TIPO_FALTA_PROTOCOLO tfp
                   JOIN PROTOCOLO_ESTABLECIMIENTO pe ON pe.id_protocolo_establecimiento = tfp.id_protocolo_establecimiento
                   LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON cp.id_protocolo = pe.id_protocolo
                  WHERE tfp.id_tipo_falta = r.id_tipo_falta
                    AND NOT EXISTS (SELECT 1 FROM PROTOCOLO_ACTIVADO pa
                                     WHERE pa.id_registro = r.id_registro AND pa.estado <> 'anulado')
                  ORDER BY tfp.obligatorio DESC LIMIT 1) AS protocolo_sugerido,
                (SELECT MAX(tfp.obligatorio) FROM TIPO_FALTA_PROTOCOLO tfp
                  WHERE tfp.id_tipo_falta = r.id_tipo_falta) AS protocolo_obligatorio,
                GROUP_CONCAT(DISTINCT CONCAT(e.nombre, ' ', e.apellido)
                             ORDER BY e.nombre SEPARATOR ', ') AS alumno_nombre
         FROM REGISTRO_CONVIVENCIA r
         JOIN USUARIO u ON u.id_usuario = r.id_usuario
         JOIN TIPO_FALTA tf ON tf.id_tipo_falta = r.id_tipo_falta
         LEFT JOIN REGISTRO_ESTUDIANTE re ON re.id_registro = r.id_registro
         LEFT JOIN ESTUDIANTE e ON e.id_estudiante = re.id_estudiante
         WHERE r.id_establecimiento = ? AND r.id_usuario_atiende IS NULL
         GROUP BY r.id_registro
         ORDER BY r.fecha_creacion
         LIMIT 20`,
        [id_est]
      );
      por_atender = filas.map((r) => ocultarAsunto(req, r));

      const [[d]] = await pool.query(
        `SELECT
           SUM(estado = 'pendiente' AND fecha_limite >= NOW()) AS en_plazo,
           SUM(estado = 'pendiente' AND fecha_limite < NOW())  AS vencidas
         FROM REGISTRO_DERIVACION WHERE id_establecimiento = ?`,
        [id_est]
      );
      derivaciones = { en_plazo: Number(d.en_plazo ?? 0), vencidas: Number(d.vencidas ?? 0) };
    }

    // Lo que le derivaron a quien mira: su propia lista de pendientes.
    const [mis_derivaciones] = await pool.query(
      `SELECT d.id_registro, r.codigo, d.fecha_limite, d.instrucciones, (d.fecha_limite < NOW()) AS vencida,
              COALESCE(uo.nombre, uo.correo) AS origen_nombre,
              r.asunto, r.es_confidencial, r.nota_confidencial, r.id_usuario
       FROM REGISTRO_DERIVACION d
       JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = d.id_registro
       JOIN USUARIO uo ON uo.id_usuario = d.id_usuario_origen
       WHERE d.id_establecimiento = ? AND d.id_usuario_destino = ? AND d.estado = 'pendiente'
       ORDER BY d.fecha_limite`,
      [id_est, req.user.id]
    );

    // ── Resumen del colegio ─────────────────────────────────────────────────
    // Inicio (dashboard.ver) es la entrada de todos: lo de arriba son los
    // pendientes de quien mira. Todo lo que sigue son las cifras del
    // establecimiento —el "Resumen del mes", alertas, cumplimiento, últimos
    // registros y estadísticas— y van con su propio permiso.
    const misDerivaciones = mis_derivaciones.map((r) => ocultarAsunto(req, r));
    if (!tienePermiso(req, Permiso.DashboardVerResumen)) {
      return res.json({ ver_resumen: false, por_atender, derivaciones, mis_derivaciones: misDerivaciones });
    }

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
    const ultimosVisibles = filtroRegistrosVisibles(req, 'r');
    const [ultimos] = await pool.query(
      `SELECT r.id_registro, r.codigo, r.asunto, r.fecha_creacion,
              r.id_usuario, r.es_confidencial, r.nota_confidencial,
              r.fecha_modificacion, tf.nombre AS tipo_falta_nombre,
              u.nombre AS autor_nombre, u.correo AS autor_correo,
              um.nombre AS editor_nombre, um.correo AS editor_correo,
              GROUP_CONCAT(DISTINCT CONCAT(e.nombre, ' ', e.apellido)
                           ORDER BY e.nombre SEPARATOR ', ') AS alumno_nombre
       FROM REGISTRO_CONVIVENCIA r
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       LEFT JOIN TIPO_FALTA tf ON tf.id_tipo_falta = r.id_tipo_falta
       LEFT JOIN USUARIO um ON r.id_usuario_modificacion = um.id_usuario
       LEFT JOIN REGISTRO_ESTUDIANTE re ON r.id_registro = re.id_registro
       LEFT JOIN ESTUDIANTE e ON re.id_estudiante = e.id_estudiante
       WHERE r.id_establecimiento = ?${ultimosVisibles.sql}
       GROUP BY r.id_registro
       ORDER BY r.fecha_creacion DESC
       LIMIT 5`,
      [id_est, ...ultimosVisibles.params]
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

    // ── Alertas por estudiante ─────────────────────────────────────────────
    // Afectado en dos o más registros: el patrón que por separado no se ve.
    // Con más razón si alguno es de bullying, que por definición es reiterado.
    const [afectados_reiterados] = await pool.query(
      `SELECT e.id_estudiante, e.run, e.dv, CONCAT(e.nombre, ' ', e.apellido) AS nombre, c.nombre AS curso_nombre,
              COUNT(DISTINCT r.id_registro) AS veces,
              MAX(${ES_BULLYING_SQL}) AS bullying
       FROM REGISTRO_ESTUDIANTE re
       JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = re.id_registro
       JOIN TIPO_FALTA tf ON tf.id_tipo_falta = r.id_tipo_falta
       JOIN ESTUDIANTE e ON e.id_estudiante = re.id_estudiante
       LEFT JOIN CURSO c ON c.id_curso = e.id_curso
       WHERE r.id_establecimiento = ? AND re.rol_en_incidente = 'afectado'
       GROUP BY e.id_estudiante
       HAVING veces >= 2
       ORDER BY bullying DESC, veces DESC
       LIMIT 20`,
      [id_est]
    );

    // Señalado en dos o más registros: el mismo patrón visto del otro lado.
    // Reemplaza a la tarjeta "Señalados por bullying", que marcaba en rojo a
    // un estudiante por un solo registro; lo que interesa ver es la
    // reiteración. El bullying queda como etiqueta dentro de la fila.
    const [senalados_reiterados] = await pool.query(
      `SELECT e.id_estudiante, e.run, e.dv, CONCAT(e.nombre, ' ', e.apellido) AS nombre, c.nombre AS curso_nombre,
              COUNT(DISTINCT r.id_registro) AS veces,
              MAX(${ES_BULLYING_SQL}) AS bullying
       FROM REGISTRO_ESTUDIANTE re
       JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = re.id_registro
       JOIN TIPO_FALTA tf ON tf.id_tipo_falta = r.id_tipo_falta
       JOIN ESTUDIANTE e ON e.id_estudiante = re.id_estudiante
       LEFT JOIN CURSO c ON c.id_curso = e.id_curso
       WHERE r.id_establecimiento = ? AND re.rol_en_incidente = 'senalado'
       GROUP BY e.id_estudiante
       HAVING veces >= 2
       ORDER BY veces DESC, bullying DESC
       LIMIT 20`,
      [id_est]
    );

    // ── Gráficos (los del dashboard de MiConvivencia) ──────────────────────
    // Registros por mes del año en curso, protocolos activados por tipo, y el
    // volumen de lo que se ingresó por tipo de documento.
    const [porMes] = await pool.query(
      `SELECT MONTH(fecha_creacion) AS mes, COUNT(*) AS n
       FROM REGISTRO_CONVIVENCIA
       WHERE id_establecimiento = ? AND YEAR(fecha_creacion) = YEAR(CURDATE())
       GROUP BY mes`,
      [id_est]
    );
    const registros_por_mes = Array.from({ length: 12 }, (_, i) =>
      Number(porMes.find((f) => f.mes === i + 1)?.n ?? 0));

    const verProtocolos = tienePermiso(req, Permiso.ProtocoloActivadoVerTodos);
    let protocolos_por_tipo = null;
    if (verProtocolos) {
      [protocolos_por_tipo] = await pool.query(
        `SELECT COALESCE(pe.nombre, cp.nombre) AS nombre, COUNT(*) AS n
         FROM PROTOCOLO_ACTIVADO pa
         JOIN PROTOCOLO_ESTABLECIMIENTO pe ON pe.id_protocolo_establecimiento = pa.id_protocolo_establecimiento
         LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON cp.id_protocolo = pe.id_protocolo
         WHERE pa.id_establecimiento = ? AND pa.estado <> 'anulado'
           AND YEAR(pa.fecha_activacion) = YEAR(CURDATE())
         GROUP BY nombre
         ORDER BY n DESC`,
        [id_est]
      );
    }

    const [[ingresos]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM REGISTRO_CONVIVENCIA
           WHERE id_establecimiento = ? AND YEAR(fecha_creacion) = YEAR(CURDATE())) AS registros,
         (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO
           WHERE id_establecimiento = ? AND estado <> 'anulado'
             AND YEAR(fecha_activacion) = YEAR(CURDATE())) AS protocolos,
         (SELECT COUNT(*) FROM MEDIDA_DISCIPLINARIA
           WHERE id_establecimiento = ? AND YEAR(fecha_aplicacion) = YEAR(CURDATE())) AS medidas_disciplinarias,
         (SELECT COUNT(*) FROM MEDIDA_PROTECCION
           WHERE id_establecimiento = ? AND YEAR(fecha_registro) = YEAR(CURDATE())) AS medidas_proteccion`,
      [id_est, id_est, id_est, id_est]
    );

    // El "% de pasos cerrados en plazo" salió del tablero: era un acumulado
    // histórico y un solo atraso viejo lo dejaba en 99% para siempre, sin
    // decir nada de cómo se está trabajando hoy.
    //
    // Quien no ve el listado de protocolos (Inspectoría) tampoco ve sus
    // números: el conteo y el cumplimiento son de los casos, no de sus pasos.
    res.json({
      ver_resumen: true,
      registros_mes, estudiantes_con_registro,
      protocolos_activados: verProtocolos ? protocolos_activados : null,
      ultimos: ultimosFiltrados,
      cumplimiento: verProtocolos ? cumplimiento : null,
      por_atender,
      derivaciones,
      mis_derivaciones: misDerivaciones,
      alertas: {
        afectados_reiterados: afectados_reiterados.map((a) => ({ ...a, bullying: !!a.bullying })),
        senalados_reiterados: senalados_reiterados.map((a) => ({ ...a, bullying: !!a.bullying })),
      },
      graficos: {
        anio: new Date().getFullYear(),
        registros_por_mes,
        protocolos_por_tipo,
        ingresos: verProtocolos ? ingresos : { ...ingresos, protocolos: undefined },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener resumen' });
  }
};

module.exports = { getResumen };