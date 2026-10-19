// Tarjeta "Medidas de protección" para las dos partes (prueba).
//
// Una lista de acciones concretas, ya redactadas con el nombre de cada persona
// ("Suspender a Lucas", "Acompañamiento psicosocial para Renata"): se marcan
// las que corresponden y se aplican. No hay que decidir sobre quién recae ni a
// quién protege, porque cada línea ya lo dice:
//
//  - Lo que se hace sobre el señalado protege a TODAS las personas afectadas
//    (Ley 21.809 art. 16 E letra j: la medida es "para la persona afectada",
//    pero el ejemplo de la ley es suspender al denunciado). Suspender a Lucas es
//    una sola medida aunque haya dos afectados.
//  - Lo que va para un afectado (su acompañamiento, su derivación) es solo suyo.
//
// Al aplicar, cada parte queda resuelta: con su medida, o "No corresponde" si
// no recae nada sobre ella. "No se aplican medidas" va una vez, con su motivo,
// para todo el paso.
//
// Solo en los pasos de protección que alcanzan a las dos partes
// (por_involucrado_rol 'todos'); los que alcanzan solo al afectado siguen con
// la fila por persona de siempre.
const pool = require('../db/connection');
const { errorDeMedida, insertarMedida } = require('./medidasProteccion.controller');
const { etiquetaTipo } = require('../constants/medidasProteccion');

/** ¿Este paso usa esta tarjeta? */
const esProteccionPorAfectado = (p) =>
  p?.tipo_medida_requerida === 'proteccion' && p?.por_involucrado_rol === 'todos';

// Qué se ofrece en la lista, por rol. La lista es corta a propósito: solo lo
// concreto. Cambiar de curso a la víctima (cuando lo pide la familia) y "otra
// medida" quedan fuera de esta tarjeta.
const OPCIONES_SENALADO_ESTUDIANTE = ['suspension', 'prohibicion_contacto', 'separacion_aula', 'cambio_curso', 'cambio_jornada'];
const OPCIONES_SENALADO_ADULTO = ['separacion_funciones', 'teletrabajo', 'prohibicion_contacto'];
const OPCIONES_AFECTADO = ['acompanamiento', 'derivacion_red', 'resguardo_confidencialidad'];

const opcionesPara = (i) =>
  i.rol === 'afectado' ? OPCIONES_AFECTADO
    : i.rol === 'senalado' ? (i.tipo_persona === 'estudiante' ? OPCIONES_SENALADO_ESTUDIANTE : OPCIONES_SENALADO_ADULTO)
    : [];

const primerNombre = (n) => String(n ?? '').split(' ')[0];
const lista = (nombres) =>
  nombres.length <= 1 ? nombres.join('') : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;

/** La acción, dicha con el nombre de la persona. */
const frase = (tipo, persona, afectados) => {
  const n = primerNombre(persona.nombre);
  const con = lista(afectados.map((a) => primerNombre(a.nombre)));
  return {
    suspension: `Suspender a ${n}`,
    prohibicion_contacto: `Prohibir a ${n} el contacto con ${con || 'la persona afectada'}`,
    separacion_aula: `Separar de aula a ${n}`,
    cambio_curso: `Cambiar de curso a ${n}`,
    cambio_jornada: `Cambiar de jornada a ${n}`,
    separacion_funciones: `Separar de funciones a ${n}`,
    teletrabajo: `Teletrabajo para ${n}`,
    acompanamiento: `Acompañamiento psicosocial para ${n}`,
    derivacion_red: `Derivar a ${n} a una red externa`,
    resguardo_confidencialidad: `Resguardar la confidencialidad de ${n}`,
  }[tipo] ?? `${etiquetaTipo(tipo)} (${n})`;
};

const hoySantiago = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

/** Las medidas de protección registradas en pasos de este caso. */
const medidasDeProteccion = async (db, id_protocolo_activado) => {
  const [rows] = await db.query(
    `SELECT m.id_medida_proteccion AS id, m.id_activado_paso, m.id_involucrado, m.tipo, m.fundamento,
            m.dias_habiles, m.fecha_inicio AS fecha, m.fecha_termino, m.estado
     FROM MEDIDA_PROTECCION m
     WHERE m.id_protocolo_activado = ? AND m.id_activado_paso IS NOT NULL
     ORDER BY m.id_medida_proteccion`,
    [id_protocolo_activado]
  );
  return rows;
};

/**
 * Lo que dibuja la tarjeta. `suyos` son las filas de cumplimiento del paso (una
 * por parte, con el nombre, rol y tipo de persona del involucrado).
 */
