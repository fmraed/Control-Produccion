import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { collection, addDoc, updateDoc, doc, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ProductionReport, Downtime } from '../types';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw, ChevronRight, Save } from 'lucide-react';
import { format } from 'date-fns';
import { useAppConfig } from '../hooks/useAppConfig';
import { getShiftHours } from '../utils';
import { CO2_VOLUMES, SABORES_SIN_JARABE, PACKS_POR_PALETA, BOTELLAS_POR_PACK, SEPARADORES_POR_PALETA } from '../constants';

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
  console.error('Firestore Error details: ', JSON.stringify(errInfo));
  return JSON.stringify(errInfo);
}

  const parseTurnoVal = (val: any) => {
    if (!val) return '';
    // If it's a Date object (often from Excel)
    if (val instanceof Date) {
      return format(val, 'HH:mm');
    }
    // If it's a string representation of an 1899 date
    const valStr = String(val);
    if (valStr.includes('1899')) {
      const d = new Date(valStr);
      if (!isNaN(d.getTime())) return format(d, 'HH:mm');
    }
    // If it's already a HH:mm string or similar
    if (/^\d{1,2}:\d{2}$/.test(valStr)) return valStr;
    
    return valStr;
  };

interface ExcelRow {
  [key: string]: any;
}

interface MappingResult {
  report: Omit<ProductionReport, 'id'>;
  status: 'pending' | 'success' | 'error';
  error?: string;
  originalRow: ExcelRow;
  importType?: 'new' | 'update' | 'checking';
}

