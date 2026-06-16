import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { collection, addDoc, updateDoc, doc, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ElaboracionReport, ElaboracionHourlyData } from '../types';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw, ChevronRight, Save, Route } from 'lucide-react';
import { format } from 'date-fns';
import { useAppConfig } from '../hooks/useAppConfig';
import { getShiftHours } from '../utils';
import { TURNOS, CARBONATION_TABLE, CARBONATION_PRESSURES, CARBONATION_TEMPS, SABORES_SIN_JARABE } from '../constants';

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
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: { userId: auth.currentUser?.uid },
    operationType,
    path
  };
  console.error('Firestore Error details: ', JSON.stringify(errInfo));
  return JSON.stringify(errInfo);
}

const parseTimeVal = (val: any) => {
  if (!val) return '';
  if (val instanceof Date) return format(val, 'HH:mm');
  const str = String(val);
  if (str.includes('_x000D_')) return str.split('_x000D_')[0].trim();
  if (/^\d{1,2}:\d{2}$/.test(str)) return str;
  if (!isNaN(Number(str))) {
    // Excel time fraction
    const totalMinutes = Math.round(Number(str) * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
  return str;
};

interface ExcelRow {
  [key: string]: any;
}

interface MappingResult {
  report: Omit<ElaboracionReport, 'id'>;
  status: 'pending' | 'success' | 'error';
  error?: string;
  originalRow: ExcelRow;
  importType?: 'new' | 'update' | 'checking';
}

export function HistoricalElaboracionImporter() {
  const { config } = useAppConfig();
  const [file, setFile] = useState<File | null>(null);
  const [mappings, setMappings] = useState<MappingResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingRecordsCache = useRef<Record<string, any>>({});

  const checkExistingRecords = async (currentMappings: MappingResult[]) => {
    const updated = [...currentMappings];
    if (updated.length === 0) return;

    let minDate = updated[0].report.fecha;
    let maxDate = updated[0].report.fecha;

    updated.forEach(m => {
      if (m.report.fecha < minDate) minDate = m.report.fecha;
      if (m.report.fecha > maxDate) maxDate = m.report.fecha;
    });

    try {
      const q = query(
        collection(db, 'elaboracion_reports'),
        where('fecha', '>=', minDate),
        where('fecha', '<=', maxDate)
      );
      const snap = await getDocs(q);
      const cache: Record<string, any> = {};
      snap.docs.forEach(doc => {
        const data = doc.data();
        const key = `${data.fecha}-${data.linea}-${data.turno}-${data.sabor}-${data.tamano}`;
        cache[key] = { id: doc.id, data };
      });
      existingRecordsCache.current = cache;

      updated.forEach(m => {
        if (m.status === 'pending') {
          const key = `${m.report.fecha}-${m.report.linea}-${m.report.turno}-${m.report.sabor}-${m.report.tamano}`;
          m.importType = cache[key] ? 'update' : 'new';
        }
      });
      setMappings([...updated]);
    } catch (err) {
      console.error("Error bulk checking elaboracion records:", err);
      // Fallback
      updated.forEach(m => {
         if (m.status === 'pending') {
             m.importType = 'new';
         }
      });
      setMappings([...updated]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setMappings([]);
      setSuccessCount(0);
    }
  };

  const processExcel = async () => {
    if (!file) return;
    setIsProcessing(true);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet) as ExcelRow[];

        const newMappings: MappingResult[] = rows.map(row => {
          try {
            let fechaStr = '';
            if (row['Fecha'] instanceof Date) {
              fechaStr = format(row['Fecha'], 'yyyy-MM-dd');
            } else if (typeof row['Fecha'] === 'string') {
              if (row['Fecha'].includes('/')) {
                const parts = row['Fecha'].split('/');
                if (parts.length === 3) {
                  fechaStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                } else {
                  fechaStr = row['Fecha'].split('T')[0];
                }
              } else {
                fechaStr = row['Fecha'].split('T')[0];
              }
            } else if (row['FECHA']) {
              fechaStr = row['FECHA'] instanceof Date ? format(row['FECHA'], 'yyyy-MM-dd') : String(row['FECHA']);
            } else {
              fechaStr = format(new Date(), 'yyyy-MM-dd');
            }

            let turno = String(row['Turno'] || 'Mañana').trim();
            if (turno.toLowerCase().includes('mañana')) turno = 'Mañana';
            else if (turno.toLowerCase().includes('tarde')) turno = 'Tarde';
            else if (turno.toLowerCase().includes('noche')) turno = 'Noche';

            let linea = String(row['Línea'] || row['Linea'] || '1').replace(/\D/g, '');
            if (!linea) linea = '1';

            let productoFull = String(row['Producto'] || row['Marca-Sabor'] || '');
            let marcaStr = 'Manaos';
            let saborStr = productoFull;
            if (productoFull) {
              if (productoFull.includes(' ')) {
                const parts = productoFull.split(' ');
                marcaStr = parts[0];
                saborStr = parts.slice(1).join(' ');
              } else {
                marcaStr = String(row['Marca'] || 'Manaos');
                saborStr = String(row['Sabor'] || productoFull || '');
              }
            } else {
              marcaStr = String(row['Marca'] || 'Manaos');
              saborStr = String(row['Sabor'] || '');
            }

            let tamanoVal = Number(row['Calibre'] || row['Tamaño'] || 500);

            const co2_1 = parseFloat(row['CO2 Inicial'] || row['Co2b21'] || row['CO2b21']);
            const co2_2 = parseFloat(row['CO2 Final'] || row['Co2b22'] || row['CO2b22']);
            
            let co2Inicial = undefined;
            let co2Final = undefined;
            if (!isNaN(co2_1) && !isNaN(co2_2) && co2_1 !== co2_2) {
              co2Inicial = co2_1;
              co2Final = co2_2;
            }

            const hourlyData: ElaboracionHourlyData[] = getShiftHours(turno, fechaStr).map(hora => {
              const data: any = {
                hora,
                loteElaboracion: '',
                tanque: '',
                codif: 'OK',
                cloro: 'OK',
                organoleptico: 'OK',
                micro: 'OK',
              };
              return data as ElaboracionHourlyData;
            });

            const reportData: any = {
              fecha: fechaStr,
              turno: turno,
              linea: linea,
              quimico: String(row['Supervisor'] || row['Operador'] || row['Quimico'] || row['Químico'] || 'Importado'),
              marca: marcaStr,
              sabor: saborStr,
              tamano: tamanoVal,
              lote: String(row['Lote'] || ''),
              planilla: String(row['Planilla'] || ''),
              hourlyData,
              createdAt: new Date().toISOString(),
              authorId: auth.currentUser?.uid || 'system',
              authorName: 'Importador Histórico',
            };

            const horaInicio = parseTimeVal(row['Hora Inicio'] || row['Inicio']);
            if (horaInicio) reportData.horaInicio = horaInicio;
            const horaFin = parseTimeVal(row['Hora Final'] || row['Hora Fin'] || row['Final']);
            if (horaFin) reportData.horaFin = horaFin;
            const contInicial = Number(row['Contador Inicial'] || row['Control de Botellas Inicial'] || row['Cont Inicial'] || 0);
            if (contInicial) reportData.contInicial = contInicial;
            const contFinal = Number(row['Contador Final'] || row['Control de Botellas Final'] || row['Cont Final'] || 0);
            if (contFinal) reportData.contFinal = contFinal;
            const jarabeInicial = Number(row['Jarabe Inicial'] || 0);
            if (jarabeInicial) reportData.jarabeInicial = jarabeInicial;
            const jarabeFinal = Number(row['Jarabe Final'] || 0);
            if (jarabeFinal) reportData.jarabeFinal = jarabeFinal;
            if (co2Inicial !== undefined) reportData.co2Inicial = co2Inicial;
            if (co2Final !== undefined) reportData.co2Final = co2Final;

            // Calculations
            const botellas = Math.max(0, contFinal - contInicial);
            const usesSyrup = !(config?.saboresSinJarabe || SABORES_SIN_JARABE).includes(saborStr || '');
            const teorico = usesSyrup ? Number(((botellas * (tamanoVal || 0)) / 6000).toFixed(2)) : 0;
            const consumido = usesSyrup ? Number((jarabeInicial - jarabeFinal).toFixed(2)) : 0;
            const desperdicio = Number((consumido - teorico).toFixed(2));
            const desperdicioPorc = teorico > 0 ? Number(((desperdicio / teorico) * 100).toFixed(2)) : 0;

            reportData.botellasProduccion = botellas;
            reportData.jarabeConsumido = consumido;
            reportData.jarabeTeorico = teorico;
            reportData.jarabeDesperdicio = desperdicio;
            reportData.jarabeDesperdicioPorcentaje = desperdicioPorc;

            let co2Consum = 0;
            if (co2Inicial !== undefined && co2Final !== undefined) {
              co2Consum = Number((co2Inicial - co2Final).toFixed(2));
            }
            reportData.co2Consumido = Math.max(0, co2Consum);

            const report = reportData as Omit<ElaboracionReport, 'id'>;

            return {
              report,
              status: 'pending',
              importType: 'checking',
              originalRow: row
            };
          } catch (err: any) {
             return {
              report: {} as any,
              status: 'error',
              error: err.message,
              originalRow: row
            };
          }
        });

        setMappings(newMappings);
        setIsProcessing(false);
        checkExistingRecords(newMappings);
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error("Error processing Excel:", error);
      setIsProcessing(false);
    }
  };

  const uploadData = async () => {
    if (mappings.filter(m => m.status === 'pending').length === 0) return;
    
    setIsUploading(true);
    setUploadProgress(0);
    let successful = 0;

    const pending = mappings.filter(m => m.status === 'pending');
    const total = pending.length;

    for (let i = 0; i < total; i++) {
       const m = pending[i];
       try {
          const key = `${m.report.fecha}-${m.report.linea}-${m.report.turno}-${m.report.sabor}-${m.report.tamano}`;
          const existingRecord = existingRecordsCache.current[key];

          if (!existingRecord) {
             await addDoc(collection(db, 'elaboracion_reports'), m.report);
          } else {
             await updateDoc(doc(db, 'elaboracion_reports', existingRecord.id), {
               ...m.report,
               authorId: existingRecord.data.authorId || m.report.authorId,
               createdAt: existingRecord.data.createdAt || m.report.createdAt
             });
          }
          successful++;
          m.status = 'success';
       } catch (err: any) {
          m.status = 'error';
          m.error = err.message;
       }
       setUploadProgress(Math.round(((i + 1) / total) * 100));
       setSuccessCount(successful);
       setMappings([...mappings]); // re-render
    }

    setIsUploading(false);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-20">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-emerald-100 rounded-xl">
            <Route className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Importador de Elaboración</h2>
            <p className="text-sm text-gray-500 font-medium italic">Sincroniza tus Excel de Partes de Elaboración</p>
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-xs text-emerald-700 space-y-2">
          <p><strong>Campos esperados:</strong></p>
          <ul className="list-disc list-inside space-y-1">
            <li>Fecha, Turno, Línea, Supervisor (o Químico), Planilla, Lote</li>
            <li>Producto (o Marca y Sabor)</li>
            <li>Inicio, Final</li>
            <li>Cont Inicial, Cont Final</li>
            <li>Jarabe Inicial, Jarabe Final</li>
            <li>Co2b21, Co2b22</li>
          </ul>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col items-center justify-center border-dashed border-2 hover:border-emerald-400 transition-all group">
        <input 
          type="file" 
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".xlsx, .xls, .csv"
          className="hidden"
        />
        
        {file ? (
          <div className="text-center space-y-4">
            <div className="bg-emerald-100 p-4 rounded-2xl inline-block">
              <FileSpreadsheet className="w-12 h-12 text-emerald-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                Cambiar Archivo
              </button>
              <button 
                onClick={processExcel}
                disabled={isProcessing}
                className="px-6 py-2 bg-emerald-600 text-white font-black rounded-lg shadow-lg hover:shadow-emerald-200 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                Analizar Excel
              </button>
            </div>
          </div>
        ) : (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="text-center cursor-pointer space-y-4"
          >
            <div className="bg-gray-100 p-4 rounded-2xl inline-block group-hover:bg-emerald-50 transition-colors">
              <Upload className="w-12 h-12 text-gray-400 group-hover:text-emerald-500" />
            </div>
            <div>
              <p className="font-bold text-gray-700">Haz clic o arrastra un archivo aquí</p>
              <p className="text-xs text-gray-400">Excel (.xlsx) o CSV</p>
            </div>
          </div>
        )}
      </div>

      {mappings.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <div>
                <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Detectado</span>
                <span className="text-xl font-black text-gray-900">{mappings.length} items</span>
              </div>
              <div className="w-px h-8 bg-gray-200" />
              <div>
                <span className="block text-[10px] font-black text-emerald-400 uppercase tracking-widest">Listos p/subir</span>
                <span className="text-xl font-black text-emerald-600">{mappings.filter(m => m.status === 'pending').length}</span>
              </div>
              {successCount > 0 && (
                <>
                  <div className="w-px h-8 bg-gray-200" />
                  <div>
                    <span className="block text-[10px] font-black text-blue-400 uppercase tracking-widest">Importados OK</span>
                    <span className="text-xl font-black text-blue-600">{successCount}</span>
                  </div>
                </>
              )}
            </div>

            {!isUploading && mappings.filter(m => m.status === 'pending').length > 0 && (
              <button 
                onClick={uploadData}
                className="w-full sm:w-auto px-8 py-3 bg-emerald-600 text-white font-black rounded-xl shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
              >
                <Save className="w-5 h-5" />
                Guardar en Base de Datos
              </button>
            )}

            {isUploading && (
              <div className="w-full sm:w-64 space-y-2">
                <div className="flex justify-between text-xs font-bold text-gray-900">
                  <span>Subiendo datos...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-600 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-100 text-gray-500 uppercase font-black sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-center">Operación</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Turno</th>
                  <th className="px-4 py-3">Línea</th>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3 text-right">Contadores</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mappings.map((m, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      {m.status === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
                       m.status === 'error' ? <AlertCircle className="w-4 h-4 text-rose-500" title={m.error} /> :
                       <div className="w-4 h-4 rounded-full border-2 border-gray-200" />}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {m.importType === 'checking' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500 animate-pulse border border-gray-200">
                          <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Verificando
                        </span>
                      )}
                      {m.importType === 'new' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Nuevo
                        </span>
                      )}
                      {m.importType === 'update' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          Actualización
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{m.report.fecha || '-'}</td>
                    <td className="px-4 py-3">{m.report.turno}</td>
                    <td className="px-4 py-3">L{m.report.linea}</td>
                    <td className="px-4 py-3">
                       <span className="font-bold text-gray-700">{m.report.sabor}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                       {m.report.contInicial} - {m.report.contFinal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
