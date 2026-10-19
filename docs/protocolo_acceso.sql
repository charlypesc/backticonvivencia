-- Acceso por caso y relatos asignados a un funcionario.
--
-- Quién ve un protocolo activado completo ya no lo decide el rol (el permiso
-- protocolo_activado.ver_procesos), sino una lista propia de cada caso. Solo
-- tres roles ven siempre todos los casos sin estar en la lista: ADMIN,
-- DIRECTOR y ENCARGADO (coordinador de convivencia) — ver
-- src/utils/accesoCaso.js. El resto entra por la lista, o porque le asignaron
-- una tarjeta o el relato de una persona, y en ese caso ve solo eso.
--
-- Fundamento: la investigación se rige por la confidencialidad (Ley 21.809,
-- art. 16 E letra g) y los colegios deben proteger los datos de niños, niñas y
-- adolescentes (Ley 21.719, art. 16 quáter): cada caso lo ve quien lo necesita.
--
-- Requiere docs/acogida_relatos.sql. Correr en orden y abortar ante el primer error.

-- 1. Quién ve cada caso completo, quién le dio el acceso y cuándo.
CREATE TABLE PROTOCOLO_ACTIVADO_ACCESO (
  id_protocolo_activado INT NOT NULL,
  id_usuario            INT NOT NULL,
  id_usuario_otorga     INT NULL,
  fecha                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_protocolo_activado, id_usuario),
  KEY idx_acceso_usuario (id_usuario),
  CONSTRAINT fk_acceso_caso FOREIGN KEY (id_protocolo_activado)
    REFERENCES PROTOCOLO_ACTIVADO (id_protocolo_activado) ON DELETE CASCADE,
  CONSTRAINT fk_acceso_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE CASCADE,
  CONSTRAINT fk_acceso_otorga FOREIGN KEY (id_usuario_otorga)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. Los casos que ya existen: quien los activó queda en su lista, igual que
--    pasa al activar uno nuevo. Sin esto, un caso activado por alguien que no
--    es de los tres roles quedaría fuera del alcance de quien lo lleva.
INSERT IGNORE INTO PROTOCOLO_ACTIVADO_ACCESO (id_protocolo_activado, id_usuario, id_usuario_otorga, fecha)
SELECT id_protocolo_activado, id_usuario_activo, NULL, fecha_activacion
FROM PROTOCOLO_ACTIVADO
WHERE id_usuario_activo IS NOT NULL;

-- 3. El relato de una persona se puede encargar a un funcionario: ve solo ese
--    relato. La fila puede existir antes de decidir si se le acoge (se asigna
--    primero, decide quien entrevista), así que se_acoge pasa a admitir NULL.
ALTER TABLE PROTOCOLO_ACTIVADO_RELATO_DECISION
  MODIFY se_acoge TINYINT(1) NULL,
  ADD COLUMN id_usuario_responsable INT NULL AFTER motivo,
  ADD KEY idx_relato_decision_responsable (id_usuario_responsable),
  ADD CONSTRAINT fk_relato_decision_responsable FOREIGN KEY (id_usuario_responsable)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL;

-- 4. Eventos de bitácora del acceso y de la asignación de relatos.
ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO MODIFY tipo_evento
  ENUM('activacion','inicio_paso','completado_paso','omitido_paso','transicion','vencimiento','cierre',
       'anulacion','nota','medida_proteccion_aplicada','medida_proteccion_editada',
       'medida_proteccion_finalizada','medida_proteccion_vencida','informe_expulsion_emitido',
       'expulsion_resuelta','expediente_exportado','involucrado_agregado','involucrado_editado',
       'gestion_involucrado','suspension_cautelar_aplicada','suspension_cautelar_editada',
       'suspension_cautelar_reconsiderada','suspension_cautelar_resuelta','medida_disciplinaria_aplicada',
       'medida_disciplinaria_cumplida','condicionalidad_por_revisar','seguimiento_registrado',
       'suspension_cautelar_documento','plazo_investigacion_vencido',
       'relato_decision','relato_acogido','relato_editado',
       'acceso_otorgado','acceso_retirado','relato_asignado') NOT NULL;
