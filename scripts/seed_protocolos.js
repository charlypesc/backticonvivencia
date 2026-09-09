// Carga el catálogo estándar de protocolos (pasos, transiciones, roles y
// campos) sobre CATALOGO_PROTOCOLOS_GENERICOS.
//
//   node scripts/seed_protocolos.js               → carga y publica lo que falte
//   node scripts/seed_protocolos.js --dry-run     → solo valida, no escribe
//   node scripts/seed_protocolos.js --recargar=4,8 → rehace el grafo de esos protocolos
//
// Es idempotente: un protocolo que ya tiene pasos se salta, salvo que venga en
// --recargar, que lo borra y lo vuelve a escribir desde este archivo.
//
// Este archivo es la definición completa del paso, incluidos por_involucrado_rol,
// requiere_notificacion y requiere_medida: `medida:'proteccion'`,
// `medida:'cautelar'` o `medida:'disciplinaria'` marcan el paso que ordena una
// medida y no está cumplido hasta que ESA CLASE de medida conste en el caso.
// 'proteccion' son los pasos de resguardo del art. 16 E letra j; 'disciplinaria'
// son los pasos de resolución, que se cumplen con la sanción registrada. La
// cautelar del DFL 2 art. 6 letra d no cumple un paso de protección: recae sobre
// el señalado y no descarga el deber de proteger a la persona afectada. Antes vivían en un UPDATE aparte (docs/involucrados_fase12_catalogo.sql),
// y un paso agregado acá nacía sin esa configuración hasta que alguien se
// acordara del otro archivo.
//
// Sobre la fidelidad al documento fuente: la normativa chilena no fija una
// secuencia literal, fija contenidos mínimos y algunos plazos legales duros
// (denuncia en 24 horas, derivación a salud mental en 24 horas). Esos plazos
// van tal cual y con accion_al_vencer='escalar'. Los plazos redactados como
// "inmediato" / "mismo día" se traducen a 2 y 8 horas respectivamente, y los
// "continuo" / "según caso" quedan sin plazo, porque un plazo inventado que
// vence solo genera alertas que nadie va a creer.

require('dotenv').config();
const pool = require('../src/db/connection');
const {
  validarGrafo, validarCondicion, camposDelPaso, validarPaso, validarTechoLegal,
} = require('../src/utils/flujoProtocolo');

const SI_NO = ['si', 'no'];

// Abreviaturas de rol y participación, para que la tabla de datos se lea.
const F = 'FUNCIONARIO', E = 'ENCARGADO', D = 'DIRECTOR', P = 'PSICOLOGO';
const PJ = 'PROFESOR_JEFE', C = 'COMITE_CONVIVENCIA', O = 'ORIENTADOR';
const TS = 'TRABAJADOR_SOCIAL', S = 'ENCARGADO_SALUD', I = 'INSPECTORIA';
const U = 'UTP', DC = 'DOCENTE';
const ej = 'ejecutor', ap = 'aprobador', nt = 'notificado';

// campo: [codigo, etiqueta, tipo, opciones, obligatorio, depende_de]
// `depende_de` ('campo=valor' del mismo paso) hace que el campo solo se
// pregunte si esa respuesta se dio: preguntar "descargos presentados" a quien
// acaba de decir que no los presentó invita a escribir algo que contradice la
// respuesta anterior, y eso queda en el expediente.
const sel = (c, e, o, req = true, dep = null) => [c, e, 'seleccion', o, req, dep];
const txt = (c, e, req = false, dep = null) => [c, e, 'texto', null, req, dep];
const ORGANISMOS = ['fiscalia', 'pdi', 'carabineros', 'tribunal_familia'];

// Debido proceso: ninguna medida contra una persona se resuelve sin haberle
// notificado los hechos y haberla oído. Es el mismo paso en todos los
// protocolos que terminan aplicando una medida, así que los campos se
// comparten: si mañana la Superintendencia pide un dato más, se agrega acá.
//
// 'no_comparecio' no es lo mismo que 'no': el que fue citado y no llegó
// perdió la oportunidad de ser oído, y eso deja el proceso en pie; el que
// nunca fue citado lo invalida. Que sean dos valores distintos es lo que
// permite distinguirlos meses después en la carpeta del caso.
//
// La notificación en sí NO es un campo de este formulario: el paso va con
// `inv:'senalado'` y `notif:1`, así que se cumple una vez por cada señalado y
// ahí queda registrado a quién se le notificó, cuándo y por qué vía. Un
// "¿Se le notificaron los hechos?" a nivel de paso preguntaba lo mismo una
// segunda vez, y peor: con varios señalados una sola respuesta no podía decir
// la verdad si a uno se le notificó y al otro no.
const CAMPOS_DESCARGOS = [
  sel('presento_descargos', '¿Presentó descargos?', ['si', 'no', 'no_comparecio']),
  txt('descargos', 'Descargos presentados', false, 'presento_descargos=si'),
];

// El paso de descargos, idéntico salvo el nombre. Va contra el señalado y con
// notificación: la constancia de que se le notificó es justamente la prueba que
// se pide cuando el apoderado reclama.
const pasoDescargos = (n = 'Notificación de cargos y descargos del estudiante señalado') =>
  ({ k:'descargos', n, t:'formulario', plazo:[3,'dias_habiles'], inv:'senalado', notif:1,
     roles:[[E,ej],[D,nt]], campos:CAMPOS_DESCARGOS });

// La apelación se resuelve como aprobación: el campo implícito 'aprobado' es
// justamente la decisión, y ramificar sobre él no necesita campo propio.
const pasoApelacion = () =>
  ({ k:'apelacion', n:'Resolución de la apelación', t:'aprobacion', plazo:[5,'dias_habiles'],
     inv:'senalado', roles:[[E,ej],[D,ap]] });

// El art. 16 E letra g exige que el derecho a ser oído alcance a "los
// involucrados", no solo al señalado: afectado y testigo también. Van
// inmediatamente ANTES del paso de descargos/investigación — el debido proceso
// exige reunir los antecedentes primero y confrontar al acusado con ellos, no
// al revés — y con 3 días hábiles cada uno: es lo máximo que cabe sin que el
// camino más largo del protocolo pase el techo de 2 meses (ver
// validarTechoLegal). Sin aprobador: son pasos de recolección, no de decisión.
//
// 'hubo_testigos=no' / 'declaro=no_quiso_declarar'/'no_comparecio' son salidas
// legítimas y no bloquean el caso: el paso se completa dejando dicho que no
// los hubo o que no quiso, en vez de forzar un motivo al cierre por un dato
// que nunca existió.
const CAMPOS_TESTIGOS = [
  sel('hubo_testigos', '¿Hubo testigos que declararon?', SI_NO),
  txt('declaraciones', 'Declaraciones de los testigos', false, 'hubo_testigos=si'),
  txt('observaciones', 'Observaciones adicionales'),
];
const pasoTestigos = (roles) =>
  ({ k:'declaracion_testigos', n:'Declaraciones de testigos', t:'formulario', plazo:[3,'dias_habiles'],
     inv:'testigo', roles, campos:CAMPOS_TESTIGOS });

// 'no_quiso_declarar' y 'no_comparecio' son dos salidas distintas y no un
// genérico 'no': la primera es una decisión de la persona afectada, la segunda
// es que no fue posible citarla. Mismo criterio que 'no_comparecio' en
// CAMPOS_DESCARGOS.
const CAMPOS_AFECTADO = [
  sel('declaro', '¿La persona afectada declaró?', ['si', 'no_quiso_declarar', 'no_comparecio']),
  txt('declaracion', 'Declaración de la persona afectada', false, 'declaro=si'),
  txt('observaciones', 'Observaciones adicionales'),
];
const pasoAfectado = (roles) =>
  ({ k:'declaracion_afectado', n:'Declaración de la persona afectada', t:'formulario', plazo:[3,'dias_habiles'],
     inv:'afectado', roles, campos:CAMPOS_AFECTADO });

// Se pregunta al notificar y no al resolver: antes de que la medida esté
// comunicada nadie puede haber apelado todavía.
const CAMPO_APELACION = sel('hay_apelacion', '¿Se presentó apelación?', SI_NO);

// Un seguimiento sin plazo puede quedar abierto indefinidamente sin que nadie
// se entere. El ciclo se marca en alerta y no escala: el seguimiento largo es
// legítimo, lo que no puede pasar es que sea invisible.
// Se probó subirlo a 30 días y no se puede: en acoso, ciberacoso y maltrato de
// adulto el camino más largo se va a ~63 días y pasa el techo de 2 meses del
// art. 16 E letra g. 15 días es lo que cabe.
const CICLO_SEGUIMIENTO = { plazo: [15, 'dias_corridos'], vencer: 'marcar_alerta' };

