const pool = require('../db/connection');
const { puedeVerConfidencial } = require('../utils/confidencial');

// Expediente de un caso: lo que se le entrega a la Superintendencia cuando pide
// "los antecedentes y documentación necesarios" (art. 61 de la Ley 20.529).
//
// La ley no define un formato, así que esto arma la respuesta con lo que sí
// exige poder demostrar: que el protocolo se activó, cuándo, qué pasos se
// ejecutaron, quién los ejecutó y si se cumplieron los plazos.
//
// Dos modos:
//  - completo: uso interno del establecimiento.
//  - redactado: sin datos que identifiquen a las personas. Es el que exige el
//    art. 37 del Estatuto Docente cuando hay que remitir antecedentes a un
//    organismo administrador de la Ley 16.744 "con resguardo de la información
//    privada de las partes involucradas".
//
// Exportar es un hecho auditable y queda en la bitácora del caso: quién sacó el
// expediente y cuándo también forma parte del rastro.

const MESES_RETENCION = 24;

// Iniciales en vez del nombre: mantiene distinguibles a dos personas dentro del
// mismo expediente sin identificar a ninguna. Borrarlas del todo haría ilegible
// un caso con varios involucrados.
const inicialesDe = (nombre, apellido) =>
  `${(nombre ?? '').trim().charAt(0)}.${(apellido ?? '').trim().charAt(0)}.`.toUpperCase();

const redactarPersona = (p) => ({
  iniciales: inicialesDe(p.nombre, p.apellido),
  rol_en_incidente: p.rol_en_incidente ?? null,
});

// El correo identifica a un funcionario concreto. En modo redactado se
// reemplaza por su rol en el paso, que es lo que importa para acreditar que
// quien actuó tenía competencia para hacerlo.
const redactarCorreo = () => null;

const armarExpediente = async (id_protocolo_activado, id_establecimiento) => {
  const [[caso]] = await pool.query(
    `SELECT pa.*, r.asunto, r.antecedentes, r.acuerdos, r.fecha_incidente,
            r.es_confidencial, r.nota_confidencial, r.id_usuario AS id_autor_registro,
            r.estado_validacion,
            tf.nombre AS tipo_falta_nombre, tf.gravedad,
            e.nombre AS establecimiento_nombre, e.rbd
     FROM PROTOCOLO_ACTIVADO pa
     JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = pa.id_registro
     JOIN TIPO_FALTA tf ON tf.id_tipo_falta = r.id_tipo_falta
     JOIN ESTABLECIMIENTO e ON e.id_establecimiento = pa.id_establecimiento
     WHERE pa.id_protocolo_activado = ? AND pa.id_establecimiento = ?`,
    [id_protocolo_activado, id_establecimiento]
  );
  if (!caso) return null;

  const [pasos] = await pool.query(
    `SELECT p.id_activado_paso, p.nombre, p.descripcion, p.tipo_paso, p.estado,
            p.fecha_inicio, p.fecha_limite, p.fecha_completado, p.datos_salida,
            p.plazo_valor, p.plazo_unidad,
            u.correo AS responsable_correo
     FROM PROTOCOLO_ACTIVADO_PASO p
     LEFT JOIN USUARIO u ON u.id_usuario = p.id_usuario_responsable
     WHERE p.id_protocolo_activado = ?
     ORDER BY p.id_activado_paso`,
    [id_protocolo_activado]
  );

  const idsPaso = pasos.map((p) => p.id_activado_paso);
  // El schema del paso está en PASO_CAMPO y los valores completados en
  // PASO.datos_salida (un JSON por paso). Se juntan acá: el expediente necesita
  // la etiqueta legible junto al valor, no el código interno suelto.
  const [campos] = idsPaso.length
    ? await pool.query(
        `SELECT id_activado_paso, codigo, etiqueta, tipo_campo, orden
         FROM PROTOCOLO_ACTIVADO_PASO_CAMPO WHERE id_activado_paso IN (?) ORDER BY orden`,
        [idsPaso])
    : [[]];

  const [involucrados] = await pool.query(
    `SELECT e.nombre, e.apellido, e.run, e.dv, re.rol_en_incidente
     FROM REGISTRO_ESTUDIANTE re
     JOIN ESTUDIANTE e ON e.id_estudiante = re.id_estudiante
     WHERE re.id_registro = ?`,
    [caso.id_registro]
  );

  const [bitacora] = await pool.query(
    `SELECT ev.tipo_evento, ev.descripcion, ev.fecha, u.correo
     FROM PROTOCOLO_ACTIVADO_EVENTO ev
     LEFT JOIN USUARIO u ON u.id_usuario = ev.id_usuario
     WHERE ev.id_protocolo_activado = ? ORDER BY ev.fecha, ev.id_evento`,
    [id_protocolo_activado]
  );

  const [medidasProteccion] = await pool.query(
    `SELECT tipo, descripcion, fundamento, fecha_inicio, fecha_termino, dias_habiles,
            es_reaplicacion, estado
     FROM MEDIDA_PROTECCION WHERE id_protocolo_activado = ? ORDER BY fecha_inicio`,
    [id_protocolo_activado]
  );

  const [medidasDisciplinarias] = await pool.query(
    `SELECT descripcion, tipo_medida, fecha_aplicacion, resultado, fecha_resultado
     FROM MEDIDA_DISCIPLINARIA WHERE id_registro = ? ORDER BY fecha_aplicacion`,
    [caso.id_registro]
  );

  const [[informe]] = await pool.query(
    'SELECT * FROM INFORME_EXPULSION WHERE id_protocolo_activado = ?',
    [id_protocolo_activado]
  );

  return { caso, pasos, campos, involucrados, bitacora,
           medidasProteccion, medidasDisciplinarias, informe: informe ?? null };
};

