const pool = require('../db/connection');
const notificaciones = require('./notificaciones.service');
const { etiquetaTipo } = require('../constants/medidasProteccion');

// Job de plazos vencidos.
//
// Recorre los pasos en curso cuya fecha_limite ya pasó, los marca como vencidos
// y deja el hecho en la bitácora. Es lo que convierte el plazo configurado en
// el grafo en algo que alguien llega a ver.
//
// Va por lotes y apoyado en el índice (fecha_limite, estado): con 12M de filas
// proyectadas a cinco años, un full scan cada quince minutos es la forma más
// rápida de tirar la base abajo. La consulta solo toca las filas que están
// efectivamente vencidas, que en régimen son unas pocas por corrida.
//
// Un paso vencido NO se bloquea: sigue siendo la tarea de alguien y se puede
// completar igual, solo que ahora está marcado y con rastro de cuándo se pasó.

const LOTE = 200;

// Las tres acciones avisan por la campana; lo que cambia es el texto y a quién
// más le llega. 'escalar' suma al coordinador de convivencia educativa, que es
// el responsable del Plan de Gestión según el art. 15: si el paso venció, el
// aviso tiene que salir del círculo de quien no lo hizo.
//
// 'marcar_alerta' ya se refleja en el dashboard (tarjeta de pasos vencidos).
const DESCRIPCION = {
  notificar: 'Plazo vencido',
  escalar: 'Plazo vencido — escalado al coordinador de convivencia',
  marcar_alerta: 'Plazo vencido — marcado en alerta',
};

/**
 * Procesa una tanda de pasos vencidos.
 * @param {number} lote máximo de pasos a procesar en esta corrida
 * @returns {Promise<{procesados: number, porAccion: object}>}
 */
async function procesarVencidos(lote = LOTE) {
  const [pasos] = await pool.query(
    `SELECT p.id_activado_paso, p.id_protocolo_activado, p.id_establecimiento,
            p.nombre, p.fecha_limite, p.accion_al_vencer
     FROM PROTOCOLO_ACTIVADO_PASO p
     JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = p.id_protocolo_activado
     WHERE p.estado = 'en_curso' AND p.fecha_limite IS NOT NULL AND p.fecha_limite < NOW()
       AND pa.estado = 'activo'
     ORDER BY p.fecha_limite
     LIMIT ?`,
    [lote]
  );
  if (pasos.length === 0) return { procesados: 0, porAccion: {} };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE PROTOCOLO_ACTIVADO_PASO SET estado = 'vencido' WHERE id_activado_paso IN (?)`,
      [pasos.map((p) => p.id_activado_paso)]
    );

    // id_usuario NULL en la bitácora significa "lo hizo el sistema", que es
    // exactamente lo que pasó acá: nadie apretó nada, se cumplió un plazo.
    await conn.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
       VALUES ?`,
      [pasos.map((p) => [
        p.id_protocolo_activado, p.id_establecimiento, p.id_activado_paso, 'vencimiento',
        `${DESCRIPCION[p.accion_al_vencer] ?? DESCRIPCION.notificar}: '${p.nombre}' vencía el ${p.fecha_limite.toISOString()}`,
        null, new Date(),
      ])]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Fuera de la transacción a propósito: el vencimiento ya está registrado y no
  // se va a deshacer porque falle un aviso. Cada paso se avisa por separado
  // porque los destinatarios dependen de los roles de ese paso.
  // El coordinador se resuelve una vez por establecimiento y no una por paso:
  // en una corrida con muchos vencidos del mismo colegio sería la misma
  // consulta repetida.
  const coordinadoresPorEstab = new Map();
  const coordinadoresDe = async (id_establecimiento) => {
    if (!coordinadoresPorEstab.has(id_establecimiento))
      coordinadoresPorEstab.set(
        id_establecimiento,
        await notificaciones.coordinadoresDeConvivencia(pool, id_establecimiento)
      );
    return coordinadoresPorEstab.get(id_establecimiento);
  };

  for (const p of pasos) {
    const usuarios = await notificaciones.destinatariosDePaso(pool, p.id_activado_paso, [
      'ejecutor', 'aprobador', 'notificado',
    ]);

    // Escalar es avisarle a alguien por encima del paso. Va en la misma
    // notificación y no en una aparte para que el coordinador vea el caso, no
    // un aviso suelto sin contexto; crear() ya deduplica si además tenía un rol
    // en el paso.
    if (p.accion_al_vencer === 'escalar') usuarios.push(...(await coordinadoresDe(p.id_establecimiento)));

    await notificaciones.crear(pool, {
      usuarios,
      id_establecimiento: p.id_establecimiento,
      tipo: 'paso_vencido',
      titulo: `Venció el plazo: ${p.nombre}`,
      mensaje: DESCRIPCION[p.accion_al_vencer] ?? DESCRIPCION.notificar,
      id_protocolo_activado: p.id_protocolo_activado,
      id_activado_paso: p.id_activado_paso,
    });
  }

  const porAccion = {};
  for (const p of pasos) porAccion[p.accion_al_vencer] = (porAccion[p.accion_al_vencer] ?? 0) + 1;
  return { procesados: pasos.length, porAccion };
}

