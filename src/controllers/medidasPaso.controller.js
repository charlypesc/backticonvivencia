// Tarjeta "Medidas": un paso donde aparecen TODOS los involucrados del caso y a
// cada uno se le elige una medida, o "Sin medidas".
//
// La ley no trae un catálogo cerrado de medidas: nombra algunas y deja el
// detalle al reglamento interno. El listado se arma con lo que la normativa sí
// distingue, en cuatro grupos (CATALOGO_MEDIDAS, más abajo):
//
//  - De protección: resguardan a la persona afectada mientras se investiga y no
//    son sanción (Ley 21.809, art. 16 E letra j). La suspensión solo procede si
//    ninguna otra medida alcanza y no pasa de 15 días hábiles.
//  - Formativas, de apoyo y reparatorias: las que la Circular 482 (punto 2.6)
//    manda priorizar, y el apoyo psicosocial y la reparación del art. 16 E g y h.
//  - Disciplinarias: proporcionales y graduales, después de un procedimiento
//    justo (art. 16 E letra i; Circular 482, punto 2.5).
//  - Excepcionales: solo ante peligro real para la integridad de alguien,
//    justificadas antes de adoptarlas y con días hábiles (Circular 482, p. 47).
//
// Las formativas, disciplinarias y excepcionales son medidas sobre estudiantes
// (art. 16 E i): a un funcionario o a un externo solo se le ofrecen las de
// protección y "Sin medidas". La expulsión y la cancelación de matrícula no
// están: tienen su propio procedimiento (art. 6 letra d del DFL 2 y el informe
// de expulsión del caso).
//
// No hay tabla nueva para las medidas: se guardan en MEDIDA_PROTECCION y
// MEDIDA_DISCIPLINARIA, atadas al paso, para conservar sus plazos,
// vencimientos y el informe de expulsión. Lo único propio es
// PROTOCOLO_ACTIVADO_SIN_MEDIDA: dónde consta que a alguien no se le aplicó
// ninguna, y por qué.
const pool = require('../db/connection');
const { etiquetaDe } = require('../utils/etiquetas');
const { errorDeMedida, insertarMedida } = require('./medidasProteccion.controller');
const { errorDeMedidaDisciplinaria, insertarMedidaDisciplinaria } = require('./medidasDisciplinarias.controller');
const { etiquetaTipo, tiposProteccionPara, errorDeDestinatario } = require('../constants/medidasProteccion');

const { comprimirArchivo } = require('../utils/comprimirArchivo');
const { formatearNombreCurso } = require('../utils/curso');
const { construirDocumentoMedidaPdf } = require('../services/pdf/documentoMedida.pdf');
const { enviarPdf } = require('../services/pdf/comun');

const TIPO_PASO_MEDIDAS = 'medidas';

/**
 * Qué documento firmado pide cada medida de la tarjeta.
 *
 *  - La firma del director: las excepcionales y la condicionalidad. La ley no
 *    la exige para estas (solo para la expulsión, la cancelación y la
 *    suspensión cautelar, art. 6 letra d del DFL 2), pero son las más graves de
 *    la tarjeta; se decidió dejarlas firmadas por la dirección.
 * El resto no pide documento. (Hubo un acta del equipo de convivencia para las
 * formativas; se sacó: era papeleo que la ley no pide.)
 */
const DOCUMENTO_DE_MEDIDA = {
  suspension: 'resolucion_director',
  reduccion_jornada: 'resolucion_director',
  separacion_temporal: 'resolucion_director',
  asistencia_solo_evaluaciones: 'resolucion_director',
  condicionalidad: 'resolucion_director',
};
const SIN_MEDIDA = 'sin_medida';

/**
 * Los grupos del selector. `tabla` dice dónde se guarda; `soloEstudiantes`, a
 * quién se le puede aplicar. Cada opción viaja como `<tabla>:<tipo>`.
 */
