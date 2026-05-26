export const CO2_VOLUMES: Record<string, Record<string, number>> = {
  'Torasso': {
    'Cola': 4.2,
    'Citrus': 2.5,
    'Lima Limon': 4.0,
    'Limonada': 4.0,
    'Manzana': 3.4,
    'Naranja': 3.2,
    'Pomelo': 3.5,
    'Pomelo Blanco': 3.5,
    'Granadina': 3.4,
    'Agua Tónica': 3.9,
    'Soda Sifon': 5.1,
    'Soda': 4.5,
    'Agua': 0
  }
};

export const SUPERVISORES = ['Sosa', 'Camaño', 'Medina', 'Gianfrancisco'];
export const TURNOS = ['Mañana', 'Tarde', 'Noche'];

export const RANGOS_PRODUCCION = [
  'Operario de Producción Interno',
  'Operario Práctico (Producción)',
  'Operario Calificado',
  'Operario Múltiple',
  'Ingresante sin Formación (Producción)'
];

export const RANGOS_MANTENIMIENTO = [
  'Operario Práctico (Mantenimiento)',
  'Medio oficial',
  'Oficial',
  'Oficial especializado',
  'Oficial técnico',
  'Ingresante sin Formación (Mantenimiento)'
];

export const RANGOS_MIXTO = Array.from(new Set([...RANGOS_PRODUCCION, ...RANGOS_MANTENIMIENTO]));

export const LINEAS = ['1', '2', '3'];
export const MARCAS = ['Torasso'];
export const SABORES = ['Manzana', 'Naranja', 'Cola', 'Lima Limon', 'Pomelo', 'Agua Tónica', 'Pomelo Blanco', 'Citrus', 'Granadina', 'Limonada', 'Soda', 'Soda Sifon', 'Agua'];
export const SABORES_SIN_JARABE = ['Soda', 'Soda Sifon', 'Agua'];
export const DEFAULT_INSUMOS = [
  'Azucar',
  'Jugo de limon conc. 400 GPL',
  'Benzoato de Sodio',
  'Acido Citrico anidro',
  'Acido Ascórbico',
  'Sacarina sodica',
  'Acido Fosfórico',
  'EDTA',
  'Ciclamato de Sodio',
  'Colorante Caramelo 90F',
  'Sorbato de potasio',
  'Colorante Rojo Allura',
  'Citrato de sodio',
  'Lactato de calcio',
  'Cloruro de calcio',
  'Sulfato de magnesio',
  'Emulsion Cola 8373-78 Harmony',
  'Esencia manzana Novarom 7946 H',
  'NARANJA LK 642-78/0 SAPORITI',
  'ESENCIA LIMON SW 05/36',
  'EMULSION COLA FER 11924 E-SAPORITI',
  'EMULSION POMELO LK 615-78/2',
  'Emul. Citrus Novarom 8804Z',
  'TONICA LK 11824 SAPORITI',
  'Esencia granadina 10 veces concentrada Saporiti',
  'Colorante granadina 1004 Saporiti',
  'Aspartamo',
  'Acesulfame K',
  'ES. LIMON SW 1516 SAPORITI',
  'Enturbiante 1516 IFF 1516',
  'Cafeina',
  'Emul. Cola Novarom 8250',
  'Esencia Menta',
  'Extracto Fernet - MPA',
  'Cuasia',
  'Alcohol'
];
export const TAMANOS = [500, 1000, 1500, 2000, 2250, 3000];

export const FLAVOR_COLORS: Record<string, string> = {
  'Manzana': '#d97706',
  'Naranja': '#f97316',
  'Cola': '#dc2626',
  'Lima Limon': '#22c55e',
  'Pomelo': '#facc15',
  'Agua Tónica': '#000000',
  'Pomelo Blanco': '#fef08a',
  'Citrus': '#4ade80',
  'Granadina': '#c084fc',
  'Limonada': '#166534',
  'Soda': '#1e40af',
  'Soda Sifon': '#1e40af',
  'Agua': '#38bdf8'
};

export const PACKS_POR_PALETA: Record<number, number> = {
  3000: 60,
  2250: 80,
  2000: 80,
  1500: 125,
  1000: 175,
  500: 176,
};

export const BOTELLAS_POR_PACK: Record<number, number> = {
  3000: 6,
  2250: 6,
  2000: 6,
  1500: 6,
  1000: 6,
  500: 12,
};

