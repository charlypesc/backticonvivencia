-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 12.4 — Configuración de los 10 protocolos del catálogo
-- Aplicado 2026-08-27. Ver PLAN-LEY-PROTOCOLOS.md § Fase 12.2.
--
-- SUPERADO 2026-08-27: por_involucrado_rol y requiere_acuse ahora se definen
-- en scripts/seed_protocolos.js junto al resto del paso, y el script los
-- escribe al cargar. Este archivo queda como registro de lo que se aplicó;
-- volver a correrlo es inofensivo pero no aporta nada, y no cubre los pasos
-- de descargos ni de apelación agregados después.
--
-- Regla con la que se decidió cada paso: es POR PERSONA si su resultado puede
-- diferir entre dos involucrados del mismo caso, o si genera una obligación con
-- plazo propio hacia alguien. Investigar es del caso — investigarlo dos veces
-- produciría dos verdades. Notificar, medir, derivar y acompañar es de cada uno.
--
-- 'todos' alcanza a las partes (afectado y señalado) y NO a los testigos: a un
-- testigo no se le notifica una resolución ni se le aplica una medida.
--
-- 'requiere_acuse' solo donde la ley o el RICE piden constancia de que la
-- persona recibió: notificaciones a la familia y resoluciones. Que falte la
-- firma no detiene el protocolo; se marca en rojo y se pide motivo al cerrar.
-- ═══════════════════════════════════════════════════════════════════════════

-- Se identifica cada paso por (protocolo, nombre) y no por id: los ids del
-- catálogo no son estables entre ambientes.

-- ── Protocolo de acoso escolar / bullying ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso escolar / bullying' AND p.nombre = 'Recepción y registro de la denuncia';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso escolar / bullying' AND p.nombre = 'Clasificación de gravedad y activación';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso escolar / bullying' AND p.nombre = 'Denuncia a autoridad externa';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso escolar / bullying' AND p.nombre = 'Medidas de resguardo a la víctima';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso escolar / bullying' AND p.nombre = 'Investigación interna';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'senalado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso escolar / bullying' AND p.nombre = 'Resolución y aplicación de medidas';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'todos', p.requiere_acuse = 1
  WHERE c.nombre = 'Protocolo de acoso escolar / bullying' AND p.nombre = 'Notificación a apoderados y partes';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'todos', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso escolar / bullying' AND p.nombre = 'Seguimiento';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso escolar / bullying' AND p.nombre = 'Cierre del caso e informe final';

-- ── Protocolo de violencia entre adultos de la comunidad educativa ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de violencia entre adultos de la comunidad educativa' AND p.nombre = 'Recepción y registro del hecho';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'todos', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de violencia entre adultos de la comunidad educativa' AND p.nombre = 'Separación de las partes y medidas iniciales';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de violencia entre adultos de la comunidad educativa' AND p.nombre = 'Clasificación de gravedad';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de violencia entre adultos de la comunidad educativa' AND p.nombre = 'Denuncia a autoridad externa';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de violencia entre adultos de la comunidad educativa' AND p.nombre = 'Investigación por el Comité o la dirección';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'senalado', p.requiere_acuse = 1
  WHERE c.nombre = 'Protocolo de violencia entre adultos de la comunidad educativa' AND p.nombre = 'Resolución y medidas (disciplinarias o administrativas)';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de violencia entre adultos de la comunidad educativa' AND p.nombre = 'Seguimiento';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de violencia entre adultos de la comunidad educativa' AND p.nombre = 'Cierre e informe';

-- ── Protocolo ante hechos de connotación sexual ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo ante hechos de connotación sexual' AND p.nombre = 'Acogida del relato y detección';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo ante hechos de connotación sexual' AND p.nombre = 'Traslado a centro asistencial (urgencia médica)';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo ante hechos de connotación sexual' AND p.nombre = 'Notificación inmediata a dirección';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo ante hechos de connotación sexual' AND p.nombre = 'Denuncia obligatoria a autoridad competente';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo ante hechos de connotación sexual' AND p.nombre = 'Medidas de resguardo y contención (evitar revictimización)';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'todos', p.requiere_acuse = 1
  WHERE c.nombre = 'Protocolo ante hechos de connotación sexual' AND p.nombre = 'Comunicación a la familia';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo ante hechos de connotación sexual' AND p.nombre = 'Seguimiento y acompañamiento';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo ante hechos de connotación sexual' AND p.nombre = 'Cierre e informe';

-- ── Protocolo de vulneración de derechos de estudiantes ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de vulneración de derechos de estudiantes' AND p.nombre = 'Detección de la sospecha';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de vulneración de derechos de estudiantes' AND p.nombre = 'Recepción y clasificación de gravedad';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de vulneración de derechos de estudiantes' AND p.nombre = 'Denuncia a autoridad externa';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de vulneración de derechos de estudiantes' AND p.nombre = 'Recopilación de antecedentes (investigación interna)';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de vulneración de derechos de estudiantes' AND p.nombre = 'Medidas de resguardo';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 1
  WHERE c.nombre = 'Protocolo de vulneración de derechos de estudiantes' AND p.nombre = 'Citación y entrevista a la familia';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de vulneración de derechos de estudiantes' AND p.nombre = 'Derivación a redes externas (OPD, Cesfam)';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de vulneración de derechos de estudiantes' AND p.nombre = 'Plan de intervención y seguimiento';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de vulneración de derechos de estudiantes' AND p.nombre = 'Cierre e informe concluyente';

