// Catálogo de permisos: fuente de verdad única del código.
//
// El valor es el `permiso_id` real de la tabla `permisos`, no un número
// inventado. Se referencian por nombre (Permiso.CursoCrear) en vez de por
// string suelto ('curso.crear'): un typo en un string no falla en ninguna
// parte, simplemente deniega el acceso para siempre y en silencio. Escrito
// así, el editor lo marca y encuentra todos los usos de cada permiso.
//
// Este archivo y la tabla tienen que coincidir. No se sincronizan solos:
// verificarPermisos() (abajo) lo comprueba al arrancar y aborta si divergen,
// que es la única forma de enterarse a tiempo.
//
// Al agregar un permiso: primero el INSERT en la tabla, después la línea acá
// con el id que quedó.

const Permiso = Object.freeze({
  // pais
  PaisVer     :  1,
  PaisCrear   :  2,
  PaisEditar  :  3,
  PaisEliminar:  4,

  // region
  RegionVer     :  5,
  RegionCrear   :  6,
  RegionEditar  :  7,
  RegionEliminar:  8,

  // provincia
  ProvinciaVer     :  9,
  ProvinciaCrear   : 10,
  ProvinciaEditar  : 11,
  ProvinciaEliminar: 12,

  // comuna
  ComunaVer     : 13,
  ComunaCrear   : 14,
  ComunaEditar  : 15,
  ComunaEliminar: 16,

  // establecimiento
  EstablecimientoVer     : 17,
  EstablecimientoCrear   : 18,
  EstablecimientoEditar  : 19,
  EstablecimientoEliminar: 20,
  EstablecimientoImportar: 21,

  // sostenedor
  SostenedorVer                   : 22,
  SostenedorCrear                 : 23,
  SostenedorEditar                : 24,
  SostenedorEliminar              : 25,
  SostenedorAsignarEstablecimiento: 26,

  // mi_establecimiento
  MiEstablecimientoVer   : 27,
  MiEstablecimientoEditar: 28,

  // curso
  CursoVer           : 29,
  CursoCrear         : 30,
  CursoEditar        : 31,
  CursoEliminar      : 32,
  CursoImportar      : 33,
  CursoEliminarMasivo: 74,

  // estudiante
  EstudianteVer     : 34,
  EstudianteCrear   : 35,
  EstudianteEditar  : 36,
  EstudianteEliminar: 37,
  EstudianteBuscar  : 38,
  EstudianteActivar : 39,

  // registro
  RegistroVer                   : 40,
  RegistroCrear                 : 41,
  RegistroEditar                : 42,
  RegistroEliminar              : 43,
  RegistroVerTodos              : 44,
  RegistroValidar               : 45,
  RegistroConfirmar             : 46,
  RegistroVerConfidencial       : 75,
  RegistroEditarConfidencialidad: 76,

  // tipo_falta
  TipoFaltaVer     : 47,
  TipoFaltaCrear   : 48,
  TipoFaltaEditar  : 49,
  TipoFaltaEliminar: 50,

  // protocolo_generico
  ProtocoloGenericoVer     : 51,
  ProtocoloGenericoCrear   : 52,
  ProtocoloGenericoEditar  : 53,
  ProtocoloGenericoEliminar: 54,

  // protocolo_establecimiento
  ProtocoloEstablecimientoVer        : 55,
  ProtocoloEstablecimientoCrear      : 56,
  ProtocoloEstablecimientoEditar     : 57,
  ProtocoloEstablecimientoEliminar   : 58,
  ProtocoloEstablecimientoCrearPropio: 77,

  // protocolo_activado
  ProtocoloActivadoVer     : 59,
  ProtocoloActivadoCrear   : 60,
  ProtocoloActivadoEditar  : 61,
  ProtocoloActivadoEliminar: 62,

  // documento
  DocumentoVer  : 63,
  DocumentoSubir: 64,

  // dashboard
  DashboardVer: 65,

  // usuario
  UsuarioVer       : 66,
  UsuarioCrear     : 67,
  UsuarioActivar   : 68,
  UsuarioAsignarRol: 69,

  // rol
  RolVer           : 70,
  RolCrear         : 71,
  RolEditar        : 72,
  RolAsignarPermiso: 73,
});

