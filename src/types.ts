export interface HourlyProduction {
  hora: string;
  marcador: number;
  botMin: number;
  minProd: number;
}

export interface Downtime {
  category: string;
  reason: string;
  minutes: number[];
  totalMinutes: number;
}

export interface ProductionReport {
  id?: string;
  supervisor: string;
  turno: string;
  fecha: string;
  planilla: string;
  lote?: string;
  linea: string;
  marca: string;
  velocidad?: number;
  sabor?: string;
  tamano?: number;
  entraTurno?: string;
  saleTurno?: string;
  tiempoTurno?: number;
  jarabeInicial?: number;
  jarabeFinal?: number;
  jarabeConsumido?: number;
  contInicial?: number;
  contFinal?: number;
  botRotas?: number;
  botellas?: number;
  paquetes?: number;
  parcialAnterior?: number;
  ajusteParcial?: number;
  tickets?: number;
  parcialActual?: number;
  paletasDeEsteParte?: number;
  totalSeparadores?: number;
  eficBruta?: number;
  co2?: number;
  observaciones?: string;
  createdAt: string;
  authorId: string;
  authorName?: string;
  hourlyProduction: HourlyProduction[];
  downtimes: Downtime[];
  // Desperdicios
  scrapSoplado?: number;
  scrapEtiquetado?: number;
  scrapLlenado?: number;
  scrapHorno?: number;
  desperdicioEtiquetas?: number;
  desperdicioTapas?: number;
  desperdicioSifones?: number;
  desperdicioTermo?: number;
}

export interface ElaboracionHourlyData {
  hora: string;
  loteElaboracion: string;
  tanque: string;
  presion?: number;
  temp?: number;
  volBot?: number;
  volBotCorregido?: number;
  brixBot?: number;
  brixPatron?: number;
  brixBotCorregido?: number;
  acidezPatron?: number;
  phBebida?: number;
  brixJarabe?: number;
  codif: 'OK' | 'FALLA';
  cloro: 'OK' | 'FALLA';
  organoleptico: 'OK' | 'FALLA';
  micro: 'OK' | 'FALLA';
}

export interface ElaboracionReport {
  id?: string;
  fecha: string;
  turno: string;
  planilla: string;
  quimico: string;
  lote: string;
  linea: string;
  marca: string;
  sabor: string;
  tamano: number;
  horaInicio?: string;
  horaFin?: string;
  contInicial?: number;
  contFinal?: number;
  botellasProduccion?: number;
  jarabeInicial?: number;
  jarabeFinal?: number;
  jarabeConsumido?: number;
  jarabeTeorico?: number;
  jarabeDesperdicio?: number;
  jarabeDesperdicioPorcentaje?: number;
  co2Inicial?: number;
  co2Final?: number;
  co2Recarga?: number;
  co2Consumido?: number;
  hourlyData: ElaboracionHourlyData[];
  createdAt: string;
  authorId: string;
  authorName?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  photoURL?: string;
  createdAt: string;
  updatedAt: string;
}
