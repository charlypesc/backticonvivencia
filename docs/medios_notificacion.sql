-- Medios de notificación de la tarjeta "Notificación al apoderado / al
-- estudiante": presencial, videollamada, WhatsApp, teléfono y acta.
--
-- 'carta' pasa a llamarse 'acta': es la notificación por escrito que la
-- persona firma (y que se imprime desde la propia tarjeta). 'correo',
-- 'plataforma' y 'carta' siguen en el ENUM porque hay filas antiguas que los
-- usan y porque la suspensión cautelar guarda acá la vía con que se notificó
-- (su propio listado, en suspensionCautelar.controller.js). La pantalla ya no
-- los ofrece en la tarjeta de notificación.
--
-- Correr en orden y abortar ante el primer error. Backup previo de
-- PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO.

-- 1. Los valores nuevos.
ALTER TABLE PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO MODIFY medio_notificacion
  ENUM('presencial','correo','telefono','plataforma','carta','videollamada','whatsapp','acta') NULL;

-- 2. Lo que se notificó por carta queda como acta (mismo hecho, nuevo nombre).
UPDATE PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO SET medio_notificacion = 'acta' WHERE medio_notificacion = 'carta';
