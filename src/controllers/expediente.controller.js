const pool = require('../db/connection');
const { puedeVerConfidencial } = require('../utils/confidencial');
const { pasosDescartados } = require('../utils/flujoProtocolo');
const { construirExpedientePdf } = require('../services/pdf/expediente.pdf');
const { enviarPdf } = require('../services/pdf/comun');
const { ETIQUETAS, etiquetaDe, humanizar } = require('../utils/etiquetas');

// Expediente de un caso: lo que se le entrega a la Superintendencia cuando pide
// "los antecedentes y documentación necesarios" (art. 61 de la Ley 20.529).
//
// La ley no define un formato, así que esto arma la respuesta con lo que sí
// exige poder demostrar: que el protocolo se activó, cuándo, qué pasos se
// ejecutaron, quién los ejecutó y si se cumplieron los plazos.
//
// Secciones, en el orden en que se leen y con lo que acredita cada una:
//   denuncia                → el antecedente inicial: cuándo entró, quién lo
//                             registró, quién denunció, documento de origen.
//   caso / hecho            → qué protocolo se activó (nombre y versión
//                             congelados), cuándo, y por qué falta.
//   involucrados            → contra quién y a favor de quién se instruyó.
//   pasos[].gestiones       → la actuación persona por persona: la entrevista,
//                             su fecha real, la observación, el acta adjunta y
//                             la constancia de notificación.
//   pasos_no_aplicables     → las ramas que el caso no tomó, dichas como tales
//                             y no como pasos pendientes.
//   medidas_proteccion      → con sus seguimientos (art. 16 E letra j).
//   suspensiones_cautelares → art. 6 letra d) del DFL 2/1998, con sus plazos.
//   medidas_disciplinarias  → lo resuelto.
//   informe_expulsion       → la expulsión o cancelación, si hubo.
//   bitacora                → la línea de tiempo completa.
//   resumen_cumplimiento    → plazos y notificaciones pendientes, contados.
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
//
// El nombre llega como un solo campo ('Juan Pérez'), que es cómo lo congela
// PROTOCOLO_ACTIVADO_INVOLUCRADO: se toman las dos primeras palabras.
const inicialesDe = (nombre) => {
  const partes = String(nombre ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return partes.length ? `${partes.map((p) => p.charAt(0)).join('.')}.`.toUpperCase() : 'N.N.';
};

// El RUT y el curso NO salen en modo redactado: en un curso de 30 alumnos,
// iniciales + curso identifica a la persona para cualquiera del establecimiento.
// El tipo de persona sí va: que el señalado sea un funcionario y no un
// estudiante cambia el procedimiento aplicable, y no identifica a nadie.
const redactarInvolucrado = (i) => ({
  tipo_persona: i.tipo_persona,
  iniciales: inicialesDe(i.nombre),
  rol: i.rol,
  fecha_incorporacion: i.fecha_incorporacion,
});

// El correo identifica a un funcionario concreto. En modo redactado se
// reemplaza por su rol en el paso, que es lo que importa para acreditar que
// quien actuó tenía competencia para hacerlo.
const redactarCorreo = () => null;

const CORREO = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

// Anular las columnas que identifican no alcanza: el nombre y el correo también
// viajan DENTRO del texto libre. La bitácora es el caso más claro — el motor
// escribe "BENJAMÍN A. L.: rol afectado → senalado" y "asignado a
// encargado@colegio.cl" —, pero pasa igual en la descripción de un hecho, en la
// observación de una entrevista o en el valor de un campo de paso.
//
// Se sustituye en vez de borrar la frase completa: el texto es lo que acredita
// la actuación, y sin él el expediente redactado no sirve para lo que se remite.
const redactarTexto = (texto, involucrados) => {
  if (typeof texto !== 'string' || !texto) return texto;
  let salida = texto;
  // De más largo a más corto: si un caso tiene a "Juan Pérez" y a "Juan Pérez
  // Soto", reemplazar primero el corto dejaría el apellido suelto del otro.
  for (const i of [...involucrados].sort((a, b) => (b.nombre?.length ?? 0) - (a.nombre?.length ?? 0)))
    if (i.nombre) salida = salida.split(i.nombre).join(inicialesDe(i.nombre));
  return salida.replace(CORREO, '[correo omitido]');
};

// Una sola pasada al final sobre todo el expediente: cualquier texto que se
// agregue después queda cubierto sin tener que acordarse de redactarlo.
const redactarProfundo = (valor, involucrados) => {
  if (typeof valor === 'string') return redactarTexto(valor, involucrados);
  if (Array.isArray(valor)) return valor.map((v) => redactarProfundo(v, involucrados));
  // Los Date se dejan intactos: no son texto y JSON los serializa solo.
  if (valor && typeof valor === 'object' && !(valor instanceof Date))
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, redactarProfundo(v, involucrados)])
    );
  return valor;
};

