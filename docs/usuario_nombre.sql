-- Nombre de la persona en USUARIO
-- Aplicado el 2026-08-26 sobre la BD.
--
-- Por qué: el documento de credenciales que se entrega en mano se encabeza con
-- `Credenciales "Nombre"`. Hasta ahora el único dato identificatorio del usuario
-- era el correo, y al repartir varias hojas seguidas no había forma rápida de
-- saber cuál era de quién.
--
-- NULL permitido a propósito: los usuarios que ya existían no tienen nombre y no
-- se puede inventar uno. El alta sí lo exige (validado en
-- `usuarios.controller.js` y en los formularios del front), y para las filas
-- viejas el PDF cae al correo. `establecimiento.controller.create` —el alta
-- legacy que recibe la contraseña por body— sigue insertando sin nombre.
--
-- Falta: no hay endpoint para editar el nombre de un usuario ya creado. Si se
-- escribe mal en el alta, hoy solo se corrige por SQL.

ALTER TABLE USUARIO ADD COLUMN nombre VARCHAR(150) NULL AFTER correo;
