const pool = require('../db/connection');

// GET /api/estudiantes — filtra por establecimiento del usuario
const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, c.nombre AS curso_nombre, c.grado
       FROM ESTUDIANTE e
       JOIN CURSO c ON e.id_curso = c.id_curso
       WHERE e.id_establecimiento = ? AND e.activo = 1
       ORDER BY e.apellido, e.nombre`,
      [req.user.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener estudiantes' });
  }
};

module.exports = { getAll };