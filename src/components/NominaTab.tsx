import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Employee } from '../types';
import { format, startOfMonth, endOfMonth, parseISO, differenceInYears } from 'date-fns';
import { Users, DollarSign, Clock, Briefcase, FileText, AlertCircle } from 'lucide-react';

interface NominaTabProps {
  employees: Employee[];
  config: any;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function NominaTab({ employees, config }: NominaTabProps) {
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [productionHours, setProductionHours] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProductionHours = async () => {
      setLoading(true);
      setLocalError(null);
      const collectionPath = 'production_reports';
      try {
        const monthStart = startOfMonth(parseISO(`${selectedMonth}-01`));
        const monthEnd = endOfMonth(parseISO(`${selectedMonth}-01`));
        
        const q = query(
          collection(db, collectionPath),
          where('fecha', '>=', format(monthStart, 'yyyy-MM-dd')),
          where('fecha', '<=', format(monthEnd, 'yyyy-MM-dd'))
        );
        
        const snap = await getDocs(q);
        let totalMinutes = 0;
        snap.forEach(doc => {
          const data = doc.data();
          if (data.tiempoTurno) {
            totalMinutes += Number(data.tiempoTurno);
          } else if (data.tiempoBruto) {
            totalMinutes += Number(data.tiempoBruto);
          }
        });
        setProductionHours(totalMinutes / 60);
      } catch (error: any) {
        setLocalError(error.message || "Error al obtener horas de producción");
        try {
          handleFirestoreError(error, OperationType.GET, collectionPath);
        } catch (e) {
          // Error already logged and re-thrown
        }
      } finally {
        setLoading(false);
      }
    };
    
    fetchProductionHours();
  }, [selectedMonth]);

  const activeEmployees = employees.filter(e => e.active);
  const totalPersonal = activeEmployees.length;
  
  const efectivos = activeEmployees.filter(e => e.type === 'Efectivo').length;
  const temporarios = activeEmployees.filter(e => e.type === 'Temporario').length;

  const normalizeRango = (r: string) => {
    if (!r) return 'Sin Categoría';
    if (r.startsWith('Ingresante sin Formación')) return 'Ingresante sin Formación';
    if (r.startsWith('Operario Práctico')) return 'Operario Práctico';
    return r;
  };

  const salarios = config?.salariosPorRango || {};
  
  // Find salary considering suffixes
  const getSalarioParaRango = (rango: string) => {
    if (salarios[rango]) return Number(salarios[rango]);
    // Try without suffixes
    const baseRango = rango.split(' (')[0];
    if (salarios[baseRango]) return Number(salarios[baseRango]);
    // Try common ones
    if (rango.includes('Ingresante sin Formación')) {
       return Number(salarios['Ingresante sin Formación (Producción)'] || salarios['Ingresante sin Formación (Mantenimiento)'] || 0);
    }
    return 0;
  };

  const salarioOpInt = Number(salarios['Operario de Producción Interno'] || 0);

  const breakdownCategorias = activeEmployees.reduce((acc, emp) => {
    const cat = emp.rango || 'Sin Categoría';
    if (!acc[cat]) {
      acc[cat] = {
        count: 0,
        tempCount: 0,
        efectivoCount: 0,
        totalSueldoBase: 0,
        totalPresentismo: 0,
        totalAntiguedad: 0,
        totalCosto: 0
      };
    }
    
    let empCost = 0;
    const sueldoBase = getSalarioParaRango(emp.rango || '');
    if (sueldoBase > 0) {
      acc[cat].totalSueldoBase += sueldoBase;
      empCost += sueldoBase;
    }

    const presentismo = (salarioOpInt * 0.01) * 25;
    acc[cat].totalPresentismo += presentismo;
    empCost += presentismo;

    let antiguedad = 0;
    if (emp.hireDate) {
      const years = differenceInYears(new Date(), new Date(emp.hireDate));
      if (years > 0) {
        antiguedad = (salarioOpInt * 0.01) * years;
      }
    }
    acc[cat].totalAntiguedad += antiguedad;
    empCost += antiguedad;

    acc[cat].totalCosto += empCost;
    acc[cat].count += 1;
    if (emp.type === 'Efectivo') acc[cat].efectivoCount += 1;
    else acc[cat].tempCount += 1;
    
    return acc;
  }, {} as Record<string, { count: number, efectivoCount: number, tempCount: number, totalSueldoBase: number, totalPresentismo: number, totalAntiguedad: number, totalCosto: number }>);

  const totalSueldoBase = Object.values(breakdownCategorias).reduce((sum, cat) => sum + cat.totalSueldoBase, 0);
  const totalPresentismo = Object.values(breakdownCategorias).reduce((sum, cat) => sum + cat.totalPresentismo, 0);
  const totalAntiguedad = Object.values(breakdownCategorias).reduce((sum, cat) => sum + cat.totalAntiguedad, 0);
  const costoTotalEstimado = Object.values(breakdownCategorias).reduce((sum, cat) => sum + cat.totalCosto, 0);

  const promedioPorEmpleado = totalPersonal > 0 ? costoTotalEstimado / totalPersonal : 0;
  const costoHoraHombreBase = totalPersonal > 0 ? costoTotalEstimado / (totalPersonal * 176) : 0;
  
  // Real calculation based on real production hours.
  const costoHoraHombreReal = productionHours > 0 ? costoTotalEstimado / productionHours : 0;

  const allRanges = Array.from(new Set([
    ...Object.keys(salarios),
    ...Object.keys(breakdownCategorias)
  ])).filter(r => r !== 'Sin Categoría');

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800">
            <Briefcase className="text-blue-600" />
            Resumen de Nómina
          </h2>
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-1">Análisis de composición y costos</p>
        </div>
        
        <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-xl border border-gray-100">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-2">Mes:</label>
          <input 
            type="month" 
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* Composición */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col">
          <div className="flex items-center gap-2 text-gray-500 mb-6 border-b border-gray-100 pb-4">
            <Users className="w-5 h-5" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Composición Personal</h3>
          </div>
          
          <div className="flex flex-col gap-6 flex-1">
            <div>
              <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Activos</span>
              <span className="text-4xl font-black text-gray-900">{totalPersonal}</span>
            </div>
            
            <div className="flex gap-4">
              <div className="flex-1 bg-blue-50 p-3 rounded-xl border border-blue-100">
                <span className="block text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">Efectivos</span>
                <span className="text-2xl font-black text-blue-700">{efectivos}</span>
              </div>
              <div className="flex-1 bg-orange-50 p-3 rounded-xl border border-orange-100">
                <span className="block text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">Temporarios</span>
                <span className="text-2xl font-black text-orange-700">{temporarios}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Costos Generales */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col">
          <div className="flex items-center gap-2 text-gray-500 mb-6 border-b border-gray-100 pb-4">
            <DollarSign className="w-5 h-5 text-green-600" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Costos Globales Mes</h3>
          </div>
          
          <div className="flex flex-col gap-6 flex-1">
            <div>
              <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Costo Salarial Base Estimado</span>
              <span className="text-3xl font-black text-green-600">${costoTotalEstimado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <div className="mt-3 space-y-1 text-[11px] font-medium text-gray-500">
                <div className="flex justify-between"><span>Sueldos Base:</span> <span>${totalSueldoBase.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between"><span>Presentismo:</span> <span>${totalPresentismo.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between"><span>Antigüedad:</span> <span>${totalAntiguedad.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
              </div>
            </div>
            
            <div className="bg-green-50 p-4 rounded-xl border border-green-100 mt-auto">
              <span className="block text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">Costo Promedio por Empleado</span>
              <span className="text-xl font-black text-green-800">${promedioPorEmpleado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Productividad */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col">
          <div className="flex items-center gap-2 text-gray-500 mb-6 border-b border-gray-100 pb-4">
            <Clock className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Costo Hora Hombre (HH)</h3>
          </div>
          
          <div className="flex flex-col justify-between flex-1 gap-4">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 border-l-4 border-l-gray-400">
              <span className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Promedio HH (Base 176 hs/mes)</span>
              <span className="text-xl font-black text-gray-700">${costoHoraHombreBase.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-gray-400 font-medium normal-case">/ hr</span></span>
            </div>
            
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 border-l-4 border-l-blue-500">
              <div className="flex justify-between items-start">
                <span className="block text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">Promedio HH (Real del mes)</span>
                {loading && <Clock className="w-3 h-3 text-blue-400 animate-spin" />}
              </div>
              <span className="text-xl font-black text-blue-700">${costoHoraHombreReal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-blue-400 font-medium normal-case">/ hr</span></span>
              <span className="block text-[10px] font-bold text-blue-400 mt-2">En base a {productionHours.toFixed(1)} hs producidas en el mes</span>
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown de Categorías */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-gray-700">
            <FileText className="w-4 h-4 text-gray-400" />
            Distribución por Rango/Categoría
          </h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {allRanges.sort((a,b)=> (breakdownCategorias[b]?.count || 0) - (breakdownCategorias[a]?.count || 0)).map((rango) => {
              const data = breakdownCategorias[rango] || {
                count: 0,
                tempCount: 0,
                efectivoCount: 0,
                totalSueldoBase: 0,
                totalPresentismo: 0,
                totalAntiguedad: 0,
                totalCosto: 0
              };
              const porcentaje = totalPersonal > 0 ? Math.round((data.count / totalPersonal) * 100) : 0;
              const sueldoBaseIndividual = data.count > 0 ? data.totalSueldoBase / data.count : getSalarioParaRango(rango);
              const costoTotalIndividual = data.count > 0 ? data.totalCosto / data.count : (sueldoBaseIndividual + (salarioOpInt * 0.01 * 25));
              const costoHoraIndividual = costoTotalIndividual / 176;

              return (
                <div key={rango} className={`bg-gray-50 p-5 rounded-2xl border flex flex-col justify-between group hover:border-blue-200 transition-all ${data.count === 0 ? 'opacity-60 grayscale-[0.5]' : 'border-gray-200'}`}>
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="font-bold text-[11px] text-gray-700 uppercase line-clamp-2 max-w-[70%]">{rango}</h4>
                      <span className="text-[10px] font-black bg-white border border-gray-100 text-gray-400 px-2 py-0.5 rounded-full">{porcentaje}%</span>
                    </div>
                    
                    <div className="flex items-end gap-3 mb-6">
                       <span className="text-4xl font-black text-gray-900 leading-none">{data.count}</span>
                       <div className="flex flex-col text-[9px] font-bold uppercase text-gray-400 tracking-tighter">
                         <span className={data.efectivoCount > 0 ? 'text-blue-500' : ''}>{data.efectivoCount} Efec.</span>
                         <span className={data.tempCount > 0 ? 'text-orange-500' : ''}>{data.tempCount} Temp.</span>
                       </div>
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-gray-100 pt-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sueldo Base</span>
                      <span className="font-mono text-xs font-bold text-gray-600">${sueldoBaseIndividual.toLocaleString('es-AR')}</span>
                    </div>
                    <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-gray-100">
                      <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Costo HH/Est.</span>
                      <span className="font-mono text-xs font-black text-blue-700">${costoHoraIndividual.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Costo Total Cat.</span>
                      <span className="font-mono text-xs font-bold text-gray-800">${data.totalCosto.toLocaleString('es-AR')}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {allRanges.length === 0 && (
            <p className="text-center text-gray-400 font-bold text-sm py-4">No hay categorías configuradas o personal activo</p>
          )}
        </div>
      </div>
    </div>
  );
}