const armarExpediente = async (id_protocolo_activado, id_establecimiento) => {
  const [[caso]] = await pool.query(
    `SELECT pa.*, r.asunto, r.antecedentes, r.acuerdos, r.fecha_incidente,
            r.fecha_creacion AS fecha_registro,
            r.es_confidencial, r.nota_confidencial, r.id_usuario AS id_autor_registro,
            tf.nombre AS tipo_falta_nombre, tf.gravedad,
            e.nombre AS establecimiento_nombre, e.rbd,
            ua.nombre AS autor_registro_nombre, ua.correo AS autor_registro_correo,
            uac.nombre AS activado_por_nombre, uac.correo AS activado_por_correo
     FROM PROTOCOLO_ACTIVADO pa
     JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = pa.id_registro
     JOIN TIPO_FALTA tf ON tf.id_tipo_falta = r.id_tipo_falta
     JOIN ESTABLECIMIENTO e ON e.id_establecimiento = pa.id_establecimiento
     LEFT JOIN USUARIO ua  ON ua.id_usuario  = r.id_usuario
     LEFT JOIN USUARIO uac ON uac.id_usuario = pa.id_usuario_activo
     WHERE pa.id_protocolo_activado = ? AND pa.id_establecimiento = ?`,
    [id_protocolo_activado, id_establecimiento]
  );
  if (!caso) return null;

  const [pasos] = await pool.query(
    `SELECT p.id_activado_paso, p.nombre, p.descripcion, p.tipo_paso, p.estado,
            p.fecha_inicio, p.fecha_limite, p.fecha_completado, p.datos_salida,
            p.plazo_valor, p.plazo_unidad,
            p.por_involucrado_rol, p.requiere_notificacion,
            u.nombre AS responsable_nombre, u.correo AS responsable_correo
     FROM PROTOCOLO_ACTIVADO_PASO p
     LEFT JOIN USUARIO u ON u.id_usuario = p.id_usuario_responsable
     WHERE p.id_protocolo_activado = ?
     ORDER BY p.id_activado_paso`,
    [id_protocolo_activado]
  );

  // Los pasos de una rama que el caso no tomó siguen existiendo como filas
  // (el grafo se copia completo al activar) y quedan 'pendiente' para siempre.
  // Sin distinguirlos, el expediente afirmaba lo contrario de lo que pasó: en
  // un caso sin lesionados salía "Denuncia a autoridad competente: pendiente",
  // que se lee como que no denunciaron habiendo debido hacerlo.
  //
  // Es el mismo cálculo que usa el cierre para no exigir un motivo por no haber
  // hecho algo que nunca correspondía hacer.
  const [transiciones] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO_TRANSICION WHERE id_protocolo_activado = ?',
    [id_protocolo_activado]
  );
  const descartados = pasosDescartados(pasos, transiciones);

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

  // Los involucrados del CASO, no los del registro: se leen de la copia que se
  // congela al activar (fase 12), con su nombre y RUT tal como estaban ese día.
  // REGISTRO_ESTUDIANTE solo tiene estudiantes y solo los del registro
  // original, así que dejaba fuera a los funcionarios y externos señalados y a
  // todo el que se incorporó a mitad del caso.
  const [involucrados] = await pool.query(
    `SELECT id_involucrado, tipo_persona, nombre, rut, curso, rol, fecha_incorporacion
     FROM PROTOCOLO_ACTIVADO_INVOLUCRADO
     WHERE id_protocolo_activado = ?
     ORDER BY FIELD(rol, 'afectado', 'senalado', 'denunciante', 'testigo'), nombre`,
    [id_protocolo_activado]
  );

  // El cumplimiento por persona de cada paso: la entrevista a cada involucrado,
  // la fecha real en que se hizo y la constancia de que se le notificó. Es lo
  // que acredita el "registro de entrevistas" y la "notificación a las
  // familias", y vivía en la BD sin salir nunca en el expediente.
  //
  // El binario del adjunto no viaja (el expediente es JSON): van sus metadatos,
  // que es lo que permite decir que el acta existe y cuándo se cargó. En modo
  // redactado el nombre del archivo se omite: suele traer el nombre de la
  // persona.
  const [gestiones] = idsPaso.length
    ? await pool.query(
        `SELECT pi.id_paso_involucrado, pi.id_activado_paso, pi.id_involucrado, pi.estado,
                pi.fecha_cumplido, pi.fecha_gestion, pi.observacion,
                pi.fecha_notificacion, pi.medio_notificacion,
                u.nombre AS registrado_por_nombre, u.correo AS registrado_por,
                a.nombre_archivo, a.mime_type, a.peso_bytes, a.fecha_subida
         FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
         LEFT JOIN USUARIO u ON u.id_usuario = pi.id_usuario
         LEFT JOIN PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO_ARCHIVO a
                ON a.id_paso_involucrado = pi.id_paso_involucrado
         WHERE pi.id_activado_paso IN (?)`,
        [idsPaso])
    : [[]];

  const [bitacora] = await pool.query(
    `SELECT ev.tipo_evento, ev.descripcion, ev.fecha, u.nombre, u.correo
     FROM PROTOCOLO_ACTIVADO_EVENTO ev
     LEFT JOIN USUARIO u ON u.id_usuario = ev.id_usuario
     WHERE ev.id_protocolo_activado = ? ORDER BY ev.fecha, ev.id_evento`,
    [id_protocolo_activado]
  );

  const [medidasProteccion] = await pool.query(
    `SELECT id_medida_proteccion, id_involucrado, tipo, descripcion, fundamento,
            fecha_inicio, fecha_termino, dias_habiles, es_reaplicacion, estado
     FROM MEDIDA_PROTECCION WHERE id_protocolo_activado = ? ORDER BY fecha_inicio`,
    [id_protocolo_activado]
  );

  // Los dos deberes del art. 16 E letra j sobre el estudiante suspendido
  // (monitoreo pedagógico y continuidad de la trayectoria) se acreditan con
  // estas filas. Sin ellas el expediente muestra la medida pero no el
  // seguimiento, que es la mitad de la obligación.
  const idsMedida = medidasProteccion.map((m) => m.id_medida_proteccion);
  const [seguimientos] = idsMedida.length
    ? await pool.query(
        `SELECT s.id_medida_proteccion, s.fecha, s.tipo, s.descripcion,
                u.nombre AS registrado_por_nombre, u.correo AS registrado_por
         FROM MEDIDA_PROTECCION_SEGUIMIENTO s
         LEFT JOIN USUARIO u ON u.id_usuario = s.id_usuario
         WHERE s.id_medida_proteccion IN (?) ORDER BY s.fecha, s.id_seguimiento`,
        [idsMedida])
    : [[]];

  // La suspensión cautelar del art. 6 letra d) del DFL 2/1998 no es una medida
  // de protección y vive en su propia tabla. Es la medida que más se cuestiona
  // en una fiscalización, y la que tiene plazo fatal para resolver.
  const [suspensionesCautelares] = await pool.query(
    `SELECT sc.id_suspension_cautelar, sc.fundamento, sc.fecha_notificacion, sc.medio_notificacion,
            sc.fecha_limite_resolucion, sc.fecha_resolucion, sc.estado,
            sc.fecha_limite_reconsideracion, sc.fecha_reconsideracion,
            sc.fecha_consejo, sc.consejo_profesores_acta, sc.resultado_reconsideracion,
            sc.id_involucrado, u.nombre AS decretada_por_nombre, u.correo AS decretada_por
     FROM SUSPENSION_CAUTELAR sc
     LEFT JOIN USUARIO u ON u.id_usuario = sc.id_usuario
     WHERE sc.id_protocolo_activado = ?
     ORDER BY sc.fecha_notificacion, sc.id_suspension_cautelar`,
    [id_protocolo_activado]
  );

  // Los documentos de la reconsideración (solicitud y acta del Consejo): solo
  // metadatos, el binario lo lee el PDF al anexarlos.
  const idsSuspension = suspensionesCautelares.map((s) => s.id_suspension_cautelar);
  const [documentosSuspension] = idsSuspension.length
    ? await pool.query(
        `SELECT id_suspension_cautelar, tipo, nombre_archivo, mime_type, fecha_subida
         FROM SUSPENSION_CAUTELAR_ARCHIVO WHERE id_suspension_cautelar IN (?)
         ORDER BY id_suspension_cautelar, FIELD(tipo, 'solicitud_reconsideracion', 'acta_consejo')`,
        [idsSuspension])
    : [[]];

  const [medidasDisciplinarias] = await pool.query(
    `SELECT id_involucrado, descripcion, tipo_medida, fecha_aplicacion, resultado, fecha_resultado
     FROM MEDIDA_DISCIPLINARIA WHERE id_registro = ? ORDER BY fecha_aplicacion`,
    [caso.id_registro]
  );

  const [[informe]] = await pool.query(
    'SELECT * FROM INFORME_EXPULSION WHERE id_protocolo_activado = ?',
    [id_protocolo_activado]
  );

  // Solo metadatos: `url_archivo` guarda el texto OCR completo del documento y
  // no tiene por qué viajar. Lo que acredita el antecedente inicial es que
  // existe un documento digitalizado de origen, de qué tipo y de cuándo.
  const [documentosOrigen] = await pool.query(
    `SELECT tipo_archivo, fecha_subida, nivel_confianza
     FROM DOCUMENTO_DIGITALIZADO WHERE id_registro = ? ORDER BY fecha_subida`,
    [caso.id_registro]
  );

  // El cargo de cada funcionario, por correo: todas las consultas de arriba
  // traen nombre y correo de quien actuó, y el correo es único. Con esto el
  // expediente nombra "Nombre, Cargo" en vez de una dirección de correo. Se
  // incluyen las cuentas sin establecimiento (el administrador del sistema).
  const [cuentas] = await pool.query(
    `SELECT u.correo, GROUP_CONCAT(DISTINCT r.nombre ORDER BY r.nombre SEPARATOR ' / ') AS cargo
     FROM USUARIO u
     LEFT JOIN USUARIO_ROLES ur ON ur.id_usuario = u.id_usuario
     LEFT JOIN ROLES r ON r.rol_id = ur.rol_id
     WHERE u.id_establecimiento = ? OR u.id_establecimiento IS NULL
     GROUP BY u.id_usuario`,
    [caso.id_establecimiento]
  );
  const cargos = new Map(cuentas.map((c) => [c.correo, c.cargo]));

  return { caso, pasos, descartados, campos, involucrados, gestiones, bitacora, documentosSuspension,
           medidasProteccion, seguimientos, suspensionesCautelares,
           medidasDisciplinarias, informe: informe ?? null, documentosOrigen, cargos };
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