/**
 * Marca como vencidas las medidas de protección cuyo término ya pasó.
 *
 * Una suspensión vencida es más grave que un paso vencido: el art. 16 E letra j
 * obliga a adoptar otra medida de protección, y mientras eso no ocurra la
 * persona afectada quedó sin resguardo. Por eso el aviso lo dice explícitamente
 * en vez de tratarlo como un vencimiento más.
 *
 * La medida NO se cierra sola: cerrarla exige registrar la sustituta, y eso es
 * una decisión del establecimiento, no del job.
 */
async function procesarMedidasVencidas(lote = LOTE) {
  const [medidas] = await pool.query(
    `SELECT mp.id_medida_proteccion, mp.id_protocolo_activado, mp.id_establecimiento,
            mp.tipo, mp.fecha_termino
     FROM MEDIDA_PROTECCION mp
     JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = mp.id_protocolo_activado
     WHERE mp.estado = 'vigente' AND mp.fecha_termino IS NOT NULL AND mp.fecha_termino < CURDATE()
       AND pa.estado = 'activo'
     ORDER BY mp.fecha_termino
     LIMIT ?`,
    [lote]
  );
  if (medidas.length === 0) return { procesados: 0 };

  await pool.query(
    `UPDATE MEDIDA_PROTECCION SET estado = 'vencida' WHERE id_medida_proteccion IN (?)`,
    [medidas.map((m) => m.id_medida_proteccion)]
  );

  await pool.query(
    `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
       (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
     VALUES ?`,
    [medidas.map((m) => [
      m.id_protocolo_activado, m.id_establecimiento, 'medida_proteccion_vencida',
      m.tipo === 'suspension'
        ? `Venció la suspensión (${m.fecha_termino}). Corresponde adoptar otra medida de protección.`
        : `Venció la medida de protección '${etiquetaTipo(m.tipo)}' (${m.fecha_termino}).`,
      null, new Date(),
    ])]
  );

  for (const m of medidas) {
    const usuarios = await notificaciones.destinatariosDeCaso(pool, m.id_protocolo_activado);
    // Una medida de protección vencida siempre escala, sin depender de cómo
    // esté configurado el paso: mientras no se adopte la medida sustituta hay
    // alguien sin resguardo, y esa es responsabilidad del coordinador.
    usuarios.push(...(await notificaciones.coordinadoresDeConvivencia(pool, m.id_establecimiento)));
    await notificaciones.crear(pool, {
      usuarios,
      id_establecimiento: m.id_establecimiento,
      tipo: 'medida_proteccion_vencida',
      titulo: m.tipo === 'suspension' ? 'Venció la suspensión' : 'Venció una medida de protección',
      mensaje: m.tipo === 'suspension'
        ? 'El procedimiento sigue abierto: hay que adoptar otra medida de protección, no se puede extender la suspensión.'
        : 'Revisá si corresponde adoptar otra medida.',
      id_protocolo_activado: m.id_protocolo_activado,
    });
  }

  return { procesados: medidas.length };
}

