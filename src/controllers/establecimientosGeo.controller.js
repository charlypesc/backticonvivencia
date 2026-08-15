const pool = require('../db/connection');
const XLSX = require('xlsx');
const crypto = require('crypto');

// Jobs de importación en memoria: { job_id -> estado }. Un solo proceso Node,
// vida corta (minutos) — no hace falta persistirlo en BD ni en Redis.
const importJobs = new Map();

// Evita dos imports corriendo en paralelo: si el usuario "interrumpe" la
// carga (cierra la pestaña, navega afuera) el job del backend sigue vivo
// igual porque importarExcel no espera a procesarImportacion — sin esta
// traba, reintentar arrancaba un segundo job que competía por los mismos
// locks de fila contra el primero y ambos quedaban trabados sin avanzar.
let importacionEnCurso = false;

const TAMANO_LOTE = 300; // filas por commit — ver nota en procesarImportacion

// Quita paréntesis y su contenido, normaliza apóstrofos y elimina tildes —
// mismo criterio que usaba el import de establecimientos del proyecto de
// referencia para poder matchear "Cabo de Hornos (Ex - Navarino)" con
// "Cabo de Hornos" en la BD.
const normalizar = (texto) => {
  texto = String(texto || '').replace(/\s*\(.*?\)/g, '').trim();
  texto = texto.replace(/[’‘ʼ]/g, "'");
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
};

const getAll = async (req, res) => {
  try {
    const { id_comuna, rbd } = req.query;

    // Búsqueda global por RBD (no acotada a una comuna) — se usa desde el
    // buscador de Geo para saltar directo a un establecimiento sin tener que
    // navegar Región → Provincia → Comuna a mano.
    if (rbd) {
      const [rows] = await pool.query(
        `SELECT * FROM ESTABLECIMIENTO_GEO WHERE rbd LIKE ? ORDER BY nombre LIMIT 20`,
        [`%${rbd}%`]
      );
      return res.json(rows);
    }

    const where = id_comuna ? `WHERE id_comuna = ?` : '';
    const params = id_comuna ? [id_comuna] : [];
    const [rows] = await pool.query(
      `SELECT * FROM ESTABLECIMIENTO_GEO ${where} ORDER BY nombre`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los establecimientos' });
  }
};

const create = async (req, res) => {
  const { nombre, rbd, direccion, telefono, correo, tipo_dependencia, id_comuna, id_sostenedor } = req.body;

  if (!nombre || !rbd || !id_comuna)
    return res.status(400).json({ message: 'Nombre, RBD y comuna son requeridos' });

  try {
    const [result] = await pool.query(
      `INSERT INTO ESTABLECIMIENTO_GEO (nombre, rbd, direccion, telefono, correo, tipo_dependencia, id_comuna, id_sostenedor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre, rbd, direccion || null, telefono || null, correo || null, tipo_dependencia || null, id_comuna, id_sostenedor || null]
    );
    res.status(201).json({ id_establecimiento_geo: result.insertId, message: 'Establecimiento creado' });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'RBD ya registrado' });
    res.status(500).json({ message: 'Error al crear el establecimiento' });
  }
};

const update = async (req, res) => {
  const { nombre, rbd, direccion, telefono, correo, tipo_dependencia, id_comuna, id_sostenedor } = req.body;

  if (!nombre || !rbd || !id_comuna)
    return res.status(400).json({ message: 'Nombre, RBD y comuna son requeridos' });

  try {
    await pool.query(
      `UPDATE ESTABLECIMIENTO_GEO
       SET nombre=?, rbd=?, direccion=?, telefono=?, correo=?, tipo_dependencia=?, id_comuna=?, id_sostenedor=?
       WHERE id_establecimiento_geo = ?`,
      [nombre, rbd, direccion || null, telefono || null, correo || null, tipo_dependencia || null, id_comuna, id_sostenedor || null, req.params.id]
    );
    res.json({ message: 'Establecimiento actualizado' });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'RBD ya registrado' });
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(`DELETE FROM ESTABLECIMIENTO_GEO WHERE id_establecimiento_geo = ?`, [req.params.id]);
    res.json({ message: 'Establecimiento eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

// Procesa el archivo en background y va actualizando el job en importJobs
// para que el frontend pueda consultar el avance fila a fila.
//
// Commitea de a lotes (TAMANO_LOTE filas) en vez de envolver las ~8000 filas
// en una única transacción: con una sola transacción gigante, cualquier corte
// a mitad de camino (o dos imports pisándose) perdía todo el trabajo y podía
// dejar locks abiertos sobre la tabla por minutos. Con lotes chicos cada
// commit persiste de verdad (el progreso en pantalla refleja filas ya
// guardadas, no solo contadas), y si el proceso se corta el reintento es
// seguro: los RBD ya insertados se saltan como "omitidos".
const procesarImportacion = async (job, filas) => {
  try {
    const [rbdsRows] = await pool.query(`SELECT rbd FROM ESTABLECIMIENTO_GEO`);
    const rbdsExistentes = new Set(rbdsRows.map((r) => String(r.rbd).toUpperCase()));

    const [comunasRows] = await pool.query(
      `SELECT c.id_comuna, c.nombre AS comuna_nombre, p.nombre AS provincia_nombre
       FROM COMUNA c JOIN PROVINCIA p ON c.id_provincia = p.id_provincia`
    );
    const comunasPorClave = new Map(
      comunasRows.map((c) => [`${normalizar(c.comuna_nombre)}|${normalizar(c.provincia_nombre)}`, c.id_comuna])
    );

    let lote = [];

    const commitLote = async () => {
      if (lote.length === 0) return;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const fila of lote) {
          await conn.query(
            `INSERT INTO ESTABLECIMIENTO_GEO (nombre, rbd, direccion, telefono, correo, tipo_dependencia, id_comuna)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [fila.nombre, fila.rbd, fila.direccion, fila.telefono, fila.correo, fila.tipoDependencia, fila.id_comuna]
          );
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      lote = [];
    };

    for (const fila of filas) {
      try {
        const idRbd = String(fila['ID_RBD'] || '').trim();
        const dvRbd = String(fila['DV_RBD'] || '').trim();
        const rbd = dvRbd ? `${idRbd}-${dvRbd}` : idRbd;
        const nombre = String(fila['DS_NOM_ESTABLE'] || '').trim();
        const provincia = String(fila['PROVINCIA'] || '').trim();
        const comunaNombre = String(fila['COMUNA'] || '').trim();
        const tipoDependencia = String(fila['TIPO DEPENDENCIA'] || '').trim();
        const direccion = String(fila['DIRECCION'] || '').trim();
        const telefono = String(fila['NUMERO DE TELEFONO'] || '').trim();
        const correo = String(fila['CORREO ELECTRONICO'] || '').trim();

        if (!idRbd || !nombre) {
          job.filas_invalidas++;
          job.procesadas++;
          continue;
        }

        if (rbdsExistentes.has(rbd.toUpperCase())) {
          job.omitidos++;
          job.procesadas++;
          continue;
        }

        const clave = `${normalizar(comunaNombre)}|${normalizar(provincia)}`;
        const id_comuna = comunasPorClave.get(clave);
        if (!id_comuna) {
          job.omitidos++;
          job.procesadas++;
          continue;
        }

        lote.push({
          nombre,
          rbd,
          direccion: direccion || null,
          telefono: telefono || null,
          correo: correo || null,
          tipoDependencia: tipoDependencia || null,
          id_comuna,
        });
        rbdsExistentes.add(rbd.toUpperCase());
        job.importados++;
        job.procesadas++;

        if (lote.length >= TAMANO_LOTE) await commitLote();
      } catch (err) {
        job.filas_invalidas++;
        job.procesadas++;
      }
    }

    await commitLote();
    job.estado = 'completado';
  } catch (err) {
    console.error(err);
    job.estado = 'error';
    job.message = 'Error al importar el archivo';
  } finally {
    importacionEnCurso = false;
    // Se limpia solo unos minutos después para que el frontend alcance a leer el resultado final.
    setTimeout(() => importJobs.delete(job.job_id), 5 * 60 * 1000);
  }
};

