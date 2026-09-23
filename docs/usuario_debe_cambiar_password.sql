-- Clave temporal: la que genera el sistema al crear un usuario o al
-- restablecérsela el encargado. Quien la entregó la conoce (va impresa en el
-- documento), así que la persona está obligada a reemplazarla al entrar.
-- Las cuentas existentes quedan en 0: no se les fuerza nada.
ALTER TABLE USUARIO
  ADD COLUMN debe_cambiar_password TINYINT(1) NOT NULL DEFAULT 0;