/**
 * Medidas disciplinarias: marca como cumplidas las que llegaron a su término,
 * avisa un día antes de que termine una excepcional, y recuerda la revisión
 * semestral de la condicionalidad.
 *
 * A diferencia de una medida de protección, llegar al término de una sanción
 * es CUMPLIDA, no una infracción — el estudiante sirvió la medida. Lo único
 * que de verdad exige seguimiento es la condicionalidad, que la Circular 482
 * obliga a revisar "al final de cada semestre, independiente de la fecha en
 * la cual se haya aplicado".
 *
 * MEDIDA_DISCIPLINARIA cuelga de id_registro, no de id_protocolo_activado (a
 * diferencia de MEDIDA_PROTECCION): el join pasa por REGISTRO_CONVIVENCIA.
 */
async function procesarMedidasDisciplinariasVencidas(lote = LOTE) {
  // ── Cumplidas: llegaron a su fecha_termino ────────────────────────────────
  const [cumplidas] = await pool.query(
    `SELECT md.id_medida, md.id_registro, md.id_establecimiento, md.tipo_medida, md.fecha_termino,
            pa.id_protocolo_activado
     FROM MEDIDA_DISCIPLINARIA md
     JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = md.id_registro
     JOIN PROTOCOLO_ACTIVADO pa ON pa.id_registro = r.id_registro AND pa.estado = 'activo'
     WHERE md.estado = 'vigente' AND md.fecha_termino IS NOT NULL AND md.fecha_termino < CURDATE()
     ORDER BY md.fecha_termino
     LIMIT ?`,
    [lote]
  );

  if (cumplidas.length > 0) {
    await pool.query(
      `UPDATE MEDIDA_DISCIPLINARIA SET estado = 'cumplida' WHERE id_medida IN (?)`,
      [cumplidas.map((m) => m.id_medida)]
    );
    await pool.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES ?`,
      [cumplidas.map((m) => [
        m.id_protocolo_activado, m.id_establecimiento, 'medida_disciplinaria_cumplida',
        `Se cumplió el plazo de la medida '${m.tipo_medida}' (${m.fecha_termino})`,
        null, new Date(),
      ])]
    );
    for (const m of cumplidas) {
      const usuarios = await notificaciones.destinatariosDeCaso(pool, m.id_protocolo_activado);
      await notificaciones.crear(pool, {
        usuarios,
        id_establecimiento: m.id_establecimiento,
        tipo: 'medida_disciplinaria_cumplida',
        titulo: 'Medida disciplinaria cumplida',
        mensaje: `'${m.tipo_medida}' cumplió su plazo (${m.fecha_termino}).`,
        id_protocolo_activado: m.id_protocolo_activado,
      });
    }
  }

  // ── Por terminar: aviso único, un día antes ───────────────────────────────
  // No cambia estado ni deja bitácora: es un heads-up, no un hecho. Se dispara
  // solo el día exacto en que faltan 24 horas para que no se repita cada
  // corrida del job.
  const [porTerminar] = await pool.query(
    `SELECT md.id_medida, md.id_establecimiento, md.tipo_medida, md.fecha_termino,
            pa.id_protocolo_activado
     FROM MEDIDA_DISCIPLINARIA md
     JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = md.id_registro
     JOIN PROTOCOLO_ACTIVADO pa ON pa.id_registro = r.id_registro AND pa.estado = 'activo'
     WHERE md.estado = 'vigente' AND md.fecha_termino = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
     LIMIT ?`,
    [lote]
  );
  for (const m of porTerminar) {
    const usuarios = await notificaciones.destinatariosDeCaso(pool, m.id_protocolo_activado);
    await notificaciones.crear(pool, {
      usuarios,
      id_establecimiento: m.id_establecimiento,
      tipo: 'medida_disciplinaria_por_terminar',
      titulo: 'Medida disciplinaria por terminar',
      mensaje: `'${m.tipo_medida}' termina mañana (${m.fecha_termino}).`,
      id_protocolo_activado: m.id_protocolo_activado,
    });
  }

  // ── Condicionalidad: revisión semestral ───────────────────────────────────
  // No hay estado propio para "revisión pendiente": se evita reavisar cada
  // corrida comprobando si ya existe el evento de bitácora para este caso
  // desde la fecha de revisión en curso.
  const [porRevisar] = await pool.query(
    `SELECT md.id_medida, md.id_establecimiento, md.fecha_revision, pa.id_protocolo_activado
     FROM MEDIDA_DISCIPLINARIA md
     JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = md.id_registro
     JOIN PROTOCOLO_ACTIVADO pa ON pa.id_registro = r.id_registro AND pa.estado = 'activo'
     WHERE md.tipo_medida = 'condicionalidad' AND md.estado = 'vigente'
       AND md.fecha_revision IS NOT NULL AND md.fecha_revision <= CURDATE()
       AND NOT EXISTS (
         SELECT 1 FROM PROTOCOLO_ACTIVADO_EVENTO e
         WHERE e.id_protocolo_activado = pa.id_protocolo_activado
           AND e.tipo_evento = 'condicionalidad_por_revisar'
           AND e.fecha >= md.fecha_revision
       )
     LIMIT ?`,
    [lote]
  );
  if (porRevisar.length > 0) {
    await pool.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES ?`,
      [porRevisar.map((m) => [
        m.id_protocolo_activado, m.id_establecimiento, 'condicionalidad_por_revisar',
        `Corresponde revisar la condicionalidad (semestre vencido el ${m.fecha_revision})`,
        null, new Date(),
      ])]
    );
    for (const m of porRevisar) {
      const usuarios = await notificaciones.destinatariosDeCaso(pool, m.id_protocolo_activado);
      await notificaciones.crear(pool, {
        usuarios,
        id_establecimiento: m.id_establecimiento,
        tipo: 'condicionalidad_por_revisar',
        titulo: 'Condicionalidad por revisar',
        mensaje: `La Circular 482 exige revisarla al final de cada semestre (${m.fecha_revision}).`,
        id_protocolo_activado: m.id_protocolo_activado,
      });
    }
  }

  return { cumplidas: cumplidas.length, porTerminar: porTerminar.length, porRevisar: porRevisar.length };
}

