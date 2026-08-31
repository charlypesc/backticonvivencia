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

  // protocolo_flujo (grafo de la plantilla global: pasos, transiciones, roles y campos)
  ProtocoloFlujoVer     : 79,
  ProtocoloFlujoEditar  : 80,
  ProtocoloFlujoPublicar: 81,

  // protocolo_flujo_establecimiento (copia espejo del grafo, por colegio)
  ProtocoloFlujoEstablecimientoVer         : 82,
  ProtocoloFlujoEstablecimientoPersonalizar: 83,
  ProtocoloFlujoEstablecimientoEditar      : 84,
  ProtocoloFlujoEstablecimientoRestaurar   : 85,

  // protocolo_activado
  ProtocoloActivadoVer          : 59,
  ProtocoloActivadoCrear        : 60,
  ProtocoloActivadoEditar       : 61,
  ProtocoloActivadoEliminar     : 62,
  ProtocoloActivadoCompletarPaso: 86,
  ProtocoloActivadoAprobarPaso  : 87,
  ProtocoloActivadoOmitirPaso   : 88,
  ProtocoloActivadoReasignarPaso: 89,
  ProtocoloActivadoCerrar       : 90,
  ProtocoloActivadoAnular       : 91,
  ProtocoloActivadoVerBitacora  : 92,

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
  UsuarioRestablecerPassword: 78,

  // rol
  RolVer           : 70,
  RolCrear         : 71,
  RolEditar        : 72,
  RolAsignarPermiso: 73,

  // ── Ley 21.809 ────────────────────────────────────────────────────────────
  // tipo_falta (vínculo con el protocolo que la falta obliga a activar)
  TipoFaltaVincularProtocolo: 93,

  // medida_proteccion (art. 16 E letra j: suspensión y demás medidas)
  MedidaProteccionVer                 : 94,
  MedidaProteccionCrear               : 95,
  MedidaProteccionFinalizar           : 96,
  MedidaProteccionRegistrarSeguimiento: 97,

  // medida_disciplinaria (medidas previas y su resultado, insumo del informe)
  MedidaDisciplinariaVer      : 98,
  MedidaDisciplinariaRegistrar: 99,

  // informe_expulsion (art. 2 N° 5 Ley 21.809: informe previo tasado)
  InformeExpulsionVer     : 100,
  InformeExpulsionElaborar: 101,
  InformeExpulsionDecidir : 102,

  // expediente (acreditación ante la Superintendencia y retención 24 meses)
  ExpedienteExportar      : 103,
  ExpedienteExportarMasivo: 104,

  // feriado (calendario que define los días hábiles de los plazos legales)
  FeriadoAdministrar: 105,

  // documento_institucional (RICE y Plan de Gestión, art. 16 G)
  DocumentoInstitucionalVer      : 106,
  DocumentoInstitucionalGestionar: 107,

  // constancia (recepción del RICE por el apoderado)
  ConstanciaVer      : 108,
  ConstanciaRegistrar: 109,

  // suspension_cautelar (art. 6 letra d del DFL 2/1998: la cautelar mientras
  // dura el procedimiento sancionatorio, distinta de la del art. 16 E letra j).
  // Crear y resolver son facultad del director, no una decisión de producto:
  // "El director tendrá la facultad de suspender, como medida cautelar".
  SuspensionCautelarVer                    : 110,
  SuspensionCautelarCrear                  : 111,
  SuspensionCautelarRegistrarReconsideracion: 112,
  SuspensionCautelarResolver               : 113,
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
  78: 'usuario.restablecer_password',
  79: 'protocolo_flujo.ver',
  80: 'protocolo_flujo.editar',
  81: 'protocolo_flujo.publicar',
  82: 'protocolo_flujo_establecimiento.ver',
  83: 'protocolo_flujo_establecimiento.personalizar',
  84: 'protocolo_flujo_establecimiento.editar',
  85: 'protocolo_flujo_establecimiento.restaurar',
  86: 'protocolo_activado.completar_paso',
  87: 'protocolo_activado.aprobar_paso',
  88: 'protocolo_activado.omitir_paso',
  89: 'protocolo_activado.reasignar_paso',
  90: 'protocolo_activado.cerrar',
  91: 'protocolo_activado.anular',
  92: 'protocolo_activado.ver_bitacora',
  93: 'tipo_falta.vincular_protocolo',
  94: 'medida_proteccion.ver',
  95: 'medida_proteccion.crear',
  96: 'medida_proteccion.finalizar',
  97: 'medida_proteccion.registrar_seguimiento',
  98: 'medida_disciplinaria.ver',
  99: 'medida_disciplinaria.registrar',
 100: 'informe_expulsion.ver',
 101: 'informe_expulsion.elaborar',
 102: 'informe_expulsion.decidir',
 103: 'expediente.exportar',
 104: 'expediente.exportar_masivo',
 105: 'feriado.administrar',
 106: 'documento_institucional.ver',
 107: 'documento_institucional.gestionar',
 108: 'constancia.ver',
 109: 'constancia.registrar',
 110: 'suspension_cautelar.ver',
 111: 'suspension_cautelar.crear',
 112: 'suspension_cautelar.registrar_reconsideracion',
 113: 'suspension_cautelar.resolver',
});

const codigoDe = (id) => CODIGO_POR_ID[id] ?? `desconocido(${id})`;

// Compara el archivo contra la tabla al arrancar. Falla ruidosamente ante
// cualquier divergencia: un id que cambió de significado es peor que un
// permiso faltante, porque otorga acceso al recurso equivocado sin error.
async function verificarPermisos(pool) {
  const [rows] = await pool.query('SELECT permiso_id, codigo FROM PERMISOS');
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
