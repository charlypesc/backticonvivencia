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
// Este archivo es la definición completa del paso, incluidos por_involucrado_rol
// y requiere_acuse. Antes vivían en un UPDATE aparte (docs/involucrados_fase12_catalogo.sql),
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
// `inv:'senalado'` y `acuse:1`, así que se cumple una vez por cada señalado y
// ahí queda registrado a quién se le notificó, cuándo y cómo firmó. Un
// "¿Se le notificaron los hechos?" a nivel de paso preguntaba lo mismo una
// segunda vez, y peor: con varios señalados una sola respuesta no podía decir
// la verdad si a uno se le notificó y al otro no.
const CAMPOS_DESCARGOS = [
  sel('presento_descargos', '¿Presentó descargos?', ['si', 'no', 'no_comparecio']),
  txt('descargos', 'Descargos presentados', false, 'presento_descargos=si'),
];

// El paso de descargos, idéntico salvo el nombre. Va contra el señalado y con
// acuse: la constancia de que se le notificó es justamente la prueba que se
// pide cuando el apoderado reclama.
const pasoDescargos = (n = 'Notificación de cargos y descargos del estudiante señalado') =>
  ({ k:'descargos', n, t:'formulario', plazo:[3,'dias_habiles'], inv:'senalado', acuse:1,
     roles:[[E,ej],[D,nt]], campos:CAMPOS_DESCARGOS });