const CATALOGO_MEDIDAS = [
  {
    grupo: 'proteccion',
    titulo: 'De protección (Ley 21.809, art. 16 E letra j)',
    tabla: 'p',
    soloEstudiantes: false,
    tipos: [
      'separacion_aula', 'prohibicion_contacto', 'cambio_curso', 'cambio_jornada', 'acompanamiento',
      'derivacion_red', 'resguardo_confidencialidad', 'reorganizacion_espacios', 'separacion_funciones',
      'teletrabajo', 'suspension',
    ],
  },
  {
    grupo: 'formativa',
    titulo: 'Formativas, de apoyo y reparatorias (art. 16 E letras g y h; Circular 482, 2.6)',
    tabla: 'd',
    soloEstudiantes: true,
    tipos: ['medida_formativa', 'medida_reparatoria', 'servicio_comunitario', 'derivacion', 'citacion_apoderado'],
  },
  {
    grupo: 'disciplinaria',
    titulo: 'Disciplinarias (art. 16 E letra i)',
    tabla: 'd',
    soloEstudiantes: true,
    tipos: ['amonestacion', 'retiro_sala', 'suspension_actividades', 'condicionalidad'],
  },
  {
    grupo: 'excepcional',
    titulo: 'Excepcionales: solo ante peligro real (Circular 482, p. 47)',
    tabla: 'd',
    soloEstudiantes: true,
    tipos: ['suspension', 'reduccion_jornada', 'separacion_temporal', 'asistencia_solo_evaluaciones'],
  },
];

/** `'p:suspension'` → { grupo, tabla, tipo } si existe en el catálogo. */
const leerOpcion = (opcion) => {
  const [tabla, tipo] = String(opcion ?? '').split(':');
  const grupo = CATALOGO_MEDIDAS.find((g) => g.tabla === tabla && g.tipos.includes(tipo));
  return grupo ? { ...grupo, tipo } : null;
};

const etiquetaMedida = (tabla, tipo) =>
  tabla === 'p' ? etiquetaTipo(tipo) : etiquetaDe(tipo, 'tipo_medida_disciplinaria');

const registrarEvento = (conn, { caso, paso, tipo, descripcion, id_usuario }) =>
  conn.query(
    `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
       (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [caso.id_protocolo_activado, caso.id_establecimiento, paso.id_activado_paso, tipo, descripcion, id_usuario]
  );

const quien = (i) => `${i.nombre} (${etiquetaDe(i.rol, 'rol_involucrado').toLowerCase()})`;

/**
 * Caso de este colegio y activo, paso suyo y de tipo "Medidas" ya iniciado (o
 * completado: se puede seguir agregando), e involucrado del caso. Responde el
 * error y devuelve null si algo falla.
 */
const contexto = async (req, res, id_involucrado) => {
  const [[caso]] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO WHERE id_protocolo_activado = ? AND id_establecimiento = ?',
    [req.params.id, req.id_establecimiento]
  );
  if (!caso) return res.status(404).json({ message: 'Protocolo activado no encontrado' }), null;
  if (caso.estado !== 'activo')
    return res.status(409).json({ message: `El protocolo está ${caso.estado}: ya no admite medidas.` }), null;
  const [[paso]] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO_PASO WHERE id_activado_paso = ? AND id_protocolo_activado = ?',
    [req.params.id_paso, req.params.id]
  );
  if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' }), null;
  if (paso.tipo_paso !== TIPO_PASO_MEDIDAS)
    return res.status(409).json({ message: 'Este paso no es de medidas.' }), null;
  if (!['en_curso', 'vencido', 'completado'].includes(paso.estado))
    return res.status(409).json({
      message: paso.estado === 'pendiente'
        ? 'Este paso todavía no está en curso: el protocolo no llegó hasta él.'
        : 'Este paso ya no admite medidas.',
    }), null;
  const [[involucrado]] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO_INVOLUCRADO WHERE id_involucrado = ? AND id_protocolo_activado = ?',
    [id_involucrado, req.params.id]
  );
  if (!involucrado) return res.status(404).json({ message: 'La persona no es un involucrado de este caso' }), null;
  return { caso, paso, involucrado };
};

// Una medida de protección mantenida en el paso cuenta como medida de la
// persona mientras siga vigente: si después se concluye, deja de contar y la
// persona vuelve a quedar pendiente.
const SQL_MANTENIDAS_VIGENTES = `
  SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO_MEDIDA_MANTENIDA k
  JOIN MEDIDA_PROTECCION mp ON mp.id_medida_proteccion = k.id_medida_proteccion AND mp.estado = 'vigente'
  WHERE k.id_activado_paso = ? AND mp.id_involucrado = ?`;

/** Cuántas medidas tiene ya la persona en este paso: las dos tablas y las mantenidas. */
const medidasEnPaso = async (db, id_activado_paso, id_involucrado) => {
  const [[{ n }]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM MEDIDA_PROTECCION WHERE id_activado_paso = ? AND id_involucrado = ?)
          + (SELECT COUNT(*) FROM MEDIDA_DISCIPLINARIA WHERE id_activado_paso = ? AND id_involucrado = ?)
          + (${SQL_MANTENIDAS_VIGENTES}) AS n`,
    [id_activado_paso, id_involucrado, id_activado_paso, id_involucrado, id_activado_paso, id_involucrado]
  );
  return Number(n);
};

