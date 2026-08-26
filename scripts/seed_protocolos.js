// Carga el catálogo estándar de protocolos (pasos, transiciones, roles y
// campos) sobre CATALOGO_PROTOCOLOS_GENERICOS.
//
//   node scripts/seed_protocolos.js            → carga y publica lo que falte
//   node scripts/seed_protocolos.js --dry-run  → solo valida, no escribe
//
// Es idempotente: un protocolo que ya tiene pasos se salta. Para recargar uno,
// hay que borrar sus pasos primero (la cascada se lleva el resto de su grafo).
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
const { validarGrafo, validarCondicion, camposDelPaso } = require('../src/utils/flujoProtocolo');

const SI_NO = ['si', 'no'];

// Abreviaturas de rol y participación, para que la tabla de datos se lea.
const F = 'FUNCIONARIO', E = 'ENCARGADO', D = 'DIRECTOR', P = 'PSICOLOGO';
const PJ = 'PROFESOR_JEFE', C = 'COMITE_CONVIVENCIA', O = 'ORIENTADOR';
const TS = 'TRABAJADOR_SOCIAL', S = 'ENCARGADO_SALUD', I = 'INSPECTORIA';
const U = 'UTP', DC = 'DOCENTE';
const ej = 'ejecutor', ap = 'aprobador', nt = 'notificado';