// La apelación se resuelve como aprobación: el campo implícito 'aprobado' es
// justamente la decisión, y ramificar sobre él no necesita campo propio.
const pasoApelacion = () =>
  ({ k:'apelacion', n:'Resolución de la apelación', t:'aprobacion', plazo:[5,'dias_habiles'],
     inv:'senalado', roles:[[E,ej],[D,ap]] });

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
    { k:'resguardo', n:'Medidas de resguardo a la víctima', t:'informativo', plazo:[2,'horas'], inv:'afectado',
      roles:[[E,ej],[P,ej]] },
    { k:'investigacion', n:'Investigación interna', t:'formulario', plazo:[10,'dias_habiles'],
      roles:[[E,ej],[C,ap]],
      campos:[txt('observaciones','Antecedentes y conclusiones de la investigación')] },
    pasoDescargos(),
    { k:'resolucion', n:'Resolución y aplicación de medidas', t:'aprobacion', plazo:[3,'dias_habiles'], inv:'senalado',
      roles:[[C,ej],[D,ap]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','disciplinaria','ambas'])] },
    { k:'notificacion', n:'Notificación a apoderados y partes', t:'formulario', plazo:[1,'dias_habiles'],
      inv:'todos', acuse:1, roles:[[E,ej]], campos:[CAMPO_APELACION] },
    pasoApelacion(),
    { k:'seguimiento', n:'Seguimiento', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'todos', roles:[[E,ej],[PJ,nt]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre del caso e informe final', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','investigacion',null,'No reviste delito',true],
    ['denuncia','resguardo'], ['resguardo','investigacion'],
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
    { k:'investigacion', n:'Investigación y trabajo con apoderados', t:'formulario', plazo:[10,'dias_habiles'],
      inv:'todos', roles:[[E,ej],[PJ,nt]], campos:[txt('observaciones','Antecedentes y trabajo realizado con los apoderados')] },
    pasoDescargos(),
    { k:'resolucion', n:'Resolución y medidas formativas o disciplinarias', t:'aprobacion', plazo:[3,'dias_habiles'],
      inv:'senalado', roles:[[E,ej],[D,ap]], campos:[sel('tipo_medida','Tipo de medida',['formativa','disciplinaria','ambas'])] },
    // El acuse estaba en la resolución, que es un acto interno. La constancia
    // que sirve es la de esta notificación, que es la que abre el plazo de
    // apelación.
    { k:'notificacion', n:'Notificación de la resolución a las partes', t:'formulario', plazo:[1,'dias_habiles'],
      inv:'todos', acuse:1, roles:[[E,ej]], campos:[CAMPO_APELACION] },
    pasoApelacion(),
    { k:'seguimiento', n:'Seguimiento', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'todos', roles:[[E,ej]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe final', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','investigacion',null,'No reviste delito',true],
    ['denuncia','investigacion'],
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
    { k:'resguardo', n:'Medidas de resguardo', t:'aprobacion', plazo:[2,'horas'], inv:'afectado',
      roles:[[E,ej],[D,ap]], campos:[sel('cese_trato_directo','¿Cesa el trato directo con estudiantes?',SI_NO)] },
    { k:'citacion', n:'Citación y entrevista a la familia', t:'formulario', plazo:[3,'dias_habiles'],
      inv:'afectado', acuse:1,
      roles:[[E,ej],[O,ej]], campos:[sel('apoderado_comparecio','¿El apoderado compareció?',SI_NO)] },
    { k:'derivacion', n:'Derivación a redes externas (OPD, Cesfam)', t:'notificacion_externa', inv:'afectado',
      roles:[[E,ej],[TS,ej]], campos:[sel('red_destino','Red de destino',['opd','cesfam','oln','otro'])] },
    { k:'plan', n:'Plan de intervención y seguimiento', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'afectado',
      roles:[[C,ej],[O,ej]], campos:[sel('estudiante_fuera_de_riesgo','¿El estudiante está fuera de riesgo?',SI_NO)] },
    // Acá los descargos van contra el informe concluyente, no contra una
    // sanción: este protocolo no aplica medidas al señalado, pero el informe sí
    // afirma que hubo vulneración y quién la cometió.
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
    ['plan','descargos',null,'Fuera de riesgo',true],
    ['descargos','cierre'],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 7, // Protocolo ante hechos de connotación sexual
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
      inv:'afectado', roles:[[P,ej],[E,ej]], campos:[sel('presunto_agresor_es_funcionario','¿El presunto agresor es funcionario?',SI_NO)] },
    { k:'comunicacion', n:'Comunicación a la familia', t:'formulario', plazo:[8,'horas'], inv:'todos', acuse:1,
      roles:[[D,ej],[E,nt]], campos:[txt('observaciones','Constancia de la comunicación')] },
    { k:'seguimiento', n:'Seguimiento y acompañamiento', t:'formulario', ...CICLO_SEGUIMIENTO, inv:'afectado',
      roles:[[P,ej],[C,nt]], campos:[sel('estudiante_en_tratamiento','¿El estudiante está en tratamiento?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['acogida','traslado','hay_senales_fisicas=si','Requiere atención médica'],
    ['acogida','notif_direccion',null,'Sin señales físicas',true],
    ['traslado','notif_direccion'], ['notif_direccion','denuncia'], ['denuncia','resguardo'],
    ['resguardo','comunicacion'], ['comunicacion','seguimiento'],
    ['seguimiento','seguimiento','estudiante_en_tratamiento=no','Mantiene acompañamiento'],
    ['seguimiento','cierre',null,'En tratamiento',true],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 6, // Protocolo de violencia entre adultos de la comunidad educativa
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
    { k:'investigacion', n:'Investigación por el Comité o la dirección', t:'formulario', plazo:[10,'dias_habiles'],
      roles:[[C,ej],[D,ap]], campos:[sel('descargos_recibidos','¿Se recibieron los descargos?',SI_NO)] },
    { k:'resolucion', n:'Resolución y medidas (disciplinarias o administrativas)', t:'aprobacion', plazo:[3,'dias_habiles'],
      inv:'senalado', acuse:1,
      roles:[[D,ej],[D,ap]], campos:[sel('ambito_medida','Ámbito de la medida',['convivencia','laboral'])] },
    { k:'seguimiento', n:'Seguimiento', t:'adjunto', ...CICLO_SEGUIMIENTO, roles:[[E,ej]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','separacion'], ['separacion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','investigacion',null,'No reviste delito',true],
    ['denuncia','investigacion'], ['investigacion','resolucion'], ['resolucion','seguimiento'],
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
    { k:'notificacion', n:'Notificación a apoderados', t:'formulario', plazo:[8,'horas'], inv:'afectado', acuse:1,
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
    { k:'notificacion', n:'Notificación a la familia', t:'formulario', plazo:[8,'horas'], inv:'senalado', acuse:1,
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
    { k:'notificacion', n:'Notificación al apoderado', t:'formulario', plazo:[2,'horas'], inv:'afectado', acuse:1,
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
    { k:'comunicacion', n:'Comunicación a la familia del estudiante', t:'formulario', plazo:[8,'horas'],
      inv:'afectado', acuse:1, roles:[[E,ej],[PJ,nt]], campos:[txt('observaciones','Constancia de la comunicación',true)] },
    { k:'apoyo', n:'Medidas de apoyo y contención al estudiante', t:'informativo', plazo:[2,'horas'],
      inv:'afectado', roles:[[P,ej],[O,ej]] },
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
      inv:'todos', acuse:1, roles:[[E,ej]], campos:[CAMPO_APELACION] },
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
    ['apoyo','investigacion'], ['investigacion','descargos'], ['descargos','resolucion'],
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
    { k:'comunicacion', n:'Comunicación a los apoderados', t:'formulario', plazo:[48,'horas'],
      inv:'todos', acuse:1, roles:[[E,ej],[PJ,nt]],
      campos:[txt('observaciones','Constancia de la comunicación',true)] },
    { k:'investigacion', n:'Investigación interna', t:'formulario', plazo:[10,'dias_habiles'],
      d:'Entrevistas por separado, revisión de antecedentes disponibles y declaraciones de testigos, con estricta reserva.',
      roles:[[E,ej],[C,ap]],
      campos:[txt('observaciones','Antecedentes y conclusiones de la investigación'),
              sel('responsable_identificado','¿Se identificó al responsable?',SI_NO)] },
    pasoDescargos('Notificación de cargos y descargos de la persona señalada'),
    // El reconocimiento voluntario como atenuante aparece textual en tres de
    // los cuatro RICE con protocolo, y es lo que sostiene el enfoque formativo:
    // sin él, reconocer la falta solo empeora la sanción.
    { k:'resolucion', n:'Resolución: medidas formativas, reparatorias o disciplinarias', t:'aprobacion',
      plazo:[3,'dias_habiles'], inv:'senalado', roles:[[C,ej],[D,ap]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','reparatoria','disciplinaria','mixta']),
              sel('reconocimiento_voluntario','¿Reconoció voluntariamente la falta? (atenuante)',SI_NO,false)] },
    { k:'notificacion', n:'Notificación de la resolución a las partes', t:'formulario', plazo:[1,'dias_habiles'],
      inv:'todos', acuse:1, roles:[[E,ej]], campos:[CAMPO_APELACION] },
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
      // Un acuse solo se le puede pedir a alguien: en un paso del caso no hay
      // a quién pedirle la firma y la exigencia quedaría colgada.
      if (p.acuse && !p.inv) problemas.push(`'${p.n}' pide acuse pero no es un paso por involucrado.`);
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
              por_involucrado_rol, requiere_acuse)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id_protocolo, p.n, p.d ?? null, p.t, p.plazo?.[0] ?? null, p.plazo?.[1] ?? null,
           p.vencer ?? 'notificar', p.inicial ? 1 : 0, p.final ? 1 : 0, orden += 10,
           p.inv ?? null, p.acuse ?? 0]
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

      await conn.query(
        `UPDATE CATALOGO_PROTOCOLOS_GENERICOS
         SET estado_flujo = 'publicado', fecha_publicacion = NOW(),
             descripcion = COALESCE(descripcion, ?)
         WHERE id_protocolo = ?`,
        [proto.crear?.descripcion ?? null, id_protocolo]
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