/**
 * POST /:id/pasos/:id_paso/medidas
 * { id_involucrado, opcion: 'p:<tipo>' | 'd:<tipo>' | 'sin_medida', descripcion, fundamento, dias_habiles, motivo }
 */
const registrar = async (req, res) => {
  const { id_involucrado, opcion, descripcion, fundamento, dias_habiles, motivo } = req.body ?? {};
  if (!id_involucrado) return res.status(400).json({ message: 'Indica a quién se le aplica.' });
  if (!opcion) return res.status(400).json({ message: 'Elige la medida, o "Sin medidas".' });

  try {
    const ctx = await contexto(req, res, id_involucrado);
    if (!ctx) return;
    const { caso, paso, involucrado } = ctx;
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

    if (opcion === SIN_MEDIDA) {
      if ((await medidasEnPaso(pool, paso.id_activado_paso, involucrado.id_involucrado)) > 0)
        return res.status(409).json({ message: `${involucrado.nombre} ya tiene medidas en este paso.` });
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          `INSERT INTO PROTOCOLO_ACTIVADO_SIN_MEDIDA (id_activado_paso, id_involucrado, motivo, id_usuario)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE motivo = VALUES(motivo), id_usuario = VALUES(id_usuario)`,
          [paso.id_activado_paso, involucrado.id_involucrado, motivo?.trim() || null, req.user.id]
        );
        await registrarEvento(conn, {
          caso, paso, tipo: 'sin_medida', id_usuario: req.user.id,
          descripcion: `${paso.nombre} — sin medidas para ${quien(involucrado)}` +
            (motivo?.trim() ? `. Motivo: ${motivo.trim()}` : ''),
        });
        await conn.commit();
        return res.json({ message: 'Registrado: sin medidas' });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    const medida = leerOpcion(opcion);
    if (!medida) return res.status(400).json({ message: 'Esa medida no está en el listado.' });
    if (medida.soloEstudiantes && involucrado.tipo_persona !== 'estudiante')
      return res.status(400).json({
        message: 'Las medidas formativas, disciplinarias y excepcionales se aplican a estudiantes (art. 16 E ' +
          'letra i). A un funcionario o a un externo solo le corresponden las de protección.',
      });
    const dias = dias_habiles ? Number(dias_habiles) : null;
    const invalida = medida.tabla === 'p'
      ? errorDeMedida({ tipo: medida.tipo, fundamento, dias_habiles: dias }) ?? errorDeDestinatario(medida.tipo, involucrado)
      : errorDeMedidaDisciplinaria({ tipo_medida: medida.tipo, fundamento, dias_habiles: dias });
    if (invalida) return res.status(400).json({ message: invalida });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Si se había dicho "sin medidas", aplicar una lo corrige (queda en la bitácora).
      await conn.query(
        'DELETE FROM PROTOCOLO_ACTIVADO_SIN_MEDIDA WHERE id_activado_paso = ? AND id_involucrado = ?',
        [paso.id_activado_paso, involucrado.id_involucrado]
      );
      if (medida.tabla === 'p')
        await insertarMedida(conn, {
          id_protocolo_activado: caso.id_protocolo_activado,
          id_establecimiento: caso.id_establecimiento,
          id_usuario: req.user.id,
          tipo: medida.tipo,
          descripcion,
          fundamento,
          dias_habiles: dias,
          id_estudiante: involucrado.id_estudiante ?? null,
          id_involucrado: involucrado.id_involucrado,
          fecha_inicio: hoy,
          id_activado_paso: paso.id_activado_paso,
        });
      else
        await insertarMedidaDisciplinaria(conn, {
          id_registro: caso.id_registro,
          id_establecimiento: caso.id_establecimiento,
          id_usuario: req.user.id,
          // La columna no admite vacío: sin descripción, el nombre de la medida.
          descripcion: descripcion?.trim() || etiquetaMedida('d', medida.tipo),
          tipo_medida: medida.tipo,
          fundamento,
          dias_habiles: dias,
          fecha_aplicacion: hoy,
          id_estudiante: involucrado.id_estudiante ?? null,
          id_involucrado: involucrado.id_involucrado,
          id_activado_paso: paso.id_activado_paso,
        });
      await conn.commit();
      res.status(201).json({ message: `${etiquetaMedida(medida.tabla, medida.tipo)} registrada para ${involucrado.nombre}` });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la medida' });
  }
};