export const SEPARADORES_POR_PALETA: Record<number, number> = {
  3000: 3,
  2250: 3,
  2000: 4,
  1500: 4,
  1000: 6,
  500: 7,
};

export const VELOCIDAD_MATRIX: Record<string, Record<number, number>> = {
  '1': {2250: 140, 3000: 115 },
  '2': { 2000: 80 },
  '3': { 500: 65, 1500: 60, 2250: 60},
};

export const WASTE_WEIGHTS: Record<number, { etiq: number; tapa: number; termo: number }> = {
  3000: { etiq: 0.88, tapa: 2.06, termo: 0.0510 },
  2250: { etiq: 0.80, tapa: 2.06, termo: 0.0350 },
  2000: { etiq: 1.10, tapa: 0,    termo: 0.0350 },
  1000: { etiq: 0.50, tapa: 2.60, termo: 0.0200 },
  1500: { etiq: 0.50, tapa: 2.60, termo: 0.0200 },
  500:  { etiq: 0.25, tapa: 2.60, termo: 0.0150 },
};

export const DOWNTIME_CATEGORIES = [
  {
    name: 'TIEMPO NO ASIGNADO',
    reasons: ['SIN REGISTRAR']
  },
  {
    name: 'PARADAS DE LINEA',
    reasons: [
      'SOPLADORA', 'TRANSPORTES NEUMATICOS', 'CARBONATADOR', 'RINSER', 'LLENADORA',
      'CAPSULADORA', 'CODIFICADOR', 'TRANSPORTES DE BOTELLAS', 'ETIQUETADORA',
      'EMPACADORA', 'TRANSPORTE DE PALLETS', 'PALLETIZADORA/ CARGA MANUAL'
    ]
  },
  {
    name: 'PARADAS OPERATIVAS',
    reasons: [
      'CALIDAD', 'FALTA DE PERSONAL', 'REFRIGERIO', 'INICIO Y FIN DE TURNO',
      'FALTA DE MONTACARGAS'
    ]
  },
  {
    name: 'PARADAS AJENAS A LINEA',
    reasons: [
      'SIN PROGRAMA', 'MANTENIMIENTO PROGRAMADO', 'CAMBIO DE SABOR', 'CAMBIO DE FORMATO',
      'FALTA DE ENERGIA', 'COMPRESORES', 'FRIO', 'AGUA', 'FALTA DE JARABE',
      'LUBRICACION', 'GAS CARBONICO / NITROGENO', 'FALTA DE MAT. PRIMAS/INSUMOS',
      'OTRAS AJENAS A LINEA'
    ]
  }
];

export const REPORT_DOWNTIME_CATEGORIES = [
  {
    name: 'TIEMPO NO ASIGNADO',
    reasons: ['SIN REGISTRAR']
  },
  {
    name: 'PARADAS DE LINEA',
    reasons: [
      'SOPLADORA', 'TRANSPORTES NEUMATICOS', 'CARBONATADOR', 'RINSER', 'LLENADORA',
      'CAPSULADORA', 'CODIFICADOR', 'TRANSPORTES DE BOTELLAS', 'ETIQUETADORA',
      'EMPACADORA', 'TRANSPORTE DE PALLETS', 'PALLETIZADORA/ CARGA MANUAL'
    ]
  },
  {
    name: 'PARADAS OPERATIVAS',
    reasons: [
      'CALIDAD', 'FALTA DE PERSONAL', 'REFRIGERIO/ INICIO Y FIN DE TURNO',
      'FALTA DE MONTACARGAS'
    ]
  },
  {
    name: 'PARADAS AJENAS A LINEA',
    reasons: [
      'SIN PROGRAMA', 'MANTENIMIENTO PROGRAMADO', 'CAMBIO DE SABOR/ FORMATO',
      'FALTA DE ENERGIA', 'COMPRESORES', 'FRIO', 'AGUA', 'FALTA DE JARABE',
      'LUBRICACION', 'GAS CARBONICO / NITROGENO', 'FALTA DE MAT. PRIMAS/INSUMOS',
      'OTRAS AJENAS A LINEA'
    ]
  }
];

