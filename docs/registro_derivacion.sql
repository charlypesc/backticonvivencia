-- Atención y derivación de registros + visibilidad de protocolos activados.
-- Aplicado el 2026-09-28. Respaldo previo de las cuatro tablas tocadas en el
-- scratchpad de la sesión (backup-2026-09-28-derivacion.sql).
--
-- 1. Quién "atajó" el registro. Un registro recién llenado por cualquier
--    funcionario queda sin atender hasta que un coordinador lo toma: es lo que
--    muestra el dashboard como "Registros por atender". Los que llena el propio
--    coordinador nacen atendidos (lo resuelve el controller, no un DEFAULT).
ALTER TABLE REGISTRO_CONVIVENCIA
  ADD COLUMN id_usuario_atiende INT NULL,
  ADD COLUMN fecha_atencion DATETIME NULL,
  ADD CONSTRAINT fk_registro_usuario_atiende
    FOREIGN KEY (id_usuario_atiende) REFERENCES USUARIO (id_usuario) ON DELETE SET NULL;

-- 2. Derivaciones: el coordinador le pasa el registro a otro funcionario con un
--    plazo. Tabla aparte y no columnas en el registro porque un registro puede
--    derivarse más de una vez (a otro, o al mismo con plazo nuevo) y la
--    historia de a quién se le pidió qué y cuándo es parte del caso.
--
--    aviso_vencida_at: el job avisa UNA vez que el plazo pasó. Sin la marca,
--    la campana se llenaría con el mismo aviso cada quince minutos.
CREATE TABLE REGISTRO_DERIVACION (
  id_derivacion       INT NOT NULL AUTO_INCREMENT,
  id_registro         INT NOT NULL,
  id_establecimiento  INT NOT NULL,
  id_usuario_origen   INT NOT NULL,
  id_usuario_destino  INT NOT NULL,
  instrucciones       VARCHAR(500) NULL,
  fecha_derivacion    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_limite        DATETIME NOT NULL,
  estado              ENUM('pendiente','atendida','anulada') NOT NULL DEFAULT 'pendiente',
  fecha_atendida      DATETIME NULL,
  comentario_atencion VARCHAR(500) NULL,
  aviso_vencida_at    DATETIME NULL,
  PRIMARY KEY (id_derivacion),
  KEY idx_deriv_registro (id_registro),
  KEY idx_deriv_destino (id_usuario_destino, estado),
  KEY idx_deriv_vencimiento (estado, fecha_limite),
  CONSTRAINT fk_deriv_registro FOREIGN KEY (id_registro)
    REFERENCES REGISTRO_CONVIVENCIA (id_registro) ON DELETE CASCADE,
  CONSTRAINT fk_deriv_estab FOREIGN KEY (id_establecimiento)
    REFERENCES ESTABLECIMIENTO (id_establecimiento),
  CONSTRAINT fk_deriv_origen FOREIGN KEY (id_usuario_origen) REFERENCES USUARIO (id_usuario),
  CONSTRAINT fk_deriv_destino FOREIGN KEY (id_usuario_destino) REFERENCES USUARIO (id_usuario)
);

-- 3. Notificaciones de registros. id_registro con CASCADE: borrar el registro
--    se lleva sus avisos (un aviso que lleva a un registro inexistente es ruido).
ALTER TABLE NOTIFICACION
  MODIFY COLUMN tipo ENUM('paso_en_curso','paso_vencido','paso_reasignado','protocolo_activado',
    'protocolo_cerrado','protocolo_anulado','medida_proteccion_vencida',
    'medida_disciplinaria_por_terminar','medida_disciplinaria_cumplida',
    'condicionalidad_por_revisar',
    'registro_nuevo','registro_derivado','derivacion_vencida','derivacion_atendida') NOT NULL,
  ADD COLUMN id_registro INT NULL,
  ADD CONSTRAINT fk_notif_registro FOREIGN KEY (id_registro)
    REFERENCES REGISTRO_CONVIVENCIA (id_registro) ON DELETE CASCADE;

-- 4. Permisos nuevos.
--    115 protocolo_activado.ver_todos: el listado de protocolos activados. Sin
--        él solo se ven los casos donde uno tiene un paso (Inspectoría ejecuta
--        pasos, así que no puede perder el acceso al caso que le toca).
--    116 registro.derivar: tomar un registro nuevo y derivarlo con plazo.
INSERT INTO PERMISOS (permiso_id, codigo, recurso, accion, descripcion) VALUES
  (115, 'protocolo_activado.ver_todos', 'protocolo_activado', 'ver_todos',
   'Protocolos activados: ver el listado completo (sin esto, solo los casos donde participa)'),
  (116, 'registro.derivar', 'registro', 'derivar',
   'Atender registros nuevos y derivarlos a otro funcionario con plazo');

-- ver_todos: todos los roles que ya veían protocolos, menos los de inspectoría.
INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT rp.rol_id, 115 FROM ROL_PERMISOS rp
  JOIN ROLES r ON r.rol_id = rp.rol_id
 WHERE rp.permiso_id = 59 AND r.codigo NOT IN ('INSPECTOR_GENERAL', 'INSPECTORIA');

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT rol_id, 116 FROM ROLES WHERE codigo IN ('ENCARGADO', 'DIRECTOR', 'PSICOLOGO');