export function HistoricalImporter() {
  const { config } = useAppConfig();
  const [file, setFile] = useState<File | null>(null);
  const [mappings, setMappings] = useState<MappingResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const checkExistingRecords = async (currentMappings: MappingResult[]) => {
    const updated = [...currentMappings];
    const pendingIndexes = updated
      .map((m, idx) => ({ m, idx }))
      .filter(({ m }) => m.status === 'pending');

    const batchSize = 10;
    for (let i = 0; i < pendingIndexes.length; i += batchSize) {
      const batch = pendingIndexes.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async ({ m, idx }) => {
          try {
            const q = query(
              collection(db, 'production_reports'),
              where('fecha', '==', m.report.fecha),
              where('linea', '==', m.report.linea),
              where('planilla', '==', m.report.planilla),
              where('sabor', '==', m.report.sabor),
              where('tamano', '==', m.report.tamano)
            );
            const existing = await getDocs(q);
            updated[idx] = {
              ...m,
              importType: existing.empty ? 'new' : 'update'
            };
          } catch (err) {
            console.error("Error checking record in background:", err);
            updated[idx] = {
              ...m,
              importType: 'new'
            };
          }
        })
      );
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
            // Mapping focused on the matching the HistoricalExporter format
            
            // 1. Fecha
            let fechaStr = '';
            if (row['Fecha'] instanceof Date) {
              fechaStr = format(row['Fecha'], 'yyyy-MM-dd');
            } else if (typeof row['Fecha'] === 'string') {
              fechaStr = row['Fecha'].split('T')[0];
            } else if (row['FECHA']) {
               fechaStr = row['FECHA'] instanceof Date ? format(row['FECHA'], 'yyyy-MM-dd') : String(row['FECHA']);
            }

            // 2. Turno (Normalizar: Mañana, Tarde, Noche)
            let turno = String(row['Turno'] || row['TURNO'] || 'Mañana').trim();
            // Handle variations
            if (turno.toLowerCase().includes('mañana')) turno = 'Mañana';
            else if (turno.toLowerCase().includes('tarde')) turno = 'Tarde';
            else if (turno.toLowerCase().includes('noche')) turno = 'Noche';

            // 3. Línea
            let linea = String(row['Línea'] || row['Linea'] || '1').replace(/\D/g, '');
            if (!linea) linea = '1';

            // 4. Producto (Marca / Sabor / Tamaño)
            let marcaStr = String(row['Marca'] || 'Manaos');
            let saborStr = String(row['Sabor'] || '');
            let tamanoVal = Number(row['Tamaño'] || 1500);

            // Mapeo de paradas (Downtime)
            const downtimes: Downtime[] = [];
            const SYSTEM_REASONS = [
              'SOPLADORA', 'TRANSPORTES NEUMATICOS', 'CARBONATADOR', 'RINSER', 'LLENADORA',
              'CAPSULADORA', 'CODIFICADOR', 'TRANSPORTES DE BOTELLAS', 'ETIQUETADORA',
              'EMPACADORA', 'TRANSPORTE DE PALLETS', 'PALLETIZADORA/ CARGA MANUAL',
              'CALIDAD', 'FALTA DE PERSONAL', 'REFRIGERIO/ INICIO Y FIN DE TURNO',
              'FALTA DE MONTACARGAS', 'SIN PROGRAMA', 'MANTENIMIENTO PROGRAMADO',
              'CAMBIO DE SABOR/ FORMATO', 'FALTA DE ENERGIA', 'COMPRESORES', 'FRIO',
              'AGUA', 'FALTA DE JARABE', 'LUBRICACION', 'GAS CARBONICO / NITROGENO',
              'FALTA DE MAT. PRIMAS/INSUMOS', 'OTRAS AJENAS A LINEA', 'SIN REGISTRAR'
            ];

            SYSTEM_REASONS.forEach(reason => {
              const val = Number(row[reason]);
              if (val > 0) {
                // Categorization logic based on name to match system categories if possible
                let category = 'PARADAS OPERATIVAS';
                
                const paradasLinea = [
                  'SOPLADORA', 'TRANSPORTES NEUMATICOS', 'CARBONATADOR', 'RINSER', 'LLENADORA',
                  'CAPSULADORA', 'CODIFICADOR', 'TRANSPORTES DE BOTELLAS', 'ETIQUETADORA',
                  'EMPACADORA', 'TRANSPORTE DE PALLETS', 'PALLETIZADORA/ CARGA MANUAL'
                ];
                
                const paradasOperativas = [
                  'CALIDAD', 'FALTA DE PERSONAL', 'REFRIGERIO/ INICIO Y FIN DE TURNO',
                  'FALTA DE MONTACARGAS'
                ];
                
                const paradasAjenas = [
                  'SIN PROGRAMA', 'MANTENIMIENTO PROGRAMADO', 'CAMBIO DE SABOR/ FORMATO',
                  'FALTA DE ENERGIA', 'COMPRESORES', 'FRIO', 'AGUA', 'FALTA DE JARABE',
                  'LUBRICACION', 'GAS CARBONICO / NITROGENO', 'FALTA DE MAT. PRIMAS/INSUMOS',
                  'OTRAS AJENAS A LINEA'
                ];

                if (paradasLinea.includes(reason)) category = 'PARADAS DE LINEA';
                else if (paradasOperativas.includes(reason)) category = 'PARADAS OPERATIVAS';
                else if (paradasAjenas.includes(reason)) category = 'PARADAS AJENAS A LINEA';
                else if (reason === 'SIN REGISTRAR') category = 'TIEMPO NO ASIGNADO';

                downtimes.push({
                  category,
                  reason,
                  minutes: [val],
                  totalMinutes: val
                });
              }
            });

            // Production per hour
            const contInicial = Number(row['Contador Inicial'] || 0);
            const hourlyProduction: any[] = [];
            let currentMarcador = contInicial;
            let lastHourWithProduction = 0;
            
            // Determinar la última hora real con producción para no agregar ceros innecesarios al final
            for (let i = 1; i <= 12; i++) {
              if (Number(row[`${i}ª hora`] || 0) > 0) {
                lastHourWithProduction = i;
              }
            }

            const expectedHours = getShiftHours(turno, fechaStr);

            const velocidad = Number(row['Velocidad Nominal'] || 0);

            for (let i = 1; i <= 12; i++) {
              const label = `${i}ª hora`;
              const bottles = Number(row[label] || 0);
              
              if (bottles > 0) {
                currentMarcador += bottles;
              }

              // Guardamos la hora si hay produccion, o si todavia estamos antes de la ultima hora de produccion, 
              // o si hay una etiqueta en el objeto. Ademas limitamos a expectedHours.length a menos que la produccion rebase
              if (i <= lastHourWithProduction || row.hasOwnProperty(label) || i <= expectedHours.length) {
                let horaLabel = expectedHours[i - 1] || `${i}ª hora`;
                hourlyProduction.push({
                  hora: horaLabel,
                  marcador: currentMarcador,
                  botMin: bottles,
                  minProd: velocidad ? Math.round((bottles / velocidad) * 10) / 10 : 0
                });
              }
            }

            const rawEfic = Number(row['Eficiencia'] || 0);
            const parsedEfic = rawEfic > 0 && rawEfic <= 2 ? Math.round(rawEfic * 100) : Math.round(rawEfic);

            const botellasTotales = Number(row['Botellas'] || 0);
            const contFinal = Number(row['Contador Final'] || 0);
            const botellasCalc = botellasTotales || Math.max(0, contFinal - contInicial);
            
            // Jarabe
            const jarabeInicial = Number(row['Jarabe Inicial'] || row['Jarabe inicial'] || 0);
            const jarabeFinal = Number(row['Jarabe Final'] || row['Jarabe final'] || 0);
            let jarabeConsumido = Number(row['Jarabe Consumido'] || row['Jarabe consumido'] || 0);

            const usesSyrup = !(config?.saboresSinJarabe || SABORES_SIN_JARABE).includes(saborStr || '');
            if (jarabeConsumido === 0 && jarabeInicial !== jarabeFinal && typeof jarabeInicial === 'number' && typeof jarabeFinal === 'number') {
               jarabeConsumido = Number((jarabeInicial - jarabeFinal).toFixed(3));
            } else if (jarabeConsumido === 0 && usesSyrup && botellasCalc > 0) {
               // Aprox teorico basado en el mismo cálculo del formulario
               const litrosBebida = (botellasCalc * tamanoVal) / 1000;
               jarabeConsumido = Number((litrosBebida / 6).toFixed(3));
            }

            // CO2
            let co2 = Number(row['CO2'] || row['Co2'] || 0);
            if (co2 === 0 && botellasCalc > 0) {
               const vol = (config?.co2Volumes || CO2_VOLUMES)[marcaStr]?.[saborStr || ''] || 0;
               const litrosBebida = (botellasCalc * tamanoVal) / 1000;
               co2 = Number(((litrosBebida * vol * 1.9765) / 1000).toFixed(1));
            }

            // Paletas / Paquetes
            let packagesThisShift = Number(row['Paquetes'] || row['PAQUETES'] || 0);
            if (packagesThisShift === 0 && botellasCalc > 0) {
              const botellasPorPack = config?.botellasPorPack?.[tamanoVal] || BOTELLAS_POR_PACK[tamanoVal] || 6;
              packagesThisShift = Math.floor(botellasCalc / botellasPorPack);
            }

            const parcialAnterior = Number(row['Parcial Anterior'] ?? row['PARCIAL ANTERIOR'] ?? 0);
            const ajusteParcial = Number(row['Ajuste Parcial'] ?? row['AJUSTE PARCIAL'] ?? 0);
            
            // Detection of "Paletas Term." or "Tickets"
            let paletasTerm = Number(row['Tickets (Total Paletas)'] ?? row['Paletas Term.'] ?? row['Tickets'] ?? row['TICKETS'] ?? row['Paletizado'] ?? row['Paletas'] ?? row['PALETIZADO'] ?? row['PALETAS'] ?? row['Total Paletas'] ?? 0);
            
            // Detection of leftovers (parcial actual)
            let parcialActual = Number(row['Paquetes Sobrantes (Parcial Actual)'] ?? row['Parcial Actual'] ?? row['PARCIAL ACTUAL'] ?? row['Paquetes (no entraron completar paleta)'] ?? 0);
            
            // Detection of separators
            let separadoresTerm = Number(row['Separadores'] ?? row['SEPARADORES'] ?? 0);

            const packsPorPaleta = config?.packsPorPaleta?.[tamanoVal] || PACKS_POR_PALETA[tamanoVal] || 1;

            // Recalculate if missing or 0
            const totalPacks = packagesThisShift + parcialAnterior + ajusteParcial;
            
            if (paletasTerm === 0 && totalPacks > 0) {
               // If paletasTerm is tickets (based on totalPacks)
               paletasTerm = Math.floor(totalPacks / packsPorPaleta);
            }
            
            if (parcialActual === 0 && totalPacks > 0) {
               parcialActual = totalPacks % packsPorPaleta;
            }

            // Calculation for this shift only (for paletasDeEsteParte)
            let paletasDeEsteParte = Number(row['Paletas de este Parte'] ?? 0);
            if (paletasDeEsteParte === 0) {
               paletasDeEsteParte = Math.floor(packagesThisShift / packsPorPaleta);
            }

            if (separadoresTerm === 0 && paletasDeEsteParte > 0) {
                const separadoresBase = SEPARADORES_POR_PALETA[tamanoVal] || 0;
                const sombrero = Math.floor(paletasDeEsteParte / 2);
                separadoresTerm = (paletasDeEsteParte * separadoresBase) + sombrero;
            }

            const report: Omit<ProductionReport, 'id'> = {
              fecha: fechaStr,
              turno: turno,
              linea: linea,
              supervisor: String(row['Supervisor'] || 'IMPORTACIÓN HISTÓRICA'),
              planilla: String(row['Planilla'] || '0'),
              entraTurno: parseTurnoVal(row['Entra Turno'] || row['ENTRA TURNO']),
              saleTurno: parseTurnoVal(row['Sale Turno'] || row['SALE TURNO']),
              lote: String(row['Lote'] || ''),
              marca: marcaStr,
              sabor: saborStr,
              tamano: tamanoVal,
              contInicial: contInicial,
              contFinal: contFinal,
              botellas: botellasTotales,
              paquetes: packagesThisShift,
              parcialAnterior: parcialAnterior,
              ajusteParcial: ajusteParcial,
              tickets: paletasTerm, // In the system 'tickets' is the total pallets (including partials)
              parcialActual: parcialActual,
              botRotas: Number(row['Botellas Rotas'] || 0),
              paletasDeEsteParte: paletasDeEsteParte,
              totalSeparadores: separadoresTerm,
              velocidad: Number(row['Velocidad Nominal'] || 0),
              tiempoTurno: Number(row['Tiempo Turno'] || 0),
              eficBruta: parsedEfic,
              co2: co2,
              jarabeInicial: jarabeInicial,
              jarabeFinal: jarabeFinal,
              jarabeConsumido: jarabeConsumido,
              observaciones: String(row['Observaciones'] || `Importado desde Excel Histórico (${file.name})`),
              
              // Wastes
              scrapSoplado: Number(row['Scrap Soplado'] || 0),
              scrapEtiquetado: Number(row['Scrap Etiquetado'] || 0),
              scrapLlenado: Number(row['Scrap Llenado'] || 0),
              scrapHorno: Number(row['Scrap Horno'] || 0),
              desperdicioEtiquetas: Number(row['Desperdicio Etiquetas'] || 0),
              desperdicioTapas: Number(row['Desperdicio Tapas'] || 0),
              desperdicioSifones: Number(row['Desperdicio Sifones'] || 0),
              desperdicioTermo: Number(row['Desperdicio Termo'] || 0),

              createdAt: new Date().toISOString(),
              authorId: auth.currentUser?.uid || 'system',
              authorName: 'Importador Histórico',
              origin: 'historical',
              hourlyProduction,
              downtimes: downtimes,
            };

            // Validaciones básicas
            if (!report.fecha) throw new Error('Falta Fecha');
            if (!report.linea) throw new Error('Falta Línea');

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
          // Evitar duplicados (opcional: buscar por fecha, turno, linea, planilla)
          const q = query(
            collection(db, 'production_reports'),
            where('fecha', '==', m.report.fecha),
            where('linea', '==', m.report.linea),
            where('planilla', '==', m.report.planilla),
            where('sabor', '==', m.report.sabor),
            where('tamano', '==', m.report.tamano)
          );
          const existing = await getDocs(q);
          if (existing.empty) {
            console.log('Importing new record:', m.report.fecha, m.report.linea, m.report.planilla);
            const reportToImport = {
               ...m.report,
               authorId: auth.currentUser?.uid
            };
            console.log('Final Report object to import:', reportToImport);
            try {
               await addDoc(collection(db, 'production_reports'), reportToImport);
            } catch (err: any) {
               console.error('Firestore operation FAILED for:', reportToImport);
               throw new Error(handleFirestoreError(err, OperationType.CREATE, 'production_reports'));
            }
          } else {
            console.log('Updating existing record:', existing.docs[0].id);
            const existingDoc = existing.docs[0];
            const existingData = existingDoc.data();
            try {
               await updateDoc(doc(db, 'production_reports', existingDoc.id), {
                 ...m.report,
                 // Preserve immutable fields to satisfy security rules
                 authorId: existingData.authorId,
                 createdAt: existingData.createdAt,
                 updatedAt: new Date().toISOString()
               });
            } catch (err: any) {
               throw new Error(handleFirestoreError(err, OperationType.UPDATE, 'production_reports/' + existing.docs[0].id));
            }
          }
          successful++;
          m.status = 'success';
       } catch (err: any) {
          console.error('Import error:', err.message);
          m.status = 'error';
          m.error = err.message;
       }
       
       setUploadProgress(Math.round(((i + 1) / total) * 100));
       setSuccessCount(successful);
       setMappings([...mappings]); // Forzar re-render
    }

    setIsUploading(false);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-20">
      {/* Introduction Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-blue-100 rounded-xl">
            <FileSpreadsheet className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Importador de Datos Históricos</h2>
            <p className="text-sm text-gray-500 font-medium italic">Sincroniza tus Excel de años anteriores con la base de datos actual</p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 space-y-2">
          <p><strong>Instrucciones:</strong></p>
          <ul className="list-disc list-inside space-y-1">
            <li>Sube el archivo Excel con las columnas de producción.</li>
            <li>El sistema buscará automáticamente campos como: Fecha, Turno, Línea, Sabor, Contadores, Botellas y Paradas.</li>
            <li>Las ~25 columnas de micro-paradas del Excel se agruparán automáticamente en la lista de paradas del reporte.</li>
            <li>Podrás revisar los datos antes de guardarlos definitivamente en el sistema.</li>
          </ul>
        </div>
      </div>

      {/* Upload Zone */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col items-center justify-center border-dashed border-2 hover:border-blue-400 transition-all group">
        <input 
          type="file" 
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".xlsx, .xls, .csv"
          className="hidden"
        />
        
        {file ? (
          <div className="text-center space-y-4">
            <div className="bg-blue-100 p-4 rounded-2xl inline-block">
              <FileSpreadsheet className="w-12 h-12 text-blue-600" />
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
                className="px-6 py-2 bg-blue-600 text-white font-black rounded-lg shadow-lg hover:shadow-blue-200 transition-all flex items-center gap-2 disabled:opacity-50"
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
            <div className="bg-gray-100 p-4 rounded-2xl inline-block group-hover:bg-blue-50 transition-colors">
              <Upload className="w-12 h-12 text-gray-400 group-hover:text-blue-500" />
            </div>
            <div>
              <p className="font-bold text-gray-700">Haz clic o arrastra un archivo aquí</p>
              <p className="text-xs text-gray-400">Excel (.xlsx) o CSV</p>
            </div>
          </div>
        )}
      </div>

      {/* Results View */}
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
                className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white font-black rounded-xl shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
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
                    className="h-full bg-indigo-600 transition-all duration-300"
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
                  <th className="px-4 py-3 text-right">Paquetes</th>
                  <th className="px-4 py-3 text-right">Paradas (Eventos)</th>
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
                       <span className="font-bold text-gray-700">{m.report.marca} {m.report.sabor}</span>
                       <span className="text-[10px] text-gray-400 ml-1">{m.report.tamano}cc</span>
                    </td>
                    <td className="px-4 py-3 text-right font-black text-indigo-600">{m.report.paquetes?.toLocaleString('es-AR')}</td>
                    <td className="px-4 py-3 text-right">{m.report.downtimes?.length} eventos</td>
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
