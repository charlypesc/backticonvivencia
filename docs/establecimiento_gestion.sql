-- Registro interno de la gestión comercial de Geo (2026-11-04).
--
-- Guarda quién cambió el estado del correo de contacto o las observaciones de
-- cada colegio, para saber qué colegios trabajó cada vendedor. Es solo para
-- consulta interna en la BD: ningún endpoint la lee ni la devuelve, así que no
-- aparece en el front. ESTABLECIMIENTO sigue guardando solo el estado actual;
-- esta tabla es el historial.
--
-- id_usuario sin cascada, igual que el resto de las FKs a USUARIO: un vendedor
-- con gestiones no se puede eliminar (usuarios.controller responde 409 y
-- sugiere desactivarlo), así no se pierde quién hizo qué.
--
-- origen 'reconstruido': filas cargadas a mano desde el estado que ya había,
-- antes de existir este registro. Solo se reconstruyeron las que con certeza
-- hizo un ADMIN (rol = 'ADMIN', id_usuario NULL porque no se sabe cuál de los
-- dos): las marcas sin fecha (anteriores a fecha_estado_correo, 2026-10-14) y
-- las anteriores al 2026-10-16 00:00 de Chile, día en que se crearon
-- ventas1/ventas2. Las marcas desde ese día y las observaciones (sin fecha ni
-- autor) quedan sin atribuir: podría haberlas hecho cualquiera.

CREATE TABLE ESTABLECIMIENTO_GESTION (
  id_gestion          INT NOT NULL AUTO_INCREMENT,
  id_establecimiento  INT NOT NULL,
  id_usuario          INT NULL,
  rol                 VARCHAR(50) NULL,
  accion              ENUM('estado_correo', 'observaciones') NOT NULL,
  estado_correo       TINYINT NULL,
  origen              ENUM('app', 'reconstruido') NOT NULL DEFAULT 'app',
  fecha               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_gestion),
  KEY idx_gestion_establecimiento (id_establecimiento, fecha),
  KEY idx_gestion_usuario (id_usuario, fecha),
  CONSTRAINT fk_gestion_establecimiento FOREIGN KEY (id_establecimiento)
    REFERENCES ESTABLECIMIENTO (id_establecimiento) ON DELETE CASCADE,
  CONSTRAINT fk_gestion_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Reconstrucción: lo que con seguridad hizo un ADMIN.
-- Sin fecha → se usa la del commit que agregó fecha_estado_correo como cota.
INSERT INTO ESTABLECIMIENTO_GESTION
  (id_establecimiento, id_usuario, rol, accion, estado_correo, origen, fecha)
SELECT id_establecimiento, NULL, 'ADMIN', 'estado_correo', estado_correo, 'reconstruido',
       COALESCE(fecha_estado_correo, '2026-10-14 22:22:32')
  FROM ESTABLECIMIENTO
 WHERE estado_correo <> 0
   AND (fecha_estado_correo IS NULL OR fecha_estado_correo < '2026-10-16 03:00:00');

-- Consulta de referencia: colegios trabajados por cada usuario.
-- SELECT COALESCE(u.correo, CONCAT(g.rol, ' (sin identificar)')) AS quien,
--        COUNT(DISTINCT g.id_establecimiento) AS colegios
--   FROM ESTABLECIMIENTO_GESTION g
--   LEFT JOIN USUARIO u ON u.id_usuario = g.id_usuario
--  GROUP BY 1 ORDER BY 2 DESC;
