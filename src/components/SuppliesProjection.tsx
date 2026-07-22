import React, { useState, useMemo, useCallback } from 'react';
import { collection, query, where, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppConfig } from '../hooks/useAppConfig';
import { MonthlyGoal, InsumosTransit } from '../types';
import { BOTELLAS_POR_PACK, PACKS_POR_PALETA, WASTE_WEIGHTS } from '../constants';
import { format, parseISO, addMonths, startOfMonth, addDays, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { TrendingDown, Calendar, Database, FlaskConical, BarChart3, Package, X, Plus, Trash2, AlertTriangle, CheckCircle2, Clock, ArrowRight, ChevronRight, CalendarDays, TrendingUp, Info, AlertCircle } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

interface InsumosGrouped {
  name: string;
  originalNames: string[];
  category: string;
  monthlyReq: Record<string, number>; 
}

const formatIsoDateStr = (dateStr: string) => {
  if (!dateStr) return 'S/D';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

export function SuppliesProjection() {
  const { config } = useAppConfig();
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [stockData, setStockData] = useState<any[]>([]);
  const [insumoMappings, setInsumoMappings] = useState<Record<string, string>>({});
  const [etiquetasMappings, setEtiquetasMappings] = useState<Record<string, string>>({});
  const [separatedSupplies, setSeparatedSupplies] = useState<Record<string, number>>({});
  const [showSeparatedModal, setShowSeparatedModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'proyeccion' | 'consumo' | 'quiebre'>('proyeccion');
  const [selectedInsumoName, setSelectedInsumoName] = useState<string | null>(null);
  const [includeTransitGlobally, setIncludeTransitGlobally] = useState<boolean>(true);
  const [chartScaleMonths, setChartScaleMonths] = useState<number>(3);
  const [quiebreSearchQuery, setQuiebreSearchQuery] = useState<string>('');
  const [sortConfig, setSortConfig] = useState<{ field: string, asc: boolean }>({ field: 'etaDate', asc: true });
  const [sortConfigConsumo, setSortConfigConsumo] = useState<{ field: string, asc: boolean }>({ field: 'name', asc: true });
  const [transits, setTransits] = useState<InsumosTransit[]>([]);
  const [excludeJuiceAndSugar, setExcludeJuiceAndSugar] = useState<boolean>(true);
  const [overdueDelayDays, setOverdueDelayDays] = useState<number>(5);

  const planningMonths = useMemo(() => {
    const list = [];
    const baseDate = new Date();
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    for (let i = 0; i < 6; i++) {
        list.push(format(addMonths(start, i), 'yyyy-MM'));
    }
    return list;
  }, []);

  // Helper functions
  const getPackingCategory = useCallback((insumoName: string) => {
    if (config?.insumosCategories?.[insumoName]) {
      return config.insumosCategories[insumoName];
    }
    const lower = insumoName.toLowerCase();
    if (lower.includes('preforma')) return 'Preformas';
    if (lower.includes('tapa')) return 'Tapas';
    if (lower.includes('cabezal')) return 'Cabezales Sifón';
    if (lower.includes('termo')) return 'Termocontraíble';
    if (lower.includes('stretch')) return 'Film Stretch';
    if (lower.includes('etiqueta')) return 'Etiquetas';
    if (lower.includes('azúcar') || lower.includes('azucar')) return 'Materia Prima';
    return 'Otros Insumos';
  }, [config?.insumosCategories]);

  const findPreformaForProduct = useCallback((tam: number, lin: string, sabor: string) => {
    const list = config?.preformasConfig || [];
    const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
    return list.find(p => (p.sizes || []).includes(tam) && p.line && p.line.toString() === lin.toString() && matchFlavor(p)) ||
           list.find(p => (p.sizes || []).includes(tam) && !p.line && matchFlavor(p)) ||
           list.find(p => (p.sizes || []).includes(tam) && matchFlavor(p)) ||
           list.find(p => (p.sizes || []).includes(tam) && p.line && p.line.toString() === lin.toString()) ||
           list.find(p => (p.sizes || []).includes(tam));
  }, [config]);

  const findTermoForProduct = useCallback((tam: number, sabor: string) => {
    const list = config?.termoConfig || [];
    const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
    return list.find(p => (p.sizes || []).includes(tam) && matchFlavor(p)) || list.find(p => (p.sizes || []).includes(tam));
  }, [config]);

  const findStretchForProduct = useCallback((tam: number, sabor: string) => {
    const list = config?.stretchConfig || [];
    return list.find(p => (p.sizes || []).includes(tam)) || list[0];
  }, [config]);

  const findTapaForProduct = useCallback((tam: number, sabor: string) => {
    const list = config?.tapaConfig || [];
    const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
    return list.find(p => (p.sizes || []).includes(tam) && matchFlavor(p)) || list.find(p => (p.sizes || []).includes(tam));
  }, [config]);


  React.useEffect(() => {
    const startMonth = planningMonths[0];
    const endMonth = format(addMonths(parseISO(`${startMonth}-01`), 6), 'yyyy-MM');
    const qGoals = query(collection(db, 'monthly_goals'), where('month', '>=', startMonth), where('month', '<', endMonth));

    const unsubGoals = onSnapshot(qGoals, (snap) => {
      setGoals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MonthlyGoal)));
    });

    const unsubInsumos = onSnapshot(doc(db, 'config', 'sql_insumo_mappings'), (docSnap) => {                
        if (docSnap.exists()) setInsumoMappings(docSnap.data() as Record<string, string>);
    });

    const unsubEtiquetas = onSnapshot(doc(db, 'config', 'sql_etiquetas_mappings'), (docSnap) => {
        if (docSnap.exists()) setEtiquetasMappings(docSnap.data() as Record<string, string>);
    });

    const unsubSeparated = onSnapshot(doc(db, 'config', 'separated_supplies'), (docSnap) => {
        if (docSnap.exists()) {
            setSeparatedSupplies(docSnap.data() as Record<string, number>);
        } else {
            setSeparatedSupplies({});
        }
    });

    const unsubTransits = onSnapshot(query(collection(db, 'insumos_transits')), (snap) => {
      setTransits(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsumosTransit)));
    });

    fetch('/api/sql/insumosStock')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          const mappedStock = data.data.map((item: any) => ({
            insumo: item.nombre_articulo,
            codigo: item.codigo_articulo || '',
            amount: item.stock_final
          }));
          setStockData(mappedStock);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching insumos stock', err);
        setLoading(false);
      });

    return () => { unsubGoals(); unsubInsumos(); unsubEtiquetas(); unsubSeparated(); unsubTransits(); };
  }, [planningMonths]);

  const combinedData = useMemo(() => {
    if (!config) return { projection: [], consumption: {} };

    const requirementsByMonth: Record<string, Record<string, number>> = {};
    planningMonths.forEach(month => { requirementsByMonth[month] = {}; });

    goals.forEach(goal => {
      const { month, marca, sabor, tamano, quantity } = goal;
      if (!planningMonths.includes(month) || quantity <= 0 || !tamano || !marca || !sabor) return;

      const reqObj = requirementsByMonth[month];
      const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
      const beverageLiters = quantity * botellasPorPack * (tamano / 1000);
      const mixRatio = config.co2Volumes?.[marca]?.[sabor] !== undefined && config.co2Volumes?.[marca]?.[sabor] === 0 ? 1 : 5;
      const syrupLitersNeeded = beverageLiters / mixRatio;
      const unitsRequired = (config.syrupFormulas?.[marca]?.[sabor]?.liters || 0) > 0 ? (syrupLitersNeeded / config.syrupFormulas?.[marca]?.[sabor]?.liters) : 0;
      
      Object.keys(config.insumosMatrix?.[marca]?.[sabor] || {}).forEach(insName => {
        const kgPerUnit = config.insumosMatrix?.[marca]?.[sabor]?.[insName] || 0;
        if (kgPerUnit > 0) reqObj[insName] = (reqObj[insName] || 0) + (unitsRequired * kgPerUnit);
      });

      const preformasNeeded = quantity * botellasPorPack;
      const termoWeight = config?.wasteWeights?.[tamano.toString()]?.termo ?? WASTE_WEIGHTS[tamano]?.termo ?? 0;
      const termoNeededKg = quantity * termoWeight;
      const packsPerPaleta = PACKS_POR_PALETA[tamano] || 80;
      const stretchNeededKg = (quantity / packsPerPaleta) * 0.4;
      const tapasNeeded = preformasNeeded;

      reqObj[findPreformaForProduct(tamano, '', sabor)?.name || ''] = (reqObj[findPreformaForProduct(tamano, '', sabor)?.name || ''] || 0) + preformasNeeded;
      reqObj[findTermoForProduct(tamano, sabor)?.name || ''] = (reqObj[findTermoForProduct(tamano, sabor)?.name || ''] || 0) + termoNeededKg;
      reqObj[findStretchForProduct(tamano, sabor)?.name || ''] = (reqObj[findStretchForProduct(tamano, sabor)?.name || ''] || 0) + stretchNeededKg;
      reqObj[findTapaForProduct(tamano, sabor)?.name || ''] = (reqObj[findTapaForProduct(tamano, sabor)?.name || ''] || 0) + tapasNeeded;

      const isExternal = config?.externalProducts?.[marca]?.[tamano.toString()]?.includes(sabor);
      if (!isExternal) {
        reqObj[`Etiqueta ${marca} / ${sabor} / ${tamano}cc`] = (reqObj[`Etiqueta ${marca} / ${sabor} / ${tamano}cc`] || 0) + preformasNeeded;
      }
    });

    const combinedGroups = [
      ...(config?.compatibleInsumoGroups ? Object.values(config.compatibleInsumoGroups) : []),
      ...(config?.compatiblePackagingGroups ? Object.values(config.compatiblePackagingGroups) : [])
    ] as string[][];

    const finalItems: Record<string, InsumosGrouped> = {};
    planningMonths.forEach(month => {
        Object.keys(requirementsByMonth[month]).forEach(insumo => {
            if (!insumo) return;

            let groupKey = insumo;
            let groupNames = [insumo];
            const groupMatch = combinedGroups.find(g => g.includes(insumo));
            if (groupMatch) {
                groupKey = groupMatch.join(' / ');
                groupNames = groupMatch;
            }

            if (!finalItems[groupKey]) finalItems[groupKey] = { name: groupKey, originalNames: groupNames, category: getPackingCategory(insumo), monthlyReq: {} };
            planningMonths.forEach(m => finalItems[groupKey].monthlyReq[m] = finalItems[groupKey].monthlyReq[m] || 0);
            finalItems[groupKey].monthlyReq[month] = (finalItems[groupKey].monthlyReq[month] || 0) + requirementsByMonth[month][insumo];
        });
    });

    const items = Object.values(finalItems).filter(item => {
        if (excludeJuiceAndSugar) {
            const lowerName = item.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            if (lowerName.includes('azucar') || lowerName.includes('jugo')) {
                return false;
            }
        }
        return Object.values(item.monthlyReq).some(val => val > 0);
    });

    const getMappedCodes = (originalNames: string[]): string[] => {
        let allCodes: string[] = [];
        originalNames.forEach(itemName => {
            // 1. Insumo mappings
            if (insumoMappings[itemName]) allCodes.push(...String(insumoMappings[itemName]).split(',').map(c => c.trim().toLowerCase()));
            
            // 2. Etiquetas
            if (itemName.startsWith('Etiqueta ')) {
                const parts = itemName.replace('Etiqueta ', '').replace('cc', '').split(' / ');
                if (parts.length === 3) {
                    const key = `${parts[0]}-${parts[1]}-${parts[2]}`;
                    if (etiquetasMappings[key]) allCodes.push(...String(etiquetasMappings[key]).split(',').map(c => c.trim().toLowerCase()));
                }
            }

            // 3. Built-in configs
            const pref = (config?.preformasConfig || []).find(p => p.name === itemName);
            if (pref?.sqlCode) allCodes.push(...String(pref.sqlCode).split(',').map(c => c.trim().toLowerCase()));
            
            const tm = (config?.termoConfig || []).find(t => t.name === itemName);
            if (tm?.sqlCode) allCodes.push(...String(tm.sqlCode).split(',').map(c => c.trim().toLowerCase()));
            
            const st = (config?.stretchConfig || []).find(s => s.name === itemName);
            if (st?.sqlCode) allCodes.push(...String(st.sqlCode).split(',').map(c => c.trim().toLowerCase()));
            
            const tp = (config?.tapaConfig || []).find(t => t.name === itemName);
            if (tp?.sqlCode) allCodes.push(...String(tp.sqlCode).split(',').map(c => c.trim().toLowerCase()));
        });
        
        return Array.from(new Set(allCodes));
    };

    const projectionResults = items.map(item => {
        const targetCodes = getMappedCodes(item.originalNames);
        let dynamicallyMatchedCodes: string[] = [];

        const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        let initialStock = stockData.reduce((acc, s) => {
            if (targetCodes.length > 0) {
                if (s.codigo && targetCodes.includes(String(s.codigo).trim().toLowerCase())) {
                    dynamicallyMatchedCodes.push(String(s.codigo).trim().toLowerCase());
                    return acc + (s.amount || s.STOCK || 0);
                }
                return acc; 
            }
            
            // Fallback to name matching
            const stockName = (s.insumo || s.NAME || '');
            const hasNameMatch = item.originalNames.some(itemName => {
                const lowerItem = normalize(itemName);
                const normStockName = normalize(stockName);
                return normStockName.includes(lowerItem) || lowerItem.includes(normStockName);
            });
            
            if (hasNameMatch) {
                if (s.codigo) dynamicallyMatchedCodes.push(String(s.codigo).trim().toLowerCase());
                return acc + (s.amount || s.STOCK || 0);
            }
            return acc;
        }, 0);

        let separatedAmount = 0;
        if (separatedSupplies[item.name]) {
            separatedAmount += separatedSupplies[item.name];
        } else {
            item.originalNames.forEach(n => {
                if (separatedSupplies[n]) separatedAmount += separatedSupplies[n];
            });
        }
        
        initialStock = Math.max(0, initialStock - separatedAmount);

        const stockEvolution = [initialStock];
        let currentStock = initialStock;
        let stockoutMonthIndex = -1;
        
        const now = new Date();
        const currentYearMonth = format(now, 'yyyy-MM');
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysRemaining = Math.max(0, daysInMonth - now.getDate() + 1);
        const fractionRemaining = Math.min(1, daysRemaining / daysInMonth);

        planningMonths.forEach((m, i) => {
            let req = item.monthlyReq[m];
            if (m === currentYearMonth) {
                req = req * fractionRemaining;
            }
            currentStock -= req;
            stockEvolution.push(currentStock);
            if (currentStock < 0 && stockoutMonthIndex === -1) stockoutMonthIndex = i;
        });

        let etaDate = null;
        if (stockoutMonthIndex !== -1) {
            const m = planningMonths[stockoutMonthIndex];
            const stockAtStartOfMonth = stockEvolution[stockoutMonthIndex];
            const consumedInMonth = item.monthlyReq[m] || 1;
            const daysInMonth = new Date(parseISO(`${m}-01`).getFullYear(), parseISO(`${m}-01`).getMonth() + 1, 0).getDate();
            const dailyRate = consumedInMonth / daysInMonth;
            
            if (m === currentYearMonth) {
                // Stockout happens in current month, calculate from today
                const daysToStockout = Math.max(0, stockAtStartOfMonth / dailyRate);
                etaDate = addDays(now, daysToStockout);
            } else {
                // Stockout happens in future month, calculate from start of that month
                const daysToStockout = Math.max(0, stockAtStartOfMonth / dailyRate);
                etaDate = addDays(startOfMonth(parseISO(`${m}-01`)), daysToStockout);
            }
        }

        return { ...item, initialStock, stockEvolution, stockoutMonthIndex, etaDate, targetCodes };
    });

    return { projection: projectionResults.sort((a,b) => (a.stockoutMonthIndex === -1 ? 1 : b.stockoutMonthIndex === -1 ? -1 : a.stockoutMonthIndex - b.stockoutMonthIndex)), items: items };
  }, [config, goals, planningMonths, stockData, findPreformaForProduct, findTermoForProduct, findStretchForProduct, findTapaForProduct, getPackingCategory, insumoMappings, etiquetasMappings, excludeJuiceAndSugar]);

  const getDailySimulation = useCallback((item: any, includeTransit: boolean) => {
    if (!item) return { dailyData: [], events: [], itemTransits: [] };
    
    const dailyData: { date: Date; dateStr: string; stock: number; consumption: number; events: any[] }[] = [];
    const events: { type: 'initial' | 'quiebre' | 'transit' | 'recovery'; date: Date; label: string; description: string; amount?: number; transitRef?: any; isOverdue?: boolean; originalNeedDate?: string }[] = [];
    
    const now = new Date();
    let currentStock = item.initialStock || 0;
    
    events.push({
      type: 'initial',
      date: now,
      label: 'Inventario Inicial',
      description: `Inicia con un stock de ${Math.round(currentStock).toLocaleString('es-AR')} unidades`,
      amount: currentStock
    });

    const todayStr = format(now, 'yyyy-MM-dd');
    const adjustedTransitDate = addDays(now, overdueDelayDays);
    const adjustedTransitDateStr = format(adjustedTransitDate, 'yyyy-MM-dd');

    // Match transits
    const itemTransits = transits.filter(t => {
      if (!t.status || String(t.status).toLowerCase().includes('recibido') || String(t.status).toLowerCase().includes('completado')) return false;
      
      const tCode = String(t.code || '').toLowerCase().trim().replace(/^0+/, '');
      const tDesc = String(t.description || '').toLowerCase();
      let match = false;
      const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      
      if (tCode && item.targetCodes && item.targetCodes.some((c: string) => String(c).replace(/^0+/, '') === tCode)) {
        match = true;
      } else if (item.originalNames.some((n: string) => normalize(tDesc).includes(normalize(n)))) {
        match = true;
      }
      return match;
    }).map(t => {
      const qty = (Number(t.requestedQuantity) || 0) - (Number(t.arrivedQuantity) || 0);
      const isOverdue = t.needDate ? (t.needDate < todayStr) : false;
      const simulatedNeedDate = isOverdue ? adjustedTransitDateStr : (t.needDate || todayStr);
      return {
        ...t,
        qty,
        isOverdue,
        originalNeedDate: t.needDate,
        simulatedNeedDate
      };
    }).sort((a, b) => {
      const dateA = a.simulatedNeedDate ? new Date(a.simulatedNeedDate).getTime() : 0;
      const dateB = b.simulatedNeedDate ? new Date(b.simulatedNeedDate).getTime() : 0;
      return dateA - dateB;
    });

    let previouslyNegative = currentStock < 0;
    
    // Project for 180 days (6 months)
    for (let dayOffset = 0; dayOffset <= 180; dayOffset++) {
      const currentDate = addDays(now, dayOffset);
      const monthKey = format(currentDate, 'yyyy-MM');
      const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
      
      const monthlyReq = item.monthlyReq[monthKey] || 0;
      const dailyConsumption = monthlyReq / daysInMonth;
      
      currentStock -= dailyConsumption;
      
      const dayEvents: any[] = [];
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      
      let transitAdded = 0;
      if (includeTransit) {
        itemTransits.forEach(t => {
          if (t.simulatedNeedDate === dateStr && t.qty > 0) {
            transitAdded += t.qty;
            const ev = {
              type: 'transit' as const,
              date: currentDate,
              isOverdue: t.isOverdue,
              originalNeedDate: t.originalNeedDate,
              label: t.isOverdue ? `Tránsito Demorado (Reprogramado)` : `Recepción Tránsito`,
              description: t.isOverdue 
                ? `Ingreso de ${Math.round(t.qty).toLocaleString('es-AR')} un. (Vencido original: ${formatIsoDateStr(t.originalNeedDate)}, reprogramado +${overdueDelayDays} días)`
                : `Ingreso de ${Math.round(t.qty).toLocaleString('es-AR')} un. (Requerimiento ${t.requisitionNumber || 'S/N'})`,
              amount: t.qty,
              transitRef: t
            };
            events.push(ev);
            dayEvents.push(ev);
          }
        });
        currentStock += transitAdded;
      }
      
      // Stock level threshold triggers
      if (currentStock < 0 && !previouslyNegative) {
        const ev = {
          type: 'quiebre' as const,
          date: currentDate,
          label: 'Quiebre de Stock',
          description: `El inventario se agota. Stock proyectado: ${Math.round(currentStock).toLocaleString('es-AR')}`,
        };
        events.push(ev);
        dayEvents.push(ev);
        previouslyNegative = true;
      } else if (currentStock >= 0 && previouslyNegative) {
        const ev = {
          type: 'recovery' as const,
          date: currentDate,
          label: 'Stock Recuperado',
          description: `El stock se recupera a ${Math.round(currentStock).toLocaleString('es-AR')} unidades`,
        };
        events.push(ev);
        dayEvents.push(ev);
        previouslyNegative = false;
      }
      
      dailyData.push({
        date: currentDate,
        dateStr,
        stock: Math.round(currentStock),
        consumption: dailyConsumption,
        events: dayEvents
      });
    }
    
    return { dailyData, events, itemTransits };
  }, [transits, overdueDelayDays]);

  const getItemAlerts = useCallback((item: any) => {
    if (!item) return { alerts: [], quiebreNoTransit: null, quiebreWithTransit: null, hasTransits: false, transitCount: 0 };
    
    // 1. Simulation without transit
    const simNoTransit = getDailySimulation(item, false);
    const quiebreNoTransit = simNoTransit.events.find(e => e.type === 'quiebre')?.date || null;
    
    // 2. Simulation with transit
    const simWithTransit = getDailySimulation(item, true);
    const quiebreWithTransit = simWithTransit.events.find(e => e.type === 'quiebre')?.date || null;
    
    const alerts: { type: 'danger' | 'warning' | 'success'; message: string; description: string }[] = [];
    
    const transitsList = simNoTransit.itemTransits;
    
    if (transitsList.length === 0) {
      if (quiebreNoTransit) {
        alerts.push({
          type: 'danger',
          message: 'Quiebre inminente sin tránsitos',
          description: `El stock se agota el ${format(quiebreNoTransit, "dd 'de' MMMM", { locale: es })} y no hay tránsitos programados.`
        });
      } else {
        alerts.push({
          type: 'success',
          message: 'Stock seguro',
          description: 'El insumo se encuentra abastecido para los próximos 6 meses sin necesidad de tránsitos.'
        });
      }
    } else {
      // There are transits!
      transitsList.forEach(t => {
        if (t.isOverdue) {
          alerts.push({
            type: 'warning',
            message: `Tránsito Vencido (Req: ${t.requisitionNumber || 'S/N'})`,
            description: `Fecha original planificada: ${formatIsoDateStr(t.originalNeedDate)}. Se simula ingreso demorado en ${overdueDelayDays} días (${formatIsoDateStr(t.simulatedNeedDate)}).`
          });
        }

        const actualNeedDate = t.simulatedNeedDate;
        if (!actualNeedDate) return;
        const transitDate = new Date(actualNeedDate + 'T12:00:00');
        
        if (quiebreNoTransit && transitDate > quiebreNoTransit) {
          const diffDays = differenceInDays(transitDate, quiebreNoTransit);
          alerts.push({
            type: 'danger',
            message: `Tránsito tardío (Req: ${t.requisitionNumber || 'S/N'})`,
            description: `Llega el ${formatIsoDateStr(actualNeedDate)}${t.isOverdue ? ' (reprogramado)' : ''}, pero el stock se agota antes, el ${format(quiebreNoTransit, 'dd/MM/yyyy')} (${diffDays} días de quiebre).`
          });
        } else if (quiebreNoTransit) {
          const margin = differenceInDays(quiebreNoTransit, transitDate);
          if (margin < 10) {
            alerts.push({
              type: 'warning',
              message: `Margen crítico (Req: ${t.requisitionNumber || 'S/N'})`,
              description: `Llega el ${formatIsoDateStr(actualNeedDate)}${t.isOverdue ? ' (reprogramado)' : ''}, solo ${margin} días antes del quiebre proyectado (${format(quiebreNoTransit, 'dd/MM/yyyy')}).`
            });
          }
        }
      });
      
      if (quiebreWithTransit) {
        alerts.push({
          type: 'danger',
          message: 'Quiebre persistente',
          description: `El stock se agota el ${format(quiebreWithTransit, 'dd/MM/yyyy')} a pesar de recibir los tránsitos.`
        });
      }
    }
    
    return {
      alerts,
      quiebreNoTransit,
      quiebreWithTransit,
      hasTransits: transitsList.length > 0,
      transitCount: transitsList.length
    };
  }, [getDailySimulation, overdueDelayDays]);

  const handleSort = (field: string) => {
    if (sortConfig.field === field) setSortConfig({ field, asc: !sortConfig.asc });
    else setSortConfig({ field, asc: true });
  };

  const handleSortConsumo = (field: string) => {
    if (sortConfigConsumo.field === field) setSortConfigConsumo({ field, asc: !sortConfigConsumo.asc });
    else setSortConfigConsumo({ field, asc: true });
  };

  const sortedProjection = useMemo(() => {
    if (!combinedData?.projection) return [];
    return [...combinedData.projection].sort((a, b) => {
        let valA, valB;
        if (sortConfig.field === 'name') {
            valA = a.name; valB = b.name;
        } else if (sortConfig.field === 'initialStock') {
            valA = a.initialStock; valB = b.initialStock;
        } else if (sortConfig.field === 'etaDate') {
            valA = a.etaDate ? a.etaDate.getTime() : Infinity;
            valB = b.etaDate ? b.etaDate.getTime() : Infinity;
        } else if (sortConfig.field.startsWith('month_')) {
            const idx = parseInt(sortConfig.field.split('_')[1]);
            valA = a.stockEvolution[idx];
            valB = b.stockEvolution[idx];
        }

        if (valA < valB) return sortConfig.asc ? -1 : 1;
        if (valA > valB) return sortConfig.asc ? 1 : -1;
        return 0;
    });
  }, [combinedData, sortConfig]);

  const sortedConsumo = useMemo(() => {
    if (!combinedData?.items) return [];
    return [...combinedData.items].sort((a, b) => {
        let valA, valB;
        if (sortConfigConsumo.field === 'name') {
            valA = a.name; valB = b.name;
        } else if (sortConfigConsumo.field.startsWith('month_')) {
            const m = sortConfigConsumo.field.split('_')[1];
            valA = a.monthlyReq[m] || 0;
            valB = b.monthlyReq[m] || 0;
        }

        if (valA < valB) return sortConfigConsumo.asc ? -1 : 1;
        if (valA > valB) return sortConfigConsumo.asc ? 1 : -1;
        return 0;
    });
  }, [combinedData, sortConfigConsumo]);

  if (loading) return <div className="flex justify-center p-12 animate-pulse text-blue-600">Cargando datos...</div>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Gestión y Proyecciones de Insumos</h2>
            <p className="text-xs text-gray-500 font-bold mt-1">Análisis de cobertura, requerimientos y simulación de abastecimiento.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setExcludeJuiceAndSugar(!excludeJuiceAndSugar)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all flex items-center gap-2 ${
                excludeJuiceAndSugar
                  ? 'bg-amber-50 text-amber-700 border-amber-200 shadow-sm'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${excludeJuiceAndSugar ? 'bg-amber-600 animate-pulse' : 'bg-gray-300'}`}></span>
              Excluir Jugo y Azúcar
            </button>

            <button
              onClick={() => setShowSeparatedModal(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider bg-red-50 text-red-700 hover:bg-red-100 transition-colors border border-red-200"
            >
              Artículos Separados
            </button>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
            {(['proyeccion', 'consumo', 'quiebre'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg text-sm font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-amber-600 text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {tab === 'proyeccion' ? 'Cobertura' : tab === 'consumo' ? 'Consumo Mensual' : 'Análisis de Quiebre (ETA)'}
                </button>
            ))}
        </div>
      </div>

      {activeTab === 'proyeccion' && (
        <div className="space-y-6">
            {Object.keys(combinedData.items.reduce((acc, i) => { if(!acc[i.category]) acc[i.category] = []; acc[i.category].push(i); return acc; }, {} as Record<string, any[]>)).map(cat => (
                <div key={cat} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <h3 className="text-lg font-black text-amber-900 p-6 pb-0">{cat}</h3>
                    <table className="w-full text-left">
                    <thead className="bg-gray-100">
                        <tr>
                        <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest border-r cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSort('name')}>
                            Insumo {sortConfig.field === 'name' ? (sortConfig.asc ? '▲' : '▼') : ''}
                        </th>
                        <th className="px-6 py-4 text-xs font-black text-gray-600 uppercase tracking-widest text-right cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSort('initialStock')}>
                            Inv. Hoy {sortConfig.field === 'initialStock' ? (sortConfig.asc ? '▲' : '▼') : ''}
                        </th>
                        <th className="px-6 py-4 text-xs font-black text-gray-600 uppercase tracking-widest text-right cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSort('etaDate')}>
                            ETA Quiebre {sortConfig.field === 'etaDate' ? (sortConfig.asc ? '▲' : '▼') : ''}
                        </th>
                        {planningMonths.map((m, i) => (
                            <th key={m} className="px-2 py-4 text-[10px] font-black text-blue-700 uppercase tracking-widest text-center cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSort(`month_${i+1}`)}>
                                {format(parseISO(`${m}-01`), 'MMM yy', { locale: es })} {sortConfig.field === `month_${i+1}` ? (sortConfig.asc ? '▲' : '▼') : ''}
                            </th>
                        ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {sortedProjection.filter(item => item.category === cat).map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-bold text-gray-900 border-r text-xs">{item.name}</td>
                            <td className="px-6 py-4 text-sm font-black text-gray-800 text-right">{Intl.NumberFormat('es-AR').format(Math.round(item.initialStock))}</td>
                            <td className="px-6 py-4 text-sm text-right">
                                {item.etaDate && !isNaN(item.etaDate.getTime()) ? (() => {
                                    const diff = differenceInDays(item.etaDate, new Date());
                                    let textColor = 'text-gray-700';
                                    if (diff < 15) textColor = 'text-red-700';
                                    else if (diff <= 30) textColor = 'text-orange-500';
                                    else if (diff <= 45) textColor = 'text-yellow-500';
                                    return <span className={`${textColor} font-black`}>{format(item.etaDate, 'd MMM', { locale: es })}</span>;
                                })() : item.etaDate ? <span className="text-gray-500 font-black">-</span> : <span className="text-emerald-600 font-black">OK</span>}
                            </td>
                            {planningMonths.map((m, i) => {
                                const val = item.stockEvolution[i + 1];
                                return <td key={m} className={`text-center text-xs font-bold ${val < 0 ? 'bg-red-50 text-red-700' : 'text-gray-600'}`}>{Intl.NumberFormat('es-AR').format(Math.round(val))}</td>
                            })}
                        </tr>
                        ))}
                    </tbody>
                    </table>
                </div>
            ))}
        </div>
      )}

      {activeTab === 'consumo' && (
        <div className="space-y-6">
            {Object.keys(combinedData.items.reduce((acc, i) => { if(!acc[i.category]) acc[i.category] = []; acc[i.category].push(i); return acc; }, {} as Record<string, any[]>)).map(cat => (
                <div key={cat} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                    <h3 className="text-lg font-black text-amber-900 mb-4">{cat}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead><tr className="text-gray-500 border-b">
                                <th className="p-2 cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSortConsumo('name')}>
                                    INSUMO {sortConfigConsumo.field === 'name' ? (sortConfigConsumo.asc ? '▲' : '▼') : ''}
                                </th>
                                {planningMonths.map(m => (
                                    <th key={m} className="p-2 cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => handleSortConsumo(`month_${m}`)}>
                                        {format(parseISO(`${m}-01`), 'MMM yy', { locale: es }).toUpperCase()} {sortConfigConsumo.field === `month_${m}` ? (sortConfigConsumo.asc ? '▲' : '▼') : ''}
                                    </th>
                                ))}
                            </tr></thead>
                            <tbody>{sortedConsumo.filter(i => i.category === cat).map((item, idx) => (
                                <tr key={idx} className="border-b hover:bg-gray-50">
                                    <td className="p-2 font-bold">{item.name}</td>
                                    {planningMonths.map(m => <td key={m} className="p-2 text-right">{Intl.NumberFormat('es-AR').format(Math.round(item.monthlyReq[m]))}</td>)}
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                </div>
            ))}
        </div>
      )}

      {activeTab === 'quiebre' && (() => {
        const insumoList = combinedData.projection;
        
        const filteredInsumos = insumoList.filter(item => 
          item.name.toLowerCase().includes(quiebreSearchQuery.toLowerCase()) ||
          item.category.toLowerCase().includes(quiebreSearchQuery.toLowerCase())
        );

        const currentItem = filteredInsumos.find(item => item.name === selectedInsumoName) || filteredInsumos[0];
        
        const { dailyData, events: simEvents, itemTransits } = getDailySimulation(currentItem, includeTransitGlobally);
        const alertsInfo = currentItem ? getItemAlerts(currentItem) : { alerts: [], quiebreNoTransit: null, quiebreWithTransit: null, hasTransits: false, transitCount: 0 };

        const sortedEvents = [...simEvents].sort((a, b) => a.date.getTime() - b.date.getTime());

        const displayedDailyData = dailyData.slice(0, chartScaleMonths * 30 + 1);
        const maxDate = displayedDailyData[displayedDailyData.length - 1]?.date;
        const filteredEvents = maxDate 
          ? sortedEvents.filter(evt => evt.date.getTime() <= maxDate.getTime() + 86400000)
          : sortedEvents;

        return (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Left Column: List of Insumos */}
            <div className="xl:col-span-5 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[750px]">
              <div className="p-4 border-b border-gray-100 bg-gray-50/50 space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={quiebreSearchQuery}
                    onChange={(e) => setQuiebreSearchQuery(e.target.value)}
                    placeholder="Buscar insumo o categoría..."
                    className="w-full pl-9 pr-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white font-bold text-gray-800"
                  />
                  <div className="absolute left-3 top-2.5 text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  {quiebreSearchQuery && (
                    <button
                      onClick={() => setQuiebreSearchQuery('')}
                      className="absolute right-3 top-2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                <div className="flex items-center justify-between py-1 bg-amber-50/50 rounded-lg px-3 border border-amber-100/60">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-amber-700" />
                    <span className="text-[10px] font-black text-amber-900">Considerar Tránsitos en Simulación:</span>
                  </div>
                  <button
                    onClick={() => setIncludeTransitGlobally(!includeTransitGlobally)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${includeTransitGlobally ? 'bg-amber-600' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${includeTransitGlobally ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div className="flex flex-col gap-1.5 py-2 bg-rose-50/50 rounded-lg px-3 border border-rose-100/60">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-rose-600" />
                      <span className="text-[10px] font-black text-rose-900 uppercase tracking-wide">Reprogramación Vencidos:</span>
                    </div>
                    <span className="text-[10px] font-black text-rose-700 bg-rose-100/80 px-2 py-0.5 rounded border border-rose-200">
                      +{overdueDelayDays} {overdueDelayDays === 1 ? 'día' : 'días'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="1"
                      max="30"
                      value={overdueDelayDays}
                      onChange={(e) => setOverdueDelayDays(parseInt(e.target.value))}
                      className="flex-1 accent-rose-600 h-1 bg-rose-200 rounded-lg cursor-pointer"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => setOverdueDelayDays(prev => Math.max(1, prev - 1))}
                        disabled={overdueDelayDays <= 1}
                        className="w-5 h-5 flex items-center justify-center rounded bg-white border border-rose-200 text-rose-700 text-xs font-black disabled:opacity-40 hover:bg-rose-50 transition-colors"
                      >
                        -
                      </button>
                      <button
                        onClick={() => setOverdueDelayDays(prev => Math.min(30, prev + 1))}
                        disabled={overdueDelayDays >= 30}
                        className="w-5 h-5 flex items-center justify-center rounded bg-white border border-rose-200 text-rose-700 text-xs font-black disabled:opacity-40 hover:bg-rose-50 transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <p className="text-[9px] text-rose-600/80 font-bold leading-tight">
                    Simula que los ingresos atrasados llegarán dentro de {overdueDelayDays} {overdueDelayDays === 1 ? 'día' : 'días'} a contar desde hoy.
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                {filteredInsumos.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 font-bold">No se encontraron insumos.</div>
                ) : (
                  filteredInsumos.map((item) => {
                    const isSelected = currentItem && item.name === currentItem.name;
                    const itemAlerts = getItemAlerts(item);
                    const quiebreDate = includeTransitGlobally ? itemAlerts.quiebreWithTransit : itemAlerts.quiebreNoTransit;
                    const hasDanger = itemAlerts.alerts.some(a => a.type === 'danger');
                    const hasWarning = itemAlerts.alerts.some(a => a.type === 'warning');

                    return (
                      <div
                        key={item.name}
                        onClick={() => setSelectedInsumoName(item.name)}
                        className={`p-4 cursor-pointer transition-all flex items-center justify-between border-l-4 ${isSelected ? 'bg-amber-50/40 border-amber-500' : 'hover:bg-gray-50/50 border-transparent'}`}
                      >
                        <div className="space-y-1 min-w-0 pr-2">
                          <div className="font-black text-xs text-gray-950 truncate">{item.name}</div>
                          <div className="text-[10px] text-gray-500 font-bold">{item.category}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-black text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                              Stock: {Math.round(item.initialStock).toLocaleString('es-AR')} un
                            </span>
                            {itemAlerts.transitCount > 0 && (
                              <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                {itemAlerts.transitCount} tránsito{itemAlerts.transitCount > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex flex-col items-end shrink-0 gap-1">
                          {quiebreDate ? (
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${hasDanger ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}`}>
                              ETA: {format(quiebreDate, 'dd/MM/yy')}
                            </span>
                          ) : (
                            <span className="text-[10px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                              🟢 Abastecido
                            </span>
                          )}

                          <div className="flex gap-1">
                            {hasDanger && (
                              <span className="p-0.5 rounded text-red-600" title="Tránsito Tardío o Sin Tránsito">
                                <AlertCircle className="w-3.5 h-3.5" />
                              </span>
                            )}
                            {hasWarning && (
                              <span className="p-0.5 rounded text-amber-600" title="Tránsito muy ajustado o demorado">
                                <AlertTriangle className="w-3.5 h-3.5" />
                              </span>
                            )}
                            {!hasDanger && !hasWarning && (
                              <span className="p-0.5 rounded text-emerald-600">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Insumo Details, Dynamic Chart and Timeline */}
            <div className="xl:col-span-7 space-y-6">
              {currentItem ? (
                <>
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
                          {currentItem.category}
                        </span>
                        <h3 className="text-lg font-black text-gray-950 mt-2">{currentItem.name}</h3>
                        <p className="text-xs text-gray-500 font-bold mt-1">Análisis de ETA de quiebre y tránsitos programados a 180 días.</p>
                      </div>
                      
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex gap-4 shrink-0">
                        <div className="text-center">
                          <span className="text-[9px] text-gray-400 font-black block uppercase">STOCK HOY</span>
                          <span className="text-sm font-black text-slate-800">{Math.round(currentItem.initialStock).toLocaleString('es-AR')}</span>
                        </div>
                        <div className="w-[1px] bg-slate-200"></div>
                        <div className="text-center">
                          <span className="text-[9px] text-gray-400 font-black block uppercase">TRÁNSITOS</span>
                          <span className="text-sm font-black text-blue-700">{alertsInfo.transitCount} un.</span>
                        </div>
                        <div className="w-[1px] bg-slate-200"></div>
                        <div className="text-center">
                          <span className="text-[9px] text-gray-400 font-black block uppercase">ETA QUIEBRE</span>
                          {includeTransitGlobally ? (
                            alertsInfo.quiebreWithTransit ? (
                              <span className="text-sm font-black text-red-600 block">{format(alertsInfo.quiebreWithTransit, 'dd/MM/yyyy')}</span>
                            ) : (
                              <span className="text-sm font-black text-emerald-600 block">Sin Quiebre</span>
                            )
                          ) : (
                            alertsInfo.quiebreNoTransit ? (
                              <span className="text-sm font-black text-orange-600 block">{format(alertsInfo.quiebreNoTransit, 'dd/MM/yyyy')}</span>
                            ) : (
                              <span className="text-sm font-black text-emerald-600 block">Sin Quiebre</span>
                            )
                          )}
                        </div>
                      </div>
                    </div>

                    {alertsInfo.alerts.length > 0 && (
                      <div className="mt-5 space-y-2 border-t border-gray-100 pt-4">
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Vulnerabilidades de Abastecimiento:</h4>
                        {alertsInfo.alerts.map((alert, idx) => (
                          <div
                            key={idx}
                            className={`flex items-start gap-3 p-3 rounded-xl border ${
                              alert.type === 'danger'
                                ? 'bg-red-50 border-red-100 text-red-800'
                                : alert.type === 'warning'
                                ? 'bg-amber-50 border-amber-100 text-amber-800'
                                : 'bg-emerald-50 border-emerald-100 text-emerald-800'
                            }`}
                          >
                            {alert.type === 'danger' ? (
                              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            ) : alert.type === 'warning' ? (
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <p className="text-xs font-black">{alert.message}</p>
                              <p className="text-[10px] text-gray-600 font-bold mt-0.5">{alert.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-amber-600" />
                        <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                          Evolución Diaria (Escala: {chartScaleMonths} {chartScaleMonths === 1 ? 'Mes' : 'Meses'})
                        </h4>
                      </div>
                      
                      <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                        {([1, 3, 6] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => setChartScaleMonths(m)}
                            className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${chartScaleMonths === m ? 'bg-amber-600 text-white shadow' : 'text-gray-500 hover:text-gray-800'}`}
                          >
                            {m} {m === 1 ? 'Mes' : 'Meses'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="h-[280px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={displayedDailyData}
                          margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="colorStock" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#d97706" stopOpacity={0.12}/>
                              <stop offset="95%" stopColor="#d97706" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey="dateStr"
                            tickFormatter={(tick) => format(parseISO(tick), 'dd MMM', { locale: es })}
                            stroke="#94a3b8"
                            fontSize={9}
                            fontFamily="monospace"
                          />
                          <YAxis
                            stroke="#94a3b8"
                            fontSize={9}
                            fontFamily="monospace"
                            tickFormatter={(tick) => Math.round(tick).toLocaleString('es-AR')}
                          />
                          <Tooltip
                            labelFormatter={(label) => format(parseISO(String(label)), "eeee dd 'de' MMMM, yyyy", { locale: es })}
                            formatter={(value: any, name: any, props: any) => {
                              const dayEvts = props.payload.events || [];
                              const formattedVal = Math.round(Number(value)).toLocaleString('es-AR') + ' un.';
                              if (dayEvts.length > 0) {
                                return [
                                  `${formattedVal} (${dayEvts.map((e: any) => e.label).join(', ')})`,
                                  'Stock'
                                ];
                              }
                              return [formattedVal, 'Stock Proyectado'];
                            }}
                            contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '12px', color: '#f8fafc', fontSize: '10px', fontWeight: 'bold' }}
                          />
                          <Area
                            type="monotone"
                            dataKey="stock"
                            stroke="#d97706"
                            strokeWidth={2.5}
                            fillOpacity={1}
                            fill="url(#colorStock)"
                          />
                          <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} />
                          
                          {filteredEvents.map((evt, idx) => {
                            if (evt.type === 'quiebre') {
                              return (
                                <ReferenceLine
                                  key={`q-${idx}`}
                                  x={format(evt.date, 'yyyy-MM-dd')}
                                  stroke="#dc2626"
                                  strokeDasharray="3 3"
                                />
                              );
                            }
                            if (evt.type === 'transit') {
                              return (
                                <ReferenceLine
                                  key={`t-${idx}`}
                                  x={format(evt.date, 'yyyy-MM-dd')}
                                  stroke={evt.isOverdue ? "#f43f5e" : "#2563eb"}
                                  strokeDasharray="3 3"
                                />
                              );
                            }
                            return null;
                          })}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <CalendarDays className="w-4 h-4 text-blue-600" />
                      <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">Hitos y Secuencia de Abastecimiento ({chartScaleMonths === 1 ? '1 Mes' : `${chartScaleMonths} Meses`})</h4>
                    </div>

                    <div className="relative border-l border-gray-200 ml-3 pl-5 space-y-4">
                      {filteredEvents.map((evt, idx) => {
                        let iconBg = 'bg-gray-100 text-gray-600';
                        let titleColor = 'text-gray-900';

                        if (evt.type === 'initial') {
                          iconBg = 'bg-slate-100 text-slate-700';
                        } else if (evt.type === 'quiebre') {
                          iconBg = 'bg-red-100 text-red-700';
                          titleColor = 'text-red-700';
                        } else if (evt.type === 'transit') {
                          if (evt.isOverdue) {
                            iconBg = 'bg-rose-100 text-rose-700 border border-rose-200';
                            titleColor = 'text-rose-700';
                          } else {
                            iconBg = 'bg-blue-100 text-blue-700';
                            titleColor = 'text-blue-700';
                          }
                        } else if (evt.type === 'recovery') {
                          iconBg = 'bg-emerald-100 text-emerald-700';
                          titleColor = 'text-emerald-700';
                        }

                        return (
                          <div key={idx} className="relative">
                            <span className={`absolute -left-[32px] top-1 flex h-6 w-6 items-center justify-center rounded-full border border-white ${iconBg} shadow-sm`}>
                              {evt.type === 'initial' && <Package className="w-3 h-3" />}
                              {evt.type === 'quiebre' && <AlertCircle className="w-3 h-3" />}
                              {evt.type === 'transit' && (
                                evt.isOverdue ? <AlertTriangle className="w-3 h-3 text-rose-600" /> : <Clock className="w-3 h-3" />
                              )}
                              {evt.type === 'recovery' && <CheckCircle2 className="w-3 h-3" />}
                            </span>

                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 bg-slate-50/50 hover:bg-slate-50 transition-colors p-3 rounded-xl border border-gray-100">
                              <div className="space-y-1">
                                <h5 className={`text-xs font-black ${titleColor} flex items-center gap-1.5 flex-wrap`}>
                                  {evt.label}
                                  {evt.amount !== undefined && evt.type === 'transit' && (
                                    <span className="text-[9px] font-black bg-blue-100 text-blue-800 px-1 rounded">
                                      +{Math.round(evt.amount).toLocaleString('es-AR')} un
                                    </span>
                                  )}
                                  {evt.isOverdue && (
                                    <span className="text-[9px] font-black bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded border border-rose-200 animate-pulse">
                                      Demorado (Original: {formatIsoDateStr(evt.originalNeedDate)})
                                    </span>
                                  )}
                                </h5>
                                <p className="text-[10px] text-gray-600 font-bold">
                                  {evt.description}
                                </p>
                              </div>
                              <span className="text-[10px] font-mono text-gray-400 bg-white border border-gray-100 px-2 py-0.5 rounded self-start md:self-center font-bold">
                                {format(evt.date, 'dd MMM yyyy', { locale: es })}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center text-gray-500 font-bold">
                  Seleccione un insumo de la lista para iniciar el análisis.
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {showSeparatedModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-xl font-black text-slate-800">Artículos Separados</h3>
                <p className="text-xs text-slate-500 font-bold mt-1">Gestión de insumos en cuarentena o no aptos.</p>
              </div>
              <button 
                onClick={() => setShowSeparatedModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-white">
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                  <h4 className="text-sm font-black text-blue-900 mb-3">Agregar artículo separado</h4>
                  <form 
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.target as HTMLFormElement;
                      const select = form.elements.namedItem('insumo') as HTMLSelectElement;
                      const input = form.elements.namedItem('amount') as HTMLInputElement;
                      const insumo = select.value;
                      const amount = parseFloat(input.value);
                      
                      if (insumo && amount > 0) {
                        const newSupplies = { ...separatedSupplies, [insumo]: (separatedSupplies[insumo] || 0) + amount };
                        await setDoc(doc(db, 'config', 'separated_supplies'), newSupplies);
                        form.reset();
                      }
                    }}
                    className="flex flex-col sm:flex-row gap-3"
                  >
                    <select 
                      name="insumo"
                      required
                      className="flex-1 rounded-lg border-gray-300 text-sm font-bold shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2.5"
                    >
                      <option value="">Seleccionar insumo...</option>
                      {[...combinedData.items].sort((a, b) => a.name.localeCompare(b.name)).map(i => (
                        <option key={i.name} value={i.name}>{i.name}</option>
                      ))}
                    </select>
                    <input 
                      type="number" 
                      name="amount"
                      required
                      min="0.01"
                      step="0.01"
                      placeholder="Cantidad"
                      className="w-full sm:w-32 rounded-lg border-gray-300 text-sm font-bold shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2.5 text-right"
                    />
                    <button 
                      type="submit"
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-black flex items-center justify-center gap-2 transition-colors shadow-sm"
                    >
                      <Plus className="w-4 h-4" /> Agregar
                    </button>
                  </form>
                </div>

                <div>
                  <h4 className="text-sm font-black text-slate-800 mb-3 uppercase tracking-widest border-b border-slate-100 pb-2">Artículos actualmente separados</h4>
                  {Object.entries(separatedSupplies).length === 0 ? (
                    <div className="text-center p-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      <p className="text-slate-500 font-bold text-sm">No hay artículos separados actualmente.</p>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="p-3 font-black text-slate-600 uppercase tracking-widest text-xs">Insumo</th>
                            <th className="p-3 font-black text-slate-600 uppercase tracking-widest text-xs text-right">Cantidad</th>
                            <th className="p-3 font-black text-slate-600 uppercase tracking-widest text-xs text-center w-20">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {Object.entries(separatedSupplies).sort((a, b) => a[0].localeCompare(b[0])).map(([name, amount]) => (
                            <tr key={name} className="hover:bg-slate-50 transition-colors">
                              <td className="p-3 font-bold text-slate-800">{name}</td>
                              <td className="p-3 font-black text-slate-700 text-right font-mono">{Intl.NumberFormat('es-AR').format(amount as number)}</td>
                              <td className="p-3 text-center">
                                <button
                                  onClick={async () => {
                                    const newSupplies = { ...separatedSupplies };
                                    delete newSupplies[name];
                                    await setDoc(doc(db, 'config', 'separated_supplies'), newSupplies);
                                  }}
                                  className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Remover"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-slate-50 flex justify-end">
              <button 
                onClick={() => setShowSeparatedModal(false)}
                className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-black rounded-xl transition-colors shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