const CATALOGO = [
// ---------------------------------------------------------------------------
{
  id: 4, // Protocolo de acoso escolar / bullying
  categoria_ley: 'acoso',
  legal: 'Ley 20.536 sobre Violencia Escolar; Ley 21.545; Circular de Reglamentos Internos de la Superintendencia de Educación.',
  pasos: [
    { k:'recepcion', n:'Recepción y registro de la denuncia', t:'formulario', plazo:[8,'horas'], inicial:true,
      roles:[[F,ej],[E,nt]],
      campos:[sel('tipo_agresion','Tipo de agresión',['fisica','psicologica','cibernetica']), sel('hay_lesiones','¿Hay lesiones?',SI_NO)] },
    { k:'clasificacion', n:'Clasificación de gravedad y activación', t:'formulario', plazo:[8,'horas'],
      roles:[[E,ej],[D,ap]],
      campos:[sel('reviste_delito','¿Reviste delito?',SI_NO), sel('gravedad','Gravedad',['leve','grave','gravisima'])] },
    { k:'denuncia', n:'Denuncia a autoridad externa', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      roles:[[D,ej],[E,nt]],
      campos:[sel('organismo','Organismo',ORGANISMOS)] },
    { k:'resguardo', n:'Medidas de resguardo a la víctima', t:'informativo', plazo:[2,'horas'], inv:'afectado', medida:'proteccion',
      roles:[[E,ej],[P,ej]] },
    pasoAfectado([[E,ej]]),
    pasoTestigos([[E,ej]]),
    { k:'investigacion', n:'Investigación interna', t:'formulario', plazo:[10,'dias_habiles'],
      roles:[[E,ej],[C,ap]],
      campos:[txt('observaciones','Antecedentes y conclusiones de la investigación')] },
    pasoDescargos(),
    { k:'resolucion', n:'Resolución y aplicación de medidas', t:'aprobacion', plazo:[3,'dias_habiles'], inv:'senalado', medida:'disciplinaria',
      roles:[[C,ej],[D,ap]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','disciplinaria','ambas'])] },
    { k:'notificacion', n:'Notificación a apoderados y partes', t:'formulario', plazo:[1,'dias_habiles'],
      inv:'todos', notif:1, roles:[[E,ej]], campos:[CAMPO_APELACION] },
    pasoApelacion(),
    { k:'seguimiento', n:'Seguimiento', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'todos', roles:[[E,ej],[PJ,nt]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre del caso e informe final', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','investigacion',null,'No reviste delito',true],
    ['denuncia','resguardo'], ['resguardo','declaracion_afectado'],
    ['declaracion_afectado','declaracion_testigos'], ['declaracion_testigos','investigacion'],
    ['investigacion','descargos'], ['descargos','resolucion'], ['resolucion','notificacion'],
    ['notificacion','apelacion','hay_apelacion=si','Se presentó apelación'],
    ['notificacion','seguimiento',null,'Sin apelación',true],
    // Acoger la apelación devuelve el caso a resolución: la medida se dicta de
    // nuevo, no se parcha. Es un ciclo, y validarGrafo lo admite porque hay
    // salida real; en la práctica se recorre una vez.
    ['apelacion','resolucion','aprobado=si','Apelación acogida: se revisa la medida'],
    ['apelacion','seguimiento',null,'Apelación rechazada',true],
    ['seguimiento','seguimiento','situacion_resuelta=no','Mantiene seguimiento'],
    ['seguimiento','cierre',null,'Resuelto',true],
  ],
},
// ---------------------------------------------------------------------------
{
  crear: { nombre:'Protocolo de acoso y violencia a través de medios tecnológicos (ciberacoso)',
           descripcion:'Acoso, hostigamiento o difusión de material por redes sociales, mensajería u otros medios digitales entre miembros de la comunidad educativa.' },
  categoria_ley: 'acoso',
  legal: 'Ley 20.536; orientaciones Mineduc sobre ciberacoso; Circular de Reglamentos Internos.',
  pasos: [
    { k:'recepcion', n:'Recepción de la denuncia y resguardo de la evidencia digital', t:'formulario', plazo:[2,'horas'], inicial:true,
      roles:[[F,ej],[E,nt]],
      campos:[sel('plataforma','Plataforma',['red_social','mensajeria','otro']), sel('evidencia_capturada','¿Se capturó la evidencia?',SI_NO)] },
    { k:'clasificacion', n:'Clasificación y evaluación de gravedad', t:'formulario', plazo:[8,'horas'],
      roles:[[E,ej],[D,ap]],
      campos:[sel('reviste_delito','¿Reviste delito?',SI_NO), sel('difusion_material','¿Hubo difusión del material?',SI_NO,false)] },
    { k:'denuncia', n:'Denuncia a autoridad externa', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      roles:[[D,ej]],
      campos:[sel('organismo','Organismo',['pdi_cibercrimen','fiscalia'])] },
    pasoAfectado([[E,ej],[PJ,nt]]),
    pasoTestigos([[E,ej],[PJ,nt]]),
    { k:'investigacion', n:'Investigación y trabajo con apoderados', t:'formulario', plazo:[10,'dias_habiles'],
      inv:'todos', roles:[[E,ej],[PJ,nt]], campos:[txt('observaciones','Antecedentes y trabajo realizado con los apoderados')] },
    pasoDescargos(),
    { k:'resolucion', n:'Resolución y medidas formativas o disciplinarias', t:'aprobacion', plazo:[3,'dias_habiles'], medida:'disciplinaria',
      inv:'senalado', roles:[[E,ej],[D,ap]], campos:[sel('tipo_medida','Tipo de medida',['formativa','disciplinaria','ambas'])] },
    // La constancia estaba en la resolución, que es un acto interno. La que
    // sirve es la de esta notificación, que es la que abre el plazo de
    // apelación.
    { k:'notificacion', n:'Notificación de la resolución a las partes', t:'formulario', plazo:[1,'dias_habiles'],
      inv:'todos', notif:1, roles:[[E,ej]], campos:[CAMPO_APELACION] },
    pasoApelacion(),
    { k:'seguimiento', n:'Seguimiento', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'todos', roles:[[E,ej]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe final', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','declaracion_afectado',null,'No reviste delito',true],
    ['denuncia','declaracion_afectado'],
    ['declaracion_afectado','declaracion_testigos'], ['declaracion_testigos','investigacion'],
    ['investigacion','descargos'], ['descargos','resolucion'], ['resolucion','notificacion'],
    ['notificacion','apelacion','hay_apelacion=si','Se presentó apelación'],
    ['notificacion','seguimiento',null,'Sin apelación',true],
    ['apelacion','resolucion','aprobado=si','Apelación acogida: se revisa la medida'],
    ['apelacion','seguimiento',null,'Apelación rechazada',true],
    ['seguimiento','seguimiento','situacion_resuelta=no','Mantiene seguimiento'],
    ['seguimiento','cierre',null,'Resuelto',true],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 8, // Protocolo de vulneración de derechos de estudiantes
  categoria_ley: 'violencia_fisica',
  legal: 'Ley 21.430 de Garantías de la Niñez; Convención sobre los Derechos del Niño; Circular de Reglamentos Internos.',
  pasos: [
    { k:'deteccion', n:'Detección de la sospecha', t:'informativo', plazo:[2,'horas'], inicial:true,
      roles:[[F,ej]], campos:[sel('origen','Origen de la sospecha',['relato','observacion','tercero'])] },
    { k:'recepcion', n:'Recepción y clasificación de gravedad', t:'formulario', plazo:[8,'horas'],
      roles:[[E,ej],[D,ap]],
      campos:[sel('reviste_delito','¿Reviste delito?',SI_NO), sel('responsable_es_funcionario','¿El responsable es funcionario del establecimiento?',SI_NO)] },
    { k:'denuncia', n:'Denuncia a autoridad externa', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      roles:[[D,ej],[E,nt]],
      campos:[sel('organismo','Organismo',ORGANISMOS)] },
    { k:'recopilacion', n:'Recopilación de antecedentes (investigación interna)', t:'formulario', plazo:[48,'horas'],
      roles:[[E,ej],[C,nt]], campos:[txt('observaciones','Antecedentes recopilados')] },
    // El resguardo es cautelar y por eso precede a los descargos: esperar a oír
    // al señalado para separarlo del estudiante sería dejar al estudiante
    // expuesto justo durante la investigación.
    { k:'resguardo', n:'Medidas de resguardo', t:'aprobacion', plazo:[2,'horas'], inv:'afectado', medida:'proteccion',
      roles:[[E,ej],[D,ap]], campos:[sel('cese_trato_directo','¿Cesa el trato directo con estudiantes?',SI_NO)] },
    { k:'citacion', n:'Citación y entrevista a la familia', t:'formulario', plazo:[3,'dias_habiles'],
      inv:'afectado', notif:1,
      roles:[[E,ej],[O,ej]], campos:[sel('apoderado_comparecio','¿El apoderado compareció?',SI_NO)] },
    { k:'derivacion', n:'Derivación a redes externas (OPD, Cesfam)', t:'notificacion_externa', inv:'afectado',
      roles:[[E,ej],[TS,ej]], campos:[sel('red_destino','Red de destino',['opd','cesfam','oln','otro'])] },
    { k:'plan', n:'Plan de intervención y seguimiento', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'afectado',
      roles:[[C,ej],[O,ej]], campos:[sel('estudiante_fuera_de_riesgo','¿El estudiante está fuera de riesgo?',SI_NO)] },
    // Acá los descargos van contra el informe concluyente, no contra una
    // sanción: este protocolo no aplica medidas al señalado, pero el informe sí
    // afirma que hubo vulneración y quién la cometió.
    pasoTestigos([[E,ej],[C,nt]]),
    pasoDescargos('Notificación de los hechos y descargos del adulto señalado'),
    { k:'cierre', n:'Cierre e informe concluyente', t:'adjunto', plazo:[3,'dias_habiles'], final:true, roles:[[C,ej],[D,ap]] },
  ],
  trans: [
    ['deteccion','recepcion'],
    ['recepcion','denuncia','reviste_delito=si','Reviste delito'],
    ['recepcion','recopilacion',null,'No reviste delito',true],
    ['denuncia','resguardo'], ['recopilacion','resguardo'], ['resguardo','citacion'],
    ['citacion','derivacion','apoderado_comparecio=no','El apoderado no compareció'],
    ['citacion','plan',null,'Compareció',true],
    ['derivacion','plan'],
    ['plan','plan','estudiante_fuera_de_riesgo=no','Mantiene seguimiento'],
    ['plan','declaracion_testigos',null,'Fuera de riesgo',true],
    ['declaracion_testigos','descargos'],
    ['descargos','cierre'],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 7, // Protocolo ante hechos de connotación sexual
  categoria_ley: 'violencia_fisica',
  legal: 'Ley 21.430; Código Penal; deber de denuncia del art. 175 del Código Procesal Penal; Circular de Reglamentos Internos.',
  pasos: [
    { k:'acogida', n:'Acogida del relato y detección', t:'informativo', plazo:[2,'horas'], inicial:true,
      roles:[[F,ej]],
      campos:[sel('hay_senales_fisicas','¿Hay señales físicas?',SI_NO), sel('relato_espontaneo','¿Fue un relato espontáneo?',SI_NO,false)] },
    { k:'traslado', n:'Traslado a centro asistencial (urgencia médica)', t:'notificacion_externa', plazo:[2,'horas'], vencer:'escalar',
      inv:'afectado', roles:[[S,ej],[D,nt]], campos:[txt('centro_destino','Centro asistencial',true)] },
    { k:'notif_direccion', n:'Notificación inmediata a dirección', t:'informativo', plazo:[2,'horas'], roles:[[E,ej],[D,nt]] },
    { k:'denuncia', n:'Denuncia obligatoria a autoridad competente', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      roles:[[D,ej]],
      campos:[sel('organismo','Organismo',ORGANISMOS)] },
    { k:'resguardo', n:'Medidas de resguardo y contención (evitar revictimización)', t:'informativo', plazo:[2,'horas'],
      inv:'afectado', medida:'proteccion', roles:[[P,ej],[E,ej]], campos:[sel('presunto_agresor_es_funcionario','¿El presunto agresor es funcionario?',SI_NO)] },
    // Separación de funciones, NO suspensión laboral: son cosas distintas y
    // confundirlas cuesta caro. La nota 74 de la Circular 482 recoge el
    // Dictamen 471/2017 de la Dirección del Trabajo — suspender de sus
    // funciones a un profesional de la educación solo procede una vez decretada
    // la prisión preventiva, "no bastando la sola denuncia ante la Fiscalía".
    // Lo que sí procede desde el primer momento es sacarlo del contacto directo
    // con estudiantes (Anexo 2, viii). Espeja el paso 'resguardo' del protocolo
    // de vulneración de derechos, que resuelve el mismo problema.
    { k:'medidas_adulto', n:'Separación del adulto señalado de su función directa con estudiantes',
      t:'aprobacion', plazo:[2,'horas'], inv:'senalado',
      roles:[[D,ej],[D,ap]],
      campos:[sel('cese_trato_directo','¿Cesa el trato directo con estudiantes?',SI_NO)] },
    // Sin plazo a propósito: el Anexo 2 (vii) no fija ninguno, y un plazo
    // inventado que vence solo genera alertas que nadie va a creer.
    //
    // Estas medidas NO son cautelares ni sanciones. El punto 2.2 de la Circular
    // cita al Comité de los Derechos del Niño: hay que evaluar el interés
    // superior "de cada uno de los involucrados", sin "adoptar un criterio
    // punitivo y responder a la violencia con violencia". Y el 2.6 obliga a
    // preferir lo formativo y a agotar antes las medidas de menor intensidad.
    //
    // Los tres Sí/No no son decorativos, cada uno decide algo fuera de acá:
    //  - indicadores_vulneracion: un NNA que agrede sexualmente a un par es con
    //    frecuencia él mismo un niño vulnerado → protocolo 8 u OPD.
    //  - senalado_14_o_mas: bajo 14 no hay responsabilidad penal (Ley 20.084
    //    art. 3) y se le pone a disposición del tribunal de familia "a fin de
    //    que éste procure su adecuada protección" (art. 58). Ojo: esto NO
    //    releva de la denuncia de 24 h del paso anterior; cambia la
    //    consecuencia, no el deber de denunciar.
    //  - derivacion_senalado: 'procedimiento_disciplinario' abre un flujo
    //    APARTE y solo procede si la conducta está tipificada como falta en el
    //    RICE; este protocolo no sanciona.
    { k:'medidas_senalado', n:'Evaluación y medidas respecto del estudiante señalado',
      t:'formulario', inv:'senalado',
      roles:[[P,ej],[O,ej]],
      campos:[sel('indicadores_vulneracion','¿El estudiante señalado presenta indicadores de vulneración de derechos?',SI_NO),
              sel('senalado_14_o_mas','¿El estudiante señalado tiene 14 años o más?',SI_NO),
              sel('derivacion_senalado','Derivación',['tribunal_familia','procedimiento_disciplinario','ninguna']),
              txt('medidas_formativas','Medidas formativas, pedagógicas y de apoyo psicosocial adoptadas',true)] },
    // Dos pasos y no uno con inv:'todos'. Aplanados en un solo paso, la misma
    // plantilla se cumplía contra la familia del afectado y contra la del
    // señalado, sin nada que impidiera volcar en una los antecedentes de la
    // otra — que es justo lo que prohíbe el Anexo 2 (vi) al exigir no exponer
    // la experiencia del estudiante frente al resto de la comunidad. Y con un
    // funcionario señalado el paso pedía notificar "a la familia" de un adulto
    // que no tiene apoderado.
    // Sin campos: la constancia de este paso es la notificación por persona
    // (fecha, vía, observación y quién la registró, en
    // PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO), no un texto libre del paso. El
    // campo que había acá pedía lo mismo una sola vez para un paso que se
    // cumple una vez por cada afectado, y siendo obligatorio trababa
    // "Completar paso" — justo lo que la fase 12 decidió no hacer con las
    // notificaciones pendientes.
    { k:'comunicacion', n:'Comunicación a la familia del estudiante afectado', t:'informativo',
      plazo:[8,'horas'], inv:'afectado', notif:1,
      roles:[[D,ej],[E,nt]] },
    // El único paso dirigido al señalado en todo el protocolo. No aplica
    // medidas ni imputa responsabilidad —eso es del Ministerio Público—, pero
    // el informe de cierre sí afirma qué se le atribuye, y contra ese informe
    // tiene que haber podido decir algo. Mismo criterio que el protocolo de
    // vulneración de derechos.
    pasoTestigos([[E,ej],[D,nt]]),
    { k:'notif_senalado', n:'Notificación de los hechos y descargos de la persona señalada',
      t:'formulario', plazo:[3,'dias_habiles'], inv:'senalado', notif:1,
      roles:[[E,ej],[D,nt]],
      campos:[sel('via_notificacion','Vía de notificación',['apoderado','laboral']),
              ...CAMPOS_DESCARGOS] },
    // inv:'todos' y no 'afectado': si al señalado se le aplicaron medidas
    // formativas, algo tiene que verificar después que se cumplieron. Con el
    // seguimiento solo sobre el afectado, el caso cerraba sin comprobarlo nunca.
    //
    // La salida del ciclo es un único campo a propósito: elegirTransicion
    // resuelve la rama con UNA condición, así que dos preguntas decisorias no
    // funcionan — la segunda no se miraría. Las otras dos quedan opcionales e
    // informativas, y son las que dan el detalle en el expediente. Mismo
    // patrón que acoso escolar y ciberacoso.
    { k:'seguimiento', n:'Seguimiento y acompañamiento', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'todos',
      roles:[[P,ej],[C,nt]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta para ambas partes?',SI_NO),
              sel('estudiante_en_tratamiento','¿El estudiante afectado está en tratamiento?',SI_NO,false),
              sel('medidas_senalado_cumplidas','¿Se cumplieron las medidas formativas del señalado?',SI_NO,false)] },
    { k:'cierre', n:'Cierre e informe', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['acogida','traslado','hay_senales_fisicas=si','Requiere atención médica'],
    ['acogida','notif_direccion',null,'Sin señales físicas',true],
    ['traslado','notif_direccion'], ['notif_direccion','denuncia'], ['denuncia','resguardo'],
    // Hasta acá 'presunto_agresor_es_funcionario' se preguntaba y no decidía
    // nada: resguardo iba derecho a comunicacion. Ahora es la bifurcación que
    // separa las dos respuestas que la norma trata distinto — al adulto se lo
    // separa de su función, al estudiante se lo evalúa y se lo acompaña.
    ['resguardo','medidas_adulto','presunto_agresor_es_funcionario=si','El presunto agresor es funcionario'],
    ['resguardo','medidas_senalado',null,'Es un par (estudiante)',true],
    ['medidas_adulto','comunicacion'], ['medidas_senalado','comunicacion'],
    ['comunicacion','declaracion_testigos'], ['declaracion_testigos','notif_senalado'],
    ['notif_senalado','seguimiento'],
    ['seguimiento','seguimiento','situacion_resuelta=no','Mantiene acompañamiento'],
    ['seguimiento','cierre',null,'Resuelto para ambas partes',true],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 6, // Protocolo de violencia entre adultos de la comunidad educativa
  categoria_ley: 'violencia_fisica',
  legal: 'Circular de Reglamentos Internos; Reglamento Interno de Orden, Higiene y Seguridad; Código del Trabajo.',
  pasos: [
    { k:'recepcion', n:'Recepción y registro del hecho', t:'formulario', plazo:[8,'horas'], inicial:true,
      roles:[[E,ej]],
      campos:[sel('partes','Partes involucradas',['apoderado_apoderado','apoderado_funcionario','funcionario_funcionario'])] },
    { k:'separacion', n:'Separación de las partes y medidas iniciales', t:'informativo', plazo:[2,'horas'],
      inv:'todos', roles:[[D,ej],[E,ej]] },
    { k:'clasificacion', n:'Clasificación de gravedad', t:'formulario', plazo:[8,'horas'],
      roles:[[E,ej],[D,ap]], campos:[sel('reviste_delito','¿Reviste delito?',SI_NO)] },
    { k:'denuncia', n:'Denuncia a autoridad externa', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      roles:[[D,ej]],
      campos:[sel('organismo','Organismo',ORGANISMOS)] },
    pasoAfectado([[C,ej]]),
    pasoTestigos([[C,ej]]),
    { k:'investigacion', n:'Investigación por el Comité o la dirección', t:'formulario', plazo:[10,'dias_habiles'],
      roles:[[C,ej],[D,ap]], campos:[sel('descargos_recibidos','¿Se recibieron los descargos?',SI_NO)] },
    { k:'resolucion', n:'Resolución y medidas (disciplinarias o administrativas)', t:'aprobacion', plazo:[3,'dias_habiles'],
      inv:'senalado', notif:1,
      roles:[[D,ej],[D,ap]], campos:[sel('ambito_medida','Ámbito de la medida',['convivencia','laboral'])] },
    { k:'seguimiento', n:'Seguimiento', t:'adjunto', ...CICLO_SEGUIMIENTO, roles:[[E,ej]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','separacion'], ['separacion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','declaracion_afectado',null,'No reviste delito',true],
    ['denuncia','declaracion_afectado'],
    ['declaracion_afectado','declaracion_testigos'], ['declaracion_testigos','investigacion'],
    ['investigacion','resolucion'], ['resolucion','seguimiento'],
    ['seguimiento','seguimiento','situacion_resuelta=no','Mantiene seguimiento'],
    ['seguimiento','cierre',null,'Resuelto',true],
  ],
},
// ---------------------------------------------------------------------------
{
  crear: { nombre:'Protocolo de ideación o intento suicida y autolesiones',
           descripcion:'Actuación ante señales de alerta, autolesiones, intento suicida o suicidio consumado de un estudiante, incluida la derivación a la red de salud mental.' },
  legal: 'Resolución Exenta 482/2018 de la Superintendencia; Recomendaciones MINSAL 2019; Ley 21.067 (Defensoría de la Niñez).',
  pasos: [
    { k:'deteccion', n:'Detección de señales de alerta', t:'formulario', plazo:[2,'horas'], inicial:true, inv:'afectado',
      roles:[[F,ej],[P,nt]], campos:[sel('nivel','Nivel de riesgo',['ideacion','autolesion','intento','consumado'])] },
    { k:'contencion', n:'Contención inicial (nunca dejar solo al estudiante)', t:'informativo', plazo:[2,'horas'],
      inv:'afectado', roles:[[P,ej],[PJ,ej]] },
    { k:'urgencia', n:'Derivación a urgencia médica', t:'notificacion_externa', plazo:[2,'horas'], vencer:'escalar',
      inv:'afectado', roles:[[S,ej],[D,nt]], campos:[txt('centro_destino','Centro asistencial',true)] },
    { k:'notificacion', n:'Notificación a apoderados', t:'formulario', plazo:[8,'horas'], inv:'afectado', notif:1,
      roles:[[P,ej],[E,nt]], campos:[txt('observaciones','Constancia de la notificación')] },
    { k:'ficha', n:'Ficha de derivación a la red de salud mental', t:'adjunto', plazo:[24,'horas'], vencer:'escalar',
      inv:'afectado', roles:[[P,ej]], campos:[sel('apoderado_cumplio_derivacion','¿El apoderado cumplió la derivación?',SI_NO)] },
    { k:'defensoria', n:'Denuncia a la Defensoría de la Niñez', t:'notificacion_externa',
      roles:[[D,ej]] },
    { k:'plan', n:'Plan de acompañamiento escolar', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'afectado',
      roles:[[P,ej],[PJ,nt]], campos:[sel('estudiante_estabilizado','¿El estudiante está estabilizado?',SI_NO)] },
    { k:'postvencion', n:'Postvención', t:'informativo', plazo:[2,'horas'],
      roles:[[D,ej],[P,ej]], campos:[sel('riesgo_contagio','¿Hay riesgo de efecto contagio?',SI_NO)] },
    { k:'cierre', n:'Cierre y registro', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['deteccion','postvencion','nivel=consumado','Suicidio consumado'],
    ['deteccion','urgencia','nivel=intento','Intento suicida'],
    ['deteccion','contencion',null,'Ideación o autolesión',true],
    ['contencion','notificacion'], ['urgencia','notificacion'], ['notificacion','ficha'],
    ['ficha','defensoria','apoderado_cumplio_derivacion=no','El apoderado no cumplió'],
    ['ficha','plan',null,'Derivación cumplida',true],
    ['defensoria','plan'],
    ['plan','plan','estudiante_estabilizado=no','Mantiene acompañamiento'],
    ['plan','cierre',null,'Estabilizado',true],
    ['postvencion','cierre'],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 10, // Protocolo de consumo, porte o tráfico de drogas y alcohol
  legal: 'Ley 20.000; orientaciones SENDA; Circular de Reglamentos Internos.',
  pasos: [
    { k:'deteccion', n:'Detección y registro del hecho', t:'formulario', plazo:[2,'horas'], inicial:true,
      roles:[[F,ej],[E,nt]],
      campos:[sel('situacion','Situación',['consumo','porte','trafico']), sel('dentro_establecimiento','¿Ocurrió dentro del establecimiento?',SI_NO,false)] },
    { k:'denuncia', n:'Denuncia obligatoria (tráfico o microtráfico)', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      roles:[[D,ej]],
      campos:[sel('organismo','Organismo',['fiscalia','pdi','carabineros'])] },
    { k:'evaluacion', n:'Evaluación del caso y entrevista', t:'formulario', plazo:[8,'horas'], inv:'senalado',
      roles:[[E,ej],[P,ej]], campos:[sel('requiere_derivacion_senda','¿Requiere derivación a SENDA?',SI_NO)] },
    { k:'notificacion', n:'Notificación a la familia', t:'formulario', plazo:[8,'horas'], inv:'senalado', notif:1,
      roles:[[E,ej],[PJ,nt]], campos:[txt('observaciones','Constancia de la notificación')] },
    { k:'derivacion', n:'Derivación a SENDA o red de salud', t:'notificacion_externa', inv:'senalado',
      roles:[[P,ej]], campos:[sel('red_destino','Red de destino',['senda','cesfam','otro'])] },
    pasoDescargos(),
    { k:'medidas', n:'Medidas formativas y seguimiento', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'senalado',
      roles:[[E,ej],[P,ej]], campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['deteccion','denuncia','situacion=trafico','Tráfico o microtráfico'],
    ['deteccion','evaluacion',null,'Consumo o porte',true],
    ['denuncia','evaluacion'], ['evaluacion','notificacion'], ['notificacion','derivacion'],
    ['derivacion','descargos'], ['descargos','medidas'],
    ['medidas','medidas','situacion_resuelta=no','Mantiene seguimiento'],
    ['medidas','cierre',null,'Resuelto',true],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 9, // Protocolo de accidentes escolares
  legal: 'Ley 16.744 (Seguro Escolar); DS 313; Circular de Reglamentos Internos.',
  pasos: [
    // Los primeros auxilios eran un paso aparte del mismo Encargado de Salud
    // dentro de la misma ventana de 2 h: se registran como campo del mismo acto.
    { k:'atencion', n:'Atención inmediata, primeros auxilios y evaluación de gravedad', t:'formulario',
      plazo:[2,'horas'], inicial:true, inv:'afectado', roles:[[S,ej]],
      campos:[sel('gravedad','Gravedad',['leve','moderado','grave']),
              sel('primeros_auxilios_aplicados','¿Se aplicaron primeros auxilios?',SI_NO,false)] },
    { k:'traslado', n:'Traslado a centro asistencial', t:'notificacion_externa', plazo:[2,'horas'], vencer:'escalar',
      inv:'afectado', roles:[[I,ej],[D,nt]], campos:[txt('centro_destino','Centro asistencial',true)] },
    { k:'seguro', n:'Emisión del formulario de Seguro Escolar', t:'adjunto', plazo:[8,'horas'], inv:'afectado',
      roles:[[I,ej]] },
    { k:'notificacion', n:'Notificación al apoderado', t:'formulario', plazo:[2,'horas'], inv:'afectado', notif:1,
      roles:[[I,ej]], campos:[txt('observaciones','Constancia de la notificación')] },
    { k:'registro', n:'Registro del accidente y seguimiento', t:'adjunto', plazo:[8,'horas'], final:true,
      roles:[[I,ej],[D,ap]], campos:[sel('requiere_seguimiento','¿Requiere seguimiento?',SI_NO,false)] },
  ],
  trans: [
    ['atencion','traslado','gravedad=grave','Accidente grave'],
    ['atencion','seguro',null,'Leve o moderado',true],
    ['traslado','seguro'], ['seguro','notificacion'], ['notificacion','registro'],
  ],
},
// ---------------------------------------------------------------------------
{
  crear: { nombre:'Protocolo de retención y apoyo a estudiantes embarazadas, madres y padres adolescentes',
           descripcion:'Acompañamiento y resguardo del derecho a la educación de estudiantes en situación de embarazo, maternidad o paternidad.' },
  legal: 'Ley 20.370 (LGE) art. 11; Decreto 79/2005; Circular de Reglamentos Internos.',
  pasos: [
    { k:'acogida', n:'Acogida y registro de la situación', t:'formulario', plazo:[8,'horas'], inicial:true,
      roles:[[O,ej],[E,nt]], campos:[sel('condicion','Condición',['embarazo','maternidad','paternidad'])] },
    { k:'coordinacion', n:'Coordinación con la familia y el equipo', t:'formulario', plazo:[3,'dias_habiles'],
      roles:[[O,ej],[PJ,ej]], campos:[sel('apoderado_informado','¿Se informó al apoderado?',SI_NO)] },
    { k:'plan', n:'Plan de acompañamiento académico', t:'aprobacion',
      roles:[[O,ej],[U,ap]], campos:[sel('requiere_flexibilidad_horaria','¿Requiere flexibilidad horaria?',SI_NO)] },
    // Ciclo más largo que el resto: este acompañamiento dura el embarazo y el
    // posparto, y revisarlo cada 15 días sería ruido, no seguimiento.
    { k:'seguimiento', n:'Seguimiento del proceso (pre y post parto)', t:'formulario',
      plazo:[30,'dias_corridos'], vencer:'marcar_alerta',
      roles:[[O,ej],[PJ,nt]], campos:[sel('estudiante_activo','¿El estudiante sigue activo en el establecimiento?',SI_NO)] },
    { k:'cierre', n:'Cierre y continuidad', t:'adjunto', final:true, roles:[[O,ej],[D,ap]] },
  ],
  trans: [
    ['acogida','coordinacion'], ['coordinacion','plan'], ['plan','seguimiento'],
    ['seguimiento','seguimiento','estudiante_activo=si','Continúa el acompañamiento'],
    ['seguimiento','cierre',null,'Egresa o se estabiliza',true],
  ],
},
// ---------------------------------------------------------------------------
{
  crear: { nombre:'Protocolo de salidas pedagógicas y giras de estudio',
           descripcion:'Autorización, ejecución y registro de salidas fuera del establecimiento, con las medidas de seguridad y las autorizaciones exigidas.' },
  legal: 'Circular de Reglamentos Internos; normativa de seguridad escolar.',
  pasos: [
    { k:'solicitud', n:'Solicitud y planificación de la salida', t:'formulario', inicial:true,
      roles:[[DC,ej],[U,ap]],
      campos:[sel('tipo','Tipo de actividad',['salida_pedagogica','gira']), sel('requiere_transporte','¿Requiere transporte?',SI_NO,false)] },
    { k:'autorizacion', n:'Autorización directiva y del sostenedor', t:'aprobacion',
      roles:[[D,ej],[D,ap]], campos:[sel('autorizacion_deprov','¿Se informó al DEPROV?',SI_NO)] },
    { k:'autorizaciones', n:'Recolección de autorizaciones de apoderados', t:'adjunto',
      roles:[[DC,ej]], campos:[sel('todas_autorizaciones','¿Están todas las autorizaciones?',SI_NO)] },
    { k:'ejecucion', n:'Ejecución con medidas de seguridad', t:'informativo',
      roles:[[DC,ej],[I,nt]], campos:[sel('hubo_incidente','¿Hubo algún incidente?',SI_NO)] },
    { k:'registro', n:'Registro y cierre', t:'adjunto', final:true, roles:[[DC,ej],[U,ap]] },
  ],
  trans: [
    ['solicitud','autorizacion'], ['autorizacion','autorizaciones'],
    ['autorizaciones','ejecucion'], ['ejecucion','registro'],
  ],
},
// ---------------------------------------------------------------------------
// Es protocolo aparte y no una rama del de vulneración de derechos porque el
// señalado es un adulto de la comunidad: la asimetría de poder obliga a separar
// del estudiante antes de investigar, la denuncia externa no es opcional cuando
// hay delito, y la sanción no la aplica el reglamento de convivencia sino el
// estatuto laboral o administrativo que corresponda. Nada de eso calza con un
// grafo pensado para medidas entre estudiantes.
{
  crear: { nombre:'Protocolo de maltrato de un funcionario o adulto de la comunidad hacia un estudiante',
           descripcion:'Actuación ante maltrato físico, psicológico o trato degradante de un funcionario, apoderado u otro adulto de la comunidad educativa hacia un estudiante, incluidas la separación preventiva del adulto y la derivación al procedimiento laboral o administrativo.' },
  categoria_ley: 'violencia_fisica',
  legal: 'Ley 20.536; Ley 21.430 de Garantías de la Niñez; deber de denuncia del art. 175 del Código Procesal Penal; Estatuto Docente o Código del Trabajo según la dependencia; Circular de Reglamentos Internos.',
  pasos: [
    // La notificación a la dirección era un paso aparte con el mismo ejecutor,
    // la misma ventana de 2 h y el Director ya notificado acá: era el mismo
    // acto contado dos veces.
    { k:'recepcion', n:'Recepción de la denuncia, resguardo inmediato del estudiante y aviso a la dirección',
      t:'formulario', plazo:[2,'horas'], inicial:true, roles:[[E,ej],[D,nt]],
      campos:[sel('vinculo_del_adulto','Vínculo del adulto señalado',['funcionario','apoderado','externo']),
              sel('hay_lesiones','¿Hay lesiones o señales físicas?',SI_NO)] },
    { k:'clasificacion', n:'Calificación de los hechos', t:'formulario', plazo:[8,'horas'],
      roles:[[E,ej],[D,ap]], campos:[sel('reviste_delito','¿Reviste delito?',SI_NO)] },
    { k:'denuncia', n:'Denuncia a autoridad competente', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      roles:[[D,ej],[E,nt]],
      campos:[sel('organismo','Organismo',ORGANISMOS)] },
    // Cautelar, igual que en vulneración de derechos: separa antes de oír al
    // señalado porque lo que se protege mientras tanto es el estudiante.
    { k:'separacion', n:'Medida de resguardo: cese del trato directo con estudiantes', t:'aprobacion',
      plazo:[8,'horas'], inv:'senalado', roles:[[D,ej],[D,ap]],
      campos:[sel('medida_aplicada','Medida aplicada',
                  ['cese_trato_directo','cambio_de_funciones','separacion_temporal','prohibicion_de_ingreso','ninguna'])] },
    // Sin campos, igual que en violencia entre estudiantes: la constancia es la
    // notificación por persona.
    { k:'comunicacion', n:'Comunicación a la familia del estudiante', t:'informativo', plazo:[8,'horas'],
      inv:'afectado', notif:1, roles:[[E,ej],[PJ,nt]] },
    // `medida:'proteccion'` como en bullying, connotación sexual, vulneración
    // de derechos, agresión física y discriminación: acá el afectado es un
    // estudiante y lo que se adopta a su favor es una medida del art. 16 E
    // letra j. Faltaba, y por eso este protocolo era el único que atravesaba
    // entero sin pedir nunca una medida de protección. No se marca el paso
    // 'separacion': eso recae sobre el funcionario y es separación de
    // funciones, no una medida de protección (ver la nota del protocolo de
    // connotación sexual sobre el Dictamen 471/2017).
    { k:'apoyo', n:'Medidas de apoyo y contención al estudiante', t:'informativo', plazo:[2,'horas'],
      inv:'afectado', medida:'proteccion', roles:[[P,ej],[O,ej]] },
    pasoAfectado([[E,ej]]),
    pasoTestigos([[E,ej]]),
    { k:'investigacion', n:'Investigación interna', t:'formulario', plazo:[10,'dias_habiles'],
      roles:[[E,ej],[C,ap]],
      campos:[txt('observaciones','Antecedentes y conclusiones de la investigación')] },
    pasoDescargos('Notificación de cargos y descargos del adulto señalado'),
    // El establecimiento no sanciona laboralmente dentro del protocolo: decide
    // y deriva. Por eso el campo registra la vía y no una medida.
    { k:'resolucion', n:'Resolución y derivación al procedimiento laboral o administrativo', t:'aprobacion',
      plazo:[3,'dias_habiles'], inv:'senalado', roles:[[D,ej],[D,ap]],
      campos:[sel('via_disciplinaria','Vía disciplinaria',
                  ['sumario','investigacion_sumaria','medida_laboral','denuncia_ya_derivada','sin_medida'])] },
    { k:'notificacion', n:'Notificación de la resolución a las partes', t:'formulario', plazo:[1,'dias_habiles'],
      inv:'todos', notif:1, roles:[[E,ej]], campos:[CAMPO_APELACION] },
    pasoApelacion(),
    { k:'seguimiento', n:'Seguimiento del estudiante afectado', t:'formulario', ...CICLO_SEGUIMIENTO,
      inv:'afectado', roles:[[P,ej],[E,nt]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe final', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','separacion',null,'No reviste delito',true],
    ['denuncia','separacion'], ['separacion','comunicacion'], ['comunicacion','apoyo'],
    ['apoyo','declaracion_afectado'], ['declaracion_afectado','declaracion_testigos'],
    ['declaracion_testigos','investigacion'], ['investigacion','descargos'], ['descargos','resolucion'],
    ['resolucion','notificacion'],
    ['notificacion','apelacion','hay_apelacion=si','Se presentó apelación'],
    ['notificacion','seguimiento',null,'Sin apelación',true],
    ['apelacion','resolucion','aprobado=si','Apelación acogida: se revisa la medida'],
    ['apelacion','seguimiento',null,'Apelación rechazada',true],
    ['seguimiento','seguimiento','situacion_resuelta=no','Mantiene seguimiento'],
    ['seguimiento','cierre',null,'Resuelto',true],
  ],
},
// ---------------------------------------------------------------------------
// La ley no exige este protocolo (no está entre los de la Circular de
// Reglamentos Internos), pero 4 de los 5 RICE revisados lo tienen y la falta ya
// existe en la plantilla de tipos de falta como gravísima. Se modela con la
// bifurcación que hacen todos ellos: hurto (sin violencia) es vía formativa y
// reparatoria; robo (con fuerza o intimidación) obliga a denunciar en 24 horas
// por el art. 175 letra e). El tercer camino, el extravío, existe porque la
// mayoría de las denuncias se cierran ahí y meterlas al circuito completo
// deja a un estudiante señalado en un expediente por algo que apareció.
{
  crear: { nombre:'Protocolo de actuación frente a hurto o robo de especies',
           descripcion:'Actuación ante la denuncia de sustracción de dinero o bienes dentro del establecimiento, distinguiendo el extravío del hurto y del robo, con el deber de denuncia cuando los hechos revisten caracteres de delito.' },
  legal: 'Código Penal (hurto y robo); deber de denuncia del art. 175 letra e) del Código Procesal Penal; Ley 20.536 sobre Violencia Escolar; Ley 21.430 de Garantías de la Niñez; Circular de Reglamentos Internos.',
  pasos: [
    { k:'recepcion', n:'Recepción de la denuncia y registro de la especie', t:'formulario', plazo:[8,'horas'], inicial:true,
      d:'Acoger el relato de la persona afectada y dejar constancia escrita de fecha, hora, lugar, personas involucradas y descripción del bien. Si la denuncia llega al término de la jornada, se retoma a primera hora del día siguiente.',
      roles:[[F,ej],[I,nt],[E,nt]],
      campos:[txt('especie','Especie o bien denunciado',true)] },
    // Antes de investigar a nadie: la mayoría de estos casos son extravíos, y
    // el paso existe para cerrarlos ahí. La calificación se pregunta acá mismo
    // y solo si la especie no apareció: era un paso propio y no hacía nada que
    // no cupiera en este formulario.
    { k:'busqueda', n:'Búsqueda inicial y calificación de los hechos', t:'formulario', plazo:[8,'horas'],
      d:'Revisión colaborativa de pertenencias con el curso, en clave formativa. Queda prohibido realizar revisiones corporales, interrogatorios intimidatorios o exponer a un estudiante frente al curso u otros miembros de la comunidad.',
      roles:[[E,ej],[PJ,ej],[D,nt]],
      campos:[sel('especie_recuperada','¿Apareció la especie?',SI_NO),
              sel('calificacion','Calificación',['hurto','robo'],true,'especie_recuperada=no')] },
    { k:'denuncia', n:'Denuncia a autoridad competente', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      d:'El robo (fuerza en las cosas, violencia o intimidación) reviste caracteres de delito. No se altera el sitio del suceso hasta que la policía realice las pericias.',
      roles:[[D,ej],[E,nt]],
      campos:[sel('organismo','Organismo',ORGANISMOS)] },
    { k:'comunicacion', n:'Comunicación a los apoderados', t:'informativo', plazo:[48,'horas'],
      inv:'todos', notif:1, roles:[[E,ej],[PJ,nt]] },
    { k:'investigacion', n:'Investigación interna', t:'formulario', plazo:[10,'dias_habiles'],
      d:'Entrevistas por separado, revisión de antecedentes disponibles y declaraciones de testigos, con estricta reserva.',
      roles:[[E,ej],[C,ap]],
      campos:[txt('observaciones','Antecedentes y conclusiones de la investigación'),
              sel('responsable_identificado','¿Se identificó al responsable?',SI_NO)] },
    pasoDescargos('Notificación de cargos y descargos de la persona señalada'),
    // El reconocimiento voluntario como atenuante aparece textual en tres de
    // los cuatro RICE con protocolo, y es lo que sostiene el enfoque formativo:
    // sin él, reconocer la falta solo empeora la sanción.
    { k:'resolucion', n:'Resolución: medidas formativas, reparatorias o disciplinarias', t:'aprobacion', medida:'disciplinaria',
      plazo:[3,'dias_habiles'], inv:'senalado', roles:[[C,ej],[D,ap]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','reparatoria','disciplinaria','mixta']),
              sel('reconocimiento_voluntario','¿Reconoció voluntariamente la falta? (atenuante)',SI_NO,false)] },
    { k:'notificacion', n:'Notificación de la resolución a las partes', t:'formulario', plazo:[1,'dias_habiles'],
      inv:'todos', notif:1, roles:[[E,ej]], campos:[CAMPO_APELACION] },
    pasoApelacion(),
    // Sin ciclo de seguimiento: lo único que hay que verificar después de la
    // medida es si el bien se devolvió, y eso es un campo del cierre. Un ciclo
    // de 15 días para eso solo genera alertas de un caso que ya terminó.
    { k:'cierre', n:'Cierre del caso e informe final', t:'adjunto', final:true, roles:[[E,ej],[D,ap]],
      campos:[sel('restitucion','Estado de la restitución',['restituido','repuesto','acuerdo_de_reposicion','no_procede'],false)] },
  ],
  trans: [
    ['recepcion','busqueda'],
    ['busqueda','cierre','especie_recuperada=si','Era un extravío: la especie apareció'],
    ['busqueda','denuncia','calificacion=robo','Robo: reviste delito'],
    ['busqueda','comunicacion',null,'Hurto',true],
    ['denuncia','comunicacion'], ['comunicacion','investigacion'],
    ['investigacion','cierre','responsable_identificado=no','Sin responsable identificado'],
    ['investigacion','descargos',null,'Responsable identificado',true],
    ['descargos','resolucion'], ['resolucion','notificacion'],
    ['notificacion','apelacion','hay_apelacion=si','Se presentó apelación'],
    ['notificacion','cierre',null,'Sin apelación',true],
    ['apelacion','resolucion','aprobado=si','Apelación acogida: se revisa la medida'],
    ['apelacion','cierre',null,'Apelación rechazada',true],
  ],
},
// ---------------------------------------------------------------------------
// Los cuatro protocolos siguientes (45, 46, 47, 48) se crearon por la UI y solo
// existían en la base: no tenían definición acá, así que --recargar no podía
// reconstruirlos ni corregirlos. Se portan primero tal cual estaban (ver
// docs/normativa y el propio grafo publicado) y recién en un commit posterior
// se les agregan los pasos de declaración de testigos/afectado.
//
// Dos pasos "Comunicación al/a los apoderado(s)" venían como tipo_paso
// 'formulario' sin ningún campo propio (solo la constancia de notificación).
// Un formulario sin campos es justo lo que este script bloquea al validar
// (`'{n}' es formulario y no tiene campos`), así que se portan como
// 'informativo': mismo comportamiento visible (sin campos, con constancia de
// notificación), tipo correcto.
{
  id: 45, // Protocolo de porte de armas u objetos peligrosos
  categoria_ley: 'violencia_fisica',
  legal: 'DFL N°2/1998 (Ley de Subvenciones) art. 6 letra d), texto Ley 21.128; deber de denuncia del art. 175 letra e) y art. 176 del Código Procesal Penal; Ley 20.084 (responsabilidad penal adolescente).',
  pasos: [
    { k:'resguardo', n:'Resguardo del área y aviso inmediato', t:'formulario', plazo:[1,'horas'], vencer:'escalar', inicial:true,
      d:'Poner a salvo a las personas y aislar el objeto SIN forcejear ni intentar quitárselo por la fuerza a nadie. Avisar de inmediato a Inspectoría y a la dirección. Si hay lesionados, activar primeros auxilios y el protocolo de accidentes escolares en paralelo.',
      roles:[[D,nt],[E,nt],[F,ej],[I,ej]],
      campos:[sel('tipo_objeto','Tipo de objeto',['arma_de_fuego','arma_blanca','replica_o_simulacro','objeto_contundente','elemento_incendiario','otro']),
              sel('constituye_delito','¿Existen antecedentes que hagan presumir un delito? (ante la duda, sí: la calificación la hace la Fiscalía)',SI_NO),
              sel('hubo_lesionados','¿Hubo personas lesionadas?',SI_NO),
              sel('destino_objeto','Destino del objeto (un arma de fuego no se manipula: se aísla y se espera a Carabineros)',
                  ['aislado_en_el_lugar','entregado_a_carabineros','retenido_por_inspectoria','entregado_al_apoderado','no_habido']),
              txt('observaciones','Descripción del hallazgo y cómo se detectó',true)] },
    { k:'comunicacion', n:'Comunicación al apoderado', t:'informativo', plazo:[4,'horas'], inv:'senalado', notif:1,
      d:'Citar al apoderado del estudiante señalado y dejar constancia escrita de la comunicación, con firma de recepción.',
      roles:[[E,ej],[PJ,nt],[I,ej]] },
    { k:'denuncia', n:'Denuncia a autoridad competente', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      d:'Denuncia obligatoria dentro de 24 horas (art. 175 letra e y art. 176 del Código Procesal Penal). Si el estudiante es menor de 14 años no hay responsabilidad penal: la derivación va a Tribunal de Familia.',
      roles:[[D,ej],[E,ej],[I,ej]],
      campos:[sel('organismo','Organismo',['carabineros','pdi','fiscalia','tribunal_de_familia']),
              txt('folio_parte','Folio, N° de parte o constancia entregado por la autoridad',true),
              txt('observaciones','Quién concurrió a denunciar, fecha y hora, y antecedentes entregados',true)] },
    // `medida:'cautelar'` y no 'cualquiera': lo que este paso resuelve es la
    // suspensión del art. 6 letra d, y 'cualquiera' se daría por cumplido con
    // la medida disciplinaria del final del mismo caso — que es exactamente lo
    // que TIPOS_MEDIDA_REQUERIDA existe para evitar.
    //
    // La pregunta `tipo_medida` es lo que hace posible marcarlo: la descripción
    // dice que no suspender también es una decisión válida, y 'sin_medida' es
    // la respuesta que el motor reconoce para dejar de reclamar la medida
    // (medidaPendienteDe en protocolosActivados.controller.js). Sin ella, el
    // caso quedaría con un aviso de medida pendiente imposible de responder.
    { k:'evaluacion', n:'Evaluación de medidas de resguardo y suspensión cautelar', t:'aprobacion', plazo:[1,'dias_habiles'],
      d:'El director resuelve si aplica la suspensión cautelar mientras dura el procedimiento (art. 6 letra d del DFL 2, Ley 21.128). Es una facultad, no una obligación: rechazarla también es una decisión válida y queda registrada.',
      medida:'cautelar', roles:[[D,ap],[E,ej]],
      campos:[sel('tipo_medida','¿Qué resuelve el director?',['suspension_cautelar','sin_medida']),
              txt('observaciones','Fundamento de la decisión',true)] },
    pasoTestigos([[D,nt],[E,ej],[O,ej]]),
    { k:'descargos', n:'Investigación y descargos de la persona señalada', t:'formulario', plazo:[3,'dias_habiles'], inv:'senalado', notif:1,
      d:'Recabar antecedentes y oír al estudiante señalado antes de decidir. Si no alcanza a dar su versión, la sanción se puede caer aunque el hecho sea cierto: por eso hay que dejar registrado si presentó descargos o no.',
      roles:[[D,nt],[E,ej],[O,ej]],
      campos:[...CAMPOS_DESCARGOS, txt('observaciones','Antecedentes y conclusiones')] },
    { k:'resolucion', n:'Resolución: medidas formativas, reparatorias o disciplinarias', t:'aprobacion', plazo:[3,'dias_habiles'], inv:'senalado', medida:'disciplinaria',
      d:'El director resuelve la medida. La expulsión o cancelación de matrícula exige además el informe previo y su propio procedimiento: marcarla acá no la aplica por sí sola.',
      roles:[[D,ap],[E,ej],[C,ej]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','reparatoria','disciplinaria','expulsion_o_cancelacion','sin_medida']),
              sel('reconocimiento_voluntario','¿Reconoció voluntariamente la falta? (atenuante)',SI_NO,false),
              txt('observaciones','Fundamento de la medida',true)] },
    { k:'expulsion', n:'Decisión de expulsión o cancelación de matrícula', t:'aprobacion', plazo:[3,'dias_habiles'], inv:'senalado', notif:1,
      d:'Solo el director puede adoptar esta medida (DFL 2/2009 art. 6 letra d), texto de la Ley 21.128). Debe constar que se representó previamente la situación al apoderado y que se implementaron medidas de apoyo pedagógico o psicosocial.',
      roles:[[D,ap],[E,ej],[C,nt]],
      campos:[sel('medida_adoptada','Medida adoptada por el director',['expulsion','cancelacion_de_matricula','se_desestima']),
              sel('apoyos_previos_acreditados','¿Consta la representación previa al apoderado y las medidas de apoyo?',SI_NO),
              txt('observaciones','Fundamento de la decisión',true)] },
    { k:'informe_superintendencia', n:'Informe de la expulsión a la Superintendencia de Educación', t:'notificacion_externa', plazo:[5,'dias_habiles'], vencer:'escalar',
      d:'El director debe informar la expulsión o cancelación de matrícula a la Dirección Regional de la Superintendencia dentro de 5 días hábiles de aplicada la medida (DFL 2/2009 art. 6 letra d).',
      roles:[[D,ej],[E,ej]], campos:[txt('constancia_envio','N° de ingreso o constancia del informe a la Superintendencia',true)] },
    { k:'notificacion', n:'Notificación de la resolución a las partes', t:'formulario', plazo:[1,'dias_habiles'], inv:'todos', notif:1,
      d:'Notificar por escrito la medida y el plazo para pedir reconsideración. Sin esta constancia la medida es inoponible al apoderado.',
      roles:[[E,ej],[PJ,nt]], campos:[sel('hay_apelacion','¿Se presentó reconsideración o apelación?',SI_NO)] },
    { k:'reconsideracion', n:'Resolución de la reconsideración', t:'aprobacion', plazo:[5,'dias_habiles'], inv:'senalado',
      d:'El director resuelve la reconsideración. Si la acoge, el caso vuelve al paso de resolución para revisar la medida.',
      roles:[[D,ap],[E,ej]], campos:[txt('observaciones','Fundamento de la resolución',true)] },
    { k:'cierre', n:'Cierre del caso e informe final', t:'adjunto', final:true,
      d:'Informe final con lo actuado y el seguimiento comprometido. Es el documento que el colegio entrega si después le piden cuentas por este caso.',
      roles:[[D,nt],[E,ej]], campos:[txt('observaciones','Resumen de lo actuado y seguimiento',true)] },
  ],
  trans: [
    ['resguardo','denuncia','constituye_delito=si','Reviste carácter de delito'],
    ['resguardo','denuncia','tipo_objeto=arma_de_fuego','Arma de fuego: denuncia obligatoria'],
    ['resguardo','denuncia','tipo_objeto=elemento_incendiario','Elemento incendiario: denuncia obligatoria'],
    ['resguardo','denuncia','hubo_lesionados=si','Hubo lesionados: denuncia obligatoria'],
    ['resguardo','comunicacion',null,'No reviste delito',true],
    ['comunicacion','evaluacion',null,null,true],
    ['denuncia','comunicacion'],
    ['evaluacion','declaracion_testigos',null,'Continúa el procedimiento',true],
    ['declaracion_testigos','descargos'],
    ['descargos','resolucion'],
    ['resolucion','notificacion'],
    ['resolucion','expulsion','tipo_medida=expulsion_o_cancelacion','Se propone expulsión o cancelación'],
    ['expulsion','informe_superintendencia','aprobado=si','El director aplica la medida'],
    ['expulsion','notificacion',null,'El director desestima la expulsión',true],
    ['informe_superintendencia','notificacion',null,null,true],
    ['notificacion','reconsideracion','hay_apelacion=si','Se presentó reconsideración'],
    ['notificacion','cierre',null,'Sin reconsideración',true],
    ['reconsideracion','resolucion','aprobado=si','Acogida: se revisa la medida'],
    ['reconsideracion','cierre',null,'Rechazada',true],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 46, // Protocolo de agresión física entre estudiantes
  categoria_ley: 'violencia_fisica',
  legal: 'Ley 20.536 sobre Violencia Escolar; deber de denuncia del art. 175 letra e) y art. 176 del Código Procesal Penal; DFL N°2/1998 art. 6 letra d), texto Ley 21.128; Ley 21.809 art. 16 E letra j).',
  pasos: [
    { k:'separacion', n:'Separación de las partes y atención de lesiones', t:'formulario', plazo:[1,'horas'], vencer:'escalar', inicial:true,
      d:'Separar a los involucrados, evaluar lesiones y activar primeros auxilios. Si hay traslado a un centro asistencial, corre en paralelo el protocolo de accidentes escolares y el seguro escolar.',
      roles:[[E,nt],[F,ej],[S,ej],[I,nt]],
      campos:[sel('hubo_lesionados','¿Hubo personas lesionadas?',SI_NO),
              sel('lesiones_graves','¿Las lesiones revisten gravedad o requirieron atención externa?',SI_NO),
              txt('observaciones','Descripción de lo ocurrido y atención prestada',true)] },
    { k:'comunicacion', n:'Comunicación a los apoderados', t:'informativo', plazo:[4,'horas'], inv:'todos', notif:1,
      d:'Informar a los apoderados de ambas partes y dejar constancia firmada.',
      roles:[[E,ej],[PJ,nt],[I,ej]] },
    { k:'denuncia', n:'Denuncia a autoridad competente', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      d:'Las lesiones constituyen delito: denuncia obligatoria dentro de 24 horas (art. 175 letra e y art. 176 del Código Procesal Penal). Bajo 14 años no hay responsabilidad penal y la derivación va a Tribunal de Familia.',
      roles:[[D,ej],[E,ej],[I,ej]],
      campos:[sel('organismo','Organismo',['carabineros','pdi','fiscalia','tribunal_de_familia']),
              txt('observaciones','N° de parte o constancia y fecha',true)] },
    { k:'resguardo', n:'Medidas de resguardo para el estudiante afectado', t:'aprobacion', plazo:[1,'dias_habiles'], inv:'afectado', medida:'proteccion',
      d:'Medidas de protección mientras dura el procedimiento (art. 16 E letra j): separación de espacios, acompañamiento, cambio de rutina. No son sanciones y no requieren que la investigación haya terminado.',
      roles:[[D,ap],[E,ej],[O,nt]], campos:[txt('observaciones','Medidas adoptadas y su fundamento',true)] },
    pasoAfectado([[D,nt],[E,ej],[C,ej]]),
    pasoTestigos([[D,nt],[E,ej],[C,ej]]),
    { k:'descargos', n:'Investigación y descargos de la persona señalada', t:'formulario', plazo:[5,'dias_habiles'], inv:'senalado', notif:1,
      d:'Recabar antecedentes, entrevistar a testigos y oír al estudiante señalado antes de decidir. Si no alcanza a dar su versión, la sanción se puede caer aunque el hecho sea cierto: es el reclamo que más veces le gana un apoderado al colegio.',
      roles:[[D,nt],[E,ej],[C,ej]],
      campos:[...CAMPOS_DESCARGOS, txt('observaciones','Antecedentes y conclusiones')] },
    { k:'resolucion', n:'Resolución: medidas formativas, reparatorias o disciplinarias', t:'aprobacion', plazo:[3,'dias_habiles'], inv:'senalado', medida:'disciplinaria',
      d:'El director resuelve. La ley pide graduar según la edad, el reconocimiento voluntario y si hubo provocación previa, no solo según el resultado.',
      roles:[[D,ap],[E,ej],[C,ej]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','reparatoria','disciplinaria','expulsion_o_cancelacion','sin_medida']),
              sel('reconocimiento_voluntario','¿Reconoció voluntariamente la falta? (atenuante)',SI_NO,false),
              txt('observaciones','Fundamento de la medida',true)] },
    { k:'expulsion', n:'Decisión de expulsión o cancelación de matrícula', t:'aprobacion', plazo:[3,'dias_habiles'], inv:'senalado', notif:1,
      d:'Solo el director puede adoptar esta medida (DFL 2/2009 art. 6 letra d), texto de la Ley 21.128). Debe constar que se representó previamente la situación al apoderado y que se implementaron medidas de apoyo pedagógico o psicosocial.',
      roles:[[D,ap],[E,ej],[C,nt]],
      campos:[sel('medida_adoptada','Medida adoptada por el director',['expulsion','cancelacion_de_matricula','se_desestima']),
              sel('apoyos_previos_acreditados','¿Consta la representación previa al apoderado y las medidas de apoyo?',SI_NO),
              txt('observaciones','Fundamento de la decisión',true)] },
    { k:'informe_superintendencia', n:'Informe de la expulsión a la Superintendencia de Educación', t:'notificacion_externa', plazo:[5,'dias_habiles'], vencer:'escalar',
      d:'El director debe informar la expulsión o cancelación de matrícula a la Dirección Regional de la Superintendencia dentro de 5 días hábiles de aplicada la medida (DFL 2/2009 art. 6 letra d).',
      roles:[[D,ej],[E,ej]], campos:[txt('constancia_envio','N° de ingreso o constancia del informe a la Superintendencia',true)] },
    { k:'notificacion', n:'Notificación de la resolución a las partes', t:'formulario', plazo:[1,'dias_habiles'], inv:'todos', notif:1,
      d:'Notificar por escrito a ambas partes, con el plazo para pedir reconsideración. Sin constancia la medida es inoponible al apoderado.',
      roles:[[E,ej],[PJ,nt]], campos:[sel('hay_apelacion','¿Se presentó reconsideración o apelación?',SI_NO)] },
    { k:'reconsideracion', n:'Resolución de la reconsideración', t:'aprobacion', plazo:[5,'dias_habiles'], inv:'senalado',
      d:'Si se acoge, el caso vuelve al paso de resolución para revisar la medida.',
      roles:[[D,ap],[E,ej]], campos:[txt('observaciones','Fundamento de la resolución',true)] },
    { k:'cierre', n:'Cierre del caso e informe final', t:'adjunto', final:true,
      d:'Informe con lo actuado y el seguimiento comprometido para ambas partes.',
      roles:[[D,nt],[E,ej]], campos:[txt('observaciones','Resumen de lo actuado y seguimiento',true)] },
  ],
  trans: [
    ['separacion','denuncia','lesiones_graves=si','Lesiones que revisten delito'],
    ['separacion','comunicacion',null,'Sin lesiones de gravedad',true],
    ['comunicacion','resguardo',null,null,true],
    ['denuncia','comunicacion'],
    ['resguardo','declaracion_afectado',null,null,true],
    ['declaracion_afectado','declaracion_testigos'], ['declaracion_testigos','descargos'],
    ['descargos','resolucion'],
    ['resolucion','notificacion'],
    ['resolucion','expulsion','tipo_medida=expulsion_o_cancelacion','Se propone expulsión o cancelación'],
    ['expulsion','informe_superintendencia','aprobado=si','El director aplica la medida'],
    ['expulsion','notificacion',null,'El director desestima la expulsión',true],
    ['informe_superintendencia','notificacion',null,null,true],
    ['notificacion','reconsideracion','hay_apelacion=si','Se presentó reconsideración'],
    ['notificacion','cierre',null,'Sin reconsideración',true],
    ['reconsideracion','resolucion','aprobado=si','Acogida: se revisa la medida'],
    ['reconsideracion','cierre',null,'Rechazada',true],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 47, // Protocolo de discriminación arbitraria
  categoria_ley: 'discriminacion',
  legal: 'Ley 20.609 que establece medidas contra la discriminación; Ley 21.809 art. 16 E letra j); Circular de Reglamentos Internos.',
  pasos: [
    { k:'recepcion', n:'Recepción del relato y registro', t:'formulario', plazo:[8,'horas'], inicial:true,
      d:'Recibir el relato sin cuestionarlo ni pedir pruebas, y registrar el motivo invocado. El motivo es lo que distingue una discriminación arbitraria de un conflicto común, y determina el resto del procedimiento.',
      roles:[[E,nt],[F,ej],[O,nt]],
      campos:[sel('motivo','Categoría invocada (Ley 20.609)',
                  ['origen_o_nacionalidad','raza_o_etnia','religion_o_creencia','orientacion_sexual','identidad_de_genero','discapacidad','apariencia_personal','situacion_socioeconomica','otra']),
              sel('quien_discrimina','¿Quién habría discriminado?',['estudiante','adulto_de_la_comunidad']),
              txt('observaciones','Relato de los hechos',true)] },
    { k:'resguardo', n:'Medidas de resguardo para la persona afectada', t:'aprobacion', plazo:[1,'dias_habiles'], inv:'afectado', medida:'proteccion',
      d:'Medidas de protección y acompañamiento mientras dura el procedimiento (art. 16 E letra j). No son sanciones y no esperan al resultado de la investigación.',
      roles:[[D,ap],[E,ej],[O,nt]], campos:[txt('observaciones','Medidas adoptadas y su fundamento',true)] },
    { k:'comunicacion', n:'Comunicación a los apoderados', t:'informativo', plazo:[24,'horas'], inv:'todos', notif:1,
      d:'Informar a los apoderados de ambas partes, con constancia firmada.',
      roles:[[E,ej],[PJ,nt]] },
    pasoTestigos([[D,nt],[E,ej],[C,ej]]),
    { k:'descargos', n:'Investigación y descargos de la persona señalada', t:'formulario', plazo:[5,'dias_habiles'], inv:'senalado', notif:1,
      d:'Entrevistas, revisión de antecedentes y descargos de quien fue señalado.',
      roles:[[D,nt],[E,ej],[C,ej]],
      campos:[sel('se_acredita','¿Se acreditó la discriminación arbitraria?',SI_NO), ...CAMPOS_DESCARGOS,
              txt('observaciones','Antecedentes y conclusiones')] },
    { k:'resolucion', n:'Resolución: medidas formativas y reparatorias', t:'aprobacion', plazo:[3,'dias_habiles'], inv:'senalado', medida:'disciplinaria',
      d:'La respuesta a la discriminación es principalmente formativa y reparatoria: sancionar sin trabajar el prejuicio no cambia lo que la produjo.',
      roles:[[D,ap],[E,ej],[C,ej]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','reparatoria','disciplinaria','sin_medida']),
              txt('observaciones','Fundamento de la medida',true)] },
    { k:'notificacion', n:'Notificación de la resolución a las partes', t:'formulario', plazo:[1,'dias_habiles'], inv:'todos', notif:1,
      d:'Notificación escrita a ambas partes, con el plazo para pedir reconsideración.',
      roles:[[E,ej],[PJ,nt]], campos:[sel('hay_apelacion','¿Se presentó reconsideración o apelación?',SI_NO)] },
    { k:'reconsideracion', n:'Resolución de la reconsideración', t:'aprobacion', plazo:[5,'dias_habiles'], inv:'senalado',
      d:'Si se acoge, el caso vuelve al paso de resolución para revisar la medida.',
      roles:[[D,ap],[E,ej]], campos:[txt('observaciones','Fundamento de la resolución',true)] },
    { k:'cierre', n:'Plan de convivencia, cierre e informe final', t:'adjunto', final:true,
      d:'Además del informe, deja registrada la acción preventiva con el curso o nivel: la discriminación rara vez es un hecho aislado de una sola persona.',
      roles:[[D,nt],[E,ej],[O,ej]], campos:[txt('observaciones','Resumen, acción preventiva y seguimiento',true)] },
  ],
  trans: [
    ['recepcion','resguardo'],
    ['resguardo','comunicacion',null,null,true],
    ['comunicacion','declaracion_testigos'], ['declaracion_testigos','descargos'],
    ['descargos','cierre','se_acredita=no','No se acreditó'],
    ['descargos','resolucion',null,'Se acreditó',true],
    ['resolucion','notificacion'],
    ['notificacion','reconsideracion','hay_apelacion=si','Se presentó reconsideración'],
    ['notificacion','cierre',null,'Sin reconsideración',true],
    ['reconsideracion','resolucion','aprobado=si','Acogida: se revisa la medida'],
    ['reconsideracion','cierre',null,'Rechazada',true],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 48, // Protocolo de salida del establecimiento sin autorización
  categoria_ley: 'otra',
  legal: 'Circular de Reglamentos Internos; deber general de cuidado del establecimiento durante la jornada escolar.',
  pasos: [
    { k:'constatacion', n:'Constatación de la ausencia y búsqueda interna', t:'formulario', plazo:[1,'horas'], vencer:'escalar', inicial:true,
      d:'Revisar dependencias, patios, baños y salidas, y consultar el registro de portería. Antes de dar por hecho que salió hay que descartar que siga dentro.',
      roles:[[E,nt],[F,ej],[PJ,nt],[I,ej]],
      campos:[sel('ubicado_dentro','¿Se ubicó al estudiante dentro del establecimiento?',SI_NO),
              txt('observaciones','Hora de la última ubicación conocida y lugares revisados',true)] },
    { k:'aviso_apoderado', n:'Aviso inmediato al apoderado', t:'formulario', plazo:[1,'horas'], vencer:'escalar', inv:'senalado', notif:1,
      d:'Avisar al apoderado apenas se confirma que el estudiante no está en el establecimiento. No se espera al final de la jornada: es el momento en que el establecimiento deja de tener al estudiante bajo su cuidado.',
      roles:[[D,nt],[E,ej],[I,ej]],
      campos:[sel('estudiante_regreso','¿El estudiante regresó o fue ubicado?',SI_NO)] },
    { k:'aviso_carabineros', n:'Aviso a Carabineros', t:'notificacion_externa', plazo:[2,'horas'], vencer:'escalar',
      d:'Si no se ubica al estudiante, dar aviso a Carabineros junto con el apoderado. No hay plazo de espera para denunciar la desaparición de un menor de edad.',
      roles:[[D,ej],[E,ej],[I,ej]], campos:[txt('observaciones','Constancia del aviso (unidad, hora, N° de parte)',true)] },
    { k:'entrevista', n:'Entrevista con el estudiante y detección de factores de riesgo', t:'formulario', plazo:[2,'dias_habiles'], inv:'senalado',
      d:'Entender por qué se fue antes de decidir qué hacer. Una salida sin permiso suele ser síntoma de algo más —acoso, problemas familiares, consumo—: si ahí aparecen indicios de vulneración de derechos, corresponde activar además ese protocolo.',
      roles:[[E,ej],[PJ,nt],[O,ej]],
      campos:[sel('factores_de_riesgo','¿Se detectaron factores de riesgo o indicios de vulneración?',SI_NO),
              txt('observaciones','Motivo declarado y antecedentes recogidos',true)] },
    { k:'resolucion', n:'Resolución: medidas formativas y compromiso', t:'aprobacion', plazo:[3,'dias_habiles'], inv:'senalado', medida:'disciplinaria',
      d:'Medida y compromiso con el estudiante y el apoderado. La respuesta es formativa: una conducta de riesgo no se previene con una sanción dura.',
      roles:[[D,ap],[E,ej]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','reparatoria','disciplinaria','sin_medida']),
              txt('observaciones','Medida, compromiso y fundamento',true)] },
    { k:'cierre', n:'Cierre del caso e informe final', t:'adjunto', final:true,
      d:'Informe con lo actuado, el compromiso acordado y el seguimiento.',
      roles:[[D,nt],[E,ej]], campos:[txt('observaciones','Resumen de lo actuado y seguimiento',true)] },
  ],
  trans: [
    ['constatacion','entrevista','ubicado_dentro=si','Estaba dentro del establecimiento'],
    ['constatacion','aviso_apoderado',null,'No está en el establecimiento',true],
    ['aviso_apoderado','entrevista','estudiante_regreso=si','Regresó o fue ubicado'],
    ['aviso_apoderado','aviso_carabineros',null,'Sigue sin ubicarse',true],
    ['aviso_carabineros','entrevista',null,null,true],
    ['entrevista','resolucion',null,null,true],
    ['resolucion','cierre'],
  ],
},
// ---------------------------------------------------------------------------
// Protocolo aparte y no una rama del de agresión física entre estudiantes: acá
// la persona afectada es un trabajador del establecimiento, y eso cambia tres
// cosas que el grafo entre pares no contempla.
//
// 1. El establecimiento actúa además como EMPLEADOR. La Ley 21.809 le impone al
//    sostenedor adoptar medidas de prevención, investigación y sanción de la
//    violencia en el lugar de trabajo y contar con su propio protocolo en esa
//    calidad. Ese procedimiento corre en paralelo y no lo reemplaza éste: el de
//    convivencia resuelve la situación del estudiante, el laboral protege al
//    trabajador. Los RICE ya adaptados a la 21.809 lo hacen así (The Mayflower
//    School, 6.2.2: "se activará en paralelo el protocolo de acoso laboral,
//    sexual y violencia en el trabajo de acuerdo a la Ley 21.643").
// 2. Si los hechos son constitutivos de delito, el deber de denuncia no admite
//    delegación: el director "deberá siempre denunciar" conforme al art. 175 del
//    Código Procesal Penal, y el sostenedor debe dar al docente apoyo y
//    orientación para el ejercicio de sus derechos AL MENOS hasta la
//    presentación de la denuncia — la ley agrega que esa obligación "no se
//    entenderá satisfecha por acciones ejercidas por terceros" (Ley 21.809, que
//    agrega un inciso final al art. 8 bis del Estatuto Docente).
// 3. El relato escrito y documentado del profesional afectado es, por ley,
//    antecedente suficiente para fundar medidas inmediatas de resguardo y para
//    iniciar el procedimiento (Ley 21.827, art. 3). Por eso el paso inicial es
//    ese relato y el resguardo va antes de investigar: esperar a la
//    investigación para proteger al funcionario invierte el orden que la ley
//    fija.
//
// Lo que este protocolo NO hace: convertir la agresión en expulsión por
// definición. La 21.809 mantiene que expulsión y cancelación son excepcionales
// y que debe preferirse siempre la medida formativa, y prohíbe fundar cualquier
// medida disciplinaria, directa o indirectamente, en una discapacidad o
// necesidad educativa especial. En educación parvularia no se aplican medidas
// disciplinarias por infracciones a la convivencia, y eso no admite excepción
// porque el afectado sea un adulto: por eso la calificación pregunta por esas
// dos condiciones antes de llegar a la resolución.
{
  crear: { nombre:'Protocolo de agresión de un estudiante a un funcionario',
           descripcion:'Actuación ante violencia física, psicológica o por medios digitales de un estudiante hacia un docente, asistente de la educación u otro funcionario, ocurrida durante el ejercicio de sus funciones o como resultado de ellas. Incluye el resguardo inmediato del funcionario afectado, la denuncia cuando hay delito, la activación paralela del procedimiento del empleador y el debido proceso del estudiante señalado.' },
  categoria_ley: 'violencia_fisica',
  legal: 'Ley 21.809 (art. 16 E letras g, i y j; violencia contra profesionales de la educación y deber de denuncia y apoyo del art. 8 bis del Estatuto Docente); Ley 21.827 sobre seguridad, orden y respeto (medidas inmediatas de contención, valor del relato del profesional afectado y comparecencia obligatoria del apoderado); art. 175 del Código Procesal Penal; Ley 21.643 y normativa del empleador sobre violencia en el trabajo.',
  pasos: [
    { k:'recepcion', n:'Recepción del relato del funcionario afectado y aviso a la dirección',
      t:'formulario', plazo:[2,'horas'], inicial:true,
      d:'El relato escrito y documentado del profesional o asistente de la educación afectado constituye antecedente suficiente para fundar las medidas inmediatas de resguardo y para iniciar el procedimiento (Ley 21.827). Eso no reemplaza la investigación ni los descargos del estudiante: adelanta la protección, no la conclusión.',
      roles:[[E,ej],[F,ej],[D,nt]],
      campos:[sel('tipo_violencia','Tipo de violencia',['fisica','psicologica','digital']),
              sel('en_ejercicio_de_funciones','¿Ocurrió durante el ejercicio de sus funciones, en relación con éstas o como resultado de ellas?',SI_NO),
              sel('hay_lesiones','¿Hay lesiones o necesidad de atención de salud?',SI_NO),
              txt('relato','Relato escrito del funcionario afectado',true)] },
    // Antes de investigar, igual que en los protocolos de resguardo a un
    // estudiante: la ley habilita a la autoridad a adoptar medidas inmediatas,
    // proporcionales y fundadas para contener la violencia contra docentes y
    // asistentes (art. 10 de la LGE, según la Ley 21.827).
    { k:'resguardo', n:'Medidas inmediatas de resguardo y contención del funcionario afectado',
      t:'aprobacion', plazo:[8,'horas'], inv:'afectado', medida:'proteccion',
      d:'Medidas proporcionales y fundadas para proteger a la persona afectada mientras dura el procedimiento: separación del contacto directo, cambio temporal de funciones o de asignación de curso, acompañamiento y derivación a la atención del organismo administrador de la Ley 16.744 (mutualidad). La suspensión del estudiante es la última: solo procede si ninguna otra medida resguarda, no puede exceder quince días hábiles y obliga a monitoreo pedagógico (art. 16 E letra j).',
      roles:[[D,ap],[E,ej]],
      campos:[sel('medida_aplicada','Medida adoptada',
                  ['separacion_de_contacto','cambio_de_curso_o_asignacion','acompanamiento_en_aula','derivacion_mutualidad','suspension_del_estudiante','ninguna']),
              txt('observaciones','Fundamento de la medida',true)] },
    { k:'clasificacion', n:'Calificación de los hechos', t:'formulario', plazo:[8,'horas'],
      d:'Dos preguntas deciden el camino y no pueden quedar para el final. Si los hechos revisten caracteres de delito, la denuncia es obligatoria en 24 horas. Y si el estudiante cursa educación parvularia o los hechos ocurren en el contexto de una desregulación asociada a una discapacidad, NEE o TEA, la vía es formativa: la ley prohíbe aplicar medidas disciplinarias en parvularia y fundar cualquier medida, directa o indirectamente, en esa condición.',
      roles:[[E,ej],[D,ap]],
      campos:[sel('reviste_delito','¿Reviste caracteres de delito?',SI_NO),
              sel('via_formativa_obligatoria','¿El estudiante cursa parvularia o los hechos ocurren en contexto de desregulación asociada a discapacidad, NEE o TEA?',SI_NO)] },
    { k:'denuncia', n:'Denuncia a autoridad competente y apoyo al funcionario afectado',
      t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      d:'La denuncia la presenta el director conforme al art. 175 del Código Procesal Penal, y el sostenedor debe proporcionar al funcionario apoyo y orientación para el ejercicio y protección de sus derechos al menos hasta que la denuncia esté presentada. La ley es expresa en que esa obligación no se entiende satisfecha por acciones ejercidas por terceros: que el propio funcionario denuncie no libera al establecimiento.',
      roles:[[D,ej],[E,nt]],
      campos:[sel('organismo','Organismo',ORGANISMOS),
              txt('folio_parte','Folio, N° de parte o constancia entregado por la autoridad',true),
              sel('apoyo_al_funcionario','¿Se entregó al funcionario el apoyo y la orientación para ejercer sus derechos?',SI_NO)] },
    { k:'laboral', n:'Activación del procedimiento del empleador por violencia en el trabajo',
      t:'informativo', plazo:[1,'dias_habiles'],
      d:'El sostenedor actúa acá como empleador y tiene un procedimiento propio, con su propio investigador. Corre en paralelo y no reemplaza a este protocolo: éste resuelve la situación del estudiante, aquél protege al trabajador. Dejar constancia de la derivación es lo que permite después demostrar que ambas obligaciones se cumplieron.',
      roles:[[D,ej],[E,ej]] },
    // La comparecencia dejó de ser una gentileza: la Ley 21.827 la hace
    // obligatoria y solo excusable por causa justificada y acreditada. Por eso
    // 'excusa_justificada' es una respuesta distinta de 'no': una deja el
    // proceso en pie, la otra es un incumplimiento del apoderado que hay que
    // poder mostrar.
    { k:'citacion', n:'Citación al apoderado del estudiante señalado', t:'formulario',
      plazo:[1,'dias_habiles'], inv:'senalado', notif:1,
      d:'La comparecencia del padre, madre, apoderado o tutor a la citación formal es obligatoria y puede ser presencial o por medios telemáticos idóneos. Solo se excusa por causa debidamente justificada y acreditada.',
      roles:[[E,ej],[PJ,ej],[D,nt]],
      campos:[sel('apoderado_comparecio','¿El apoderado compareció?',['si','no','excusa_justificada']),
              sel('via_comparecencia','Vía de comparecencia',['presencial','telematica'],false,'apoderado_comparecio=si')] },
    pasoAfectado([[E,ej],[O,ej]]),
    pasoTestigos([[E,ej]]),
    { k:'investigacion', n:'Investigación interna', t:'formulario', plazo:[9,'dias_habiles'],
      d:'Entrevistas por separado, revisión de antecedentes y del contexto en que ocurrió el hecho. El relato del funcionario ya está en el expediente: lo que falta es contrastarlo y entender qué llevó a la conducta, que es lo que después sostiene una medida formativa proporcional.',
      roles:[[E,ej],[C,ap]],
      campos:[txt('observaciones','Antecedentes y conclusiones de la investigación',true)] },
    pasoDescargos(),
    { k:'resolucion', n:'Resolución: medidas formativas, reparatorias o disciplinarias',
      t:'aprobacion', plazo:[3,'dias_habiles'], inv:'senalado', medida:'disciplinaria',
      d:'La violencia contra un profesional de la educación reviste especial gravedad, pero eso agrava la falta, no suprime el debido proceso ni la proporcionalidad: la expulsión y la cancelación de matrícula siguen siendo excepcionales y debe preferirse siempre la medida formativa y pedagógica. Ninguna medida puede fundarse, directa o indirectamente, en una discapacidad o necesidad educativa especial.',
      roles:[[D,ap],[E,ej]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','reparatoria','disciplinaria','expulsion_o_cancelacion','sin_medida']),
              txt('observaciones','Medida aplicada y fundamento de su proporcionalidad',true)] },
    { k:'notificacion', n:'Notificación de la resolución a las partes', t:'formulario',
      plazo:[1,'dias_habiles'], inv:'todos', notif:1,
      d:'Se notifica al estudiante y su apoderado, y también al funcionario afectado: es parte del caso y tiene que saber qué se resolvió.',
      roles:[[E,ej],[D,nt]], campos:[CAMPO_APELACION] },
    pasoApelacion(),
    { k:'seguimiento', n:'Seguimiento del funcionario afectado y del estudiante', t:'formulario',
      ...CICLO_SEGUIMIENTO, inv:'todos',
      d:'Dos seguimientos en un paso porque son dos personas del mismo caso: que el funcionario haya podido retomar sus funciones sin exposición, y que las medidas formativas del estudiante estén dando resultado.',
      roles:[[E,ej],[O,ej]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre del caso e informe final', t:'adjunto', final:true,
      d:'Informe con lo actuado, las medidas adoptadas respecto del estudiante y del funcionario, y el resultado del procedimiento laboral si ya concluyó.',
      roles:[[E,ej],[D,ap]], campos:[txt('observaciones','Resumen de lo actuado',true)] },
  ],
  trans: [
    ['recepcion','resguardo'],
    ['resguardo','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','laboral',null,'No reviste delito',true],
    ['denuncia','laboral'],
    ['laboral','citacion'], ['citacion','declaracion_afectado'],
    ['declaracion_afectado','declaracion_testigos'], ['declaracion_testigos','investigacion'],
    ['investigacion','descargos'], ['descargos','resolucion'],
    ['resolucion','notificacion'],
    ['notificacion','apelacion','hay_apelacion=si','Se presentó apelación'],
    ['notificacion','seguimiento',null,'Sin apelación',true],
    ['apelacion','resolucion','aprobado=si','Apelación acogida: se revisa la medida'],
    ['apelacion','seguimiento',null,'Apelación rechazada',true],
    ['seguimiento','seguimiento','situacion_resuelta=no','Mantiene seguimiento'],
    ['seguimiento','cierre',null,'Resuelto',true],
  ],
},
];

// ---------------------------------------------------------------------------

const DRY = process.argv.includes('--dry-run');

// Recargar borra el grafo de un protocolo ya cargado y lo vuelve a escribir.
// Existe porque el catálogo cambia: cuando se le agrega un paso (descargos,
// apelación) a un protocolo que ya está en la tabla, la idempotencia por sí
// sola lo saltaría para siempre.
//
// Solo toca el catálogo. Los casos ya activados congelaron su propio grafo al
// activarse y las copias espejo de los colegios son tablas aparte: ninguno de
// los dos cambia por esto, y ese es justamente el punto.
const RECARGAR = (() => {
  const arg = process.argv.find((a) => a.startsWith('--recargar'));
  if (!arg) return null;
  const lista = arg.split('=')[1];
  if (!lista) return 'todos';
  return new Set(lista.split(',').map((s) => Number(s.trim())));
})();

const debeRecargar = (id_protocolo) =>
  RECARGAR === 'todos' || (RECARGAR instanceof Set && RECARGAR.has(id_protocolo));

async function main() {
  const [rolesBD] = await pool.query('SELECT rol_id, codigo FROM ROLES WHERE id_establecimiento IS NULL');
  const rolId = new Map(rolesBD.map((r) => [r.codigo, r.rol_id]));

  const faltantes = [...new Set(CATALOGO.flatMap((p) => p.pasos.flatMap((s) => s.roles.map(([c]) => c))))]
    .filter((c) => !rolId.has(c));
  if (faltantes.length > 0)
    throw new Error(`Faltan roles globales: ${faltantes.join(', ')}. Corre docs/rbac_roles_protocolos.sql primero.`);

  let cargados = 0, saltados = 0;

  for (const proto of CATALOGO) {
    // Valida el grafo en memoria antes de escribir nada: un protocolo que no
    // pasaría la validación al publicarse tampoco debería llegar a la tabla.
    const pasosVal = proto.pasos.map((p) => ({
      id_paso: p.k, nombre: p.n, tipo_paso: p.t,
      es_paso_inicial: p.inicial ? 1 : 0, es_paso_final: p.final ? 1 : 0,
      plazo_valor: p.plazo?.[0] ?? null, plazo_unidad: p.plazo?.[1] ?? null,
    }));
    const transVal = proto.trans.map(([o, d, cond = null, , def = false]) => ({
      id_paso_origen: o, id_paso_destino: d, condicion: cond, es_default: def ? 1 : 0,
    }));
    const problemas = validarGrafo(pasosVal, transVal);
    for (const t of transVal.filter((t) => t.condicion)) {
      const paso = proto.pasos.find((p) => p.k === t.id_paso_origen);
      const campos = (paso.campos ?? []).map(([codigo, , tipo_campo, opciones]) => ({ codigo, tipo_campo, opciones }));
      const err = validarCondicion(t.condicion, camposDelPaso({ tipo_paso: paso.t }, campos));
      if (err) problemas.push(`Transición desde '${paso.n}': ${err}`);
    }
    for (const p of proto.pasos) {
      if (!p.roles.some(([, part]) => part === ej)) problemas.push(`'${p.n}' no tiene rol ejecutor.`);
      if (p.t === 'aprobacion' && !p.roles.some(([, part]) => part === ap)) problemas.push(`'${p.n}' es aprobación y no tiene aprobador.`);
      if (p.t === 'formulario' && !(p.campos ?? []).length) problemas.push(`'${p.n}' es formulario y no tiene campos.`);
      const errPaso = validarPaso({ nombre: p.n, tipo_paso: p.t, accion_al_vencer: p.vencer, por_involucrado_rol: p.inv });
      if (errPaso) problemas.push(`'${p.n}': ${errPaso}`);
      // Solo se puede notificar a alguien: en un paso del caso no hay a quién
      // notificar y la exigencia quedaría colgada.
      if (p.notif && !p.inv) problemas.push(`'${p.n}' pide notificación pero no es un paso por involucrado.`);
    }

    // El techo legal se comprueba acá y no solo al publicar desde la app: un
    // paso agregado al catálogo puede empujar el camino más largo sobre los
    // 2 meses sin que nadie lo note hasta que un colegio intente publicarlo.
    const techo = validarTechoLegal(pasosVal, transVal, proto.ambito ?? 'estudiante');
    problemas.push(...techo);

    const nombre = proto.crear?.nombre ?? `(id ${proto.id})`;
    if (problemas.length > 0) {
      console.error(`\n✗ ${nombre}\n   ${problemas.join('\n   ')}`);
      process.exitCode = 1;
      continue;
    }

    if (DRY) { console.log(`✓ ${nombre} — grafo válido (${proto.pasos.length} pasos, ${proto.trans.length} transiciones)`); continue; }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let id_protocolo = proto.id;
      if (!id_protocolo) {
        const [ya] = await conn.query('SELECT id_protocolo FROM CATALOGO_PROTOCOLOS_GENERICOS WHERE nombre = ?', [proto.crear.nombre]);
        if (ya.length > 0) id_protocolo = ya[0].id_protocolo;
        else {
          const [r] = await conn.query(
            'INSERT INTO CATALOGO_PROTOCOLOS_GENERICOS (nombre, descripcion) VALUES (?, ?)',
            [proto.crear.nombre, proto.crear.descripcion]
          );
          id_protocolo = r.insertId;
        }
      }

      const [[{ c }]] = await conn.query('SELECT COUNT(*) c FROM CATALOGO_PROTOCOLO_PASO WHERE id_protocolo = ?', [id_protocolo]);
      if (c > 0 && !debeRecargar(id_protocolo)) {
        await conn.commit();
        console.log(`- ${id_protocolo} ya tiene flujo (${c} pasos): se salta`);
        saltados++;
        continue;
      }
      // Las transiciones, campos y roles cuelgan de los pasos con ON DELETE
      // CASCADE, así que borrar los pasos se lleva el grafo entero.
      if (c > 0) {
        await conn.query('DELETE FROM CATALOGO_PROTOCOLO_PASO WHERE id_protocolo = ?', [id_protocolo]);
        console.log(`  ${id_protocolo}: se recarga (se borraron ${c} pasos anteriores)`);
      }

      const mapa = new Map();
      let orden = 0;
      for (const p of proto.pasos) {
        const [r] = await conn.query(
          `INSERT INTO CATALOGO_PROTOCOLO_PASO
             (id_protocolo, nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
              accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual,
              por_involucrado_rol, requiere_notificacion, requiere_medida, tipo_medida_requerida)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id_protocolo, p.n, p.d ?? null, p.t, p.plazo?.[0] ?? null, p.plazo?.[1] ?? null,
           p.vencer ?? 'notificar', p.inicial ? 1 : 0, p.final ? 1 : 0, orden += 10,
           p.inv ?? null, p.notif ?? 0, p.medida ? 1 : 0, p.medida ?? null]
        );
        mapa.set(p.k, r.insertId);

        await conn.query(
          'INSERT INTO CATALOGO_PROTOCOLO_PASO_ROL (id_paso, rol_id, tipo_participacion) VALUES ?',
          [p.roles.map(([codigo, part]) => [r.insertId, rolId.get(codigo), part])]
        );
        if (p.campos?.length)
          await conn.query(
            `INSERT INTO CATALOGO_PROTOCOLO_PASO_CAMPO
               (id_paso, codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden)
             VALUES ?`,
            [p.campos.map(([codigo, etiqueta, tipo, opciones, req, dep = null], i) =>
              [r.insertId, codigo, etiqueta, tipo, opciones ? JSON.stringify(opciones) : null,
               req ? 1 : 0, dep, (i + 1) * 10])]
          );
      }

      await conn.query(
        `INSERT INTO CATALOGO_PROTOCOLO_TRANSICION
           (id_protocolo, id_paso_origen, id_paso_destino, condicion, etiqueta, es_default) VALUES ?`,
        [proto.trans.map(([o, d, cond = null, etiqueta = null, def = false]) =>
          [id_protocolo, mapa.get(o), mapa.get(d), cond, etiqueta, def ? 1 : 0])]
      );

      // categoria_ley usa COALESCE(?, categoria_ley) y no una asignación directa:
      // un protocolo del catálogo que no trae `categoria_ley` en este archivo
      // (9, 10, 29, 30, 31, 44...) no debe perder el valor que ya tenía en la
      // base solo por pasar por --recargar.
      await conn.query(
        `UPDATE CATALOGO_PROTOCOLOS_GENERICOS
         SET estado_flujo = 'publicado', fecha_publicacion = NOW(),
             descripcion = COALESCE(descripcion, ?),
             categoria_ley = COALESCE(?, categoria_ley)
         WHERE id_protocolo = ?`,
        [proto.crear?.descripcion ?? null, proto.categoria_ley ?? null, id_protocolo]
      );

      await conn.commit();
      console.log(`✓ ${id_protocolo} — ${proto.pasos.length} pasos, ${proto.trans.length} transiciones — publicado`);
      cargados++;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  console.log(`\n${cargados} protocolo(s) cargados, ${saltados} saltados.`);
  await pool.end();
}

main().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