-- ── Protocolo de accidentes escolares ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de accidentes escolares' AND p.nombre = 'Atención inmediata y evaluación de gravedad';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de accidentes escolares' AND p.nombre = 'Primeros auxilios en el establecimiento';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de accidentes escolares' AND p.nombre = 'Traslado a centro asistencial';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de accidentes escolares' AND p.nombre = 'Emisión del formulario de Seguro Escolar';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 1
  WHERE c.nombre = 'Protocolo de accidentes escolares' AND p.nombre = 'Notificación al apoderado';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de accidentes escolares' AND p.nombre = 'Registro del accidente y seguimiento';

-- ── Protocolo de consumo, porte o tráfico de drogas y alcohol ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de consumo, porte o tráfico de drogas y alcohol' AND p.nombre = 'Detección y registro del hecho';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de consumo, porte o tráfico de drogas y alcohol' AND p.nombre = 'Denuncia obligatoria (tráfico o microtráfico)';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'senalado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de consumo, porte o tráfico de drogas y alcohol' AND p.nombre = 'Evaluación del caso y entrevista';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'senalado', p.requiere_acuse = 1
  WHERE c.nombre = 'Protocolo de consumo, porte o tráfico de drogas y alcohol' AND p.nombre = 'Notificación a la familia';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'senalado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de consumo, porte o tráfico de drogas y alcohol' AND p.nombre = 'Derivación a SENDA o red de salud';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'senalado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de consumo, porte o tráfico de drogas y alcohol' AND p.nombre = 'Medidas formativas y seguimiento';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de consumo, porte o tráfico de drogas y alcohol' AND p.nombre = 'Cierre e informe';

-- ── Protocolo de acoso y violencia a través de medios tecnológicos (ciberacoso) ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso y violencia a través de medios tecnológicos (ciberacoso)' AND p.nombre = 'Recepción de la denuncia y resguardo de la evidencia digital';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso y violencia a través de medios tecnológicos (ciberacoso)' AND p.nombre = 'Clasificación y evaluación de gravedad';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso y violencia a través de medios tecnológicos (ciberacoso)' AND p.nombre = 'Denuncia a autoridad externa';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'todos', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso y violencia a través de medios tecnológicos (ciberacoso)' AND p.nombre = 'Investigación y trabajo con apoderados';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'senalado', p.requiere_acuse = 1
  WHERE c.nombre = 'Protocolo de acoso y violencia a través de medios tecnológicos (ciberacoso)' AND p.nombre = 'Resolución y medidas formativas o disciplinarias';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'todos', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso y violencia a través de medios tecnológicos (ciberacoso)' AND p.nombre = 'Seguimiento';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de acoso y violencia a través de medios tecnológicos (ciberacoso)' AND p.nombre = 'Cierre e informe final';

-- ── Protocolo de ideación o intento suicida y autolesiones ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de ideación o intento suicida y autolesiones' AND p.nombre = 'Detección de señales de alerta';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de ideación o intento suicida y autolesiones' AND p.nombre = 'Contención inicial (nunca dejar solo al estudiante)';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de ideación o intento suicida y autolesiones' AND p.nombre = 'Derivación a urgencia médica';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 1
  WHERE c.nombre = 'Protocolo de ideación o intento suicida y autolesiones' AND p.nombre = 'Notificación a apoderados';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de ideación o intento suicida y autolesiones' AND p.nombre = 'Ficha de derivación a la red de salud mental';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de ideación o intento suicida y autolesiones' AND p.nombre = 'Denuncia a la Defensoría de la Niñez';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = 'afectado', p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de ideación o intento suicida y autolesiones' AND p.nombre = 'Plan de acompañamiento escolar';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de ideación o intento suicida y autolesiones' AND p.nombre = 'Postvención';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de ideación o intento suicida y autolesiones' AND p.nombre = 'Cierre y registro';

-- ── Protocolo de retención y apoyo a estudiantes embarazadas, madres y padres adolescentes ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de retención y apoyo a estudiantes embarazadas, madres y padres adolescentes' AND p.nombre = 'Acogida y registro de la situación';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de retención y apoyo a estudiantes embarazadas, madres y padres adolescentes' AND p.nombre = 'Coordinación con la familia y el equipo';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de retención y apoyo a estudiantes embarazadas, madres y padres adolescentes' AND p.nombre = 'Plan de acompañamiento académico';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de retención y apoyo a estudiantes embarazadas, madres y padres adolescentes' AND p.nombre = 'Seguimiento del proceso (pre y post parto)';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de retención y apoyo a estudiantes embarazadas, madres y padres adolescentes' AND p.nombre = 'Cierre y continuidad';

-- ── Protocolo de salidas pedagógicas y giras de estudio ──
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de salidas pedagógicas y giras de estudio' AND p.nombre = 'Solicitud y planificación de la salida';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de salidas pedagógicas y giras de estudio' AND p.nombre = 'Autorización directiva y del sostenedor';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de salidas pedagógicas y giras de estudio' AND p.nombre = 'Recolección de autorizaciones de apoderados';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de salidas pedagógicas y giras de estudio' AND p.nombre = 'Ejecución con medidas de seguridad';
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.por_involucrado_rol = NULL, p.requiere_acuse = 0
  WHERE c.nombre = 'Protocolo de salidas pedagógicas y giras de estudio' AND p.nombre = 'Registro y cierre';
