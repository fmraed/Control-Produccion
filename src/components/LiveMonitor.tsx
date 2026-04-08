import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase';
import { Activity, Clock, Package, Droplets, AlertCircle, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAppConfig } from '../hooks/useAppConfig';

interface LiveReport {
  id: string;
  type: 'production' | 'elaboracion';
  linea: string;
  turno: string;
  marca: string;
  sabor: string;
  tamano: number;
  updatedAt: string;
  // Production specific
  contInicial?: number;
  contFinal?: number;
  botRotas?: number;
  entraTurno?: string;
  saleTurno?: string;
  velocidad?: number;
  hourlyProduction?: any[];
  downtimes?: any[];
  // Elaboracion specific
  jarabeInicial?: number;
  jarabeFinal?: number;
  jarabeConsumido?: number;
  botellasProduccion?: number;
}

function formatNumber(num: number): string {
  if (num === undefined || num === null) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
  
  const entraParts = report.entraTurno.split(':');
  if (entraParts.length !== 2) return 0;
  
  let startHour = parseInt(entraParts[0], 10);
  const startMin = parseInt(entraParts[1], 10);
  
  // If saleTurno is provided, use it as the end time
  if (report.saleTurno) {
    const saleParts = report.saleTurno.split(':');
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

export function LiveMonitor() {
  const [liveData, setLiveData] = useState<LiveReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const { config } = useAppConfig();

  useEffect(() => {
    // Update the "time ago" every minute
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'live_production'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: LiveReport[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as LiveReport);
      });
      
      // Sort by line
      data.sort((a, b) => {
        const lineA = parseInt(a.linea) || 0;
        const lineB = parseInt(b.linea) || 0;
        return lineA - lineB;
      });
      
      setLiveData(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching live data:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Filter out old reports (e.g., not updated in the last 8 hours)
  const activeReports = liveData.filter(report => {
    if (!report.updatedAt) return false;
    const updatedDate = new Date(report.updatedAt);
    const hoursDiff = (now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60);
    return hoursDiff < 8; // Only show reports active in the last 8 hours
  });

  const productionReports = activeReports.filter(r => r.type === 'production');
  const elaboracionReports = activeReports.filter(r => r.type === 'elaboracion');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monitor en Vivo</h1>
          <p className="text-gray-500">Vista en tiempo real de la producción actual</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500 bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
          <RefreshCw className="w-4 h-4 animate-spin-slow text-blue-500" />
          Actualización automática
        </div>
      </div>

      {activeReports.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No hay producción activa</h3>
          <p className="text-gray-500 mt-1">Los partes que se estén completando en este momento aparecerán aquí.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Production Section */}
          {productionReports.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-600" />
                Líneas de Producción
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {productionReports.map((report) => {
                  const botellas = getBotellasTotales(report);
                  const botellasPorPack = config?.botellasPorPack?.[report.tamano] || 6;
                  const packs = Math.floor(botellas / botellasPorPack);
                  const efficiency = calculateLiveEfficiency(report, botellas);
                  
                  // Find last recorded hour
                  let lastHour = '--:--';
                  if (report.hourlyProduction) {
                    const recordedHours = report.hourlyProduction.filter(h => (h.marcador || 0) > 0);
                    if (recordedHours.length > 0) {
                      lastHour = recordedHours[recordedHours.length - 1].hora + 'hs';
                    }
                  }

                  // Calculate total downtime and find max machine
                  let totalDowntime = 0;
                  const machineDowntimes: Record<string, number> = {};
                  if (report.downtimes) {
                    report.downtimes.forEach(d => {
                      const category = d.category || 'Otros';
                      let machineMinutes = 0;
                      if (d.minutes && Array.isArray(d.minutes)) {
                        d.minutes.forEach(m => {
                          const val = Number(m);
                          if (!isNaN(val) && val > 0) {
                            totalDowntime += val;
                            machineMinutes += val;
                          }
                        });
                      }
                      machineDowntimes[category] = (machineDowntimes[category] || 0) + machineMinutes;
                    });
                  }

                  let maxMachine = '';
                  let maxMachineTime = 0;
                  Object.entries(machineDowntimes).forEach(([machine, time]) => {
                    if (time > maxMachineTime) {
                      maxMachineTime = time;
                      maxMachine = machine;
                    }
                  });

                  const updatedDate = new Date(report.updatedAt);
                  const isStale = (now.getTime() - updatedDate.getTime()) > (1000 * 60 * 30); // 30 mins

                  return (
                    <div key={report.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                      <div className={`p-4 border-b flex justify-between items-center ${isStale ? 'bg-orange-50 border-orange-100' : 'bg-blue-50 border-blue-100'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${isStale ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                            L{report.linea}
                          </div>
                          <div>
                            <h3 className="font-bold text-gray-900">Línea {report.linea}</h3>
                            <p className="text-xs text-gray-500">Turno {report.turno}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${isStale ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                            {isStale ? 'Inactivo' : 'Activo'}
                          </span>
                          <p className="text-[10px] text-gray-500 mt-1 flex items-center justify-end gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(updatedDate, { addSuffix: true, locale: es })}
                          </p>
                        </div>
                      </div>
                      
                      <div className="p-5 flex-1 flex flex-col gap-4">
                        <div className="flex justify-between items-end border-b border-gray-100 pb-3">
                          <div>
                            <p className="text-sm text-gray-500">Producto</p>
                            <p className="font-bold text-gray-900">{report.marca} {report.sabor}</p>
                            <p className="text-sm text-gray-600">{report.tamano} cc</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-500">Última carga</p>
                            <p className="font-bold text-blue-600 text-lg">{lastHour}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                            <p className="text-xs text-gray-500 font-medium mb-1">Total Botellas</p>
                            <p className="text-xl font-black text-gray-900">{formatNumber(botellas)}</p>
                          </div>
                          <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                            <p className="text-xs text-gray-500 font-medium mb-1">Total Packs</p>
                            <p className="text-xl font-black text-gray-900">{formatNumber(packs)}</p>
                          </div>
                          <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                            <p className="text-xs text-gray-500 font-medium mb-1">Eficiencia</p>
                            <p className={`text-xl font-black ${efficiency >= 80 ? 'text-green-600' : efficiency >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {efficiency > 0 ? `${efficiency}%` : '--'}
                            </p>
                          </div>
                        </div>

                        {totalDowntime > 0 && (
                          <div className="mt-auto pt-2">
                            <div className="flex items-center gap-2 text-orange-600 text-sm font-medium">
                              <AlertCircle className="w-4 h-4" />
                              <div className="flex flex-col">
                                <span>Tiempo de parada: {totalDowntime} min</span>
                                {maxMachine && (
                                  <span className="text-[10px] opacity-80">Máx: {maxMachine} ({maxMachineTime} min)</span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