// Tabla de Carbonatación (Presión en PSI, Temperatura en °C)
export const SQL_PRODUCT_MAPPING: Record<string, string> = {
  'Cola-500': '000001076',
  'Cola-1500': '000000273',
  'Cola-2250': '000000073',
  'Cola-3000': '000001573',
  'Naranja-500': '000001015',
  'Naranja-1500': '000000213',
  'Naranja-2250': '000000013',
  'Naranja-3000': '000001513',
  'Lima Limon-500': '000001036',
  'Lima Limon-1500': '000000234',
  'Lima Limon-2250': '000000033',
  'Lima Limon-3000': '000001733',
  'Manzana-500': '000001026',
  'Manzana-1500': '000000224',
  'Manzana-2250': '000001623',
  'Manzana-3000': '000001723',
  'Pomelo Blanco-500': '000000100',
  'Pomelo Blanco-1500': '000000254',
  'Pomelo Blanco-2250': '000001653',
  'Pomelo Blanco-3000': '000001753',
  'Citrus-3000': '000001583',
  'Limonada-3000': '000001543',
  'Agua Tónica-1500': '000030231',
  'Granadina-500': '000010106',
  'Granadina-1500': '000000293',
  'Granadina-3000': '000001593',
  'Soda-500': '000001096',
  'Soda-1500': '000001210',
  'Soda-2250': '000001188',
  'Soda Sifon-2000': '000001090',
  'Agua-500': '000001097',
  'Agua-1500': '000001099',
  'Agua-2250': '000001889',
};

