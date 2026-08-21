const pool = require('../db/connection');
const XLSX = require('xlsx');
const crypto = require('crypto');

// Jobs de importación en memoria: { job_id -> estado }. Un solo proceso Node,
// vida corta (minutos) — no hace falta persistirlo en BD ni en Redis.
const importJobs = new Map();

// "1° básico" / "1° Básico" / "1 Medio" → { grado, nivel, nombreBase }
const normalizarGrado = (descGrado) => {
  const match = String(descGrado || '').match(/(\d+)\D*(b[aá]sic|medi)/i);
  if (!match) return null;
  const numero = match[1];
  const esBasico = /b[aá]sic/i.test(match[2]);
  return {
    grado: `${numero}° ${esBasico ? 'Básico' : 'Medio'}`,
    nivel: esBasico ? 'Básica' : 'Media',
    nombreBase: `${numero}${esBasico ? 'Basico' : 'Medio'}`,
  };
};

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*,
              EXISTS (
                SELECT 1 FROM ESTUDIANTE e
                JOIN REGISTRO_ESTUDIANTE re ON re.id_estudiante = e.id_estudiante
                WHERE e.id_curso = c.id_curso
              ) AS tiene_registros
       FROM CURSO c
       WHERE c.id_establecimiento = ?
       ORDER BY c.nivel, c.grado, c.nombre`,
      [req.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener cursos' });
  }
};

const create = async (req, res) => {
  const { nombre, grado, nivel } = req.body;

  if (!nombre || !grado || !nivel)
    return res.status(400).json({ message: 'Nombre, grado y nivel son requeridos' });

  try {
    const [result] = await pool.query(
      `INSERT INTO CURSO (nombre, grado, nivel, id_establecimiento)
       VALUES (?, ?, ?, ?)`,
      [nombre, grado, nivel, req.id_establecimiento]
    );
    res.status(201).json({ id_curso: result.insertId, message: 'Curso creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear curso' });
  }
};

const update = async (req, res) => {
  const { nombre, grado, nivel } = req.body;

  try {
    await pool.query(
      `UPDATE CURSO SET nombre=?, grado=?, nivel=?
       WHERE id_curso = ? AND id_establecimiento = ?`,
      [nombre, grado, nivel, req.params.id, req.id_establecimiento]
    );
    res.json({ message: 'Curso actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM CURSO
       WHERE id_curso = ? AND id_establecimiento = ?`,
      [req.params.id, req.id_establecimiento]
    );
    res.json({ message: 'Curso eliminado' });
  } catch (err) {
    // FK constraint — hay estudiantes matriculados en el curso
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({
        message: 'No es posible eliminar un curso con estudiantes matriculados. Reasigne los estudiantes primero.'
      });
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

// Procesa el archivo en background y va actualizando el job en importJobs
// para que el frontend pueda consultar el avance fila a fila.
const procesarImportacion = async (job, filas, id_establecimiento) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [cursosExistentes] = await conn.query(
      `SELECT id_curso, nombre FROM CURSO WHERE id_establecimiento = ?`,
      [id_establecimiento]
    );
    const cursosPorNombre = new Map(cursosExistentes.map((c) => [c.nombre, c.id_curso]));

    const [estudiantesExistentes] = await conn.query(
      `SELECT run FROM ESTUDIANTE WHERE id_establecimiento = ?`,
      [id_establecimiento]
    );
    const runsExistentes = new Set(estudiantesExistentes.map((e) => String(e.run)));

    for (const fila of filas) {
      const info = normalizarGrado(fila['Desc Grado']);
      const letra = String(fila['Letra Curso'] || '').trim().toUpperCase();
      const run = String(fila['Run'] || '').trim();
      const dv = String(fila['Dígito Ver.'] ?? '').trim().toUpperCase();
      const sexo = String(fila['Genero'] || '').trim().toUpperCase();
      const nombre = String(fila['Nombres'] || '').trim();
      const apellidoPaterno = String(fila['Apellido Paterno'] || '').trim();
      const apellidoMaterno = String(fila['Apellido Materno'] || '').trim();

      if (!info || !letra || !run || !nombre) {
        job.filas_invalidas++;
        job.procesadas++;
        continue;
      }

      const nombreCurso = `${info.nombreBase}${letra}`;
      let id_curso = cursosPorNombre.get(nombreCurso);
      if (!id_curso) {
        const [result] = await conn.query(
          `INSERT INTO CURSO (nombre, grado, nivel, id_establecimiento) VALUES (?, ?, ?, ?)`,
          [nombreCurso, info.grado, info.nivel, id_establecimiento]
        );
        id_curso = result.insertId;
        cursosPorNombre.set(nombreCurso, id_curso);
        job.cursos_creados++;
      }

      if (runsExistentes.has(run)) {
        job.estudiantes_omitidos++;
        job.procesadas++;
        continue;
      }

      const apellido = `${apellidoPaterno} ${apellidoMaterno}`.trim();
      await conn.query(
        `INSERT INTO ESTUDIANTE (run, dv, nombre, apellido, sexo, id_curso, id_establecimiento)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [run, dv, nombre, apellido, sexo, id_curso, id_establecimiento]
      );
      runsExistentes.add(run);
      job.estudiantes_creados++;
      job.procesadas++;
    }

    await conn.commit();
    job.estado = 'completado';
  } catch (err) {
    await conn.rollback();
    console.error(err);
    job.estado = 'error';
    job.message = 'Error al importar el archivo';
  } finally {
    conn.release();
    // Se limpia solo unos minutos después para que el frontend alcance a leer el resultado final.
    setTimeout(() => importJobs.delete(job.job_id), 5 * 60 * 1000);
  }
};

// Importa el Excel estándar (Desc Grado, Letra Curso, Run, Dígito Ver., Genero,
// Nombres, Apellido Paterno, Apellido Materno): crea los cursos que falten y da
// de alta cada estudiante en su curso correspondiente. Salta RUN ya existentes.
// Responde enseguida con un job_id; el progreso real se consulta con getProgreso.
const importarExcel = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No se recibió archivo' });

  let filas;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = workbook.Sheets[workbook.SheetNames[0]];
    filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
  } catch (err) {
    return res.status(400).json({ message: 'No se pudo leer el archivo. Verifique que sea un Excel válido.' });
  }

  const job = {
    job_id: crypto.randomUUID(),
    id_establecimiento: req.id_establecimiento,
    total: filas.length,
    procesadas: 0,
    cursos_creados: 0,
    estudiantes_creados: 0,
    estudiantes_omitidos: 0,
    filas_invalidas: 0,
    estado: 'procesando', // 'procesando' | 'completado' | 'error'
  };
  importJobs.set(job.job_id, job);

  // No se espera (no await): el request responde de inmediato y el trabajo
  // sigue en background, actualizando el mismo objeto `job` en el Map.
  procesarImportacion(job, filas, job.id_establecimiento);

  res.status(202).json({ job_id: job.job_id, total: job.total });
};

const getProgresoImportacion = (req, res) => {
  const job = importJobs.get(req.params.jobId);
  if (!job || job.id_establecimiento !== req.id_establecimiento)
    return res.status(404).json({ message: 'Importación no encontrada' });

  const { id_establecimiento, ...progreso } = job;
  res.json(progreso);
};

// GET /api/cursos/resumen-eliminacion
// Qué se llevaría por delante un borrado masivo, para poder avisarlo en el
// modal de confirmación con números reales en vez de un texto genérico.
const resumenEliminacion = async (req, res) => {
  try {
    const est = req.id_establecimiento;
    const [[r]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM CURSO WHERE id_establecimiento = ?) AS cursos,
         (SELECT COUNT(*) FROM ESTUDIANTE WHERE id_establecimiento = ?) AS estudiantes,
         (SELECT COUNT(DISTINCT re.id_estudiante)
            FROM REGISTRO_ESTUDIANTE re
            JOIN ESTUDIANTE e ON e.id_estudiante = re.id_estudiante
           WHERE e.id_establecimiento = ?) AS estudiantes_con_registros`,
      [est, est, est]
    );
    res.json(r);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el resumen' });
  }
};

