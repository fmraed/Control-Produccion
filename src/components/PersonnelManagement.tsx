import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, setDoc, addDoc, deleteDoc, where, getDocs, writeBatch } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { ProductionReport, ElaboracionReport, UserProfile, Employee, AttendanceRecord, ShiftAssignment } from '../types';
import { Users, UserPlus, Calendar, CheckCircle2, XCircle, Clock, Search, Filter, Save, Trash2, ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon, AlertCircle, Edit2, X, BarChart3, FileText, DollarSign, History } from 'lucide-react';
import { format, startOfWeek, addDays, parseISO, isSameDay, startOfDay, endOfDay, getDay, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAppConfig } from '../hooks/useAppConfig';
import { motion, AnimatePresence } from 'motion/react';
import { getDefaultInputDate } from '../utils';

import { RANGOS_MIXTO, RANGOS_PRODUCCION, RANGOS_MANTENIMIENTO } from '../constants';

const SECTORES = [
  'Producción',
  'Elaboración',
  'Mantenimiento',
  'Soplado'
] as const;

const getRangosParaSector = (sector?: string) => {
  if (sector === 'Mantenimiento') return RANGOS_MANTENIMIENTO;
  if (sector === 'Elaboración' || sector === 'Soplado') return RANGOS_MIXTO;
  return RANGOS_PRODUCCION; // Default to Producción
};

type Tab = 'list' | 'planning' | 'attendance' | 'analysis' | 'benefits' | 'nomina';

import { NominaTab } from './NominaTab';
import { useRolePermissions } from '../hooks/useRolePermissions';

