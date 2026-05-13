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
  resetParcial?: boolean;
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
  origin?: 'manual' | 'historical';
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

export type UserRole = 'admin' | 'produccion' | 'calidad' | 'jefe_produccion';

export interface RolePermissions {
  viewReports: boolean;
  editReports: boolean;
  viewElaboracion: boolean;
  editElaboracion: boolean;
  viewScheduler: boolean;
  editScheduler: boolean;
  viewPersonnel: boolean;
  editPersonnel: boolean;
  viewLiveMonitor: boolean;
  viewAnalytics: boolean;
  viewManagementSummary?: boolean;
  viewConsolidated?: boolean;
  viewWaste?: boolean;
  viewSyrup?: boolean;
  viewGoalFulfillment?: boolean;
  viewStockControl?: boolean;
  viewDowntime?: boolean;
  viewEfficiency?: boolean;
  viewGantt?: boolean;
  viewAdmin: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  sector?: string;
  photoURL?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id?: string;
  name: string;
  legajo: string;
  position: string;
  active: boolean;
  type?: 'Efectivo' | 'Temporario';
  sector?: string;
  hireDate?: string;
  terminationDate?: string;
  vacationAdjustment?: number;
  compensationAdjustment?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface AttendanceRecord {
  id?: string;
  employeeId: string;
  employeeName: string;
  employeeLegajo: string;
  date: string; // ISO Date YYYY-MM-DD
  shift: string;
  line: string;
  status: 'Presente' | 'Ausente' | 'Tarde' | 'Licencia' | 'Vacaciones' | 'Feriado' | 'Compensado';
  overtimeHours: number;
  observations?: string;
  createdAt: string;
  updatedAt?: string;
  authorId: string;
}

export interface ShiftAssignment {
  id?: string;
  employeeId: string;
  date: string; // ISO Date YYYY-MM-DD
  shift: string;
  line: string;
  createdAt: string;
  authorId: string;
}

export interface ProductionPlan {
  id?: string;
  date: string; // YYYY-MM-DD
  shift: 'Mañana' | 'Tarde' | 'Noche';
  linea: string;
  marca: string;
  sabor: string;
  tamano: number;
  plannedPacks: number;
  duration?: number; // 0.5, 1, etc.
  status: 'Draft' | 'Published';
  notes?: string;
  createdAt: string;
  authorId: string;
}

export interface ScheduleAuditLog {
  id?: string;
  planId: string;
  action: 'create' | 'update' | 'delete' | 'publish';
  datePlan: string; // Date of the production being planned
  timestamp: string; // ISO when the change happened
  changes?: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
  authorId: string;
}

export interface MonthlyGoal {
  id?: string;
  month: string; // YYYY-MM
  marca: string;
  sabor: string;
  tamano: number;
  quantity: number; // In packages
  createdAt: string;
  updatedAt: string;
}

export interface MonthlySnapshot {
  id?: string;
  month: string;
  year: number;
  stats: any;
  configAtTime: any;
  isClosed: boolean;
  createdAt: string;
  updatedAt: string;
}