// El motivo del cierre no tiene columna propia: lo escribe `cerrar` en la
// descripción del evento de bitácora. Se extrae de ahí en vez de agregar una
// columna que duplicaría el dato — el evento ya es la fuente de verdad, con su
// fecha y su autor.
// La bitácora la escribe el motor para el motor: entrecomilla el nombre del
// paso ("Inicia 'paso 1'") y anota por qué rama salió una transición ("(rama
// por defecto)"). Lo primero se lee como si el nombre fuera una cita textual y
// lo segundo es vocabulario del grafo, no del procedimiento: ninguno de los dos
// significa nada para quien recibe el expediente.
//
// Se limpia al emitir y no en la fila: el evento guardado es el rastro de
// auditoría y no se reescribe.
//
// Lo mismo con los códigos que el motor pegó en la frase: "(senalado)",
// "(flujo catalogo)", "(condición constituye_delito=si)". Son claves de la
// base, no castellano, y en un documento que lee la Superintendencia se ven
// como un error.
// Un código suelto en la frase no dice de qué dominio es: se busca en todas
// las etiquetas ("expulsion_o_cancelacion" → "Expulsión o cancelación de
// matrícula") y solo si no está en ninguna se le sacan los guiones.
const etiquetaDeCualquiera = (codigo) => {
  for (const dominio of Object.values(ETIQUETAS)) if (dominio[codigo]) return dominio[codigo];
  return humanizar(codigo);
};