/** Las medidas y los "sin medida" de los pasos de medidas de un caso. */
const medidasDelCaso = async (db, id_protocolo_activado) => {
  const [proteccion] = await db.query(
    `SELECT m.id_medida_proteccion AS id, m.id_activado_paso, m.id_involucrado, m.tipo, m.descripcion,
            m.fundamento, m.dias_habiles, m.fecha_inicio AS fecha, m.fecha_termino, m.estado,
            u.nombre AS usuario_nombre, u.correo AS usuario_correo
     FROM MEDIDA_PROTECCION m
     JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = m.id_activado_paso AND p.tipo_paso = 'medidas'
     LEFT JOIN USUARIO u ON u.id_usuario = m.id_usuario
     WHERE m.id_protocolo_activado = ? ORDER BY m.id_medida_proteccion`,
    [id_protocolo_activado]
  );
  const [disciplinarias] = await db.query(
    `SELECT m.id_medida AS id, m.id_activado_paso, m.id_involucrado, m.tipo_medida AS tipo, m.descripcion,
            m.fundamento, m.dias_habiles, m.fecha_aplicacion AS fecha, m.fecha_termino, m.estado,
            u.nombre AS usuario_nombre, u.correo AS usuario_correo,
            a.fecha_subida AS documento_subido
     FROM MEDIDA_DISCIPLINARIA m
     LEFT JOIN MEDIDA_DISCIPLINARIA_ARCHIVO a ON a.id_medida = m.id_medida
     JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = m.id_activado_paso AND p.tipo_paso = 'medidas'
     LEFT JOIN USUARIO u ON u.id_usuario = m.id_usuario
     WHERE p.id_protocolo_activado = ? ORDER BY m.id_medida`,
    [id_protocolo_activado]
  );
  const [sin] = await db.query(
    `SELECT s.*, u.nombre AS usuario_nombre, u.correo AS usuario_correo
     FROM PROTOCOLO_ACTIVADO_SIN_MEDIDA s
     JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = s.id_activado_paso
     LEFT JOIN USUARIO u ON u.id_usuario = s.id_usuario
     WHERE p.id_protocolo_activado = ?`,
    [id_protocolo_activado]
  );
  // Las de protección adoptadas ANTES, en otro paso (el resguardo del inicio,
  // una tarjeta de medida de protección): la tarjeta "Medidas" es donde se
  // decide qué pasa con ellas, porque la ley solo las deja extenderse hasta la
  // conclusión del procedimiento (art. 16 E letra j). Van todas, también las ya
  // concluidas: el expediente tiene que poder decir que se mantuvo una que
  // después se cerró.
  const [previas] = await db.query(
    `SELECT m.id_medida_proteccion AS id, m.id_activado_paso, m.id_involucrado, m.tipo, m.descripcion,
            m.fundamento, m.dias_habiles, m.fecha_inicio AS fecha, m.fecha_termino, m.estado,
            p.nombre AS paso_nombre
     FROM MEDIDA_PROTECCION m
     LEFT JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = m.id_activado_paso
     WHERE m.id_protocolo_activado = ? AND (p.tipo_paso IS NULL OR p.tipo_paso <> 'medidas')
     ORDER BY m.id_medida_proteccion`,
    [id_protocolo_activado]
  );
  const [mantenidas] = await db.query(
    `SELECT k.*, u.nombre AS usuario_nombre, u.correo AS usuario_correo
     FROM PROTOCOLO_ACTIVADO_MEDIDA_MANTENIDA k
     JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = k.id_activado_paso
     LEFT JOIN USUARIO u ON u.id_usuario = k.id_usuario
     WHERE p.id_protocolo_activado = ?`,
    [id_protocolo_activado]
  );
  const medidas = [
    ...proteccion.map((m) => ({ ...m, tabla: 'p', etiqueta: etiquetaMedida('p', m.tipo) })),
    ...disciplinarias.map((m) => ({ ...m, tabla: 'd', etiqueta: etiquetaMedida('d', m.tipo) })),
  ];
  return {
    medidas, sin, mantenidas,
    previas: previas.map((m) => ({ ...m, etiqueta: etiquetaMedida('p', m.tipo) })),
  };
};