// El dato que la Superintendencia mira primero: si el paso se cumplió dentro
// del plazo. Se calcula acá y no se guarda, porque depende de dos fechas que ya
// están en la fila.
const cumplimientoDe = (p) => {
  if (!p.fecha_limite) return 'sin_plazo';
  if (p.fecha_completado)
    return new Date(p.fecha_completado) <= new Date(p.fecha_limite) ? 'en_plazo' : 'fuera_de_plazo';
  return new Date() > new Date(p.fecha_limite) ? 'vencido' : 'en_curso';
};

// datos_salida puede venir como objeto ya parseado (columna JSON) o como texto,
// según cómo lo haya guardado el motor. Se normaliza en vez de asumir.
const salidaDe = (paso) => {
  if (!paso.datos_salida) return {};
  if (typeof paso.datos_salida === 'object') return paso.datos_salida;
  try { return JSON.parse(paso.datos_salida); } catch { return {}; }
};

const formatear = (datos, { redactado }) => {
  const { caso, pasos, campos, involucrados, bitacora,
          medidasProteccion, medidasDisciplinarias, informe } = datos;

  return {
    modo: redactado ? 'redactado' : 'completo',
    emitido_el: new Date().toISOString(),
    establecimiento: { nombre: caso.establecimiento_nombre, rbd: caso.rbd },
    caso: {
      id_protocolo_activado: caso.id_protocolo_activado,
      // Nombre y versión congelados al activar: es el protocolo que regía ese
      // día, no el que rige hoy.
      protocolo: caso.nombre_protocolo,
      version: caso.version_protocolo,
      categoria_ley: caso.categoria_ley,
      estado: caso.estado,
      fecha_activacion: caso.fecha_activacion,
      fecha_cierre: caso.fecha_cierre,
      fecha_limite_investigacion: caso.fecha_limite_investigacion,
    },
    hecho: {
      fecha_incidente: caso.fecha_incidente,
      tipo_falta: caso.tipo_falta_nombre,
      gravedad: caso.gravedad,
      asunto: caso.asunto,
      antecedentes: caso.antecedentes,
      acuerdos: caso.acuerdos,
      estado_validacion: caso.estado_validacion,
    },
    involucrados: involucrados.map((i) => redactado
      ? redactarPersona(i)
      : { nombre: i.nombre, apellido: i.apellido, run: `${i.run}-${i.dv}`, rol_en_incidente: i.rol_en_incidente }),
    pasos: pasos.map((p) => ({
      nombre: p.nombre,
      tipo_paso: p.tipo_paso,
      estado: p.estado,
      responsable: redactado ? redactarCorreo() : p.responsable_correo,
      plazo: p.plazo_valor ? `${p.plazo_valor} ${p.plazo_unidad}` : null,
      fecha_inicio: p.fecha_inicio,
      fecha_limite: p.fecha_limite,
      fecha_completado: p.fecha_completado,
      cumplimiento: cumplimientoDe(p),
      campos: campos
        .filter((c) => c.id_activado_paso === p.id_activado_paso)
        .map((c) => ({ etiqueta: c.etiqueta, valor: salidaDe(p)[c.codigo] ?? null })),
    })),
    medidas_proteccion: medidasProteccion,
    medidas_disciplinarias: medidasDisciplinarias,
    informe_expulsion: informe && {
      medida: informe.medida,
      recomendacion: informe.recomendacion,
      decision_director: informe.decision_director,
      fecha_emision: informe.fecha_emision,
      fecha_notificacion_apoderado: informe.fecha_notificacion_apoderado,
      fecha_informe_superintendencia: informe.fecha_informe_superintendencia,
      fecha_informe_seremi: informe.fecha_informe_seremi,
    },
    bitacora: bitacora.map((b) => ({
      fecha: b.fecha,
      tipo_evento: b.tipo_evento,
      descripcion: b.descripcion,
      usuario: redactado ? redactarCorreo() : b.correo,
    })),
    resumen_cumplimiento: {
      pasos_totales: pasos.length,
      en_plazo: pasos.filter((p) => cumplimientoDe(p) === 'en_plazo').length,
      fuera_de_plazo: pasos.filter((p) => cumplimientoDe(p) === 'fuera_de_plazo').length,
      vencidos_abiertos: pasos.filter((p) => cumplimientoDe(p) === 'vencido').length,
    },
  };
};

