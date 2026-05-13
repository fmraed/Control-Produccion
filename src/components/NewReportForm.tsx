import { useState, useEffect, useRef } from 'react';
import { useForm, useFieldArray, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { collection, addDoc, query, where, orderBy, limit, getDocs, doc, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Save, X, Plus, Trash2, Clock, Activity, AlertCircle, FileText, CheckCircle2, Printer, ClipboardList } from 'lucide-react';
import { ProductionReport, HourlyProduction, Downtime } from '../types';
import { 
  SUPERVISORES, TURNOS, LINEAS, MARCAS, SABORES, TAMANOS, SABORES_SIN_JARABE,
  SEPARADORES_POR_PALETA,
  DOWNTIME_CATEGORIES
} from '../constants';
import { useAppConfig } from '../hooks/useAppConfig';
import { getShiftHours, getDefaultInputDate } from '../utils';
import { printProductionReport, printInternalReport } from '../utils/printReport';
import { CO2_VOLUMES } from '../constants';

// DOWNTIME_CATEGORIES imported from constants.ts

// --- Funciones Auxiliares ---
function formatNumber(num: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(num);
}

function getAvailableMinutesInHour(horaStr: string, entraTurno?: string, saleTurno?: string): number {
  let endHourNum = parseInt(horaStr, 10);
  if (endHourNum === 24) endHourNum = 0;
  let startHourNum = endHourNum - 1;
  if (startHourNum < 0) startHourNum = 23;

  let entraH = -1, entraM = 0;
  if (entraTurno) {
    const normalizedEntra = String(entraTurno).replace(/[,.]/g, ':');
    const parts = normalizedEntra.split(':');
    entraH = parseInt(parts[0]) || 0;
    entraM = parseInt(parts[1]) || 0;
    if (entraH === 24) entraH = 0;
  }

  let saleH = -1, saleM = 0;
  if (saleTurno) {
    const normalizedSale = String(saleTurno).replace(/[,.]/g, ':');
    const parts = normalizedSale.split(':');
    saleH = parseInt(parts[0]) || 0;
    saleM = parseInt(parts[1]) || 0;
    if (saleH === 24) saleH = 0;
  }

  if (entraH === -1 || saleH === -1) return 60;

  const totalEntra = entraH * 60 + entraM;
  const totalSale = saleH * 60 + saleM;
  const hourStart = startHourNum * 60;
  const hourEnd = startHourNum * 60 + 60;

  if (totalEntra < totalSale) {
    // Turno en el mismo día
    const intersectionStart = Math.max(hourStart, totalEntra);
    const intersectionEnd = Math.min(hourEnd, totalSale);
    return Math.max(0, intersectionEnd - intersectionStart);
  } else if (totalEntra > totalSale) {
    // Turno cruza medianoche
    // El turno es [totalEntra, 24*60] UNION [0, totalSale]
    const part1Start = Math.max(hourStart, totalEntra);
    const part1End = Math.min(hourEnd, 24 * 60);
    const part1 = Math.max(0, part1End - part1Start);

    const part2Start = Math.max(hourStart, 0);
    const part2End = Math.min(hourEnd, totalSale);
    const part2 = Math.max(0, part2End - part2Start);

    return part1 + part2;
  } else {
    // totalEntra === totalSale -> Asumimos 24 horas
    return 60;
  }
}

function parseTime(t: any): number {
  if (!t) return 0;
  // Permite formatos como "24:00", "24.00", "24,00"
  const normalized = String(t).replace(/[,.]/g, ':');
  const parts = normalized.split(':');
  let h = parseInt(parts[0]) || 0;
  let m = parseInt(parts[1]) || 0;
  if (h === 24) h = 0; // 24:00 es equivalente a las 00:00 del día siguiente
  return h * 60 + m;
}

function calculateBruto(start: string, end: string): number {
  if (!start || !end) return 0;
  let s = parseTime(start);
  let e = parseTime(end);
  // Si la hora de salida es menor o igual a la de entrada, asumimos que cruzó la medianoche
  if (e <= s && s > 0) e += 24 * 60;
  return e - s;
}

function getPrevMarcador(hourlyData: any[], hIndex: number, contInicial: number): number {
  for (let i = hIndex - 1; i >= 0; i--) {
    if (hourlyData[i]?.marcador > 0) {
      return hourlyData[i].marcador;
    }
  }
  return contInicial || 0;
}

function getBotellasTotales(report: any): number {
  const contInicial = report.contInicial || 0;
  const contFinal = report.contFinal || 0;
  const botRotas = report.botRotas || 0;
  const hourlyData = report.hourlyProduction || [];
  
  let total = 0;
  if (contFinal > 0) {
    total = Math.max(0, contFinal - contInicial);
  } else {
    let maxMarcador = 0;
    for (const h of hourlyData) {
      if ((h.marcador || 0) > maxMarcador) {
        maxMarcador = h.marcador;
      }
    }
    total = Math.max(0, maxMarcador - contInicial);
  }
  
  return Math.max(0, total - botRotas);
}

function calculateLiveEfficiency(report: any, botellasTotales: number): number {
  if (!report.entraTurno || !report.velocidad || botellasTotales <= 0) return 0;
  
  const entraParts = String(report.entraTurno).split(':');
  if (entraParts.length !== 2) return 0;
  
  let startHour = parseInt(entraParts[0], 10);
  const startMin = parseInt(entraParts[1], 10);
  
  // If saleTurno is provided, use it as the end time
  if (report.saleTurno) {
    const saleParts = String(report.saleTurno).split(':');
    if (saleParts.length === 2) {
      let endHour = parseInt(saleParts[0], 10);
      const endMin = parseInt(saleParts[1], 10);
      if (endHour < startHour) endHour += 24;
      const totalMinutes = ((endHour - startHour) * 60) + (endMin - startMin);
      if (totalMinutes > 0) {
        const expectedBottles = totalMinutes * report.velocidad;
        if (expectedBottles > 0) {
          return Math.round((botellasTotales / expectedBottles) * 100);
        }
      }
    }
  }
  
  // Otherwise, find last recorded hour
  let lastRecordedHourStr = '';
  if (report.hourlyProduction) {
    const recordedHours = report.hourlyProduction.filter((h: any) => (h.marcador || 0) > 0);
    if (recordedHours.length > 0) {
      lastRecordedHourStr = recordedHours[recordedHours.length - 1].hora;
    }
  }
  
  if (!lastRecordedHourStr) return 0;
  
  let endHour = parseInt(lastRecordedHourStr, 10);
  
  // Handle overnight shifts
  if (endHour < startHour) {
    endHour += 24;
  }
  
  // Calculate total minutes passed
  const totalMinutes = ((endHour - startHour) * 60) - startMin;
  
  if (totalMinutes <= 0) return 0;
  
  const expectedBottles = totalMinutes * report.velocidad;
  if (expectedBottles <= 0) return 0;
  
  return Math.round((botellasTotales / expectedBottles) * 100);
}

// Función para detectar turno automáticamente
const detectTurno = (timeStr: any, dateStr: any): string => {
  if (!timeStr || !dateStr) return '';
  const parts = String(timeStr).split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  const timeInMinutes = hours * 60 + (isNaN(minutes) ? 0 : minutes);
  
  // Parse date manually YYYY-MM-DD to avoid timezone issues
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  const isSaturday = dayOfWeek === 6;

  if (isSaturday) {
    if (timeInMinutes >= 5 * 60 && timeInMinutes < 13 * 60) return 'Mañana';
    if (timeInMinutes >= 13 * 60 && timeInMinutes < 22 * 60) return 'Tarde';
    return 'Noche';
  } else {
    if (timeInMinutes >= 6 * 60 && timeInMinutes < 14 * 60) return 'Mañana';
    if (timeInMinutes >= 14 * 60 && timeInMinutes < 22 * 60) return 'Tarde';
    return 'Noche';
  }
};

// --- Esquema de Validación ---
const reportSchema = z.object({
  reports: z.array(z.object({
    supervisor: z.string().min(1, 'Requerido'),
    turno: z.string().min(1, 'Requerido'),
    fecha: z.string().min(1, 'Requerido'),
    planilla: z.string().min(1, 'Requerido'),
    lote: z.string().optional(),
    linea: z.string().min(1, 'Requerido'),
    marca: z.string().min(1, 'Requerido'),
    velocidad: z.number().min(0).optional(),
    sabor: z.string().min(1, 'Requerido'),
    tamano: z.number().min(1, 'Requerido'),
    entraTurno: z.string().min(1, 'Requerido'),
    saleTurno: z.string().min(1, 'Requerido'),
    tiempoTurno: z.number().min(0).optional(),
    jarabeInicial: z.number().min(0).optional(),
    jarabeConsumido: z.number().min(0).optional(),
    jarabeFinal: z.number().min(0).optional(),
    contInicial: z.number().min(1, 'Requerido'),
    contFinal: z.number().min(1, 'Requerido'),
    botRotas: z.number().min(0).optional(),
    co2: z.number().min(0).optional(),
    observaciones: z.string().optional(),
    parcialAnterior: z.number().min(0).optional(),
    resetParcial: z.boolean().optional(),
    ajusteParcial: z.number().optional(),
    hourlyProduction: z.array(z.object({
      hora: z.string(),
      marcador: z.number().min(0),
      botMin: z.number().optional(),
      minProd: z.number().optional(),
    })).optional(),
    downtimes: z.array(z.object({
      category: z.string().optional(),
      reason: z.string().min(1, 'Requerido'),
      minutes: z.array(z.any()).optional(),
      totalMinutes: z.number().optional(),
    })).optional(),
    scrapSoplado: z.number().min(0).optional(),
    scrapEtiquetado: z.number().min(0).optional(),
    scrapLlenado: z.number().min(0).optional(),
    scrapHorno: z.number().min(0).optional(),
    desperdicioEtiquetas: z.number().min(0).optional(),
    desperdicioTapas: z.number().min(0).optional(),
    desperdicioSifones: z.number().min(0).optional(),
    desperdicioTermo: z.number().min(0).optional(),
  }).refine(data => {
    if (!data.entraTurno || !data.fecha || !data.turno) return true;
    return detectTurno(data.entraTurno, data.fecha) === data.turno;
  }, {
    message: "El turno no coincide con el horario de inicio",
    path: ["turno"]
  })).min(1),
});

type ReportFormValues = z.infer<typeof reportSchema>;

interface NewReportFormProps {
  onCancel: () => void;
  onSuccess: () => void;
  initialData?: ProductionReport;
  key?: string;
}

export function NewReportForm({ onCancel, onSuccess, initialData }: NewReportFormProps) {
  const { 
    config,
    getFilteredFlavors, 
    getFilteredSizes, 
    availableBrands, 
    availableLines, 
    availableSupervisors
  } = useAppConfig();
  const [activeTab, setActiveTab] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showTimeWarningModal, setShowTimeWarningModal] = useState(false);
  const [skipTimeCheck, setSkipTimeCheck] = useState(false);
  const [lastSavedReport, setLastSavedReport] = useState<ProductionReport | null>(null);
  const lastShiftDate = useRef<Record<number, string>>({});

  useEffect(() => {
    if (skipTimeCheck) {
      handleSaveCurrentPart();
    }
  }, [skipTimeCheck]);

  const createDefaultHourlyProduction = (turno: string = TURNOS[0], fecha: string = new Date().toISOString().split('T')[0]): HourlyProduction[] => {
    const hours = getShiftHours(turno, fecha);
    return hours.map(h => ({
      hora: h,
      marcador: 0,
      botMin: 0,
      minProd: 60,
    }));
  };

  const createDefaultReport = (index: number): any => {
    const today = getDefaultInputDate();
    const defaultTurno = TURNOS[0];
    return {
      supervisor: '',
      turno: defaultTurno,
      fecha: today,
      planilla: `P-00${index + 1}`,
      linea: availableLines[0] || '',
      marca: 'Torasso',
      sabor: '',
      tamano: 0,
      parcialAnterior: 0,
      resetParcial: false,
      ajusteParcial: 0,
      botRotas: 0,
      jarabeInicial: 0,
      contInicial: 0,
      contFinal: 0,
      velocidad: 0,
      co2: 0,
      saleTurno: '',
      tiempoTurno: 0,
      observaciones: '',
      lote: '',
      scrapSoplado: 0,
      scrapEtiquetado: 0,
      scrapLlenado: 0,
      scrapHorno: 0,
      desperdicioEtiquetas: 0,
      desperdicioTapas: 0,
      desperdicioSifones: 0,
      desperdicioTermo: 0,
      hourlyProduction: createDefaultHourlyProduction(defaultTurno, today),
      downtimes: DOWNTIME_CATEGORIES.flatMap(cat => 
        cat.reasons.map(reason => ({
          category: cat.name,
          reason,
          minutes: Array(8).fill(0),
          totalMinutes: 0,
        }))
      ),
    };
  };

  let initialHourlyProduction = initialData?.hourlyProduction || (initialData ? createDefaultHourlyProduction(initialData.turno, initialData.fecha) : undefined);
  if (initialHourlyProduction && initialData?.origin === 'historical') {
    const needsFix = initialHourlyProduction.some(hp => hp.botMin > 0 && hp.marcador === 0);
    const needsMinProdFix = initialHourlyProduction.some(hp => hp.botMin > 0 && (!hp.minProd || hp.minProd === 0));
    
    if (needsFix || needsMinProdFix) {
      let currentMarcador = initialData.contInicial || 0;
      const velocidad = initialData.velocidad || 0;
      initialHourlyProduction = initialHourlyProduction.map(hp => {
        if (hp.botMin > 0) {
          currentMarcador += hp.botMin;
        }
        return { 
          ...hp, 
          marcador: needsFix ? currentMarcador : hp.marcador,
          minProd: (needsMinProdFix && hp.botMin > 0 && velocidad) ? Math.round((hp.botMin / velocidad) * 10) / 10 : hp.minProd
        };
      });
    }
  }

  const { register, control, handleSubmit, watch, setValue, getValues, trigger, reset, formState: { errors, isDirty } } = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      reports: initialData ? [{
        ...initialData,
        resetParcial: initialData.id ? (initialData.resetParcial ?? false) : false,
        scrapSoplado: initialData.scrapSoplado || 0,
        scrapEtiquetado: initialData.scrapEtiquetado || 0,
        scrapLlenado: initialData.scrapLlenado || 0,
        scrapHorno: initialData.scrapHorno || 0,
        desperdicioEtiquetas: initialData.desperdicioEtiquetas || 0,
        desperdicioTapas: initialData.desperdicioTapas || 0,
        desperdicioSifones: initialData.desperdicioSifones || 0,
        desperdicioTermo: initialData.desperdicioTermo || 0,
        hourlyProduction: initialHourlyProduction,
        downtimes: DOWNTIME_CATEGORIES.flatMap(cat => 
          cat.reasons.map(reason => {
            let existing = initialData.downtimes?.find(d => d.reason === reason);
            
            // Backwards compatibility for split reasons
            if (!existing && initialData.downtimes) {
              if (reason === 'REFRIGERIO' || reason === 'INICIO Y FIN DE TURNO') {
                const oldCombined = initialData.downtimes.find(d => d.reason === 'REFRIGERIO/ INICIO Y FIN DE TURNO');
                if (oldCombined && reason === 'REFRIGERIO') {
                  existing = oldCombined;
                }
              }
              if (reason === 'CAMBIO DE SABOR' || reason === 'CAMBIO DE FORMATO') {
                const oldCombined = initialData.downtimes.find(d => d.reason === 'CAMBIO DE SABOR/ FORMATO');
                if (oldCombined && reason === 'CAMBIO DE SABOR') {
                  existing = oldCombined;
                }
              }
            }

            const expectedHours = getShiftHours(initialData.turno || TURNOS[0], initialData.fecha || new Date().toISOString().split('T')[0]);
            const existingMinutes = existing?.minutes || [];
            const minutes = Array(expectedHours.length).fill('').map((_, i) => existingMinutes[i] !== undefined ? existingMinutes[i] : '');

            return {
              category: cat.name,
              reason,
              minutes,
              totalMinutes: existing?.totalMinutes || 0
            };
          })
        ),
      }] : Array(3).fill(null).map((_, i) => createDefaultReport(i))
    }
  });

  // Persistencia del formulario
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  useEffect(() => {
    const draftKey = initialData ? `production_report_draft_${initialData.id}` : 'production_report_draft';
    const savedData = localStorage.getItem(draftKey);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (parsed.reports && Array.isArray(parsed.reports)) {
          reset(parsed);
        }
      } catch (e) {
        console.error("Error al cargar borrador:", e);
      }
    }
    setIsDraftLoaded(true);
  }, [reset, initialData]);

  const watchedReports = watch('reports');

  // Sincronizar Horas según Turno y Fecha
  useEffect(() => {
    if (!watchedReports) return;

    watchedReports.forEach((report, index) => {
      const expectedHours = getShiftHours(report.turno, report.fecha);
      if (report.hourlyProduction) {
        report.hourlyProduction.forEach((row, hourIndex) => {
          if (row.hora !== expectedHours[hourIndex]) {
            setValue(`reports.${index}.hourlyProduction.${hourIndex}.hora`, expectedHours[hourIndex]);
          }
        });
      }
    });
  }, [watchedReports, setValue]);

  const watchedReportsRef = useRef(watchedReports);
  useEffect(() => {
    watchedReportsRef.current = watchedReports;
  }, [watchedReports]);

  useEffect(() => {
    if (!isDraftLoaded) return;
    
    const draftKey = initialData ? `production_report_draft_${initialData.id}` : 'production_report_draft';
    
    // Save to localStorage immediately on change (debounced 1s)
    const localTimeout = setTimeout(() => {
      if (watchedReports && watchedReports.length > 0) {
        localStorage.setItem(draftKey, JSON.stringify({ reports: watchedReports }));
      }
    }, 1000);

    return () => clearTimeout(localTimeout);
  }, [watchedReports, initialData, isDraftLoaded]);

  // Save on unmount to ensure no data is lost
  useEffect(() => {
    return () => {
      if (isDraftLoaded) {
        const draftKey = initialData ? `production_report_draft_${initialData.id}` : 'production_report_draft';
        const currentData = getValues('reports');
        if (currentData && currentData.length > 0) {
          localStorage.setItem(draftKey, JSON.stringify({ reports: currentData }));
        }
      }
    };
  }, [initialData, isDraftLoaded, getValues]);

  // Sync to live_production
  useEffect(() => {
    if (!isDraftLoaded) return;

    const syncToLive = async () => {
      const currentReports = getValues('reports');
      if (currentReports && currentReports.length > 0) {
        try {
          const batch = writeBatch(db);
          currentReports.forEach(report => {
            if (report.linea) {
              const docRef = doc(db, 'live_production', `linea_${report.linea}`);
              // Clean undefined values for Firestore
              const cleanReport = JSON.parse(JSON.stringify(report));
              batch.set(docRef, { 
                ...cleanReport, 
                updatedAt: new Date().toISOString(),
                type: 'production'
              });
            }
          });
          await batch.commit();
        } catch (e) {
          console.error("Error syncing live data:", e);
        }
      }
    };

    // Sync immediately on change (debounced 5s to avoid too many writes)
    const syncTimeout = setTimeout(syncToLive, 5000);

    return () => clearTimeout(syncTimeout);
  }, [watchedReports, isDraftLoaded, getValues, initialData]);

  // Periodic sync as fallback
  useEffect(() => {
    if (!isDraftLoaded) return;

    const syncToLive = async () => {
      const currentReports = getValues('reports');
      if (currentReports && currentReports.length > 0) {
        try {
          const batch = writeBatch(db);
          currentReports.forEach(report => {
            if (report.linea) {
              const docRef = doc(db, 'live_production', `linea_${report.linea}`);
              // Clean undefined values for Firestore
              const cleanReport = JSON.parse(JSON.stringify(report));
              batch.set(docRef, { 
                ...cleanReport, 
                updatedAt: new Date().toISOString(),
                type: 'production'
              });
            }
          });
          await batch.commit();
        } catch (e) {
          console.error("Error syncing live data:", e);
        }
      }
    };

    const intervalId = setInterval(syncToLive, 60000); // 1 minute fallback
    return () => clearInterval(intervalId);
  }, [isDraftLoaded, getValues]);

  const { fields: reportFields } = useFieldArray({
    control,
    name: "reports",
  });

  // Observar valores para cálculos automáticos
  const reports = useWatch({ control, name: 'reports' }) || [];
  const lastCalculated = useRef<Record<string, any>>({});
  const lastFlavorKeys = useRef<Record<number, string>>({});

  const parseValue = (val: any): number => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    const str = val.toString().trim();
    if (!str) return 0;
    // Si es string, quitar puntos de miles y cambiar coma por punto decimal
    const clean = str.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  };

  // Efecto para calcular Velocidad automáticamente
  const lastLineaTamano = useRef<Record<string, string>>({});
  
  useEffect(() => {
    if (!isDraftLoaded) return;
    reports?.forEach((report, index) => {
      if (report.linea && report.tamano) {
        const vel = config?.velocidadMatrix?.[report.linea]?.[report.tamano] || 0;
        const currentKey = `${report.linea}-${report.tamano}`;
        const previousKey = lastLineaTamano.current[index];
        
        if (previousKey === undefined) {
          // Primera carga
          lastLineaTamano.current[index] = currentKey;
          // Si no tiene velocidad (ej. nuevo), se la asignamos
          if (!report.velocidad && vel > 0) {
            setValue(`reports.${index}.velocidad`, vel, { shouldValidate: true });
          }
        } else if (previousKey !== currentKey) {
          // Cambió la línea o tamaño
          lastLineaTamano.current[index] = currentKey;
          if (vel > 0) {
            setValue(`reports.${index}.velocidad`, vel, { shouldValidate: true });
          }
        }
      }
    });
  }, [reports, setValue, isDraftLoaded, config]);

  // Efecto para calcular Tiempo Bruto automáticamente
  useEffect(() => {
    if (!isDraftLoaded) return;
    reports?.forEach((report, index) => {
      if (report.entraTurno && report.saleTurno) {
        const bruto = calculateBruto(report.entraTurno, report.saleTurno);
        if (report.tiempoTurno !== bruto) {
          setValue(`reports.${index}.tiempoTurno`, bruto, { shouldValidate: true });
        }
      }
    });
  }, [reports, setValue, isDraftLoaded]);

  // Efecto para obtener el parcial anterior y jarabe inicial
  useEffect(() => {
    if (!isDraftLoaded) return;
    reports?.forEach(async (report, index) => {
      if (report.linea && report.sabor && report.tamano) {
        // Si estamos editando un reporte existente (initialData) y es el primer tab,
        // no sobrescribimos el parcialAnterior si el sabor/tamaño es el mismo que el original.
        if (initialData && index === 0 && 
            report.sabor === initialData.sabor && 
            Number(report.tamano) === Number(initialData.tamano) &&
            report.linea === initialData.linea) {
          return;
        }

        // Si el usuario marcó reiniciar, forzamos a 0 y no buscamos en la DB
        if (report.resetParcial) {
          if (report.parcialAnterior !== 0) {
            setValue(`reports.${index}.parcialAnterior`, 0, { shouldValidate: true });
          }
          return;
        }

        const key = `parcial-${report.linea}-${report.sabor}-${report.tamano}`;
        const isNewFlavor = lastFlavorKeys.current[index] !== key;
        lastFlavorKeys.current[index] = key;
        
        if (lastCalculated.current[key] === undefined) {
          lastCalculated.current[key] = 'fetching';
          try {
            const q = query(
              collection(db, 'production_reports'),
              where('linea', '==', report.linea),
              orderBy('createdAt', 'desc'),
              limit(1)
            );
            const snapshot = await getDocs(q);
            let parcialAnterior = 0;
            let jarabeInicial = 0;
            if (!snapshot.empty) {
              const lastReport = snapshot.docs[0].data();
              if (lastReport.sabor === report.sabor && Number(lastReport.tamano) === Number(report.tamano)) {
                parcialAnterior = lastReport.parcialActual || 0;
                jarabeInicial = lastReport.jarabeFinal || 0;
              }
            }
            setValue(`reports.${index}.parcialAnterior`, parcialAnterior, { shouldValidate: true });
            setValue(`reports.${index}.jarabeInicial`, jarabeInicial, { shouldValidate: true });
            lastCalculated.current[key] = { parcialAnterior, jarabeInicial };
          } catch (error) {
            console.error("Error fetching parcial anterior:", error);
            // Fallback if index doesn't exist
            try {
              const fallbackQ = query(
                collection(db, 'production_reports'),
                orderBy('createdAt', 'desc'),
                limit(300)
              );
              const fallbackSnapshot = await getDocs(fallbackQ);
              const matchingReport = fallbackSnapshot.docs
                .map(doc => doc.data())
                .find(data => data.linea === report.linea);
              
              let parcialAnterior = 0;
              let jarabeInicial = 0;
              if (matchingReport && matchingReport.sabor === report.sabor && Number(matchingReport.tamano) === Number(report.tamano)) {
                parcialAnterior = matchingReport.parcialActual || 0;
                jarabeInicial = matchingReport.jarabeFinal || 0;
              }
              setValue(`reports.${index}.parcialAnterior`, parcialAnterior, { shouldValidate: true });
              setValue(`reports.${index}.jarabeInicial`, jarabeInicial, { shouldValidate: true });
              lastCalculated.current[key] = { parcialAnterior, jarabeInicial };
            } catch (fallbackError) {
              console.error("Fallback error:", fallbackError);
              lastCalculated.current[key] = { parcialAnterior: 0, jarabeInicial: 0 };
            }
          }
        } else if (lastCalculated.current[key] !== 'fetching') {
          // If it's already cached, we still need to update the form because the user might have switched back from another flavor
          const cached = lastCalculated.current[key];
          if (isNewFlavor && report.parcialAnterior !== cached.parcialAnterior) {
            setValue(`reports.${index}.parcialAnterior`, cached.parcialAnterior, { shouldValidate: true });
          }
          // Only auto-update jarabeInicial if the flavor actually changed.
          // This prevents overwriting the user's manual input when they type in the jarabeInicial field.
          if (isNewFlavor && report.jarabeInicial !== cached.jarabeInicial) {
            setValue(`reports.${index}.jarabeInicial`, cached.jarabeInicial, { shouldValidate: true });
          }
        }
      }
    });
  }, [reports, setValue, isDraftLoaded]);

  // Efecto para actualizar horas según el turno y el día
  useEffect(() => {
    if (!isDraftLoaded || !reports) return;
    
    reports.forEach((report, index) => {
      const dateStr = report.fecha;
      const turno = report.turno;
      if (!dateStr || !turno) return;

      const shiftDateKey = `${dateStr}_${turno}`;
      const prevShiftDateKey = lastShiftDate.current[index];
      
      // Si es la primera vez que cargamos este reporte (ej: editando o cargando borrador),
      // guardamos la llave actual y no reseteamos nada para preservar los datos existentes.
      if (prevShiftDateKey === undefined) {
        lastShiftDate.current[index] = shiftDateKey;
        return;
      }

      // Si la llave no ha cambiado, no hacemos nada
      if (prevShiftDateKey === shiftDateKey) return;

      // Si el turno o fecha cambió realmente, actualizamos la llave y reseteamos horas/paradas
      lastShiftDate.current[index] = shiftDateKey;

      const horas = getShiftHours(turno, dateStr);
      const currentHoras = report.hourlyProduction?.map(h => h.hora) || [];
      
      // Solo resetear si la estructura de horas cambió realmente
      if (JSON.stringify(horas) !== JSON.stringify(currentHoras)) {
        const existingData = report.hourlyProduction || [];
        const newHourlyProduction = horas.map((hora, hIdx) => {
          const existingHour = existingData[hIdx];
          return {
            hora,
            marcador: existingHour ? existingHour.marcador : 0,
            botMin: existingHour ? existingHour.botMin : 0,
            minProd: existingHour ? (existingHour.minProd || 60) : 60,
          };
        });
        setValue(`reports.${index}.hourlyProduction`, newHourlyProduction);
        
        // También inicializar minutos de paradas para las nuevas horas,
        // intentando preservar la data existente si es posible
        report.downtimes?.forEach((d, dIndex) => {
          const existingMinutes = d.minutes || [];
          const newMinutes = horas.map((_, hIdx) => {
            return existingMinutes[hIdx] !== undefined ? existingMinutes[hIdx] : '';
          });
          setValue(`reports.${index}.downtimes.${dIndex}.minutes`, newMinutes);
        });
      }
    });
  }, [reports, setValue, isDraftLoaded]);

  // Efecto para calcular SIN REGISTRAR y Jarabe
  useEffect(() => {
    if (!isDraftLoaded) return;
    reports?.forEach((report, index) => {
      const hourlyData = report.hourlyProduction || [];
      const contInicial = parseValue(report.contInicial);
      const contFinal = parseValue(report.contFinal);
      const velocidad = parseValue(report.velocidad);
      const jarabeInicial = parseValue(report.jarabeInicial);
      const tamano = parseValue(report.tamano);

      // 1. SIN REGISTRAR
      if (report.downtimes) {
        const sinRegistrarIndex = report.downtimes.findIndex(d => d.reason === 'SIN REGISTRAR');
        if (sinRegistrarIndex !== -1) {
          const minProdArray = hourlyData.map((h, hIndex) => {
            let currentMarcador = parseValue(h.marcador);
            // Si es la última hora y no hay marcador, intentar usar el marcador final
            if (currentMarcador === 0 && hIndex === hourlyData.length - 1 && contFinal > 0) {
              currentMarcador = contFinal;
            }
            
            if (currentMarcador === 0) return 0; // No data entered yet
            const prevMarcador = getPrevMarcador(hourlyData, hIndex, contInicial);
            const botMin = Math.max(0, currentMarcador - prevMarcador);
            return velocidad ? Math.round((botMin / velocidad) * 10) / 10 : 0;
          });

          let totalAvailable = 0;
          let totalMinProd = 0;
          let totalOtherDowntime = 0;
          let hasMarkers = false;

          const hourlyDeficits = hourlyData.map((h, hIndex) => {
            let currentMarcador = parseValue(h.marcador);
            // Si es la última hora y no hay marcador, intentar usar el marcador final
            if (currentMarcador === 0 && hIndex === hourlyData.length - 1 && contFinal > 0) {
              currentMarcador = contFinal;
            }
            
            // Si no hay marcador en esta hora, no calculamos sin registrar aún
            if (currentMarcador === 0) return 0;
            hasMarkers = true;

            const minProd = minProdArray[hIndex] || 0;
            const availableMinutes = getAvailableMinutesInHour(h.hora, report.entraTurno, report.saleTurno);
            
            let sumOtherDowntime = 0;
            report.downtimes?.forEach((d, dIndex) => {
              if (dIndex !== sinRegistrarIndex) {
                const val = d.minutes?.[hIndex];
                sumOtherDowntime += parseValue(val);
              }
            });
            
            totalAvailable += availableMinutes;
            totalMinProd += minProd;
            totalOtherDowntime += sumOtherDowntime;

            return availableMinutes - minProd - sumOtherDowntime;
          });
          
          let newSinRegistrarMinutes = new Array(hourlyData.length).fill('');

          if (hasMarkers) {
            const totalSinRegistrar = Math.round(Math.max(0, totalAvailable - totalMinProd - totalOtherDowntime));
            
            const key = `sinRegistrarTotal-${index}`;
            if (lastCalculated.current[key] !== totalSinRegistrar) {
              setValue(`reports.${index}.downtimes.${sinRegistrarIndex}.minutes`, newSinRegistrarMinutes);
              setValue(`reports.${index}.downtimes.${sinRegistrarIndex}.totalMinutes`, totalSinRegistrar);
              lastCalculated.current[key] = totalSinRegistrar;
            }
          }
        }
      }

      // 2. Jarabe & Botellas
      const botellas = getBotellasTotales(report);
      const litrosTotales = (botellas * tamano) / 1000;
      const saboresSinJarabeCfg = config?.saboresSinJarabe || SABORES_SIN_JARABE;
      const usesSyrup = !saboresSinJarabeCfg.includes(report.sabor || '');
      const jarabeConsumidoCalc = usesSyrup ? litrosTotales / 6 : 0;
      const jarabeFinalCalc = usesSyrup ? Math.max(0, jarabeInicial - jarabeConsumidoCalc) : 0;
      
      const keyConsumido = `jarabeConsumido-${index}`;
      const keyFinal = `jarabeFinal-${index}`;
      
      if (lastCalculated.current[keyConsumido] !== Number(jarabeConsumidoCalc.toFixed(3))) {
        setValue(`reports.${index}.jarabeConsumido`, Number(jarabeConsumidoCalc.toFixed(3)));
        lastCalculated.current[keyConsumido] = Number(jarabeConsumidoCalc.toFixed(3));
      }
      if (lastCalculated.current[keyFinal] !== Number(jarabeFinalCalc.toFixed(3))) {
        setValue(`reports.${index}.jarabeFinal`, Number(jarabeFinalCalc.toFixed(3)));
        lastCalculated.current[keyFinal] = Number(jarabeFinalCalc.toFixed(3));
      }
    });
  }, [reports, setValue, isDraftLoaded]);

  const handleSaveCurrentPart = async () => {
    if (!auth.currentUser) {
      setError("Debes iniciar sesión para guardar.");
      return;
    }

    const currentReport = getValues(`reports.${activeTab}`);
    const fieldsToValidate = Object.keys(currentReport).map(
      key => `reports.${activeTab}.${key}`
    );

    const isValid = await trigger(fieldsToValidate as any);
    
    if (!isValid) {
      console.error("Validation errors for tab", activeTab, ":", errors.reports?.[activeTab]);
      setError("Por favor, completa todos los campos requeridos en este parte.");
      return;
    }

    // Check for time discrepancy
    if (currentReport.entraTurno && currentReport.fecha && currentReport.turno && !skipTimeCheck) {
      const detected = detectTurno(currentReport.entraTurno, currentReport.fecha);
      if (detected !== currentReport.turno) {
        setShowTimeWarningModal(true);
        return;
      }
    }

    // Check for counter discrepancy
    const contInicial = currentReport.contInicial || 0;
    const contFinal = currentReport.contFinal || 0;
    const hourlyData = currentReport.hourlyProduction || [];
    
    // Use the same logic as getBotellasTotales but WITHOUT subtracting botRotas
    let totalFromCounters = 0;
    if (contFinal > 0) {
      totalFromCounters = Math.max(0, contFinal - contInicial);
    } else {
      let maxMarcador = 0;
      for (const h of hourlyData) {
        if ((h.marcador || 0) > maxMarcador) {
          maxMarcador = h.marcador;
        }
      }
      totalFromCounters = Math.max(0, maxMarcador - contInicial);
    }

    const hourlyBotellas = hourlyData.reduce((sum, h) => {
      const prevMarcador = getPrevMarcador(hourlyData, hourlyData.indexOf(h), contInicial);
      return sum + Math.max(0, (h.marcador || 0) - prevMarcador);
    }, 0);

    const isCounterMismatch = Math.abs(totalFromCounters - hourlyBotellas) > 0;
    
    // Only block save or show error if there's a discrepancy
    if (isCounterMismatch) {
        setError("La suma de la producción por hora no coincide con la diferencia entre contador final e inicial.");
        return;
    }

    setSkipTimeCheck(false); // Reset for next time
    setIsSubmitting(true);
    setError(null);
    setSaveSuccess(null);

    try {
      const report = getValues(`reports.${activeTab}`);
      
      const processedHourly = report.hourlyProduction?.map((hour, index) => {
        const prevMarcador = getPrevMarcador(report.hourlyProduction || [], index, report.contInicial || 0);
        const botMin = Math.max(0, hour.marcador - prevMarcador);
        const minProd = report.velocidad ? Math.round((botMin / report.velocidad) * 10) / 10 : 0;
        return {
          ...hour,
          botMin,
          minProd
        };
      });

      const processedDowntimes = report.downtimes?.map(dt => {
        const minutesArray = dt.minutes?.map(m => Number(m) || 0) || [];
        const isSinRegistrar = dt.reason === 'SIN REGISTRAR';
        const totalMinutes = isSinRegistrar
          ? (dt.totalMinutes || 0)
          : minutesArray.reduce((sum, m) => sum + m, 0);
        return {
          category: dt.category || 'Otros',
          reason: dt.reason,
          minutes: minutesArray,
          totalMinutes
        };
      }).filter(dt => dt.totalMinutes > 0) || [];

      const maxMarcador = Math.max(...(report.hourlyProduction?.map(h => h.marcador || 0) || []), report.contInicial || 0);
      const botellas = getBotellasTotales(report);
      
      const botellasPorPack = config?.botellasPorPack?.[report.tamano] || 1;
      const packsPorPaleta = config?.packsPorPaleta?.[report.tamano] || 1;
      const paquetes = Math.floor(botellas / botellasPorPack);
      
      const parcialAnterior = report.parcialAnterior || 0;
      const ajusteParcial = report.ajusteParcial || 0;
      const totalPacks = paquetes + parcialAnterior + ajusteParcial;
      const tickets = Math.floor(totalPacks / packsPorPaleta);
      const parcialActual = totalPacks % packsPorPaleta;

      const paletasDeEsteParte = Math.floor(paquetes / packsPorPaleta);
      const separadoresBase = SEPARADORES_POR_PALETA[report.tamano] || 0;
      const sombrero = Math.floor(paletasDeEsteParte / 2);
      const totalSeparadores = (paletasDeEsteParte * separadoresBase) + sombrero;

      const eficBruta = Math.round(calculateLiveEfficiency(report, botellas)) || 0;

      const co2VolumesCfg = config?.co2Volumes || CO2_VOLUMES;
      const vol = co2VolumesCfg[report.marca]?.[report.sabor || ''] || 0;
      const litrosBebida = (botellas * (report.tamano || 0)) / 1000;
      const co2 = Number(((litrosBebida * vol * 1.9765) / 1000).toFixed(1));

      const reportData = {
        ...report,
        origin: 'manual',
        botellas,
        paquetes,
        tickets,
        parcialActual,
        paletasDeEsteParte,
        totalSeparadores,
        eficBruta,
        co2,
        hourlyProduction: processedHourly,
        downtimes: processedDowntimes,
        authorId: auth.currentUser.uid,
        authorName: auth.currentUser.displayName,
        createdAt: initialData?.createdAt || new Date().toISOString(),
      };

      // Remove undefined values to prevent Firestore errors
      const cleanReportData = JSON.parse(JSON.stringify(reportData));

      if (initialData?.id) {
        await updateDoc(doc(db, 'production_reports', initialData.id), cleanReportData);
        // Limpiar borrador de edición después de guardar exitosamente
        localStorage.removeItem(`production_report_draft_${initialData.id}`);
      } else {
        await addDoc(collection(db, 'production_reports'), cleanReportData);
        // Limpiar borrador después de guardar exitosamente
        localStorage.removeItem('production_report_draft');
        
        // Delete from live_production
        if (report.linea) {
          try {
            await deleteDoc(doc(db, 'live_production', `linea_${report.linea}`));
          } catch (e) {
            console.error("Error deleting live production:", e);
          }
        }
      }
      
      lastCalculated.current = {}; // Reset cache to force refetch of previous partials
      
      if (!initialData) {
        // Clear specific fields as requested by user after successful save of a NEW report
        setValue(`reports.${activeTab}.downtimes`, DOWNTIME_CATEGORIES.flatMap(cat => 
          cat.reasons.map(reason => ({
            category: cat.name,
            reason,
            minutes: Array(8).fill(''),
          }))
        ));
        setValue(`reports.${activeTab}.observaciones`, "");
        setValue(`reports.${activeTab}.scrapSoplado`, 0);
        setValue(`reports.${activeTab}.scrapEtiquetado`, 0);
        setValue(`reports.${activeTab}.scrapLlenado`, 0);
        setValue(`reports.${activeTab}.scrapHorno`, 0);
        setValue(`reports.${activeTab}.desperdicioEtiquetas`, 0);
        setValue(`reports.${activeTab}.desperdicioTapas`, 0);
        setValue(`reports.${activeTab}.desperdicioSifones`, 0);
        setValue(`reports.${activeTab}.desperdicioTermo`, 0);
        setValue(`reports.${activeTab}.botRotas`, 0);
        setValue(`reports.${activeTab}.ajusteParcial`, 0);
        setValue(`reports.${activeTab}.resetParcial`, false);
        
        // Reset hourly production markers
        const currentHourly = getValues(`reports.${activeTab}.hourlyProduction`);
        if (currentHourly) {
          currentHourly.forEach((_, hIdx) => {
            setValue(`reports.${activeTab}.hourlyProduction.${hIdx}.marcador`, 0);
          });
        }
      }

      setSaveSuccess(initialData ? `Parte actualizado correctamente.` : `Parte ${activeTab + 1} guardado correctamente.`);
      setLastSavedReport(reportData);
      setShowSuccessModal(true);
      // setTimeout(() => setSaveSuccess(null), 5000);
      
      // setTimeout(onSuccess, 1500); // Removed to stay on form
    } catch (err) {
      console.error("Error saving report:", err);
      setError("Ocurrió un error al guardar el parte de producción.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-8 pb-20">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>{saveSuccess}</p>
        </div>
      )}

      {/* Tab Bar */}
      {!initialData && (
        <div className="flex border-b border-gray-200">
          {reportFields.map((report, index) => (
            <button
              key={report.id}
              type="button"
              onClick={() => setActiveTab(index)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === index
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Parte {index + 1}
            </button>
          ))}
        </div>
      )}

      {/* Tab Content */}
      {reportFields.map((report, index) => (
        <div key={report.id} className={`${activeTab === index ? 'block' : 'hidden'} grid grid-cols-1 xl:grid-cols-4 gap-6`}>
          <div className="xl:col-span-3 grid grid-cols-1 xl:grid-cols-3 gap-6 auto-rows-min">
            {/* Left: Información General + Contadores */}
          <div className="xl:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Información General</h3>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name={`reports.${index}.supervisor`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Supervisor</label>
                      <select {...field} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                        <option value="">Seleccione...</option>
                        {availableSupervisors.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {errors.reports?.[index]?.supervisor && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.supervisor?.message}</p>}
                    </div>
                  )}
                />
                <Controller
                  name={`reports.${index}.turno`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Turno</label>
                      <select {...field} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                        <option value="">Seleccione...</option>
                        {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      {errors.reports?.[index]?.turno && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.turno?.message}</p>}
                    </div>
                  )}
                />
                <Controller
                  name={`reports.${index}.fecha`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Fecha</label>
                      <input type="date" {...field} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
                      {errors.reports?.[index]?.fecha && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.fecha?.message}</p>}
                    </div>
                  )}
                />
                <Controller
                  name={`reports.${index}.linea`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Línea</label>
                      <select {...field} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                        <option value="">Seleccione...</option>
                        {availableLines.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                      {errors.reports?.[index]?.linea && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.linea?.message}</p>}
                    </div>
                  )}
                />
                <Controller
                  name={`reports.${index}.marca`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Marca</label>
                      <select {...field} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                        <option value="">Seleccione...</option>
                        {availableBrands.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      {errors.reports?.[index]?.marca && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.marca?.message}</p>}
                    </div>
                  )}
                />
                <Controller
                  name={`reports.${index}.tamano`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Calibre</label>
                      <select {...field} onChange={e => field.onChange(Number(e.target.value))} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                        <option value={0}>Seleccione...</option>
                        {getFilteredSizes(reports[index]?.linea).map(t => <option key={t} value={t}>{t} cc</option>)}
                      </select>
                      {errors.reports?.[index]?.tamano && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.tamano?.message}</p>}
                    </div>
                  )}
                />
                <Controller
                  name={`reports.${index}.sabor`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Sabor</label>
                      <select {...field} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                        <option value="">Seleccione...</option>
                        {getFilteredFlavors(reports[index]?.marca, reports[index]?.tamano).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {errors.reports?.[index]?.sabor && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.sabor?.message}</p>}
                    </div>
                  )}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700">Velocidad (bpm)</label>
                  <input type="number" value={reports[index]?.velocidad ?? 0} readOnly className="mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-50 sm:text-sm border p-2 text-gray-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Tiempo Turno (min)</label>
                  <input type="number" value={reports[index]?.tiempoTurno ?? 0} readOnly className="mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-50 sm:text-sm border p-2 text-gray-500" />
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-4">
                  <Controller
                    name={`reports.${index}.entraTurno`}
                    control={control}
                    render={({ field }) => (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Hora Inicio</label>
                        <input type="time" {...field} value={field.value ?? ''} className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm border p-2 ${
                          field.value && reports[index]?.fecha && detectTurno(field.value, reports[index].fecha) !== reports[index].turno
                            ? 'border-orange-500 bg-orange-50 focus:border-orange-500'
                            : 'border-gray-300 focus:border-blue-500'
                        }`} />
                        {errors.reports?.[index]?.entraTurno && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.entraTurno?.message}</p>}
                        {field.value && reports[index]?.fecha && detectTurno(field.value, reports[index].fecha) !== reports[index].turno && (
                          <p className="mt-1 text-xs text-orange-600 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            La hora no coincide con el turno {reports[index].turno}
                          </p>
                        )}
                      </div>
                    )}
                  />
                  <Controller
                    name={`reports.${index}.saleTurno`}
                    control={control}
                    render={({ field }) => (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Hora Final</label>
                        <input type="time" {...field} value={field.value ?? ''} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
                        {errors.reports?.[index]?.saleTurno && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.saleTurno?.message}</p>}
                      </div>
                    )}
                  />
                </div>
                <Controller
                  name={`reports.${index}.planilla`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Nº Planilla</label>
                      <input type="text" {...field} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
                      {errors.reports?.[index]?.planilla && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.planilla?.message}</p>}
                    </div>
                  )}
                />
                <Controller
                  name={`reports.${index}.lote`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Nº Lote</label>
                      <input type="text" {...field} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
                    </div>
                  )}
                />
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Contadores</h3>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name={`reports.${index}.contInicial`}
                  control={control}
                  render={({ field }) => {
                    const displayValue = field.value ? field.value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
                    return (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Cont. Inicial</label>
                        <input 
                          type="text" 
                          value={displayValue}
                          onChange={e => {
                            const rawValue = e.target.value.replace(/\./g, "");
                            const numValue = rawValue === "" ? 0 : Number(rawValue);
                            if (!isNaN(numValue)) {
                              field.onChange(numValue);
                            }
                          }} 
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 font-mono" 
                        />
                        {errors.reports?.[index]?.contInicial && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.contInicial?.message}</p>}
                      </div>
                    );
                  }}
                />
                <Controller
                  name={`reports.${index}.contFinal`}
                  control={control}
                  render={({ field }) => {
                    const displayValue = field.value ? field.value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
                    return (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Cont. Final</label>
                        <input 
                          type="text" 
                          value={displayValue}
                          onChange={e => {
                            const rawValue = e.target.value.replace(/\./g, "");
                            const numValue = rawValue === "" ? 0 : Number(rawValue);
                            if (!isNaN(numValue)) {
                              field.onChange(numValue);
                            }
                          }} 
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 font-mono" 
                        />
                        {errors.reports?.[index]?.contFinal && <p className="text-red-500 text-xs mt-1">{errors.reports?.[index]?.contFinal?.message}</p>}
                      </div>
                    );
                  }}
                />
                <Controller
                  name={`reports.${index}.botRotas`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Bot. Rotas</label>
                      <input type="number" {...field} value={field.value === 0 ? '' : field.value} onChange={e => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
                    </div>
                  )}
                />
                <Controller
                  name={`reports.${index}.jarabeInicial`}
                  control={control}
                  render={({ field }) => (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Jarabe Inicial</label>
                      <input type="number" {...field} value={field.value === 0 ? '' : field.value} onChange={e => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
                    </div>
                  )}
                />
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Resumen de Producción</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Botellas</p>
                  <p className="text-lg font-semibold text-gray-900">{formatNumber(getBotellasTotales(reports[index]))}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Packs</p>
                  <p className="text-lg font-semibold text-gray-900">{formatNumber(Math.floor(getBotellasTotales(reports[index]) / (config?.botellasPorPack?.[reports[index].tamano] || 6)))}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Jarabe Consumido</p>
                  <p className="text-lg font-semibold text-gray-900">{formatNumber(reports[index].jarabeConsumido || 0)} L</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Jarabe Final</p>
                  <p className="text-lg font-semibold text-gray-900">{formatNumber(reports[index].jarabeFinal || 0)} L</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">CO2</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {(() => {
                      const marca = reports[index].marca;
                      const sabor = reports[index].sabor;
                      const co2VolumesCfg = config?.co2Volumes || CO2_VOLUMES;
                      const vol = co2VolumesCfg[marca]?.[sabor] || 0;
                      const botellas = getBotellasTotales(reports[index]);
                      // Fórmula: (Botellas * Tamaño en L) * Volúmenes de CO2 * 1.9765 g/L / 1000 = kg de CO2
                      const litrosBebida = (botellas * (reports[index].tamano || 0)) / 1000;
                      const kgCO2 = (litrosBebida * vol * 1.9765) / 1000;
                      return formatNumber(Number(kgCO2.toFixed(1))) + ' kg';
                    })()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Eficiencia</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {(() => {
                      const actual = getBotellasTotales(reports[index]);
                      const liveEff = calculateLiveEfficiency(reports[index], actual);
                      return liveEff > 0 ? Math.round(liveEff) : '0';
                    })()}%
                  </p>
                </div>
              </div>
            </div>
          </div>
          {/* Middle: Producción por Hora y Paletizado */}
          <div className="xl:col-span-1 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Producción por Hora</h3>
                <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 shadow-sm flex items-center gap-2">
                  <span className="opacity-80">Total Parcial:</span>
                  <span className="text-sm">
                    {formatNumber(getBotellasTotales(reports[index]))} bot
                    <span className="text-blue-300 mx-1.5">|</span>
                    {formatNumber(Math.floor(getBotellasTotales(reports[index]) / (config?.botellasPorPack?.[reports[index].tamano] || 6)))} packs
                  </span>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="grid grid-cols-[65px_1fr_70px_60px] gap-0 text-[10px] font-bold text-gray-500 bg-gray-50 border-b border-gray-200">
                  <span className="p-2 border-r border-gray-200">HORA</span>
                  <span className="p-2 border-r border-gray-200">MARCADOR</span>
                  <span className="p-2 border-r border-gray-200 text-center">BOTS</span>
                  <span className="p-2 text-center">MINS</span>
                </div>
                <div className="divide-y divide-gray-200">
                  {reports[index].hourlyProduction?.map((_, hIndex) => {
                    const currentMarcador = reports[index].hourlyProduction?.[hIndex]?.marcador || 0;
                    const prevMarcador = getPrevMarcador(reports[index].hourlyProduction || [], hIndex, reports[index].contInicial || 0);
                    const botellas = currentMarcador > 0 ? Math.max(0, currentMarcador - prevMarcador) : 0;
                    const minProd = reports[index].velocidad ? Math.round((botellas / (reports[index].velocidad || 1)) * 10) / 10 : 0;
                    return (
                      <div key={reports[index].hourlyProduction?.[hIndex]?.hora ?? hIndex} className="grid grid-cols-[80px_1fr_70px_60px] gap-0 items-center hover:bg-gray-50 transition-colors">
                        <span className="text-xs text-gray-600 font-bold p-2 border-r border-gray-200 bg-gray-50/50 whitespace-nowrap">{reports[index].hourlyProduction?.[hIndex]?.hora}hs</span>
                        <div className="border-r border-gray-200 h-full">
                          <Controller
                            name={`reports.${index}.hourlyProduction.${hIndex}.marcador`}
                            control={control}
                            render={({ field }) => {
                              const displayValue = field.value ? field.value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
                              return (
                                <input 
                                  type="text" 
                                  value={displayValue}
                                  onChange={e => {
                                    const rawValue = e.target.value.replace(/\./g, "");
                                    const numValue = rawValue === "" ? 0 : Number(rawValue);
                                    if (!isNaN(numValue)) {
                                      field.onChange(numValue);
                                    }
                                  }} 
                                  className="w-full h-full border-none focus:ring-2 focus:ring-blue-500 sm:text-sm p-2 text-right font-mono bg-transparent" 
                                />
                              );
                            }}
                          />
                        </div>
                        <span className="text-xs text-gray-900 font-bold text-right p-2 border-r border-gray-200 bg-blue-50/30">{botellas.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}</span>
                        <span className="text-xs text-gray-900 font-bold text-right p-2 bg-green-50/30">{minProd}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Paletizado</h3>
              {(() => {
                const botellasTotales = getBotellasTotales(reports[index]);
                const botellasPorPack = config?.botellasPorPack?.[reports[index].tamano] || 1;
                const packsPorPaleta = config?.packsPorPaleta?.[reports[index].tamano] || 1;
                const packsProducidos = Math.floor(botellasTotales / botellasPorPack);
                const parcialAnterior = reports[index].parcialAnterior || 0;
                const ajusteParcial = reports[index].ajusteParcial || 0;
                const totalPacks = packsProducidos + parcialAnterior + ajusteParcial;
                const tickets = Math.floor(totalPacks / packsPorPaleta);
                const parcialActual = totalPacks % packsPorPaleta;

                const paletasDeEsteParte = Math.floor(packsProducidos / packsPorPaleta);
                const separadoresBase = SEPARADORES_POR_PALETA[reports[index].tamano] || 0;
                const sombrero = Math.floor(paletasDeEsteParte / 2);
                const totalSeparadores = (paletasDeEsteParte * separadoresBase) + sombrero;

                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="block text-sm font-medium text-gray-700">Parcial Anterior</label>
                          <Controller
                            name={`reports.${index}.resetParcial`}
                            control={control}
                            render={({ field }) => (
                              <label className="flex items-center gap-1 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={field.value}
                                  onChange={(e) => field.onChange(e.target.checked)}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3 h-3"
                                />
                                <span className="text-[10px] text-gray-400 group-hover:text-blue-600 transition-colors">Reiniciar</span>
                              </label>
                            )}
                          />
                        </div>
                        <input type="number" value={parcialAnterior} readOnly className="mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-50 sm:text-sm border p-2 text-gray-500" />
                      </div>
                      <Controller
                        name={`reports.${index}.ajusteParcial`}
                        control={control}
                        render={({ field }) => (
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Ajuste Parcial</label>
                            <input type="number" {...field} value={field.value === 0 ? '' : field.value} onChange={e => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
                          </div>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Tickets a Imprimir</label>
                        <div className="mt-1 flex items-center h-10 px-3 bg-blue-50 text-blue-700 font-bold rounded-md border border-blue-100">
                          {tickets}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Parcial Actual</label>
                        <div className="mt-1 flex items-center h-10 px-3 bg-green-50 text-green-700 font-bold rounded-md border border-green-100">
                          {parcialActual}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Paletas (de este parte)</label>
                        <div className="mt-1 flex items-center h-10 px-3 bg-purple-50 text-purple-700 font-bold rounded-md border border-purple-100">
                          {paletasDeEsteParte}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Separadores</label>
                        <div className="mt-1 flex items-center h-10 px-3 bg-orange-50 text-orange-700 font-bold rounded-md border border-orange-100">
                          {totalSeparadores}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Desperdicios</h3>
              <div className="space-y-6">
                {/* Scrap Preformas */}
                <div>
                  <h4 className="text-sm font-bold text-gray-700 mb-3 border-b pb-1">Scrap Preformas</h4>
                  <div className="grid grid-cols-1 gap-4">
                    <Controller
                      name={`reports.${index}.scrapSoplado`}
                      control={control}
                      render={({ field }) => (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Soplado (u.)</label>
                          <input
                            type="number"
                            {...field}
                            value={field.value === 0 ? '' : field.value}
                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                          />
                        </div>
                      )}
                    />
                  </div>
                </div>

                {/* Scrap Botellas */}
                <div>
                  <h4 className="text-sm font-bold text-gray-700 mb-3 border-b pb-1">Scrap Botellas</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Controller
                      name={`reports.${index}.scrapEtiquetado`}
                      control={control}
                      render={({ field }) => (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Etiquetado (u.)</label>
                          <input
                            type="number"
                            {...field}
                            value={field.value === 0 ? '' : field.value}
                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                          />
                        </div>
                      )}
                    />
                    <Controller
                      name={`reports.${index}.scrapLlenado`}
                      control={control}
                      render={({ field }) => (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Llenado (u.)</label>
                          <input
                            type="number"
                            {...field}
                            value={field.value === 0 ? '' : field.value}
                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                          />
                        </div>
                      )}
                    />
                    <Controller
                      name={`reports.${index}.scrapHorno`}
                      control={control}
                      render={({ field }) => (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Horno (u.)</label>
                          <input
                            type="number"
                            {...field}
                            value={field.value === 0 ? '' : field.value}
                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                          />
                        </div>
                      )}
                    />
                  </div>
                </div>

                {/* Otros Insumos */}
                <div>
                  <h4 className="text-sm font-bold text-gray-700 mb-3 border-b pb-1">Otros Insumos</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Controller
                      name={`reports.${index}.desperdicioEtiquetas`}
                      control={control}
                      render={({ field }) => (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Etiquetas (kg)</label>
                          <input
                            type="number"
                            step="0.01"
                            {...field}
                            value={field.value === 0 ? '' : field.value}
                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                          />
                        </div>
                      )}
                    />
                    <Controller
                      name={`reports.${index}.desperdicioTapas`}
                      control={control}
                      render={({ field }) => (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Tapas (kg)</label>
                          <input
                            type="number"
                            step="0.01"
                            {...field}
                            value={field.value === 0 ? '' : field.value}
                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                          />
                        </div>
                      )}
                    />
                    <Controller
                      name={`reports.${index}.desperdicioSifones`}
                      control={control}
                      render={({ field }) => (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Sifones (u.)</label>
                          <input
                            type="number"
                            {...field}
                            value={field.value === 0 ? '' : field.value}
                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                          />
                        </div>
                      )}
                    />
                    <Controller
                      name={`reports.${index}.desperdicioTermo`}
                      control={control}
                      render={({ field }) => (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Film (kg)</label>
                          <input
                            type="number"
                            step="0.01"
                            {...field}
                            value={field.value === 0 ? '' : field.value}
                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                          />
                        </div>
                      )}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Observaciones Operativas */}
          <div className="xl:col-span-3 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Observaciones Operativas</h3>
              <textarea
                {...register(`reports.${index}.observaciones`)}
                rows={4}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-3 border"
                placeholder="Ingrese cualquier observación relevante del turno..."
              />
            </div>
          </div>
          {/* Right: Paradas */}
          <div className="xl:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Paradas</h3>
              
              <div className="sticky top-16 bg-white z-10 grid grid-cols-8 gap-0 mb-2 py-2 border border-gray-200 -mx-4 px-4 rounded-t-lg">
                {reports[index].hourlyProduction?.map((hp, i) => (
                  <div key={i} className={`text-xs font-bold text-gray-700 text-center py-1 ${i > 0 ? 'border-l border-gray-200' : ''}`}>
                    {(hp.hora || String(i + 1)).split(':')[0]}hs
                  </div>
                ))}
              </div>

              <div className="space-y-0 border border-gray-200 rounded-b-lg -mx-4">
                {reports[index].downtimes?.map((downtime, dIndex) => {
                  const isSinRegistrar = downtime.reason === 'SIN REGISTRAR';
                  const total = isSinRegistrar 
                    ? (downtime.totalMinutes || 0)
                    : (downtime.minutes?.reduce((sum, m) => sum + (Number(m) || 0), 0) || 0);
                  
                  return (
                    <div 
                      key={downtime.reason ?? dIndex} 
                      className={`border-t first:border-t-0 border-gray-200 p-2 transition-colors ${
                        isSinRegistrar 
                          ? 'sticky top-[104px] bg-white z-10 shadow-md border-b-2 border-red-100' 
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1 px-2">
                        <p className={`text-xs font-black uppercase tracking-tight ${isSinRegistrar ? 'text-red-700' : 'text-gray-900'}`}>
                          {downtime.reason}
                        </p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isSinRegistrar 
                            ? 'bg-red-100 text-red-700' 
                            : 'text-blue-700 bg-blue-100'
                        }`}>
                          {total} min
                        </span>
                      </div>
                      <div className={`grid grid-cols-8 gap-0 border rounded overflow-hidden shadow-inner ${
                        isSinRegistrar 
                          ? 'border-red-200 bg-red-50/30' 
                          : 'border-gray-200 bg-gray-50'
                      }`}>
                        {downtime.minutes?.map((_, mIndex) => (
                          <div key={`${dIndex}-${mIndex}`} className={`${mIndex > 0 ? (isSinRegistrar ? 'border-l border-red-100' : 'border-l border-gray-200') : ''}`}>
                            <Controller
                              name={`reports.${index}.downtimes.${dIndex}.minutes.${mIndex}`}
                              control={control}
                              render={({ field }) => (
                                <input 
                                  type="number" 
                                  {...field} 
                                  readOnly={isSinRegistrar}
                                  onChange={e => field.onChange(e.target.value)} 
                                  className={`w-full h-9 rounded-none border-none focus:ring-1 focus:ring-blue-500 text-sm p-0 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none bg-transparent transition-colors ${
                                    isSinRegistrar 
                                      ? 'text-red-600 font-black cursor-default' 
                                      : 'hover:bg-white text-gray-900'
                                  }`} 
                                  placeholder={isSinRegistrar ? "0" : "-"} 
                                />
                              )}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Success Modal Overlay */}
      {saveSuccess && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-2xl border border-green-100 flex flex-col items-center gap-6 max-w-md w-full text-center animate-in fade-in zoom-in duration-300">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-green-600" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-900">¡Parte Guardado!</h3>
              <p className="text-gray-600 mt-2 font-medium">{saveSuccess}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 w-full">
              {lastSavedReport && (
                <>
                  <button
                    type="button"
                    onClick={() => printProductionReport(lastSavedReport)}
                    className="flex items-center justify-center gap-3 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-200 active:scale-95"
                  >
                    <Printer className="w-5 h-5" />
                    Imprimir para Expedición
                  </button>
                  <button
                    type="button"
                    onClick={() => printInternalReport(lastSavedReport)}
                    className="flex items-center justify-center gap-3 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg hover:shadow-indigo-200 active:scale-95"
                  >
                    <ClipboardList className="w-5 h-5" />
                    Imprimir Parte Interno (Detallado)
                  </button>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex items-center justify-center gap-2 px-4 py-4 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-all active:scale-95"
                >
                  <X className="w-5 h-5" />
                  Cerrar
                </button>
                {!initialData && reportFields.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextTab = (activeTab + 1) % reportFields.length;
                      setActiveTab(nextTab);
                      setSaveSuccess(null);
                      setLastSavedReport(null);
                    }}
                    className="flex items-center justify-center gap-2 px-4 py-4 bg-indigo-50 text-indigo-700 font-bold rounded-xl hover:bg-indigo-100 transition-all active:scale-95"
                  >
                    <FileText className="w-5 h-5" />
                    Otro Parte
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Time Discrepancy Warning Modal */}
      {showTimeWarningModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center transform animate-in zoom-in-95 duration-300 border-4 border-orange-100">
            <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-10 h-10 text-orange-600" />
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2 font-mono uppercase tracking-tighter">Advertencia de Horario</h3>
            <p className="text-gray-600 mb-6 font-medium">
              El horario de inicio <span className="text-orange-600 font-bold">({getValues(`reports.${activeTab}.entraTurno`)})</span> no coincide con el turno seleccionado <span className="text-orange-600 font-bold">({getValues(`reports.${activeTab}.turno`)})</span>.
            </p>
            <div className="bg-blue-50 p-4 rounded-2xl mb-8 text-left border border-blue-100">
              <p className="text-xs font-bold text-blue-800 uppercase mb-2">Sugerencia:</p>
              <p className="text-sm text-blue-700">
                Se detectó que el horario ingresado corresponde al turno: <span className="font-bold underline">{detectTurno(getValues(`reports.${activeTab}.entraTurno`) || '', getValues(`reports.${activeTab}.fecha`) || '')}</span>
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setShowTimeWarningModal(false)}
                className="w-full px-6 py-4 bg-gray-100 text-gray-700 rounded-2xl font-bold hover:bg-gray-200 transition-all active:scale-95"
              >
                Volver y Corregir
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTimeWarningModal(false);
                  setSkipTimeCheck(true);
                  handleSaveCurrentPart();
                }}
                className="w-full px-6 py-2 text-xs text-orange-600 font-bold hover:underline"
              >
                Ignorar y Guardar de todos modos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Botones de Acción */}
      {!saveSuccess && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg z-20">
          <div className="max-w-full mx-auto flex justify-end gap-4 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              Cancelar
            </button>
            
            <button
              type="button"
              onClick={handleSaveCurrentPart}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Save className="w-4 h-4" />
              )}
              {initialData ? 'Actualizar Parte' : `Guardar Parte ${activeTab + 1}`}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}