const partesDeProteccion = (paso, suyos, medidas) => {
  const delPaso = medidas.filter((m) => m.id_activado_paso === paso.id_activado_paso);
  const afectados = suyos.filter((g) => g.involucrado_rol === 'afectado').map((g) => ({ nombre: g.involucrado_nombre }));
  const persona = (g) => ({ id_involucrado: g.id_involucrado, nombre: g.involucrado_nombre, rol: g.involucrado_rol });
  const grupos = suyos
    .filter((g) => ['senalado', 'afectado'].includes(g.involucrado_rol))
    .sort((a, b) => (a.involucrado_rol === 'senalado' ? 0 : 1) - (b.involucrado_rol === 'senalado' ? 0 : 1))
    .map((g) => {
      const p = { ...persona(g), tipo_persona: g.involucrado_tipo_persona };
      const aplicadas = delPaso.filter((m) => m.id_involucrado === g.id_involucrado);
      return {
        ...persona(g),
        estado: g.estado,
        opciones: opcionesPara(p).map((tipo) => {
          const m = aplicadas.find((x) => x.tipo === tipo);
          return {
            tipo,
            texto: frase(tipo, p, afectados),
            aplicada: m ? {
              id: m.id, dias_habiles: m.dias_habiles, fecha: m.fecha, fecha_termino: m.fecha_termino,
              fundamento: m.fundamento, estado: m.estado,
            } : null,
          };
        }),
      };
    });
  const sinMedidas = suyos.length > 0 && delPaso.length === 0 && suyos.every((g) => g.estado === 'no_aplica')
    ? suyos[0].observacion
    : null;
  return { grupos, sin_medidas: sinMedidas };
};

/**
 * Deja cada fila del paso según lo aplicado: el señalado, cumplido si algo
 * recae sobre él; el afectado, cumplido si algo lo protege (una medida sobre
 * el señalado, o una suya); el resto, "No corresponde".
 */
const resolverFilas = async (conn, paso, id_usuario) => {
  const [filas] = await conn.query(
    `SELECT pi.id_paso_involucrado, pi.id_involucrado, i.rol,
            (SELECT COUNT(*) FROM MEDIDA_PROTECCION m
              WHERE m.id_activado_paso = pi.id_activado_paso AND m.id_involucrado = pi.id_involucrado) AS propias,
            (SELECT COUNT(*) FROM MEDIDA_PROTECCION m
               JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO s ON s.id_involucrado = m.id_involucrado AND s.rol = 'senalado'
              WHERE m.id_activado_paso = pi.id_activado_paso) AS sobre_senalado
     FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
     JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i ON i.id_involucrado = pi.id_involucrado
     WHERE pi.id_activado_paso = ?`,
    [paso.id_activado_paso]
  );
  for (const f of filas) {
    const cumplida = Number(f.propias) > 0 || (f.rol === 'afectado' && Number(f.sobre_senalado) > 0);
    await conn.query(
      `UPDATE PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO
       SET estado = ?, observacion = ?, fecha_cumplido = NOW(), fecha_gestion = ?, id_usuario = ?
       WHERE id_paso_involucrado = ?`,
      [cumplida ? 'cumplido' : 'no_aplica',
       cumplida ? null : 'Sin medidas de protección para esta persona',
       hoySantiago(), id_usuario, f.id_paso_involucrado]
    );
  }
};

const registrarEvento = (conn, caso, paso, descripcion, id_usuario) =>
  conn.query(
    `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
       (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
     VALUES (?, ?, ?, 'nota', ?, ?, NOW())`,
    [caso.id_protocolo_activado, caso.id_establecimiento, paso.id_activado_paso, descripcion, id_usuario]
  );

/** Caso activo de este colegio y paso de este tipo en curso. Responde el error y devuelve null. */
const contexto = async (req, res) => {
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
  if (!esProteccionPorAfectado(paso))
    return res.status(409).json({ message: 'Este paso no es de medidas de protección para las dos partes.' }), null;
  if (!['en_curso', 'vencido', 'completado'].includes(paso.estado))
    return res.status(409).json({ message: 'Este paso todavía no está en curso.' }), null;
  const [involucrados] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO_INVOLUCRADO WHERE id_protocolo_activado = ?', [req.params.id]);
  return { caso, paso, involucrados };
};

/**
 * POST /:id/pasos/:id_paso/proteccion
 * { medidas: [{ id_involucrado, tipo, dias_habiles?, fundamento? }] }
 */
