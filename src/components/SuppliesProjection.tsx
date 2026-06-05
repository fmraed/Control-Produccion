import React, { useState, useMemo, useCallback } from 'react';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppConfig } from '../hooks/useAppConfig';
import { MonthlyGoal } from '../types';
import { BOTELLAS_POR_PACK, PACKS_POR_PALETA, WASTE_WEIGHTS } from '../constants';
import { format, parseISO, addMonths, startOfMonth, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { TrendingDown, Calendar, Database, FlaskConical, BarChart3, Package } from 'lucide-react';

interface InsumosGrouped {
  name: string;
  category: string;
  monthlyReq: Record<string, number>; 
}

export function SuppliesProjection() {
  const { config } = useAppConfig();
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [stockData, setStockData] = useState<any[]>([]);
  const [insumoMappings, setInsumoMappings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'proyeccion' | 'consumo'>('proyeccion');

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
    const lower = insumoName.toLowerCase();
    if (lower.includes('preforma')) return 'Preformas';
    if (lower.includes('tapa')) return 'Tapas';
    if (lower.includes('termo')) return 'Termocontraíble';
    if (lower.includes('stretch')) return 'Film Stretch';
    if (lower.includes('etiqueta')) return 'Etiquetas';
    if (lower.includes('azúcar') || lower.includes('azucar')) return 'Materia Prima';
    return 'Otros Insumos';
  }, []);

  const findPreformaForProduct = useCallback((tam: number, lin: string, sabor: string) => {
    const list = config?.preformasConfig || [];
    const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
    return list.find(p => p.sizes.includes(tam) && p.line && p.line.toString() === lin.toString() && matchFlavor(p)) ||
           list.find(p => p.sizes.includes(tam) && !p.line && matchFlavor(p)) ||
           list.find(p => p.sizes.includes(tam) && matchFlavor(p)) ||
           list.find(p => p.sizes.includes(tam) && p.line && p.line.toString() === lin.toString()) ||
           list.find(p => p.sizes.includes(tam));
  }, [config]);

  const findTermoForProduct = useCallback((tam: number, sabor: string) => {
    const list = config?.termoConfig || [];
    const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
    return list.find(p => p.sizes.includes(tam) && matchFlavor(p)) || list.find(p => p.sizes.includes(tam));
  }, [config]);

  const findStretchForProduct = useCallback((tam: number, sabor: string) => {
    const list = config?.stretchConfig || [];
    return list.find(p => p.sizes.includes(tam)) || list[0];
  }, [config]);

  const findTapaForProduct = useCallback((tam: number, sabor: string) => {
    const list = config?.tapaConfig || [];
    const matchFlavor = (p: any) => !p.flavors || p.flavors.length === 0 || p.flavors.includes(sabor);
    return list.find(p => p.sizes.includes(tam) && matchFlavor(p)) || list.find(p => p.sizes.includes(tam));
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

    return () => { unsubGoals(); unsubInsumos(); };
  }, [planningMonths]);

  const combinedData = useMemo(() => {
    if (!config) return { projection: [], consumption: {} };

    const requirementsByMonth: Record<string, Record<string, number>> = {};
    planningMonths.forEach(month => { requirementsByMonth[month] = {}; });

    goals.forEach(goal => {
      const { month, marca, sabor, tamano, quantity } = goal;
      if (!planningMonths.includes(month) || quantity <= 0) return;

      const reqObj = requirementsByMonth[month];
      const botellasPorPack = config?.botellasPorPack?.[tamano] || BOTELLAS_POR_PACK[tamano] || 6;
      const beverageLiters = quantity * botellasPorPack * (tamano / 1000);
      const mixRatio = config.co2Volumes?.[marca]?.[sabor] !== undefined && config.co2Volumes?.[marca]?.[sabor] === 0 ? 1 : 5;
      const syrupLitersNeeded = beverageLiters / mixRatio;
      const unitsRequired = (config.syrupFormulas?.[marca]?.[sabor]?.liters || 0) > 0 ? (syrupLitersNeeded / config.syrupFormulas[marca][sabor].liters) : 0;
      
      Object.keys(config.insumosMatrix?.[marca]?.[sabor] || {}).forEach(insName => {
        const kgPerUnit = config.insumosMatrix[marca][sabor][insName] || 0;
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
      reqObj[`Etiqueta ${marca} / ${sabor} / ${tamano}cc`] = (reqObj[`Etiqueta ${marca} / ${sabor} / ${tamano}cc`] || 0) + preformasNeeded;
    });

    const finalItems: Record<string, InsumosGrouped> = {};
    planningMonths.forEach(month => {
        Object.keys(requirementsByMonth[month]).forEach(insumo => {
            if (!insumo) return;
            if (!finalItems[insumo]) finalItems[insumo] = { name: insumo, category: getPackingCategory(insumo), monthlyReq: {} };
            planningMonths.forEach(m => finalItems[insumo].monthlyReq[m] = finalItems[insumo].monthlyReq[m] || 0);
            finalItems[insumo].monthlyReq[month] = (finalItems[insumo].monthlyReq[month] || 0) + requirementsByMonth[month][insumo];
        });
    });

    const items = Object.values(finalItems).filter(item => 
        Object.values(item.monthlyReq).some(val => val > 0)
    );

    const projectionResults = items.map(item => {
        const initialStock = stockData.reduce((acc, s) => {
            const mappedCode = insumoMappings[item.name];
            if (mappedCode && s.codigo && s.codigo.trim().toLowerCase() === mappedCode.trim().toLowerCase()) {
                return acc + (s.amount || s.STOCK || 0);
            }
            // Fallback to name matching
            const stockName = (s.insumo || s.NAME || '').toLowerCase();
            const itemName = item.name.toLowerCase();
            if (stockName.includes(itemName) || itemName.includes(stockName)) {
                return acc + (s.amount || s.STOCK || 0);
            }
            return acc;
        }, 0);

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

        return { ...item, initialStock, stockEvolution, stockoutMonthIndex, etaDate };
    });

    return { projection: projectionResults.sort((a,b) => (a.stockoutMonthIndex === -1 ? 1 : b.stockoutMonthIndex === -1 ? -1 : a.stockoutMonthIndex - b.stockoutMonthIndex)), items: items };
  }, [config, goals, planningMonths, stockData, findPreformaForProduct, findTermoForProduct, findStretchForProduct, findTapaForProduct, getPackingCategory]);

  if (loading) return <div className="flex justify-center p-12 animate-pulse text-blue-600">Cargando datos...</div>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-2xl font-black text-gray-900 tracking-tight">Gestión y Proyecciones de Insumos</h2>
        <div className="flex gap-2 mt-4">
            {(['proyeccion', 'consumo'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg text-sm font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-amber-600 text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {tab === 'proyeccion' ? 'Cobertura' : 'Consumo Mensual'}
                </button>
            ))}
        </div>
      </div>

      {activeTab === 'proyeccion' ? (
        <div className="space-y-6">
            {Object.keys(combinedData.items.reduce((acc, i) => { if(!acc[i.category]) acc[i.category] = []; acc[i.category].push(i); return acc; }, {} as Record<string, any[]>)).map(cat => (
                <div key={cat} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <h3 className="text-lg font-black text-amber-900 p-6 pb-0">{cat}</h3>
                    <table className="w-full text-left">
                    <thead className="bg-gray-100">
                        <tr>
                        <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest border-r">Insumo</th>
                        <th className="px-6 py-4 text-xs font-black text-gray-600 uppercase tracking-widest text-right">Inv. Hoy</th>
                        <th className="px-6 py-4 text-xs font-black text-gray-600 uppercase tracking-widest text-right">ETA Quiebre</th>
                        {planningMonths.map(m => <th key={m} className="px-2 py-4 text-[10px] font-black text-blue-700 uppercase tracking-widest text-center">{format(parseISO(`${m}-01`), 'MMM yy', { locale: es })}</th>)}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {combinedData.projection.filter(item => item.category === cat).map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-bold text-gray-900 border-r text-xs">{item.name}</td>
                            <td className="px-6 py-4 text-sm font-black text-gray-800 text-right">{Intl.NumberFormat('es-AR').format(Math.round(item.initialStock))}</td>
                            <td className="px-6 py-4 text-sm text-right">{item.etaDate ? <span className="text-red-700 font-black">{format(item.etaDate, 'd MMM', { locale: es })}</span> : <span className="text-emerald-600 font-black">OK</span>}</td>
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
      ) : (
        <div className="space-y-6">
            {Object.keys(combinedData.items.reduce((acc, i) => { if(!acc[i.category]) acc[i.category] = []; acc[i.category].push(i); return acc; }, {} as Record<string, any[]>)).map(cat => (
                <div key={cat} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                    <h3 className="text-lg font-black text-amber-900 mb-4">{cat}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead><tr className="text-gray-500 border-b">{['Insumo', ...planningMonths.map(m => format(parseISO(`${m}-01`), 'MMM yy', { locale: es }))].map(h => <th key={h} className="p-2">{h.toUpperCase()}</th>)}</tr></thead>
                            <tbody>{combinedData.items.filter(i => i.category === cat).map((item, idx) => (
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
    </div>
  );
}