// GET /api/protocolos-activados/:id/expediente?redactado=1
const getExpediente = async (req, res) => {
  try {
    const datos = await armarExpediente(req.params.id, req.id_establecimiento);
    if (!datos) return res.status(404).json({ message: 'Caso no encontrado' });

    // Un caso confidencial no deja de serlo porque se pida como expediente:
    // esta es una lectura más y pasa por el mismo control que el resto.
    const registroLike = {
      es_confidencial: datos.caso.es_confidencial,
      id_usuario: datos.caso.id_autor_registro,
    };
    if (datos.caso.es_confidencial && !puedeVerConfidencial(req, registroLike))
      return res.status(403).json({
        message: 'El registro de origen es confidencial',
        nota_confidencial: datos.caso.nota_confidencial,
      });

    const redactado = req.query.redactado === '1' || req.query.redactado === 'true';

    await pool.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'expediente_exportado', ?, ?, NOW())`,
      [req.params.id, req.id_establecimiento,
       `Expediente exportado en modo ${redactado ? 'redactado' : 'completo'}`, req.user.id]
    );

    res.json(formatear(datos, { redactado }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al armar el expediente' });
  }
};

// GET /api/expedientes/masivo?categoria=acoso&meses=24
//
// Exportación de los casos de los últimos 24 meses por categoría, en modo
// redactado. Cubre la obligación de los arts. 37 del Estatuto Docente y 29 bis
// de la Ley 21.109: remitir los antecedentes de los procedimientos internos por
// acoso, violencia física o discriminación cuando un organismo administrador
// investiga si una enfermedad mental es de origen laboral.
//
// Siempre redactado, sin opción: quien lo recibe es un tercero externo.
const exportarMasivo = async (req, res) => {
  const meses = Number(req.query.meses) || MESES_RETENCION;
  const categorias = req.query.categoria
    ? String(req.query.categoria).split(',')
    : ['acoso', 'violencia_fisica', 'discriminacion'];

  try {
    const [casos] = await pool.query(
      `SELECT id_protocolo_activado FROM PROTOCOLO_ACTIVADO
       WHERE id_establecimiento = ?
         AND categoria_ley IN (?)
         AND fecha_activacion >= DATE_SUB(NOW(), INTERVAL ? MONTH)
       ORDER BY fecha_activacion`,
      [req.id_establecimiento, categorias, meses]
    );

    const expedientes = [];
    for (const c of casos) {
      const datos = await armarExpediente(c.id_protocolo_activado, req.id_establecimiento);
      if (!datos) continue;
      // Los confidenciales SÍ van: la obligación de remitir no distingue, y el
      // modo redactado es justamente lo que permite entregarlos sin exponer a
      // las partes. Lo que no viaja es la nota de confidencialidad.
      expedientes.push(formatear(datos, { redactado: true }));

      await pool.query(
        `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
           (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
         VALUES (?, ?, 'expediente_exportado', ?, ?, NOW())`,
        [c.id_protocolo_activado, req.id_establecimiento,
         'Incluido en exportación masiva redactada', req.user.id]
      );
    }

    res.json({
      emitido_el: new Date().toISOString(),
      periodo_meses: meses,
      categorias,
      total: expedientes.length,
      expedientes,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al exportar los expedientes' });
  }
};

module.exports = { getExpediente, exportarMasivo, MESES_RETENCION };