const registrar = async (req, res) => {
  const pedidas = Array.isArray(req.body?.medidas) ? req.body.medidas : [];
  if (pedidas.length === 0) return res.status(400).json({ message: 'Marca al menos una medida.' });
  try {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    const { caso, paso, involucrados } = ctx;
    const afectados = involucrados.filter((i) => i.rol === 'afectado');

    const [yaAplicadas] = await pool.query(
      'SELECT id_involucrado, tipo FROM MEDIDA_PROTECCION WHERE id_activado_paso = ?', [paso.id_activado_paso]);

    const aInsertar = [];
    for (const m of pedidas) {
      const p = involucrados.find((i) => i.id_involucrado === Number(m.id_involucrado));
      if (!p || !opcionesPara(p).includes(m.tipo))
        return res.status(400).json({ message: 'Una de las medidas no corresponde a esa persona.' });
      if (yaAplicadas.some((x) => x.id_involucrado === p.id_involucrado && x.tipo === m.tipo)) continue;
      const dias = m.dias_habiles ? Number(m.dias_habiles) : null;
      const invalida = errorDeMedida({ tipo: m.tipo, fundamento: m.fundamento, dias_habiles: dias });
      if (invalida) return res.status(400).json({ message: `${frase(m.tipo, p, afectados)}: ${invalida}` });
      aInsertar.push({ p, tipo: m.tipo, dias, fundamento: m.fundamento });
    }
    if (aInsertar.length === 0) return res.status(409).json({ message: 'Esas medidas ya estaban aplicadas.' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const { p, tipo, dias, fundamento } of aInsertar) {
        const { id_medida_proteccion } = await insertarMedida(conn, {
          id_protocolo_activado: caso.id_protocolo_activado,
          id_establecimiento: caso.id_establecimiento,
          id_usuario: req.user.id,
          tipo, fundamento, dias_habiles: dias,
          descripcion: frase(tipo, p, afectados),
          id_estudiante: p.id_estudiante ?? null,
          id_involucrado: p.id_involucrado,
          fecha_inicio: hoySantiago(),
          id_activado_paso: paso.id_activado_paso,
        });
        // A quién protege: lo que recae sobre el señalado, a todos los afectados;
        // lo de un afectado, a él.
        const protegidos = p.rol === 'senalado' ? afectados.map((a) => a.id_involucrado) : [p.id_involucrado];
        if (protegidos.length)
          await conn.query(
            'INSERT INTO MEDIDA_PROTECCION_PROTEGIDO (id_medida_proteccion, id_involucrado) VALUES ?',
            [protegidos.map((id) => [id_medida_proteccion, id])]
          );
      }
      await resolverFilas(conn, paso, req.user.id);
      await registrarEvento(conn, caso, paso,
        `${paso.nombre} — se aplican: ${aInsertar.map(({ p, tipo }) => frase(tipo, p, afectados)).join('; ')}`,
        req.user.id);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    res.status(201).json({
      message: aInsertar.length === 1 ? 'Medida aplicada' : `${aInsertar.length} medidas aplicadas`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al aplicar las medidas de protección' });
  }
};

/**
 * POST /:id/pasos/:id_paso/proteccion/sin-medidas
 * { motivo } — no se aplica ninguna medida de protección en el paso.
 */
const sinMedidas = async (req, res) => {
  const motivo = req.body?.motivo?.trim();
  if (!motivo) return res.status(400).json({ message: 'Indica por qué no se aplican medidas de protección.' });
  try {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    const { caso, paso } = ctx;
    const [[{ n }]] = await pool.query(
      'SELECT COUNT(*) n FROM MEDIDA_PROTECCION WHERE id_activado_paso = ?', [paso.id_activado_paso]);
    if (Number(n) > 0)
      return res.status(409).json({ message: 'Ya hay medidas aplicadas en este paso.' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO
         SET estado = 'no_aplica', observacion = ?, fecha_cumplido = NOW(), fecha_gestion = ?, id_usuario = ?
         WHERE id_activado_paso = ?`,
        [motivo.slice(0, 500), hoySantiago(), req.user.id, paso.id_activado_paso]
      );
      await registrarEvento(conn, caso, paso,
        `${paso.nombre} — no se aplican medidas de protección. Motivo: ${motivo}`, req.user.id);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    res.json({ message: 'Registrado: no se aplican medidas de protección' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar' });
  }
};

module.exports = { esProteccionPorAfectado, medidasDeProteccion, partesDeProteccion, registrar, sinMedidas };