const limpiarDescripcion = (texto) =>
  typeof texto === 'string'
    ? texto
        .replace(/\s*\(rama por defecto\)/g, '')
        .replace(/'([^']*)'/g, '$1')
        .replace(/\(flujo catalogo\)/g, '(flujo del catálogo)')
        .replace(/\(flujo establecimiento\)/g, '(flujo propio del establecimiento)')
        .replace(/\((afectado|senalado|testigo|denunciante)\)/g,
          (_, rol) => `(${etiquetaDe(rol, 'rol_involucrado').toLowerCase()})`)
        .replace(/\(condición ([a-z0-9_]+)=([a-z0-9_]+)\)/g,
          (_, campo, valor) => `(${humanizar(campo).toLowerCase()}: ${valor === 'si' ? 'sí' : etiquetaDeCualquiera(valor).toLowerCase()})`)
        // Cualquier otro código_con_guiones que haya quedado en la frase.
        .replace(/\b([a-z]+(?:_[a-z0-9]+)+)\b/g, (codigo) => etiquetaDeCualquiera(codigo).toLowerCase())
    : texto;

const motivoCierreDe = (bitacora) => {
  const ev = [...bitacora].reverse().find((b) => ['cierre', 'anulacion'].includes(b.tipo_evento));
  return limpiarDescripcion(ev?.descripcion) ?? null;
};

