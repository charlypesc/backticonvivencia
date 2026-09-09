-- ═══════════════════════════════════════════════════════════════════════════
-- Involucrados del registro que no son estudiantes
-- Aplicado 2026-09-02.
--
-- Por qué: REGISTRO_ESTUDIANTE (id_registro, id_estudiante, rol_en_incidente)
-- solo admite estudiantes, porque su PK compuesta y su FK a ESTUDIANTE así lo
-- exigen. El denunciante de un caso, sin embargo, muchas veces NO es un
-- estudiante: un inspector o un profesor que reporta lo que vio. El formulario
-- de "Nuevo registro" no tenía dónde ponerlo, así que ese dato simplemente no
-- quedaba registrado en ningún lado.
--
-- A nivel de protocolo activado esto ya existía (PROTOCOLO_ACTIVADO_INVOLUCRADO
-- con tipo_persona 'estudiante'/'funcionario'/'externo', fase 12), pero recién
-- se materializa cuando se activa un protocolo — y muchos registros no llegan a
-- activar ninguno, o lo activan después. La constancia de quién denunció tiene
-- que quedar desde el registro mismo, no depender de que alguien se acuerde de
-- agregarlo más tarde en el caso.
--
-- Se modela como tabla aparte y no ampliando REGISTRO_ESTUDIANTE: cambiar esa
-- tabla (PK compuesta con id_estudiante, FK NOT NULL a ESTUDIANTE) para admitir
-- filas sin estudiante hubiera tocado los 9 archivos del backend que ya la
-- consultan. Acá se agrega, no se toca nada existente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE REGISTRO_INVOLUCRADO_NO_ESTUDIANTE (
  id_involucrado    INT NOT NULL AUTO_INCREMENT,
  id_registro       INT NOT NULL,
  tipo_persona      ENUM('funcionario', 'externo') NOT NULL,
  -- Con cuenta en el sistema (el caso típico: un inspector, un profesor). Sin
  -- ella (un apoderado, un reemplazante sin usuario) va solo por nombre/rut,
  -- igual que PROTOCOLO_ACTIVADO_INVOLUCRADO.
  id_usuario        INT DEFAULT NULL,
  nombre            VARCHAR(150) NOT NULL,
  rut               VARCHAR(15)  DEFAULT NULL,
  rol_en_incidente  ENUM('afectado', 'senalado', 'testigo', 'denunciante')
                      NOT NULL DEFAULT 'denunciante',
  PRIMARY KEY (id_involucrado),
  KEY idx_rine_registro (id_registro),
  CONSTRAINT fk_rine_registro FOREIGN KEY (id_registro)
    REFERENCES REGISTRO_CONVIVENCIA (id_registro) ON DELETE CASCADE,
  -- SET NULL y no CASCADE: si el usuario se da de baja, el involucrado sigue
  -- existiendo con su nombre congelado — mismo criterio que fk_pai_usuario.
  CONSTRAINT fk_rine_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
);
