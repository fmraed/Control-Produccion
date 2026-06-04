import React, { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
} from "firebase/firestore";
import { db, handleFirestoreError, auth, OperationType } from "../firebase";
import { ProductionReport } from "../types";
import {
  format,
  startOfMonth,
  endOfMonth,
  getDaysInMonth,
  eachDayOfInterval,
  isWeekend,
  parseISO,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  Zap,
  Settings,
  TrendingUp,
  Calendar,
  Save,
  Calculator,
  Activity,
  Edit2,
  BarChart2,
} from "lucide-react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getShiftHours, getLogicalDate } from "../utils";

interface EnergyFactors {
  intercept: number;
  linea1: number;
  linea2: number;
  linea3: number;
  admin: number;
  calentamiento: number;
  botellas: Record<number, number>;
}

const DEFAULT_FACTORS: EnergyFactors = {
  intercept: 109.2800287,
  linea1: 328.8309169,
  linea2: 283.7165341,
  linea3: 315.5893661,
  admin: 59.5164196,
  calentamiento: 152.2213702,
  botellas: {
    3000: 0.069076159,
    2250: 0.060167349,
    2000: 0.055710421,
    1500: 0.072274399,
    500: 0.044672727,
  },
};

interface MonthlyRealEnergy {
  kwh: number;
  amount: number;
}

