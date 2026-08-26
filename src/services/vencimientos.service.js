const pool = require('../db/connection');
const notificaciones = require('./notificaciones.service');

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

// Las tres acciones avisan por la campana; lo que cambia es el texto. 'escalar'
// todavía no sube a nadie por jerarquía y 'marcar_alerta' no pinta el caso en
// el dashboard: eso viene cuando haya a quién escalar configurado.
const DESCRIPCION = {
  notificar: 'Plazo vencido',
  escalar: 'Plazo vencido — corresponde escalar',
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
  for (const p of pasos) {
    const usuarios = await notificaciones.destinatariosDePaso(pool, p.id_activado_paso, [
      'ejecutor', 'aprobador', 'notificado',
    ]);
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

module.exports = { procesarVencidos, iniciarJob };
