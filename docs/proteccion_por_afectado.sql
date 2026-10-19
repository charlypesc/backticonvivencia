-- Medidas de protección decididas desde el afectado (prueba, rama protocolo-tarjetas).
--
-- La medida es "para la persona afectada" (Ley 21.809 art. 16 E letra j), pero
-- muchas recaen sobre el señalado: la suspensión, la prohibición de contacto,
-- el cambio de curso. MEDIDA_PROTECCION.id_involucrado sigue siendo sobre quién
-- RECAE; esta tabla dice a quién(es) PROTEGE.
--
-- Es una tabla y no una columna porque una misma medida puede proteger a
-- varios afectados: suspender a Lucas protege a la vez a Renata y a Matías, y
-- registrarla dos veces dejaba dos suspensiones (dos plazos, dos vencimientos)
-- de una sola decisión.
--
-- Las medidas anteriores no tienen filas acá: se entiende que protegen a la
-- persona sobre la que recaen, que era el afectado.
--
-- Abortar ante el primer error.

CREATE TABLE MEDIDA_PROTECCION_PROTEGIDO (
  id_medida_proteccion INT NOT NULL,
  id_involucrado       INT NOT NULL,
  PRIMARY KEY (id_medida_proteccion, id_involucrado),
  KEY idx_mpp_involucrado (id_involucrado),
  CONSTRAINT fk_mpp_medida FOREIGN KEY (id_medida_proteccion)
    REFERENCES MEDIDA_PROTECCION (id_medida_proteccion) ON DELETE CASCADE,
  CONSTRAINT fk_mpp_involucrado FOREIGN KEY (id_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_INVOLUCRADO (id_involucrado) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