const formatear = (datos, { redactado }) => {
  const { caso, pasos: todosLosPasos, descartados, campos, involucrados,
          gestiones: todasLasGestiones, bitacora,
          medidasProteccion, seguimientos, suspensionesCautelares,
          medidasDisciplinarias, informe, documentosOrigen, documentosSuspension = [] } = datos;

  // El expediente cuenta el camino que el caso siguió. Los pasos de una rama
  // descartada van aparte, dichos como lo que son, y no cuentan como pendientes
  // ni arrastran sus gestiones (que también quedarían pendientes para siempre).
  const pasos = todosLosPasos.filter((p) => !descartados.has(p.id_activado_paso));
  const noAplicables = todosLosPasos.filter((p) => descartados.has(p.id_activado_paso));
  const gestiones = todasLasGestiones.filter((g) => !descartados.has(g.id_activado_paso));

  // Toda medida, suspensión o gestión apunta a un involucrado por id: acá se
  // resuelve una sola vez cómo se nombra a esa persona según el modo.
  // A un funcionario se le nombra por su nombre y su cargo, nunca por su
  // correo: el expediente lo lee alguien de afuera, para quien
  // 'encargado@colegio.cl' no identifica a nadie, y lo que tiene que poder
  // verificar es que quien actuó tenía competencia para hacerlo — eso lo dice
  // el cargo. Una cuenta sin nombre cargado se nombra por su cargo solo.
  const { cargos = new Map() } = datos;
  const funcionario = (nombre, correo) => {
    if (redactado) return redactarCorreo();
    const cargo = cargos.get(correo) || null;
    // Una cuenta con nombre genérico ("Coordinador") repetiría el cargo.
    if (nombre && cargo && !cargo.toLowerCase().startsWith(nombre.toLowerCase())) return `${nombre}, ${cargo}`;
    if (cargo) return cargo;
    return nombre || cargo || correo || null;
  };
  // Los correos que el motor escribió dentro de la frase ("asignado a
  // encargado@colegio.cl") se cambian por el mismo nombre y cargo.
  const sinCorreos = (texto) =>
    typeof texto === 'string' && !redactado
      ? texto.replace(CORREO, (c) => (cargos.has(c) ? funcionario(null, c) : c))
      : texto;

  const porId = new Map(involucrados.map((i) => [i.id_involucrado, i]));
  const persona = (id_involucrado) => {
    const i = porId.get(id_involucrado);
    if (!i) return null;
    return {
      [redactado ? 'iniciales' : 'nombre']: redactado ? inicialesDe(i.nombre) : i.nombre,
      rol: i.rol,
    };
  };

  const gestionesDe = (id_activado_paso) => gestiones
    .filter((g) => g.id_activado_paso === id_activado_paso)
    .map((g) => ({
      involucrado: persona(g.id_involucrado),
      estado: g.estado,
      // La fecha en que ocurrió el hecho y la fecha en que se registró son dos
      // datos distintos, y la fiscalización mira la primera.
      fecha_gestion: g.fecha_gestion,
      fecha_cumplido: g.fecha_cumplido,
      observacion: g.observacion,
      fecha_notificacion: g.fecha_notificacion,
      medio_notificacion: g.medio_notificacion,
      registrado_por: funcionario(g.registrado_por_nombre, g.registrado_por),
      adjunto: g.mime_type
        ? {
            // El id de la gestión viaja solo cuando hay acta: es lo que usa el
            // PDF del expediente para anexarla al final.
            id_paso_involucrado: redactado ? null : g.id_paso_involucrado,
            nombre_archivo: redactado ? null : g.nombre_archivo,
            mime_type: g.mime_type,
            peso_bytes: g.peso_bytes,
            fecha_subida: g.fecha_subida,
          }
        : null,
    }));

  const faltaNotificar = (g, paso) =>
    paso.requiere_notificacion && g.estado !== 'no_aplica' && !g.fecha_notificacion;

  const salida = {
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
      // Cerrar sin llegar al paso final, o con notificaciones pendientes, exige
      // motivo. Es lo primero que se pregunta cuando el caso no llegó al final,
      // así que sale junto a la fecha de cierre y no perdido en la bitácora.
      motivo_cierre: motivoCierreDe(bitacora),
      fecha_limite_investigacion: caso.fecha_limite_investigacion,
      activado_por: funcionario(caso.activado_por_nombre, caso.activado_por_correo),
    },
    // El antecedente inicial: cuándo entró el hecho al sistema, quién lo
    // registró, quién denunció y si hay un documento digitalizado de origen.
    denuncia: {
      fecha_registro: caso.fecha_registro,
      registrado_por: funcionario(caso.autor_registro_nombre, caso.autor_registro_correo),
      denunciantes: involucrados
        .filter((i) => i.rol === 'denunciante')
        .map((i) => persona(i.id_involucrado)),
      documentos_origen: documentosOrigen,
    },
    hecho: {
      fecha_incidente: caso.fecha_incidente,
      tipo_falta: caso.tipo_falta_nombre,
      gravedad: caso.gravedad,
      asunto: caso.asunto,
      antecedentes: caso.antecedentes,
      acuerdos: caso.acuerdos,
    },
    involucrados: involucrados.map((i) => redactado
      ? redactarInvolucrado(i)
      : {
          tipo_persona: i.tipo_persona,
          nombre: i.nombre,
          rut: i.rut,
          curso: i.curso,
          rol: i.rol,
          fecha_incorporacion: i.fecha_incorporacion,
        }),
    pasos: pasos.map((p) => ({
      nombre: p.nombre,
      tipo_paso: p.tipo_paso,
      estado: p.estado,
      por_involucrado_rol: p.por_involucrado_rol,
      requiere_notificacion: !!p.requiere_notificacion,
      responsable: funcionario(p.responsable_nombre, p.responsable_correo),
      // Valor y unidad por separado: la unidad es un código de la BD
      // ('dias_habiles') y el texto legible lo pone el front, que es donde
      // viven las etiquetas. Concatenarlo acá lo colaba crudo al PDF.
      plazo_valor: p.plazo_valor,
      plazo_unidad: p.plazo_unidad,
      fecha_inicio: p.fecha_inicio,
      fecha_limite: p.fecha_limite,
      fecha_completado: p.fecha_completado,
      cumplimiento: cumplimientoDe(p),
      campos: campos
        .filter((c) => c.id_activado_paso === p.id_activado_paso)
        .map((c) => ({ etiqueta: c.etiqueta, valor: salidaDe(p)[c.codigo] ?? null })),
      // Los pasos del caso (por_involucrado_rol NULL) no tienen filas por
      // persona y el array queda vacío, que es correcto: investigar se hace una
      // vez, no una vez por involucrado.
      gestiones: gestionesDe(p.id_activado_paso),
    })),
    // No es lo mismo que un paso omitido: a este el flujo nunca llegó, porque
    // la condición de la rama se resolvió por el otro lado. Se listan igual —
    // esconderlos dejaría un hueco entre los pasos del protocolo y los del
    // expediente — pero sin plazo ni estado, que es lo que los hacía leerse
    // como incumplimientos.
    pasos_no_aplicables: noAplicables.map((p) => ({
      nombre: p.nombre,
      tipo_paso: p.tipo_paso,
      motivo: 'El caso no tomó la rama del protocolo que lleva a este paso',
    })),
    medidas_proteccion: medidasProteccion.map((m) => ({
      persona: persona(m.id_involucrado),
      tipo: m.tipo,
      descripcion: m.descripcion,
      fundamento: m.fundamento,
      fecha_inicio: m.fecha_inicio,
      fecha_termino: m.fecha_termino,
      dias_habiles: m.dias_habiles,
      es_reaplicacion: m.es_reaplicacion,
      estado: m.estado,
      seguimientos: seguimientos
        .filter((s) => s.id_medida_proteccion === m.id_medida_proteccion)
        .map((s) => ({
          fecha: s.fecha,
          tipo: s.tipo,
          descripcion: s.descripcion,
          registrado_por: funcionario(s.registrado_por_nombre, s.registrado_por),
        })),
    })),
    suspensiones_cautelares: suspensionesCautelares.map((s) => ({
      persona: persona(s.id_involucrado),
      fundamento: s.fundamento,
      fecha_notificacion: s.fecha_notificacion,
      medio_notificacion: s.medio_notificacion,
      fecha_limite_resolucion: s.fecha_limite_resolucion,
      fecha_resolucion: s.fecha_resolucion,
      estado: s.estado,
      fecha_limite_reconsideracion: s.fecha_limite_reconsideracion,
      fecha_reconsideracion: s.fecha_reconsideracion,
      fecha_consejo: s.fecha_consejo,
      consejo_profesores_acta: s.consejo_profesores_acta,
      resultado_reconsideracion: s.resultado_reconsideracion,
      decretada_por: funcionario(s.decretada_por_nombre, s.decretada_por),
      // Solicitud del apoderado y acta firmada del Consejo. Mismo criterio que
      // las actas de notificación: en modo redactado se dice que existen pero
      // no viaja el id, así el PDF no las anexa (traen nombres y firmas).
      documentos: documentosSuspension
        .filter((d) => d.id_suspension_cautelar === s.id_suspension_cautelar)
        .map((d) => ({
          tipo: d.tipo,
          id_suspension_cautelar: redactado ? null : d.id_suspension_cautelar,
          nombre_archivo: redactado ? null : d.nombre_archivo,
          mime_type: d.mime_type,
          fecha_subida: d.fecha_subida,
        })),
    })),
    medidas_disciplinarias: medidasDisciplinarias.map((m) => ({
      persona: persona(m.id_involucrado),
      descripcion: m.descripcion,
      tipo_medida: m.tipo_medida,
      fecha_aplicacion: m.fecha_aplicacion,
      resultado: m.resultado,
      fecha_resultado: m.fecha_resultado,
    })),
    informe_expulsion: informe && {
      medida: informe.medida,
      recomendacion: informe.recomendacion,
      decision_director: informe.decision_director,
      fecha_emision: informe.fecha_emision,
      fecha_notificacion_apoderado: informe.fecha_notificacion_apoderado,
      medio_notificacion_apoderado: informe.medio_notificacion_apoderado,
      fecha_informe_superintendencia: informe.fecha_informe_superintendencia,
      fecha_informe_seremi: informe.fecha_informe_seremi,
    },
    bitacora: bitacora.map((b) => ({
      fecha: b.fecha,
      tipo_evento: b.tipo_evento,
      descripcion: sinCorreos(limpiarDescripcion(b.descripcion)),
      usuario: funcionario(b.nombre, b.correo),
    })),
    resumen_cumplimiento: {
      // Solo los pasos que el caso tenía que ejecutar. Antes incluía las ramas
      // descartadas y el resumen mostraba pasos "faltantes" que no faltaban.
      pasos_totales: pasos.length,
      pasos_no_aplicables: noAplicables.length,
      en_plazo: pasos.filter((p) => cumplimientoDe(p) === 'en_plazo').length,
      fuera_de_plazo: pasos.filter((p) => cumplimientoDe(p) === 'fuera_de_plazo').length,
      vencidos_abiertos: pasos.filter((p) => cumplimientoDe(p) === 'vencido').length,
      involucrados: involucrados.length,
      gestiones_pendientes: gestiones.filter((g) => g.estado === 'pendiente').length,
      // Personas a las que había que notificar y no consta que se notificara.
      // Es la métrica que el cierre exige justificar, así que el expediente la
      // dice en vez de dejar que se cuente a mano paso por paso.
      notificaciones_pendientes: gestiones.filter((g) => {
        const paso = pasos.find((p) => p.id_activado_paso === g.id_activado_paso);
        return paso && faltaNotificar(g, paso);
      }).length,
    },
  };

  // Las iniciales que ya puso `persona()` no se ven afectadas: no hay nombre
  // completo que coincidir. Lo que esta pasada limpia es el texto libre.
  return redactado ? redactarProfundo(salida, involucrados) : salida;
};