// Traducción inversa, para mensajes de error legibles y para el chequeo de
// arranque. Un 403 que dice "falta el permiso 30" no le sirve a nadie.
const CODIGO_POR_ID = Object.freeze({
   1: 'pais.ver',
   2: 'pais.crear',
   3: 'pais.editar',
   4: 'pais.eliminar',
   5: 'region.ver',
   6: 'region.crear',
   7: 'region.editar',
   8: 'region.eliminar',
   9: 'provincia.ver',
  10: 'provincia.crear',
  11: 'provincia.editar',
  12: 'provincia.eliminar',
  13: 'comuna.ver',
  14: 'comuna.crear',
  15: 'comuna.editar',
  16: 'comuna.eliminar',
  17: 'establecimiento.ver',
  18: 'establecimiento.crear',
  19: 'establecimiento.editar',
  20: 'establecimiento.eliminar',
  21: 'establecimiento.importar',
  22: 'sostenedor.ver',
  23: 'sostenedor.crear',
  24: 'sostenedor.editar',
  25: 'sostenedor.eliminar',
  26: 'sostenedor.asignar_establecimiento',
  27: 'mi_establecimiento.ver',
  28: 'mi_establecimiento.editar',
  29: 'curso.ver',
  30: 'curso.crear',
  31: 'curso.editar',
  32: 'curso.eliminar',
  33: 'curso.importar',
  34: 'estudiante.ver',
  35: 'estudiante.crear',
  36: 'estudiante.editar',
  37: 'estudiante.eliminar',
  38: 'estudiante.buscar',
  39: 'estudiante.activar',
  40: 'registro.ver',
  41: 'registro.crear',
  42: 'registro.editar',
  43: 'registro.eliminar',
  44: 'registro.ver_todos',
  45: 'registro.validar',
  46: 'registro.confirmar',
  47: 'tipo_falta.ver',
  48: 'tipo_falta.crear',
  49: 'tipo_falta.editar',
  50: 'tipo_falta.eliminar',
  51: 'protocolo_generico.ver',
  52: 'protocolo_generico.crear',
  53: 'protocolo_generico.editar',
  54: 'protocolo_generico.eliminar',
  55: 'protocolo_establecimiento.ver',
  56: 'protocolo_establecimiento.crear',
  57: 'protocolo_establecimiento.editar',
  58: 'protocolo_establecimiento.eliminar',
  59: 'protocolo_activado.ver',
  60: 'protocolo_activado.crear',
  61: 'protocolo_activado.editar',
  62: 'protocolo_activado.eliminar',
  63: 'documento.ver',
  64: 'documento.subir',
  65: 'dashboard.ver',
  66: 'usuario.ver',
  67: 'usuario.crear',
  68: 'usuario.activar',
  69: 'usuario.asignar_rol',
  70: 'rol.ver',
  71: 'rol.crear',
  72: 'rol.editar',
  73: 'rol.asignar_permiso',
  74: 'curso.eliminar_masivo',
  75: 'registro.ver_confidencial',
  76: 'registro.editar_confidencialidad',
  77: 'protocolo_establecimiento.crear_propio',
});

const codigoDe = (id) => CODIGO_POR_ID[id] ?? `desconocido(${id})`;

// Compara el archivo contra la tabla al arrancar. Falla ruidosamente ante
// cualquier divergencia: un id que cambió de significado es peor que un
// permiso faltante, porque otorga acceso al recurso equivocado sin error.
async function verificarPermisos(pool) {
  const [rows] = await pool.query('SELECT permiso_id, codigo FROM permisos');
  const enBD = new Map(rows.map((r) => [r.permiso_id, r.codigo]));
  const problemas = [];

  for (const [id, codigo] of Object.entries(CODIGO_POR_ID)) {
    const real = enBD.get(Number(id));
    if (!real) problemas.push(`  id ${id} (${codigo}) está en el código pero no en la tabla`);
    else if (real !== codigo)
      problemas.push(`  id ${id} es '${real}' en la tabla pero '${codigo}' en el código`);
  }
  // Un permiso nuevo en la tabla que nadie referencia todavía no rompe nada,
  // pero avisa que falta agregarlo acá.
  for (const [id, codigo] of enBD)
    if (!CODIGO_POR_ID[id]) problemas.push(`  id ${id} (${codigo}) está en la tabla pero falta en el código`);

  if (problemas.length > 0)
    throw new Error(
      `El catálogo de permisos no coincide con la tabla \`permisos\`:\n${problemas.join('\n')}`
    );
}

module.exports = { Permiso, CODIGO_POR_ID, codigoDe, verificarPermisos };