// DELETE /api/cursos — borrado masivo (deshacer una importación)
//
// Se niega si algún estudiante figura en un registro de convivencia: eso es
// historial de casos de menores y no puede desaparecer como efecto secundario
// de limpiar una importación. Para esos casos hay que borrar el registro
// primero, de forma deliberada.
const eliminarTodos = async (req, res) => {
  const est = req.id_establecimiento;
  const conn = await pool.getConnection();
  try {
    const [[{ bloqueados }]] = await conn.query(
      `SELECT COUNT(DISTINCT re.id_estudiante) AS bloqueados
         FROM REGISTRO_ESTUDIANTE re
         JOIN ESTUDIANTE e ON e.id_estudiante = re.id_estudiante
        WHERE e.id_establecimiento = ?`,
      [est]
    );

    if (bloqueados > 0) {
      conn.release();
      return res.status(409).json({
        message:
          `No se puede eliminar: ${bloqueados} estudiante(s) están asociados a registros de ` +
          `convivencia. Eliminá primero esos registros si realmente querés borrarlos.`,
        estudiantes_con_registros: bloqueados,
      });
    }

    await conn.beginTransaction();
    // Los estudiantes van primero: ESTUDIANTE.id_curso -> CURSO es NO ACTION,
    // así que borrar los cursos con alumnos dentro fallaría.
    const [e] = await conn.query(`DELETE FROM ESTUDIANTE WHERE id_establecimiento = ?`, [est]);
    const [c] = await conn.query(`DELETE FROM CURSO WHERE id_establecimiento = ?`, [est]);
    await conn.commit();

    res.json({
      message: `Se eliminaron ${c.affectedRows} curso(s) y ${e.affectedRows} estudiante(s).`,
      cursos_eliminados: c.affectedRows,
      estudiantes_eliminados: e.affectedRows,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar los cursos' });
  } finally {
    conn.release();
  }
};

module.exports = {
  getAll, create, update, remove, importarExcel, getProgresoImportacion,
  resumenEliminacion, eliminarTodos,
};