// Lo común al JSON y al PDF: armar, controlar la confidencialidad y dejar la
// exportación anotada en la bitácora. Devuelve el expediente formateado, o
// null si ya respondió con un error.
const prepararExpediente = async (req, res) => {
  const datos = await armarExpediente(req.params.id, req.id_establecimiento);
  if (!datos) {
    res.status(404).json({ message: 'Caso no encontrado' });
    return null;
  }

  // Un caso confidencial no deja de serlo porque se pida como expediente:
  // esta es una lectura más y pasa por el mismo control que el resto.
  const registroLike = {
    es_confidencial: datos.caso.es_confidencial,
    id_usuario: datos.caso.id_autor_registro,
  };
  if (datos.caso.es_confidencial && !puedeVerConfidencial(req, registroLike)) {
    res.status(403).json({
      message: 'El registro de origen es confidencial',
      nota_confidencial: datos.caso.nota_confidencial,
    });
    return null;
  }

  const redactado = req.query.redactado === '1' || req.query.redactado === 'true';

  await pool.query(
    `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
       (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
     VALUES (?, ?, 'expediente_exportado', ?, ?, NOW())`,
    [req.params.id, req.id_establecimiento,
     `Expediente exportado en modo ${redactado ? 'redactado' : 'completo'}`, req.user.id]
  );

  return formatear(datos, { redactado });
};

