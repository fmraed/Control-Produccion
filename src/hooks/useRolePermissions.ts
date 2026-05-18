import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { RolePermissions, UserRole } from '../types';

const analyticsDefaultsTrue = {
  viewManagementSummary: true,
  viewConsolidated: true,
  viewWaste: true,
  viewSyrup: true,
  viewGoalFulfillment: true,
  viewStockControl: true,
  viewDowntime: true,
  viewEfficiency: true,
  viewGantt: true,
};

const analyticsDefaultsFalse = {
  viewManagementSummary: false,
  viewConsolidated: false,
  viewWaste: false,
  viewSyrup: false,
  viewGoalFulfillment: false,
  viewStockControl: false,
  viewDowntime: false,
  viewEfficiency: false,
  viewGantt: false,
};

const DEFAULT_PERMISSIONS: Record<UserRole, RolePermissions> = {
  admin: {
    viewReports: true,
    editReports: true,
    viewElaboracion: true,
    editElaboracion: true,
    viewScheduler: true,
    editScheduler: true,
    viewPersonnel: true,
    editPersonnel: true,
    viewLiveMonitor: true,
    viewAnalytics: true,
    ...analyticsDefaultsTrue,
    viewAdmin: true,
    viewPersonnelPayroll: true,
  },
  jefe_produccion: {
    viewReports: true,
    editReports: true,
    viewElaboracion: true,
    editElaboracion: true,
    viewScheduler: true,
    editScheduler: true,
    viewPersonnel: true,
    editPersonnel: true,
    viewLiveMonitor: true,
    viewAnalytics: true,
    ...analyticsDefaultsTrue,
    viewAdmin: false,
    viewPersonnelPayroll: true,
  },
  produccion: {
    viewReports: true,
    editReports: true,
    viewElaboracion: true,
    editElaboracion: true,
    viewScheduler: true,
    editScheduler: false,
    viewPersonnel: true,
    editPersonnel: true,
    viewLiveMonitor: true,
    viewAnalytics: false,
    ...analyticsDefaultsFalse,
    viewAdmin: false,
    viewPersonnelPayroll: false,
  },
  calidad: {
    viewReports: true,
    editReports: false,
    viewElaboracion: true,
    editElaboracion: true,
    viewScheduler: true,
    editScheduler: false,
    viewPersonnel: true,
    editPersonnel: true,
    viewLiveMonitor: true,
    viewAnalytics: false,
    ...analyticsDefaultsFalse,
    viewAdmin: false,
    viewPersonnelPayroll: false,
  },
};

const GUEST_PERMISSIONS: RolePermissions = {
  viewReports: false,
  editReports: false,
  viewElaboracion: false,
  editElaboracion: false,
  viewScheduler: false,
  editScheduler: false,
  viewPersonnel: false,
  editPersonnel: false,
  viewLiveMonitor: false,
  viewAnalytics: false,
  ...analyticsDefaultsFalse,
  viewAdmin: false,
  viewPersonnelPayroll: false,
};

export function useRolePermissions(role: UserRole | undefined) {
  const [permissions, setPermissions] = useState<RolePermissions>(
    role && DEFAULT_PERMISSIONS[role] ? DEFAULT_PERMISSIONS[role] : GUEST_PERMISSIONS
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!role) {
      setPermissions(GUEST_PERMISSIONS);
      setLoading(false);
      return;
    }

    // Default to static while loading
    setPermissions(DEFAULT_PERMISSIONS[role] || GUEST_PERMISSIONS);

    const unsub = onSnapshot(doc(db, 'config', 'permissions'), (snap) => {
      if (snap.exists()) {
        const remoteData = snap.data();
        if (remoteData[role]) {
          setPermissions({ ...(DEFAULT_PERMISSIONS[role] || GUEST_PERMISSIONS), ...remoteData[role] });
        } else {
          setPermissions(DEFAULT_PERMISSIONS[role] || GUEST_PERMISSIONS);
        }
      }
      setLoading(false);
    });

    return () => unsub();
  }, [role]);

  return { permissions, loading };
}
