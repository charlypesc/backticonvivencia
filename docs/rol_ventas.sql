-- Rol VENTAS: el equipo comercial de MiConvivencia.
--
-- Los vendedores son usuarios del COLEGIO MICONVIVENCIA (RBD 99001-9, el
-- colegio propio de la empresa) y por eso el rol vive solo ahí: no aparece en
-- el selector de roles de ningún otro colegio. El ADMIN los ve y los crea
-- desde Usuarios, con ese colegio activo.
--
-- Lo que pueden hacer es Geo y nada más: los mismos permisos 1-26 menos
-- establecimiento.eliminar (20) que ya tenían ventas1/ventas2@active2.cl como
-- excepciones por persona (catálogo geográfico, establecimientos y
-- sostenedores). Sin borrar colegios y sin cambiar su acceso (123): eso sigue
-- siendo del ADMIN. Sin dashboard.ver, el inicio los lleva directo a Geo.
--
-- Que un ENCARGADO del colegio (las cuentas demo tienen uno) no pueda otorgar
-- este rol ni tocar a quien lo tiene lo asegura el back, con ROLES_SOLO_ADMIN
-- en src/constants/roles.js.
--
-- Depende de docs/establecimiento_cambiar_acceso.sql: sin el permiso 123
-- separado, establecimiento.editar todavía incluye bloquear el acceso.

INSERT INTO ROLES (nombre, codigo, descripcion, id_establecimiento, es_sistema, activo)
SELECT 'Ventas', 'VENTAS',
       'Equipo comercial de MiConvivencia: gestión de colegios y correos de contacto en Geo.',
       id_establecimiento, 0, 1
  FROM ESTABLECIMIENTO WHERE rbd = '99001-9';

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT r.rol_id, p.permiso_id
  FROM ROLES r
  JOIN ESTABLECIMIENTO e ON e.id_establecimiento = r.id_establecimiento AND e.rbd = '99001-9'
  JOIN PERMISOS p ON p.permiso_id BETWEEN 1 AND 26 AND p.permiso_id <> 20
 WHERE r.codigo = 'VENTAS';