export function PersonnelManagement({ userProfile }: { userProfile: UserProfile | null }) {
  const { config } = useAppConfig();
  const { permissions } = useRolePermissions(userProfile?.role);
  const [activeTab, setActiveTab] = useState<Tab>('attendance');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState<string>(userProfile?.sector || 'Todos');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteAttendanceId, setConfirmDeleteAttendanceId] = useState<string | null>(null);
  const [showVacationRangeModal, setShowVacationRangeModal] = useState<Employee | null>(null);
  const [showLeaveRangeModal, setShowLeaveRangeModal] = useState<Employee | null>(null);
  const [showEmployeeStats, setShowEmployeeStats] = useState<Employee | null>(null);
  const [selectedStatsMonth, setSelectedStatsMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [leaveReason, setLeaveReason] = useState('');
  const [rangeStart, setRangeStart] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rangeEnd, setRangeEnd] = useState(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
  const [isProcessingRange, setIsProcessingRange] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [operationMessage, setOperationMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [detectedRange, setDetectedRange] = useState<{ start: string; end: string } | null>(null);
  const [appConfig, setAppConfig] = useState<any>(null);
  const [editingVacation, setEditingVacation] = useState<{ id?: string; employee: Employee; start: string; end: string } | null>(null);
  
  // Permissions
  const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'jefe_produccion';

  const isDateRestricted = (dateStr: string) => {
    if (isAdmin) return false;
    const currentWeekStart = startOfDay(startOfWeek(new Date(), { weekStartsOn: 1 }));
    const targetDate = startOfDay(parseISO(dateStr));
    return targetDate < currentWeekStart;
  };

  // Form states
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({ 
    name: '', 
    legajo: '', 
    position: '', 
    active: true,
    type: 'Efectivo',
    sector: userProfile?.sector || 'Producción',
    rango: getRangosParaSector(userProfile?.sector || 'Producción')[0],
    convenio: '',
    hireDate: format(new Date(), 'yyyy-MM-dd'),
    vacationAdjustment: 0,
    compensationAdjustment: 0
  });

  const calculateTenure = (emp: Employee) => {
    if (!emp.hireDate) return '-';
    
    const periods: { hireDate: string; terminationDate?: string }[] = [];
    if (emp.history && emp.history.length > 0) {
      emp.history.forEach(p => {
        periods.push({
          hireDate: p.hireDate,
          terminationDate: p.terminationDate || undefined
        });
      });
    }
    if (emp.hireDate) {
      const exists = periods.some(p => p.hireDate === emp.hireDate);
      if (!exists) {
        periods.push({
          hireDate: emp.hireDate,
          terminationDate: emp.active ? undefined : (emp.terminationDate || undefined)
        });
      }
    }

    let totalDays = 0;
    periods.forEach(p => {
      const start = parseISO(p.hireDate);
      const end = p.terminationDate && p.terminationDate !== "" ? parseISO(p.terminationDate) : new Date();
      if (start <= end) {
        const diffMs = end.getTime() - start.getTime();
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        totalDays += days;
      }
    });

    if (totalDays < 30) return `${totalDays} días`;
    const months = Math.floor(totalDays / 30);
    if (months < 12) return `${months} meses`;
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return `${years}a ${remainingMonths}m`;
  };

  const calculateEntitledVacations = (hireDate?: string) => {
    if (!hireDate) return 0;
    const start = parseISO(hireDate);
    const now = new Date();
    
    // Antigüedad al 31 de diciembre del año en curso
    const endOfYear = new Date(now.getFullYear(), 11, 31);
    const diffMs = endOfYear.getTime() - start.getTime();
    const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
    
    if (diffYears < 0.5) return 0; // Simplificado: la ley dice 1 día por cada 20 trabajados
    if (diffYears < 5) return 14;
    if (diffYears < 10) return 21;
    if (diffYears < 20) return 28;
    return 35;
  };

  const getBenefitsSummary = (employee: Employee) => {
    const employeeAttendance = attendance.filter(a => a.employeeId === employee.id);
    
    // Solo las horas extras de fin de semana (Sábado = 6, Domingo = 0) generan compensados
    const weekendOvertime = employeeAttendance.reduce((sum, a) => {
      const dayOfWeek = getDay(parseISO(a.date));
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      return sum + (isWeekend ? (a.overtimeHours || 0) : 0);
    }, 0);

    const accruedCompensated = Math.floor(weekendOvertime / 8) + (employee.compensationAdjustment || 0);
    const usedCompensated = employeeAttendance.filter(a => a.status === 'Compensado').length;
    
    const entitledVacations = calculateEntitledVacations(employee.hireDate) + (employee.vacationAdjustment || 0);
    const usedVacations = employeeAttendance.filter(a => a.status === 'Vacaciones').length;
    
    return {
      vacations: {
        total: entitledVacations,
        used: usedVacations,
        remaining: entitledVacations - usedVacations,
        adjustment: employee.vacationAdjustment || 0
      },
      compensated: {
        total: accruedCompensated,
        used: usedCompensated,
        remaining: accruedCompensated - usedCompensated,
        overtimeBalance: weekendOvertime % 8,
        adjustment: employee.compensationAdjustment || 0
      }
    };
  };

  const getEmployeeStats = (empId: string) => {
    // Filter records by employee AND by selected month
    const records = attendance.filter(a => {
      if (a.employeeId !== empId) return false;
      const recordMonth = a.date.substring(0, 7); // yyyy-MM
      return recordMonth === selectedStatsMonth;
    });

    return {
      overtime: records.reduce((sum, r) => sum + (r.overtimeHours || 0), 0),
      lateness: records.filter(r => r.status === 'Tarde').length,
      absences: records.filter(r => r.status === 'Ausente').length,
      leaves: records.filter(r => r.status === 'Licencia').length,
      vacations: records.filter(r => r.status === 'Vacaciones').length,
      totalRecords: records.length
    };
  };

  // Planning states
  const [selectedWeek, setSelectedWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [planningShiftTab, setPlanningShiftTab] = useState<'Todos' | 'Mañana' | 'Tarde' | 'Noche' | 'Sin Asignar'>('Todos');
  const [showAssignedOthers, setShowAssignedOthers] = useState(false);

  // Attendance states
  const [attendanceDate, setAttendanceDate] = useState(getDefaultInputDate());
  const [attendanceShift, setAttendanceShift] = useState('Mañana');

  const isAttendanceLocked = useMemo(() => isDateRestricted(attendanceDate), [attendanceDate, isAdmin]);

  useEffect(() => {
    const employeesQuery = query(collection(db, 'employees'), orderBy('name', 'asc'));
    const assignmentsQuery = query(collection(db, 'shift_assignments'));
    const attendanceQuery = query(collection(db, 'attendance_records'), orderBy('date', 'desc'));

    const unsubEmployees = onSnapshot(employeesQuery, (snap) => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
      setLoading(false);
    });

    const unsubAssignments = onSnapshot(assignmentsQuery, (snap) => {
      setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftAssignment)));
    });

    const unsubAttendance = onSnapshot(attendanceQuery, (snap) => {
      setAttendance(snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord)));
    });

    const unsubConfig = onSnapshot(doc(db, 'config', 'production'), (snap) => {
      if (snap.exists()) setAppConfig(snap.data());
    });

    return () => {
      unsubEmployees();
      unsubAssignments();
      unsubAttendance();
      unsubConfig();
    };
  }, []);

  const filteredEmployees = employees.filter(e => {
    const matchesSearch = e.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         e.legajo.includes(searchTerm);
    
    // Sector filter
    const effectiveSector = isAdmin ? selectedSector : userProfile?.sector;
    const empSector = e.sector || 'Producción';
    
    if (effectiveSector && effectiveSector !== 'Todos' && empSector !== effectiveSector) {
      return false;
    }
    
    return matchesSearch;
  });

  const benefitsAggregate = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    let totalVacDays = 0;
    let empVacOwedCount = 0;
    let totalCompDays = 0;
    let empCompOwedCount = 0;
    const activeLicenses: { name: string; days: number; reason?: string }[] = [];

    employees.filter(e => e.active && e.type === 'Efectivo').forEach(emp => {
      const summary = getBenefitsSummary(emp);
      
      if (summary.vacations.remaining > 0) {
        totalVacDays += summary.vacations.remaining;
        empVacOwedCount++;
      }
      
      if (summary.compensated.remaining > 0) {
        totalCompDays += summary.compensated.remaining;
        empCompOwedCount++;
      }

      // Check for active license today
      const todayRecord = attendance.find(a => a.employeeId === emp.id && a.date === today && a.status === 'Licencia');
      if (todayRecord) {
        // Total license days recorded for this month to give context
        const monthStr = today.substring(0, 7);
        const monthLicenseDays = attendance.filter(a => a.employeeId === emp.id && a.status === 'Licencia' && a.date.startsWith(monthStr)).length;
        activeLicenses.push({
          name: emp.name,
          days: monthLicenseDays,
          reason: (todayRecord as any).comment || (todayRecord as any).reason
        });
      }
    });

    return {
      totalVacDays,
      empVacOwedCount,
      totalCompDays,
      empCompOwedCount,
      activeLicenses
    };
  }, [employees, attendance]);

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cleanEmployee = Object.fromEntries(
        Object.entries(newEmployee).filter(([_, v]) => v !== undefined)
      );

      if (editingEmployee?.id) {
        await setDoc(doc(db, 'employees', editingEmployee.id), {
          ...cleanEmployee,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } else {
        await addDoc(collection(db, 'employees'), {
          ...cleanEmployee,
          createdAt: new Date().toISOString()
        });
      }
      setShowEmployeeForm(false);
      setEditingEmployee(null);
      setNewEmployee({ 
        name: '', 
        legajo: '', 
        position: '', 
        active: true,
        type: 'Efectivo',
        sector: userProfile?.sector || 'Producción',
        rango: getRangosParaSector(userProfile?.sector || 'Producción')[0],
        convenio: '',
        hireDate: format(new Date(), 'yyyy-MM-dd'),
        vacationAdjustment: 0,
        compensationAdjustment: 0
      });
    } catch (error) {
      console.error("Error saving employee:", error);
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'employees', id));
      setConfirmDeleteId(null);
    } catch (error) {
      console.error("Error deleting employee:", error);
      alert("Error al eliminar empleado. Verifique sus permisos.");
    }
  };

  const [isCopying, setIsCopying] = useState(false);
  const [planningStatus, setPlanningStatus] = useState<string | null>(null);
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);

  const handleCopyPreviousWeek = async () => {
    if (isDateRestricted(format(selectedWeek, 'yyyy-MM-dd'))) {
      alert("No tiene permisos para modificar la planificación de semanas anteriores.");
      return;
    }
    // First click: show confirmation state
    if (!showCopyConfirm) {
      setShowCopyConfirm(true);
      return;
    }

    // Second click: execute
    console.log('Copying week. selectedWeek:', selectedWeek);
    setIsCopying(true);
    setPlanningStatus(null);
    setShowCopyConfirm(false);

    try {
      // 1. Precise date range for the previous week (Sun to Sat)
      // Since 'Noche' starts on Sunday before Monday, we need Sunday to Saturday
      const currentMon = startOfWeek(selectedWeek, { weekStartsOn: 1 });
      const prevStart = addDays(currentMon, -8); // Sunday week X-2
      const prevEnd = addDays(currentMon, -2);   // Saturday week X-1
      
      const startStr = format(prevStart, 'yyyy-MM-dd');
      const endStr = format(prevEnd, 'yyyy-MM-dd');

      console.log(`Copying assignments from range: ${startStr} to ${endStr}`);
      
      // 2. Filter previous week assignments from local state
      const prevAssignments = assignments.filter(a => a.date >= startStr && a.date <= endStr);

      if (prevAssignments.length === 0) {
        setPlanningStatus(`No hay datos previos (${startStr} al ${endStr})`);
        setTimeout(() => setPlanningStatus(null), 5000);
        setIsCopying(false);
        return;
      }

      // 3. Process with Batches
      const batch = writeBatch(db);
      let copiedCount = 0;
      let skippedCount = 0;
      
      prevAssignments.forEach(a => {
        const prevDate = parseISO(a.date);
        const newDate = addDays(prevDate, 7);
        const newDateStr = format(newDate, 'yyyy-MM-dd');
        
        // Rotation logic: M -> T, T -> N, N -> M
        let newShift = a.shift;
        if (a.shift === 'Mañana') newShift = 'Tarde';
        else if (a.shift === 'Tarde') newShift = 'Noche';
        else if (a.shift === 'Noche') newShift = 'Mañana';

        // Check if this assignment already exists in the TARGET week
        const isDuplicate = assignments.some(curr => 
          curr.employeeId === a.employeeId && 
          curr.date === newDateStr && 
          curr.shift === newShift
        );

        if (!isDuplicate) {
          const newRef = doc(collection(db, 'shift_assignments'));
          batch.set(newRef, {
            employeeId: a.employeeId,
            date: newDateStr,
            shift: newShift,
            line: a.line || '1',
            createdAt: new Date().toISOString(),
            authorId: auth.currentUser?.uid || 'system'
          });
          copiedCount++;
        } else {
          skippedCount++;
        }
      });

      if (copiedCount > 0) {
        await batch.commit();
        setPlanningStatus(`Éxito: Se copiaron ${copiedCount} turnos rotativos.`);
      } else {
        setPlanningStatus(`Los registros ya existen en esta semana.`);
      }
      
      setTimeout(() => setPlanningStatus(null), 5000);
    } catch (error) {
      console.error("Error copy week:", error);
      setPlanningStatus("Error al realizar la copia.");
      setTimeout(() => setPlanningStatus(null), 5000);
    } finally {
      setIsCopying(false);
    }
  };

  const handleAssignFullWeek = async (employeeId: string, shift: string) => {
    if (isDateRestricted(format(selectedWeek, 'yyyy-MM-dd'))) {
      alert("No tiene permisos para modificar la planificación de semanas anteriores.");
      return;
    }
    // Determine target indices in weekDays based on shift
    // weekDays: 0(Sun), 1(Mon), 2(Tue), 3(Wed), 4(Thu), 5(Fri), 6(Sat), 7(Sun)
    let targetIndices: number[] = [];
    if (shift === 'Mañana') {
      targetIndices = [1, 2, 3, 4, 5, 6]; // Lunes a Sábado
    } else if (shift === 'Tarde') {
      targetIndices = [1, 2, 3, 4, 5]; // Lunes a Viernes
    } else if (shift === 'Noche') {
      targetIndices = [0, 1, 2, 3, 4, 5]; // Domingo(ant) a Viernes
    }

    // Get all assignments for this employee, this shift, in the current week
    const currentWeekAssignments = assignments.filter(a => 
      a.employeeId === employeeId && 
      a.shift === shift && 
      targetIndices.some(idx => a.date === format(weekDays[idx], 'yyyy-MM-dd'))
    );

    const batch = writeBatch(db);
    
    // If all target days are assigned, we deselect them
    // Otherwise, we fill the missing days
    const isFull = currentWeekAssignments.length >= targetIndices.length;

    if (isFull) {
      currentWeekAssignments.forEach(a => {
        batch.delete(doc(db, 'shift_assignments', a.id!));
      });
    } else {
      // Fill missing days
      for (const idx of targetIndices) {
        const day = weekDays[idx];
        const dateStr = format(day, 'yyyy-MM-dd');
        
        const exists = assignments.some(a => 
          a.employeeId === employeeId && 
          a.date === dateStr && 
          a.shift === shift
        );

        if (!exists) {
          const newRef = doc(collection(db, 'shift_assignments'));
          batch.set(newRef, {
            employeeId,
            date: dateStr,
            shift,
            line: '1',
            createdAt: new Date().toISOString(),
            authorId: auth.currentUser?.uid
          });
        }
      }
    }

    try {
      await batch.commit();
    } catch (error) {
      console.error("Error managing full week assignment:", error);
    }
  };

  const handleToggleAssignment = async (employeeId: string, date: string, shift: string) => {
    if (isDateRestricted(date)) {
      alert("No tiene permisos para modificar la planificación de semanas anteriores.");
      return;
    }
    const existing = assignments.find(a => a.employeeId === employeeId && a.date === date && a.shift === shift);
    
    try {
      if (existing?.id) {
        await deleteDoc(doc(db, 'shift_assignments', existing.id));
      } else {
        await addDoc(collection(db, 'shift_assignments'), {
          employeeId,
          date,
          shift,
          line: '1', // Default line as it's still in schema but not used for planning logic
          createdAt: new Date().toISOString(),
          authorId: auth.currentUser?.uid
        });
      }
    } catch (error) {
      console.error("Error toggling assignment:", error);
    }
  };

  const handleDeleteAttendance = async (id: string) => {
    if (isAttendanceLocked) {
      alert("No tiene permisos para modificar la asistencia de semanas anteriores.");
      return;
    }
    try {
      await deleteDoc(doc(db, 'attendance_records', id));
      setConfirmDeleteAttendanceId(null);
    } catch (error) {
      console.error("Error deleting attendance:", error);
      alert("Error al eliminar el registro.");
    }
  };

  const handleSaveAttendance = async (employee: Employee, status: AttendanceRecord['status'], overtime: number = 0) => {
    if (isAttendanceLocked) {
      alert("No tiene permisos para modificar la asistencia de semanas anteriores.");
      return;
    }
    const existing = attendance.find(a => a.employeeId === employee.id && a.date === attendanceDate && a.shift === attendanceShift);
    
    try {
      // Toggle logic: If clicking the same status AND same overtime, delete the record (deactivate)
      // If overtime is different, we want to update, not toggle off.
      if (existing?.status === status && overtime === (existing.overtimeHours || 0)) {
        await deleteDoc(doc(db, 'attendance_records', existing.id!));
        return;
      }

      const data: Partial<AttendanceRecord> = {
        employeeId: employee.id!,
        employeeName: employee.name,
        employeeLegajo: employee.legajo,
        date: attendanceDate,
        shift: attendanceShift,
        line: '1',
        status,
        overtimeHours: overtime,
        updatedAt: new Date().toISOString(),
        authorId: auth.currentUser?.uid || 'system'
      };

      if (existing?.id) {
        await setDoc(doc(db, 'attendance_records', existing.id), data, { merge: true });
      } else {
        await addDoc(collection(db, 'attendance_records'), {
          ...data,
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error("Error saving attendance:", error);
    }
  };

  const handleDeleteVacationRange = async () => {
    if (!showVacationRangeModal) return;
    
    if (isDateRestricted(rangeStart)) {
      setOperationMessage({ type: 'error', text: "No tiene permisos para modificar registros de semanas anteriores." });
      return;
    }

    setIsProcessingRange(true);
    setOperationMessage(null);
    try {
      const q = query(
        collection(db, 'attendance_records'), 
        where('employeeId', '==', showVacationRangeModal.id),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd),
        where('status', '==', 'Vacaciones')
      );
      
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      
      let count = 0;
      snap.forEach(d => {
        batch.delete(d.ref);
        count++;
      });
      
      if (count > 0) {
        await batch.commit();
        setOperationMessage({ type: 'success', text: `Se eliminaron ${count} registros de vacaciones.` });
        setTimeout(() => setShowVacationRangeModal(null), 1500);
      } else {
        setOperationMessage({ type: 'error', text: "No se encontraron registros de vacaciones en el rango seleccionado." });
      }
    } catch (error) {
      console.error("Error deleting vacation range:", error);
      setOperationMessage({ type: 'error', text: "Error al eliminar el rango: " + error });
    } finally {
      setIsProcessingRange(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSaveVacationRange = async () => {
    if (!showVacationRangeModal) return;
    
    if (isDateRestricted(rangeStart)) {
      setOperationMessage({ type: 'error', text: "No tiene permisos para cargar registros en fechas anteriores a la semana actual." });
      return;
    }

    setIsProcessingRange(true);
    setOperationMessage(null);
    try {
      const start = parseISO(rangeStart);
      const end = parseISO(rangeEnd);
      
      if (start > end) {
        setOperationMessage({ type: 'error', text: "La fecha de inicio debe ser anterior a la de fin." });
        setIsProcessingRange(false);
        return;
      }

      const batch = writeBatch(db);

      // If we are editing (we have a detectedRange), we should clear the OLD range first
      // to avoid orphaned days if the range was shortened.
      if (detectedRange) {
        const qOld = query(
          collection(db, 'attendance_records'), 
          where('employeeId', '==', showVacationRangeModal.id),
          where('date', '>=', detectedRange.start),
          where('date', '<=', detectedRange.end),
          where('status', '==', 'Vacaciones')
        );
        const snapOld = await getDocs(qOld);
        snapOld.forEach(d => batch.delete(d.ref));
      }
      
      const interval = eachDayOfInterval({ start, end });
      const generalHolidays = appConfig?.shiftConfig?.holidays || [];
      
      interval.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        // We still check local attendance for shift if available, but for the new range
        const existing = attendance.find(a => a.employeeId === showVacationRangeModal.id && a.date === dateStr);
        
        const isGeneralHoliday = generalHolidays.includes(dateStr);
        if (existing?.status === 'Feriado' || isGeneralHoliday) return;

        const data: any = {
          employeeId: showVacationRangeModal.id!,
          employeeName: showVacationRangeModal.name,
          employeeLegajo: showVacationRangeModal.legajo,
          date: dateStr,
          shift: existing?.shift || 'Mañana',
          status: 'Vacaciones',
          overtimeHours: 0,
          updatedAt: new Date().toISOString()
        };

        const newRef = doc(collection(db, 'attendance_records'));
        batch.set(newRef, {
          ...data,
          authorId: auth.currentUser?.uid || 'system',
          createdAt: new Date().toISOString()
        });
      });
      
      await batch.commit();
      setOperationMessage({ type: 'success', text: "Rango de vacaciones guardado exitosamente." });
      setTimeout(() => setShowVacationRangeModal(null), 1500);
    } catch (error) {
      console.error("Error saving vacation range:", error);
      setOperationMessage({ type: 'error', text: "Error al guardar el rango: " + error });
    } finally {
      setIsProcessingRange(false);
    }
  };

  const handleSetGeneralHoliday = async () => {
    if (isAttendanceLocked) {
      alert("No tiene permisos para modificar la asistencia de semanas anteriores.");
      return;
    }
    const batch = writeBatch(db);
    try {
      // Get all employees that should be in this shift/date
      const plannedIds = assignments
        .filter(a => a.date === attendanceDate && a.shift === attendanceShift)
        .map(a => a.employeeId);
      
      const existingAttendance = attendance.filter(a => a.date === attendanceDate && a.shift === attendanceShift);
      const attendedIds = existingAttendance.map(a => a.employeeId);
      
      const allIds = Array.from(new Set([...plannedIds, ...attendedIds]));
      
      allIds.forEach(empId => {
        const emp = employees.find(e => e.id === empId);
        if (!emp) return;
        
        const existing = existingAttendance.find(a => a.employeeId === empId);
        const data: any = {
          employeeId: empId,
          employeeName: emp.name,
          employeeLegajo: emp.legajo,
          date: attendanceDate,
          shift: attendanceShift,
          line: '1',
          status: 'Feriado',
          overtimeHours: 0,
          updatedAt: new Date().toISOString(),
          authorId: auth.currentUser?.uid || 'system'
        };

        if (existing?.id) {
          batch.update(doc(db, 'attendance_records', existing.id), data);
        } else {
          const newRef = doc(collection(db, 'attendance_records'));
          batch.set(newRef, {
            ...data,
            createdAt: new Date().toISOString()
          });
        }
      });

      await batch.commit();
      alert(`Día marcado como Feriado para ${allIds.length} operarios.`);
    } catch (error) {
      console.error("Error setting general holiday:", error);
      alert("Error al marcar el feriado general.");
    }
  };

  const handleSaveLeaveRange = async () => {
    if (!showLeaveRangeModal) return;
    
    if (isDateRestricted(rangeStart)) {
      alert("No tiene permisos para cargar licencias o vacaciones en fechas anteriores a la semana actual.");
      return;
    }

    setIsProcessingRange(true);
    try {
      const start = parseISO(rangeStart);
      const end = parseISO(rangeEnd);
      
      if (start > end) {
        alert("La fecha de inicio debe ser anterior a la de fin.");
        return;
      }
      
      const interval = eachDayOfInterval({ start, end });
      const batch = writeBatch(db);
      
      interval.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const existing = attendance.find(a => a.employeeId === showLeaveRangeModal.id && a.date === dateStr);
        
        // Skip if this day is already recorded as a holiday (Feriado)
        if (existing?.status === 'Feriado') return;

        const data: any = {
          employeeId: showLeaveRangeModal.id!,
          employeeName: showLeaveRangeModal.name,
          employeeLegajo: showLeaveRangeModal.legajo,
          date: dateStr,
          shift: existing?.shift || 'Mañana',
          status: 'Licencia',
          observations: leaveReason,
          overtimeHours: 0,
          updatedAt: new Date().toISOString(),
          authorId: auth.currentUser?.uid || 'system'
        };

        if (existing?.id) {
          batch.update(doc(db, 'attendance_records', existing.id), data);
        } else {
          const newRef = doc(collection(db, 'attendance_records'));
          batch.set(newRef, {
            ...data,
            createdAt: new Date().toISOString()
          });
        }
      });
      
      await batch.commit();
      setShowLeaveRangeModal(null);
      setLeaveReason('');
      alert("Rango de licencia cargado exitosamente.");
    } catch (error) {
      console.error("Error saving leave range:", error);
      alert("Error al cargar el rango de licencia.");
    } finally {
      setIsProcessingRange(false);
    }
  };

  const handleSyncHolidays = async () => {
    if (!appConfig?.shiftConfig?.holidays || appConfig.shiftConfig.holidays.length === 0) {
      alert("No hay feriados configurados en el calendario general.");
      return;
    }

    const holidays = appConfig.shiftConfig.holidays;
    const batch = writeBatch(db);
    let count = 0;

    try {
      // Find all employees that should have been present but the day was a holiday
      // We'll iterate through all holidays and all employees
      holidays.forEach((holidayDate: string) => {
        // Restriction: Non-admins cannot sync past holidays
        if (isDateRestricted(holidayDate)) return;

        employees.filter(e => e.active).forEach(emp => {
          const existing = attendance.find(a => a.employeeId === emp.id && a.date === holidayDate);
          if (!existing || existing.status !== 'Feriado') {
            const data: any = {
              employeeId: emp.id!,
              employeeName: emp.name,
              employeeLegajo: emp.legajo,
              date: holidayDate,
              shift: existing?.shift || 'Mañana',
              status: 'Feriado',
              overtimeHours: 0,
              updatedAt: new Date().toISOString(),
              authorId: auth.currentUser?.uid || 'system'
            };

            if (existing?.id) {
              batch.update(doc(db, 'attendance_records', existing.id), data);
            } else {
              const newRef = doc(collection(db, 'attendance_records'));
              batch.set(newRef, { ...data, createdAt: new Date().toISOString() });
            }
            count++;
          }
        });
      });

      if (count > 0) {
        await batch.commit();
        alert(`Se han sincronizado ${count} registros de feriado basados en el calendario general.`);
      } else {
        alert("Todos los feriados ya están sincronizados.");
      }
    } catch (error) {
      console.error("Error syncing holidays:", error);
      alert("Error al sincronizar feriados.");
    }
  };

  const weekDays = useMemo(() => {
    return Array.from({ length: 8 }).map((_, i) => addDays(selectedWeek, i - 1));
  }, [selectedWeek]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-20">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-3 rounded-xl">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">CONTROL DE PERSONAL</h1>
              <p className="text-sm text-gray-500 font-medium">Gestión de asistencia, planificación y extras</p>
            </div>
          </div>
          
          <div className="flex bg-gray-100 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
            {(['attendance', 'planning', 'benefits', 'list', 'analysis', 'nomina'] as Tab[])
              .filter(tab => tab !== 'nomina' || permissions.viewPersonnelPayroll)
              .map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                    activeTab === tab 
                      ? 'bg-white text-blue-600 shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab === 'list' ? 'Personal' : 
                   tab === 'planning' ? 'Planificación' : 
                   tab === 'attendance' ? 'Asistencia' : 
                   tab === 'nomina' ? 'Nómina' :
                   tab === 'benefits' ? 'Vacaciones/Comp' : 'Análisis'}
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Content */}
      {(activeTab === 'list' || activeTab === 'benefits') && (
        <div className="flex justify-between items-center gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nombre o legajo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          {activeTab === 'list' && (
            <button
              onClick={() => {
                setEditingEmployee(null);
                setNewEmployee({ 
                  name: '', 
                  legajo: '', 
                  position: '', 
                  active: true,
                  type: 'Efectivo',
                  hireDate: format(new Date(), 'yyyy-MM-dd')
                });
                setShowEmployeeForm(true);
              }}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
            >
              <UserPlus className="w-4 h-4" />
              Nuevo Empleado
            </button>
          )}
        </div>
      )}

      {activeTab === 'list' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center gap-4">
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2 bg-gray-100 p-1 rounded-xl">
                {['Todos', ...SECTORES].map(s => (
                  <button
                    key={s}
                    onClick={() => setSelectedSector(s)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                      selectedSector === s ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {!isAdmin && userProfile?.sector && (
              <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-xl text-blue-600 border border-blue-100">
                <Users className="w-4 h-4" />
                <span className="text-xs font-black uppercase tracking-widest">Sector: {userProfile.sector}</span>
              </div>
            )}
            <div className="relative flex-1 hidden">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por nombre o legajo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              />
            </div>
            <button
              onClick={() => {
                setEditingEmployee(null);
                setNewEmployee({ 
                  name: '', 
                  legajo: '', 
                  position: '', 
                  active: true,
                  type: 'Efectivo',
                  hireDate: format(new Date(), 'yyyy-MM-dd')
                });
                setShowEmployeeForm(true);
              }}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
            >
              <UserPlus className="w-4 h-4" />
              Nuevo Empleado
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-gray-600 uppercase tracking-wider text-[10px]">Legajo</th>
                  <th className="px-6 py-4 text-left font-bold text-gray-600 uppercase tracking-wider text-[10px]">Nombre</th>
                  <th className="px-6 py-4 text-left font-bold text-gray-600 uppercase tracking-wider text-[10px]">Puesto / Categoría</th>
                  <th className="px-6 py-4 text-left font-bold text-gray-600 uppercase tracking-wider text-[10px]">Tipo</th>
                  <th className="px-6 py-4 text-left font-bold text-gray-600 uppercase tracking-wider text-[10px]">Antigüedad</th>
                  <th className="px-6 py-4 text-center font-bold text-gray-600 uppercase tracking-wider text-[10px]">Estado</th>
                  <th className="px-6 py-4 text-right font-bold text-gray-600 uppercase tracking-wider text-[10px]">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-blue-600">{emp.legajo}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-gray-900">{emp.name}</span>
                        <span className="text-xs text-gray-500">{emp.position}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-gray-800">{emp.rango || '-'}</span>
                        <div className="text-[10px] text-gray-400 mt-0.5 flex gap-2">
                          <span>{emp.convenio || 'Sin Conv.'}</span>
                          {config?.salariosPorRango?.[emp.rango || ''] ? <span>| Base: ${config.salariosPorRango[emp.rango || '']}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        emp.type === 'Temporario' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                      }`}>
                        {emp.type || 'Efectivo'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-gray-700">{calculateTenure(emp)}</span>
                        {emp.hireDate && <span className="text-[9px] text-gray-400">Ingreso: {format(parseISO(emp.hireDate), 'dd/MM/yy')}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${
                        emp.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {emp.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button 
                        onClick={() => setShowEmployeeStats(emp)}
                        className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all"
                        title="Ver Ficha Histórica"
                      >
                        <BarChart3 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => {
                          setEditingEmployee(emp);
                          setNewEmployee({ 
                            name: emp.name, 
                            legajo: emp.legajo, 
                            position: emp.position, 
                            active: emp.active,
                            type: emp.type || 'Efectivo',
                            sector: emp.sector || 'Producción',
                            rango: emp.rango || '',
                            convenio: emp.convenio || '',
                            hireDate: emp.hireDate,
                            terminationDate: emp.terminationDate,
                            vacationAdjustment: emp.vacationAdjustment || 0,
                            compensationAdjustment: emp.compensationAdjustment || 0,
                            history: emp.history || []
                          });
                          setShowEmployeeForm(true);
                        }}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                        title="Editar Empleado"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      
                      {emp.active && (
                        <button 
                          onClick={() => {
                            setEditingEmployee(emp);
                            setNewEmployee({ 
                              name: emp.name, 
                              legajo: emp.legajo, 
                              position: emp.position, 
                              active: false,
                              type: emp.type || 'Efectivo',
                              sector: emp.sector || 'Producción',
                              rango: emp.rango || '',
                              convenio: emp.convenio || '',
                              hireDate: emp.hireDate,
                              terminationDate: emp.terminationDate || format(new Date(), 'yyyy-MM-dd'),
                              vacationAdjustment: emp.vacationAdjustment || 0,
                              compensationAdjustment: emp.compensationAdjustment || 0,
                              history: emp.history || []
                            });
                            setShowEmployeeForm(true);
                          }}
                          className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all"
                          title="Dar de Baja"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                      
                      {isAdmin && (
                        <>
                          {confirmDeleteId === emp.id ? (
                            <div className="inline-flex items-center gap-1 animate-in fade-in slide-in-from-right-2 duration-200">
                              <button 
                                onClick={() => handleDeleteEmployee(emp.id!)}
                                className="bg-red-600 text-white text-[10px] px-2 py-1 rounded font-black uppercase"
                              >
                                Confirmar
                              </button>
                              <button 
                                onClick={() => setConfirmDeleteId(null)}
                                className="bg-gray-100 text-gray-500 text-[10px] px-2 py-1 rounded font-black uppercase"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button 
                              onClick={() => setConfirmDeleteId(emp.id || null)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'planning' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setSelectedWeek(addDays(selectedWeek, -7))}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="text-center min-w-[200px]">
                <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Semana del</span>
                <span className="text-sm font-bold text-gray-900">
                  {format(selectedWeek, "d 'de' MMMM", { locale: es })} - {format(addDays(selectedWeek, 6), "d 'de' MMMM", { locale: es })}
                </span>
              </div>
              <button 
                onClick={() => setSelectedWeek(addDays(selectedWeek, 7))}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center gap-4 relative group/copy">
              <button
                onClick={handleCopyPreviousWeek}
                disabled={isCopying}
                onMouseLeave={() => setShowCopyConfirm(false)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  isCopying 
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                    : showCopyConfirm 
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-200 shadow-sm animate-pulse'
                      : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                }`}
              >
                {isCopying ? (
                  <>
                    <Clock className="w-4 h-4 animate-spin" />
                    Copiando...
                  </>
                ) : showCopyConfirm ? (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    ¿ESTÁS SEGURO? (CONFIRMAR)
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Copiar Semana Anterior
                  </>
                )}
              </button>

              {planningStatus && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`absolute bottom-full mb-2 right-0 w-max max-w-xs px-3 py-2 rounded-lg shadow-lg text-[10px] font-bold z-50 ${
                    planningStatus.startsWith('Error') 
                      ? 'bg-red-600 text-white' 
                      : planningStatus.startsWith('No') 
                        ? 'bg-amber-500 text-white'
                        : 'bg-green-600 text-white'
                  }`}
                >
                  {planningStatus}
                </motion.div>
              )}
            </div>
          </div>

          <div className="flex bg-gray-100 p-1 rounded-xl w-fit">
            {(['Todos', 'Mañana', 'Tarde', 'Noche', 'Sin Asignar'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setPlanningShiftTab(tab)}
                className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  planningShiftTab === tab 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-4 text-left font-bold text-gray-600 uppercase tracking-wider text-[10px] sticky left-0 bg-gray-50 z-10 w-48">Empleado</th>
                  <th className="px-2 py-4 text-center font-bold text-gray-600 uppercase tracking-wider text-[10px]">Semana</th>
                  {weekDays.map((day, i) => (
                    <th key={i} className="px-2 py-4 text-center font-bold text-gray-600 uppercase tracking-wider text-[10px]">
                      <span className="block text-gray-400">{format(day, 'eee', { locale: es })}</span>
                      <span>{format(day, 'dd/MM')}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* Operarios Asignados Section */}
                {planningShiftTab !== 'Sin Asignar' && (
                  <>
                    <tr className="bg-blue-50/50">
                      <td colSpan={weekDays.length + 2} className="px-4 py-2 text-[10px] font-black text-blue-600 uppercase tracking-widest">
                        Operarios Asignados {planningShiftTab === 'Todos' ? 'a la Semana' : `al Turno ${planningShiftTab}`}
                      </td>
                    </tr>
                    {employees
                      .filter(e => {
                        if (!e.active) return false;
                        const hasAnyAssignment = weekDays.some(day => 
                          assignments.some(a => a.employeeId === e.id && a.date === format(day, 'yyyy-MM-dd'))
                        );
                        if (!hasAnyAssignment) return false;
                        
                        if (planningShiftTab === 'Todos') return true;
                        
                        // Check if has assignment in specific shift
                        return weekDays.some(day => 
                          assignments.some(a => a.employeeId === e.id && a.date === format(day, 'yyyy-MM-dd') && a.shift === planningShiftTab)
                        );
                      })
                      .map((emp) => (
                      <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-gray-900 sticky left-0 bg-white z-10 border-r border-gray-100">
                      <div className="flex flex-col">
                        <span>{emp.name}</span>
                        <span className="text-[10px] text-gray-400 font-mono">{emp.legajo}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3 border-r border-gray-50">
                      <div className="flex flex-col gap-1 items-center">
                        {['Mañana', 'Tarde', 'Noche'].map(shift => {
                          const targetIndices = shift === 'Mañana' ? [1,2,3,4,5,6] : shift === 'Tarde' ? [1,2,3,4,5] : [0,1,2,3,4,5];
                          const isAssignedFull = assignments.filter(a => 
                            a.employeeId === emp.id && 
                            a.shift === shift && 
                            targetIndices.some(idx => a.date === format(weekDays[idx], 'yyyy-MM-dd'))
                          ).length >= targetIndices.length;
                          
                          const isLocked = isDateRestricted(format(selectedWeek, 'yyyy-MM-dd'));

                          return (
                            <button
                              key={shift}
                              onClick={() => handleAssignFullWeek(emp.id!, shift)}
                              disabled={isLocked}
                              className={`w-10 py-0.5 rounded text-[8px] font-black uppercase transition-all border ${
                                isAssignedFull 
                                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                                  : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-200'
                              } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                              title={isAssignedFull ? `Quitar ${shift} toda la semana` : `Asignar ${shift} toda la semana`}
                            >
                              {shift === 'Mañana' ? 'M' : shift === 'Tarde' ? 'T' : 'N'}+
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    {weekDays.map((day, i) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const dayAssignments = assignments.filter(a => a.employeeId === emp.id && a.date === dateStr);
                      const isLocked = isDateRestricted(dateStr);
                      
                      return (
                        <td key={i} className="px-1 py-3">
                          <div className="flex flex-col gap-1 items-center">
                            {['Mañana', 'Tarde', 'Noche'].map(shift => {
                              const isAssigned = dayAssignments.some(a => a.shift === shift);
                              const shortName = shift === 'Mañana' ? 'M' : shift === 'Tarde' ? 'T' : 'N';
                              return (
                                <button
                                  key={shift}
                                  onClick={() => handleToggleAssignment(emp.id!, dateStr, shift)}
                                  disabled={isLocked}
                                  className={`w-6 h-6 rounded text-[9px] font-black transition-all border ${
                                    isAssigned 
                                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                                      : 'bg-white text-gray-300 border-gray-100 hover:border-gray-300 hover:text-gray-500'
                                  } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  title={shift}
                                >
                                  {shortName}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            )}

            {/* Otros Operarios Section */}
            {(() => {
              const availableEmployees = employees.filter(e => {
                if (!e.active) return false;
                
                const hasAnyAssignment = weekDays.some(day => 
                  assignments.some(a => a.employeeId === e.id && a.date === format(day, 'yyyy-MM-dd'))
                );
                
                if (planningShiftTab === 'Sin Asignar') {
                  return !hasAnyAssignment;
                }
                
                if (planningShiftTab === 'Todos') {
                  return !hasAnyAssignment;
                }
                
                const hasAssignmentInThisShift = weekDays.some(day => 
                  assignments.some(a => a.employeeId === e.id && a.date === format(day, 'yyyy-MM-dd') && a.shift === planningShiftTab)
                );
                
                return !hasAssignmentInThisShift;
              });

              const completelyUnassigned = availableEmployees.filter(e => {
                return !weekDays.some(day => 
                  assignments.some(a => a.employeeId === e.id && a.date === format(day, 'yyyy-MM-dd'))
                );
              });

              const assignedToOtherShifts = availableEmployees.filter(e => {
                return weekDays.some(day => 
                  assignments.some(a => a.employeeId === e.id && a.date === format(day, 'yyyy-MM-dd'))
                );
              });

              // The render helper for a row
              const renderEmployeeRow = (emp: Employee, isUnassigned: boolean) => (
                <tr key={emp.id} className={`hover:bg-gray-50 transition-colors ${
                  isUnassigned
                    ? 'opacity-60 grayscale-[0.5] hover:opacity-100 hover:grayscale-0'
                    : 'bg-blue-50/20'
                }`}>
                  <td className="px-4 py-3 font-bold text-gray-900 sticky left-0 bg-white z-10 border-r border-gray-100">
                    <div className="flex flex-col">
                      <span>{emp.name}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{emp.legajo}</span>
                    </div>
                  </td>
                  <td className="px-2 py-3 border-r border-gray-50">
                    <div className="flex flex-col gap-1 items-center">
                      {['Mañana', 'Tarde', 'Noche'].map(shift => {
                        const targetIndices = shift === 'Mañana' ? [1,2,3,4,5,6] : shift === 'Tarde' ? [1,2,3,4,5] : [0,1,2,3,4,5];
                        const isAssignedFull = assignments.filter(a => 
                          a.employeeId === emp.id && 
                          a.shift === shift && 
                          targetIndices.some(idx => a.date === format(weekDays[idx], 'yyyy-MM-dd'))
                        ).length >= targetIndices.length;

                        const isLocked = isDateRestricted(format(selectedWeek, 'yyyy-MM-dd'));

                        return (
                          <button
                            key={shift}
                            onClick={() => handleAssignFullWeek(emp.id!, shift)}
                            disabled={isLocked}
                            className={`w-10 py-0.5 rounded text-[8px] font-black uppercase transition-all border ${
                              isAssignedFull 
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                                : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-200'
                            } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                            title={isAssignedFull ? `Quitar ${shift} toda la semana` : `Asignar ${shift} toda la semana`}
                          >
                            {shift === 'Mañana' ? 'M' : shift === 'Tarde' ? 'T' : 'N'}+
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  {weekDays.map((day, i) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const dayAssignments = assignments.filter(a => a.employeeId === emp.id && a.date === dateStr);
                    const isLocked = isDateRestricted(dateStr);
                    
                    return (
                      <td key={i} className="px-1 py-3">
                        <div className="flex flex-col gap-1 items-center">
                          {['Mañana', 'Tarde', 'Noche'].map(shift => {
                            const isAssigned = dayAssignments.some(a => a.shift === shift);
                            const shortName = shift === 'Mañana' ? 'M' : shift === 'Tarde' ? 'T' : 'N';
                            return (
                              <button
                                key={shift}
                                onClick={() => handleToggleAssignment(emp.id!, dateStr, shift)}
                                disabled={isLocked}
                                className={`w-6 h-6 rounded text-[9px] font-black transition-all border ${
                                  isAssigned 
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                                    : 'bg-white text-gray-300 border-gray-100 hover:border-gray-300 hover:text-gray-500'
                                } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                                title={shift}
                              >
                                {shortName}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );

              return (
                <>
                  {completelyUnassigned.length > 0 && (
                    <>
                      <tr className="bg-gray-50">
                        <td colSpan={weekDays.length + 2} className="px-4 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          Operarios sin asignar en la semana
                        </td>
                      </tr>
                      {completelyUnassigned.map(emp => renderEmployeeRow(emp, true))}
                    </>
                  )}
                  {assignedToOtherShifts.length > 0 && (
                    <>
                      <tr className="bg-gray-50 cursor-pointer hover:bg-gray-100" onClick={() => setShowAssignedOthers(!showAssignedOthers)}>
                        <td colSpan={weekDays.length + 2} className="px-4 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center justify-between">
                          <span>Operarios asignados a otros turnos en la semana ({assignedToOtherShifts.length})</span>
                          <span>{showAssignedOthers ? 'Ocultar ▲' : 'Mostrar ▼'}</span>
                        </td>
                      </tr>
                      {showAssignedOthers && assignedToOtherShifts.map(emp => renderEmployeeRow(emp, false))}
                    </>
                  )}
                </>
              );
            })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'attendance' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Calendar className="w-5 h-5 text-blue-600" />
              <div className="flex flex-col">
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                  className={`bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 ${isAttendanceLocked ? 'border-amber-300 ring-2 ring-amber-50' : ''}`}
                />
                {isAttendanceLocked && (
                  <span className="text-[9px] text-amber-600 font-bold uppercase mt-1">Semanas anteriores bloqueadas</span>
                )}
              </div>
              {appConfig?.shiftConfig?.holidays?.includes(attendanceDate) && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 px-3 py-2 rounded-xl border border-red-100 animate-pulse">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Día Feriado (Calendario General)</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl">
              {['Mañana', 'Tarde', 'Noche'].map(s => (
                <button
                  key={s}
                  onClick={() => setAttendanceShift(s)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                    attendanceShift === s ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncHolidays}
                disabled={isAttendanceLocked}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-2 border ${
                  isAttendanceLocked ? 'bg-gray-50 text-gray-400 border-gray-100 cursor-not-allowed' : 'bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100'
                }`}
                title="Sincroniza los feriados configurados en el calendario general del sistema"
              >
                <Calendar className="w-3 h-3" />
                Sincronizar Calendario
              </button>
              <button
                onClick={handleSetGeneralHoliday}
                disabled={isAttendanceLocked}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-2 ${
                  isAttendanceLocked ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-800 text-white hover:bg-gray-900'
                }`}
                title="Marca este día y turno como feriado para todos los operarios planificados"
              >
                <Calendar className="w-3 h-3" />
                Feriado General
              </button>
              <select 
                disabled={isAttendanceLocked}
                className={`bg-white border rounded-xl px-4 py-2 text-sm font-bold outline-none shadow-sm focus:ring-2 focus:ring-blue-500 ${
                  isAttendanceLocked ? 'border-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-200'
                }`}
                onChange={(e) => {
                  const emp = employees.find(emp => emp.id === e.target.value);
                  if (emp) handleSaveAttendance(emp, 'Presente');
                  e.target.value = '';
                }}
              >
                <option value="">+ {isAttendanceLocked ? 'Bloqueado' : 'Agregar Operario Extra'}</option>
                {employees
                  .filter(e => e.active && !assignments.some(a => a.employeeId === e.id && a.date === attendanceDate && a.shift === attendanceShift))
                  .map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.legajo})</option>
                  ))
                }
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employees
              .filter(e => e.active || attendance.some(at => at.employeeId === e.id && at.date === attendanceDate && at.shift === attendanceShift) || assignments.some(as => as.employeeId === e.id && as.date === attendanceDate && as.shift === attendanceShift))
              .sort((a, b) => {
                const aPlanned = assignments.some(as => as.employeeId === a.id && as.date === attendanceDate && as.shift === attendanceShift);
                const bPlanned = assignments.some(as => as.employeeId === b.id && as.date === attendanceDate && as.shift === attendanceShift);
                const aRecord = attendance.some(at => at.employeeId === a.id && at.date === attendanceDate && at.shift === attendanceShift);
                const bRecord = attendance.some(at => at.employeeId === b.id && at.date === attendanceDate && at.shift === attendanceShift);
                
                const aActive = aPlanned || aRecord;
                const bActive = bPlanned || bRecord;

                if (aActive && !bActive) return -1;
                if (!aActive && bActive) return 1;
                return a.name.localeCompare(b.name);
              })
              .map((emp) => {
                const isPlanned = assignments.some(a => 
                  a.employeeId === emp.id && 
                  a.date === attendanceDate && 
                  a.shift === attendanceShift
                );
                
                const record = attendance.find(a => 
                  a.employeeId === emp.id && 
                  a.date === attendanceDate && 
                  a.shift === attendanceShift
                );

                const isExtra = !isPlanned && record;
                const isUnassigned = !isPlanned && !record;

                return (
                  <div key={emp.id} className={`bg-white rounded-2xl shadow-sm border p-4 transition-all ${
                    isPlanned ? 'border-blue-200 ring-1 ring-blue-50' : 
                    isUnassigned ? 'border-gray-100 opacity-60 grayscale-[0.5]' :
                    'border-gray-100'
                  }`}>
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">{emp.name}</span>
                          {isPlanned && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black uppercase">Planificado</span>}
                          {isExtra && <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-black uppercase">Extra</span>}
                          {isUnassigned && <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-black uppercase">Disponible</span>}
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{emp.legajo} - {emp.position}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {record && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            record.status === 'Presente' ? 'bg-green-100 text-green-700' :
                            record.status === 'Ausente' ? 'bg-red-100 text-red-700' :
                            record.status === 'Vacaciones' ? 'bg-blue-100 text-blue-700' :
                            record.status === 'Compensado' ? 'bg-purple-100 text-purple-700' :
                            record.status === 'Feriado' ? 'bg-gray-100 text-gray-800' :
                            'bg-orange-100 text-orange-700'
                          }`}>
                            {record.status}
                          </span>
                        )}
                        {record && (
                          <>
                            {confirmDeleteAttendanceId === record.id ? (
                              <div className="flex items-center gap-1 animate-in fade-in slide-in-from-right-1 duration-200">
                                <button
                                  onClick={() => handleDeleteAttendance(record.id!)}
                                  className="bg-red-600 text-white text-[8px] px-1.5 py-0.5 rounded font-black uppercase"
                                >
                                  OK
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteAttendanceId(null)}
                                  className="bg-gray-100 text-gray-400 p-0.5 rounded"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <button 
                                onClick={() => setConfirmDeleteAttendanceId(record.id || null)}
                                className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                title="Eliminar de la lista de hoy"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                      {['Presente', 'Ausente', 'Tarde', 'Vacaciones', 'Compensado', 'Licencia', 'Feriado'].map((status) => (
                        <button
                          key={status}
                          onClick={() => handleSaveAttendance(emp, status as any)}
                          disabled={isAttendanceLocked}
                          className={`flex-1 min-w-[80px] py-2 rounded-xl text-[9px] font-black uppercase transition-all ${
                            record?.status === status 
                              ? (status === 'Presente' ? 'bg-green-600' : 
                                 status === 'Ausente' ? 'bg-red-600' : 
                                 status === 'Vacaciones' ? 'bg-blue-600' :
                                 status === 'Compensado' ? 'bg-purple-600' :
                                 status === 'Feriado' ? 'bg-gray-800' :
                                 'bg-orange-600') + ' text-white shadow-lg shadow-blue-100' 
                              : (isAttendanceLocked ? 'bg-gray-100 text-gray-300 opacity-50 cursor-not-allowed' : 'bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600')
                          }`}
                        >
                          {status}
                        </button>
                      ))}
                    </div>

                    {record?.status === 'Presente' && (
                      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-gray-400" />
                          <span className="text-xs font-bold text-gray-500 uppercase tracking-tighter">Horas Extras</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleSaveAttendance(emp, 'Presente', Math.max(0, (record.overtimeHours || 0) - 0.5))}
                            className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center font-bold hover:bg-gray-200"
                          >-</button>
                          <span className="text-sm font-black text-blue-700 w-8 text-center">{(record.overtimeHours || 0).toFixed(1)}</span>
                          <button 
                            onClick={() => handleSaveAttendance(emp, 'Presente', (record.overtimeHours || 0) + 0.5)}
                            className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center font-bold hover:bg-gray-200"
                          >+</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {activeTab === 'benefits' && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 bg-blue-50 p-4 rounded-2xl border border-blue-100">
            <AlertCircle className="w-5 h-5 text-blue-600" />
            <p className="text-xs font-medium text-blue-700">
              Las vacaciones se calculan automáticamente según la Ley Argentina basándose en la fecha de ingreso.
              Los compensados se generan a razón de 1 día por cada 8 horas extras registradas los sábados (después de las 13hs) y domingos.
            </p>
          </div>

          {/* Resumen General de Beneficios */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Calendar className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Días Vacaciones</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-black text-gray-900">{benefitsAggregate.totalVacDays}</span>
                <span className="text-[10px] font-bold text-gray-500 uppercase">{benefitsAggregate.empVacOwedCount} operarios</span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-purple-50 rounded-lg">
                  <Clock className="w-4 h-4 text-purple-600" />
                </div>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Días Compensados</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-black text-gray-900">{benefitsAggregate.totalCompDays}</span>
                <span className="text-[10px] font-bold text-gray-500 uppercase">{benefitsAggregate.empCompOwedCount} operarios</span>
              </div>
            </div>

            {/* Licencias Vigentes */}
            <div className="lg:col-span-2 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-orange-50 rounded-lg">
                  <FileText className="w-4 h-4 text-orange-600" />
                </div>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Licencias Vigentes (Hoy)</span>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[60px] space-y-2 pr-2">
                {benefitsAggregate.activeLicenses.length > 0 ? (
                  benefitsAggregate.activeLicenses.map((lic, i) => (
                    <div key={i} className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2">
                         <span className="font-bold text-gray-700">{lic.name}</span>
                         {lic.reason && <span className="text-[10px] text-gray-400 italic">({lic.reason})</span>}
                      </div>
                      <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full font-black text-[9px] uppercase">
                        {lic.days} días registrados
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-400 italic">No hay licencias activas hoy.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredEmployees.filter(e => e.active && e.type === 'Efectivo').map(emp => {
              const summary = getBenefitsSummary(emp);
              return (
                <div key={emp.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b border-gray-100 bg-gray-50">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-black text-gray-900 uppercase text-sm tracking-tight">{emp.name}</h4>
                        <p className="text-[10px] text-gray-500 font-mono">Legajo: {emp.legajo} • {emp.position}</p>
                      </div>
                      <div className="text-right">
                        <span className="block text-[9px] font-black text-gray-400 uppercase tracking-widest">Antigüedad</span>
                        <span className="text-xs font-bold text-gray-700">{calculateTenure(emp)}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 space-y-4">
                    {/* Vacations */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Vacaciones</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setShowVacationRangeModal(emp);
                              setRangeStart(format(new Date(), 'yyyy-MM-dd'));
                              setRangeEnd(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
                            }}
                            className="text-[9px] bg-blue-600 text-white px-2 py-0.5 rounded font-black hover:bg-blue-700 transition-colors"
                          >
                            CARGAR RANGO
                          </button>
                          <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                            {summary.vacations.remaining} / {summary.vacations.total} días
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 transition-all duration-500"
                          style={{ width: `${(summary.vacations.used / (summary.vacations.total || 1)) * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[9px] font-bold uppercase tracking-tighter text-gray-400">
                        <span>Usadas: {summary.vacations.used}d</span>
                        <div className="flex gap-2">
                          {summary.vacations.adjustment !== 0 && (
                            <span className="text-blue-500">Ajuste: {summary.vacations.adjustment > 0 ? '+' : ''}{summary.vacations.adjustment}d</span>
                          )}
                          <span>Restantes: {summary.vacations.remaining}d</span>
                        </div>
                      </div>
                    </div>

                    {/* Compensated */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Compensados</span>
                        <span className="text-xs font-black text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                          {summary.compensated.remaining} / {summary.compensated.total} días
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-purple-500 transition-all duration-500"
                          style={{ width: `${(summary.compensated.used / (summary.compensated.total || 1)) * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[9px] font-bold uppercase tracking-tighter text-gray-400">
                        <span>Saldo horas: {summary.compensated.overtimeBalance.toFixed(1)}hs</span>
                        <div className="flex gap-2">
                          {summary.compensated.adjustment !== 0 && (
                            <span className="text-purple-500">Ajuste: {summary.compensated.adjustment > 0 ? '+' : ''}{summary.compensated.adjustment}d</span>
                          )}
                          <span>Restantes: {summary.compensated.remaining}d</span>
                        </div>
                      </div>
                    </div>

                    {/* Historial de Vacaciones Recientes */}
                    {(() => {
                      const empVacations = attendance
                        .filter(a => a.employeeId === emp.id && a.status === 'Vacaciones')
                        .sort((a, b) => b.date.localeCompare(a.date));
                      
                      // Identify ranges
                      const ranges: { start: string; end: string }[] = [];
                      if (empVacations.length > 0) {
                        let currentRange: { start: string; end: string } | null = null;
                        
                        // We need all dates, including holidays in the middle, to identify ranges correctly
                        // But since we only have 'Vacaciones' records, we might have gaps if there's a holiday.
                        // Let's assume a range is contiguous if there's no more than 3 days gap (weekends + maybe a holiday)
                        // Or better, let's just group them by month for simplicity if finding ranges is too complex
                        // No, let's try to find ranges.
                        
                        const sortedDates = empVacations.map(v => v.date).sort();
                        if (sortedDates.length > 0) {
                          let start = sortedDates[0];
                          let prev = sortedDates[0];
                          
                          for (let i = 1; i <= sortedDates.length; i++) {
                            const current = sortedDates[i];
                            const prevDate = parseISO(prev);
                            const currDate = current ? parseISO(current) : null;
                            
                            // If gap is more than 4 days, consider it a new range
                            // (This handles weekends and single holidays)
                            const diffDays = currDate ? (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24) : 999;
                            
                            if (diffDays > 4) {
                              ranges.push({ start, end: prev });
                              if (current) start = current;
                            }
                            prev = current;
                          }
                        }
                      }

                      if (ranges.length === 0) return null;

                      return (
                        <div className="pt-2 border-t border-gray-100">
                          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-2">Rangos Registrados</span>
                          <div className="space-y-1.5 max-h-[80px] overflow-y-auto pr-1">
                            {ranges.slice(0, 3).map((range, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                                <div className="text-[10px] font-bold text-gray-700">
                                  {format(parseISO(range.start), 'dd/MM')} al {format(parseISO(range.end), 'dd/MM/yy')}
                                </div>
                                <button
                                  onClick={() => {
                                    setShowVacationRangeModal(emp);
                                    setRangeStart(range.start);
                                    setRangeEnd(range.end);
                                    setDetectedRange(range);
                                    setOperationMessage(null);
                                    setShowDeleteConfirm(false);
                                  }}
                                  className="p-1 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                                  title="Editar este rango"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Leaves / Licencias */}
                    <div className="pt-2 border-t border-gray-100">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Licencias</span>
                        <button
                          onClick={() => {
                            setShowLeaveRangeModal(emp);
                            setRangeStart(format(new Date(), 'yyyy-MM-dd'));
                            setRangeEnd(format(addDays(new Date(), 3), 'yyyy-MM-dd'));
                            setLeaveReason('');
                          }}
                          className="text-[9px] bg-gray-600 text-white px-2 py-0.5 rounded font-black hover:bg-gray-700 transition-colors"
                        >
                          CARGAR LICENCIA
                        </button>
                      </div>
                      <div className="text-[10px] font-bold text-gray-500">
                        Total días: {attendance.filter(a => a.employeeId === emp.id && a.status === 'Licencia').length}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'analysis' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Personal</span>
              <span className="text-3xl font-black text-gray-900">{employees.filter(e => e.active).length}</span>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Asistencia Hoy</span>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-black text-green-600">
                  {attendance.filter(a => a.date === attendanceDate && a.status === 'Presente').length}
                </span>
                <span className="text-sm font-bold text-gray-400 mb-1">presentes</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Horas Extras Mes</span>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-black text-orange-600">
                  {attendance.reduce((sum, a) => sum + (a.overtimeHours || 0), 0).toFixed(1)}
                </span>
                <span className="text-sm font-bold text-gray-400 mb-1">hs totales</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-700 uppercase text-xs tracking-wider">Últimos Registros de Asistencia</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left font-bold text-gray-600 uppercase tracking-wider text-[10px]">Fecha</th>
                    <th className="px-6 py-4 text-left font-bold text-gray-600 uppercase tracking-wider text-[10px]">Empleado</th>
                    <th className="px-6 py-4 text-center font-bold text-gray-600 uppercase tracking-wider text-[10px]">Turno</th>
                    <th className="px-6 py-4 text-center font-bold text-gray-600 uppercase tracking-wider text-[10px]">Estado</th>
                    <th className="px-6 py-4 text-right font-bold text-gray-600 uppercase tracking-wider text-[10px]">Extras</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {attendance.slice(0, 20).map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-gray-500">{format(parseISO(a.date), 'dd/MM/yyyy')}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-gray-900">{a.employeeName}</span>
                          <span className="text-[10px] text-gray-400 font-mono">{a.employeeLegajo}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center text-gray-500">{a.shift}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${
                          a.status === 'Presente' ? 'bg-green-100 text-green-700' :
                          a.status === 'Ausente' ? 'bg-red-100 text-red-700' :
                          'bg-orange-100 text-orange-700'
                        }`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-orange-600">
                        {a.overtimeHours > 0 ? `${a.overtimeHours.toFixed(1)} hs` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'nomina' && permissions.viewPersonnelPayroll && (
        <NominaTab employees={employees} config={config} />
      )}

      {/* Leave Range Modal */}
      {showLeaveRangeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 bg-gray-700 text-white">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-black uppercase tracking-tight">Cargar Licencia</h3>
                <button onClick={() => setShowLeaveRangeModal(null)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-gray-200 text-xs font-medium">Asignando licencia para <span className="font-bold text-white">{showLeaveRangeModal.name}</span></p>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Desde</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="date"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-gray-500 focus:bg-white transition-all outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Hasta</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="date"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-gray-500 focus:bg-white transition-all outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Motivo / Observaciones</label>
                <textarea
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  placeholder="Ej: Certificado médico, fallecimiento, etc."
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-gray-500 focus:bg-white transition-all outline-none h-24 resize-none"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowLeaveRangeModal(null)}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveLeaveRange}
                  disabled={isProcessingRange}
                  className="flex-1 px-4 py-3 bg-gray-700 text-white rounded-xl font-bold text-sm hover:bg-gray-800 transition-all shadow-lg shadow-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isProcessingRange ? (
                    <Clock className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {isProcessingRange ? 'Cargando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vacation Range Modal */}
      {showVacationRangeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 bg-blue-600 text-white">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-black uppercase tracking-tight">Cargar Vacaciones</h3>
                <button onClick={() => setShowVacationRangeModal(null)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-blue-100 text-xs font-medium">Asignando rango para <span className="font-bold text-white">{showVacationRangeModal.name}</span></p>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Fecha Inicio</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="date"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Fecha Fin</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="date"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-orange-50 border border-orange-100 p-4 rounded-xl flex gap-3">
                <AlertCircle className="w-5 h-5 text-orange-600 shrink-0" />
                <p className="text-[10px] text-orange-700 leading-relaxed font-medium">
                  Esto generará registros de <b>Asistencia</b> marcados como <b>Vacaciones</b> para cada día en el rango seleccionado. Los registros existentes serán actualizados.
                </p>
              </div>

              {operationMessage && (
                <div className={`mt-4 p-3 rounded-xl flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${
                  operationMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
                }`}>
                  {operationMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {operationMessage.text}
                </div>
              )}

              {showDeleteConfirm ? (
                <div className="mt-6 bg-red-50 p-4 rounded-xl border border-red-100 animate-in zoom-in-95 duration-200">
                  <p className="text-xs font-black text-red-700 uppercase tracking-widest text-center mb-3">
                    ¿Confirmar eliminación de este rango?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="flex-1 px-4 py-2 bg-white text-gray-500 rounded-lg font-bold text-[10px] uppercase border border-red-100 transition-all hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleDeleteVacationRange}
                      disabled={isProcessingRange}
                      className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-[10px] uppercase shadow-sm transition-all hover:bg-red-700 disabled:bg-red-300"
                    >
                      {isProcessingRange ? 'Eliminando...' : 'Confirmar'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3 mt-6">
                  <div className="flex-1 flex gap-2">
                    <button
                      onClick={() => {
                        setShowVacationRangeModal(null);
                        setDetectedRange(null);
                      }}
                      className="flex-1 px-4 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all uppercase tracking-widest"
                    >
                      Cerrar
                    </button>
                    {detectedRange && (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={isProcessingRange}
                        className="px-4 py-3 bg-red-50 text-red-600 rounded-xl font-bold text-sm hover:bg-red-100 transition-all border border-red-100"
                        title="Borrar todos los registros de vacaciones en este rango"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={handleSaveVacationRange}
                    disabled={isProcessingRange}
                    className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:bg-blue-300 uppercase tracking-widest"
                  >
                    {isProcessingRange ? 'PROCESANDO...' : detectedRange ? 'ACTUALIZAR' : 'GUARDAR'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Employee Stats / Ficha Histórica Modal */}
      {showEmployeeStats && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 bg-blue-600 text-white">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-xl">
                    <BarChart3 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tight">Ficha Histórica</h3>
                    <p className="text-blue-100 text-xs font-medium">{showEmployeeStats.name} - Legajo: {showEmployeeStats.legajo}</p>
                  </div>
                </div>
                <button onClick={() => setShowEmployeeStats(null)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            
            <div className="p-8">
              <div className="flex items-center gap-4 mb-6 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Mes de Consulta:</span>
                </div>
                <input 
                  type="month"
                  value={selectedStatsMonth}
                  onChange={(e) => setSelectedStatsMonth(e.target.value)}
                  className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>

              {(() => {
                const stats = getEmployeeStats(showEmployeeStats.id!);
                return (
                  <div className="space-y-8">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 text-center">
                        <span className="block text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Horas Extras</span>
                        <span className="text-2xl font-black text-blue-700">{stats.overtime.toFixed(1)}h</span>
                      </div>
                      <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 text-center">
                        <span className="block text-[10px] font-black text-orange-400 uppercase tracking-widest mb-1">Llegadas Tarde</span>
                        <span className="text-2xl font-black text-orange-700">{stats.lateness}</span>
                      </div>
                      <div className="bg-red-50 p-4 rounded-2xl border border-red-100 text-center">
                        <span className="block text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">Ausencias</span>
                        <span className="text-2xl font-black text-red-700">{stats.absences}</span>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 text-center">
                        <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Licencias</span>
                        <span className="text-2xl font-black text-gray-700">{stats.leaves}</span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-600" />
                        Resumen de Actividad
                      </h4>
                      
                      <div className="space-y-3">
                        <div className="bg-white border border-gray-100 p-4 rounded-2xl space-y-4">
                          <div className="flex justify-between items-center text-xs font-bold text-gray-600">
                            <span>Registros en Sistema</span>
                            <span>{stats.totalRecords} días</span>
                          </div>
                          
                          <div className="space-y-4">
                            {[
                              { label: 'Asistencia Perfecta', count: attendance.filter(r => r.employeeId === showEmployeeStats.id && r.status === 'Presente').length, color: 'bg-green-500' },
                              { label: 'Vacaciones Tomadas', count: stats.vacations, color: 'bg-blue-500' },
                              { label: 'Licencias / Otros', count: stats.leaves, color: 'bg-gray-500' },
                              { label: 'Faltas Injustificadas', count: stats.absences, color: 'bg-red-500' }
                            ].map((item, i) => (
                              <div key={i} className="space-y-1.5">
                                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-gray-400">
                                  <span>{item.label}</span>
                                  <span>{item.count} d</span>
                                </div>
                                <div className="h-2 bg-gray-50 rounded-full overflow-hidden border border-gray-100">
                                  <div 
                                    className={`h-full ${item.color} transition-all duration-1000`} 
                                    style={{ width: `${(item.count / (stats.totalRecords || 1)) * 100}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2 mt-4 ml-1">
                        <History className="w-4 h-4 text-blue-600" />
                        Historial de Contratación (Altas / Bajas)
                      </h4>
                      <div className="bg-white border border-gray-100 p-4 rounded-2xl">
                        <div className="grid grid-cols-1 gap-2 max-h-[150px] overflow-y-auto pr-1">
                          {(() => {
                            const fullHistory: { hireDate: string; terminationDate?: string }[] = [];
                            if (showEmployeeStats.history && showEmployeeStats.history.length > 0) {
                              showEmployeeStats.history.forEach(h => {
                                fullHistory.push(h);
                              });
                            }
                            if (showEmployeeStats.hireDate) {
                              const exists = fullHistory.some(p => p.hireDate === showEmployeeStats.hireDate);
                              if (!exists) {
                                fullHistory.push({
                                  hireDate: showEmployeeStats.hireDate,
                                  terminationDate: showEmployeeStats.active ? undefined : (showEmployeeStats.terminationDate || undefined)
                                });
                              }
                            }
                            
                            if (fullHistory.length === 0) {
                              return <div className="text-xs text-gray-400 italic py-2 text-center">No hay registros de contratos en el sistema.</div>;
                            }
                            
                            // Sort chronologically (newest first)
                            fullHistory.sort((a,b) => b.hireDate.localeCompare(a.hireDate));

                            return fullHistory.map((h, i) => (
                              <div key={i} className="flex justify-between items-center p-2.5 bg-gray-50 rounded-xl border border-gray-100 text-xs font-bold text-gray-700">
                                <div className="flex gap-4">
                                  <div>
                                    <span className="text-[9px] text-gray-400 block uppercase font-black leading-none mb-1">Fecha Alta</span>
                                    <span>{h.hireDate ? format(parseISO(h.hireDate), 'dd/MM/yyyy') : '-'}</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] text-gray-400 block uppercase font-black leading-none mb-1">Fecha Baja</span>
                                    <span className={h.terminationDate ? "text-gray-700" : "text-green-600 uppercase tracking-wider text-[10px]"}>
                                      {h.terminationDate ? format(parseISO(h.terminationDate), 'dd/MM/yyyy') : 'Activo actualmente'}
                                    </span>
                                  </div>
                                </div>
                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg ${
                                  !h.terminationDate ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
                                }`}>
                                  {!h.terminationDate ? "Activo" : "Baja"}
                                </span>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <button
                        onClick={() => setShowEmployeeStats(null)}
                        className="px-8 py-3 bg-gray-900 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-black transition-all shadow-lg shadow-gray-200"
                      >
                        Cerrar Ficha
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Employee Form Modal */}
      {showEmployeeForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-6 text-white">
              <h3 className="text-xl font-black uppercase tracking-tight">
                {editingEmployee ? 'Editar Empleado' : 'Nuevo Empleado'}
              </h3>
              <p className="text-blue-100 text-xs font-bold uppercase tracking-widest mt-1">Información de Legajo</p>
            </div>
            <form onSubmit={handleSaveEmployee} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nombre Completo</label>
                <input
                  type="text"
                  required
                  value={newEmployee.name}
                  onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  placeholder="Ej: Juan Pérez"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Legajo</label>
                  <input
                    type="text"
                    required
                    value={newEmployee.legajo}
                    onChange={(e) => setNewEmployee({ ...newEmployee, legajo: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Ej: 1234"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Puesto</label>
                  <input
                    type="text"
                    required
                    value={newEmployee.position}
                    onChange={(e) => setNewEmployee({ ...newEmployee, position: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Ej: Operario L1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Tipo de Personal</label>
                  <select
                    value={newEmployee.type || 'Efectivo'}
                    onChange={(e) => setNewEmployee({ ...newEmployee, type: e.target.value as any })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  >
                    <option value="Efectivo">Efectivo</option>
                    <option value="Temporario">Temporario</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Sector</label>
                  <select
                    value={newEmployee.sector || 'Producción'}
                    disabled={!isAdmin}
                    onChange={(e) => {
                      const newSector = e.target.value;
                      setNewEmployee({ 
                        ...newEmployee, 
                        sector: newSector,
                        rango: getRangosParaSector(newSector)[0]
                      });
                    }}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  >
                    {SECTORES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fecha de Ingreso</label>
                  <input
                    type="date"
                    required
                    value={newEmployee.hireDate || ''}
                    onChange={(e) => setNewEmployee({ ...newEmployee, hireDate: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Rango / Categoría</label>
                  <select
                    value={newEmployee.rango || ''}
                    onChange={(e) => setNewEmployee({ ...newEmployee, rango: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  >
                    <option value="">Seleccione...</option>
                    {getRangosParaSector(newEmployee.sector).map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Convenio Gremial</label>
                  <select
                    value={newEmployee.convenio || ''}
                    onChange={(e) => setNewEmployee({ ...newEmployee, convenio: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  >
                    <option value="">Seleccione...</option>
                    <option value="SUTIAGA">SUTIAGA</option>
                    <option value="Sin Convenio">Sin Convenio</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest ml-1">Ajuste Vacaciones (Días)</label>
                  <input
                    type="number"
                    value={newEmployee.vacationAdjustment || 0}
                    onChange={(e) => setNewEmployee({ ...newEmployee, vacationAdjustment: parseInt(e.target.value) || 0 })}
                    className="w-full bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Ej: 5"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-purple-400 uppercase tracking-widest ml-1">Ajuste Compensados (Días)</label>
                  <input
                    type="number"
                    value={newEmployee.compensationAdjustment || 0}
                    onChange={(e) => setNewEmployee({ ...newEmployee, compensationAdjustment: parseInt(e.target.value) || 0 })}
                    className="w-full bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                    placeholder="Ej: 2"
                  />
                </div>
              </div>

              {!newEmployee.active && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fecha de Baja</label>
                  <input
                    type="date"
                    required
                    value={newEmployee.terminationDate || format(new Date(), 'yyyy-MM-dd')}
                    onChange={(e) => setNewEmployee({ ...newEmployee, terminationDate: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={newEmployee.active}
                  onChange={(e) => {
                    const active = e.target.checked;
                    let history = [...(newEmployee.history || [])];
                    let hireDate = newEmployee.hireDate;
                    let terminationDate = newEmployee.terminationDate;
                    
                    if (active) {
                      // Transitioning to Active
                      if (editingEmployee && !editingEmployee.active) {
                        const oldHire = editingEmployee.hireDate;
                        const oldTerm = editingEmployee.terminationDate;
                        if (oldHire) {
                          const exists = history.some(p => p.hireDate === oldHire);
                          if (!exists) {
                            history.push({
                              hireDate: oldHire,
                              terminationDate: oldTerm || ""
                            });
                          }
                        }
                        // Set new active hireDate to today, clear terminationDate
                        hireDate = format(new Date(), 'yyyy-MM-dd');
                        terminationDate = "";
                      } else {
                        terminationDate = "";
                      }
                    } else {
                      // Transitioning to Inactive
                      if (editingEmployee && !editingEmployee.active) {
                        // If they were originally inactive, and they toggle from active back to inactive,
                        // we can restore the originally saved period from history if we archived it.
                        const oldHire = editingEmployee.hireDate;
                        if (oldHire) {
                          const pIndex = history.findIndex(p => p.hireDate === oldHire);
                          if (pIndex > -1) {
                            history.splice(pIndex, 1);
                          }
                          hireDate = oldHire;
                          terminationDate = editingEmployee.terminationDate || format(new Date(), 'yyyy-MM-dd');
                        }
                      } else {
                        terminationDate = terminationDate && terminationDate !== "" ? terminationDate : format(new Date(), 'yyyy-MM-dd');
                      }
                    }

                    setNewEmployee({ 
                      ...newEmployee, 
                      active,
                      history,
                      hireDate,
                      terminationDate
                    });
                  }}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <label htmlFor="active" className="text-sm font-bold text-gray-700">Empleado Activo</label>
              </div>

              {/* Contrato Historial section */}
              {((newEmployee.history && newEmployee.history.length > 0) || (editingEmployee && !editingEmployee.active)) && (
                <div className="bg-gray-50 p-4 rounded-2xl space-y-2 mt-4 border border-gray-100">
                  <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    <History className="w-4 h-4 text-gray-400" />
                    <span>Historial de Contratación (Altas y Bajas)</span>
                  </div>
                  <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                    {(() => {
                      const list = [...(newEmployee.history || [])];
                      if (list.length === 0) {
                        return (
                          <div className="text-xs text-gray-400 italic py-1">No hay registros de contratos anteriores.</div>
                        );
                      }
                      return list.map((hist, index) => (
                        <div key={index} className="flex justify-between items-center bg-white p-2 rounded-xl border border-gray-100 text-xs font-bold text-gray-700">
                          <div className="flex gap-4">
                            <div>
                              <span className="text-[9px] text-gray-400 block uppercase font-black leading-none mb-1">Alta</span>
                              <span>{hist.hireDate ? format(parseISO(hist.hireDate), 'dd/MM/yyyy') : '-'}</span>
                            </div>
                            <div>
                              <span className="text-[9px] text-gray-400 block uppercase font-black leading-none mb-1">Baja</span>
                              <span>{hist.terminationDate ? format(parseISO(hist.terminationDate), 'dd/MM/yyyy') : '-'}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const updatedHistList = (newEmployee.history || []).filter((_, i) => i !== index);
                              setNewEmployee({
                                ...newEmployee,
                                history: updatedHistList
                              });
                            }}
                            className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 rounded-lg transition-colors"
                            title="Eliminar período del historial"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEmployeeForm(false)}
                  className="flex-1 px-4 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