// Importa el Excel oficial de RBD (ID_RBD, DV_RBD, DS_NOM_ESTABLE, REGION,
// PROVINCIA, COMUNA, TIPO DEPENDENCIA, DIRECCION, NUMERO DE TELEFONO,
// CORREO ELECTRONICO, MATRICULAS, NOMBRE_MIME): matchea la comuna por
// nombre+provincia contra el catálogo Geo ya sembrado, salta RBD duplicados.
// Responde enseguida con un job_id; el progreso real se consulta con getProgreso.
const importarExcel = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No se recibió archivo' });

  if (importacionEnCurso)
    return res.status(409).json({ message: 'Ya hay una importación en curso. Espere a que termine antes de reintentar.' });

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
    total: filas.length,
    procesadas: 0,
    importados: 0,
    omitidos: 0,
    filas_invalidas: 0,
    estado: 'procesando', // 'procesando' | 'completado' | 'error'
  };
  importJobs.set(job.job_id, job);
  importacionEnCurso = true;

  // No se espera (no await): el request responde de inmediato y el trabajo
  // sigue en background, actualizando el mismo objeto `job` en el Map.
  procesarImportacion(job, filas);

  res.status(202).json({ job_id: job.job_id, total: job.total });
};

const getProgresoImportacion = (req, res) => {
  const job = importJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Importación no encontrada' });
  res.json(job);
};

module.exports = { getAll, create, update, remove, importarExcel, getProgresoImportacion };
