-- Documentos de la reconsideración de una suspensión cautelar (art. 6 letra d)
-- del DFL 2 de 1998). Aplicado el 2026-09-23.
--
-- Hasta ahora la reconsideración se registraba solo como texto: la fecha y el
-- pronunciamiento del Consejo de Profesores tipeado en
-- SUSPENSION_CAUTELAR.consejo_profesores_acta. Eso acredita lo que el
-- establecimiento dice que pasó, no el documento: la ley exige que el Consejo
-- "deberá pronunciarse por escrito", y lo que se revisa en una fiscalización
-- es ese escrito firmado, junto con la solicitud que presentó el apoderado.
-- Mismo criterio que el acta de notificación firmada
-- (PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO_ARCHIVO).
--
-- Uno por tipo y por suspensión: volver a subir reemplaza, porque lo que vale
-- es la última copia legible. LONGBLOB y no MEDIUMBLOB (tope 16 MB): un acta
-- del Consejo escaneada en varias páginas puede superarlo aun comprimida.

-- 1. La tabla.
CREATE TABLE SUSPENSION_CAUTELAR_ARCHIVO (
  id_suspension_cautelar int          NOT NULL,
  -- solicitud_reconsideracion: el escrito firmado del apoderado o estudiante.
  -- acta_consejo: el pronunciamiento escrito y firmado del Consejo de Profesores.
  tipo                   enum('solicitud_reconsideracion','acta_consejo') NOT NULL,
  nombre_archivo         varchar(255) NOT NULL,
  mime_type              varchar(100) NOT NULL,
  peso_bytes             int          NOT NULL,
  contenido              longblob     NOT NULL,
  id_usuario             int          NOT NULL,
  fecha_subida           datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_suspension_cautelar, tipo),
  KEY fk_sca_usuario (id_usuario),
  CONSTRAINT fk_sca_suspension FOREIGN KEY (id_suspension_cautelar)
    REFERENCES SUSPENSION_CAUTELAR (id_suspension_cautelar) ON DELETE CASCADE,
  CONSTRAINT fk_sca_usuario FOREIGN KEY (id_usuario) REFERENCES USUARIO (id_usuario)
);

-- 2. El evento de bitácora al adjuntar uno de esos documentos. Se agrega al
--    FINAL del ENUM: así MySQL lo aplica sin reescribir la tabla y los valores
--    existentes conservan su posición.
ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO MODIFY tipo_evento enum(
  'activacion','inicio_paso','completado_paso','omitido_paso','transicion','vencimiento',
  'cierre','anulacion','nota','medida_proteccion_aplicada','medida_proteccion_editada',
  'medida_proteccion_finalizada','medida_proteccion_vencida','informe_expulsion_emitido',
  'expulsion_resuelta','expediente_exportado','involucrado_agregado','involucrado_editado',
  'gestion_involucrado','suspension_cautelar_aplicada','suspension_cautelar_editada',
  'suspension_cautelar_reconsiderada','suspension_cautelar_resuelta',
  'medida_disciplinaria_aplicada','medida_disciplinaria_cumplida',
  'condicionalidad_por_revisar','seguimiento_registrado',
  'suspension_cautelar_documento'
) NOT NULL;

-- Rollback (solo si todavía no hay filas con el valor nuevo ni documentos):
--   DROP TABLE SUSPENSION_CAUTELAR_ARCHIVO;
--   ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO MODIFY tipo_evento enum(...sin 'suspension_cautelar_documento') NOT NULL;