const hoySantiago = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

const fechaISO = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : f ? String(f).slice(0, 10) : null);

/**
 * Las medidas de protección de pasos anteriores que le tocan a la persona en
 * este paso: las vigentes (para decidir) y las que aquí se mantuvieron aunque
 * después se hayan concluido (para que conste).
 */
const previasDePersona = (paso, i, { previas = [], mantenidas = [] }) => {
  const hoy = hoySantiago();
  return previas
    .filter((m) => m.id_involucrado === i.id_involucrado)
    .map((m) => {
      const k = mantenidas.find((x) => x.id_activado_paso === paso.id_activado_paso && x.id_medida_proteccion === m.id);
      return {
        id: m.id, tipo: m.tipo, etiqueta: m.etiqueta, descripcion: m.descripcion, fundamento: m.fundamento,
        dias_habiles: m.dias_habiles, fecha: m.fecha, fecha_termino: m.fecha_termino, estado: m.estado,
        vencida: m.estado === 'vigente' && !!m.fecha_termino && fechaISO(m.fecha_termino) < hoy,
        paso_nombre: m.paso_nombre,
        mantenida: k ? { fecha: k.fecha_registro, registrado_por: k.usuario_nombre ?? k.usuario_correo } : null,
      };
    })
    .filter((m) => m.estado === 'vigente' || m.mantenida);
};

/** Por persona del caso: sus medidas en el paso, o si se dijo "sin medidas". */
const personasDeMedidas = (paso, involucrados, deMedidas) =>
  involucrados.map((i) => {
    const { medidas, sin } = deMedidas;
    const suyas = medidas.filter((m) => m.id_activado_paso === paso.id_activado_paso && m.id_involucrado === i.id_involucrado);
    const s = sin.find((x) => x.id_activado_paso === paso.id_activado_paso && x.id_involucrado === i.id_involucrado);
    return {
      id_involucrado: i.id_involucrado,
      nombre: i.nombre,
      rol: i.rol,
      tipo_persona: i.tipo_persona,
      curso: i.curso,
      // Las de protección que pueden recaer sobre esta persona (por su rol).
      tipos_proteccion: tiposProteccionPara(i),
      medidas: suyas.map((m) => ({
        id: m.id, tabla: m.tabla, tipo: m.tipo, etiqueta: m.etiqueta, descripcion: m.descripcion,
        fundamento: m.fundamento, dias_habiles: m.dias_habiles, fecha: m.fecha, fecha_termino: m.fecha_termino,
        estado: m.estado, registrado_por: m.usuario_nombre ?? m.usuario_correo,
        // El papel que pide la medida, si pide alguno, y si ya volvió firmado.
        documento: m.tabla === 'd' && DOCUMENTO_DE_MEDIDA[m.tipo]
          ? { tipo: DOCUMENTO_DE_MEDIDA[m.tipo], firmado: !!m.documento_subido, fecha_subida: m.documento_subido ?? null }
          : null,
      })),
      sin_medida: s ? { motivo: s.motivo, fecha: s.fecha_registro, registrado_por: s.usuario_nombre ?? s.usuario_correo } : null,
      previas: previasDePersona(paso, i, deMedidas),
    };
  });

/**
 * POST /:id/pasos/:id_paso/medidas/previas/:id_medida
 * { accion: 'mantener' | 'deshacer' | 'concluir' }
 *
 * Qué se hace en la tarjeta con una medida de protección vigente adoptada en
 * otro paso. Mantenerla cuenta como la medida de la persona; concluirla la
 * cierra (igual que "Finalizar" en Medidas de protección) y la persona queda
 * pendiente hasta que se le elija otra o "Sin medidas".
 */
