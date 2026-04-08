import React, { useState, useEffect, useRef } from 'react';
import { useForm, useFieldArray, Controller, useWatch } from 'react-hook-form';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp, updateDoc, doc, writeBatch, deleteDoc } from 'firebase/firestore';
import { ElaboracionReport, ElaboracionHourlyData } from '../types';
import { Save, X, Plus, Trash2, Beaker, Thermometer, Droplets, Gauge, CheckCircle2, AlertCircle, Clock, Activity } from 'lucide-react';
import { TURNOS, CARBONATION_TABLE, CARBONATION_PRESSURES, CARBONATION_TEMPS, SABORES_SIN_JARABE } from '../constants';
import { useAppConfig } from '../hooks/useAppConfig';
import { getShiftHours } from '../utils';

interface ElaboracionFormValues {
  reports: ElaboracionReport[];
}

interface ElaboracionFormProps {
  onCancel: () => void;
  onSuccess: () => void;
  initialData?: ElaboracionReport;
  key?: string;
}

export const ElaboracionForm: React.FC<ElaboracionFormProps> = ({ onCancel, onSuccess, initialData }) => {
  const { 
    getFilteredFlavors, 
    getFilteredSizes, 
    availableBrands, 
    availableLines, 
    availableChemists,
    availableFlavors
  } = useAppConfig();
  const [activeTab, setActiveTab] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const lastShiftDate = useRef<Record<number, string>>({});

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

  const calculateCarbonation = (pressure: any, temp: any) => {
    const p = parseValue(pressure);
    const t = parseValue(temp);
    
    if (p < 0 || t < 0) return undefined;
    
    // Encontrar el índice de presión más cercano
    let pIndex = 0;
    let minPDiff = Infinity;
    for (let i = 0; i < CARBONATION_PRESSURES.length; i++) {
      const diff = Math.abs(CARBONATION_PRESSURES[i] - p);
      if (diff < minPDiff) {
        minPDiff = diff;
        pIndex = i;
      }
    }

    // Encontrar el índice de temperatura más cercano
    let tIndex = 0;
    let minTDiff = Infinity;
    for (let i = 0; i < CARBONATION_TEMPS.length; i++) {
      const diff = Math.abs(CARBONATION_TEMPS[i] - t);
      if (diff < minTDiff) {
        minTDiff = diff;
        tIndex = i;
      }
    }

    return CARBONATION_TABLE[tIndex][pIndex];
  };

  const createDefaultHourlyData = (turno: string = TURNOS[0], fecha: string = new Date().toISOString().split('T')[0]): ElaboracionHourlyData[] => {
    const hours = getShiftHours(turno, fecha);
    return hours.map(h => ({
      hora: h,
      loteElaboracion: '',
      tanque: '',
      presion: undefined,
      temp: undefined,
      volBot: undefined,
      volBotCorregido: undefined,
      brixBot: undefined,
      brixPatron: undefined,
      brixBotCorregido: 0,
      acidezPatron: undefined,
      phBebida: undefined,
      brixJarabe: undefined,
      codif: 'OK',
      cloro: 'OK',
      organoleptico: 'OK',
      micro: 'OK',
    }));
  };

  const createDefaultReport = (): ElaboracionReport => {
    const today = new Date().toISOString().split('T')[0];
    const defaultTurno = TURNOS[0];
    return {
      fecha: today,
      turno: defaultTurno,
      planilla: '',
      quimico: '',
      lote: '',
      linea: availableLines[0] || '',
      marca: availableBrands[0] || '',
      sabor: availableFlavors[0] || '',
      tamano: availableLines.length > 0 ? (getFilteredSizes(availableLines[0])[0] || 500) : 500,
      horaInicio: '',
      horaFin: '',
      contInicial: undefined,
      contFinal: undefined,
      botellasProduccion: 0,
      jarabeInicial: undefined,
      jarabeFinal: undefined,
      jarabeConsumido: 0,
      jarabeTeorico: 0,
      jarabeDesperdicio: 0,
      jarabeDesperdicioPorcentaje: 0,
      co2Inicial: undefined,
      co2Final: undefined,
      co2Recarga: undefined,
      co2Consumido: 0,
      hourlyData: createDefaultHourlyData(defaultTurno, today),
      createdAt: new Date().toISOString(),
      authorId: '',
    };
  };

  const detectTurno = (timeStr: string, dateStr: string): string => {
    if (!timeStr || !dateStr) return '';
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    const timeInMinutes = hours * 60 + (isNaN(minutes) ? 0 : minutes);
    
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
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

  const { register, control, handleSubmit, watch, reset, setValue, getValues, formState: { isDirty } } = useForm<ElaboracionFormValues>({
    defaultValues: {
      reports: initialData ? [{
        ...initialData,
        hourlyData: initialData.hourlyData.map(row => ({
          ...row,
          phBebida: row.phBebida || (row as any).ph,
          acidezPatron: row.acidezPatron || (row as any).acidez,
        }))
      }] : Array(3).fill(null).map(() => createDefaultReport())
    }
  });

  const { fields } = useFieldArray({
    control,
    name: "reports"
  });

  const watchedReports = useWatch({
    control,
    name: 'reports'
  });
  
  // Cargar borrador al montar
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  useEffect(() => {
    const draftKey = initialData ? `elaboracion_report_draft_${initialData.id}` : 'elaboracion_report_draft';
    const savedData = localStorage.getItem(draftKey);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (parsed.reports && Array.isArray(parsed.reports)) {
          reset(parsed);
        }
      } catch (e) {
        console.error("Error al cargar borrador de elaboración:", e);
      }
    }
    setIsDraftLoaded(true);
  }, [reset, initialData]);

  // Guardar borrador al cambiar
  const watchedReportsRef = useRef(watchedReports);
  useEffect(() => {
    watchedReportsRef.current = watchedReports;
  }, [watchedReports]);

  useEffect(() => {
    if (!isDraftLoaded) return;
    
    const draftKey = initialData ? `elaboracion_report_draft_${initialData.id}` : 'elaboracion_report_draft';
    
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
        const draftKey = initialData ? `elaboracion_report_draft_${initialData.id}` : 'elaboracion_report_draft';
        const currentData = getValues('reports');
        if (currentData && currentData.length > 0) {
          localStorage.setItem(draftKey, JSON.stringify({ reports: currentData }));
        }
      }
    };
  }, [initialData, isDraftLoaded, getValues]);

  // Sync to live_production every 3 minutes
  useEffect(() => {
    if (initialData || !isDraftLoaded) return;

    const syncToLive = async () => {
      const currentReports = watchedReportsRef.current;
      if (currentReports && currentReports.length > 0) {
        try {
          const batch = writeBatch(db);
          currentReports.forEach(report => {
            if (report.linea) {
              const docRef = doc(db, 'live_production', `elaboracion_linea_${report.linea}`);
              batch.set(docRef, { 
                ...report, 
                updatedAt: new Date().toISOString(),
                type: 'elaboracion'
              });
            }
          });
          await batch.commit();
        } catch (e) {
          console.error("Error syncing live data:", e);
        }
      }
    };

    // Sync immediately once on mount/load
    syncToLive();

    const intervalId = setInterval(syncToLive, 180000); // 3 minutes interval
    return () => clearInterval(intervalId);
  }, [initialData, isDraftLoaded]);
  
  // Efecto consolidado para actualizaciones automáticas (Cálculos y Calidad)
  useEffect(() => {
    if (!isDraftLoaded || !watchedReports) return;

    watchedReports.forEach((report, index) => {
      let needsUpdate = false;

      // 1. Cálculos de Producción y Consumos
      const contFinal = parseValue(report.contFinal);
      const contInicial = parseValue(report.contInicial);
      const jarabeInicial = parseValue(report.jarabeInicial);
      const jarabeFinal = parseValue(report.jarabeFinal);
      const co2Inicial = parseValue(report.co2Inicial);
      const co2Recarga = parseValue(report.co2Recarga);
      const co2Final = parseValue(report.co2Final);

      const botellas = Math.max(0, contFinal - contInicial);
      const usesSyrup = !SABORES_SIN_JARABE.includes(report.sabor || '');
      const teorico = usesSyrup ? Number(((botellas * (report.tamano || 0)) / 6000).toFixed(2)) : 0;
      const consumido = usesSyrup ? Number((jarabeInicial - jarabeFinal).toFixed(2)) : 0;
      const desperdicio = Number((consumido - teorico).toFixed(2));
      const desperdicioPorc = teorico > 0 ? Number(((desperdicio / teorico) * 100).toFixed(2)) : 0;

      if (report.botellasProduccion !== botellas) {
        setValue(`reports.${index}.botellasProduccion`, botellas);
      }
      if (report.jarabeConsumido !== consumido) {
        setValue(`reports.${index}.jarabeConsumido`, consumido);
      }
      if (report.jarabeTeorico !== teorico) {
        setValue(`reports.${index}.jarabeTeorico`, teorico);
      }
      if (report.jarabeDesperdicio !== desperdicio) {
        setValue(`reports.${index}.jarabeDesperdicio`, desperdicio);
      }
      if (report.jarabeDesperdicioPorcentaje !== desperdicioPorc) {
        setValue(`reports.${index}.jarabeDesperdicioPorcentaje`, desperdicioPorc);
      }

      const co2Cons = Number((co2Inicial - co2Final + co2Recarga).toFixed(3));
      if (report.co2Consumido !== co2Cons) {
        setValue(`reports.${index}.co2Consumido`, co2Cons);
      }

      // 2. Sincronizar Horas según Turno y Fecha
      const dateStr = report.fecha;
      const turno = report.turno;
      if (dateStr && turno) {
        const shiftDateKey = `${dateStr}_${turno}`;
        const prevShiftDateKey = lastShiftDate.current[index];
        
        if (prevShiftDateKey === undefined) {
          console.log(`[ElaboracionForm] Index ${index}: Initial load, key=${shiftDateKey}`);
          lastShiftDate.current[index] = shiftDateKey;
        } else if (prevShiftDateKey !== shiftDateKey) {
          console.log(`[ElaboracionForm] Index ${index}: Shift/Date changed from ${prevShiftDateKey} to ${shiftDateKey}`);
          lastShiftDate.current[index] = shiftDateKey;
          
          const horas = getShiftHours(turno, dateStr);
          const currentHoras = report.hourlyData?.map(h => h.hora) || [];
          
          if (JSON.stringify(horas) !== JSON.stringify(currentHoras)) {
            const newHourlyData = createDefaultHourlyData(turno, dateStr);
            setValue(`reports.${index}.hourlyData`, newHourlyData);
          }
        }
      }

      // 3. Cálculos de Calidad por Hora
      if (report.hourlyData) {
        report.hourlyData.forEach((row, hourIndex) => {
          // Carbonatación
          const hasP = row.presion !== undefined && (row.presion as any) !== '';
          const hasT = row.temp !== undefined && (row.temp as any) !== '';
          
          if (hasP && hasT) {
            const theoreticalVol = calculateCarbonation(row.presion, row.temp);
            if (row.volBot !== theoreticalVol) {
              setValue(`reports.${index}.hourlyData.${hourIndex}.volBot`, theoreticalVol);
            }
          }

          // Brix Corregido
          const hasBrixBot = row.brixBot !== undefined && (row.brixBot as any) !== '';
          const hasBrixPat = row.brixPatron !== undefined && (row.brixPatron as any) !== '';
          
          if (hasBrixBot || hasBrixPat) {
            const bBot = parseValue(row.brixBot);
            const bPat = parseValue(row.brixPatron);
            const diff = Number((bPat - bBot).toFixed(2));
            if (row.brixBotCorregido !== diff) {
              setValue(`reports.${index}.hourlyData.${hourIndex}.brixBotCorregido`, diff);
            }
          }
        });
      }
    });
  }, [watchedReports, setValue]);

  const handleSaveCurrentPart = async () => {
    if (!auth.currentUser) return;
    
    const currentReport = getValues(`reports.${activeTab}`);
    
    // Validación mínima
    if (!currentReport.planilla && !currentReport.quimico && !currentReport.lote) {
      setError("Debe completar al menos un campo identificador (Planilla, Químico o Lote) para este parte.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSaveSuccess(null);

    try {
      // Sanitizar datos: Convertir strings con separadores a números reales
      const sanitizedReport = {
        ...currentReport,
        contInicial: parseValue(currentReport.contInicial),
        contFinal: parseValue(currentReport.contFinal),
        jarabeInicial: parseValue(currentReport.jarabeInicial),
        jarabeFinal: parseValue(currentReport.jarabeFinal),
        co2Inicial: parseValue(currentReport.co2Inicial),
        co2Recarga: parseValue(currentReport.co2Recarga),
        co2Final: parseValue(currentReport.co2Final),
        hourlyData: currentReport.hourlyData.map(row => ({
          ...row,
          presion: parseValue(row.presion),
          temp: parseValue(row.temp),
          volBot: parseValue(row.volBot),
          volBotCorregido: parseValue(row.volBotCorregido),
          brixBot: parseValue(row.brixBot),
          brixPatron: parseValue(row.brixPatron),
          brixBotCorregido: parseValue(row.brixBotCorregido),
          brixJarabe: parseValue(row.brixJarabe),
          phBebida: parseValue(row.phBebida),
          acidezPatron: parseValue(row.acidezPatron),
        }))
      };

      // Validación de Jarabe
      const usaJarabe = !SABORES_SIN_JARABE.includes(sanitizedReport.sabor);
      if (usaJarabe) {
        if (sanitizedReport.jarabeInicial === 0 && sanitizedReport.jarabeFinal === 0) {
          setError(`El sabor ${sanitizedReport.sabor} requiere completar el control de jarabe.`);
          setIsSubmitting(false);
          return;
        }
      }

      const reportData = {
        ...sanitizedReport,
        authorId: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || 'Anónimo',
        createdAt: initialData ? currentReport.createdAt : new Date().toISOString(),
      };

      if (initialData?.id) {
        await updateDoc(doc(db, 'elaboracion_reports', initialData.id), reportData);
        localStorage.removeItem(`elaboracion_report_draft_${initialData.id}`);
      } else {
        await addDoc(collection(db, 'elaboracion_reports'), reportData);
        // No borramos todo el borrador, solo notificamos éxito
      }
      
      // Delete from live_production
      if (currentReport.linea) {
        try {
          await deleteDoc(doc(db, 'live_production', `elaboracion_linea_${currentReport.linea}`));
        } catch (e) {
          console.error("Error deleting live production:", e);
        }
      }
      
      setSaveSuccess(initialData ? `Parte actualizado correctamente.` : `Parte ${activeTab + 1} guardado correctamente.`);
      
      // Reset form fields for the current tab if it's a new report
      if (!initialData) {
        setValue(`reports.${activeTab}.contInicial`, undefined);
        setValue(`reports.${activeTab}.contFinal`, undefined);
        setValue(`reports.${activeTab}.jarabeInicial`, undefined);
        setValue(`reports.${activeTab}.jarabeFinal`, undefined);
        setValue(`reports.${activeTab}.co2Inicial`, undefined);
        setValue(`reports.${activeTab}.co2Recarga`, undefined);
        setValue(`reports.${activeTab}.co2Final`, undefined);
        setValue(`reports.${activeTab}.horaInicio`, '');
        setValue(`reports.${activeTab}.horaFin`, '');
        setValue(`reports.${activeTab}.planilla`, '');
        setValue(`reports.${activeTab}.lote`, '');
        setValue(`reports.${activeTab}.hourlyData`, createDefaultHourlyData());
        
        // Clear draft
        localStorage.removeItem('elaboracion_report_draft');
      }

      setTimeout(() => setSaveSuccess(null), 3000);
      
      setTimeout(onSuccess, 1500);
    } catch (err) {
      console.error("Error saving report:", err);
      setError("Error al guardar el reporte. Por favor, intente de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-8 pb-20">
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md sticky top-4 z-30 shadow-md">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}
      
      {saveSuccess && (
        <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded-md sticky top-4 z-30 shadow-md">
          <div className="flex items-center">
            <CheckCircle2 className="h-5 w-5 text-green-400 mr-2" />
            <p className="text-sm text-green-700">{saveSuccess}</p>
          </div>
        </div>
      )}

      {/* Tabs para múltiples reportes */}
      {!initialData && (
        <div className="flex gap-2 p-1 bg-gray-100 rounded-lg w-fit">
          {fields.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActiveTab(index)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === index 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
              }`}
            >
              Reporte {index + 1}
              {watchedReports[index].planilla && ` - ${watchedReports[index].planilla}`}
            </button>
          ))}
        </div>
      )}

      {fields.map((field, reportIndex) => (
        <div key={field.id} className={activeTab === reportIndex ? 'block' : 'hidden'}>
          {/* Datos Generales */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Beaker className="w-5 h-5 text-blue-600" />
              Información General de Elaboración
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Fecha</label>
                <input type="date" {...register(`reports.${reportIndex}.fecha`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Turno</label>
                <select {...register(`reports.${reportIndex}.turno`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                  {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Línea</label>
                <select {...register(`reports.${reportIndex}.linea`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                  {availableLines.map(l => <option key={l} value={l}>Línea {l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Químico / Operador</label>
                <select {...register(`reports.${reportIndex}.quimico`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                  <option value="">Seleccione...</option>
                  {availableChemists.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Marca</label>
                <select {...register(`reports.${reportIndex}.marca`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                  {availableBrands.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Sabor</label>
                <select {...register(`reports.${reportIndex}.sabor`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                  {getFilteredFlavors(watchedReports[reportIndex].marca).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Lote Envasado</label>
                <input type="text" {...register(`reports.${reportIndex}.lote`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Calibre (cc)</label>
                <select {...register(`reports.${reportIndex}.tamano`, { valueAsNumber: true })} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2">
                  {getFilteredSizes(watchedReports[reportIndex].linea).map(t => <option key={t} value={t}>{t} cc</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Planilla N°</label>
                <input type="text" {...register(`reports.${reportIndex}.planilla`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Hora Inicio</label>
                <input type="time" {...register(`reports.${reportIndex}.horaInicio`)} className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 sm:text-sm border p-2 ${
                  watchedReports[reportIndex].horaInicio && watchedReports[reportIndex].fecha && detectTurno(watchedReports[reportIndex].horaInicio, watchedReports[reportIndex].fecha) !== watchedReports[reportIndex].turno
                    ? 'border-orange-500 bg-orange-50 focus:border-orange-500'
                    : 'border-gray-300 focus:border-blue-500'
                }`} />
                {watchedReports[reportIndex].horaInicio && watchedReports[reportIndex].fecha && detectTurno(watchedReports[reportIndex].horaInicio, watchedReports[reportIndex].fecha) !== watchedReports[reportIndex].turno && (
                  <p className="mt-1 text-xs text-orange-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    La hora no coincide con el turno {watchedReports[reportIndex].turno}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Hora Fin</label>
                <input type="time" {...register(`reports.${reportIndex}.horaFin`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" />
              </div>
            </div>
          </div>

          {/* Control de Botellas e Insumos */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-600" />
                Control de Botellas
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Cont. Inicial</label>
                  <input type="text" {...register(`reports.${reportIndex}.contInicial`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" placeholder="0.000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Cont. Final</label>
                  <input type="text" {...register(`reports.${reportIndex}.contFinal`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" placeholder="0.000" />
                </div>
                <div className="col-span-2 bg-purple-50 p-3 rounded-lg border border-purple-100 flex justify-between items-center">
                  <span className="text-sm font-bold text-purple-700">BOTELLAS PRODUCIDAS:</span>
                  <span className="text-lg font-black text-purple-800">{(watchedReports[reportIndex].botellasProduccion || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Droplets className="w-5 h-5 text-blue-600" />
                Control de Jarabe (Ltrs)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Jarabe Inicial</label>
                  <input type="text" {...register(`reports.${reportIndex}.jarabeInicial`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Jarabe Final</label>
                  <input type="text" {...register(`reports.${reportIndex}.jarabeFinal`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" placeholder="0.00" />
                </div>
                <div className="col-span-2 space-y-2">
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 flex justify-between items-center">
                    <span className="text-sm font-bold text-blue-700">CONSUMO REAL:</span>
                    <span className="text-lg font-black text-blue-800">{(watchedReports[reportIndex].jarabeConsumido || 0).toLocaleString()} L</span>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-700">JARABE TEÓRICO:</span>
                    <span className="text-lg font-black text-gray-800">{(watchedReports[reportIndex].jarabeTeorico || 0).toLocaleString()} L</span>
                  </div>
                  <div className={`p-3 rounded-lg border flex justify-between items-center ${
                    (watchedReports[reportIndex].jarabeDesperdicioPorcentaje || 0) > 5 
                      ? 'bg-red-50 border-red-100' 
                      : 'bg-green-50 border-green-100'
                  }`}>
                    <div className="flex flex-col">
                      <span className={`text-xs font-bold ${
                        (watchedReports[reportIndex].jarabeDesperdicioPorcentaje || 0) > 5 ? 'text-red-700' : 'text-green-700'
                      }`}>DESPERDICIO:</span>
                      <span className="text-xs opacity-70">Real vs Teórico</span>
                    </div>
                    <div className="text-right">
                      <div className={`text-lg font-black ${
                        (watchedReports[reportIndex].jarabeDesperdicioPorcentaje || 0) > 5 ? 'text-red-800' : 'text-green-800'
                      }`}>
                        {(watchedReports[reportIndex].jarabeDesperdicio || 0).toLocaleString()} L
                      </div>
                      <div className={`text-xs font-bold ${
                        (watchedReports[reportIndex].jarabeDesperdicioPorcentaje || 0) > 5 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {(watchedReports[reportIndex].jarabeDesperdicioPorcentaje || 0)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Gauge className="w-5 h-5 text-blue-600" />
                Control de CO2 (Kg)
              </h3>
              <div className="space-y-4">
                {/* Inicial y Final destacados a la par */}
                <div className="grid grid-cols-2 gap-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div>
                    <label className="block text-sm font-bold text-blue-800">CO2 Inicial</label>
                    <input type="text" {...register(`reports.${reportIndex}.co2Inicial`)} className="mt-1 block w-full rounded-md border-blue-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 bg-white" placeholder="0.000" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-blue-800">CO2 Final</label>
                    <input type="text" {...register(`reports.${reportIndex}.co2Final`)} className="mt-1 block w-full rounded-md border-blue-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 bg-white" placeholder="0.000" />
                  </div>
                </div>
                
                {/* Recarga abajo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700">CO2 Recarga</label>
                  <input type="text" {...register(`reports.${reportIndex}.co2Recarga`)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2" placeholder="0.000" />
                </div>

                <div className="bg-green-50 p-3 rounded-lg border border-green-100 flex justify-between items-center">
                  <span className="text-sm font-bold text-green-700">CONSUMO REAL:</span>
                  <span className="text-lg font-black text-green-800">{(watchedReports[reportIndex].co2Consumido || 0).toLocaleString()} Kg</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tabla de Control Horario */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 overflow-x-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              Control Horario y Calidad
            </h3>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Hora</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Lote Elab.</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Tanque</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Carbonatación (P/T/V/V-Corr)</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Brix (Bot/Pat/Diff)</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">pH Bebida / Acid Pat / ºBx Jar</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Checks</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {(watchedReports[reportIndex]?.hourlyData || field.hourlyData).map((row, hourIndex) => (
                  <tr key={hourIndex} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-xs font-bold text-gray-700">{row.hora}hs</td>
                    <td className="px-2 py-2">
                      <input type="text" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.loteElaboracion`)} className="w-20 p-1 text-xs border rounded" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="text" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.tanque`)} className="w-16 p-1 text-xs border rounded" />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <input type="text" placeholder="P" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.presion`)} className="w-12 p-1 text-xs border rounded" title="Presión" />
                        <input type="text" placeholder="T" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.temp`)} className="w-12 p-1 text-xs border rounded" title="Temperatura" />
                        <input type="number" step="0.1" placeholder="V" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.volBot`, { valueAsNumber: true })} className="w-12 p-1 text-xs border rounded bg-gray-100 font-bold" readOnly title="V Calculado" />
                        <input type="text" placeholder="V-Corr" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.volBotCorregido`)} className="w-14 p-1 text-xs border rounded" title="V Corregido" />
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <input type="text" placeholder="Bot" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.brixBot`)} className="w-14 p-1 text-xs border rounded" title="Brix Botella" />
                        <input type="text" placeholder="Pat" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.brixPatron`)} className="w-14 p-1 text-xs border rounded" title="Brix Patrón" />
                        <input type="number" step="0.01" placeholder="Diff" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.brixBotCorregido`, { valueAsNumber: true })} className="w-14 p-1 text-xs border rounded bg-gray-100 font-bold" readOnly title="Brix Corregido (Diff)" />
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <input type="text" placeholder="pH" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.phBebida`)} className="w-14 p-1 text-xs border rounded" title="pH Bebida" />
                        <input type="text" placeholder="Acid" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.acidezPatron`)} className="w-14 p-1 text-xs border rounded" title="Acidez Patrón" />
                        <input type="text" placeholder="ºBx Jar" {...register(`reports.${reportIndex}.hourlyData.${hourIndex}.brixJarabe`)} className="w-16 p-1 text-xs border rounded" title="ºBx Jarabe" />
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-2">
                        <Controller
                          name={`reports.${reportIndex}.hourlyData.${hourIndex}.cloro`}
                          control={control}
                          render={({ field }) => (
                            <button type="button" onClick={() => field.onChange(field.value === 'OK' ? 'FALLA' : 'OK')} className={`p-1 rounded text-[10px] font-bold ${field.value === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>CL</button>
                          )}
                        />
                        <Controller
                          name={`reports.${reportIndex}.hourlyData.${hourIndex}.codif`}
                          control={control}
                          render={({ field }) => (
                            <button type="button" onClick={() => field.onChange(field.value === 'OK' ? 'FALLA' : 'OK')} className={`p-1 rounded text-[10px] font-bold ${field.value === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>COD</button>
                          )}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Botones de Acción */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg z-20">
        <div className="max-w-[1600px] mx-auto flex justify-end gap-4">
          <button type="button" onClick={onCancel} className="flex items-center gap-2 px-6 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors">
            <X className="w-4 h-4" />
            Cancelar
          </button>
          <button 
            type="button" 
            onClick={handleSaveCurrentPart} 
            disabled={isSubmitting} 
            className="flex items-center gap-2 px-8 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Save className="w-4 h-4" />
            )}
            {initialData ? 'Actualizar Parte Elaboración' : `Guardar Parte ${activeTab + 1}`}
          </button>
        </div>
      </div>
    </form>
  );
};
