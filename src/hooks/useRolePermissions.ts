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
  },
};

export function useRolePermissions(role: UserRole | undefined) {
  const [permissions, setPermissions] = useState<RolePermissions>(
    role && DEFAULT_PERMISSIONS[role] ? DEFAULT_PERMISSIONS[role] : DEFAULT_PERMISSIONS.produccion
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to dynamic permissions from Firestore
    const unsub = onSnapshot(doc(db, 'config', 'permissions'), (snap) => {
      if (snap.exists()) {
        const remoteData = snap.data();
        if (role && remoteData[role]) {
          setPermissions({ ...DEFAULT_PERMISSIONS[role], ...remoteData[role] });
        } else if (role && DEFAULT_PERMISSIONS[role]) {
          setPermissions(DEFAULT_PERMISSIONS[role]);
        } else {
          setPermissions(DEFAULT_PERMISSIONS.produccion);
        }
      } else {
        if (role && DEFAULT_PERMISSIONS[role]) {
          setPermissions(DEFAULT_PERMISSIONS[role]);
        } else {
          setPermissions(DEFAULT_PERMISSIONS.produccion);
        }
      }
      setLoading(false);
    });

    return () => unsub();
  }, [role]);

  return { 
    permissions: permissions || DEFAULT_PERMISSIONS.produccion, 
    loading 
  };
}