export function EnergyReport() {
  const [selectedMonth, setSelectedMonth] = useState<string>(
    format(new Date(), "yyyy-MM"),
  );
  const [activeTab, setActiveTab] = useState<"predictivo" | "kwh_pack">(
    "predictivo",
  );
  const [visibleLines, setVisibleLines] = useState<{
    kwh: boolean;
    predictedKwh: boolean;
    packs: boolean;
    ratio: boolean;
  }>({
    kwh: true,
    predictedKwh: true,
    packs: true,
    ratio: true,
  });
  const [factors, setFactors] = useState<EnergyFactors>(DEFAULT_FACTORS);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allReports, setAllReports] = useState<ProductionReport[]>([]);
  const [realEnergy, setRealEnergy] = useState<
    Record<string, MonthlyRealEnergy>
  >({});
  const [editReal, setEditReal] = useState<{ kwh: number; amount: number }>({
    kwh: 0,
    amount: 0,
  });
  const [isEditingReal, setIsEditingReal] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Local state for settings editing
  const [editFactors, setEditFactors] =
    useState<EnergyFactors>(DEFAULT_FACTORS);

  // Derrived state for current view
  const reports = allReports.filter((r) => getLogicalDate(r).startsWith(selectedMonth));

  useEffect(() => {
    // Load factors
    const loadFactors = async () => {
      try {
        const docRef = doc(db, "config", "energyFactors");
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          setFactors(snap.data() as EnergyFactors);
          setEditFactors(snap.data() as EnergyFactors);
        }
      } catch (err) {
        console.error("Error loading energy factors:", err);
      }
    };
    loadFactors();
  }, []);

  const [user, setUser] = useState<any>(auth.currentUser);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Load real energy records once for the collection
    const loadRealEnergy = onSnapshot(
      collection(db, "energyRecords"),
      (snap) => {
        const records: Record<string, MonthlyRealEnergy> = {};
        snap.forEach((doc) => {
          records[doc.id] = doc.data() as MonthlyRealEnergy;
        });
        setRealEnergy(records);
      },
      (error) => {
        console.error("onSnapshot energyRecords error:", error);
        // Log gracefully without throwing fatal exceptions that crash the tab
      }
    );

    return () => loadRealEnergy();
  }, [user]);

  // Synchronize editReal state only when we are NOT currently editing
  useEffect(() => {
    if (!isEditingReal) {
      if (realEnergy[selectedMonth]) {
        setEditReal(realEnergy[selectedMonth]);
      } else {
        setEditReal({ kwh: 0, amount: 0 });
      }
    }
  }, [selectedMonth, realEnergy, isEditingReal]);

  // Reset editing mode when month changes
  useEffect(() => {
    setIsEditingReal(false);
  }, [selectedMonth]);

  useEffect(() => {
    const fetchAllReports = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, "production_reports"));

        const snap = await getDocs(q);
        const data = snap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as ProductionReport,
        );
        setAllReports(data);
      } catch (err) {
        console.error("Error fetching production reports:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllReports();
  }, []);

  const handleSaveFactors = async () => {
    setSavingSettings(true);
    try {
      await setDoc(doc(db, "config", "energyFactors"), editFactors);
      setFactors(editFactors);
      setShowSettings(false);
    } catch (err) {
      console.error("Error saving factors:", err);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveRealEnergy = async () => {
    const cleanKwh = Number(editReal.kwh) || 0;
    const cleanAmount = Number(editReal.amount) || 0;
    
    const savedVal = {
      kwh: cleanKwh,
      amount: cleanAmount,
    };

    try {
      // Actualización optimista instantánea
      setRealEnergy((prev) => ({
        ...prev,
        [selectedMonth]: savedVal,
      }));
      setIsEditingReal(false);

      // Guardado asíncrono en Firestore
      await setDoc(doc(db, "energyRecords", selectedMonth), savedVal);
    } catch (err) {
      console.error("Error saving real energy:", err);
    }
  };

  // Calculations
  const calculatePrediction = () => {
    const dateForMonth = parseISO(`${selectedMonth}-01`);
    const daysInMonth = getDaysInMonth(dateForMonth);
    const allDays = eachDayOfInterval({
      start: startOfMonth(dateForMonth),
      end: endOfMonth(dateForMonth),
    });

    // Business days (M-F)
    const today = new Date();
    const todayStr = format(today, "yyyy-MM-dd");

    const businessDays = allDays.filter((date) => {
      const dateStr = format(date, "yyyy-MM-dd");
      return !isWeekend(date) && dateStr <= todayStr;
    }).length;

    // Total hours in month
    const totalHours = daysInMonth * 24;
    const adminHours = businessDays * 9; // 8 to 17 = 9 hours

    let linea1Hours = 0;
    let linea2Hours = 0;
    let linea3Hours = 0;
    let calentamientoCount = 0;
    let totalPacks = 0;

    const botellasCount = {
      3000: 0,
      2250: 0,
      2000: 0,
      1500: 0,
      500: 0,
    };

    const paquetesCount = {
      3000: 0,
      2250: 0,
      2000: 0,
      1500: 0,
      500: 0,
    };

    // To count unique date+linea for calentamiento
    const activeLineDays = new Set<string>();

    reports.forEach((r) => {
      // Hours on based on report's true duration (tiempoTurno is in minutes)
      let hours = 0;
      let minutes = r.tiempoTurno || 0;
      if (!minutes && r.entraTurno && r.saleTurno) {
        const parseTime = (t: string) => {
          const [h, m] = t.split(":").map(Number);
          return h * 60 + (m || 0);
        };
        let s = parseTime(r.entraTurno);
        let e = parseTime(r.saleTurno);
        if (e <= s && s > 0) e += 24 * 60;
        minutes = e - s;
      }

      if (minutes > 0) {
        hours = minutes / 60;
      } else if (r.turno && r.fecha) {
        // Fallback to full shift hours if start/end times are missing
        hours = getShiftHours(r.turno, r.fecha).length;
      }

      if (r.linea === "1" || r.linea === "Línea 1" || r.linea === "Linea 1")
        linea1Hours += hours;
      else if (
        r.linea === "2" ||
        r.linea === "Línea 2" ||
        r.linea === "Linea 2"
      )
        linea2Hours += hours;
      else if (
        r.linea === "3" ||
        r.linea === "Línea 3" ||
        r.linea === "Linea 3"
      )
        linea3Hours += hours;

      // Calentamiento
      activeLineDays.add(`${r.fecha}-${r.linea}`);

      // Botellas y Paquetes
      const t = r.tamano || 0;
      if (botellasCount.hasOwnProperty(t)) {
        const quantity = r.botellas || (r.paquetes || 0) * (t === 3000 ? 4 : 6); // Rough fallback if botellas is not there, typically we have botellas
        (botellasCount as any)[t] += quantity;
        (paquetesCount as any)[t] += (r.paquetes || 0);
      }
      totalPacks += (r.paquetes || 0);
    });

    calentamientoCount = activeLineDays.size;

    const kwhIntercept = factors.intercept * totalHours;
    const kwhAdmin = factors.admin * adminHours;
    const kwhLinea1 = factors.linea1 * linea1Hours;
    const kwhLinea2 = factors.linea2 * linea2Hours;
    const kwhLinea3 = factors.linea3 * linea3Hours;
    const kwhCalentamiento = factors.calentamiento * calentamientoCount;

    let kwhBotellas = 0;
    Object.keys(botellasCount).forEach((t) => {
      const size = Number(t);
      kwhBotellas +=
        botellasCount[size as keyof typeof botellasCount] *
        (factors.botellas[size] || 0);
    });

    const totalKwh =
      kwhIntercept +
      kwhAdmin +
      kwhLinea1 +
      kwhLinea2 +
      kwhLinea3 +
      kwhCalentamiento +
      kwhBotellas;

    return {
      kwhIntercept,
      kwhAdmin,
      kwhLinea1,
      kwhLinea2,
      kwhLinea3,
      kwhCalentamiento,
      kwhBotellas,
      totalKwh,
      stats: {
        totalHours,
        adminHours,
        linea1Hours,
        linea2Hours,
        linea3Hours,
        calentamientoCount,
        botellasCount,
        paquetesCount,
        totalPacks,
      },
    };
  };

  const getPredictionForMonth = (monthStr: string) => {
    try {
      const dateForMonth = parseISO(`${monthStr}-01`);
      const daysInMonth = getDaysInMonth(dateForMonth);
      const allDays = eachDayOfInterval({
        start: startOfMonth(dateForMonth),
        end: endOfMonth(dateForMonth),
      });

      const today = new Date();
      const todayStr = format(today, "yyyy-MM-dd");

      const businessDays = allDays.filter((date) => {
        const dateStr = format(date, "yyyy-MM-dd");
        return !isWeekend(date) && dateStr <= todayStr;
      }).length;

      const totalHours = daysInMonth * 24;
      const adminHours = businessDays * 9;

      let linea1Hours = 0;
      let linea2Hours = 0;
      let linea3Hours = 0;
      let calentamientoCount = 0;

      const botellasCount = {
        3000: 0,
        2250: 0,
        2000: 0,
        1500: 0,
        500: 0,
      };

      const paquetesCount = {
        3000: 0,
        2250: 0,
        2000: 0,
        1500: 0,
        500: 0,
      };

      const activeLineDays = new Set<string>();
      const monthReports = allReports.filter((r) => getLogicalDate(r).startsWith(monthStr));

      monthReports.forEach((r) => {
        let hours = 0;
        let minutes = r.tiempoTurno || 0;
        if (!minutes && r.entraTurno && r.saleTurno) {
          const parseTime = (t: string) => {
            const [h, m] = t.split(":").map(Number);
            return h * 60 + (m || 0);
          };
          let s = parseTime(r.entraTurno);
          let e = parseTime(r.saleTurno);
          if (e <= s && s > 0) e += 24 * 60;
          minutes = e - s;
        }

        if (minutes > 0) {
          hours = minutes / 60;
        } else if (r.turno && r.fecha) {
          hours = getShiftHours(r.turno, r.fecha).length;
        }

        if (r.linea === "1" || r.linea === "Línea 1" || r.linea === "Linea 1")
          linea1Hours += hours;
        else if (r.linea === "2" || r.linea === "Línea 2" || r.linea === "Linea 2")
          linea2Hours += hours;
        else if (r.linea === "3" || r.linea === "Línea 3" || r.linea === "Linea 3")
          linea3Hours += hours;

        activeLineDays.add(`${r.fecha}-${r.linea}`);

        const t = r.tamano || 0;
        if (botellasCount.hasOwnProperty(t)) {
          const quantity = r.botellas || (r.paquetes || 0) * (t === 3000 ? 4 : 6);
          (botellasCount as any)[t] += quantity;
          (paquetesCount as any)[t] += (r.paquetes || 0);
        }
      });

      calentamientoCount = activeLineDays.size;

      const kwhIntercept = factors.intercept * totalHours;
      const kwhAdmin = factors.admin * adminHours;
      const kwhLinea1 = factors.linea1 * linea1Hours;
      const kwhLinea2 = factors.linea2 * linea2Hours;
      const kwhLinea3 = factors.linea3 * linea3Hours;
      const kwhCalentamiento = factors.calentamiento * calentamientoCount;

      let kwhBotellas = 0;
      Object.keys(botellasCount).forEach((t) => {
        const size = Number(t);
        kwhBotellas +=
          botellasCount[size as keyof typeof botellasCount] *
          (factors.botellas[size] || 0);
      });

      const totalKwh =
        kwhIntercept +
        kwhAdmin +
        kwhLinea1 +
        kwhLinea2 +
        kwhLinea3 +
        kwhCalentamiento +
        kwhBotellas;

      return totalKwh;
    } catch (e) {
      console.error("Error predicting for month", monthStr, e);
      return 0;
    }
  };

  const prediction = calculatePrediction();
  const currentReal = realEnergy[selectedMonth] || { kwh: 0, amount: 0 };

  const activeKwh = isEditingReal ? editReal.kwh : currentReal.kwh;

  const differences = {
    kwh: activeKwh ? activeKwh - prediction.totalKwh : 0,
    pct: activeKwh && prediction.totalKwh
      ? ((activeKwh - prediction.totalKwh) / prediction.totalKwh) * 100
      : 0,
  };

  const kwhPackData = React.useMemo(() => {
    const data: {
      month: string;
      displayMonth: string;
      kwh: number;
      packs: number;
      predictedKwh: number;
      ratio: number;
    }[] = [];

    const monthsSet = new Set<string>();

    Object.keys(realEnergy).forEach((m) => {
      if (m && /^\d{4}-\d{2}$/.test(m)) {
        monthsSet.add(m);
      }
    });

    allReports.forEach((r) => {
      if (r.fecha && r.fecha.length >= 7) {
        const m = r.fecha.substring(0, 7);
        monthsSet.add(m);
      }
    });

    const sortedMonths = Array.from(monthsSet).sort();

    for (const m of sortedMonths) {
      const energyData = realEnergy[m];
      const kwhVal = energyData ? energyData.kwh || 0 : 0;

      const monthReports = allReports.filter((r) => getLogicalDate(r).startsWith(m));
      let totalPacks = 0;
      monthReports.forEach((r) => {
        totalPacks += r.paquetes || 0;
      });

      const predictedKwhValue = Math.round(getPredictionForMonth(m));

      if (kwhVal > 0 || totalPacks > 0 || predictedKwhValue > 0) {
        let displayMonthStr = m;
        try {
          displayMonthStr = format(parseISO(`${m}-01`), "MMM yyyy", {
            locale: es,
          }).toUpperCase();
        } catch (e) {
          console.error("Error formatting date:", m, e);
        }

        data.push({
          month: m,
          displayMonth: displayMonthStr,
          kwh: kwhVal,
          packs: totalPacks,
          predictedKwh: predictedKwhValue,
          ratio: totalPacks > 0 ? Number((kwhVal / totalPacks).toFixed(2)) : 0,
        });
      }
    }
    return data;
  }, [realEnergy, allReports, factors]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            <Zap className="w-8 h-8 text-yellow-500" />
            Consumo de Energía
          </h2>
          <p className="text-sm font-medium text-gray-500">
            Predicción vs Consumo Real Facturado
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 bg-white shadow-sm focus:ring-2 focus:ring-yellow-500"
            />
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 bg-white border border-gray-200 rounded-xl text-gray-600 hover:text-yellow-600 hover:bg-yellow-50 transition-all font-bold"
            title="Configurar Factores"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab("predictivo")}
          className={`py-3 px-6 text-sm font-bold border-b-2 transition-colors ${
            activeTab === "predictivo"
              ? "border-yellow-500 text-yellow-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Análisis Predictivo
        </button>
        <button
          onClick={() => setActiveTab("kwh_pack")}
          className={`py-3 px-6 text-sm font-bold border-b-2 transition-colors ${
            activeTab === "kwh_pack"
              ? "border-yellow-500 text-yellow-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          KWh por Pack
        </button>
      </div>

      {activeTab === "kwh_pack" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-black text-gray-900 mb-6 flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-yellow-500" />
              Evolución KWh vs Packs Producidos
            </h3>

            {/* Selector de visibilidad de variables */}
            <div className="flex flex-wrap items-center gap-3 mb-6 bg-gray-50/50 p-4 rounded-xl border border-gray-100">
              <span className="text-xs font-black text-gray-500 uppercase tracking-widest mr-2">
                Mostrar / Esconder:
              </span>
              <button
                type="button"
                onClick={() => setVisibleLines(prev => ({ ...prev, kwh: !prev.kwh }))}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  visibleLines.kwh
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm"
                    : "bg-white border-gray-200 text-gray-400 hover:text-gray-600"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${visibleLines.kwh ? "bg-indigo-600" : "bg-gray-300"}`} />
                Consumo Real
              </button>
              <button
                type="button"
                onClick={() => setVisibleLines(prev => ({ ...prev, predictedKwh: !prev.predictedKwh }))}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  visibleLines.predictedKwh
                    ? "bg-yellow-50 border-yellow-200 text-yellow-700 shadow-sm"
                    : "bg-white border-gray-200 text-gray-400 hover:text-gray-600 cursor-pointer"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${visibleLines.predictedKwh ? "bg-yellow-500" : "bg-gray-300"}`} />
                Consumo Estimado (Modelo)
              </button>
              <button
                type="button"
                onClick={() => setVisibleLines(prev => ({ ...prev, packs: !prev.packs }))}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  visibleLines.packs
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm"
                    : "bg-white border-gray-200 text-gray-400 hover:text-gray-600"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${visibleLines.packs ? "bg-emerald-500" : "bg-gray-300"}`} />
                Packs Producidos
              </button>
              <button
                type="button"
                onClick={() => setVisibleLines(prev => ({ ...prev, ratio: !prev.ratio }))}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  visibleLines.ratio
                    ? "bg-orange-50 border-orange-200 text-orange-700 shadow-sm"
                    : "bg-white border-gray-200 text-gray-400 hover:text-gray-600"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${visibleLines.ratio ? "bg-orange-500" : "bg-gray-300"}`} />
                Ratio (KWh/Pack)
              </button>
            </div>

            <div className="h-[400px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={kwhPackData}
                  margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="displayMonth" />
                  <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                  <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="kwh"
                    name="Consumo Real (KWh)"
                    stroke="#8884d8"
                    strokeWidth={3}
                    activeDot={{ r: 8 }}
                    hide={!visibleLines.kwh}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="predictedKwh"
                    name="Consumo Estimado (KWh)"
                    stroke="#eab308"
                    strokeWidth={3}
                    activeDot={{ r: 8 }}
                    hide={!visibleLines.predictedKwh}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="packs"
                    name="Packs Producidos"
                    stroke="#82ca9d"
                    strokeWidth={3}
                    activeDot={{ r: 8 }}
                    hide={!visibleLines.packs}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="ratio"
                    name="Ratio (KWh/Pack)"
                    stroke="#ff7300"
                    strokeWidth={3}
                    hide={!visibleLines.ratio}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-black text-gray-900">
                Tabla de Datos
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50">
                    <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                      Mes
                    </th>
                    <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-100 text-right">
                      Consumo Real (KWh)
                    </th>
                    <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-100 text-right">
                      Consumo Estimado (KWh)
                    </th>
                    <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-100 text-right">
                      Packs Producidos
                    </th>
                    <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-100 text-right">
                      KWh / Pack
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {kwhPackData.map((row, i) => (
                    <tr
                      key={i}
                      className="hover:bg-gray-50/50 transition-colors"
                    >
                      <td className="py-3 px-4 text-sm font-bold text-gray-900">
                        {row.displayMonth}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium text-gray-600 text-right">
                        {row.kwh > 0 ? row.kwh.toLocaleString("es-AR") : "-"}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium text-yellow-600 text-right font-semibold">
                        {row.predictedKwh > 0 ? row.predictedKwh.toLocaleString("es-AR") : "-"}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium text-gray-600 text-right">
                        {row.packs.toLocaleString("es-AR")}
                      </td>
                      <td className="py-3 px-4 text-sm font-black text-indigo-600 text-right">
                        {row.ratio.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {kwhPackData.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-8 text-center text-gray-500 text-sm"
                      >
                        No hay datos suficientes para mostrar el análisis.
                        Cargue facturación real y partes de producción.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: activeTab === "predictivo" ? "block" : "none" }}>
        {showSettings ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-black text-gray-900">
                Variables del Modelo (Factores)
              </h3>
              <button
                onClick={handleSaveFactors}
                disabled={savingSettings}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-xl text-sm font-bold hover:bg-yellow-600 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                Guardar Factores
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Intercepción (Base Hora)
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  value={editFactors.intercept}
                  onChange={(e) =>
                    setEditFactors({
                      ...editFactors,
                      intercept: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Administración (Hora)
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  value={editFactors.admin}
                  onChange={(e) =>
                    setEditFactors({
                      ...editFactors,
                      admin: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Calentamiento (1h antes)
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  value={editFactors.calentamiento}
                  onChange={(e) =>
                    setEditFactors({
                      ...editFactors,
                      calentamiento: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Línea 1 ON (Hora)
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  value={editFactors.linea1}
                  onChange={(e) =>
                    setEditFactors({
                      ...editFactors,
                      linea1: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Línea 2 ON (Hora)
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  value={editFactors.linea2}
                  onChange={(e) =>
                    setEditFactors({
                      ...editFactors,
                      linea2: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Línea 3 ON (Hora)
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  value={editFactors.linea3}
                  onChange={(e) =>
                    setEditFactors({
                      ...editFactors,
                      linea3: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div className="col-span-full mt-4">
                <h4 className="text-sm font-bold text-gray-900 mb-4 border-b pb-2">
                  Botellas Producidas (kWh por botella)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {[3000, 2250, 2000, 1500, 500].map((size) => (
                    <div key={size}>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                        {size} ml
                      </label>
                      <input
                        type="number"
                        step="0.0000001"
                        value={editFactors.botellas[size]}
                        onChange={(e) =>
                          setEditFactors({
                            ...editFactors,
                            botellas: {
                              ...editFactors.botellas,
                              [size]: Number(e.target.value),
                            },
                          })
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Prediction Summary */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                        <Calculator className="w-5 h-5 text-blue-600" />
                      </div>
                      <h3 className="text-lg font-black text-gray-900">
                        Predicción del Modelo
                      </h3>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <span className="block text-xs font-black text-gray-500 uppercase">
                          Total kWh
                        </span>
                        <span className="text-xl font-black text-blue-600">
                          {prediction.totalKwh.toLocaleString("es-AR", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <span className="block text-xs font-black text-gray-500 uppercase">
                          Base Planta
                        </span>
                        <span className="text-xl font-bold text-gray-700">
                          {prediction.kwhIntercept.toLocaleString("es-AR", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <span className="block text-xs font-black text-gray-500 uppercase">
                          Líneas Activas
                        </span>
                        <span className="text-xl font-bold text-gray-700">
                          {(
                            prediction.kwhLinea1 +
                            prediction.kwhLinea2 +
                            prediction.kwhLinea3
                          ).toLocaleString("es-AR", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <span className="block text-xs font-black text-gray-500 uppercase">
                          Volumen
                        </span>
                        <span className="text-xl font-bold text-gray-700">
                          {prediction.kwhBotellas.toLocaleString("es-AR", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <span className="block text-xs font-black text-gray-500 uppercase">
                          KWH / Pack
                        </span>
                        <span className="text-xl font-bold text-gray-700">
                          {prediction.stats.totalPacks > 0
                            ? (prediction.totalKwh / prediction.stats.totalPacks).toFixed(2)
                            : "-"}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest pl-2">
                        Desglose de Factores
                      </h4>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Operational Factors */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg text-sm">
                            <span className="font-bold text-gray-600">
                              Base mensual (24/7)
                            </span>
                            <span className="font-medium text-gray-900">
                              {prediction.stats.totalHours} hs
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg text-sm">
                            <span className="font-bold text-gray-600">
                              Admin (Lunes-Viernes)
                            </span>
                            <span className="font-medium text-gray-900">
                              {prediction.stats.adminHours} hs &rarr;{" "}
                              {prediction.kwhAdmin.toLocaleString("es-AR", {
                                maximumFractionDigits: 0,
                              })}{" "}
                              kWh
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg text-sm">
                            <span className="font-bold text-gray-600">
                              Línea 1 ON
                            </span>
                            <span className="font-medium text-gray-900">
                              {prediction.stats.linea1Hours.toFixed(1)} hs
                              &rarr;{" "}
                              {prediction.kwhLinea1.toLocaleString("es-AR", {
                                maximumFractionDigits: 0,
                              })}{" "}
                              kWh
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg text-sm">
                            <span className="font-bold text-gray-600">
                              Línea 2 ON
                            </span>
                            <span className="font-medium text-gray-900">
                              {prediction.stats.linea2Hours.toFixed(1)} hs
                              &rarr;{" "}
                              {prediction.kwhLinea2.toLocaleString("es-AR", {
                                maximumFractionDigits: 0,
                              })}{" "}
                              kWh
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg text-sm">
                            <span className="font-bold text-gray-600">
                              Línea 3 ON
                            </span>
                            <span className="font-medium text-gray-900">
                              {prediction.stats.linea3Hours.toFixed(1)} hs
                              &rarr;{" "}
                              {prediction.kwhLinea3.toLocaleString("es-AR", {
                                maximumFractionDigits: 0,
                              })}{" "}
                              kWh
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg text-sm">
                            <span className="font-bold text-gray-600">
                              Calentamiento (Turnos)
                            </span>
                            <span className="font-medium text-gray-900">
                              {prediction.stats.calentamientoCount} ev &rarr;{" "}
                              {prediction.kwhCalentamiento.toLocaleString(
                                "es-AR",
                                { maximumFractionDigits: 0 },
                              )}{" "}
                              kWh
                            </span>
                          </div>
                        </div>

                        {/* Volumes */}
                        <div className="space-y-1">
                          {[3000, 2250, 2000, 1500, 500].map((size) => {
                            const count =
                              prediction.stats.botellasCount[
                                size as keyof typeof prediction.stats.botellasCount
                              ];
                            const packsForSize = prediction.stats.paquetesCount[
                              size as keyof typeof prediction.stats.paquetesCount
                            ];
                            const kwh = count * factors.botellas[size];
                            return (
                              <div
                                key={size}
                                className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg text-sm"
                              >
                                <span className="font-bold text-gray-600">
                                  Botellas {size}ml
                                </span>
                                <span className="font-medium text-gray-900">
                                  {count.toLocaleString("es-AR")} u{" "}
                                  <span className="text-gray-400">
                                    ({packsForSize.toLocaleString("es-AR", { maximumFractionDigits: 0 })} packs)
                                  </span>{" "}
                                  &rarr;{" "}
                                  {kwh.toLocaleString("es-AR", {
                                    maximumFractionDigits: 0,
                                  })}{" "}
                                  kWh
                                </span>
                              </div>
                            );
                          })}
                          
                          <div className="flex justify-between items-center p-2 mt-4 border-t border-gray-200 text-sm">
                            <span className="font-bold text-gray-800">
                              Total Packs:
                            </span>
                            <span className="font-bold text-gray-900">
                              {prediction.stats.totalPacks.toLocaleString("es-AR")} packs
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Real Data & Comparison */}
                <div className="space-y-6">
                  <div className="bg-gray-900 text-white p-6 rounded-2xl shadow-sm relative overflow-hidden">
                    {/* Background Accents */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-400 opacity-10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

                    <div className="flex justify-between items-start mb-6">
                      <div className="flex items-center gap-3 relative z-10">
                        <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                          <Activity className="w-5 h-5 text-yellow-500" />
                        </div>
                        <h3 className="text-lg font-black tracking-tight">
                          Consumo Real
                        </h3>
                      </div>
                      {!isEditingReal ? (
                        <button
                          onClick={() => {
                            setEditReal(realEnergy[selectedMonth] || { kwh: 0, amount: 0 });
                            setIsEditingReal(true);
                          }}
                          className="relative z-20 p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          Editar Factura
                        </button>
                      ) : (
                        <button
                          onClick={handleSaveRealEnergy}
                          className="relative z-20 p-2 bg-yellow-500 hover:bg-yellow-600 text-black transition-colors rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" />
                          Guardar
                        </button>
                      )}
                    </div>

                    {isEditingReal ? (
                      <div className="space-y-4 relative z-10">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                              kWh Facturados
                            </label>
                            <input
                              type="number"
                              value={editReal.kwh || ""}
                              onChange={(e) =>
                                setEditReal({
                                  ...editReal,
                                  kwh: Number(e.target.value),
                                })
                              }
                              className="w-full bg-gray-800 text-white font-black text-xl border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-yellow-500"
                            />
                          </div>
                          {editReal.kwh > 0 && prediction.stats.totalPacks > 0 && (
                            <div>
                              <span className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5 pt-1">
                                KWH / Pack (Real)
                              </span>
                              <div className="text-2xl font-black text-blue-400 mt-2">
                                {(editReal.kwh / prediction.stats.totalPacks).toFixed(2)}
                              </div>
                            </div>
                          )}
                        </div>

                        {editReal.kwh > 0 && (
                          <div className="pt-4 border-t border-gray-800">
                            <span className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                              Desviación Estimada (Tiempo Real)
                            </span>
                            <div
                              className={`p-4 rounded-xl border ${Math.abs(differences.pct) <= 5 ? "bg-green-900/30 border-green-800/50 text-green-400" : "bg-red-900/30 border-red-800/50 text-red-400"}`}
                            >
                              <div className="flex justify-between items-center">
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-black uppercase mb-1">
                                    Diferencia Neta
                                  </span>
                                  <span className="text-lg font-black">
                                    {differences.kwh > 0 ? "+" : ""}
                                    {differences.kwh.toLocaleString("es-AR", {
                                      maximumFractionDigits: 0,
                                    })}{" "}
                                    kWh
                                  </span>
                                </div>
                                <div className="flex flex-col items-end">
                                  <span className="text-[10px] font-black uppercase mb-1">
                                    Margen Error
                                  </span>
                                  <span className="text-xl font-black">
                                    {differences.pct > 0 ? "+" : ""}
                                    {differences.pct.toFixed(2)}%
                                  </span>
                                </div>
                              </div>
                              <p className="text-[10px] opacity-70 mt-3 font-medium text-center">
                                {Math.abs(differences.pct) <= 5
                                  ? "El modelo es altamente preciso con este valor."
                                  : "Este valor presenta una desviación por encima de lo esperado."}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-6 relative z-10">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1">
                              kWh Facturados
                            </span>
                            <div className="text-4xl font-black text-white">
                              {currentReal.kwh > 0
                                ? currentReal.kwh.toLocaleString("es-AR")
                                : "-"}
                            </div>
                          </div>
                          {currentReal.kwh > 0 && prediction.stats.totalPacks > 0 && (
                            <div>
                              <span className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1">
                                KWH / Pack (Real)
                              </span>
                              <div className="text-4xl font-black text-blue-400">
                                {(currentReal.kwh / prediction.stats.totalPacks).toFixed(2)}
                              </div>
                            </div>
                          )}
                        </div>

                        {currentReal.kwh > 0 && (
                          <div className="pt-4 border-t border-gray-800">
                            <span className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                              Desviación del Modelo
                            </span>
                            <div
                              className={`p-4 rounded-xl border ${Math.abs(differences.pct) <= 5 ? "bg-green-900/30 border-green-800/50 text-green-400" : "bg-red-900/30 border-red-800/50 text-red-400"}`}
                            >
                              <div className="flex justify-between items-center">
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-black uppercase mb-1">
                                    Diferencia Neta
                                  </span>
                                  <span className="text-lg font-black">
                                    {differences.kwh > 0 ? "+" : ""}
                                    {differences.kwh.toLocaleString("es-AR", {
                                      maximumFractionDigits: 0,
                                    })}{" "}
                                    kWh
                                  </span>
                                </div>
                                <div className="flex flex-col items-end">
                                  <span className="text-[10px] font-black uppercase mb-1">
                                    Margen Error
                                  </span>
                                  <span className="text-xl font-black">
                                    {differences.pct > 0 ? "+" : ""}
                                    {differences.pct.toFixed(2)}%
                                  </span>
                                </div>
                              </div>
                              <p className="text-[10px] opacity-70 mt-3 font-medium text-center">
                                {Math.abs(differences.pct) <= 5
                                  ? "El modelo es altamente preciso este mes."
                                  : "El modelo presenta una desviación por encima de lo esperado."}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
