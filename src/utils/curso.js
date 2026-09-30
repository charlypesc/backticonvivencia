// "7BasicoA" -> "7 Basico A": el nombre del curso como se lee en un papel.
//
// En la base se guarda pegado porque es la llave con que la importación del
// padrón reconoce cada curso. Las pantallas lo formatean con el pipe
// cursoNombre del front; los PDF se arman acá, así que necesitan el mismo
// formato del lado del servidor, y tiene que ser uno solo: dos copias del
// regex es cómo el acta decía "5 Basico A" y el expediente "5BasicoA".
const formatearNombreCurso = (nombre) => {
  if (!nombre) return '';
  const m = String(nombre).match(/^(\d+)(Basico|Medio)([A-Z])$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : String(nombre);
};

module.exports = { formatearNombreCurso };