// campo: [codigo, etiqueta, tipo, opciones, obligatorio]
const sel = (c, e, o, req = true) => [c, e, 'seleccion', o, req];
const txt = (c, e, req = false) => [c, e, 'texto', null, req];
const ORGANISMOS = ['fiscalia', 'pdi', 'carabineros', 'tribunal_familia'];

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
      campos:[sel('organismo','Organismo',ORGANISMOS), sel('comprobante_adjunto','¿Comprobante adjunto?',SI_NO,false)] },
    { k:'resguardo', n:'Medidas de resguardo a la víctima', t:'informativo', plazo:[2,'horas'], roles:[[E,ej],[P,ej]] },
    { k:'investigacion', n:'Investigación interna', t:'formulario', plazo:[10,'dias_habiles'],
      roles:[[E,ej],[C,ap]],
      campos:[sel('hubo_entrevistas','¿Se realizaron entrevistas?',SI_NO), sel('evidencia_recopilada','¿Se recopiló evidencia?',SI_NO)] },
    { k:'resolucion', n:'Resolución y aplicación de medidas', t:'aprobacion', plazo:[3,'dias_habiles'],
      roles:[[C,ej],[D,ap]],
      campos:[sel('tipo_medida','Tipo de medida',['formativa','disciplinaria','ambas']), sel('hay_apelacion','¿Hay apelación?',SI_NO,false)] },
    { k:'notificacion', n:'Notificación a apoderados y partes', t:'informativo', plazo:[1,'dias_habiles'], roles:[[E,ej]] },
    { k:'seguimiento', n:'Seguimiento', t:'formulario', roles:[[E,ej],[PJ,nt]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre del caso e informe final', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','investigacion',null,'No reviste delito',true],
    ['denuncia','resguardo'], ['resguardo','investigacion'],
    ['investigacion','resolucion'], ['resolucion','notificacion'], ['notificacion','seguimiento'],
    ['seguimiento','investigacion','situacion_resuelta=no','Sin resolver: reabrir investigación'],
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
      campos:[sel('organismo','Organismo',['pdi_cibercrimen','fiscalia']), sel('comprobante_adjunto','¿Comprobante adjunto?',SI_NO,false)] },
    { k:'investigacion', n:'Investigación y trabajo con apoderados', t:'formulario', plazo:[10,'dias_habiles'],
      roles:[[E,ej],[PJ,nt]], campos:[sel('apoderados_citados','¿Se citó a los apoderados?',SI_NO)] },
    { k:'resolucion', n:'Resolución y medidas formativas o disciplinarias', t:'aprobacion', plazo:[3,'dias_habiles'],
      roles:[[E,ej],[D,ap]], campos:[sel('tipo_medida','Tipo de medida',['formativa','disciplinaria','ambas'])] },
    { k:'seguimiento', n:'Seguimiento', t:'formulario', roles:[[E,ej]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe final', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','investigacion',null,'No reviste delito',true],
    ['denuncia','investigacion'], ['investigacion','resolucion'], ['resolucion','seguimiento'],
    ['seguimiento','investigacion','situacion_resuelta=no','Sin resolver: reabrir investigación'],
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
      campos:[sel('organismo','Organismo',ORGANISMOS), sel('comprobante_adjunto','¿Comprobante adjunto?',SI_NO,false)] },
    { k:'recopilacion', n:'Recopilación de antecedentes (investigación interna)', t:'formulario', plazo:[48,'horas'],
      roles:[[E,ej],[C,nt]], campos:[txt('observaciones','Antecedentes recopilados')] },
    { k:'resguardo', n:'Medidas de resguardo', t:'aprobacion', plazo:[2,'horas'],
      roles:[[E,ej],[D,ap]], campos:[sel('cese_trato_directo','¿Cesa el trato directo con estudiantes?',SI_NO)] },
    { k:'citacion', n:'Citación y entrevista a la familia', t:'formulario', plazo:[3,'dias_habiles'],
      roles:[[E,ej],[O,ej]], campos:[sel('apoderado_comparecio','¿El apoderado compareció?',SI_NO)] },
    { k:'derivacion', n:'Derivación a redes externas (OPD, Cesfam)', t:'notificacion_externa',
      roles:[[E,ej],[TS,ej]], campos:[sel('red_destino','Red de destino',['opd','cesfam','oln','otro'])] },
    { k:'plan', n:'Plan de intervención y seguimiento', t:'formulario',
      roles:[[C,ej],[O,ej]], campos:[sel('estudiante_fuera_de_riesgo','¿El estudiante está fuera de riesgo?',SI_NO)] },
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
    ['plan','cierre',null,'Fuera de riesgo',true],
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
      roles:[[S,ej],[D,nt]], campos:[txt('centro_destino','Centro asistencial',true)] },
    { k:'notif_direccion', n:'Notificación inmediata a dirección', t:'informativo', plazo:[2,'horas'], roles:[[E,ej],[D,nt]] },
    { k:'denuncia', n:'Denuncia obligatoria a autoridad competente', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      roles:[[D,ej]],
      campos:[sel('organismo','Organismo',ORGANISMOS), sel('comprobante_adjunto','¿Comprobante adjunto?',SI_NO,false)] },
    { k:'resguardo', n:'Medidas de resguardo y contención (evitar revictimización)', t:'informativo', plazo:[2,'horas'],
      roles:[[P,ej],[E,ej]], campos:[sel('presunto_agresor_es_funcionario','¿El presunto agresor es funcionario?',SI_NO)] },
    { k:'comunicacion', n:'Comunicación a la familia', t:'formulario', plazo:[8,'horas'],
      roles:[[D,ej],[E,nt]], campos:[txt('observaciones','Constancia de la comunicación')] },
    { k:'seguimiento', n:'Seguimiento y acompañamiento', t:'formulario',
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
    { k:'separacion', n:'Separación de las partes y medidas iniciales', t:'informativo', plazo:[2,'horas'], roles:[[D,ej],[E,ej]] },
    { k:'clasificacion', n:'Clasificación de gravedad', t:'formulario', plazo:[8,'horas'],
      roles:[[E,ej],[D,ap]], campos:[sel('reviste_delito','¿Reviste delito?',SI_NO)] },
    { k:'denuncia', n:'Denuncia a autoridad externa', t:'notificacion_externa', plazo:[24,'horas'], vencer:'escalar',
      roles:[[D,ej]],
      campos:[sel('organismo','Organismo',ORGANISMOS), sel('comprobante_adjunto','¿Comprobante adjunto?',SI_NO,false)] },
    { k:'investigacion', n:'Investigación por el Comité o la dirección', t:'formulario', plazo:[10,'dias_habiles'],
      roles:[[C,ej],[D,ap]], campos:[sel('descargos_recibidos','¿Se recibieron los descargos?',SI_NO)] },
    { k:'resolucion', n:'Resolución y medidas (disciplinarias o administrativas)', t:'aprobacion', plazo:[3,'dias_habiles'],
      roles:[[D,ej],[D,ap]], campos:[sel('ambito_medida','Ámbito de la medida',['convivencia','laboral'])] },
    { k:'seguimiento', n:'Seguimiento', t:'adjunto', roles:[[E,ej]],
      campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['recepcion','separacion'], ['separacion','clasificacion'],
    ['clasificacion','denuncia','reviste_delito=si','Reviste delito'],
    ['clasificacion','investigacion',null,'No reviste delito',true],
    ['denuncia','investigacion'], ['investigacion','resolucion'], ['resolucion','seguimiento'],
    ['seguimiento','investigacion','situacion_resuelta=no','Sin resolver: reabrir investigación'],
    ['seguimiento','cierre',null,'Resuelto',true],
  ],
},
// ---------------------------------------------------------------------------
{
  crear: { nombre:'Protocolo de ideación o intento suicida y autolesiones',
           descripcion:'Actuación ante señales de alerta, autolesiones, intento suicida o suicidio consumado de un estudiante, incluida la derivación a la red de salud mental.' },
  legal: 'Resolución Exenta 482/2018 de la Superintendencia; Recomendaciones MINSAL 2019; Ley 21.067 (Defensoría de la Niñez).',
  pasos: [
    { k:'deteccion', n:'Detección de señales de alerta', t:'formulario', plazo:[2,'horas'], inicial:true,
      roles:[[F,ej],[P,nt]], campos:[sel('nivel','Nivel de riesgo',['ideacion','autolesion','intento','consumado'])] },
    { k:'contencion', n:'Contención inicial (nunca dejar solo al estudiante)', t:'informativo', plazo:[2,'horas'], roles:[[P,ej],[PJ,ej]] },
    { k:'urgencia', n:'Derivación a urgencia médica', t:'notificacion_externa', plazo:[2,'horas'], vencer:'escalar',
      roles:[[S,ej],[D,nt]], campos:[txt('centro_destino','Centro asistencial',true)] },
    { k:'notificacion', n:'Notificación a apoderados', t:'formulario', plazo:[8,'horas'],
      roles:[[P,ej],[E,nt]], campos:[sel('apoderado_contactado','¿Se contactó al apoderado?',SI_NO)] },
    { k:'ficha', n:'Ficha de derivación a la red de salud mental', t:'adjunto', plazo:[24,'horas'], vencer:'escalar',
      roles:[[P,ej]], campos:[sel('apoderado_cumplio_derivacion','¿El apoderado cumplió la derivación?',SI_NO)] },
    { k:'defensoria', n:'Denuncia a la Defensoría de la Niñez', t:'notificacion_externa',
      roles:[[D,ej]], campos:[sel('comprobante_adjunto','¿Comprobante adjunto?',SI_NO)] },
    { k:'plan', n:'Plan de acompañamiento escolar', t:'formulario',
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
      campos:[sel('organismo','Organismo',['fiscalia','pdi','carabineros']), sel('comprobante_adjunto','¿Comprobante adjunto?',SI_NO,false)] },
    { k:'evaluacion', n:'Evaluación del caso y entrevista', t:'formulario', plazo:[8,'horas'],
      roles:[[E,ej],[P,ej]], campos:[sel('requiere_derivacion_senda','¿Requiere derivación a SENDA?',SI_NO)] },
    { k:'notificacion', n:'Notificación a la familia', t:'formulario', plazo:[8,'horas'],
      roles:[[E,ej],[PJ,nt]], campos:[txt('observaciones','Constancia de la notificación')] },
    { k:'derivacion', n:'Derivación a SENDA o red de salud', t:'notificacion_externa',
      roles:[[P,ej]], campos:[sel('red_destino','Red de destino',['senda','cesfam','otro'])] },
    { k:'medidas', n:'Medidas formativas y seguimiento', t:'formulario',
      roles:[[E,ej],[P,ej]], campos:[sel('situacion_resuelta','¿La situación está resuelta?',SI_NO)] },
    { k:'cierre', n:'Cierre e informe', t:'adjunto', final:true, roles:[[E,ej],[D,ap]] },
  ],
  trans: [
    ['deteccion','denuncia','situacion=trafico','Tráfico o microtráfico'],
    ['deteccion','evaluacion',null,'Consumo o porte',true],
    ['denuncia','evaluacion'], ['evaluacion','notificacion'], ['notificacion','derivacion'], ['derivacion','medidas'],
    ['medidas','medidas','situacion_resuelta=no','Mantiene seguimiento'],
    ['medidas','cierre',null,'Resuelto',true],
  ],
},
// ---------------------------------------------------------------------------
{
  id: 9, // Protocolo de accidentes escolares
  legal: 'Ley 16.744 (Seguro Escolar); DS 313; Circular de Reglamentos Internos.',
  pasos: [
    { k:'atencion', n:'Atención inmediata y evaluación de gravedad', t:'formulario', plazo:[2,'horas'], inicial:true,
      roles:[[S,ej]], campos:[sel('gravedad','Gravedad',['leve','moderado','grave'])] },
    { k:'primeros', n:'Primeros auxilios en el establecimiento', t:'informativo', plazo:[2,'horas'], roles:[[S,ej]] },
    { k:'traslado', n:'Traslado a centro asistencial', t:'notificacion_externa', plazo:[2,'horas'], vencer:'escalar',
      roles:[[I,ej],[D,nt]], campos:[txt('centro_destino','Centro asistencial',true)] },
    { k:'seguro', n:'Emisión del formulario de Seguro Escolar', t:'adjunto', plazo:[8,'horas'],
      roles:[[I,ej]], campos:[sel('formulario_emitido','¿Se emitió el formulario?',SI_NO)] },
    { k:'notificacion', n:'Notificación al apoderado', t:'formulario', plazo:[2,'horas'],
      roles:[[I,ej]], campos:[sel('apoderado_contactado','¿Se contactó al apoderado?',SI_NO)] },
    { k:'registro', n:'Registro del accidente y seguimiento', t:'adjunto', plazo:[8,'horas'], final:true,
      roles:[[I,ej],[D,ap]], campos:[sel('requiere_seguimiento','¿Requiere seguimiento?',SI_NO,false)] },
  ],
  trans: [
    ['atencion','traslado','gravedad=grave','Accidente grave'],
    ['atencion','primeros',null,'Leve o moderado',true],
    ['primeros','seguro'], ['traslado','seguro'], ['seguro','notificacion'], ['notificacion','registro'],
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
    { k:'seguimiento', n:'Seguimiento del proceso (pre y post parto)', t:'formulario',
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
];

// ---------------------------------------------------------------------------

const DRY = process.argv.includes('--dry-run');

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
    }

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
      if (c > 0) {
        await conn.commit();
        console.log(`- ${id_protocolo} ya tiene flujo (${c} pasos): se salta`);
        saltados++;
        continue;
      }

      const mapa = new Map();
      let orden = 0;
      for (const p of proto.pasos) {
        const [r] = await conn.query(
          `INSERT INTO CATALOGO_PROTOCOLO_PASO
             (id_protocolo, nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
              accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id_protocolo, p.n, p.d ?? null, p.t, p.plazo?.[0] ?? null, p.plazo?.[1] ?? null,
           p.vencer ?? 'notificar', p.inicial ? 1 : 0, p.final ? 1 : 0, orden += 10]
        );
        mapa.set(p.k, r.insertId);

        await conn.query(
          'INSERT INTO CATALOGO_PROTOCOLO_PASO_ROL (id_paso, rol_id, tipo_participacion) VALUES ?',
          [p.roles.map(([codigo, part]) => [r.insertId, rolId.get(codigo), part])]
        );
        if (p.campos?.length)
          await conn.query(
            `INSERT INTO CATALOGO_PROTOCOLO_PASO_CAMPO
               (id_paso, codigo, etiqueta, tipo_campo, opciones, es_obligatorio, orden) VALUES ?`,
            [p.campos.map(([codigo, etiqueta, tipo, opciones, req], i) =>
              [r.insertId, codigo, etiqueta, tipo, opciones ? JSON.stringify(opciones) : null, req ? 1 : 0, (i + 1) * 10])]
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