// GET /api/protocolos-activados/:id/expediente?redactado=1
const getExpediente = async (req, res) => {
  try {
    const expediente = await prepararExpediente(req, res);
    if (expediente) res.json(expediente);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al armar el expediente' });
  }
};

// GET /api/protocolos-activados/:id/expediente/pdf?redactado=1
//
// El mismo expediente, ya como PDF y con las actas firmadas anexadas. Se arma
// acá y no en el navegador: las actas están en la base, y bajarlas una por
// una al cliente para volver a pegarlas era lento y pesado en el teléfono.
const getExpedientePdf = async (req, res) => {
  try {
    const expediente = await prepararExpediente(req, res);
    if (!expediente) return;

    // Ida y vuelta por JSON: deja las fechas exactamente como las recibía el
    // front (ISO con zona), que es lo que el formateo del PDF espera.
    const e = JSON.parse(JSON.stringify(expediente));

    // Cada anexo se vuelve a filtrar por ESTE caso: el id sale del propio
    // expediente, pero no se lee un archivo ajeno aunque el id llegara mal.
    const leerAnexo = async (origen) => {
      if (origen.tipo === 'suspension_cautelar') {
        const [[archivo]] = await pool.query(
          `SELECT a.mime_type, a.contenido
           FROM SUSPENSION_CAUTELAR_ARCHIVO a
           JOIN SUSPENSION_CAUTELAR sc ON sc.id_suspension_cautelar = a.id_suspension_cautelar
           WHERE a.id_suspension_cautelar = ? AND a.tipo = ? AND sc.id_protocolo_activado = ?`,
          [origen.id_suspension_cautelar, origen.documento, req.params.id]
        );
        return archivo ?? null;
      }
      const [[archivo]] = await pool.query(
        `SELECT a.mime_type, a.contenido
         FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO_ARCHIVO a
         JOIN PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi ON pi.id_paso_involucrado = a.id_paso_involucrado
         JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
         WHERE a.id_paso_involucrado = ? AND p.id_protocolo_activado = ?`,
        [origen.id_paso_involucrado, req.params.id]
      );
      return archivo ?? null;
    };

    const { buffer, nombre } = await construirExpedientePdf(e, leerAnexo);
    enviarPdf(res, buffer, nombre);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ message: 'No se pudo generar el expediente' });
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

module.exports = { getExpediente, getExpedientePdf, exportarMasivo, MESES_RETENCION };
