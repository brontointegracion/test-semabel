import { contenidoCanonico, validarSobre } from '../sobre'

/** Contenido canónico de un sobre aunque tenga un campo inválido (para comparar versiones). */
export const sobreContenidoSeguro = (sobre) => contenidoCanonico(validarSobre(sobre).sobre)
