import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ProductionPlan, ProductionReport, ScheduleAuditLog } from '../types';
import { FLAVOR_COLORS, SABORES } from '../constants';
import { 
  CalendarDays, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  GripVertical, 
  Trash2, 
  Save, 
  DraftingCompass, 
  CheckCircle2, 
  Info,
  Package,
  ArrowRight,
  Settings2,
  Activity,
  Clock
} from 'lucide-react';
import { format, addDays, startOfWeek, subDays, parseISO, isSameDay, isToday } from 'date-fns';
import { es } from 'date-fns/locale';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { useAppConfig } from '../hooks/useAppConfig';
import { getLogicalDate } from '../utils';

const SHIFTS = ['Mañana', 'Tarde', 'Noche'] as const;

export function ProductionScheduler({ isAdmin = false }: { isAdmin?: boolean }) {
  const { config, availableBrands, availableLines, availableFlavors, availableSizes, getFilteredFlavors, getFilteredSizes } = useAppConfig();
  const [activeTab, setActiveTab] = useState<'scheduler' | 'config'>('scheduler');
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [actualReports, setActualReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Scroll sync refs
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const comparisonScrollRef = useRef<HTMLDivElement>(null);

  const syncScroll = (source: 'bottom' | 'comparison') => {
    const refs = [bottomScrollRef, comparisonScrollRef];
    const sourceRef = source === 'bottom' ? bottomScrollRef : comparisonScrollRef;

    if (!sourceRef.current) return;

    const scrollLeft = sourceRef.current.scrollLeft;
    refs.forEach(ref => {
      if (ref !== sourceRef && ref.current) {
        ref.current.scrollLeft = scrollLeft;
      }
    });
  };

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(selectedWeek, i));
  }, [selectedWeek]);

  // Roles: Filter plans for non-admins
  const displayPlans = useMemo(() => {
    if (isAdmin) return plans;
    return plans.filter(p => p.status === 'Published');
  }, [plans, isAdmin]);

  useEffect(() => {
    const startDate = format(selectedWeek, 'yyyy-MM-dd');
    const endDate = format(addDays(selectedWeek, 6), 'yyyy-MM-dd');
    const queryStartDate = format(subDays(selectedWeek, 1), 'yyyy-MM-dd'); // Include previous day for Noche shift

    const plansQuery = query(
      collection(db, 'production_plans'),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    );

    const actualQuery = query(
      collection(db, 'production_reports'),
      where('fecha', '>=', queryStartDate),
      where('fecha', '<=', format(addDays(selectedWeek, 7), 'yyyy-MM-dd'))
    );

    const unsubPlans = onSnapshot(plansQuery, (snap) => {
      setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionPlan)));
      setLoading(false);
    });

    const unsubActual = onSnapshot(actualQuery, (snap) => {
      setActualReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionReport)));
    });

    return () => {
      unsubPlans();
      unsubActual();
    };
  }, [selectedWeek]);

  const handleAddPlan = async (date: string, shift: typeof SHIFTS[number], linea: string) => {
    const lineDefault = config?.schedulerDefaults?.[linea];
    
    // Default values logic
    let brandName = lineDefault?.marca || availableBrands[0] || '';
    let size = lineDefault?.tamano || getFilteredSizes(linea)[0] || 1500;
    
    // Rule: Line 1 defaults to 3000cc if no specific default is set
    if (linea === '1' && !lineDefault?.tamano) {
      size = 3000;
    }
    
    let flavor = getFilteredFlavors(brandName, size)[0] || '';
    let packs = lineDefault?.plannedPacks || config?.calibreDefaults?.[size] || 0;

    const newPlan: Omit<ProductionPlan, 'id'> = {
      date,
      shift,
      linea,
      marca: brandName,
      sabor: flavor,
      tamano: size,
      plannedPacks: packs,
      status: 'Draft',
      createdAt: new Date().toISOString(),
      authorId: auth.currentUser?.uid || ''
    };

    try {
      await addDoc(collection(db, 'production_plans'), newPlan);
    } catch (error) {
      console.error("Error adding plan:", error);
    }
  };

  const handleUpdatePlan = async (id: string, updates: Partial<ProductionPlan>) => {
    try {
      const existingPlan = plans.find(p => p.id === id);
      if (existingPlan && existingPlan.status === 'Published') {
        // Track changes
        const changes: any[] = [];
        Object.entries(updates).forEach(([key, value]) => {
          if ((existingPlan as any)[key] !== value) {
            changes.push({
              field: key,
              oldValue: (existingPlan as any)[key],
              newValue: value
            });
          }
        });

        if (changes.length > 0) {
          const auditLog: Omit<ScheduleAuditLog, 'id'> = {
            planId: id,
            action: updates.status === 'Published' && existingPlan.status === 'Published' ? 'update' : (updates.status === 'Published' ? 'publish' : 'update'),
            datePlan: existingPlan.date,
            timestamp: new Date().toISOString(),
            changes,
            authorId: auth.currentUser?.uid || ''
          };
          await addDoc(collection(db, 'schedule_audit_logs'), auditLog);
        }
      }
      await updateDoc(doc(db, 'production_plans', id), updates);
    } catch (error) {
      console.error("Error updating plan:", error);
    }
  };

  const handleExportPDF = async () => {
    const tableId = 'scheduler-table-container';
    const element = document.getElementById(tableId);
    if (!element) return;

    try {
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF = (await import('jspdf')).jsPDF;

      // Temporary style to show full width for capture
      const originalStyle = element.style.cssText;
      element.style.width = 'auto';
      element.style.overflow = 'visible';
      element.style.position = 'relative';

      const canvas = await html2canvas(element, {
        scale: 2, // Higher resolution
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
        width: element.scrollWidth,
        height: element.scrollHeight,
        windowWidth: element.scrollWidth,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc) => {
          const clonedElement = clonedDoc.getElementById(tableId);
          if (clonedElement) {
            clonedElement.style.width = 'auto';
            clonedElement.style.overflow = 'visible';
            clonedElement.style.position = 'relative';

            // Special handling for oklch/oklab colors which html2canvas doesn't support
            const allElements = clonedDoc.getElementsByTagName('*');
            for (let i = 0; i < allElements.length; i++) {
              const el = allElements[i] as HTMLElement;
              const style = window.getComputedStyle(el);
              
              const needsBgFix = style.backgroundColor.includes('oklch') || style.backgroundColor.includes('oklab');
              const needsTextFix = style.color.includes('oklch') || style.color.includes('oklab');
              const needsBorderFix = style.borderColor.includes('oklch') || style.borderColor.includes('oklab');

              if (needsBgFix) {
                el.style.backgroundColor = style.backgroundColor.replace(/ok(lch|lab)\([^)]+\)/g, '#6366f1');
              }
              if (needsTextFix) {
                el.style.color = style.color.replace(/ok(lch|lab)\([^)]+\)/g, '#1e293b');
              }
              if (needsBorderFix) {
                el.style.borderColor = style.borderColor.replace(/ok(lch|lab)\([^)]+\)/g, '#e2e8f0');
              }
            }
          }
        }
      });

      element.style.cssText = originalStyle;

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [canvas.width, canvas.height]
      });

      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      const fileName = `Programa_Produccion_${format(selectedWeek, 'yyyy-MM-dd')}.pdf`;
      pdf.save(fileName);
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Error al generar el PDF. Por favor, intente de nuevo.");
    }
  };

  const handleDeletePlan = async (id: string) => {
    try {
      const existingPlan = plans.find(p => p.id === id);
      if (existingPlan && existingPlan.status === 'Published') {
        const auditLog: Omit<ScheduleAuditLog, 'id'> = {
          planId: id,
          action: 'delete',
          datePlan: existingPlan.date,
          timestamp: new Date().toISOString(),
          authorId: auth.currentUser?.uid || ''
        };
        await addDoc(collection(db, 'schedule_audit_logs'), auditLog);
      }
      await deleteDoc(doc(db, 'production_plans', id));
    } catch (error) {
      console.error("Error deleting plan:", error);
    }
  };

  const handlePublishAll = async () => {
    setIsSaving(true);
    const batch = writeBatch(db);
    const draftPlans = plans.filter(p => p.status === 'Draft');
    
    draftPlans.forEach(p => {
      batch.update(doc(db, 'production_plans', p.id!), { status: 'Published' });
    });
    
    try {
      await batch.commit();
      
      // Log publications
      for (const p of draftPlans) {
        const auditLog: Omit<ScheduleAuditLog, 'id'> = {
          planId: p.id!,
          action: 'publish',
          datePlan: p.date,
          timestamp: new Date().toISOString(),
          authorId: auth.currentUser?.uid || ''
        };
        await addDoc(collection(db, 'schedule_audit_logs'), auditLog);
      }
    } catch (error) {
      console.error("Error publishing plans:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to get total actual production for a specific slot
  const getActualProduction = (date: string, shift: string, linea: string, marca: string, sabor: string, tamano: number) => {
    return actualReports
      .filter(r => 
        getLogicalDate(r) === date && 
        r.turno === shift && 
        r.linea === linea && 
        r.marca === marca && 
        r.sabor === sabor && 
        r.tamano === tamano
      )
      .reduce((sum, r) => sum + (r.paquetes || 0), 0);
  };

  // Helper to get actual production for a specific slot regardless of plan
  const getSlotActuals = (date: string, shift: string, linea: string) => {
    const reports = actualReports.filter(r => 
      getLogicalDate(r) === date && 
      r.turno === shift && 
      r.linea === linea
    );
    if (reports.length === 0) return [];
    
    // Shift windows (480 mins each)
    const shiftStartMap: Record<string, number> = { 'Mañana': 6, 'Tarde': 14, 'Noche': 22 };
    const baseHour = shiftStartMap[shift] || 6;

    return reports.map(r => {
      if (!r.entraTurno || !r.saleTurno) return null;
      
      const getMinutes = (time: string) => {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
      };

      let startMin = getMinutes(r.entraTurno);
      let endMin = getMinutes(r.saleTurno);
      const baseMin = baseHour * 60;
      
      // Normalize to shift window
      if (shift === 'Noche') {
        if (startMin < 12 * 60) startMin += 24 * 60;
        if (endMin < 12 * 60) endMin += 24 * 60;
      } else if (endMin < startMin) {
        endMin += 24 * 60;
      }

      const offset = startMin - baseMin;
      const duration = endMin - startMin;

      return {
        sabor: r.sabor,
        packs: r.paquetes || 0,
        left: Math.max(0, (offset / 480) * 100),
        width: Math.min(100 - Math.max(0, (offset / 480) * 100), (duration / 480) * 100)
      };
    }).filter((b): b is { sabor: string; packs: number; left: number; width: number } => b !== null);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 mx-auto px-4">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-indigo-100 p-3 rounded-xl">
              <DraftingCompass className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Programa Maestro de Producción</h2>
              <p className="text-xs text-gray-500 uppercase tracking-widest font-black mt-1">Planificación y Cumplimiento</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-200">
            <button
              onClick={() => setSelectedWeek(new Date())}
              className="px-3 py-1.5 text-[10px] font-black uppercase text-gray-500 hover:text-indigo-600 hover:bg-white rounded-lg transition-all"
            >
              Hoy (Real)
            </button>
            <div className="h-4 w-[1px] bg-gray-200 mx-1" />
            <button
              onClick={() => setSelectedWeek(subDays(selectedWeek, 7))}
              className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="px-4 text-center min-w-[220px] flex items-center gap-2">
              <input 
                type="date"
                value={format(selectedWeek, 'yyyy-MM-dd')}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedWeek(parseISO(e.target.value));
                  }
                }}
                className="bg-transparent border-none p-0 text-sm font-bold text-gray-900 focus:ring-0 cursor-pointer w-[130px]"
              />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2">al</span>
              <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                {format(addDays(selectedWeek, 6), "dd MMM", { locale: es })}
              </span>
            </div>
            <button
              onClick={() => setSelectedWeek(addDays(selectedWeek, 7))}
              className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPDF}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-black hover:bg-gray-50 transition-all flex items-center gap-2 hover:border-gray-300"
            >
              <Package className="w-4 h-4 text-indigo-600" />
              Exportar PDF
            </button>
            
            {isAdmin && (
              <button
                onClick={handlePublishAll}
                disabled={isSaving || !plans.some(p => p.status === 'Draft')}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isSaving ? 'Publicando...' : 'Publicar Programa'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-8 px-2">
        <button
          onClick={() => setActiveTab('scheduler')}
          className={`pb-4 text-sm font-bold transition-all relative ${
            activeTab === 'scheduler' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            Programa Semanal
          </div>
          {activeTab === 'scheduler' && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />}
        </button>
          {isAdmin && (
            <button
              onClick={() => setActiveTab('config')}
              className={`pb-4 text-sm font-bold transition-all relative ${
                activeTab === 'config' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                Predeterminados por Turno
              </div>
              {activeTab === 'config' && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />}
            </button>
          )}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'scheduler' ? (
          <motion.div
            key="scheduler"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
          >
            {/* Gantt / Grid View */}
            <div id="scheduler-table-container" className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-6">
              <div 
                ref={bottomScrollRef}
                onScroll={() => syncScroll('bottom')}
                className="overflow-x-auto scrollbar-thick shadow-inner pb-6 -mx-2 px-2 cursor-pointer"
              >
                <table className="w-full border-collapse table-fixed" style={{ width: `${128 + weekDays.length * 3 * 240}px` }}>
                  <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th rowSpan={2} className="sticky left-0 bg-gray-50 z-20 w-32 px-4 py-2 text-center border-r border-gray-200 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Línea / Día</span>
                </th>
                {weekDays.map((day, i) => (
                  <th key={i} colSpan={3} className={`px-2 py-2 border-r border-gray-200 min-w-[720px] ${isToday(day) ? 'bg-indigo-50/50' : ''}`}>
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-tighter truncate w-full text-center">
                        {format(day, 'EEEE', { locale: es })}
                      </span>
                      <span className={`text-sm font-black ${isToday(day) ? 'text-indigo-600' : 'text-gray-900'}`}>
                        {format(day, 'dd/MM')}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
              <tr className="bg-gray-50/50 border-b border-gray-200">
                {weekDays.map((_, dayIdx) => (
                  <Fragment key={dayIdx}>
                    {SHIFTS.map((shift, shiftIdx) => (
                      <th key={shiftIdx} className={`px-1 py-2 text-center border-r border-gray-100 text-[10px] font-black uppercase tracking-tighter min-w-[240px] ${
                        shift === 'Mañana' ? 'text-orange-600 bg-orange-50/30' : 
                        shift === 'Tarde' ? 'text-blue-600 bg-blue-50/30' : 
                        'text-indigo-900 bg-indigo-50/30'
                      }`}>
                        {shift}
                      </th>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {availableLines.map(linea => (
                <tr key={linea} className="group">
                  <td className="sticky left-0 bg-white z-20 px-3 py-4 border-r border-gray-300 shadow-[2px_0_5px_rgba(0,0,0,0.05)] font-black text-indigo-700 uppercase text-sm text-center">
                    {linea}
                  </td>
                  {weekDays.map((day, i) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    return SHIFTS.map(shift => {
                      const slotPlans = displayPlans.filter(p => p.date === dateStr && p.shift === shift && p.linea === linea);
                      
                      return (
                        <td 
                          key={`${dateStr}-${shift}`} 
                          className={`p-0.5 border-r border-gray-100 align-top min-h-[40px] relative hover:bg-gray-50/30 transition-colors ${isToday(day) ? 'bg-indigo-50/10' : ''}`}
                        >
                          <div className="space-y-1">
                            {isAdmin && (
                              <button
                                onClick={() => handleAddPlan(dateStr, shift, linea)}
                                className="w-full py-0.5 border border-dashed border-gray-200 rounded text-gray-300 flex items-center justify-center hover:border-indigo-300 hover:text-indigo-400 hover:bg-indigo-50/50 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}

                            {slotPlans.map(plan => {
                              const isDraft = plan.status === 'Draft';
                              const bgColor = FLAVOR_COLORS[plan.sabor] || '#ffffff';
                              // Simple heuristic for text contrast
                              const isLight = ['Soda', 'Agua', 'Pomelo Blanco', 'Lima Limon'].includes(plan.sabor);

                              return (
                                <motion.div
                                  layout
                                  key={plan.id}
                                  style={{ 
                                    backgroundColor: bgColor,
                                    height: plan.duration === 0.5 ? '80px' : 'auto'
                                  }}
                                  className={`group/item relative rounded-xl border p-2 transition-all shadow-sm hover:shadow-md ${
                                    isDraft 
                                      ? 'border-amber-400 border-2' 
                                      : 'border-transparent'
                                  }`}
                                >
                                  <div className="space-y-1">
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1 min-w-0">
                                        {isAdmin ? (
                                          <select 
                                            value={plan.marca}
                                            onChange={(e) => handleUpdatePlan(plan.id!, { marca: e.target.value })}
                                            className={`block w-full text-[10px] font-black uppercase bg-transparent border-none p-0 focus:ring-0 cursor-pointer mb-0.5 truncate ${isLight ? 'text-indigo-700' : 'text-white opacity-80'}`}
                                          >
                                            {availableBrands.map(b => <option key={b} value={b} className="text-gray-900">{b}</option>)}
                                          </select>
                                        ) : (
                                          <div className={`text-[10px] font-black uppercase mb-0.5 truncate ${isLight ? 'text-indigo-700' : 'text-white opacity-80'}`}>
                                            {plan.marca}
                                          </div>
                                        )}
                                        
                                        {isAdmin ? (
                                          <select
                                            value={plan.sabor}
                                            onChange={(e) => handleUpdatePlan(plan.id!, { sabor: e.target.value })}
                                            className={`block w-full text-base font-black bg-transparent border-none p-0 focus:ring-0 cursor-pointer truncate leading-tight ${isLight ? 'text-gray-900' : 'text-white'}`}
                                          >
                                            {getFilteredFlavors(plan.marca, plan.tamano).map(f => (
                                              <option key={f} value={f} className="text-gray-900">{f}</option>
                                            ))}
                                          </select>
                                        ) : (
                                          <div className={`text-base font-black truncate leading-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                            {plan.sabor}
                                          </div>
                                        )}

                                        <div className="mt-1 flex flex-wrap gap-2">
                                          {isAdmin ? (
                                            <select
                                              value={plan.tamano}
                                              onChange={(e) => handleUpdatePlan(plan.id!, { tamano: Number(e.target.value) })}
                                              className={`text-[11px] font-black px-1.5 py-0.5 rounded shadow-sm focus:ring-0 cursor-pointer border ${isLight ? 'bg-white text-indigo-600 border-indigo-100' : 'bg-black/20 text-white border-white/20'}`}
                                            >
                                              {getFilteredSizes(linea).map(s => <option key={s} value={s} className="text-gray-900">{s}cc</option>)}
                                            </select>
                                          ) : (
                                            <span className={`text-[11px] font-black px-1.5 py-0.5 rounded shadow-sm border ${isLight ? 'bg-white text-indigo-600 border-indigo-100' : 'bg-black/20 text-white border-white/20'}`}>
                                              {plan.tamano}cc
                                            </span>
                                          )}

                                          {isAdmin ? (
                                            <select
                                              value={plan.duration || 1}
                                              onChange={(e) => handleUpdatePlan(plan.id!, { duration: Number(e.target.value) })}
                                              className={`text-[11px] font-black px-1.5 py-0.5 rounded shadow-sm focus:ring-0 cursor-pointer border ${isLight ? 'bg-white text-indigo-600 border-indigo-100' : 'bg-black/20 text-white border-white/20'}`}
                                            >
                                              <option value={1} className="text-gray-900">Total</option>
                                              <option value={0.5} className="text-gray-900">Medio</option>
                                            </select>
                                          ) : plan.duration === 0.5 && (
                                            <span className={`text-[11px] font-black px-1.5 py-0.5 rounded shadow-sm border ${isLight ? 'bg-white text-indigo-600 border-indigo-100' : 'bg-black/20 text-white border-white/20'}`}>
                                              1/2
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      {isAdmin && (
                                        <button 
                                          onClick={() => handleDeletePlan(plan.id!)}
                                          className={`p-1 rounded-lg transition-colors opacity-0 group-hover/item:opacity-100 ${isLight ? 'text-gray-400 hover:text-red-500 bg-gray-50' : 'text-white/50 hover:text-white bg-black/10'}`}
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>

                                    <div className={`pt-1.5 border-t flex items-center justify-between ${isLight ? 'border-black/5' : 'border-white/10'}`}>
                                      <div className="flex flex-col">
                                        <span className={`text-[7px] font-black uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-white/60'}`}>Packs Previstos</span>
                                        {isAdmin ? (
                                          <input
                                            type="number"
                                            value={plan.plannedPacks || ''}
                                            onChange={(e) => handleUpdatePlan(plan.id!, { plannedPacks: Number(e.target.value) })}
                                            className={`text-sm font-black w-full p-0 border-none bg-transparent focus:ring-0 placeholder:opacity-50 ${isLight ? 'text-gray-900' : 'text-white'}`}
                                          />
                                        ) : (
                                          <div className={`text-sm font-black ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                            {plan.plannedPacks?.toLocaleString() || '0'}
                                          </div>
                                        )}
                                      </div>
                                      {isDraft && isAdmin && (
                                        <span className={`text-[7px] font-black px-1.5 py-0.5 rounded uppercase ${isLight ? 'bg-amber-100 text-amber-700' : 'bg-white/20 text-white'}`}>
                                          Borrador
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </motion.div>
                              );
                            })}

                            {isAdmin && (
                              <button
                                onClick={() => handleAddPlan(dateStr, shift, linea)}
                                className="w-full py-0.5 border border-dashed border-gray-200 rounded text-gray-300 flex items-center justify-center hover:border-indigo-300 hover:text-indigo-400 hover:bg-indigo-50/50 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    });
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
            </div>

            {/* Mini-Gantt Summary */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <Activity className="w-6 h-6 text-indigo-600" />
                  <div>
                    <h3 className="text-xl font-black text-gray-900 uppercase tracking-tight">Comparativa: Plan vs Real</h3>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-0.5">Visión consolidada por línea y turno</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-gray-100 border border-gray-300" />
                    <span className="text-[10px] font-black text-gray-400 uppercase">Lo Planeado</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-indigo-600" />
                    <span className="text-[10px] font-black text-gray-400 uppercase">Ejecución Real</span>
                  </div>
                </div>
              </div>
              
              <div 
                ref={comparisonScrollRef}
                onScroll={() => syncScroll('comparison')}
                className="overflow-x-auto scrollbar-thick pb-6 -mx-2 px-2 cursor-pointer"
              >
                <div className="space-y-12" style={{ width: `${weekDays.length * 3 * 240}px` }}>
                  {availableLines.map(linea => (
                    <div key={linea} className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-14 h-7 flex items-center justify-center bg-indigo-700 rounded-lg text-white text-[11px] font-black shadow-md">
                          L {linea}
                        </div>
                        <div className="h-[1px] flex-1 bg-gray-100" />
                      </div>
                      
                      <div className="relative space-y-3">
                        {/* Planned Bars (Flavor Coded) */}
                        <div className="flex gap-2 h-6">
                          {weekDays.map((day, di) => (
                            <div key={di} className="flex gap-2">
                              {SHIFTS.map(shift => {
                                const dateStr = format(day, 'yyyy-MM-dd');
                                const plan = displayPlans.find(p => p.date === dateStr && p.shift === shift && p.linea === linea);
                                return (
                                  <div key={shift} className="w-[240px] relative rounded h-full overflow-hidden bg-gray-50/50 border border-gray-100 transition-all shadow-inner">
                                    {plan ? (
                                      <div 
                                        className="absolute inset-0 flex items-center justify-center"
                                        style={{ backgroundColor: FLAVOR_COLORS[plan.sabor] || '#cbd5e1' }}
                                      >
                                        <div className="absolute inset-0 bg-white/10" />
                                        <span className="relative text-[7px] font-black text-white uppercase truncate px-1 drop-shadow-sm">
                                          {plan.sabor}
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:4px_4px]" />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>

                        {/* Actual/Real Performance Bars (Showing Real Flavor(s) as Timeline) */}
                        <div className="flex gap-2 h-10">
                          {weekDays.map((day, di) => (
                            <div key={di} className="flex gap-2">
                              {SHIFTS.map(shift => {
                                const dateStr = format(day, 'yyyy-MM-dd');
                                const realBlocks = getSlotActuals(dateStr, shift, linea);
                                
                                return (
                                  <div key={shift} className="w-[240px] relative rounded-lg h-full overflow-hidden bg-white border border-gray-200 shadow-sm transition-all group/real ring-1 ring-gray-100">
                                    {realBlocks.length > 0 ? (
                                      realBlocks.map((data, idx) => (
                                        <div 
                                          key={idx}
                                          className="h-full absolute top-0 flex items-center justify-center overflow-hidden border-r border-white/10 last:border-r-0 shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
                                          style={{ 
                                            backgroundColor: FLAVOR_COLORS[data.sabor] || '#6366f1',
                                            left: `${data.left}%`,
                                            width: `${data.width}%` 
                                          }}
                                        >
                                          <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent" />
                                          <div className="flex flex-col items-center pointer-events-none px-1 overflow-hidden">
                                            <span className="text-[7px] font-black text-white drop-shadow-sm uppercase truncate w-full text-center">
                                              {data.sabor}
                                            </span>
                                            <span className="text-[9px] font-black text-white mix-blend-difference">
                                              {data.packs.toLocaleString()}
                                            </span>
                                          </div>
                                        </div>
                                      ))
                                    ) : (
                                      <div className="absolute inset-0 bg-gray-50/30 flex items-center justify-center w-full">
                                        <div className="w-1 h-1 rounded-full bg-gray-200" />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="mt-12 flex flex-wrap gap-4 pt-8 border-t border-gray-100">
                {SABORES.map(sabor => (
                  <div key={sabor} className="flex items-center gap-3 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                    <div className="w-3.5 h-3.5 rounded-full border border-gray-200 shadow-sm" style={{ backgroundColor: FLAVOR_COLORS[sabor] || '#cbd5e1' }} />
                    <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest">{sabor}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="config"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
          >
            <SchedulerConfig 
              config={config} 
              brands={availableBrands} 
              sizes={availableSizes}
              lines={availableLines}
              reports={actualReports}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info/Guide */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl flex gap-4">
          <div className="bg-blue-100 p-3 rounded-xl h-fit">
            <Info className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-blue-900">¿Cómo programar?</h4>
            <p className="text-xs text-blue-700 mt-1 leading-relaxed">
              Agrega productos a cada bloque de turno. Los cambios se guardan automáticamente como <strong>Borrador</strong>. 
              Al hacer clic en "Publicar", el programa se marca como oficial.
            </p>
          </div>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl flex gap-4">
          <div className="bg-indigo-100 p-3 rounded-xl h-fit">
            <Package className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-indigo-900">Seguimiento Real</h4>
            <p className="text-xs text-indigo-700 mt-1 leading-relaxed">
              El sistema cruza los <strong>Partes de Producción</strong> cargados para el mismo día/turno/línea y muestra el avance en tiempo real.
            </p>
          </div>
        </div>

        <div className="bg-green-50 border border-green-100 p-4 rounded-2xl flex gap-4">
          <div className="bg-green-100 p-3 rounded-xl h-fit">
            <ArrowRight className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-green-900">Grado de Avance</h4>
            <p className="text-xs text-green-700 mt-1 leading-relaxed">
              La barra de color indica el cumplimiento: <span className="text-amber-600 font-bold">Amarrillo &lt; 50%</span>, 
              <span className="text-blue-600 font-bold"> Azul 50-99%</span> y <span className="text-green-600 font-bold"> Verde Completo</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inner component for configuration
function SchedulerConfig({ config, brands, sizes, lines, reports }: { 
  config: any, 
  brands: string[], 
  sizes: number[], 
  lines: string[], 
  reports: ProductionReport[] 
}) {
  const [defaults, setDefaults] = useState<Record<string, any>>(config?.schedulerDefaults || {});
  const [calDefaults, setCalDefaults] = useState<Record<number, number>>(config?.calibreDefaults || {});
  const [isSaving, setIsSaving] = useState(false);
  const [reports30, setReports30] = useState<ProductionReport[]>([]);

  useEffect(() => {
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const q = query(
      collection(db, 'production_reports'),
      where('fecha', '>=', thirtyDaysAgo)
    );
    const unsub = onSnapshot(q, (snap) => {
      setReports30(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionReport)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (config?.schedulerDefaults) setDefaults(config.schedulerDefaults);
    if (config?.calibreDefaults) setCalDefaults(config.calibreDefaults);
  }, [config?.schedulerDefaults, config?.calibreDefaults]);

  // Calculate monthly averages per line (like Effectiveness report: (total / Marcha Bruta) * 480)
  const monthlyAverages = useMemo(() => {
    const averages: Record<string, number> = {};
    lines.forEach(line => {
      const lineReports = reports30.filter(r => r.linea === line);
      if (lineReports.length === 0) {
        averages[line] = 0;
        return;
      }
      let totalPacks = 0;
      let totalMarchaBruta = 0;
      
      lineReports.forEach(r => {
        totalPacks += (r.paquetes || 0);
        totalMarchaBruta += (r.tiempoTurno || 0);
      });
      
      averages[line] = totalMarchaBruta > 0 ? Math.round((totalPacks / totalMarchaBruta) * 480) : 0;
    });
    return averages;
  }, [reports30, lines]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'config', 'production'), {
        schedulerDefaults: defaults,
        calibreDefaults: calDefaults
      });
    } catch (error) {
      console.error("Error saving defaults:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const updateLineDefault = (line: string, field: string, value: any) => {
    setDefaults(prev => ({
      ...prev,
      [line]: {
        ...(prev[line] || { marca: brands[0], tamano: sizes[0], plannedPacks: 0 }),
        [field]: value
      }
    }));
  };

  const applyAverage = (line: string) => {
    updateLineDefault(line, 'plannedPacks', monthlyAverages[line]);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-gray-50/30">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Configuración de Predeterminados por Línea</h3>
          <p className="text-sm text-gray-500 mt-1">Define los valores automáticos que se usarán al crear planes para cada línea.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-sm"
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50/50 border-b border-gray-100">
              <th className="px-6 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Línea</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Marca</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Tamaño</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Packs Previstos</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest bg-indigo-50/30">Promedio por Turno</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map(line => {
              const lineDefault = defaults[line] || {};
              const avg = monthlyAverages[line];

              return (
                <tr key={line} className="hover:bg-gray-50/30 transition-colors">
                  <td className="px-6 py-4 font-black text-indigo-700 uppercase tracking-tighter">
                    Línea {line}
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={lineDefault.marca || ''}
                      onChange={(e) => updateLineDefault(line, 'marca', e.target.value)}
                      className="w-full bg-white border-gray-200 rounded-lg text-sm font-bold focus:ring-indigo-500 focus:border-indigo-500 py-2"
                    >
                      <option value="">Seleccionar...</option>
                      {brands.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={lineDefault.tamano || ''}
                      onChange={(e) => updateLineDefault(line, 'tamano', Number(e.target.value))}
                      className="w-full bg-white border-gray-200 rounded-lg text-sm font-bold focus:ring-indigo-500 focus:border-indigo-500 py-2"
                    >
                      <option value="">-</option>
                      {sizes.map(s => <option key={s} value={s}>{s}cc</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={lineDefault.plannedPacks || ''}
                        onChange={(e) => updateLineDefault(line, 'plannedPacks', Number(e.target.value))}
                        className="w-32 bg-white border-gray-200 rounded-lg text-sm font-bold focus:ring-indigo-500 focus:border-indigo-500 py-2"
                        placeholder="0"
                      />
                    </div>
                  </td>
                  <td className="px-6 py-4 bg-indigo-50/10">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-indigo-600">{avg.toLocaleString()}</span>
                        <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Packs / Turno</span>
                      </div>
                      <button
                        onClick={() => applyAverage(line)}
                        className="p-2 text-indigo-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all border border-transparent hover:border-indigo-100"
                        title="Usar promedio como previsto"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="p-8 border-t border-b border-gray-100 bg-gray-50/10">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Objetivos Estándar por Calibre</h3>
          <p className="text-sm text-gray-500 mt-1">Define el objetivo de packs por turno para cada calibre. Este valor se usará para el cálculo de turnos faltantes en el reporte de cumplimiento.</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50/50 border-b border-gray-100">
              <th className="px-6 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Calibre</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Packs Estandar p/ Turno</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sizes.map(size => (
              <tr key={size} className="hover:bg-gray-50/30 transition-colors">
                <td className="px-6 py-4 font-black text-gray-700">{size} cc</td>
                <td className="px-6 py-4">
                  <input
                    type="number"
                    value={calDefaults[size] || ''}
                    onChange={(e) => setCalDefaults(prev => ({ ...prev, [size]: Number(e.target.value) }))}
                    className="w-32 bg-white border-gray-200 rounded-lg text-sm font-bold focus:ring-indigo-500 focus:border-indigo-500 py-2"
                    placeholder="0"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-6 bg-amber-50 border-t border-amber-100 flex gap-4">
        <Info className="w-5 h-5 text-amber-600 shrink-0" />
        <p className="text-xs text-amber-700 leading-relaxed">
          Los <strong>Packs Previstos</strong> se cargarán automáticamente al crear un nuevo plan. El <strong>Promedio por Turno</strong> se calcula dividiendo el total de packs fabricados por la cantidad de turnos productivos del rango cargado.
        </p>
      </div>
    </div>
  );
}