const decidirPrevia = async (req, res) => {
  const { accion } = req.body ?? {};
  if (!['mantener', 'deshacer', 'concluir'].includes(accion))
    return res.status(400).json({ message: 'Acción inválida.' });

  try {
    const [[medida]] = await pool.query(
      `SELECT m.*, p.tipo_paso AS tipo_paso_origen FROM MEDIDA_PROTECCION m
       LEFT JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = m.id_activado_paso
       WHERE m.id_medida_proteccion = ? AND m.id_protocolo_activado = ?`,
      [req.params.id_medida, req.params.id]
    );
    if (!medida) return res.status(404).json({ message: 'Medida no encontrada en este caso' });
    if (!medida.id_involucrado)
      return res.status(409).json({ message: 'La medida no está asociada a un involucrado del caso.' });
    if (medida.tipo_paso_origen === TIPO_PASO_MEDIDAS)
      return res.status(409).json({ message: 'Esta medida se registró en una tarjeta de medidas, no en un paso anterior.' });

    const ctx = await contexto(req, res, medida.id_involucrado);
    if (!ctx) return;
    const { caso, paso, involucrado } = ctx;
    const etiqueta = etiquetaMedida('p', medida.tipo);

    if (accion !== 'deshacer' && medida.estado !== 'vigente')
      return res.status(409).json({ message: 'La medida ya no está vigente.' });

    const vencida = !!medida.fecha_termino && fechaISO(medida.fecha_termino) < hoySantiago();
    if (accion === 'mantener' && medida.tipo === 'suspension' && vencida)
      return res.status(409).json({
        message: 'La suspensión ya venció y la ley no permite extenderla (art. 16 E letra j): ' +
          'conclúyela y registra la medida que la sustituye.',
      });

    // Concluir una suspensión vencida con el caso abierto exige la medida que la
    // sustituye (art. 16 E letra j): sirve la de protección que se le registró
    // a la persona en esta misma tarjeta.
    let sustituta = null;
    if (accion === 'concluir' && medida.tipo === 'suspension' && vencida) {
      [[sustituta]] = await pool.query(
        `SELECT id_medida_proteccion AS id FROM MEDIDA_PROTECCION
         WHERE id_activado_paso = ? AND id_involucrado = ? AND estado = 'vigente'
         ORDER BY id_medida_proteccion DESC LIMIT 1`,
        [paso.id_activado_paso, involucrado.id_involucrado]
      );
      if (!sustituta)
        return res.status(409).json({
          message: 'La suspensión venció y el procedimiento sigue abierto: registra primero en esta tarjeta ' +
            'la medida de protección que la sustituye y después conclúyela (art. 16 E letra j).',
        });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (accion === 'mantener') {
        // Mantener una medida es tener medida: si se había dicho "sin medidas", se corrige.
        await conn.query(
          'DELETE FROM PROTOCOLO_ACTIVADO_SIN_MEDIDA WHERE id_activado_paso = ? AND id_involucrado = ?',
          [paso.id_activado_paso, involucrado.id_involucrado]
        );
        await conn.query(
          `INSERT IGNORE INTO PROTOCOLO_ACTIVADO_MEDIDA_MANTENIDA (id_activado_paso, id_medida_proteccion, id_usuario)
           VALUES (?, ?, ?)`,
          [paso.id_activado_paso, medida.id_medida_proteccion, req.user.id]
        );
        await registrarEvento(conn, {
          caso, paso, tipo: 'medida_mantenida', id_usuario: req.user.id,
          descripcion: `${paso.nombre} — se mantiene ${etiqueta.toLowerCase()} de ${quien(involucrado)}`,
        });
      } else if (accion === 'deshacer') {
        await conn.query(
          'DELETE FROM PROTOCOLO_ACTIVADO_MEDIDA_MANTENIDA WHERE id_activado_paso = ? AND id_medida_proteccion = ?',
          [paso.id_activado_paso, medida.id_medida_proteccion]
        );
        await registrarEvento(conn, {
          caso, paso, tipo: 'medida_mantenida', id_usuario: req.user.id,
          descripcion: `${paso.nombre} — se corrige: ya no se indica que se mantiene ${etiqueta.toLowerCase()} de ${quien(involucrado)}`,
        });
      } else {
        await conn.query(
          'UPDATE MEDIDA_PROTECCION SET estado = ?, id_medida_sustituye = ? WHERE id_medida_proteccion = ?',
          [sustituta ? 'sustituida' : 'concluida', sustituta?.id ?? null, medida.id_medida_proteccion]
        );
        // Si se había mantenido, la fila queda: el expediente dice "se mantuvo,
        // después concluida". Deja de contar como medida porque ya no está vigente.
        await registrarEvento(conn, {
          caso, paso, tipo: 'medida_proteccion_finalizada', id_usuario: req.user.id,
          descripcion: `${paso.nombre} — ${etiqueta} de ${quien(involucrado)} ` +
            (sustituta ? 'sustituida por otra medida' : 'concluida'),
        });
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.json({
      message: accion === 'mantener' ? `${etiqueta}: se mantiene para ${involucrado.nombre}`
        : accion === 'deshacer' ? 'Corregido'
        : `${etiqueta} de ${involucrado.nombre}: concluida`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al guardar la decisión sobre la medida' });
  }
};

/**
 * La medida disciplinaria de una tarjeta "Medidas" de este caso y colegio, con
 * lo que hace falta para su documento. null si no es de acá.
 */
const buscarMedidaDelCaso = async (req) => {
  const [[m]] = await pool.query(
    `SELECT m.*, i.nombre, i.rut, i.curso, i.rol,
            pa.id_protocolo_activado, pa.codigo AS caso_codigo, pa.nombre_protocolo, pa.id_establecimiento AS est
     FROM MEDIDA_DISCIPLINARIA m
     JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = m.id_activado_paso AND p.tipo_paso = 'medidas'
     JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = p.id_protocolo_activado
     LEFT JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i ON i.id_involucrado = m.id_involucrado
     WHERE m.id_medida = ? AND pa.id_protocolo_activado = ? AND pa.id_establecimiento = ?`,
    [req.params.id_medida, req.params.id, req.id_establecimiento]
  );
  return m ?? null;
};

/** GET /:id/medidas/:id_medida/documento-pdf — el papel en blanco para firmar. */
const generarDocumento = async (req, res) => {
  try {
    const m = await buscarMedidaDelCaso(req);
    if (!m) return res.status(404).json({ message: 'Medida no encontrada en este caso' });
    const tipo = DOCUMENTO_DE_MEDIDA[m.tipo_medida];
    if (!tipo) return res.status(409).json({ message: 'Esta medida no pide documento firmado.' });

    const [[registro]] = await pool.query(
      `SELECT r.codigo, r.asunto, r.fecha_incidente, e.nombre AS establecimiento_nombre, e.rbd
       FROM REGISTRO_CONVIVENCIA r JOIN ESTABLECIMIENTO e ON e.id_establecimiento = r.id_establecimiento
       WHERE r.id_registro = ?`,
      [m.id_registro]
    );
    // El director del colegio, para escribir su nombre bajo la firma.
    const [[director]] = await pool.query(
      `SELECT u.nombre FROM USUARIO u
       JOIN USUARIO_ROLES ur ON ur.id_usuario = u.id_usuario AND (ur.expira_at IS NULL OR ur.expira_at > NOW())
       JOIN ROLES ro ON ro.rol_id = ur.rol_id AND ro.codigo = 'DIRECTOR'
       WHERE u.id_establecimiento = ? AND u.activo = 1 LIMIT 1`,
      [m.est]
    );
    const [[emisor]] = await pool.query(
      `SELECT u.nombre, u.correo,
              (SELECT ro.nombre FROM USUARIO_ROLES uro JOIN ROLES ro ON ro.rol_id = uro.rol_id AND ro.activo = TRUE
                WHERE uro.id_usuario = u.id_usuario AND (uro.expira_at IS NULL OR uro.expira_at > NOW()) LIMIT 1) AS cargo
       FROM USUARIO u WHERE u.id_usuario = ?`,
      [req.user.id]
    );
    const { buffer, nombre } = construirDocumentoMedidaPdf({
      tipo,
      establecimiento: { nombre: registro?.establecimiento_nombre, rbd: registro?.rbd },
      caso: {
        id: m.id_protocolo_activado, codigo: m.caso_codigo, protocolo: m.nombre_protocolo,
        registro_codigo: registro?.codigo, asunto: registro?.asunto, fecha_incidente: registro?.fecha_incidente,
      },
      persona: {
        nombre: m.nombre ?? '', rut: m.rut, curso: formatearNombreCurso(m.curso),
        rol: m.rol ? etiquetaDe(m.rol, 'rol_involucrado') : '',
      },
      medida: {
        tipo: m.tipo_medida,
        etiqueta: etiquetaMedida('d', m.tipo_medida), descripcion: m.descripcion, fundamento: m.fundamento,
        dias_habiles: m.dias_habiles, fecha_aplicacion: m.fecha_aplicacion, fecha_termino: m.fecha_termino,
      },
      director: director ?? null,
      emisor: { nombre: emisor?.nombre ?? '', cargo: emisor?.cargo ?? '', correo: emisor?.correo ?? '' },
    });
    enviarPdf(res, buffer, nombre);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al generar el documento' });
  }
};

/** PUT /:id/medidas/:id_medida/documento — el documento firmado (archivo). */
const subirDocumento = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No se recibió archivo' });
  try {
    const m = await buscarMedidaDelCaso(req);
    if (!m) return res.status(404).json({ message: 'Medida no encontrada en este caso' });
    const tipo = DOCUMENTO_DE_MEDIDA[m.tipo_medida];
    if (!tipo) return res.status(409).json({ message: 'Esta medida no pide documento firmado.' });
    // Entra cualquier foto o escaneo: el sistema lo baja de peso, no lo rechaza.
    const archivo = await comprimirArchivo(req.file);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO MEDIDA_DISCIPLINARIA_ARCHIVO
           (id_medida, tipo_documento, nombre_archivo, mime_type, peso_bytes, contenido, id_usuario, fecha_subida)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE tipo_documento = VALUES(tipo_documento), nombre_archivo = VALUES(nombre_archivo),
           mime_type = VALUES(mime_type), peso_bytes = VALUES(peso_bytes), contenido = VALUES(contenido),
           id_usuario = VALUES(id_usuario), fecha_subida = NOW()`,
        [m.id_medida, tipo, archivo.originalname, archivo.mimetype, archivo.size, archivo.buffer, req.user.id]
      );
      await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
           (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
         VALUES (?, ?, ?, 'medida_documento', ?, ?, NOW())`,
        [m.id_protocolo_activado, m.est, m.id_activado_paso,
         `${etiquetaMedida('d', m.tipo_medida)} de ${m.nombre}: se sube la resolución firmada por el director`,
         req.user.id]
      );
      await conn.commit();
      res.json({ message: 'Documento firmado subido', bytes: archivo.size, bytes_originales: archivo.bytes_originales });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al subir el documento' });
  }
};

/** GET /:id/medidas/:id_medida/documento — el firmado, para verlo. */
const verDocumento = async (req, res) => {
  try {
    const m = await buscarMedidaDelCaso(req);
    if (!m) return res.status(404).json({ message: 'Medida no encontrada en este caso' });
    const [[a]] = await pool.query(
      'SELECT nombre_archivo, mime_type, contenido FROM MEDIDA_DISCIPLINARIA_ARCHIVO WHERE id_medida = ?',
      [m.id_medida]
    );
    if (!a) return res.status(404).json({ message: 'Esta medida todavía no tiene documento firmado' });
    res.setHeader('Content-Type', a.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.nombre_archivo)}"`);
    res.send(a.contenido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el documento' });
  }
};

/** Qué impide completar el paso: personas sin medida ni "sin medidas". */
const faltantesDeMedidas = async (db, paso) => {
  const [personas] = await db.query(
    `SELECT i.nombre,
            (SELECT COUNT(*) FROM MEDIDA_PROTECCION m WHERE m.id_activado_paso = ? AND m.id_involucrado = i.id_involucrado)
          + (SELECT COUNT(*) FROM MEDIDA_DISCIPLINARIA m WHERE m.id_activado_paso = ? AND m.id_involucrado = i.id_involucrado)
          + (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO_SIN_MEDIDA s WHERE s.id_activado_paso = ? AND s.id_involucrado = i.id_involucrado)
          + (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO_MEDIDA_MANTENIDA k
               JOIN MEDIDA_PROTECCION mp ON mp.id_medida_proteccion = k.id_medida_proteccion AND mp.estado = 'vigente'
              WHERE k.id_activado_paso = ? AND mp.id_involucrado = i.id_involucrado)
            AS hay
     FROM PROTOCOLO_ACTIVADO_INVOLUCRADO i WHERE i.id_protocolo_activado = ?`,
    [paso.id_activado_paso, paso.id_activado_paso, paso.id_activado_paso, paso.id_activado_paso, paso.id_protocolo_activado]
  );
  if (personas.length === 0) return ['El caso no tiene involucrados.'];
  const faltan = personas.filter((p) => Number(p.hay) === 0).map((p) => p.nombre);
  return faltan.length ? [`Falta indicar la medida (o "Sin medidas") de: ${faltan.join(', ')}.`] : [];
};

module.exports = {
  TIPO_PASO_MEDIDAS, SIN_MEDIDA, CATALOGO_MEDIDAS,
  DOCUMENTO_DE_MEDIDA,
  registrar, decidirPrevia, medidasDelCaso, personasDeMedidas, previasDePersona, faltantesDeMedidas,
  generarDocumento, subirDocumento, verDocumento,
};
