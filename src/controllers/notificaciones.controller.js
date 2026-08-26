const pool = require('../db/connection');

// Bandeja personal: cada usuario ve solo lo suyo.
//
// No hay permiso que controle esto y no es un olvido: una notificación no es un
// dato del establecimiento sino un aviso dirigido a una persona, y filtrar por
// `id_usuario = req.user.id` es más estricto que cualquier permiso. Por eso
// tampoco hay un endpoint para "ver las notificaciones de otro".

/** Cuántas quedan sin leer: es lo único que necesita el badge de la campana. */
const getContador = async (req, res) => {
  try {
    const [[fila]] = await pool.query(
      'SELECT COUNT(*) AS sin_leer FROM NOTIFICACION WHERE id_usuario = ? AND leida = 0',
      [req.user.id]
    );
    res.json({ sin_leer: fila.sin_leer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al contar las notificaciones' });
  }
};

/**
 * Las últimas notificaciones, sin leer primero.
 *
 * Se limita a 30: la campana es para enterarse de lo reciente, no un archivo
 * histórico — para eso está la bitácora de cada caso, que es la fuente de
 * verdad y no se borra.
 */
const getAll = async (req, res) => {
  try {
    const soloNoLeidas = req.query.no_leidas === 'true';
    const [rows] = await pool.query(
      `SELECT id_notificacion, tipo, titulo, mensaje, url, id_protocolo_activado,
              id_activado_paso, leida, fecha
       FROM NOTIFICACION
       WHERE id_usuario = ? ${soloNoLeidas ? 'AND leida = 0' : ''}
       ORDER BY leida, fecha DESC
       LIMIT 30`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las notificaciones' });
  }
};

const marcarLeida = async (req, res) => {
  try {
    const [r] = await pool.query(
      'UPDATE NOTIFICACION SET leida = 1 WHERE id_notificacion = ? AND id_usuario = ?',
      [req.params.id, req.user.id]
    );
    // 404 y no 403 a propósito: si es de otro, para este usuario no existe.
    if (r.affectedRows === 0) return res.status(404).json({ message: 'Notificación no encontrada' });
    res.json({ message: 'Notificación marcada como leída' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al marcar la notificación' });
  }
};

const marcarTodasLeidas = async (req, res) => {
  try {
    const [r] = await pool.query(
      'UPDATE NOTIFICACION SET leida = 1 WHERE id_usuario = ? AND leida = 0',
      [req.user.id]
    );
    res.json({ message: 'Notificaciones marcadas como leídas', marcadas: r.affectedRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al marcar las notificaciones' });
  }
};

module.exports = { getAll, getContador, marcarLeida, marcarTodasLeidas };
