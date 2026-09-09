-- Permisos por persona, encima de los del rol.
--
-- Problema que resuelve: los roles útiles del sistema (INSPECTORIA, PSICOLOGO,
-- ORIENTADOR, UTP, COMITE_CONVIVENCIA…) son globales — `ROLES.id_establecimiento
-- IS NULL` — porque los comparten todos los colegios. Por eso roles.controller
-- solo deja editarlos al ADMIN: cambiarle un permiso a INSPECTORIA se lo cambia
-- a todos los establecimientos del país a la vez.
--
-- La consecuencia era que un encargado no tenía NINGUNA forma de decir "esta
-- inspectora en particular, además, exporta expedientes": o le inventaba un rol
-- propio del colegio duplicando todo, o se quedaba sin hacerlo.
--
-- USUARIO_PERMISOS es una capa fina por persona:
--
--     permisos efectivos = permisos de sus roles + concedidos - denegados
--
-- Se aplica dentro de VW_PERMISOS_EFECTIVOS, que es la misma vista que ya leía
-- el login para armar el JWT: nada aguas abajo (token, requirePermission,
-- frontend) se entera del cambio.
--
-- Aplicado el 2026-09-02.

-- ─── 1. La tabla ────────────────────────────────────────────────────────────
--
-- La PK es (id_usuario, permiso_id): una persona no puede tener el mismo
-- permiso concedido y denegado a la vez, así que no hay que definir cuál gana.
-- `motivo` no es decorativo: un override es una excepción, y en seis meses
-- nadie recuerda por qué existe. Si a media docena de personas hay que darles
-- lo mismo, lo que corresponde es un rol propio del establecimiento.
CREATE TABLE IF NOT EXISTS USUARIO_PERMISOS (
  id_usuario   INT NOT NULL,
  permiso_id   INT NOT NULL,
  efecto       ENUM('conceder','denegar') NOT NULL,
  motivo       VARCHAR(255) DEFAULT NULL,
  asignado_por INT DEFAULT NULL,
  asignado_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_at    DATETIME DEFAULT NULL,
  PRIMARY KEY (id_usuario, permiso_id),
  KEY idx_up_permiso (permiso_id),
  KEY fk_up_asignador (asignado_por),
  CONSTRAINT fk_up_usuario   FOREIGN KEY (id_usuario)   REFERENCES USUARIO (id_usuario)  ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_up_permiso   FOREIGN KEY (permiso_id)   REFERENCES PERMISOS (permiso_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_up_asignador FOREIGN KEY (asignado_por) REFERENCES USUARIO (id_usuario)  ON DELETE SET NULL ON UPDATE CASCADE
);

-- ─── 2. El permiso que gobierna la pantalla ─────────────────────────────────
--
-- Separado de usuario.asignar_rol a propósito: asignar un rol es elegir entre
-- plantillas ya aprobadas; esto fabrica una combinación de permisos que no
-- existe en ningún rol. No tiene por qué darse junto.
INSERT IGNORE INTO PERMISOS (permiso_id, codigo, recurso, accion, descripcion)
VALUES (114, 'usuario.asignar_permiso', 'usuario', 'asignar_permiso',
        'Conceder o denegar permisos puntuales a una persona, por sobre los de su rol');

-- Se le da al ENCARGADO, que es quien ya administra usuarios en cada colegio.
INSERT IGNORE INTO ROL_PERMISOS (rol_id, permiso_id) VALUES (3, 114);

-- ─── 3. La vista, ahora con los overrides ───────────────────────────────────
--
-- Sin filas en USUARIO_PERMISOS devuelve exactamente lo mismo que la versión
-- anterior (verificado fila a fila contra la definición vieja antes de aplicar).
--
-- Las dos ramas van por UNION y no por una derived table con NOT EXISTS afuera
-- porque la PK ya garantiza que un par (usuario, permiso) no puede estar en las
-- dos: al concedido no hace falta chequearle la denegación.
CREATE OR REPLACE VIEW VW_PERMISOS_EFECTIVOS AS
SELECT DISTINCT ur.id_usuario, rp.permiso_id
  FROM USUARIO_ROLES ur
  JOIN USUARIO u        ON u.id_usuario = ur.id_usuario AND u.activo = TRUE
  JOIN ROL_PERMISOS rp  ON rp.rol_id = ur.rol_id
  JOIN ROLES r          ON r.rol_id = ur.rol_id AND r.activo = TRUE
 WHERE (ur.expira_at IS NULL OR ur.expira_at > NOW())
   AND NOT EXISTS (
         SELECT 1 FROM USUARIO_PERMISOS d
          WHERE d.id_usuario = ur.id_usuario
            AND d.permiso_id = rp.permiso_id
            AND d.efecto = 'denegar'
            AND (d.expira_at IS NULL OR d.expira_at > NOW()))
UNION
SELECT up.id_usuario, up.permiso_id
  FROM USUARIO_PERMISOS up
  JOIN USUARIO u ON u.id_usuario = up.id_usuario AND u.activo = TRUE
 WHERE up.efecto = 'conceder'
   AND (up.expira_at IS NULL OR up.expira_at > NOW());

-- ─── Rollback ───────────────────────────────────────────────────────────────
-- DROP TABLE USUARIO_PERMISOS;  -- (borra los overrides: no hay vuelta atrás)
-- y volver a crear la vista sin el NOT EXISTS ni la segunda rama del UNION.
