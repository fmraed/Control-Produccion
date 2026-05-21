import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, writeBatch, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ProductionPlanV2, ProductionReport } from '../types';
import { FLAVOR_COLORS, BOTELLAS_POR_PACK } from '../constants';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Settings2,
  Clock,
  ArrowUp,
  ArrowDown,
  Info,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  Edit2,
  Play,
  TrendingUp,
  Sliders,
  Sparkles,
  ClipboardList
} from 'lucide-react';
import { format, addDays, subDays, parseISO, isAfter, isBefore, differenceInMinutes, addMinutes, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAppConfig } from '../hooks/useAppConfig';

import { Package } from 'lucide-react';
import { SchedulerStockProjection } from './SchedulerStockProjection';

export function PackProductionScheduler({ isAdmin = false }: { isAdmin?: boolean }) {
  const { config, availableBrands, availableLines, getFilteredFlavors, getFilteredSizes } = useAppConfig();

  // Active view tabs
  const [activeTab, setActiveTab] = useState<'scheduler' | 'config' | 'projection'>('scheduler');
  const [focusedDate, setFocusedDate] = useState<Date>(new Date());
  
  // Scheduler lists
  const [plannedBlocks, setPlannedBlocks] = useState<ProductionPlanV2[]>([]);
  const [actualReports, setActualReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);

  // Default Event Durations (synchronized with Firestore or stored locally)
  const [flavorChangeDuration, setFlavorChangeDuration] = useState<number>(30); // in minutes
  const [transformationDuration, setTransformationDuration] = useState<number>(120); // in minutes
  const [lineStartHours, setLineStartHours] = useState<Record<string, string>>({
    '1': '06:00',
    '2': '06:00',
    '3': '06:00'
  });

  // Adding/Editing item states per line
  const [addingToLine, setAddingToLine] = useState<string | null>(null);
  const [editingBlock, setEditingBlock] = useState<ProductionPlanV2 | null>(null);

  // Additional states for calculations
  const [packsPerShiftMatrix, setPacksPerShiftMatrix] = useState<Record<string, number>>({
    '500': 4500,
    '1500': 3500,
    '2250': 3000,
    '3000': 2500
  });
  const [historicalAverages, setHistoricalAverages] = useState<Record<string, number>>({});
  
  const [defaultCalcBasis, setDefaultCalcBasis] = useState<'theoretical' | 'default' | 'historical' | 'manual'>('theoretical');

  // Form states
  const [formType, setFormType] = useState<'production' | 'flavor_change' | 'transformation' | 'other'>('production');
  const [formIsChained, setFormIsChained] = useState<boolean>(true);
  const [formCustomStartTime, setFormCustomStartTime] = useState<string>('06:00');
  const [formCalcBasis, setFormCalcBasis] = useState<'theoretical' | 'default' | 'historical' | 'manual'>('theoretical');
  const [formMarca, setFormMarca] = useState<string>('');
  const [formTamano, setFormTamano] = useState<number>(1500);
  const [formSabor, setFormSabor] = useState<string>('');
  const [formPacks, setFormPacks] = useState<string>('1000');
  const [formVelocidad, setFormVelocidad] = useState<string>('');
  const [formLabel, setFormLabel] = useState<string>('');
  const [formDuration, setFormDuration] = useState<string>('30');
  const [formNotes, setFormNotes] = useState<string>('');

  // Fetch standard configs for defaults
  useEffect(() => {
    if (!config) return;
    
    // Read durations and custom configurations from central document if they exist
    if ((config as any).v2_flavorChangeDuration !== undefined) {
      setFlavorChangeDuration((config as any).v2_flavorChangeDuration);
    }
    if ((config as any).v2_transformationDuration !== undefined) {
      setTransformationDuration((config as any).v2_transformationDuration);
    }
    if ((config as any).v2_packsPerShiftMatrix !== undefined) {
      setPacksPerShiftMatrix((config as any).v2_packsPerShiftMatrix);
    }
    if ((config as any).v2_defaultCalcBasis !== undefined) {
      setDefaultCalcBasis((config as any).v2_defaultCalcBasis);
    }
    if ((config as any).v2_lineStartHours !== undefined) {
      setLineStartHours({
        ...lineStartHours,
        ...(config as any).v2_lineStartHours
      });
    }
  }, [config]);

  // Load configured line start hours from local storage as a robust fallback
  useEffect(() => {
    const savedStartHours = localStorage.getItem('v2_lineStartHours');
    if (savedStartHours) {
      try {
        setLineStartHours(JSON.parse(savedStartHours));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  // Sync focused date plans and surrounding actual reports
  useEffect(() => {
    const dateStr = format(focusedDate, 'yyyy-MM-dd');

    // Subscribe to planned blocks for this date
    const plansQuery = query(
      collection(db, 'production_plans_v2'),
      where('date', '==', dateStr)
    );

    const unsubPlans = onSnapshot(plansQuery, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionPlanV2));
      // Sort client-side by orderIndex to keep sequencing strict
      list.sort((a, b) => a.orderIndex - b.orderIndex);
      setPlannedBlocks(list);
      setLoading(false);
    }, (err) => {
      console.error("Error reading production_plans_v2", err);
      setLoading(false);
    });

    // Query production reports matching around this physical date to catch overnight sequences
    const prevDateStr = format(subDays(focusedDate, 1), 'yyyy-MM-dd');
    const nextDateStr = format(addDays(focusedDate, 1), 'yyyy-MM-dd');

    const reportsQuery = query(
      collection(db, 'production_reports'),
      where('fecha', '>=', prevDateStr),
      where('fecha', '<=', nextDateStr)
    );

    const unsubReports = onSnapshot(reportsQuery, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionReport));
      setActualReports(list);
    }, (err) => {
      console.error("Error reading production_reports", err);
    });

    return () => {
      unsubPlans();
      unsubReports();
    };
  }, [focusedDate]);

  // Fetch 30 day history for averages
  useEffect(() => {
    import('firebase/firestore').then(({ getDocs }) => {
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
      const q = query(collection(db, 'production_reports'), where('fecha', '>=', thirtyDaysAgo));
      getDocs(q).then(snap => {
        const list = snap.docs.map(d => d.data() as ProductionReport);
        const sums: Record<string, { totalPacks: number, count: number }> = {};
        list.forEach(r => {
          if (!r.tamano || !r.paquetes) return;
          const key = r.tamano.toString();
          if (!sums[key]) sums[key] = { totalPacks: 0, count: 0 };
          sums[key].totalPacks += r.paquetes;
          sums[key].count += 1; // 1 shift part equals 1 shift timeframe approximately
        });
        const avgs: Record<string, number> = {};
        Object.keys(sums).forEach(k => {
          avgs[k] = Math.round(sums[k].totalPacks / sums[k].count);
        });
        setHistoricalAverages(avgs);
      });
    });
  }, []);

  // Available brands, sizes, and flavors for inputs
  const availableSizesForAdding = useMemo(() => {
    const rawSizes = getFilteredSizes(addingToLine || undefined);
    return rawSizes.filter(size => {
      const localFlavors = getFilteredFlavors(formMarca, size, false);
      return localFlavors.length > 0;
    });
  }, [getFilteredSizes, addingToLine, formMarca, getFilteredFlavors]);

  const availableFlavorsForBrandAndSize = useMemo(() => {
    // Only local flavors for production scheduler
    return getFilteredFlavors(formMarca, formTamano, false);
  }, [getFilteredFlavors, formMarca, formTamano]);

  // On form selection updates
  useEffect(() => {
    if (availableBrands && availableBrands.length > 0 && !formMarca) {
      setFormMarca(availableBrands[0]);
    }
  }, [availableBrands, formMarca]);

  useEffect(() => {
    if (availableSizesForAdding.length > 0 && !availableSizesForAdding.includes(formTamano)) {
      setFormTamano(availableSizesForAdding[0]);
    }
  }, [availableSizesForAdding, formTamano]);

  useEffect(() => {
    const flavors = getFilteredFlavors(formMarca, formTamano);
    if (flavors.length > 0 && (!formSabor || !flavors.includes(formSabor))) {
      setFormSabor(flavors[0]);
    }
  }, [formMarca, formTamano, getFilteredFlavors, formSabor]);

  // Speed matrix tracker
  useEffect(() => {
    if (addingToLine && formType === 'production') {
      const lineSpeedStr = config?.velocidadMatrix?.[addingToLine]?.[formTamano];
      const standardSpeed = lineSpeedStr || 60; // fallback BPM
      setFormVelocidad(standardSpeed.toString());

      // Only over-write packs if we are setting defaults or if they match the previous size's default
      const defaultPacksForNewSize = packsPerShiftMatrix[formTamano.toString()]?.toString() || '1000';
      setFormPacks(defaultPacksForNewSize);
    }
  }, [formTamano, addingToLine, formType, config, packsPerShiftMatrix]);

  // Save Configured line start hour locally
  const handleSaveLineStartHour = (line: string, hourVal: string) => {
    const updated = { ...lineStartHours, [line]: hourVal };
    setLineStartHours(updated);
    localStorage.setItem('v2_lineStartHours', JSON.stringify(updated));

    // Try central store update if user is Admin
    if (isAdmin) {
      updateDoc(doc(db, 'config', 'production'), {
        v2_lineStartHours: updated
      }).catch(err => console.log('Admin central save skipped', err));
    }
  };

  // Switch weeks / navigation
  const handleNavDay = (days: number) => {
    setFocusedDate(prev => addDays(prev, days));
  };

  const handleSelectDayFromWeek = (day: Date) => {
    setFocusedDate(day);
  };

  // Generate current weeks tab row focus selection
  const weekDaysList = useMemo(() => {
    const start = startOfWeek(focusedDate, { weekStartsOn: 1 }); // Monday
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [focusedDate]);

  // Compute SEQUENTIALLY chained visual blocks for each Line
  const processedLinesScheduler = useMemo(() => {
    const linesData: Record<string, {
      plannedTimeline: any[];
      actualTimeline: any[];
      totalPlannedMinutes: number;
      totalActualMinutes: number;
    }> = {};

    availableLines.forEach(line => {
      linesData[line] = {
        plannedTimeline: [],
        actualTimeline: [],
        totalPlannedMinutes: 0,
        totalActualMinutes: 0
      };
    });

    // 1. Map Planned Sequence
    availableLines.forEach(line => {
      const linePlans = plannedBlocks.filter(p => p.linea === line);
      const startHourStr = lineStartHours[line] || '06:00';
      const [sh, sm] = startHourStr.split(':').map(Number);

      const baseDateStr = format(focusedDate, 'yyyy-MM-dd');
      let currentStartTime = parseISO(`${baseDateStr}T${startHourStr.padStart(5, '0')}`);

      linePlans.forEach((plan, idx) => {
        if (plan.isChained === false && plan.customStartTime) {
          let customStart = parseISO(`${baseDateStr}T${plan.customStartTime.padStart(5, '0')}`);
          if (plan.customStartTime < startHourStr) {
            customStart = addDays(customStart, 1);
          }
          currentStartTime = customStart;
        }

        const startDiffMinutes = differenceInMinutes(currentStartTime, parseISO(`${baseDateStr}T${startHourStr}`));
        const endDiffMinutes = startDiffMinutes + plan.duration;

        const endTimeStr = format(addMinutes(currentStartTime, plan.duration), 'HH:mm');
        const startTimeStr = format(currentStartTime, 'HH:mm');

        linesData[line].plannedTimeline.push({
          ...plan,
          calculatedStart: currentStartTime,
          calculatedEnd: addMinutes(currentStartTime, plan.duration),
          startTimeStr,
          endTimeStr,
          startOffsetMinutes: startDiffMinutes,
          endOffsetMinutes: endDiffMinutes
        });

        // Set next start
        currentStartTime = addMinutes(currentStartTime, plan.duration);
      });

      linesData[line].totalPlannedMinutes = linePlans.reduce((sum, p) => sum + p.duration, 0);
    });

    // 2. Map Actual Production Reports (real)
    // Focused Day physical window boundary (duration is 24 hours starting at custom start hour)
    availableLines.forEach(line => {
      const startHourStr = lineStartHours[line] || '06:00';
      const baseDateStr = format(focusedDate, 'yyyy-MM-dd');
      
      const windowStart = parseISO(`${baseDateStr}T${startHourStr.padStart(5, '0')}`);
      const windowEnd = addDays(windowStart, 1); // 24 hours later

      const lineReports = actualReports.filter(rep => rep.linea === line && rep.entraTurno && rep.saleTurno);

      lineReports.forEach(report => {
        // Date parsing with overnight logic
        let repStart = parseISO(`${report.fecha}T${report.entraTurno}`);
        let repEnd = parseISO(`${report.fecha}T${report.saleTurno}`);

        if (report.entraTurno >= '22:00') {
          repStart = subDays(repStart, 1);
          if (report.saleTurno >= '22:00' || report.saleTurno < '06:00') {
            repEnd = subDays(repEnd, 1);
          }
        } else if (report.saleTurno < report.entraTurno) {
          repEnd = addDays(repEnd, 1);
        }

        // Clip to our focused physical window to display cleanly on the timeline grid
        if (isAfter(repStart, windowEnd) || isBefore(repEnd, windowStart)) return;

        const clampedStart = isBefore(repStart, windowStart) ? windowStart : repStart;
        const clampedEnd = isAfter(repEnd, windowEnd) ? windowEnd : repEnd;

        const startOffset = differenceInMinutes(clampedStart, windowStart);
        const duration = differenceInMinutes(clampedEnd, clampedStart);
        const endOffset = startOffset + duration;

        linesData[line].actualTimeline.push({
          id: report.id,
          report,
          sabor: report.sabor || 'Sin Sabor',
          tamano: report.tamano,
          paquetes: report.paquetes || 0,
          startOffsetMinutes: startOffset,
          endOffsetMinutes: endOffset,
          duration,
          startTimeStr: format(clampedStart, 'HH:mm'),
          endTimeStr: format(clampedEnd, 'HH:mm')
        });
      });
    });

    return linesData;
  }, [plannedBlocks, actualReports, focusedDate, lineStartHours, availableLines]);

  // Operations: Add / Edit Item Firestore updates
  const handleOpenAddForm = (line: string) => {
    setAddingToLine(line);
    setEditingBlock(null);
    setFormType('production');
    setFormNotes('');
    setFormLabel('');

    // Preload brands
    if (availableBrands.length > 0) {
      setFormMarca(availableBrands[0]);
    }
    const lineSizes = getFilteredSizes(line);
    const validLineSizes = lineSizes.filter(size => getFilteredFlavors(availableBrands[0] || '', size, false).length > 0);
    let defaultSiz = 1500;
    if (validLineSizes.length > 0) {
      if (validLineSizes.includes(1500)) {
        defaultSiz = 1500;
      } else {
        defaultSiz = validLineSizes[0];
      }
      setFormTamano(defaultSiz);
    }
    // Form speed and packs
    setFormPacks(packsPerShiftMatrix[defaultSiz.toString()]?.toString() || '1000');
    setFormDuration('30');
    setFormIsChained(true);
    setFormCalcBasis(defaultCalcBasis);
    setFormCustomStartTime(lineStartHours[line] || '06:00');
  };

  const handleOpenEditForm = (block: ProductionPlanV2) => {
    setEditingBlock(block);
    setAddingToLine(block.linea);
    setFormType(block.type);
    setFormNotes(block.notes || '');
    setFormLabel(block.label || '');
    
    setFormIsChained(block.isChained !== false);
    setFormCustomStartTime(block.customStartTime || lineStartHours[block.linea] || '06:00');
    setFormCalcBasis(block.calculationBasis || 'theoretical');
    
    if (block.type === 'production') {
      setFormMarca(block.marca || '');
      setFormTamano(block.tamano || 1500);
      setFormSabor(block.sabor || '');
      setFormPacks(block.plannedPacks?.toString() || '0');
      setFormVelocidad(block.velocidad?.toString() || '60');
    } else {
      setFormDuration(block.duration.toString());
    }
  };

  const handleCloseForm = () => {
    setAddingToLine(null);
    setEditingBlock(null);
  };

  // Submit Run Block
  const handleSubmitBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingToLine) return;

    let durationMinutes = 0;
    const packsNum = parseInt(formPacks, 10) || 0;
    const speedNum = parseInt(formVelocidad, 10) || 60;

    const botellasRatio = BOTELLAS_POR_PACK[formTamano] || 6;
    const isNoSyrup = formType === 'production' && ['Soda', 'Soda Sifon', 'Agua'].includes(formSabor);

    if (formType === 'production') {
      if (formCalcBasis === 'default' && packsPerShiftMatrix[formTamano.toString()]) {
        durationMinutes = Math.round(packsNum * (480 / packsPerShiftMatrix[formTamano.toString()]));
      } else if (formCalcBasis === 'historical' && historicalAverages[formTamano.toString()]) {
        durationMinutes = Math.round(packsNum * (480 / historicalAverages[formTamano.toString()]));
      } else if (formCalcBasis === 'manual') {
        durationMinutes = parseInt(formDuration, 10) || 480;
      } else {
        // theoretical
        durationMinutes = Math.round((packsNum * botellasRatio) / speedNum) || 480;
      }
    } else if (formType === 'flavor_change') {
      durationMinutes = flavorChangeDuration;
    } else if (formType === 'transformation') {
      durationMinutes = transformationDuration;
    } else {
      durationMinutes = parseInt(formDuration, 10) || 30;
    }

    // Zero validation
    if (durationMinutes <= 0) {
      durationMinutes = 30; // Min sensible block
    }

    const dateStr = format(focusedDate, 'yyyy-MM-dd');

    if (editingBlock) {
      // Modify existing block
      const updateData: Partial<ProductionPlanV2> = {
        type: formType,
        duration: durationMinutes,
        notes: formNotes,
        status: editingBlock.status,
        isChained: formIsChained,
        customStartTime: formCustomStartTime,
        calculationBasis: formCalcBasis
      };

      if (formType === 'production') {
        updateData.marca = formMarca;
        updateData.tamano = formTamano;
        updateData.sabor = formSabor;
        updateData.plannedPacks = packsNum;
        updateData.velocidad = speedNum;
        updateData.isNoSyrup = isNoSyrup;
        updateData.label = undefined;
      } else {
        updateData.label = formType === 'flavor_change' ? 'Cambio de Sabor' : (formType === 'transformation' ? 'Transformación' : formLabel);
        updateData.marca = undefined;
        updateData.tamano = undefined;
        updateData.sabor = undefined;
        updateData.plannedPacks = undefined;
        updateData.velocidad = undefined;
      }

      try {
        await updateDoc(doc(db, 'production_plans_v2', editingBlock.id!), updateData);
      } catch (err) {
        console.error("Error updating production plan block:", err);
      }
    } else {
      // Create new sequence block at the end
      const linePlansCount = plannedBlocks.filter(p => p.linea === addingToLine).length;
      const orderIndex = linePlansCount > 0 ? Math.max(...plannedBlocks.filter(p => p.linea === addingToLine).map(p => p.orderIndex)) + 1 : 0;

      const newBlock: Omit<ProductionPlanV2, 'id'> = {
        date: dateStr,
        linea: addingToLine,
        orderIndex,
        type: formType,
        duration: durationMinutes,
        notes: formNotes,
        status: 'Draft',
        createdAt: new Date().toISOString(),
        authorId: auth.currentUser?.uid || '',
        isChained: formIsChained,
        customStartTime: formCustomStartTime,
        calculationBasis: formCalcBasis
      };

      if (formType === 'production') {
        newBlock.marca = formMarca;
        newBlock.tamano = formTamano;
        newBlock.sabor = formSabor;
        newBlock.plannedPacks = packsNum;
        newBlock.velocidad = speedNum;
        newBlock.isNoSyrup = isNoSyrup;
      } else {
        newBlock.label = formType === 'flavor_change' ? 'Cambio de Sabor' : (formType === 'transformation' ? 'Transformación' : formLabel);
      }

      try {
        await addDoc(collection(db, 'production_plans_v2'), newBlock);
      } catch (err) {
        console.error("Error adding production plan block:", err);
      }
    }

    handleCloseForm();
  };

  // Delete production block
  const handleDeleteBlock = async (id: string, line: string) => {
    try {
      await deleteDoc(doc(db, 'production_plans_v2', id));

      // Fetch surviving plans to resequence index values nicely
      const remainingPlans = plannedBlocks.filter(p => p.id !== id && p.linea === line);
      const batch = writeBatch(db);
      
      remainingPlans.forEach((plan, index) => {
        batch.update(doc(db, 'production_plans_v2', plan.id!), {
          orderIndex: index
        });
      });
      await batch.commit();

    } catch (err) {
      console.error("Error deleting block:", err);
    }
  };

  // RESEQUENCING SWAPER (UP/DOWN)
  const handleSwapSequence = async (index: number, direction: 'up' | 'down', line: string) => {
    const linePlans = plannedBlocks.filter(p => p.linea === line);
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === linePlans.length - 1) return;

    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const blockA = linePlans[index];
    const blockB = linePlans[targetIdx];

    if (!blockA.id || !blockB.id) return;

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'production_plans_v2', blockA.id), {
        orderIndex: blockB.orderIndex
      });
      batch.update(doc(db, 'production_plans_v2', blockB.id), {
        orderIndex: blockA.orderIndex
      });
      await batch.commit();
    } catch (err) {
      console.error("Error resequencing blocks:", err);
    }
  };

  // Publish line plan
  const handleTogglePublishLine = async (line: string, publish: boolean) => {
    const linePlans = plannedBlocks.filter(p => p.linea === line);
    if (linePlans.length === 0) return;

    try {
      const batch = writeBatch(db);
      linePlans.forEach(plan => {
        batch.update(doc(db, 'production_plans_v2', plan.id!), {
          status: publish ? 'Published' : 'Draft'
        });
      });
      await batch.commit();
    } catch (err) {
      console.error("Error toggling publish lines:", err);
    }
  };

  // Save general preconfigured times
  const handleSaveStandarddurations = async () => {
    if (isAdmin) {
      try {
        await setDoc(doc(db, 'config', 'production'), {
          v2_flavorChangeDuration: flavorChangeDuration,
          v2_transformationDuration: transformationDuration,
          v2_packsPerShiftMatrix: packsPerShiftMatrix,
          v2_defaultCalcBasis: defaultCalcBasis
        }, { merge: true });
        try { window.alert("Configuración estandar guardada."); } catch(e) {}
      } catch (err) {
        console.error(err);
        try { window.alert("Fallo al guardar."); } catch(e) {}
      }
    } else {
      try { window.alert("Solo administradores pueden persistir la configuración de fábrica."); } catch (e) {}
    }
  };

  // CONSOLIDATED PLAN VS REAL METRICS DETAILED ESTIMATOR
  const planVsRealMetrics = useMemo(() => {
    const metrics: Record<string, {
      plannedPacks: number;
      actualPacks: number;
      plannedMinutes: number;
      actualMinutes: number;
    }> = {};

    // Key format: "Line-Brand-Size-Flavor"
    availableLines.forEach(line => {
      // 1. Accumulate Planned values
      const lineTimeline = processedLinesScheduler[line]?.plannedTimeline || [];
      lineTimeline.forEach(block => {
        if (block.type !== 'production') return;
        const key = `${line}-${block.marca}-${block.tamano}-${block.sabor}`;
        if (!metrics[key]) {
          metrics[key] = { plannedPacks: 0, actualPacks: 0, plannedMinutes: 0, actualMinutes: 0 };
        }
        metrics[key].plannedPacks += block.plannedPacks || 0;
        metrics[key].plannedMinutes += block.duration || 0;
      });

      // 2. Accumulate Actual matching data
      const lineActuals = processedLinesScheduler[line]?.actualTimeline || [];
      lineActuals.forEach(block => {
        const key = `${line}-${block.report.marca || 'Torasso'}-${block.tamano}-${block.sabor}`;
        if (!metrics[key]) {
          metrics[key] = { plannedPacks: 0, actualPacks: 0, plannedMinutes: 0, actualMinutes: 0 };
        }
        metrics[key].actualPacks += block.paquetes || 0;
        metrics[key].actualMinutes += block.duration || 0;
      });
    });

    return Object.entries(metrics).map(([key, data]) => {
      const [line, marca, tamanoStr, sabor] = key.split('-');
      const tamano = parseInt(tamanoStr, 10);
      return {
        line,
        marca,
        tamano,
        sabor,
        ...data,
        packsDeviation: data.actualPacks - data.plannedPacks,
        packsFulfillment: data.plannedPacks > 0 ? (data.actualPacks / data.plannedPacks) * 100 : 0
      };
    });
  }, [processedLinesScheduler, availableLines]);

  return (
    <div className="space-y-6">
      {/* HEADER CONTROLS */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-600">
              <CalendarDays className="w-5 h-5 animate-pulse" />
            </span>
            <div>
              <h1 className="text-xl font-bold font-sans text-slate-800 tracking-tight">Planificador por Packs avanzado (v2)</h1>
              <p className="text-xs text-slate-500 font-mono">Secuencia cronológica encadenada • Plan vs Real</p>
            </div>
          </div>
        </div>

        {/* TABS SELECTOR */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('scheduler')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-sans transition-all border ${
              activeTab === 'scheduler'
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-100'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Clock className="w-4 h-4" />
            Planificación y Gantt
          </button>
          
          <button
            onClick={() => setActiveTab('projection')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-sans transition-all border ${
              activeTab === 'projection'
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-100'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Package className="w-4 h-4" />
            Stock y Cobertura
          </button>

          <button
            onClick={() => setActiveTab('config')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-sans transition-all border ${
              activeTab === 'config'
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-100'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Settings2 className="w-4 h-4" />
            Configuración de Tiempos
          </button>
        </div>
      </div>

      {activeTab === 'projection' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm overflow-hidden">
          <SchedulerStockProjection />
        </div>
      )}

      {activeTab === 'config' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6 max-w-2xl">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <Sliders className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-bold text-slate-800">Duración Estándar de Eventos Auxiliares</h3>
              <p className="text-xs text-slate-500">Tiempos por defecto asignados al insertar eventos auxiliares en la línea.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                Cambio de Sabor (Minutos)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={flavorChangeDuration}
                  onChange={(e) => setFlavorChangeDuration(Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 font-mono focus:outline-indigo-500"
                />
                <span className="text-xs text-slate-400 font-bold uppercase min-w-[50px]">mins</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                Transformación de Formato (Minutos)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={transformationDuration}
                  onChange={(e) => setTransformationDuration(Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 font-mono focus:outline-indigo-500"
                />
                <span className="text-xs text-slate-400 font-bold uppercase min-w-[50px]">mins</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                Base de Calculo de Tiempo (Defecto)
              </label>
              <select
                value={defaultCalcBasis}
                onChange={(e) => setDefaultCalcBasis(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 bg-white"
              >
                <option value="theoretical">Automático por Ciclo (Teórica)</option>
                <option value="default">{`Turno de 8hs - Estándar Fijo`}</option>
                <option value="historical">{`Turno de 8hs - Histórico Promedio 30 días`}</option>
              </select>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h3 className="text-sm font-bold text-slate-800 mb-4">Producción Estándar por Calibre (Packs / Turno 8hs)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {getFilteredSizes().map(sz => {
                const sizeKey = sz.toString();
                return (
                <div key={sizeKey}>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    {sizeKey} cc
                  </label>
                  <input
                    type="number"
                    value={packsPerShiftMatrix[sizeKey] || ''}
                    onChange={(e) => setPacksPerShiftMatrix({...packsPerShiftMatrix, [sizeKey]: parseInt(e.target.value) || 0})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-700"
                  />
                </div>
              )})}
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100">
            <button
              onClick={handleSaveStandarddurations}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all"
            >
              Guardar Configuración Fábrica
            </button>
          </div>
        </div>
      )}

      {activeTab === 'scheduler' && (
        <div className="space-y-6">
          {/* WEEK CALENDAR DAYS SWITCHER */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <ChevronLeft
                  onClick={() => handleNavDay(-7)}
                  className="p-1 bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-lg cursor-pointer w-7 h-7 transition-colors"
                />
                <h4 className="text-sm font-bold font-sans text-slate-800">
                  Semana del {format(weekDaysList[0], "d 'de' MMMM", { locale: es })}
                </h4>
                <ChevronRight
                  onClick={() => handleNavDay(7)}
                  className="p-1 bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-lg cursor-pointer w-7 h-7 transition-colors"
                />
              </div>

              {/* FOCUSED DAY BADGE */}
              <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-1.5 rounded-lg text-xs font-bold">
                Hoy: {format(new Date(), "EEEE dd 'de' MMMM", { locale: es }).toUpperCase()}
              </div>
            </div>

            {/* WEEKLY BUTTONS STRIP */}
            <div className="grid grid-cols-7 gap-2 pt-4">
              {weekDaysList.map((day, idx) => {
                const isSelected = format(day, 'yyyy-MM-dd') === format(focusedDate, 'yyyy-MM-dd');
                const isTodayDate = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectDayFromWeek(day)}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-100'
                        : isTodayDate
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      {format(day, 'EEE', { locale: es })}
                    </span>
                    <span className="text-sm font-extrabold font-mono mt-0.5">
                      {format(day, 'd')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* FOCUS DATE SUMMARY BANNER */}
          <div className="bg-indigo-900 text-white border-b-2 border-indigo-950 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="text-[10px] font-mono font-bold text-indigo-200 uppercase tracking-widest block">Día enfocado para planificación</span>
              <p className="text-base font-extrabold font-sans tracking-tight">
                {format(focusedDate, 'EEEE d, MMMM yyyy', { locale: es }).toUpperCase()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFocusedDate(new Date())}
                className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-indigo-100 hover:text-white px-3 py-1.5 border border-white/10 rounded-lg text-xs font-bold transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Ir a hoy
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white border border-slate-200 rounded-xl">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <p className="text-xs text-slate-400 font-mono mt-3">Cargando cronograma...</p>
            </div>
          ) : (
            <div className="space-y-6">
              
              {/* VIRTUALIZED CONTINUOUS GANTT CHART */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4 overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500 animate-spin" />
                    Comparativo Gantt: Plan vs Real
                  </h3>
                  <p className="text-[10px] text-slate-400 font-mono align-middle">
                    Barra Superior: Planificado (Sólida) • Barra Inferior: Real (Bicolor)
                  </p>
                </div>

                {/* TIMELINES CONTAINER LIST */}
                <div className="space-y-6">
                  {availableLines.map(line => {
                    const lineStart = lineStartHours[line] || '06:00';
                    const timeline = processedLinesScheduler[line] || { plannedTimeline: [], actualTimeline: [] };
                    
                    // Simple grid offsets
                    const totalMinutesInDay = 24 * 60;

                    return (
                      <div key={line} className="space-y-2 border-b border-dashed border-slate-100 pb-4 last:border-0 last:pb-0">
                        {/* LINE IDENTIFIER HEADER */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-slate-800 uppercase tracking-widest px-2.5 py-1 bg-indigo-50 border border-indigo-100 rounded-lg">
                            Línea {line}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">
                            Inicio físico: {lineStart} hs
                          </span>
                        </div>

                        {/* HIGHLY VISUAL GANTT TRACKS ROW CONTAINER */}
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <div className="relative bg-slate-50 p-4 h-36 flex flex-col justify-between min-w-[1200px]">
                          
                          {/* GRID TIME LABELS BACKGROUND MARKERS */}
                          <div className="absolute inset-x-0 top-0 bottom-0 pointer-events-none flex justify-between px-4">
                            {Array.from({ length: 9 }).map((_, i) => {
                              const [sh, sm] = lineStart.split(':').map(Number);
                              const totalMins = sh * 60 + sm + (i * 180); // every 3 hours
                              const hrNum = Math.floor((totalMins / 60) % 24);
                              const minNum = Math.floor(totalMins % 60);
                              const timeStr = `${hrNum.toString().padStart(2, '0')}:${minNum.toString().padStart(2, '0')}`;
                              
                              return (
                                <div key={i} className="flex flex-col items-center h-full border-l border-slate-200/50">
                                  <span className="text-[9px] text-slate-400 font-mono mt-1 font-bold">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {/* PLAN TRACK ROW */}
                          <div className="relative h-10 bg-slate-100/60 rounded-lg border border-slate-200/50 flex items-center z-10 w-full">
                            <span className="absolute left-2 text-[9px] font-bold text-slate-400 pointer-events-none uppercase">Plan</span>
                            
                            {timeline.plannedTimeline.map((block, idx) => {
                              const pctWidth = (block.duration / totalMinutesInDay) * 100;
                              const pctLeft = (block.startOffsetMinutes / totalMinutesInDay) * 100;
                              const col = block.type === 'production' ? (FLAVOR_COLORS[block.sabor || ''] || '#6366f1') : '#cbd5e1';

                              return (
                                <div
                                  key={idx}
                                  style={{
                                    left: `${pctLeft}%`,
                                    width: `${pctWidth}%`,
                                    position: 'absolute'
                                  }}
                                  className="h-[28px] max-h-full rounded border flex flex-col justify-center px-1.5 overflow-hidden shadow-sm transition-all hover:scale-[1.02] cursor-help"
                                  title={`Plan: ${block.type === 'production' ? `${block.marca} ${block.sabor} ${block.tamano}ml` : block.label} | ${block.startTimeStr} - ${block.endTimeStr}`}
                                >
                                  <div
                                    style={{ borderLeftColor: col, backgroundColor: `${col}25`, position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
                                    className="absolute inset-0 border-l-4 opacity-80"
                                  />
                                  <p className="text-[10px] font-extrabold text-slate-900 tracking-tight truncate relative z-10 font-sans mix-blend-multiply">
                                    {block.type === 'production' ? `${block.sabor} ${block.tamano}` : block.label}
                                  </p>
                                  <p className="text-[9px] font-bold text-slate-700 font-mono relative z-10 leading-3 mix-blend-multiply">
                                    {block.plannedPacks ? `${block.plannedPacks}p` : `${block.duration}m`}
                                  </p>
                                </div>
                              );
                            })}
                          </div>

                          {/* REAL PRODUCTION RUNS TRACK ROW */}
                          <div className="relative h-10 bg-slate-100/60 rounded-lg border border-slate-200/50 flex items-center z-10 w-full mt-2">
                            <span className="absolute left-2 text-[9px] font-bold text-slate-400 pointer-events-none uppercase">Real</span>

                            {timeline.actualTimeline.map((act, idx) => {
                              const pctWidth = (act.duration / totalMinutesInDay) * 100;
                              const pctLeft = (act.startOffsetMinutes / totalMinutesInDay) * 100;
                              const col = FLAVOR_COLORS[act.sabor || ''] || '#14b8a6';

                              return (
                                <div
                                  key={idx}
                                  style={{
                                    left: `${pctLeft}%`,
                                    width: `${pctWidth}%`,
                                    position: 'absolute'
                                  }}
                                  className="h-[28px] max-h-full rounded border bg-teal-50 flex flex-col justify-center px-1.5 overflow-hidden shadow-sm border-teal-200 cursor-help"
                                  title={`Real: ${act.sabor} ${act.tamano}cc | ${act.startTimeStr} - ${act.endTimeStr}`}
                                >
                                  <div
                                    style={{ borderLeftColor: col, backgroundColor: `${col}25`, position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
                                    className="absolute inset-0 border-l-4 opacity-80"
                                  />
                                  <p className="text-[9px] font-bold text-teal-950 truncate relative z-10 font-sans">
                                    {act.sabor} {act.tamano}
                                  </p>
                                  <p className="text-[8px] font-extrabold text-teal-700 font-mono truncate relative z-10 leading-3">
                                    {act.paquetes} packs
                                  </p>
                                </div>
                              );
                            })}
                          </div>

                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* DETAILED LINES MANAGEMENT AND PLANNING TIMELINE */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {availableLines.map(line => {
                  const linePlans = plannedBlocks.filter(p => p.linea === line);
                  const startHour = lineStartHours[line] || '06:00';
                  const isAdding = addingToLine === line && !editingBlock;

                  return (
                    <div key={line} className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
                      
                      {/* ACCORDION TRIGGER HEADER */}
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse"></span>
                          <h3 className="text-base font-bold text-slate-800">Línea {line}</h3>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* LINE START HOUR PICKER */}
                          <div className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <select
                              value={startHour}
                              onChange={(e) => handleSaveLineStartHour(line, e.target.value)}
                              className="px-1.5 py-0.5 border border-slate-200 rounded text-xs text-slate-700 font-mono font-bold focus:outline-none"
                            >
                              {Array.from({ length: 24 }).map((_, h) => {
                                const valStr = `${h.toString().padStart(2, '0')}:00`;
                                return <option key={h} value={valStr}>{valStr}</option>;
                              })}
                            </select>
                          </div>

                          {/* QUICK ADD BUTTON */}
                          <button
                            onClick={() => handleOpenAddForm(line)}
                            className="p-1 px-2.5 bg-indigo-50 border border-indigo-100 hover:bg-indigo-600 text-indigo-700 hover:text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" />
                            Item
                          </button>
                        </div>
                      </div>

                      {/* PUBLISHED LINE PLAN STATUS ACTIONS */}
                      {linePlans.length > 0 && (
                        <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200/60 rounded-lg">
                          <span className="text-[10px] font-mono font-bold text-slate-400">
                            Estado: {linePlans[0].status === 'Published' ? '✅ PUBLICADO' : '📝 BORRADOR'}
                          </span>
                          
                          <button
                            onClick={() => handleTogglePublishLine(line, linePlans[0].status !== 'Published')}
                            className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                              linePlans[0].status === 'Published'
                                ? 'bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100'
                                : 'bg-emerald-600 border border-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                          >
                            {linePlans[0].status === 'Published' ? 'Volver a Borrador' : 'Publicar Línea'}
                          </button>
                        </div>
                      )}

                      {/* DYNAMIC SEQUENCE FORM COMPONENT INLINE */}
                      {addingToLine === line && (
                        <form onSubmit={handleSubmitBlock} className="bg-slate-50 border border-indigo-100 rounded-xl p-4 gap-4 space-y-3">
                          <div className="flex items-center justify-between border-b border-indigo-100/40 pb-2">
                            <span className="text-xs font-extrabold text-indigo-800 uppercase tracking-widest flex items-center gap-1">
                              <ClipboardList className="w-3.5 h-3.5" />
                              {editingBlock ? 'Editar Bloque de Línea' : 'Nuevo Bloque de Línea'}
                            </span>
                            <button
                              type="button"
                              onClick={handleCloseForm}
                              className="text-[10px] font-bold text-slate-400 hover:text-slate-600"
                            >
                              Cancelar
                            </button>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Tipo de Bloque</label>
                            <div className="grid grid-cols-2 gap-1.5">
                              {[
                                { id: 'production', label: 'Producción' },
                                { id: 'flavor_change', label: 'Cambio Sabor' },
                                { id: 'transformation', label: 'Transformación' },
                                { id: 'other', label: 'Otro Evento' }
                              ].map(t => (
                                <button
                                  key={t.id}
                                  type="button"
                                  onClick={() => setFormType(t.id as any)}
                                  className={`py-1.5 px-1.5 rounded-lg border text-[10px] font-bold uppercase text-center transition-all ${
                                    formType === t.id
                                      ? 'bg-indigo-600 border-indigo-600 text-white font-extrabold'
                                      : 'bg-white border-slate-200 text-slate-600'
                                  }`}
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* CONDITIONAL COMPONENT INPUTS */}
                          {formType === 'production' ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Marca</label>
                                  <select
                                    value={formMarca}
                                    onChange={(e) => setFormMarca(e.target.value)}
                                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 bg-white"
                                  >
                                    {availableBrands.map(bm => <option key={bm} value={bm}>{bm}</option>)}
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Tamaño (cc)</label>
                                  <select
                                    value={formTamano}
                                    onChange={(e) => setFormTamano(parseInt(e.target.value, 10))}
                                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold font-mono text-slate-700 bg-white"
                                  >
                                    {availableSizesForAdding.map(sz => <option key={sz} value={sz}>{sz} cc</option>)}
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Sabor</label>
                                <select
                                  value={formSabor}
                                  onChange={(e) => setFormSabor(e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 bg-white"
                                >
                                  {availableFlavorsForBrandAndSize.map(fb => <option key={fb} value={fb}>{fb}</option>)}
                                </select>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Cantidad Packs</label>
                                  <input
                                    type="number"
                                    value={formPacks}
                                    onChange={(e) => setFormPacks(e.target.value)}
                                    placeholder="Cant. packs"
                                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700 bg-white"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Velocidad (BPM)</label>
                                  <input
                                    type="number"
                                    value={formVelocidad}
                                    onChange={(e) => setFormVelocidad(e.target.value)}
                                    placeholder="Botellas/min"
                                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700 bg-white"
                                  />
                                </div>
                              </div>

                              {/* LIVE AUTOMATIC ESTIMATION FOR HUMAN FEEDBACK */}
                              <div className="bg-slate-100 p-2 border border-slate-200/50 rounded-lg text-center text-[10px] font-mono text-slate-600">
                                <span className="font-extrabold uppercase block tracking-wider text-slate-500 mb-0.5">Estimado de Producción</span>
                                Packs: <span className="font-bold text-slate-800">{parseInt(formPacks) || 0}</span> • Botellas: <span className="font-bold text-slate-800">{(parseInt(formPacks) || 0) * (BOTELLAS_POR_PACK[formTamano] || 6)}</span> • Tiempo: <span className="font-extrabold text-indigo-600">{Math.round(((parseInt(formPacks) || 0) * (BOTELLAS_POR_PACK[formTamano] || 6) / (parseInt(formVelocidad) || 60)))} mins (~{(((parseInt(formPacks) || 0) * (BOTELLAS_POR_PACK[formTamano] || 6) / (parseInt(formVelocidad) || 60)) / 60).toFixed(1)} hs)</span>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {formType === 'other' && (
                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Descripción del Evento</label>
                                  <input
                                    type="text"
                                    value={formLabel}
                                    onChange={(e) => setFormLabel(e.target.value)}
                                    placeholder="Ej: Mantenimiento preventivo"
                                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 bg-white"
                                  />
                                </div>
                              )}

                              <div>
                                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                                  {formType === 'flavor_change' ? 'Duración estándar (Cambio sabor)' : (formType === 'transformation' ? 'Duración de plantilla (Formato)' : 'Duración en minutos')}
                                </label>
                                <input
                                  type="number"
                                  value={formType === 'flavor_change' ? flavorChangeDuration : (formType === 'transformation' ? transformationDuration : formDuration)}
                                  onChange={(e) => {
                                    if (formType === 'other') setFormDuration(e.target.value);
                                  }}
                                  disabled={formType !== 'other'}
                                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700 bg-slate-100 disabled:text-slate-500 disabled:opacity-80"
                                />
                              </div>
                            </div>
                          )}

                          {/* CUSTOM SCHEDULE CONFIGURATION */}
                          <div className="bg-slate-100 p-3 rounded-lg border border-slate-200">
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-[10px] font-bold uppercase text-slate-500">¿Encadenar al anterior?</label>
                              <div className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={formIsChained}
                                  onChange={(e) => setFormIsChained(e.target.checked)}
                                  className="w-4 h-4 text-indigo-600 rounded border-slate-300"
                                />
                                <span className="text-[10px] font-bold text-slate-700">Automático</span>
                              </div>
                            </div>
                            {!formIsChained && (
                              <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-200 pt-2">
                                <label className="text-[10px] font-bold uppercase text-slate-500">Hora de inicio manual:</label>
                                <input
                                  type="time"
                                  value={formCustomStartTime}
                                  onChange={(e) => setFormCustomStartTime(e.target.value)}
                                  className="px-2 py-1 rounded-md border border-slate-300 text-xs font-mono"
                                />
                              </div>
                            )}
                          </div>

                          {/* CALCULATION BASIS (ONLY PRODUCTION) */}
                          {formType === 'production' && (
                            <div className="bg-slate-100 p-3 rounded-lg border border-slate-200">
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Base de cálculo del tiempo</label>
                              <select
                                value={formCalcBasis}
                                onChange={(e) => setFormCalcBasis(e.target.value as any)}
                                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 focus:outline-indigo-500"
                              >
                                <option value="theoretical">Velocidad de línea (Teórica)</option>
                                <option value="default">{`Producción por defecto por turno (Configuración)`}</option>
                                <option value="historical">{`Promedio por turno (Histórico Últimos 30 días)`}</option>
                                <option value="manual">Manual (Ingreso en minutos)</option>
                              </select>
                              
                              {formCalcBasis === 'manual' && (
                                <div className="mt-2">
                                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Duración (minutos)</label>
                                  <input
                                    type="number"
                                    value={formDuration}
                                    onChange={(e) => setFormDuration(e.target.value)}
                                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-700"
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Notas / Observaciones</label>
                            <textarea
                              value={formNotes}
                              onChange={(e) => setFormNotes(e.target.value)}
                              placeholder="Opcional..."
                              rows={1}
                              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white"
                            />
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="submit"
                              className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                            >
                              {editingBlock ? 'Guardar Cambios' : 'Insertar Bloque'}
                            </button>
                            <button
                              type="button"
                              onClick={handleCloseForm}
                              className="py-1.5 px-3 bg-slate-200 hover:bg-slate-300 text-slate-755 border border-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                            >
                              Cerrar
                            </button>
                          </div>
                        </form>
                      )}

                      {/* CHRONOLOGICAL LIST OF STACKED BLOCKS */}
                      <div className="space-y-2">
                        {(processedLinesScheduler[line]?.plannedTimeline || []).length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-10 bg-slate-50/50 border border-dashed border-slate-200 rounded-xl text-center">
                            <Info className="w-5 h-5 text-slate-400 mb-1" />
                            <p className="text-[11px] text-slate-500 font-bold uppercase">Sin programación</p>
                            <p className="text-[10px] text-slate-400">Inserta un nuevo item para comenzar.</p>
                          </div>
                        ) : (
                          (processedLinesScheduler[line]?.plannedTimeline || []).map((block, idx) => {
                            const isProduct = block.type === 'production';
                            const saborColor = isProduct ? FLAVOR_COLORS[block.sabor || ''] : '#e2e8f0';

                            return (
                              <div
                                key={block.id}
                                className={`group relative border border-slate-200 rounded-xl p-3.5 flex flex-col gap-2.5 transition-all hover:border-slate-300 ${
                                  block.status === 'Published' ? 'bg-gradient-to-r from-emerald-50/20 to-transparent border-emerald-100' : 'bg-white'
                                }`}
                              >
                                {/* BLOCK HIGHLIGHT CHRONOLOGICAL TIMES AND COLOR ACCENT */}
                                <div className="flex items-start justify-between">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="w-2.5 h-6 rounded-md"
                                      style={{ backgroundColor: saborColor }}
                                    />
                                    <div>
                                      <p className="text-xs font-extrabold text-slate-800 tracking-tight">
                                        {isProduct ? `${block.marca} ${block.sabor} ${block.tamano}ml` : block.label}
                                      </p>
                                      
                                      <p className="text-[10px] font-bold text-slate-500 font-mono flex items-center gap-1 mt-0.5">
                                        <Clock className="w-3 h-3 text-slate-400" />
                                        <span>{block.startTimeStr} - {block.endTimeStr}</span>
                                        <span className="text-[9px] text-indigo-500 bg-indigo-50/50 px-1.5 py-0.2 rounded-md font-extrabold">
                                          {(block.duration / 60).toFixed(1)}hs
                                        </span>
                                      </p>
                                    </div>
                                  </div>

                                  {/* BLOCK ACTIONS: UP / DOWN / TRASH / EDIT */}
                                  <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => handleSwapSequence(idx, 'up', line)}
                                      disabled={idx === 0}
                                      className="p-1 text-slate-400 hover:text-slate-700 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100"
                                      title="Subir"
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                    </button>

                                    <button
                                      onClick={() => handleSwapSequence(idx, 'down', line)}
                                      disabled={idx === (processedLinesScheduler[line]?.plannedTimeline || []).length - 1}
                                      className="p-1 text-slate-400 hover:text-slate-700 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100"
                                      title="Bajar"
                                    >
                                      <ArrowDown className="w-3 h-3" />
                                    </button>

                                    <button
                                      onClick={() => handleOpenEditForm(block)}
                                      className="p-1 text-indigo-500 hover:text-indigo-700 bg-indigo-50/50 border border-indigo-100 rounded"
                                      title="Editar"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>

                                    <button
                                      onClick={() => handleDeleteBlock(block.id!, line)}
                                      className="p-1 text-rose-500 hover:text-rose-700 bg-rose-50/50 border border-rose-100 rounded"
                                      title="Eliminar"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>

                                {/* BLOCK SPECIFIC PRODUCTION INFO */}
                                {isProduct && (
                                  <div className="grid grid-cols-3 gap-2 bg-slate-50/50 rounded-lg p-2 border border-slate-100 text-center font-mono">
                                    <div>
                                      <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 block">Packs</span>
                                      <p className="text-[10px] font-extrabold text-slate-700">{block.plannedPacks}</p>
                                    </div>
                                    <div>
                                      <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 block">Speed (BPM)</span>
                                      <p className="text-[10px] font-extrabold text-slate-700">{block.velocidad}</p>
                                    </div>
                                    <div>
                                      <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 block">Botellas</span>
                                      <p className="text-[10px] font-extrabold text-slate-700">{(block.plannedPacks || 0) * (BOTELLAS_POR_PACK[block.tamano || 1500] || 6)}</p>
                                    </div>
                                  </div>
                                )}

                                {/* NOTES OR MEMO */}
                                {block.notes && (
                                  <p className="text-[10px] text-slate-500 bg-amber-50/50 p-2 border border-dashed border-amber-100 rounded-lg">
                                    <span className="font-bold text-amber-700">Nota:</span> {block.notes}
                                  </p>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>

              {/* DETAILED PLAN VS REAL VALUE COMPARISON MATRIX */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-4">
                  <TrendingUp className="w-5 h-5 text-indigo-600 animate-pulse" />
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Comparativa de Producción: Plan vs Real</h3>
                    <p className="text-xs text-slate-500">Métricas acumuladas del día para contrastar rendimiento del plan de packs.</p>
                  </div>
                </div>

                {planVsRealMetrics.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 font-mono text-xs">
                    No hay productos planificados ni registrados para comparar en este día.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse font-sans">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                          <th className="py-3 px-4">Línea</th>
                          <th className="py-3 px-4">Producto (Sabor + Tamaño)</th>
                          <th className="py-3 px-4 text-center">Packs Plan</th>
                          <th className="py-3 px-4 text-center">Packs Real</th>
                          <th className="py-3 px-4 text-center">Desviación Packs</th>
                          <th className="py-3 px-4 text-center">Cumplimiento</th>
                          <th className="py-3 px-4 text-center">Duración Plan</th>
                          <th className="py-3 px-4 text-center">Duración Real</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs text-slate-600">
                        {planVsRealMetrics.map((met, idx) => {
                          const badDeviation = met.packsDeviation < 0;
                          const devColor = met.packsDeviation === 0 ? 'text-slate-500' : (badDeviation ? 'text-rose-600' : 'text-emerald-600');
                          const devSymbol = met.packsDeviation > 0 ? `+` : ``;

                          return (
                            <tr key={idx} className="hover:bg-slate-50/50 font-medium">
                              <td className="py-3 px-4">
                                <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold font-mono">
                                  L{met.line}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-bold text-slate-800">
                                {met.marca} {met.sabor} {met.tamano}cc
                              </td>
                              <td className="py-3 px-4 text-center font-mono font-bold text-slate-700">
                                {met.plannedPacks}
                              </td>
                              <td className="py-3 px-4 text-center font-mono font-bold text-slate-700">
                                {met.actualPacks}
                              </td>
                              <td className={`py-3 px-4 text-center font-mono font-bold ${devColor}`}>
                                {devSymbol}{met.packsDeviation}
                              </td>
                              <td className="py-3 px-4 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  met.packsFulfillment >= 95 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                  met.packsFulfillment >= 75 ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                                  'bg-rose-50 text-rose-700 border border-rose-100'
                                }`}>
                                  {met.packsFulfillment.toFixed(1)}%
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center font-mono text-slate-500">
                                {(met.plannedMinutes / 60).toFixed(1)} hs
                              </td>
                              <td className="py-3 px-4 text-center font-mono text-slate-500">
                                {(met.actualMinutes / 60).toFixed(1)} hs
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
}