export const CARBONATION_PRESSURES = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56];
export const CARBONATION_TEMPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
export const CARBONATION_TABLE = [
  [1.7, 1.9, 2.2, 2.4, 2.6, 2.9, 3.1, 3.3, 3.5, 3.8, 4.0, 4.2, 4.4, 4.7, 4.9, 5.2, 5.4, 5.6, 5.8, 6.1, 6.3, 6.5, 6.7, 7.0, 7.2, 7.4, 7.7, 7.9, 8.1], // 0°C
  [1.6, 1.9, 2.1, 2.3, 2.6, 2.7, 3.1, 3.2, 3.4, 3.6, 3.8, 4.1, 4.3, 4.5, 4.7, 4.9, 5.2, 5.6, 5.8, 6.0, 6.2, 6.2, 6.5, 6.7, 7.0, 7.2, 7.4, 7.6, 7.8], // 1°C
  [1.6, 1.8, 2.0, 2.2, 2.5, 2.6, 2.7, 3.0, 3.2, 3.5, 3.7, 3.9, 4.1, 4.3, 4.5, 4.7, 5.0, 5.2, 5.4, 5.6, 6.0, 6.0, 6.2, 6.4, 6.6, 6.9, 7.1, 7.3, 7.5], // 2°C
  [1.6, 1.7, 2.0, 2.2, 2.4, 2.5, 2.8, 3.0, 3.1, 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.6, 4.9, 5.1, 5.3, 5.5, 5.6, 5.9, 6.1, 6.3, 6.5, 6.7, 6.9, 7.1, 7.4], // 3°C
  [1.5, 1.7, 1.9, 2.1, 2.3, 2.5, 2.8, 2.9, 3.0, 3.3, 3.5, 3.7, 3.9, 4.2, 4.3, 4.5, 4.7, 4.9, 5.1, 5.3, 5.4, 5.7, 5.9, 6.0, 6.2, 6.4, 6.6, 6.6, 7.0], // 4°C
  [1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 2.8, 2.9, 3.1, 3.3, 3.5, 3.7, 4.0, 4.1, 4.2, 4.3, 4.5, 4.7, 4.8, 5.0, 5.2, 5.4, 5.6, 6.0, 6.2, 6.4, 6.6, 6.8], // 5°C
  [1.4, 1.6, 1.7, 1.9, 2.1, 2.3, 2.6, 2.7, 2.8, 3.0, 3.2, 3.4, 3.6, 3.9, 3.9, 4.1, 4.1, 4.5, 4.7, 4.8, 5.0, 5.2, 5.4, 5.6, 5.8, 6.0, 6.1, 6.2, 6.4], // 6°C
  [1.3, 1.5, 1.7, 1.8, 2.0, 2.2, 2.5, 2.5, 2.7, 2.9, 3.1, 3.3, 3.4, 3.8, 3.8, 4.0, 4.1, 4.3, 4.5, 4.7, 4.8, 5.0, 5.2, 5.4, 5.6, 5.7, 5.9, 5.9, 6.2], // 7°C
  [1.3, 1.5, 1.6, 1.8, 1.9, 2.1, 2.4, 2.5, 2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.7, 3.9, 4.0, 4.2, 4.4, 4.6, 4.7, 4.9, 5.1, 5.3, 5.4, 5.6, 5.8, 5.8, 6.2], // 8°C
  [1.2, 1.4, 1.6, 1.7, 1.9, 2.0, 2.3, 2.4, 2.5, 2.7, 2.9, 3.1, 3.2, 3.5, 3.6, 3.7, 3.9, 4.1, 4.2, 4.4, 4.6, 4.7, 4.9, 5.1, 5.2, 5.4, 5.6, 5.7, 5.8], // 9°C
  [1.2, 1.4, 1.5, 1.7, 1.8, 2.0, 2.2, 2.3, 2.5, 2.6, 2.8, 2.9, 3.1, 3.4, 3.4, 3.6, 3.7, 3.9, 4.0, 4.2, 4.4, 4.5, 4.7, 4.9, 5.0, 5.2, 5.4, 5.5, 5.6], // 10°C
  [1.2, 1.3, 1.5, 1.6, 1.8, 1.9, 2.2, 2.2, 2.4, 2.5, 2.7, 2.8, 3.0, 3.3, 3.3, 3.5, 3.6, 3.8, 3.9, 4.1, 4.2, 4.4, 4.5, 4.7, 4.9, 5.0, 5.2, 5.3, 5.4], // 11°C
  [1.1, 1.3, 1.4, 1.6, 1.7, 1.9, 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.9, 3.2, 3.2, 3.3, 3.5, 3.6, 3.8, 3.9, 4.1, 4.2, 4.4, 4.5, 4.7, 4.8, 5.0, 5.2, 5.3], // 12°C
  [1.1, 1.2, 1.4, 1.5, 1.6, 1.8, 1.9, 2.1, 2.2, 2.4, 2.5, 2.6, 2.8, 3.0, 3.1, 3.2, 3.4, 3.5, 3.7, 3.8, 3.9, 4.1, 4.2, 4.4, 4.5, 4.7, 4.9, 5.0, 5.2], // 13°C
  [1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.9, 2.0, 2.2, 2.3, 2.5, 2.6, 2.7, 2.9, 3.0, 3.2, 3.3, 3.5, 3.6, 3.7, 3.9, 4.0, 4.1, 4.3, 4.4, 4.6, 4.7, 4.9, 5.0], // 14°C
  [1.0, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 2.0, 2.1, 2.2, 2.4, 2.5, 2.7, 2.9, 2.9, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.9, 4.0, 4.2, 4.3, 4.4, 4.6, 4.7, 4.9], // 15°C
  [1.0, 1.1, 1.2, 1.4, 1.5, 1.6, 1.8, 1.9, 2.0, 2.2, 2.3, 2.4, 2.6, 2.8, 2.8, 3.0, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.9, 4.0, 4.1, 4.3, 4.4, 4.5, 4.6], // 16°C
  [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 2.0, 2.1, 2.2, 2.4, 2.5, 2.7, 2.7, 2.8, 3.0, 3.1, 3.2, 3.4, 3.5, 3.6, 3.8, 3.9, 4.0, 4.2, 4.3, 4.4, 4.5], // 17°C
  [0.9, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9, 2.0, 2.2, 2.3, 2.4, 2.6, 2.6, 2.8, 2.9, 3.0, 3.1, 3.3, 3.4, 3.5, 3.6, 3.8, 3.9, 4.0, 4.1, 4.2, 4.4], // 18°C
  [0.9, 1.0, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 2.0, 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 3.0, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3], // 19°C
  [0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.2, 2.3, 2.5, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9, 4.0], // 20°C
  [0.8, 1.0, 1.0, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 2.0, 2.1, 2.2, 2.4, 2.4, 2.5, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9, 4.0], // 21°C
  [0.8, 0.9, 1.0, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9], // 22°C
  [0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.5, 1.6, 1.6, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8], // 23°C
  [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7], // 24°C
  [0.8, 0.9, 0.9, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6], // 25°C
  [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5], // 26°C
  [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4], // 27°C
  [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4], // 28°C
  [0.7, 0.8, 0.9, 1.0, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.4, 2.4, 2.5, 2.5, 2.6, 2.9, 2.8, 2.9, 3.0, 3.1, 3.2], // 29°C
  [0.7, 0.8, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2], // 30°C
];