// Arranca el job periódico. Devuelve el timer para poder detenerlo (los tests
// lo llaman a mano y no quieren un intervalo colgando).
//
// Se puede desactivar con PROTOCOLOS_JOB_MINUTOS=0 y correr el service desde un
// cron externo, que es lo que conviene si algún día hay más de una instancia:
// con varias, todas despertarían a la vez sobre las mismas filas.
function iniciarJob() {
  const minutos = Number(process.env.PROTOCOLOS_JOB_MINUTOS ?? 15);
  if (!minutos) return null;

  const correr = async () => {
    try {
      const r = await procesarVencidos();
      if (r.procesados > 0)
        console.log(`[vencimientos] ${r.procesados} paso(s) vencidos`, r.porAccion);
      const m = await procesarMedidasVencidas();
      if (m.procesados > 0)
        console.log(`[vencimientos] ${m.procesados} medida(s) de protección vencidas`);
      const md = await procesarMedidasDisciplinariasVencidas();
      if (md.cumplidas > 0 || md.porTerminar > 0 || md.porRevisar > 0)
        console.log(
          `[vencimientos] medidas disciplinarias: ${md.cumplidas} cumplida(s), ` +
          `${md.porTerminar} por terminar, ${md.porRevisar} condicionalidad(es) por revisar`
        );
    } catch (err) {
      // Un fallo del job no puede tumbar el proceso: se reintenta solo en la
      // próxima corrida.
      console.error('[vencimientos] error en la corrida:', err.message);
    }
  };

  const timer = setInterval(correr, minutos * 60 * 1000);
  timer.unref();
  correr();
  return timer;
}

module.exports = {
  procesarVencidos, procesarMedidasVencidas, procesarMedidasDisciplinariasVencidas, iniciarJob,
};
